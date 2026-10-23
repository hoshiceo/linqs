"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronRight, GraduationCap, Hand, RefreshCw, Send, X } from "lucide-react";
import { apiFetch } from "@/lib/supabase-client";
import { getCourse } from "@/lib/courses";
import type { InstructorQuestion } from "@/lib/instructor-questions";

const dateLabel = (value: string) => new Date(value).toLocaleString("ja-JP", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function AskInstructor({ conversationId, messageIndex, originalQuestion, answer, disabled, onViewQuestions }: {
  conversationId: string; messageIndex: number; originalQuestion: string; answer: string; disabled: boolean; onViewQuestions: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<InstructorQuestion | null>(null);
  const sendingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sendingRef.current || disabled || !question.trim() || receipt) return;
    sendingRef.current = true;
    setSending(true); setError("");
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${originalQuestion}\u001f${answer}`));
      const contextHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      const result = await apiFetch<{ question: InstructorQuestion }>("/api/instructor-questions", {
        method: "POST", body: JSON.stringify({ conversationId, messageIndex, contextHash, question: question.trim() }),
        signal: AbortSignal.timeout(15000),
      });
      setReceipt(result.question);
    } catch (e) {
      setError(e instanceof Error && e.name === "TimeoutError" ? "受付状況を確認できませんでした。再送しても同じ回答の質問は重複しません。" : e instanceof Error ? e.message : "質問を受け付けられませんでした。");
    } finally { sendingRef.current = false; setSending(false); }
  }

  return <div className="instructor-action">
    <button type="button" className={`ask-instructor-button${open ? " is-active" : ""}`} disabled={disabled} aria-expanded={open} onClick={() => { setOpen(!open); if (!open) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true })); }} title={disabled ? "保存済みの回答から質問できます" : "この回答について講師に質問"}><Hand size={16} />{receipt ? "受付済み" : "講師に質問"}</button>
    {open && <section className="instructor-card" aria-label="この回答について講師に質問">
      <Hand className="instructor-card-icon" size={20} aria-hidden="true" />
      <div className="instructor-card-body">
        <button type="button" className="icon-button instructor-card-close" aria-label="講師への質問を閉じる" disabled={sending} onClick={() => setOpen(false)}><X size={17} /></button>
        {receipt ? <div role="status"><h3><Check size={18} />講師への質問を受け付けました</h3><p>受付内容は「講師への質問」から確認できます。</p><p className="instructor-submitted-text">{receipt.question}</p><button type="button" className="instructor-text-button" onClick={onViewQuestions}>受付状況・返信を確認<ChevronRight size={15} /></button></div> : <>
          <h3>わからないことは、講師に聞けます</h3>
          <p>この質問とAIの回答を添えて、講師に確認を依頼できます。講師からの返信は保証されません。</p>
          <details className="instructor-context"><summary>講師に共有する質問とAIの回答</summary><strong>元の質問</strong><p>{originalQuestion}</p><strong>AIの回答</strong><p>{answer}</p></details>
          <form onSubmit={submit}>
            <label className="instructor-field">講師に確認したいこと<textarea ref={inputRef} value={question} onChange={e => setQuestion(e.target.value)} maxLength={2000} rows={3} required disabled={sending} placeholder="どこがわからなかったか、具体的に教えてください。" /></label>
            <div className="instructor-form-meta"><span>質問と返信はクラス全員で共有されます。個人情報は入力しないでください。</span><span>{question.length}/2000</span></div>
            {error && <p className="instructor-error" role="alert">{error}</p>}
            <button type="submit" className="primary-button" disabled={sending || disabled || !question.trim()}><Send size={15} />{sending ? "送信しています…" : "この内容で講師に質問する"}</button>
          </form>
        </>}
      </div>
    </section>}
  </div>;
}

export function InstructorQuestions() {
  const [questions, setQuestions] = useState<InstructorQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true); setError("");
    apiFetch<{ questions: InstructorQuestion[] }>("/api/instructor-questions", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(result => { if (alive) setQuestions(result.questions); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : "講師への質問を読み込めませんでした。"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [revision]);

  return <div className="library-view instructor-library">
    <div className="library-heading"><span className="dialog-symbol"><Hand size={24} /></span><h1>講師への質問</h1><p>AIの回答で解決しなかった疑問を、講師と一緒に。</p><button type="button" className="secondary-button" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} />{loading ? "更新しています…" : "受付状況・返信を更新"}</button></div>
    <p className="instructor-shared-note">質問と返信はクラス全員で共有されます。返信は講師が対応できる範囲で行います。新しい順に最大100件を表示します。</p>
    {error && <div className="alert error" role="alert">{error}</div>}
    {loading && questions.length === 0 ? <p role="status">講師への質問を読み込んでいます…</p> : !error && questions.length === 0 ? <div className="library-empty"><Hand size={36} strokeWidth={1.4} /><h2>講師への質問はまだありません</h2><p>AIの回答の下にある「講師に質問」から送信できます。</p></div> : <div className="instructor-question-list">{questions.map(item => <article className="instructor-question" key={item.id}>
      <div className="instructor-question-meta"><span className={`instructor-status${item.reply ? " answered" : ""}`}>{item.reply ? "返信あり" : "受付済み"}</span><time dateTime={item.created_at}>{dateLabel(item.created_at)}</time>{getCourse(item.course_id) && <span>{getCourse(item.course_id)?.name}</span>}</div>
      <h2>{item.conversation_title}</h2><p className="instructor-question-text">{item.question}</p>
      <details className="instructor-context"><summary>共有した質問とAIの回答</summary><strong>元の質問</strong><p>{item.original_question}</p><strong>AIの回答</strong><p>{item.ai_answer}</p></details>
      {item.reply ? <div className="instructor-reply"><h3><GraduationCap size={16} aria-hidden="true" />講師からの返信</h3><p>{item.reply}</p>{item.replied_at && <time dateTime={item.replied_at}>{dateLabel(item.replied_at)}</time>}</div> : <p className="instructor-waiting">講師の確認をお待ちください。返信が届いたらここに表示されます。</p>}
    </article>)}</div>}
  </div>;
}

