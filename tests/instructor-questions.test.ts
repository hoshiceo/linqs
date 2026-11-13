import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(), list: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: mocks.from }) }));
import { GET, POST } from "../src/app/api/instructor-questions/route";
const id = "11111111-1111-4111-8111-111111111111";
function request(body = {}, authorization = "Bearer token") {
  return new Request("http://localhost/api/instructor-questions", { method: "POST", headers: { Authorization: authorization }, body: JSON.stringify({ conversationId: id, messageIndex: 1, contextHash: "a".repeat(64), question: "具体例を教えてください。", ...body }) });
}

describe("Instructor questions API", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");
    vi.stubEnv("CLASS_ACCOUNT_USER_ID", id);
    vi.stubEnv("SUPABASE_EXCHANGE_WRITE_KEY", "a".repeat(64));
    mocks.getUser.mockResolvedValue({ data: { user: { id, is_anonymous: false } }, error: null });
    mocks.rpc.mockResolvedValue({ data: { id, question: "具体例を教えてください。" }, error: null });
    const query = { select: () => query, order: () => query, limit: mocks.list };
    mocks.from.mockReturnValue(query);
    mocks.list.mockResolvedValue({ data: [], error: null });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

  it("requires a class session for reading and submitting", async () => {
    expect((await POST(request({}, ""))).status).toBe(401);
    expect((await GET(request({}, ""))).status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: { id: "other", is_anonymous: false } }, error: null });
    expect((await POST(request())).status).toBe(403);
    expect((await GET(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("validates size, source and malformed input before saving", async () => {
    for (const body of [{ question: " " }, { question: "あ".repeat(2001) }, { messageIndex: -1 }, { conversationId: "bad" }, { contextHash: "bad" }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect((await POST(request({ question: "a".repeat(17000) }))).status).toBe(413);
    expect((await POST(new Request("http://localhost/api", { method: "POST", headers: { Authorization: "Bearer token" }, body: "{" }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("saves through the server writer without trusting supplied answer or reply", async () => {
    const response = await POST(request({ question: "  具体例を教えてください。  ", ai_answer: "forged", reply: "forged" }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("submit_instructor_question", { p_conversation_id: id, p_message_index: 1, p_question: "具体例を教えてください。", p_context_hash: "a".repeat(64), p_write_key: "a".repeat(64) });
    expect(await response.text()).not.toContain("p_write_key");
  });
  it("reports missing sources, changed exchanges, quota and storage failures", async () => {
    for (const [error, status] of [[{ code: "P0002" }, 404], [{ code: "40001" }, 409], [{ message: "Instructor question limit" }, 429], [{ code: "42P01" }, 503]] as const) {
      mocks.rpc.mockResolvedValue({ data: null, error });
      expect((await POST(request())).status).toBe(status);
    }
    vi.stubEnv("SUPABASE_EXCHANGE_WRITE_KEY", "");
    mocks.rpc.mockClear();
    expect((await POST(request())).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("normalizes a composite row returned as a PostgREST array", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id, question: "受付した質問" }], error: null });
    expect(await (await POST(request())).json()).toEqual({ question: { id, question: "受付した質問" } });
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect((await POST(request())).status).toBe(503);
  });
  it("explains incomplete setup for missing tables and RPCs without exposing database errors", async () => {
    const message = "講師への質問は準備中です。管理者による受付先の設定が完了してからご利用ください。";
    for (const code of ["PGRST202", "PGRST205", "42P01", "42883"]) {
      const error = { code, message: "internal database details" };
      mocks.rpc.mockResolvedValue({ data: null, error });
      const submitted = await POST(request());
      expect(submitted.status).toBe(503);
      expect(await submitted.json()).toEqual({ error: message });
      mocks.list.mockResolvedValue({ data: null, error });
      const inbox = await GET(request());
      expect(inbox.status).toBe(503);
      expect(await inbox.json()).toEqual({ error: message });
    }
  });
  it("does not cache the shared inbox or hide a failed load as an empty inbox", async () => {
    const response = await GET(request());
    expect(await response.json()).toEqual({ questions: [] });
    expect(response.headers.get("cache-control")).toBe("no-store");
    mocks.list.mockResolvedValue({ data: null, error: {} });
    expect((await GET(request())).status).toBe(503);
  });
});
