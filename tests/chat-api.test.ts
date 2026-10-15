import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(), embedContent: vi.fn(), rpc: vi.fn(), getUser: vi.fn(), from: vi.fn(),
}));
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent: mocks.generateContent, embedContent: mocks.embedContent }; } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: mocks.from }) }));
import * as vbaSearch from "../src/lib/vba-search";
import { POST } from "../src/app/api/chat/route";
import { GET as account } from "../src/app/api/account/route";
import { PATCH as sharedBookmark } from "../src/app/api/conversations/route";

const id = "33333333-3333-4333-8333-333333333333";
const ticket = "44444444-4444-4444-8444-444444444444";
const writerKey = "a".repeat(64);
function request(overrides = {}, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token", ...headers },
    body: JSON.stringify({ conversationId: null, message: "セルA1に文字を入力する方法を教えて", subject: "Excel VBA", mode: "hint", ...overrides }),
  });
}

describe("Chat API boundary", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "server-only-test-secret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
    vi.stubEnv("GEMINI_MODEL", "test-model");
    vi.stubEnv("CLASS_ACCOUNT_USER_ID", id);
    vi.stubEnv("SUPABASE_EXCHANGE_WRITE_KEY", writerKey);
    mocks.getUser.mockResolvedValue({ data: { user: { id, is_anonymous: false } }, error: null });
    mocks.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "reserve_question_exchange" ? ticket : name === "textbook_catalog" ? [] : id, error: null }));
    mocks.embedContent.mockResolvedValue({ embeddings: [{ values: Array(768).fill(0.1) }] });
    mocks.generateContent.mockResolvedValue({ text: "書き込むセルをRangeで指定する方法を考えてみましょう。" });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetAllMocks(); });

  it("allows the class account to authenticate before Gemini is configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const result = await account(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ displayName: "クラス共通" });
    expect((await POST(request())).status).toBe(503);
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("asks cached clients to reload instead of updating a shared bookmark", async () => {
    const response = await sharedBookmark(new Request("http://localhost/api/conversations", {
      method: "PATCH", headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" },
      body: JSON.stringify({ id, bookmarked: true }),
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("再読み込み");
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("does not enable login until all class account settings are present", async () => {
    vi.stubEnv("CLASS_ACCOUNT_USER_ID", "");
    expect((await account(request())).status).toBe(503);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("fails closed before quota or model calls when the server writer key is absent or invalid", async () => {
    for (const key of ["", "invalid"]) {
      vi.stubEnv("SUPABASE_EXCHANGE_WRITE_KEY", key);
      const result = await POST(request());
      expect(result.status).toBe(503);
      expect(await result.text()).not.toContain(writerKey);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
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
    expect((await POST(request({ mode: "invalid" }))).status).toBe(400);
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
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await POST(request())).status).toBe(429);
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });
  it("passes hint mode without a learning level, then persists only after successful generation", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ conversationId: id, saved: true });
    expect(result.answer).toContain("書き込むセルをRangeで指定する方法を考えてみましょう。");
    expect(result.answer).toContain("### 参照した公式資料");
    expect(result.answer).toContain("excel.range.value");
    expect(mocks.generateContent.mock.calls[0][0].config.tools).toBeUndefined();
    expect(mocks.generateContent.mock.calls[0][0].contents.at(-1).parts[1].text).toContain("Range.Value");
    expect(mocks.generateContent.mock.calls[0][0].config.systemInstruction).not.toContain("保存済みのMicrosoft VBA公式資料");
    expect(mocks.embedContent).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.find(call => call[0] === "save_question_exchange")?.[1].p_answer).toBe(result.answer);
    expect(mocks.generateContent.mock.calls[0][0].config.systemInstruction).not.toContain("学習経験");
    expect(mocks.generateContent.mock.calls[0][0].config.systemInstruction).toContain("Excel VBA");
    expect(mocks.generateContent.mock.calls[0][0].config.systemInstruction).toContain("ヒントモード");
    expect(mocks.rpc.mock.calls.at(-1)?.[0]).toBe("save_question_exchange");
    expect(mocks.rpc).toHaveBeenCalledWith("reserve_question_exchange", { p_write_key: writerKey });
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({ p_write_key: writerKey, p_ticket: ticket });
    expect(JSON.stringify(result)).not.toContain(writerKey);
    expect(JSON.stringify(mocks.generateContent.mock.calls)).not.toContain(writerKey);
  });
  it("ignores a retired learning level from cached clients without changing the model instruction", async () => {
    expect((await POST(request())).status).toBe(200);
    const instruction = mocks.generateContent.mock.calls[0][0].config.systemInstruction;
    expect((await POST(request({ level: "実務に応用" }))).status).toBe(200);
    expect(mocks.generateContent.mock.calls[1][0].config.systemInstruction).toBe(instruction);
  });
  it("answers without a subject selection and finds VBA sources from the question", async () => {
    const response = await POST(request({ subject: undefined }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.answer).toContain("excel.range.value");
    expect(mocks.generateContent.mock.calls[0][0].config.systemInstruction).toContain("質問に応じて判断");
    expect(mocks.generateContent.mock.calls[0][0].config.tools).toBeUndefined();
    expect(mocks.rpc.mock.calls.find(call => call[0] === "save_question_exchange")?.[1].p_subject).toBe("すべて");
  });
  it("does not retrieve VBA references for an AI prompt question", async () => {
    const result = await POST(request({ subject: undefined, message: "業務メールのプロンプトを教えて" }));
    expect(result.status).toBe(200);
    expect(mocks.generateContent.mock.calls[0][0].config.tools).toBeUndefined();
    expect((await result.json()).answer).not.toContain("参照した公式資料");
  });
  it("does not generate or save when the saved reference index cannot be loaded", async () => {
    vi.spyOn(vbaSearch, "retrieveVbaReferences").mockRejectedValueOnce(new (await import("../src/lib/server")).ApiError(503, "保存済みのVBA公式資料を検索できませんでした。"));
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect((await result.json()).error).toContain("公式資料を検索できませんでした");
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("answers an unknown VBA topic without pretending to retrieve an official source", async () => {
    const result = await POST(request({ message: "VBA UnknownZzzMethodを教えて" }));
    expect(result.status).toBe(200);
    expect(mocks.generateContent.mock.calls[0][0].contents.at(-1).parts[1].text).toContain("確認したと主張せず");
    expect((await result.json()).answer).not.toContain("### 参照した公式資料");
  });
  it("passes retrieved textbook excerpts to Gemini and persists their page citations", async () => {
    mocks.generateContent.mockResolvedValue({ text: "変数はDim文で宣言します。［教材1］" });
    mocks.rpc.mockImplementation((name: string) => Promise.resolve({ data:
      name === "reserve_question_exchange" ? ticket : name === "textbook_catalog" ? [{ filename: "Excel＿VBA.pdf", page_count: 52, source_format: "pdf" }] :
      name === "match_textbook_chunks" ? [{ id, filename: "Excel＿VBA.pdf", page: 21, content: "変数はDim文で宣言する。", extraction_method: "text", source_format: "pdf", similarity: 0.8 }] : id, error: null }));
    const result = await POST(request({ message: "VBAの変数を教えて" }));
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(mocks.embedContent).toHaveBeenCalledOnce();
    expect(mocks.generateContent.mock.calls[0][0].contents.at(-1).parts.at(-1).text).toContain("変数はDim文で宣言する。");
    expect(body.answer).toContain("### 参照した教科書");
    expect(body.answer).toContain("PDF p.21");
    expect(mocks.rpc.mock.calls.at(-1)?.[1].p_answer).toBe(body.answer);
  });
  it("saves the same cited-only, grouped textbook references that it returns", async () => {
    mocks.rpc.mockImplementation((name: string) => Promise.resolve({ data:
      name === "reserve_question_exchange" ? ticket : name === "textbook_catalog" ? [{ filename: "Excel＿VBA.pdf", page_count: 52, source_format: "pdf" }] :
      name === "match_textbook_chunks" ? [20, 21, 20].map((page, index) => ({ id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, filename: "Excel＿VBA.pdf", page, content: "セルはRangeで指定する。", extraction_method: "text", source_format: "pdf", similarity: 0.8 })) : id, error: null }));
    mocks.generateContent.mockResolvedValue({ text: "セルはRangeで指定します。［教材1］値はValueで設定します。［教材3］" });
    const result = await POST(request());
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.answer).toContain("- 教材1・教材3：Excel＿VBA.pdf — PDF p.20");
    expect(body.answer).not.toContain("PDF p.21");
    expect(mocks.rpc.mock.calls.at(-1)?.[1].p_answer).toBe(body.answer);
  });
  it("does not call Gemini or save a fake textbook answer when textbook lookup fails", async () => {
    mocks.rpc.mockImplementation((name: string) => Promise.resolve(name === "reserve_question_exchange" ? { data: ticket, error: null } : { data: null, error: new Error("lookup failed") }));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.embedContent).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.some(call => call[0] === "save_question_exchange")).toBe(false);
  });
  it("does not claim textbook access before any books have been imported", async () => {
    expect((await POST(request({ message: "VBAの教科書の内容を説明して" }))).status).toBe(503);
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.embedContent).not.toHaveBeenCalled();
  });
  it("preserves the generated answer while explicitly reporting failed persistence", async () => {
    mocks.rpc.mockImplementation((name: string) => Promise.resolve(name === "reserve_question_exchange" ? { data: ticket, error: null } : name === "textbook_catalog" ? { data: [], error: null } : { data: null, error: new Error("storage failure") }));
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
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("refuses unknown conversation IDs before using quota or calling the model", async () => {
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) });
    expect((await POST(request({ conversationId: id }))).status).toBe(404);
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
