import { createClient } from "@supabase/supabase-js";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function readJson(request: Request): Promise<unknown> {
  if (!request.body) throw new ApiError(400, "送信内容を確認してください。");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16000) {
        await reader.cancel();
        throw new ApiError(413, "質問は3,000文字以内で入力してください。");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "送信内容の形式を確認してください。");
  } finally { reader.releaseLock(); }
}

export function getConfig() {
  const values = [process.env.GEMINI_API_KEY, process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, process.env.CLASS_ACCOUNT_USER_ID];
  const authReady = values.slice(1).every(Boolean);
  const writerReady = /^[a-f0-9]{64}$/.test(process.env.SUPABASE_EXCHANGE_WRITE_KEY ?? "");
  return { mode: values.every(Boolean) && writerReady ? "live" : "incomplete", authReady } as const;
}

export function exchangeWriteKey() {
  const key = process.env.SUPABASE_EXCHANGE_WRITE_KEY;
  if (!key || !/^[a-f0-9]{64}$/.test(key)) throw new ApiError(503, "回答の保存設定を準備中です。管理者に設定をご確認ください。");
  return key;
}

export async function authenticate(request: Request) {
  if (!getConfig().authReady) throw new ApiError(503, "クラスアカウントとの接続準備中です。管理者に設定をご確認ください。");
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new ApiError(401, "学習セッションが必要です。");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(authorization.slice(7));
  if (error || !data.user) throw new ApiError(401, "学習セッションを確認できませんでした。ページを再読み込みしてください。");
  if (data.user.is_anonymous || data.user.id !== process.env.CLASS_ACCOUNT_USER_ID) {
    throw new ApiError(403, "このクラスの共通アカウントでログインしてください。");
  }
  return { supabase, user: data.user };
}

export function apiError(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  // Avoid logging student questions, tokens, or provider error payloads.
  console.error("Linqs API request failed:", error instanceof Error ? error.name : "UnknownError");
  return Response.json({ error: "回答を取得できませんでした。少し時間をおいて、もう一度お試しください。" }, { status: 500 });
}
