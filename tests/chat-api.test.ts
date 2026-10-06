import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(), rpc: vi.fn(), getUser: vi.fn(), from: vi.fn(),
}));
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent: mocks.generateContent }; } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: mocks.from }) }));
import { EXCEL_VBA_REFERENCE_URL } from "../src/lib/vba-reference";
import { POST } from "../src/app/api/chat/route";
import { GET as account } from "../src/app/api/account/route";

const id = "33333333-3333-4333-8333-333333333333";
function request(overrides = {}, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token", ...headers },
    body: JSON.stringify({ conversationId: null, message: "セルA1に文字を入力する方法を教えて", subject: "Excel VBA", level: "はじめて", mode: "hint", ...overrides }),
  });
}

describe("Chat API boundary", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "server-only-test-secret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
    vi.stubEnv("GEMINI_MODEL", "test-model");
    vi.stubEnv("CLASS_ACCOUNT_USER_ID", id);
    mocks.getUser.mockResolvedValue({ data: { user: { id, is_anonymous: false } }, error: null });
    mocks.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "consume_question_quota" ? true : id, error: null }));
    mocks.generateContent.mockResolvedValue({ text: "書き込むセルをRangeで指定する方法を考えてみましょう。", candidates: [{ urlContextMetadata: { urlMetadata: [
      { retrievedUrl: EXCEL_VBA_REFERENCE_URL, urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" },
      { retrievedUrl: "https://learn.microsoft.com/ja-jp/office/vba/api/excel.range.value", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" },
    ] } }] });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

  it("allows the class account to authenticate before Gemini is configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const result = await account(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ displayName: "クラス共通" });
    expect((await POST(request())).status).toBe(503);
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not enable login until all class account settings are present", async () => {
    vi.stubEnv("CLASS_ACCOUNT_USER_ID", "");
    expect((await account(request())).status).toBe(503);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("refuses missing or invalid sessions before calling the model", async () => {
    const missing = await POST(request({}, { Authorization: "" }));
    expect(missing.status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("invalid token") });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });
  it("rejects oversized, empty and malformed questions without model cost", async () => {
    expect((await POST(request({ message: "x".repeat(3001) }))).status).toBe(400);
    expect((await POST(request({ message: "  " }))).status).toBe(400);
    expect((await POST(request({ level: "中学2年生" }))).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { Authorization: "Bearer valid-token" }, body: "{" }))).status).toBe(400);
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });
  it("denies anonymous users and other accounts even with a valid Supabase session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id, is_anonymous: true } }, error: null });
    expect((await POST(request())).status).toBe(403);
    mocks.getUser.mockResolvedValue({ data: { user: { id: "other-user", is_anonymous: false } }, error: null });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("bounds streamed payloads even when content-length is missing", async () => {
    const response = await POST(request({ message: "x".repeat(17000) }));
    expect(response.status).toBe(413);
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });
  it("stops before Gemini when the persistent quota is exhausted", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect((await POST(request())).status).toBe(429);
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });
  it("passes the learning level and hint mode, then persists only after successful generation", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ conversationId: id, saved: true });
    expect(result.answer).toContain("書き込むセルをRangeで指定する方法を考えてみましょう。");
    expect(result.answer).toContain("### 参照した公式資料");
    expect(result.answer).toContain("excel.range.value");
    expect(mocks.generateContent.mock.calls[0][0].config.tools).toEqual([{ urlContext: {} }]);
    expect(mocks.generateContent.mock.calls[0][0].contents.at(-1).parts[1].text).toContain(EXCEL_VBA_REFERENCE_URL);
    expect(mocks.rpc.mock.calls[1][1].p_answer).toBe(result.answer);
    expect(mocks.generateContent.mock.calls[0][0].config.systemInstruction).toContain("はじめて");
    expect(mocks.generateContent.mock.calls[0][0].config.systemInstruction).toContain("Excel VBA");
    expect(mocks.generateContent.mock.calls[0][0].config.systemInstruction).toContain("ヒントモード");
    expect(mocks.rpc.mock.calls[1][0]).toBe("save_question_exchange");
  });
  it("does not retrieve VBA references for an AI prompt question", async () => {
    const result = await POST(request({ subject: "AI活用", message: "業務メールのプロンプトを教えて" }));
    expect(result.status).toBe(200);
    expect(mocks.generateContent.mock.calls[0][0].config.tools).toBeUndefined();
    expect((await result.json()).answer).not.toContain("参照した公式資料");
  });
  it("refuses to save an answer when no selected official source was retrieved", async () => {
    mocks.generateContent.mockResolvedValue({ text: "公式資料を確認した回答です。", candidates: [{ urlContextMetadata: { urlMetadata: [
      { retrievedUrl: EXCEL_VBA_REFERENCE_URL, urlRetrievalStatus: "URL_RETRIEVAL_STATUS_ERROR" },
      { retrievedUrl: "https://other.example/doc", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" },
    ] } }] });
    const result = await POST(request());
    expect(result.status).toBe(502);
    expect((await result.json()).error).toContain("公式資料を取得できませんでした");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("preserves the generated answer while explicitly reporting failed persistence", async () => {
    mocks.rpc.mockImplementation((name: string) => Promise.resolve(name === "consume_question_quota" ? { data: true, error: null } : { data: null, error: new Error("storage failure") }));
    const response = await POST(request());
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.saved).toBe(false);
    expect(result.answer).toBeTruthy();
    expect(result.warning).toContain("保存できませんでした");
  });
  it("does not persist or disclose provider payloads when Gemini fails", async () => {
    mocks.generateContent.mockRejectedValue(new Error("provider error with secret server-only-test-secret"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("server-only-test-secret");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("refuses unknown conversation IDs before using quota or calling the model", async () => {
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) });
    expect((await POST(request({ conversationId: id }))).status).toBe(404);
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
