import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// This is a one-time local command, never a public API endpoint.
const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const email = process.env.CLASS_ACCOUNT_EMAIL?.trim();
const password = process.env.CLASS_ACCOUNT_PASSWORD || randomBytes(24).toString("base64url") + "Aa7!";

if (!url || !secret || !email) {
  console.error("未作成です。.env.setup にSupabase URL、secret key、共通メールアドレスを設定してください。");
  process.exit(1);
}
if (!/^https:\/\//.test(url) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
  console.error("未作成です。HTTPSのSupabase URL、メールアドレス、12文字以上のパスワードを確認してください。");
  process.exit(1);
}

const directory = resolve(".local");
const filename = resolve(directory, "class-account.json");
const record = { status: "pending", email, password, createdAt: new Date().toISOString() };
await mkdir(directory, { recursive: true, mode: 0o700 });
try {
  // Preserve the password before the network mutation; never overwrite an earlier attempt.
  await writeFile(filename, JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
} catch {
  console.error("作成を中止しました。.local/class-account.json の既存情報を確認してください。既存アカウントやパスワードは変更しません。");
  process.exit(1);
}

try {
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "クラス共通" } });
  if (error || !data.user) throw new Error("AccountCreationUnconfirmed");
  await writeFile(filename, JSON.stringify({ ...record, status: "created", userId: data.user.id }, null, 2) + "\n", { mode: 0o600 });
  console.log("クラス共通アカウントを作成しました。ログイン情報は .local/class-account.json に保存しています。");
  console.log(`.env.local とNetlifyに設定: CLASS_ACCOUNT_USER_ID=${data.user.id}`);
} catch {
  console.error("作成完了を確認できませんでした。パスワードは .local/class-account.json に保存済みです。SupabaseのUsers一覧を確認してから対応してください。再実行で既存アカウントを変更しません。");
  process.exitCode = 1;
}
