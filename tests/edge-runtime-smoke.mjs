// Real Deno HTTP/runtime smoke check; provider/database calls are test-only mocks.
import { createNotificationHandler } from "../supabase/functions/instructor-notifications/handler.ts";

const writer = "a".repeat(64);
const id = "11111111-1111-4111-8111-111111111111";
const values = {
  LINQS_EXCHANGE_WRITE_KEY: writer, LINQS_CLASS_ACCOUNT_USER_ID: id,
  LINQS_SUPABASE_PUBLISHABLE_KEY: "test-public-key", SUPABASE_URL: "https://example.supabase.co",
  INSTRUCTOR_EMAIL_NOTIFICATIONS_ENABLED: "true", RESEND_API_KEY: "test-mail-key",
  INSTRUCTOR_NOTIFICATION_FROM: "Linqs <notifications@example.com>",
};
let mailCalls = 0;
let finished = false;
const mockedFetch = async (url, options) => {
  if (url.endsWith("claim_instructor_notification")) return Response.json({ attemptId: id, sender: values.INSTRUCTOR_NOTIFICATION_FROM,
    question: { id, question: "講師への質問テスト", original_question: "元の質問", ai_answer: "AIの回答", conversation_title: "テスト", course_id: null, created_at: "2026-11-13T00:00:00Z" } });
  if (url === "https://api.resend.com/emails") {
    const body = JSON.parse(options.body);
    if (body.to[0] !== "yamana@stargaz.design" || !body.text.includes("講師への質問テスト")) throw new Error("Unexpected email payload");
    mailCalls++;
    return Response.json({ id: "mock-provider-receipt" });
  }
  if (url.endsWith("finish_instructor_notification")) { finished = true; return Response.json(true); }
  throw new Error("Unexpected network destination");
};
const server = Deno.serve({ hostname: "127.0.0.1", port: 3000 }, createNotificationHandler(name => values[name], mockedFetch));
try {
  const url = "http://127.0.0.1:3000";
  const rejected = await fetch(url, { method: "POST", body: "{}" });
  if (rejected.status !== 401 || mailCalls) throw new Error("Unsigned request was accepted");
  const body = JSON.stringify({ questionId: id });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(writer), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`))), byte => byte.toString(16).padStart(2, "0")).join("");
  const response = await fetch(url, { method: "POST", body, headers: { "x-linqs-timestamp": timestamp, "x-linqs-signature": signature } });
  const result = await response.json();
  if (response.status !== 200 || result.sent !== 1 || mailCalls !== 1 || !finished) throw new Error("Notification did not complete");
  console.log("Deno HTTP smoke passed at localhost:3000: unsigned requests blocked; signed notification completed with mocked database and email.");
} finally { await server.shutdown(); }
