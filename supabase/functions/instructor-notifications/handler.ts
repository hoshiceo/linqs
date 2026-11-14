type Env = (name: string) => string | undefined;
type Job = {
  attemptId: string;
  sender: string;
  recipient: string;
  question: { id: string; course_id: string | null; conversation_title: string; original_question: string; ai_answer: string; question: string; created_at: string };
};

function emailBody(job: Job) {
  const q = job.question;
  // Keep the original immutable payload so in-flight idempotency keys stay valid.
  return {
    from: job.sender,
    to: [job.recipient],
    subject: "【Linqs】講師への質問が届きました",
    text: [
      "Linqsで講師への質問を受け付けました。",
      `受付ID: ${q.id}`,
      `受付日時: ${q.created_at}`,
      `コース: ${q.course_id ?? "指定なし"}`,
      `会話タイトル: ${q.conversation_title}`,
      "", "■ 講師への質問", q.question,
      "", "■ 元の質問", q.original_question,
      "", "■ AIの回答", q.ai_answer,
      "", "返信はSupabaseのinstructor_questionsテーブルの該当する受付IDのreply列に登録してください。",
      "この通知メールへの返信は、受講者への返信には反映されません。",
    ].join("\n"),
  };
}

async function readBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(data);
}

async function authorized(request: Request, body: string, secret: string) {
  const timestamp = request.headers.get("x-linqs-timestamp") ?? "";
  const signature = request.headers.get("x-linqs-signature") ?? "";
  if (!/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)
    || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.match(/../g)!, hex => parseInt(hex, 16));
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(`${timestamp}.${body}`));
}

const validRecipient = (value: string) => value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value);

export function createNotificationHandler(env: Env, send: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    try {
      const writer = env("LINQS_EXCHANGE_WRITE_KEY") ?? "";
      if (!/^[a-f0-9]{64}$/.test(writer)) return Response.json({ error: "Worker configuration incomplete" }, { status: 503 });
      const raw = await readBody(request);
      if (raw === null) return Response.json({ error: "Request too large" }, { status: 413 });
      if (!await authorized(request, raw, writer)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      let input: unknown;
      try { input = JSON.parse(raw); } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
      if (!input || typeof input !== "object" || Array.isArray(input)) return Response.json({ error: "Invalid request" }, { status: 400 });
      const questionId = (input as { questionId?: unknown }).questionId;
      if (questionId !== undefined && (typeof questionId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(questionId))) {
        return Response.json({ error: "Invalid request" }, { status: 400 });
      }
      if (env("INSTRUCTOR_EMAIL_NOTIFICATIONS_ENABLED") !== "true") return Response.json({ status: "disabled" }, { status: 202 });
      const url = env("SUPABASE_URL");
      const publicKey = env("LINQS_SUPABASE_PUBLISHABLE_KEY");
      const owner = env("LINQS_CLASS_ACCOUNT_USER_ID");
      const apiKey = env("RESEND_API_KEY")?.trim();
      const sender = env("INSTRUCTOR_NOTIFICATION_FROM")?.trim();
      const recipient = env("INSTRUCTOR_NOTIFICATION_TO")?.trim();
      if (!url || !publicKey || !owner || !apiKey || !recipient || !validRecipient(recipient) || !sender || sender.length > 320 || /[\r\n]/.test(sender)) {
        return Response.json({ error: "Worker configuration incomplete" }, { status: 503 });
      }
      const credentials = { p_owner_id: owner, p_write_key: writer };
      async function rpc(name: string, parameters: object) {
        const response = await send(`${url}/rest/v1/rpc/${name}`, {
          method: "POST", headers: { apikey: publicKey!, "Content-Type": "application/json" },
          body: JSON.stringify({ ...credentials, ...parameters }), signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new Error("NotificationDatabaseFailed");
        return response.json();
      }
      let sent = 0;
      for (let i = 0; i < (questionId ? 1 : 2); i++) {
        const job = await rpc("claim_instructor_notification_for_recipient", { p_sender: sender, p_recipient: recipient, p_question_id: questionId ?? null }) as Job | null;
        if (!job) break;
        if (typeof job.recipient !== "string" || !validRecipient(job.recipient)) throw new Error("NotificationRecipientInvalid");
        let providerId: string | null = null;
        try {
          const response = await send("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `instructor-question/${job.question.id}` },
            body: JSON.stringify(emailBody(job)), signal: AbortSignal.timeout(4000),
          });
          if (!response.ok) throw new Error("NotificationProviderFailed");
          const receipt = await response.json();
          if (typeof receipt?.id !== "string" || !receipt.id.trim() || receipt.id.length > 100) throw new Error("NotificationReceiptMissing");
          providerId = receipt.id;
        } catch {
          console.error("Instructor email notification failed; queued for retry.");
        }
        if (!await rpc("finish_instructor_notification", { p_question_id: job.question.id, p_attempt_id: job.attemptId, p_provider_id: providerId })) {
          throw new Error("NotificationFinishFailed");
        }
        if (!providerId) return Response.json({ status: "retry_queued", sent }, { status: 202 });
        sent++;
      }
      return Response.json({ status: "complete", sent });
    } catch {
      // Never log payloads, signatures, API keys, or database/provider error bodies.
      console.error("Instructor email notification worker failed; saved questions remain available.");
      return Response.json({ error: "Notification processing deferred" }, { status: 503 });
    }
  };
}
