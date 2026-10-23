"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, Bookmark, Check, ChevronRight, CircleHelp, Copy, GraduationCap, History, Hand, Lightbulb, LogOut, Menu, Mic, MicOff, MessageCircle, Plus, RefreshCw, Search, Send, Settings2, Sparkles, Trash2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { apiFetch, getSupabase, signInClassAccount, signOutClassAccount } from "@/lib/supabase-client";
import ClassLogin from "./class-login";
import { AskInstructor, InstructorQuestions } from "./instructor-questions";
import { safeAnswerHref } from "@/lib/answer-links";
import Logo from "./logo";
import { EXCEL_VBA_REFERENCE_URL } from "@/lib/vba-reference";
import { suggestions } from "@/lib/suggestions";
import { courses, getCourse, type CourseId } from "@/lib/courses";
import type { AnswerMode, AppConfig, Conversation, Message } from "@/lib/types";
import { DEVICE_BOOKMARKS_KEY, loadDeviceBookmarks, removeDeviceBookmark, toggleDeviceBookmark } from "@/lib/device-bookmarks";
import { useVoiceInput } from "@/hooks/use-voice-input";

// Keep the preference key so the existing answer style is preserved.
const PREF_KEY = "yui.preferences.v1";
const CONNECTION_TIMEOUT_MS = 15000;
const INITIAL_RECENT_COUNT = 15;
const RECENT_STEP = 10;
type View = "chat" | "history" | "bookmarks" | "instructor";

function Markdown({ content }: { content: string }) {
  return <div className="markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false, maxSize: 32, maxExpand: 1000 }]]} components={{ img: ({ alt }) => <span>{alt}</span>, a: ({ children, href }) => { const safeHref = safeAnswerHref(href); return safeHref ? <a href={safeHref} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>; } }}>{content}</ReactMarkdown></div>;
}

export default function LearningApp() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [bookmarkIds, setBookmarkIds] = useState<string[]>([]);
  const [bookmarksReady, setBookmarksReady] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<View>("chat");
  const [courseId, setCourseId] = useState<CourseId | null>(null);
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
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [answerJump, setAnswerJump] = useState<"start" | "end" | null>(null);
  const [recentLimit, setRecentLimit] = useState(INITIAL_RECENT_COUNT);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historySearchRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const latestAnswerRef = useRef<HTMLDivElement>(null);
  const pendingQuestionRef = useRef<HTMLDivElement>(null);
  const readingEarlierRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const historyChangesRef = useRef(new Map<string, Conversation | null>());
  const voice = useVoiceInput({
    lang: "ja-JP",
    onTranscript: (text) => {
      setInput((prev) => {
        if (!prev) return text;
        const lastChar = prev.slice(-1);
        // Add a space only between ASCII word characters
        const needsSpace = /[A-Za-z0-9]/.test(lastChar) && /^[A-Za-z0-9]/.test(text);
        return prev + (needsSpace ? " " : "") + text;
      });
    },
    onError: (err) => {
      setError(err);
    },
  });
  const active = conversations.find(c => c.id === activeId);
  const messages = active?.messages ?? [];
  const selectedCourse = courses.find(course => course.id === courseId);
  const questionExamples = selectedCourse?.suggestions ?? suggestions;
  const savedIds = new Set(bookmarkIds);

  function applyHistory(history: Conversation[]) {
    setConversations(history);
    setRecentLimit(INITIAL_RECENT_COUNT);
    try {
      setBookmarkIds(loadDeviceBookmarks(localStorage, history.filter(c => c.bookmarked).map(c => c.id)));
      setBookmarksReady(true);
    } catch {
      setBookmarksReady(false);
      setWarning("このブラウザの保存した質問を読み込めませんでした。ブラウザの保存設定をご確認ください。");
    }
  }

  function handleRecentScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) {
      setRecentLimit(prev => (prev < conversations.length ? prev + RECENT_STEP : prev));
    }
  }

  useEffect(() => {
    let alive = true;
    async function initialize() {
      try {
        try {
          const preference = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
          if (["explain", "hint"].includes(preference.mode)) setMode(preference.mode);
        } catch { /* Defaults remain usable when browser storage is unavailable. */ }
        const response = await fetch("/api/config", { cache: "no-store", signal: AbortSignal.timeout(CONNECTION_TIMEOUT_MS) });
        if (!response.ok) throw new Error("接続状態を確認できませんでした。ページを再読み込みしてください。");
        const settings: AppConfig = await response.json();
        if (!alive) return;
        setConfig(settings);
        if (settings.authReady) {
          const { data, error } = await getSupabase().auth.getSession();
          if (error) throw new Error("ログイン状態を確認できませんでした。");
          if (!data.session || data.session.user.is_anonymous) return;
          await apiFetch("/api/account", { signal: AbortSignal.timeout(CONNECTION_TIMEOUT_MS) });
          if (!alive) return;
          setClassSignedIn(true);
        } else {
          setLoginError("クラスアカウントの接続設定が途中です。管理者に設定をご確認ください。");
        }
      } catch (e) {
        if (alive) {
          const message = e instanceof Error && e.name === "TimeoutError"
            ? "接続の確認に時間がかかっています。ページを再読み込みしてください。"
            : e instanceof Error ? e.message : "接続できませんでした。";
          setError(message); setLoginError(message);
        }
      }
      finally { if (alive) setLoaded(true); }
    }
    void initialize();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!classSignedIn) return;
    let alive = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
    // Preserve questions answered or deleted while this snapshot is in flight.
    const changes = new Map<string, Conversation | null>();
    historyChangesRef.current = changes;
    setRefreshing(true);
    async function loadHistory() {
      try {
        const result = await apiFetch<{ conversations: Conversation[] }>("/api/conversations", { signal: controller.signal });
        if (!alive) return;
        const history = new Map(result.conversations.map(c => [c.id, c]));
        for (const [id, conversation] of changes) {
          if (conversation) history.set(id, conversation);
          else history.delete(id);
        }
        applyHistory([...history.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
      } catch {
        if (alive) setError("履歴を読み込めませんでした。「質問の履歴」から再度更新してください。");
      } finally {
        clearTimeout(timeout);
        if (alive) setRefreshing(false);
      }
    }
    void loadHistory();
    return () => { alive = false; clearTimeout(timeout); controller.abort(); };
  }, [classSignedIn, historyRefresh]);

  async function login(email: string, password: string) {
    await signInClassAccount(email, password);
    setLoginError(""); setError(""); setClassSignedIn(true);
  }

  async function logout() {
    if (busy) return;
    try {
      await signOutClassAccount();
      setClassSignedIn(false); setActiveId(null); setCourseId(null);
      setConversations([]);
      setRefreshing(false); setBookmarksReady(false);
      setInput(""); setView("chat"); setModal(null); setMobileOpen(false); setError(""); setWarning("");
    } catch (e) { setError(e instanceof Error ? e.message : "ログアウトできませんでした。"); }
  }

  function refreshHistory() {
    if (busy || refreshing) return;
    setRefreshing(true);
    setError("");
    setHistoryRefresh(current => current + 1);
  }

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ mode }));
    } catch { setWarning("回答スタイルをこの端末に保存できませんでした。"); }
  }, [mode, loaded]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== DEVICE_BOOKMARKS_KEY && event.key !== null)) return;
      try { setBookmarkIds(loadDeviceBookmarks(localStorage)); setBookmarksReady(true); }
      catch { setBookmarksReady(false); setWarning("このブラウザの保存した質問を読み込めませんでした。"); }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  useEffect(() => {
    const scrollArea = messagesRef.current;
    if (!scrollArea) return;
    const updateJump = () => {
      const answer = latestAnswerRef.current;
      const actions = answer?.querySelector(".message-actions");
      const bounds = scrollArea.getBoundingClientRect();
      setAnswerJump(answer && actions
        ? answer.getBoundingClientRect().top > bounds.top + 64 ? "start"
          : actions.getBoundingClientRect().bottom > bounds.bottom + 16 ? "end" : null
        : null);
    };
    const resize = new ResizeObserver(() => {
      scrollArea.style.setProperty("--chat-height", `${scrollArea.clientHeight}px`);
      updateJump();
    });
    scrollArea.style.setProperty("--chat-height", `${scrollArea.clientHeight}px`);
    resize.observe(scrollArea);
    scrollArea.addEventListener("scroll", updateJump, { passive: true });
    const target = pendingQuestion ? pendingQuestionRef.current : latestAnswerRef.current;
    // Do not move a reader who scrolled back while the answer was being prepared.
    if (!readingEarlierRef.current || pendingQuestion) {
      scrollArea.scrollTo({ top: target ? Math.max(0, target.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top + scrollArea.scrollTop - 24) : 0, behavior: "auto" });
    }
    updateJump();
    return () => { resize.disconnect(); scrollArea.removeEventListener("scroll", updateJump); };
  }, [messages.length, pendingQuestion, view, activeId, classSignedIn]);

  useEffect(() => {
    if (modal || deleteId) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [modal, deleteId]);

  function newChat() {
    if (busy) return;
    voice.cancel();
    setCourseId(null);
    readingEarlierRef.current = false;
    setActiveId(null); setView("chat"); setInput(""); setError(""); setWarning(""); setMobileOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  function openCourse(id: CourseId) {
    if (busy) return;
    newChat();
    setCourseId(id);
  }

  function openConversation(c: Conversation) {
    if (busy) return;
    voice.cancel();
    setCourseId(getCourse(c.course_id)?.id ?? null);
    readingEarlierRef.current = false;
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
    readingEarlierRef.current = false;
    voice.cancel();
    setBusy(true); setPendingQuestion(question); setInput(""); setError(""); setWarning(""); setView("chat");
    try {
      const result = await apiFetch<{ answer: string; conversationId: string | null; saved: boolean; courseId: CourseId | null; warning?: string }>("/api/chat", {
        method: "POST", body: JSON.stringify({ conversationId: previousId, message: question, mode, courseId }),
      });
      const answer = result.answer;
      const id = result.conversationId || previousId || crypto.randomUUID();
      const saved = result.saved;
      if (result.warning) setWarning(result.warning);
      const now = new Date().toISOString();
      const exchange: Message[] = [{ id: crypto.randomUUID(), role: "user", content: question, created_at: now }, { id: crypto.randomUUID(), role: "assistant", content: answer, created_at: new Date(Date.now() + 1).toISOString() }];
      const conversation: Conversation = { id, title: active?.title || question.slice(0, 50), subject: "すべて", course_id: result.courseId ?? courseId, bookmarked: active?.bookmarked || false, created_at: active?.created_at || now, updated_at: now, messages: [...previousMessages, ...exchange], persisted: saved };
      historyChangesRef.current.set(id, conversation);
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

  function jumpToAnswer() {
    const scrollArea = messagesRef.current;
    const answer = latestAnswerRef.current;
    if (!scrollArea || !answer) return;
    const top = answerJump === "end" ? scrollArea.scrollHeight : answer.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top + scrollArea.scrollTop - 24;
    scrollArea.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function bookmark(c: Conversation) {
    if (!bookmarksReady) return;
    try {
      setBookmarkIds(toggleDeviceBookmark(localStorage, c.id));
    } catch { setError("このブラウザに保存できませんでした。ブラウザの保存設定をご確認ください。"); }
  }

  async function removeConversation() {
    if (!deleteId) return;
    try {
      if (conversations.find(c => c.id === deleteId)?.persisted !== false) await apiFetch(`/api/conversations?id=${deleteId}`, { method: "DELETE" });
      historyChangesRef.current.set(deleteId, null);
      setConversations(current => current.filter(c => c.id !== deleteId));
      try { setBookmarkIds(removeDeviceBookmark(localStorage, deleteId)); }
      catch { setWarning("質問は削除しましたが、このブラウザの保存マークを更新できませんでした。"); }
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

  const filtered = conversations.filter(c => (view !== "bookmarks" || savedIds.has(c.id)) && `${c.title} ${c.messages.map(m => m.content).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const nav = (target: View) => { if (!busy) { readingEarlierRef.current = false; setView(target); setQuery(""); setMobileOpen(false); } };
  const hasChat = messages.length > 0 || busy;

  if (!loaded) return <main className="login-page"><div className="login-brand"><Logo /></div><p className="login-help">学習スペースを準備しています…</p></main>;
  if (!classSignedIn) return <ClassLogin ready={config?.authReady === true} error={loginError} onLogin={login} />;

  return <div className="app-shell">
    {mobileOpen && <button className="mobile-overlay" aria-label="メニューを閉じる" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`} aria-label="メインメニュー">
      <div className="sidebar-brand"><button type="button" className="logo-home" aria-label="Linqs ホームに戻る" onClick={newChat} disabled={busy}><Logo /></button><button className="icon-button mobile-close" aria-label="メニューを閉じる" onClick={() => setMobileOpen(false)}><X size={20} /></button></div>
      <div className="sidebar-actions">
        <button type="button" className="new-chat" onClick={newChat} disabled={busy}><Plus size={16} strokeWidth={2} aria-hidden="true" /><span>新しい質問</span></button>
        <button type="button" className="icon-button sidebar-search" aria-label="質問を検索" title="質問を検索" disabled={busy} onClick={() => { nav("history"); requestAnimationFrame(() => historySearchRef.current?.focus()); }}><Search size={19} aria-hidden="true" /></button>
      </div>
      <nav className="main-nav" aria-label="質問メニュー">
        <button className={view === "instructor" ? "active" : ""} onClick={() => nav("instructor")} disabled={busy}><Hand size={19} />講師への質問</button>
        <button className={view === "bookmarks" ? "active" : ""} onClick={() => nav("bookmarks")} disabled={busy}><Bookmark size={19} />保存した質問</button>
      </nav>
      <div className="sidebar-content" onScroll={handleRecentScroll}>
      <nav className="course-nav" aria-labelledby="course-nav-heading">
        <h2 id="course-nav-heading" className="section-label">受講中のコース</h2>
        {courses.map(course => <button type="button" key={course.id} className={`course-item${view === "chat" && courseId === course.id ? " selected" : ""}`} aria-current={view === "chat" && courseId === course.id ? "page" : undefined} onClick={() => openCourse(course.id)} disabled={busy}><span>{course.name}</span></button>)}
      </nav>
      <div className="recent-area"><div className="section-label">最近の質問<span>{conversations.length > 0 ? conversations.length : ""}</span></div>
        {conversations.length === 0 && refreshing ? <p className="recent-empty" role="status">履歴を読み込んでいます…</p> : conversations.length === 0 ? <p className="recent-empty">ここに質問が並びます。<br />授業の疑問を質問してください。</p> : <>
          {conversations.slice(0, recentLimit).map(c => <button className={`recent-item ${activeId === c.id && view === "chat" ? "selected" : ""}`} key={c.id} onClick={() => openConversation(c)} disabled={busy}><MessageCircle size={15} /><span>{c.title}</span></button>)}
          {recentLimit < conversations.length && <button type="button" className="recent-more" onClick={() => setRecentLimit(prev => Math.min(conversations.length, prev + RECENT_STEP))}>さらに読み込む（残り{conversations.length - recentLimit}件）</button>}
        </>}
      </div>
      </div>
      <div className="sidebar-bottom">
        <button className="help-link" onClick={() => setModal("guide")}><CircleHelp size={17} />使い方・質問のコツ<ChevronRight size={15} /></button>
        <button className="profile" onClick={() => setModal("settings")}><span className="avatar"><GraduationCap size={23} /></span><span><strong>クラス共通</strong><small>{mode === "hint" ? "まずはヒント" : "じっくり解説"}</small></span><Settings2 size={17} /></button>
      </div>
    </aside>

    <main className={`main-panel${view === "chat" && !hasChat ? " is-home" : ""}`}>
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="メニューを開く" onClick={() => setMobileOpen(true)}><Menu size={22} /></button><strong>{view === "chat" ? selectedCourse?.name ?? "新しい質問" : view === "history" ? "質問の履歴" : view === "instructor" ? "講師への質問" : "保存した質問"}</strong></div></header>

      {view === "chat" ? <>
        {hasChat ? <div className="conversation-bar"><div><h1>{active?.title || "質問への回答"}</h1></div>{active && <button className={`icon-button ${savedIds.has(active.id) ? "is-saved" : ""}`} onClick={() => bookmark(active)} disabled={!bookmarksReady} aria-label={savedIds.has(active.id) ? "保存を解除" : "この質問を保存"}><Bookmark size={19} fill={savedIds.has(active.id) ? "currentColor" : "none"} /></button>}</div> : null}
        <div className="chat-area">
        <div className={`chat-scroll ${hasChat ? "has-messages" : ""}`} ref={messagesRef} onScroll={() => {
          if (busy && pendingQuestionRef.current && messagesRef.current && pendingQuestionRef.current.getBoundingClientRect().top > messagesRef.current.getBoundingClientRect().top + 64) readingEarlierRef.current = true;
        }}>
          {!hasChat ? <div className="welcome">
            {selectedCourse && <p className="course-eyebrow">コース</p>}
            <h1>{selectedCourse?.name ?? "何を知りたいですか？"}</h1>
            <p className="welcome-description">LinktoLinkの教科書をもとに、質問に回答します。</p>
            <div className="suggestion-grid" aria-label="質問の例">{questionExamples.map(s => <button type="button" className="suggestion-card" key={s.title} onClick={() => selectSuggestion(s.prompt)}>{s.title}</button>)}</div>
            {selectedCourse && <section className="course-textbooks" aria-label="このコースの教科書"><h2>このコースの教科書</h2><ul>{selectedCourse.textbookFilenames.map(filename => <li key={filename}>{filename.replace(/\.(pdf|docx)$/i, "").normalize("NFC")}</li>)}</ul></section>}
            <button type="button" className="question-tip" onClick={() => setModal("guide")}>質問のコツ<ChevronRight size={15} /></button>
          </div> : <div className="messages" aria-live="polite" aria-busy={busy}>
            {messages.map((message, index) => <div className={`message message-${message.role}${index === messages.length - 1 && message.role === "assistant" ? " latest-answer" : ""}`} key={message.id} ref={index === messages.length - 1 && message.role === "assistant" ? latestAnswerRef : undefined}>
              {message.role === "assistant" && <div className="assistant-head"><Logo small /><strong>Linqs</strong><span>学習パートナー</span></div>}
              <div className="message-content">{message.role === "assistant" ? <Markdown content={message.content} /> : <p>{message.content}</p>}</div>
              {message.role === "assistant" && <div className="message-actions"><button onClick={() => copyMessage(message)}>{copied === message.id ? <Check size={14} /> : <Copy size={14} />}{copied === message.id ? "コピーしました" : "コピー"}</button><span>{new Date(message.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</span></div>}
              {message.role === "assistant" && active && <AskInstructor conversationId={active.id} messageIndex={index} originalQuestion={messages.slice(0, index).findLast(m => m.role === "user")?.content ?? ""} answer={message.content} disabled={busy || active.persisted === false} onViewQuestions={() => nav("instructor")} />}
            </div>)}
            {pendingQuestion && <div className="message message-user" ref={pendingQuestionRef}><div className="message-content"><p>{pendingQuestion}</p></div></div>}
            {busy && <div className="message message-assistant latest-answer"><div className="assistant-head"><Logo small /><strong>Linqs</strong></div><div className="thinking"><span /><span /><span /><p>質問の内容を確認しています</p></div></div>}
            {!busy && messages.length > 0 && <div className="followup-prompt"><Sparkles size={15} />疑問が残ったら、そのまま続けて質問できます。</div>}
          </div>}
        </div>
        {answerJump && !busy && <button className="answer-jump" onClick={jumpToAnswer} aria-label={answerJump === "start" ? "最新の回答の先頭へ" : "回答の末尾へ"} title={answerJump === "start" ? "最新の回答の先頭へ" : "回答の末尾へ"}><ArrowDown size={18} /></button>}
        </div>
        <div className="composer-area">
          {config?.authReady && config.mode === "incomplete" && <div className="alert warning" role="status">AIの回答機能は準備中です。ログインと履歴の閲覧は利用できます。</div>}
          {error && <div className="alert error" role="alert"><CircleHelp size={17} /><span>{error}</span><button aria-label="通知を閉じる" onClick={() => setError("")}><X size={16} /></button></div>}
          {warning && <div className="alert warning" role="status"><CircleHelp size={17} /><span>{warning}</span><button aria-label="通知を閉じる" onClick={() => setWarning("")}><X size={16} /></button></div>}
          <form className="composer" onSubmit={send}>
            {voice.listening && voice.interim && <div className="voice-interim" aria-live="polite"><Mic size={14} /><span>{voice.interim}</span></div>}
            <textarea ref={inputRef} aria-label="質問を入力" placeholder={active?.persisted === false ? "この回答は未保存です。「新しい質問」から続けてください。" : selectedCourse ? "このコースの授業・実習について質問してください…" : "AIの使い方、VBAのコードやエラーなどを入力してください…"} value={input} maxLength={3000} disabled={busy || active?.persisted === false || config?.mode === "incomplete"} rows={2} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
            <div className="composer-toolbar"><div className="composer-controls"><div className="answer-modes" aria-label="回答の種類"><button type="button" className={mode === "explain" ? "selected" : ""} aria-pressed={mode === "explain"} onClick={() => setMode("explain")} disabled={busy}><Sparkles size={14} />解説</button><button type="button" className={mode === "hint" ? "selected" : ""} aria-pressed={mode === "hint"} onClick={() => setMode("hint")} disabled={busy}><Lightbulb size={14} />ヒント</button></div></div><div className="send-controls"><span className="enter-hint">{voice.isStarting ? "マイク起動中…" : voice.listening ? "音声入力中…" : input.length > 2800 ? `${input.length}/3000` : "Enter で送信"}</span>{voice.supported && <button type="button" className={`voice-button${voice.listening ? " is-listening" : ""}${voice.isStarting ? " is-starting" : ""}`} aria-label={voice.listening ? "音声入力を停止" : "音声で入力"} onClick={(e) => { e.preventDefault(); voice.toggle(); }} disabled={busy || active?.persisted === false || config?.mode === "incomplete"}>{voice.listening ? <MicOff size={18} /> : <Mic size={18} />}</button>}<button className="send-button" aria-label="質問を送信" type="submit" disabled={!input.trim() || busy || !loaded || !config || config.mode === "incomplete"}><Send size={18} /></button></div></div>
          </form>
          <div className="composer-footnote"><span>AIの回答には間違いが含まれることがあります。教材やテスト用のブックでも確認してください。</span><span className="powered"><Sparkles size={11} />{config?.mode === "live" ? "Powered by Gemini" : "AI準備中"}</span></div>
        </div>
      </> : view === "instructor" ? <InstructorQuestions /> : <div className="library-view"><div className="library-heading"><div className="eyebrow">OUR CLASS LEARNING NOTES</div><h1>{view === "history" ? "質問の履歴" : "保存した質問"}</h1><p>{view === "history" ? "授業での疑問や解説を振り返れます。" : "このブラウザに保存した質問です。保存・解除はほかの端末に影響しません。"}</p>{view === "history" && <button className="secondary-button" onClick={refreshHistory} disabled={refreshing || busy}><RefreshCw size={15} />{refreshing ? "更新しています…" : "クラスの履歴を更新"}</button>}</div><label className="history-search"><Search size={18} /><input ref={historySearchRef} aria-label="質問を検索" placeholder="質問や回答から探す" value={query} onChange={e => setQuery(e.target.value)} /></label>
        {error && <div className="alert error" role="alert">{error}</div>}{warning && <div className="alert warning" role="status">{warning}</div>}
        {refreshing && filtered.length === 0 ? <div className="library-empty" role="status"><History size={36} strokeWidth={1.4} /><h2>履歴を読み込んでいます…</h2><p>{config?.mode === "live" ? "新しい質問は、読み込み中も送信できます。" : "読み込みが終わると、クラスの質問が表示されます。"}</p></div> : filtered.length > 0 ? <div className="history-list">{filtered.map(c => <div className="history-card" key={c.id}><button className="history-open" onClick={() => openConversation(c)}><span className="subject-icon subject-ai"><MessageCircle size={22} /></span><span><strong>{c.title}</strong><small>{new Date(c.updated_at).toLocaleDateString("ja-JP", { month: "long", day: "numeric" })} <span>·</span> {Math.floor(c.messages.length / 2)}回の質問</small></span></button><button className={`icon-button ${savedIds.has(c.id) ? "is-saved" : ""}`} aria-label={savedIds.has(c.id) ? "保存を解除" : "この質問を保存"} onClick={() => bookmark(c)} disabled={!bookmarksReady}><Bookmark size={18} fill={savedIds.has(c.id) ? "currentColor" : "none"} /></button>{view === "history" && <button className="icon-button delete-button" aria-label="この質問を削除" onClick={() => setDeleteId(c.id)}><Trash2 size={17} /></button>}</div>)}</div> : <div className="library-empty">{view === "history" ? <History size={36} strokeWidth={1.4} /> : <Bookmark size={36} strokeWidth={1.4} />}<h2>{query ? "一致する質問がありません" : view === "history" ? "まだ質問はありません" : "保存した質問はまだありません"}</h2><p>{query ? "別の言葉で検索してください。" : view === "history" ? "AI活用やExcel VBAの疑問から始めましょう。" : "回答のしおりマークを押すと、ここで読み返せます。"}</p>{!query && <button className="primary-button" onClick={newChat}><Plus size={17} />質問してみる</button>}</div>}
      </div>}
    </main>

    <dialog className="app-dialog" ref={dialogRef} onCancel={() => { setModal(null); setDeleteId(null); }} onClick={e => { if (e.target === e.currentTarget) { setModal(null); setDeleteId(null); } }}>
      <button className="dialog-close icon-button" aria-label="閉じる" onClick={() => { setModal(null); setDeleteId(null); }}><X size={20} /></button>
      {deleteId ? <><span className="dialog-symbol"><Trash2 size={24} /></span><h2>この質問を削除しますか？</h2><p>質問と回答がクラス全員の履歴から消えます。元に戻すことはできません。</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setDeleteId(null)}>キャンセル</button><button className="danger-button" onClick={removeConversation}>削除する</button></div></> : modal === "guide" ? <><span className="dialog-symbol"><Lightbulb size={25} /></span><div className="eyebrow">A LITTLE HELP</div><h2>質問を具体的に伝えるコツ</h2><p>授業の疑問や、実習で困った点をそのまま質問できます。</p><div className="guide-step"><span>01</span><div><h3>やりたいことを伝える</h3><p>「AIで業務メールの下書きを作る手順を教えて」</p></div></div><div className="guide-step"><span>02</span><div><h3>コード・エラー・環境を添える</h3><p>「Windows版Excelで実行時エラー1004が出ます」＋該当コードとエラー全文</p></div></div><div className="guide-step"><span>03</span><div><h3>自分で考えたいときは、ヒントを</h3><p>入力欄の「ヒント」に切り替えると、次の一歩を考えるための手がかりを示します。</p></div></div><div className="guide-step"><span>04</span><div><h3>公式資料で確認する</h3><p>VBAの質問では、保存済みのMicrosoft公式資料から関連する抜粋を探し、出典リンクと資料の取得日を回答に表示します。<a href={EXCEL_VBA_REFERENCE_URL} target="_blank" rel="noopener noreferrer">Microsoft LearnのExcel VBAリファレンスを開く</a></p></div></div><div className="guide-step"><span>05</span><div><h3>教科書の質問には、教材名とページを</h3><p>登録された教科書から関連箇所を探して回答します。「VBAの教科書で、変数の宣言を説明して」のように伝えてください。参照ページはPDFの先頭から数えた番号です。</p></div></div><div className="privacy-note">氏名・顧客情報・社内機密・パスワードは入力せず、架空のデータに置き換えてください。質問は回答のためGeminiに送信され、Supabaseに保存されます。質問と保存した履歴はクラス全員で共有します。</div><button className="primary-button full-width" onClick={() => setModal(null)}>質問を始める</button></> : modal === "settings" ? <><span className="dialog-symbol"><GraduationCap size={26} /></span><div className="eyebrow">JUST FOR YOU</div><h2>回答のスタイル</h2><p>詳しい解説か、考えるためのヒントかを選べます。</p><div className="settings-modes" aria-label="回答のスタイル"><button className={mode === "explain" ? "selected" : ""} onClick={() => setMode("explain")}><Sparkles size={20} /><strong>じっくり解説</strong><small>答えと考え方を知りたい</small></button><button className={mode === "hint" ? "selected" : ""} onClick={() => setMode("hint")}><Lightbulb size={20} /><strong>まずはヒント</strong><small>自分の力で考えたい</small></button></div><div className="privacy-note">クラスの履歴は共有されます。別端末の質問は、履歴画面の更新ボタンで確認できます。保存した質問と回答スタイルは、この端末のブラウザごとに保存されます。</div><button className="primary-button full-width" onClick={() => setModal(null)}>設定を完了</button><button className="logout-button" onClick={logout} disabled={busy}><LogOut size={16} />この端末からログアウト</button></> : null}
    </dialog>
  </div>;
}
