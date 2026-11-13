import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import { sendInstructorNotifications } from "../src/lib/instructor-notifications";
import runScheduled, { config as schedule } from "../netlify/functions/instructor-notifications.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const writer = "a".repeat(64);
const job = {
  attemptId: "22222222-2222-4222-8222-222222222222", sender: "Linqs <notifications@example.com>",
  question: { id, course_id: "website-production", conversation_title: "条件式を知りたい", original_question: "IF関数とは？", ai_answer: "<script>学生の内容</script>\nAIの回答", question: "具体例を教えて", created_at: "2026-11-13T00:00:00+00:00" },
};
let send: ReturnType<typeof vi.fn>;
let log: ReturnType<typeof vi.spyOn>;

describe("Instructor email notification delivery", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INSTRUCTOR_EMAIL_NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("RESEND_API_KEY", "test-mail-key");
    vi.stubEnv("INSTRUCTOR_NOTIFICATION_FROM", "new-sender@example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-public-key");
    vi.stubEnv("CLASS_ACCOUNT_USER_ID", id);
    vi.stubEnv("SUPABASE_EXCHANGE_WRITE_KEY", writer);
    mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockImplementation(async name => ({ data: name === "claim_instructor_notification" ? job : true, error: null }));
    send = vi.fn().mockResolvedValue(Response.json({ id: "provider-receipt" }));
    vi.stubGlobal("fetch", send);
    log = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetAllMocks(); });

  it("sends only saved content as plain text to the fixed recipient with a stable idempotency key", async () => {
    await sendInstructorNotifications(id);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "claim_instructor_notification", { p_owner_id: id, p_write_key: writer, p_sender: "new-sender@example.com", p_question_id: id });
    expect(send).toHaveBeenCalledOnce();
    const [url, options] = send.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.headers).toEqual({ Authorization: "Bearer test-mail-key", "Content-Type": "application/json", "Idempotency-Key": `instructor-question/${id}` });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ from: job.sender, to: ["yamana@stargaz.design"], subject: "【Linqs】講師への質問が届きました" });
    for (const value of [job.question.question, job.question.original_question, job.question.ai_answer, job.question.conversation_title, id]) expect(body.text).toContain(value);
    expect(body.html).toBeUndefined();
    expect(mocks.rpc).toHaveBeenLastCalledWith("finish_instructor_notification", { p_owner_id: id, p_write_key: writer, p_question_id: id, p_attempt_id: job.attemptId, p_provider_id: "provider-receipt" });
    expect(log).not.toHaveBeenCalled();
  });
  it("does not send when disabled, misconfigured, or running next dev", async () => {
    vi.stubEnv("INSTRUCTOR_EMAIL_NOTIFICATIONS_ENABLED", "false");
    await sendInstructorNotifications(id);
    vi.stubEnv("INSTRUCTOR_EMAIL_NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
    await sendInstructorNotifications(id);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    await sendInstructorNotifications(id);
    vi.stubEnv("RESEND_API_KEY", "test-mail-key");
    vi.stubEnv("INSTRUCTOR_NOTIFICATION_FROM", "sender@example.com\nBcc: other@example.com");
    await sendInstructorNotifications(id);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("skips sent, leased or absent jobs without sending", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await sendInstructorNotifications(id);
    expect(send).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it.each(["provider", "network", "timeout", "missing-receipt"])("releases failed %s deliveries for retry without exposing content or failing the submission", async failure => {
    if (failure === "provider") send.mockResolvedValue(new Response("student content and provider secret", { status: 429 }));
    if (failure === "network") send.mockRejectedValue(new Error("test-mail-key student content"));
    if (failure === "timeout") send.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    if (failure === "missing-receipt") send.mockResolvedValue(Response.json({}));
    await expect(sendInstructorNotifications(undefined, 3)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenLastCalledWith("finish_instructor_notification", expect.objectContaining({ p_provider_id: null }));
    const logs = JSON.stringify(log.mock.calls);
    for (const secret of ["test-mail-key", writer, job.question.question, job.question.ai_answer, "student content"]) expect(logs).not.toContain(secret);
  });
  it("retains jobs after a claim or finalization failure without rejecting the saved question", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "database secret" } });
    await expect(sendInstructorNotifications(id)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: job, error: null }).mockResolvedValueOnce({ data: null, error: { message: "database secret" } });
    await expect(sendInstructorNotifications(id)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain("database secret");
  });
  it("uses bounded database requests and does not need an admin credential", async () => {
    await sendInstructorNotifications(id);
    const options = mocks.createClient.mock.calls[0][2];
    expect(mocks.createClient.mock.calls[0][1]).toBe("test-public-key");
    expect(options.auth).toEqual({ persistSession: false, autoRefreshToken: false });
    expect(options.db.retry).toBe(false);
    await options.global.fetch("https://example.supabase.co/rest/v1", { method: "POST" });
    expect(send).toHaveBeenLastCalledWith("https://example.supabase.co/rest/v1", expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }));
  });
  it("drains at most two jobs every five minutes with the same delivery path", async () => {
    expect(schedule.schedule).toBe("*/5 * * * *");
    // Netlify's standalone functions need not set NODE_ENV at runtime.
    vi.stubEnv("NODE_ENV", undefined);
    send.mockImplementation(async () => Response.json({ id: "provider-receipt" }));
    await runScheduled();
    expect(send).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "claim_instructor_notification")).toHaveLength(2);
  });
});
