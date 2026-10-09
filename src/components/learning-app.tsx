"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Bookmark, Check, ChevronRight, CircleHelp, Copy, FileSpreadsheet, GraduationCap, History, Lightbulb, LogOut, Menu, MessageCircle, Plus, RefreshCw, Search, Send, Settings2, Sparkles, Trash2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { apiFetch, getSupabase, signInClassAccount, signOutClassAccount } from "@/lib/supabase-client";
import ClassLogin from "./class-login";
import { EXCEL_VBA_REFERENCE_URL } from "@/lib/vba-reference";
import { suggestions } from "@/lib/suggestions";
import { learningLevels, type AnswerMode, type AppConfig, type Conversation, type LearningLevel, type Message, type Subject } from "@/lib/types";

const icons = { "すべて": Sparkles, "AI活用": Sparkles, "Excel VBA": FileSpreadsheet };
const subjectClass = (subject: Subject) => subject === "Excel VBA" ? "subject-vba" : "subject-ai";
// Keep the preference key so existing learning settings are preserved.
const PREF_KEY = "yui.preferences.v1";
type View = "chat" | "history" | "bookmarks";

function Logo({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? "brand-small" : ""}`}><span className="brand-symbol"><Sparkles size={small ? 18 : 24} strokeWidth={1.7} /></span>{!small && <span>Linqs</span>}</span>;
}

function Markdown({ content }: { content: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a> }}>{content}</ReactMarkdown></div>;
}

export default function LearningApp() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<View>("chat");
  const [level, setLevel] = useState<LearningLevel>("はじめて");
  const [mode, setMode] = useState<AnswerMode>("explain");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [modal, setModal] = useState<"guide" | "settings" | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [classSignedIn, setClassSignedIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const active = conversations.find(c => c.id === activeId);
  const messages = active?.messages ?? [];

  useEffect(() => {
    let alive = true;
    async function initialize() {
      try {
        try {
          const preference = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
          if (learningLevels.includes(preference.level)) setLevel(preference.level);
          if (["explain", "hint"].includes(preference.mode)) setMode(preference.mode);
        } catch { /* Defaults remain usable when browser storage is unavailable. */ }
        const response = await fetch("/api/config", { cache: "no-store" });
        if (!response.ok) throw new Error("接続状態を確認できませんでした。ページを再読み込みしてください。");
        const settings: AppConfig = await response.json();
        if (!alive) return;
        setConfig(settings);
        if (settings.authReady) {
          const { data, error } = await getSupabase().auth.getSession();
          if (error) throw new Error("ログイン状態を確認できませんでした。");
          if (!data.session || data.session.user.is_anonymous) return;
          await apiFetch("/api/account");
          if (!alive) return;
          setClassSignedIn(true);
          const result = await apiFetch<{ conversations: Conversation[] }>("/api/conversations");
          if (alive) setConversations(result.conversations);
        } else {
          setLoginError("クラスアカウントの接続設定が途中です。管理者に設定をご確認ください。");
        }
      } catch (e) { if (alive) { const message = e instanceof Error ? e.message : "接続できませんでした。"; setError(message); setLoginError(message); } }
      finally { if (alive) setLoaded(true); }
    }
    void initialize();
    return () => { alive = false; };
  }, []);

  async function login(email: string, password: string) {
    await signInClassAccount(email, password);
    setLoginError(""); setError(""); setClassSignedIn(true);
    try {
      const result = await apiFetch<{ conversations: Conversation[] }>("/api/conversations");
      setConversations(result.conversations);
    } catch (e) { setError(e instanceof Error ? e.message : "履歴を取得できませんでした。"); }
  }

  async function logout() {
    if (busy) return;
    try {
      await signOutClassAccount();
      setClassSignedIn(false); setActiveId(null);
      setConversations([]);
      setInput(""); setView("chat"); setModal(null); setMobileOpen(false); setError(""); setWarning("");
    } catch (e) { setError(e instanceof Error ? e.message : "ログアウトできませんでした。"); }
  }

  async function refreshHistory() {
    if (busy || refreshing) return;
    setRefreshing(true);
    try {
      const result = await apiFetch<{ conversations: Conversation[] }>("/api/conversations");
      setConversations(result.conversations); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "履歴を更新できませんでした。"); }
    finally { setRefreshing(false); }
  }

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ level, mode }));
    } catch { setWarning("学習経験と回答スタイルをこの端末に保存できませんでした。"); }
  }, [level, mode, loaded]);

  useEffect(() => {
    const scrollArea = messagesRef.current;
    if (!scrollArea) return;
    const showLatest = messages.length > 0 || Boolean(pendingQuestion);
    scrollArea.scrollTo({ top: showLatest ? scrollArea.scrollHeight : 0, behavior: showLatest ? "smooth" : "auto" });
  }, [messages.length, pendingQuestion, busy, view, activeId]);

  useEffect(() => {
    if (modal || deleteId) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [modal, deleteId]);

  function newChat() {
    if (busy) return;
    setActiveId(null); setView("chat"); setInput(""); setError(""); setWarning(""); setMobileOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  function openConversation(c: Conversation) {
    if (busy) return;
    setActiveId(c.id); setView("chat"); setMobileOpen(false); setError(""); setWarning(""); setInput("");
  }

  function selectSuggestion(prompt: string) {
    setInput(prompt);
    inputRef.current?.focus({ preventScroll: true });
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const question = input.trim();
    if (!question || busy || !loaded || !classSignedIn || config?.mode !== "live" || active?.persisted === false) return;
    const previousId = activeId;
    const previousMessages = active?.messages ?? [];
    setBusy(true); setPendingQuestion(question); setInput(""); setError(""); setWarning(""); setView("chat");
    try {
      const result = await apiFetch<{ answer: string; conversationId: string | null; saved: boolean; warning?: string }>("/api/chat", {
        method: "POST", body: JSON.stringify({ conversationId: previousId, message: question, level, mode }),
      });
      const answer = result.answer;
      const id = result.conversationId || previousId || crypto.randomUUID();
      const saved = result.saved;
      if (result.warning) setWarning(result.warning);
      const now = new Date().toISOString();
      const exchange: Message[] = [{ id: crypto.randomUUID(), role: "user", content: question, created_at: now }, { id: crypto.randomUUID(), role: "assistant", content: answer, created_at: new Date(Date.now() + 1).toISOString() }];
      const conversation: Conversation = { id, title: active?.title || question.slice(0, 50), subject: "すべて", bookmarked: active?.bookmarked || false, created_at: active?.created_at || now, updated_at: now, messages: [...previousMessages, ...exchange], persisted: saved };
      setConversations(current => [conversation, ...current.filter(c => c.id !== previousId && c.id !== id)]);
      setActiveId(id);
      if (!saved) {
        // An unsaved new conversation must not be sent as a persisted server ID.
        setWarning("回答は表示できますが、この会話は保存されていません。次の質問は「新しい質問」から始めてください。");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "回答を取得できませんでした。"); setInput(question);
    } finally {
      setBusy(false); setPendingQuestion(null);
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    }
  }

  async function bookmark(c: Conversation) {
    const next = !c.bookmarked;
    try {
      if (c.persisted !== false) await apiFetch("/api/conversations", { method: "PATCH", body: JSON.stringify({ id: c.id, bookmarked: next }) });
      setConversations(current => current.map(item => item.id === c.id ? { ...item, bookmarked: next } : item));
    } catch (e) { setError(e instanceof Error ? e.message : "保存できませんでした。"); }
  }

  async function removeConversation() {
    if (!deleteId) return;
    try {
      if (conversations.find(c => c.id === deleteId)?.persisted !== false) await apiFetch(`/api/conversations?id=${deleteId}`, { method: "DELETE" });
      setConversations(current => current.filter(c => c.id !== deleteId));
      if (activeId === deleteId) { setActiveId(null); setView("chat"); }
      setDeleteId(null);
    } catch (e) { setDeleteId(null); setError(e instanceof Error ? e.message : "削除できませんでした。"); }
  }

  async function copyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content); setCopied(message.id);
      setTimeout(() => setCopied(null), 2000);
    } catch { setError("コピーできませんでした。回答の文字を選択してコピーしてください。"); }
  }

  const filtered = conversations.filter(c => (view !== "bookmarks" || c.bookmarked) && `${c.title} ${c.messages.map(m => m.content).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const nav = (target: View) => { if (!busy) { setView(target); setQuery(""); setMobileOpen(false); } };
  const hasChat = messages.length > 0 || busy;

  if (!loaded) return <main className="login-page"><div className="login-brand"><Logo /></div><p className="login-help">学習スペースを準備しています…</p></main>;
  if (!classSignedIn) return <ClassLogin ready={config?.authReady === true} error={loginError} onLogin={login} />;

  return <div className="app-shell">
    {mobileOpen && <button className="mobile-overlay" aria-label="メニューを閉じる" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`} aria-label="メインメニュー">
      <div className="sidebar-brand"><Logo /><span className="brand-caption">AI・VBAの学習パートナー</span><button className="icon-button mobile-close" aria-label="メニューを閉じる" onClick={() => setMobileOpen(false)}><X size={20} /></button></div>
      <button className="new-chat" onClick={newChat} disabled={busy}><Plus size={19} />新しい質問</button>
      <nav className="main-nav">
        <button className={view === "chat" ? "active" : ""} onClick={() => nav("chat")} disabled={busy}><MessageCircle size={19} />AIに質問<span className="nav-active-dot" /></button>
        <button className={view === "history" ? "active" : ""} onClick={() => nav("history")} disabled={busy}><History size={19} />質問の履歴{conversations.length > 0 && <span className="nav-count">{conversations.length}</span>}</button>
        <button className={view === "bookmarks" ? "active" : ""} onClick={() => nav("bookmarks")} disabled={busy}><Bookmark size={19} />保存した質問</button>
      </nav>
      <div className="recent-area"><div className="section-label">最近の質問<span>{conversations.length > 0 ? conversations.length : ""}</span></div>
        {conversations.length === 0 ? <p className="recent-empty">ここに質問が並びます。<br />授業の疑問を質問してください。</p> : conversations.slice(0, 5).map(c => <button className={`recent-item ${activeId === c.id && view === "chat" ? "selected" : ""}`} key={c.id} onClick={() => openConversation(c)} disabled={busy}><MessageCircle size={15} /><span>{c.title}</span></button>)}
      </div>
      <div className="sidebar-bottom">
        <button className="help-link" onClick={() => setModal("guide")}><CircleHelp size={17} />使い方・質問のコツ<ChevronRight size={15} /></button>
        <button className="profile" onClick={() => setModal("settings")}><span className="avatar"><GraduationCap size={23} /></span><span><strong>クラス共通</strong><small>{level}</small></span><Settings2 size={17} /></button>
      </div>
    </aside>

    <main className="main-panel">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="メニューを開く" onClick={() => setMobileOpen(true)}><Menu size={22} /></button><span className="desktop-crumb">学習スペース</span><ChevronRight className="desktop-crumb" size={14} /><strong>{view === "chat" ? "AIに質問" : view === "history" ? "質問の履歴" : "保存した質問"}</strong></div><div className="topbar-right"><span className="pace-label"><Sparkles size={14} />自分のペースで、少しずつ。</span><span className={`connection-badge ${config?.mode === "live" ? "live" : ""}`}>{!config ? "準備中" : config.mode === "live" ? "AI接続中" : "AI準備中"}</span></div></header>

      {view === "chat" ? <>
        {hasChat ? <div className="conversation-bar"><div><h1>{active?.title || "質問への回答"}</h1></div>{active && <button className={`icon-button ${active.bookmarked ? "is-saved" : ""}`} onClick={() => bookmark(active)} aria-label={active.bookmarked ? "保存を解除" : "この質問を保存"}><Bookmark size={19} fill={active.bookmarked ? "currentColor" : "none"} /></button>}</div> : null}
        <div className={`chat-scroll ${hasChat ? "has-messages" : ""}`} ref={messagesRef}>
          {!hasChat ? <div className="welcome">
            <div className="welcome-icon"><Sparkles size={30} strokeWidth={1.5} /></div>
            <div className="eyebrow">AI & VBA LEARNING</div>
            <h1>AIとVBAを、<br /><span>実務につなげる。</span></h1>
            <p className="welcome-description">授業の疑問から、業務に使うコードまで。<br className="mobile-only" />基礎から、ご自身のペースで。</p>
            <div className="suggestions-label"><span>ここから質問を始めましょう</span><span>質問の例</span></div>
            <div className="suggestion-grid">{suggestions.map((s, index) => { const Icon = icons[s.subject]; return <button className={`suggestion-card card-${index}`} key={s.title} onClick={() => selectSuggestion(s.prompt)}><span className={`subject-icon ${subjectClass(s.subject)}`}><Icon size={21} strokeWidth={1.7} /></span><span className="card-tag">{s.tag}</span><strong>{s.title}</strong><span className="card-bottom">この質問からはじめる<ArrowUpRight size={15} /></span></button>; })}</div>
            <button className="question-tip" onClick={() => setModal("guide")}><span className="tip-bulb"><Lightbulb size={20} /></span><span><strong>コードやエラー文も添えてください。</strong><small>やりたいこと・試したこと・実際の結果を伝えると、質問が具体的になります。</small></span><ChevronRight size={17} /></button>
          </div> : <div className="messages" aria-live="polite" aria-busy={busy}>
            {messages.map(message => <div className={`message message-${message.role}`} key={message.id}>
              {message.role === "assistant" && <div className="assistant-head"><Logo small /><strong>Linqs</strong><span>学習パートナー</span></div>}
              <div className="message-content">{message.role === "assistant" ? <Markdown content={message.content} /> : <p>{message.content}</p>}</div>
              {message.role === "assistant" && <div className="message-actions"><button onClick={() => copyMessage(message)}>{copied === message.id ? <Check size={14} /> : <Copy size={14} />}{copied === message.id ? "コピーしました" : "コピー"}</button><span>{new Date(message.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</span></div>}
            </div>)}
            {pendingQuestion && <div className="message message-user"><div className="message-content"><p>{pendingQuestion}</p></div></div>}
            {busy && <div className="message message-assistant"><div className="assistant-head"><Logo small /><strong>Linqs</strong></div><div className="thinking"><span /><span /><span /><p>質問の内容を確認しています</p></div></div>}
            {!busy && messages.length > 0 && <div className="followup-prompt"><Sparkles size={15} />疑問が残ったら、そのまま続けて質問できます。</div>}
          </div>}
        </div>
        <div className="composer-area">
          {config?.authReady && config.mode === "incomplete" && <div className="alert warning" role="status">AIの回答機能は準備中です。ログインと履歴の閲覧は利用できます。</div>}
          {error && <div className="alert error" role="alert"><CircleHelp size={17} /><span>{error}</span><button aria-label="通知を閉じる" onClick={() => setError("")}><X size={16} /></button></div>}
          {warning && <div className="alert warning" role="status"><CircleHelp size={17} /><span>{warning}</span><button aria-label="通知を閉じる" onClick={() => setWarning("")}><X size={16} /></button></div>}
          <form className="composer" onSubmit={send}>
            <textarea ref={inputRef} aria-label="質問を入力" placeholder={active?.persisted === false ? "この回答は未保存です。「新しい質問」から続けてください。" : "AIの使い方、VBAのコードやエラーなどを入力してください…"} value={input} maxLength={3000} disabled={busy || active?.persisted === false || config?.mode === "incomplete"} rows={2} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
            <div className="composer-toolbar"><div className="composer-controls"><div className="answer-modes" aria-label="回答の種類"><button type="button" className={mode === "explain" ? "selected" : ""} aria-pressed={mode === "explain"} onClick={() => setMode("explain")} disabled={busy}><Sparkles size={14} />解説</button><button type="button" className={mode === "hint" ? "selected" : ""} aria-pressed={mode === "hint"} onClick={() => setMode("hint")} disabled={busy}><Lightbulb size={14} />ヒント</button></div></div><div className="send-controls"><span className="enter-hint">{input.length > 2800 ? `${input.length}/3000` : "Enter で送信"}</span><button className="send-button" aria-label="質問を送信" type="submit" disabled={!input.trim() || busy || !loaded || !config || config.mode === "incomplete"}><Send size={18} /></button></div></div>
          </form>
          <div className="composer-footnote"><span>AIの回答には間違いが含まれることがあります。教材やテスト用のブックでも確認してください。</span><span className="powered"><Sparkles size={11} />{config?.mode === "live" ? "Powered by Gemini" : "AI準備中"}</span></div>
        </div>
      </> : <div className="library-view"><div className="library-heading"><div className="eyebrow">OUR CLASS LEARNING NOTES</div><h1>{view === "history" ? "質問の履歴" : "保存した質問"}</h1><p>{view === "history" ? "授業での疑問や解説を振り返れます。" : "もう一度読みたい解説をまとめて確認できます。"}</p><button className="secondary-button" onClick={refreshHistory} disabled={refreshing || busy}><RefreshCw size={15} />{refreshing ? "更新しています…" : "クラスの履歴を更新"}</button></div><label className="history-search"><Search size={18} /><input aria-label="質問を検索" placeholder="質問や回答から探す" value={query} onChange={e => setQuery(e.target.value)} /></label>
        {error && <div className="alert error" role="alert">{error}</div>}
        {filtered.length > 0 ? <div className="history-list">{filtered.map(c => <div className="history-card" key={c.id}><button className="history-open" onClick={() => openConversation(c)}><span className="subject-icon subject-ai"><MessageCircle size={22} /></span><span><strong>{c.title}</strong><small>{new Date(c.updated_at).toLocaleDateString("ja-JP", { month: "long", day: "numeric" })} <span>·</span> {Math.floor(c.messages.length / 2)}回の質問</small></span></button><button className={`icon-button ${c.bookmarked ? "is-saved" : ""}`} aria-label={c.bookmarked ? "保存を解除" : "この質問を保存"} onClick={() => bookmark(c)}><Bookmark size={18} fill={c.bookmarked ? "currentColor" : "none"} /></button><button className="icon-button delete-button" aria-label="この質問を削除" onClick={() => setDeleteId(c.id)}><Trash2 size={17} /></button></div>)}</div> : <div className="library-empty">{view === "history" ? <History size={36} strokeWidth={1.4} /> : <Bookmark size={36} strokeWidth={1.4} />}<h2>{query ? "一致する質問がありません" : view === "history" ? "まだ質問はありません" : "保存した質問はまだありません"}</h2><p>{query ? "別の言葉で検索してください。" : view === "history" ? "AI活用やExcel VBAの疑問から始めましょう。" : "回答のしおりマークを押すと、ここで読み返せます。"}</p>{!query && <button className="primary-button" onClick={newChat}><Plus size={17} />質問してみる</button>}</div>}
      </div>}
    </main>

    <dialog className="app-dialog" ref={dialogRef} onCancel={() => { setModal(null); setDeleteId(null); }} onClick={e => { if (e.target === e.currentTarget) { setModal(null); setDeleteId(null); } }}>
      <button className="dialog-close icon-button" aria-label="閉じる" onClick={() => { setModal(null); setDeleteId(null); }}><X size={20} /></button>
      {deleteId ? <><span className="dialog-symbol"><Trash2 size={24} /></span><h2>この質問を削除しますか？</h2><p>質問と回答がクラス全員の履歴から消えます。元に戻すことはできません。</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setDeleteId(null)}>キャンセル</button><button className="danger-button" onClick={removeConversation}>削除する</button></div></> : modal === "guide" ? <><span className="dialog-symbol"><Lightbulb size={25} /></span><div className="eyebrow">A LITTLE HELP</div><h2>質問を具体的に伝えるコツ</h2><p>授業の疑問や、実習で困った点をそのまま質問できます。</p><div className="guide-step"><span>01</span><div><h3>やりたいことを伝える</h3><p>「AIで業務メールの下書きを作る手順を教えて」</p></div></div><div className="guide-step"><span>02</span><div><h3>コード・エラー・環境を添える</h3><p>「Windows版Excelで実行時エラー1004が出ます」＋該当コードとエラー全文</p></div></div><div className="guide-step"><span>03</span><div><h3>自分で考えたいときは、ヒントを</h3><p>入力欄の「ヒント」に切り替えると、次の一歩を考えるための手がかりを示します。</p></div></div><div className="guide-step"><span>04</span><div><h3>公式資料で確認する</h3><p>AI接続時は、VBAの質問に関連する公式ページを参照し、取得できた資料のリンクを回答に表示します。<a href={EXCEL_VBA_REFERENCE_URL} target="_blank" rel="noopener noreferrer">Microsoft LearnのExcel VBAリファレンスを開く</a></p></div></div><div className="guide-step"><span>05</span><div><h3>教科書の質問には、教材名とページを</h3><p>登録された教科書から関連箇所を探して回答します。「VBAの教科書で、変数の宣言を説明して」のように伝えてください。参照ページはPDFの先頭から数えた番号です。</p></div></div><div className="privacy-note">氏名・顧客情報・社内機密・パスワードは入力せず、架空のデータに置き換えてください。質問は回答のためGeminiに送信され、Supabaseに保存されます。質問と保存した履歴はクラス全員で共有します。</div><button className="primary-button full-width" onClick={() => setModal(null)}>質問を始める</button></> : modal === "settings" ? <><span className="dialog-symbol"><GraduationCap size={26} /></span><div className="eyebrow">JUST FOR YOU</div><h2>学習経験に合わせた解説</h2><p>AI活用・Excel VBAの学習経験に合わせて、用語や説明の詳しさを調整します。</p><label className="settings-label">学習経験<select value={level} onChange={e => setLevel(e.target.value as LearningLevel)}>{learningLevels.map(g => <option key={g}>{g}</option>)}</select></label><div className="settings-label">回答のスタイル</div><div className="settings-modes"><button className={mode === "explain" ? "selected" : ""} onClick={() => setMode("explain")}><Sparkles size={20} /><strong>じっくり解説</strong><small>答えと考え方を知りたい</small></button><button className={mode === "hint" ? "selected" : ""} onClick={() => setMode("hint")}><Lightbulb size={20} /><strong>まずはヒント</strong><small>自分の力で考えたい</small></button></div><div className="privacy-note">クラスの履歴は共有されます。別端末の質問は、履歴画面の更新ボタンで確認できます。学習経験と回答スタイルはこの端末だけに保存されます。</div><button className="primary-button full-width" onClick={() => setModal(null)}>設定を完了</button><button className="logout-button" onClick={logout} disabled={busy}><LogOut size={16} />この端末からログアウト</button></> : null}
    </dialog>
  </div>;
}
