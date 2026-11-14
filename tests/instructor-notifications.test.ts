import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotificationHandler } from "../supabase/functions/instructor-notifications/handler";

const id = "11111111-1111-4111-8111-111111111111";
const writer = "a".repeat(64);
const job = {
  attemptId: "22222222-2222-4222-8222-222222222222", sender: "Linqs <notifications@example.com>", recipient: "teacher@example.com",
  question: { id, course_id: "website-production", conversation_title: "条件式を知りたい", original_question: "IF関数とは？", ai_answer: "<script>学生の内容</script>\nAIの回答", question: "具体例を教えて", created_at: "2026-11-13T00:00:00+00:00" },
};
let config: Record<string, string>;
let send: ReturnType<typeof vi.fn<typeof fetch>>;
let log: ReturnType<typeof vi.spyOn>;
function request(body = JSON.stringify({ questionId: id }), key = writer, timestamp = String(Math.floor(Date.now() / 1000))) {
  return new Request("https://example.supabase.co/functions/v1/instructor-notifications", {
    method: "POST", body,
    headers: { "x-linqs-timestamp": timestamp, "x-linqs-signature": createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex") },
  });
}
function handle(req = request()) { return createNotificationHandler(name => config[name], send)(req); }
function calls(name: string) { return send.mock.calls.filter(([url]) => String(url).endsWith(name)); }

describe("Supabase Edge Function instructor notifications", () => {
  beforeEach(() => {
    config = {
      LINQS_EXCHANGE_WRITE_KEY: writer, LINQS_CLASS_ACCOUNT_USER_ID: id,
      LINQS_SUPABASE_PUBLISHABLE_KEY: "test-public-key", SUPABASE_URL: "https://example.supabase.co",
      INSTRUCTOR_EMAIL_NOTIFICATIONS_ENABLED: "true", RESEND_API_KEY: "test-mail-key", INSTRUCTOR_NOTIFICATION_FROM: "new-sender@example.com", INSTRUCTOR_NOTIFICATION_TO: "teacher@example.com",
    };
    send = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (String(url).endsWith("claim_instructor_notification_for_recipient")) return Response.json(job);
      if (String(url).endsWith("finish_instructor_notification")) return Response.json(true);
      return Response.json({ id: "provider-receipt" });
    });
    log = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("rejects unsigned, forged, expired and future requests before any database or provider access", async () => {
    for (const req of [
      new Request("https://example.supabase.co", { method: "POST", body: "{}" }),
      request(undefined, "b".repeat(64)),
      request(undefined, writer, String(Math.floor(Date.now() / 1000) - 301)),
      request(undefined, writer, String(Math.floor(Date.now() / 1000) + 301)),
    ]) expect((await handle(req)).status).toBe(401);
    const altered = request();
    expect((await handle(new Request(altered, { body: "{}" }))).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects malformed, oversized, and non-POST requests", async () => {
    expect((await handle(new Request("https://example.supabase.co"))).status).toBe(405);
    expect((await handle(request("a".repeat(1025)))).status).toBe(413);
    for (const body of ["{", "null", "[]", '{"questionId":"bad"}']) expect((await handle(request(body))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it("sends saved plain-text content to the administrator-configured stored recipient with the same stable idempotency key", async () => {
    expect(await (await handle()).json()).toEqual({ status: "complete", sent: 1 });
    const claim = calls("claim_instructor_notification_for_recipient")[0][1]!;
    expect(JSON.parse(claim.body as string)).toEqual({ p_owner_id: id, p_write_key: writer, p_sender: "new-sender@example.com", p_recipient: "teacher@example.com", p_question_id: id });
    expect(claim.headers).toEqual({ apikey: "test-public-key", "Content-Type": "application/json" });
    expect(claim.signal).toBeInstanceOf(AbortSignal);
    const options = calls("/emails")[0][1]!;
    expect(options.headers).toEqual({ Authorization: "Bearer test-mail-key", "Content-Type": "application/json", "Idempotency-Key": `instructor-question/${id}` });
    const body = JSON.parse(options.body as string);
    expect(body).toMatchObject({ from: job.sender, to: [job.recipient], subject: "【Linqs】講師への質問が届きました" });
    for (const value of [job.question.question, job.question.original_question, job.question.ai_answer, job.question.conversation_title, id]) expect(body.text).toContain(value);
    expect(body.html).toBeUndefined();
    expect(JSON.parse(calls("finish_instructor_notification")[0][1]!.body as string)).toMatchObject({ p_provider_id: "provider-receipt", p_attempt_id: job.attemptId });
    expect(log).not.toHaveBeenCalled();
  });
  it("does not accept a client-supplied recipient, question or answer", async () => {
    await handle(request(JSON.stringify({ questionId: id, to: "attacker@example.com", question: "forged", ai_answer: "forged" })));
    const body = calls("/emails")[0][1]!.body as string;
    expect(body).not.toContain("attacker@example.com");
    expect(body).not.toContain("forged");
  });
  it("keeps the outbox untouched when disabled or configuration is missing", async () => {
    config.INSTRUCTOR_EMAIL_NOTIFICATIONS_ENABLED = "false";
    expect(await (await handle()).json()).toEqual({ status: "disabled" });
    config.INSTRUCTOR_EMAIL_NOTIFICATIONS_ENABLED = "true";
    config.RESEND_API_KEY = "";
    expect((await handle()).status).toBe(503);
    config.RESEND_API_KEY = "test-mail-key";
    config.INSTRUCTOR_NOTIFICATION_FROM = "sender@example.com\nBcc: other@example.com";
    expect((await handle()).status).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["", "invalid", "teacher@example.com,other@example.com", "Teacher <teacher@example.com>", "teacher@example.com\nBcc: outsider@example.com", "x".repeat(255) + "@example.com"])("does not claim or send jobs with invalid recipient configuration: %s", async value => {
    config.INSTRUCTOR_NOTIFICATION_TO = value;
    expect((await handle()).status).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });
  it("retains the stored recipient for retries even after administrator configuration changes", async () => {
    config.INSTRUCTOR_NOTIFICATION_TO = "new-teacher@example.com";
    await handle();
    expect(JSON.parse(calls("claim_instructor_notification_for_recipient")[0][1]!.body as string).p_recipient).toBe("new-teacher@example.com");
    expect(JSON.parse(calls("/emails")[0][1]!.body as string).to).toEqual(["teacher@example.com"]);
  });
  it("fails closed if the claim response lacks a valid pinned recipient", async () => {
    send.mockResolvedValueOnce(Response.json({ ...job, recipient: "" }));
    expect((await handle()).status).toBe(503);
    expect(calls("/emails")).toHaveLength(0);
  });
  it("does not send sent, leased or absent jobs", async () => {
    send.mockResolvedValue(Response.json(null));
    expect(await (await handle()).json()).toEqual({ status: "complete", sent: 0 });
    expect(calls("/emails")).toHaveLength(0);
  });
  it.each(["provider", "network", "timeout", "missing-receipt"])("releases %s failures for retry without exposing secrets or student content", async failure => {
    const normal = send.getMockImplementation()!;
    send.mockImplementation(async (url, options) => {
      if (!String(url).endsWith("/emails")) return normal(url, options);
      if (failure === "provider") return new Response("student content and provider secret", { status: 429 });
      if (failure === "network") throw new Error("test-mail-key student content");
      if (failure === "timeout") throw new DOMException("timed out", "TimeoutError");
      return Response.json({});
    });
    expect(await (await handle(request("{}"))).json()).toEqual({ status: "retry_queued", sent: 0 });
    expect(calls("/emails")).toHaveLength(1);
    expect(JSON.parse(calls("finish_instructor_notification")[0][1]!.body as string).p_provider_id).toBeNull();
    const logs = JSON.stringify(log.mock.calls);
    for (const secret of ["test-mail-key", writer, job.question.question, job.question.ai_answer, "student content"]) expect(logs).not.toContain(secret);
  });
  it("retains jobs after a claim or finalization failure", async () => {
    send.mockResolvedValueOnce(new Response("database secret", { status: 503 }));
    expect((await handle()).status).toBe(503);
    expect(calls("/emails")).toHaveLength(0);
    send.mockResolvedValueOnce(Response.json(job)).mockResolvedValueOnce(Response.json({ id: "receipt" })).mockResolvedValueOnce(new Response("database secret", { status: 503 }));
    expect((await handle()).status).toBe(503);
    expect(JSON.stringify(log.mock.calls)).not.toContain("database secret");
  });
  it("drains at most two jobs on a signed cron invocation", async () => {
    expect(await (await handle(request("{}"))).json()).toEqual({ status: "complete", sent: 2 });
    expect(calls("/emails")).toHaveLength(2);
    expect(calls("claim_instructor_notification_for_recipient")).toHaveLength(2);
  });
});
