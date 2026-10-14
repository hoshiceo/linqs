"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import Logo from "./logo";

type Props = {
  ready: boolean;
  error: string;
  onLogin: (email: string, password: string) => Promise<void>;
};

export default function ClassLogin({ ready, error: initialError, onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy || !email.trim() || !password) return;
    setBusy(true); setError("");
    try { await onLogin(email, password); setPassword(""); }
    catch (e) { setError(e instanceof Error ? e.message : "ログインできませんでした。"); }
    finally { setBusy(false); }
  }

  return <main className="login-page">
    <div className="login-brand"><Logo /></div>
    <div className="login-card">
      <h1>クラスにログイン</h1>
      <p className="login-description">講師から案内された共通アカウントでログインしてください。</p>
      <form onSubmit={submit}>
        <label className="login-label" htmlFor="class-email">メールアドレス</label>
        <div className="login-input"><input id="class-email" type="email" autoComplete="username" placeholder="講師から案内されたメールアドレス" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} required disabled={busy} /></div>
        <label className="login-label" htmlFor="class-password">パスワード</label>
        <div className="login-input"><input id="class-password" type={visible ? "text" : "password"} autoComplete="current-password" placeholder="共通パスワード" value={password} onChange={e => setPassword(e.target.value)} maxLength={256} required disabled={busy} /><button type="button" className="icon-button" aria-label={visible ? "パスワードを隠す" : "パスワードを表示"} aria-pressed={visible} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
        {(error || initialError) && <div className="alert error" role="alert">{error || initialError}</div>}
        <button className="primary-button full-width login-submit" type="submit" disabled={!ready || busy || !email.trim() || !password}>{busy ? "ログインしています…" : "ログイン"}</button>
      </form>
      <p className="login-sharing">質問履歴はクラスで共有します。保存した質問は、このブラウザで管理します。</p>
      {!ready && <div className="privacy-note">共通アカウントの接続設定がまだ完了していません。設定完了後にログインできます。</div>}
      <p className="login-help">ログイン情報がわからないときは、講師にご確認ください。</p>
    </div>
  </main>;
}
