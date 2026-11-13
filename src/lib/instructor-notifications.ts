import { createClient } from "@supabase/supabase-js";
import type { InstructorQuestion } from "./instructor-questions";

const recipient = "yamana@stargaz.design";
type NotificationJob = {
  attemptId: string;
  sender: string;
  question: Pick<InstructorQuestion, "id" | "course_id" | "conversation_title" | "original_question" | "ai_answer" | "question" | "created_at">;
};

function notificationConfig() {
  // Never send real mail from next dev, even if .env.local holds production keys.
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test" || process.env.INSTRUCTOR_EMAIL_NOTIFICATIONS_ENABLED !== "true") return null;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const sender = process.env.INSTRUCTOR_NOTIFICATION_FROM?.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const ownerId = process.env.CLASS_ACCOUNT_USER_ID;
  const writeKey = process.env.SUPABASE_EXCHANGE_WRITE_KEY;
  if (!apiKey || !sender || /[\r\n]/.test(sender) || !url || !publishableKey || !ownerId || !/^[a-f0-9]{64}$/.test(writeKey ?? "")) {
    console.error("Instructor email notification configuration is incomplete.");
    return null;
  }
  return { apiKey, sender, url, publishableKey, ownerId, writeKey: writeKey! };
}

function emailBody(job: NotificationJob) {
  const q = job.question;
  // Plain text keeps student content inert. Use only immutable saved fields, so
  // retries have identical bodies even after a reply is added or a chat is deleted.
  return {
    from: job.sender,
    to: [recipient],
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

// One job for an interactive request; a small batch for the scheduled retry worker.
// Every error stays separate from the already committed student submission.
export async function sendInstructorNotifications(questionId?: string, limit = 1) {
  try {
    const config = notificationConfig();
    if (!config) return;
    const supabase = createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { retry: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(3000) }) },
    });
    const credentials = { p_owner_id: config.ownerId, p_write_key: config.writeKey };
    for (let i = 0; i < Math.min(limit, 2); i++) {
      const { data, error } = await supabase.rpc("claim_instructor_notification", {
        ...credentials, p_sender: config.sender, p_question_id: questionId ?? null,
      });
      if (error) throw new Error("NotificationClaimFailed");
      if (!data) return;
      const job = data as NotificationJob;
      let providerId: string | null = null;
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `instructor-question/${job.question.id}` },
          body: JSON.stringify(emailBody(job)),
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) throw new Error("NotificationProviderFailed");
        const receipt = await response.json();
        if (typeof receipt?.id !== "string" || !receipt.id.trim() || receipt.id.length > 100) throw new Error("NotificationReceiptMissing");
        providerId = receipt.id;
      } catch {
        // Do not log the provider response, student text, recipient or credentials.
        console.error("Instructor email notification failed; queued for retry.");
      }
      const { data: finished, error: finishError } = await supabase.rpc("finish_instructor_notification", {
        ...credentials, p_question_id: job.question.id, p_attempt_id: job.attemptId, p_provider_id: providerId,
      });
      if (finishError || !finished) throw new Error("NotificationFinishFailed");
      // Stop a batch on an outage or throttling instead of flooding the provider.
      if (!providerId) return;
    }
  } catch {
    console.error("Instructor email notification worker failed; saved questions remain available.");
  }
}
