import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let sessionPromise: Promise<string> | null = null;

export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("学習サービスの接続設定が必要です。");
  client ??= createClient(url, key);
  return client;
}

export async function getAccessToken(): Promise<string> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error("接続できませんでした。もう一度お試しください。");
    if (data.session && !data.session.user.is_anonymous) return data.session.access_token;
    throw new Error("クラス共通アカウントでログインしてください。");
  })();
  try { return await sessionPromise; }
  finally { sessionPromise = null; }
}

export async function signInClassAccount(email: string, password: string) {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.session) throw new Error("ログインできませんでした。メールアドレスとパスワードを確認してください。");
  try {
    await apiFetch("/api/account");
  } catch (error) {
    await getSupabase().auth.signOut({ scope: "local" });
    throw error;
  }
}

export async function signOutClassAccount() {
  const { error } = await getSupabase().auth.signOut({ scope: "local" });
  if (error) throw new Error("ログアウトできませんでした。もう一度お試しください。");
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "接続できませんでした。もう一度お試しください。");
  return result as T;
}
