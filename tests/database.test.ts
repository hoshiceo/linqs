import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
let conversationId: string;

async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec("set role authenticated");
}

async function exchange(id: string | null, answer = "考え方の解説です。", subject = "Excel VBA") {
  const result = await db.query<{ id: string }>("select public.save_question_exchange($1, $2, $3, $4, $5) as id", [id, "セルA1への書き込み", subject, "A1に文字を入力したい", answer]);
  return result.rows[0].id;
}

describe("Supabase migration: ownership, grants, transactions and shared quota", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      insert into auth.users values('${alice}'), ('${bob}');
    `);
    await db.exec(readFileSync(new URL("../supabase/migrations/001_learning_assistant.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../supabase/migrations/002_vocational_subjects.sql", import.meta.url), "utf8"));
  });
  afterEach(async () => { await db.exec("reset role"); });
  afterAll(async () => { await db.close(); });

  it("saves a question and answer atomically for the authenticated owner", async () => {
    await asUser(alice);
    conversationId = await exchange(null);
    const messages = await db.query<{ role: string }>("select role from public.messages order by created_at");
    expect(messages.rows.map(m => m.role)).toEqual(["user", "assistant"]);
    expect((await db.query("select * from public.conversations")).rows).toHaveLength(1);
  });

  it("hides another student's conversations and messages, and blocks their writes", async () => {
    await asUser(bob);
    expect((await db.query("select * from public.conversations")).rows).toHaveLength(0);
    expect((await db.query("select * from public.messages")).rows).toHaveLength(0);
    await expect(exchange(conversationId)).rejects.toThrow("Conversation not found");
    expect((await db.query("delete from public.conversations where id = $1 returning id", [conversationId])).rows).toHaveLength(0);
  });

  it("allows bookmarking while denying direct changes to ownership or model history", async () => {
    await asUser(alice);
    await db.query("update public.conversations set bookmarked = true where id = $1", [conversationId]);
    expect((await db.query<{ bookmarked: boolean }>("select bookmarked from public.conversations")).rows[0].bookmarked).toBe(true);
    await expect(db.query("update public.conversations set user_id = $1", [bob])).rejects.toThrow("permission denied");
    await expect(db.exec("insert into public.messages(conversation_id, role, content) values ('11111111-1111-4111-8111-111111111111', 'assistant', 'fake')")).rejects.toThrow("permission denied");
    await expect(db.exec("delete from public.question_quotas")).rejects.toThrow("permission denied");
  });

  it("rolls back a new conversation if message validation fails", async () => {
    await asUser(alice);
    const before = (await db.query("select id from public.conversations")).rows.length;
    await expect(exchange(null, "")).rejects.toThrow("Invalid answer");
    await expect(exchange(null, "解説", "invalid subject")).rejects.toThrow();
    expect((await db.query("select id from public.conversations")).rows).toHaveLength(before);
  });

  it("enforces 30 attempts per user per hour and resets after the window", async () => {
    await asUser(alice);
    for (let i = 0; i < 30; i++) {
      const result = await db.query<{ allowed: boolean }>("select public.consume_question_quota() as allowed");
      expect(result.rows[0].allowed).toBe(true);
    }
    expect((await db.query<{ allowed: boolean }>("select public.consume_question_quota() as allowed")).rows[0].allowed).toBe(false);
    await asUser(bob);
    expect((await db.query<{ allowed: boolean }>("select public.consume_question_quota() as allowed")).rows[0].allowed).toBe(true);
    await db.exec("reset role");
    await db.query("update public.question_quotas set window_start = now() - interval '61 minutes' where user_id = $1", [alice]);
    await asUser(alice);
    expect((await db.query<{ allowed: boolean }>("select public.consume_question_quota() as allowed")).rows[0].allowed).toBe(true);
  });

  it("does not expose data or save functions to unauthenticated visitors", async () => {
    await db.exec("set role anon");
    await expect(db.exec("select * from public.conversations")).rejects.toThrow("permission denied");
    await expect(db.exec("select public.consume_question_quota()")).rejects.toThrow("permission denied");
    await expect(exchange(null)).rejects.toThrow("permission denied");
  });

  it("deletes an owner's conversation and cascades its messages", async () => {
    await asUser(alice);
    await db.query("delete from public.conversations where id = $1", [conversationId]);
    expect((await db.query("select * from public.messages")).rows).toHaveLength(0);
    expect((await db.query("select * from public.conversations")).rows).toHaveLength(0);
  });

  it("upgrades existing school subjects without losing history or sharing access", async () => {
    // Simulate the constraint in the previously shipped schema.
    await db.exec(`alter table public.conversations drop constraint conversations_subject_check;
      alter table public.conversations add constraint conversations_subject_check
      check (subject in ('すべて', '数学', '英語', '国語', '理科', '社会'));`);
    await asUser(alice);
    const legacyId = await exchange(null, "以前の回答", "数学");
    await db.query("update public.conversations set bookmarked = true where id = $1", [legacyId]);
    await db.exec("reset role");
    await db.exec(readFileSync(new URL("../supabase/migrations/002_vocational_subjects.sql", import.meta.url), "utf8"));
    await asUser(alice);
    const result = await db.query<{ subject: string; bookmarked: boolean }>("select subject, bookmarked from public.conversations where id = $1", [legacyId]);
    expect(result.rows[0]).toEqual({ subject: "すべて", bookmarked: true });
    const messages = await db.query<{ content: string }>("select content from public.messages where conversation_id = $1 order by created_at", [legacyId]);
    expect(messages.rows.map(m => m.content)).toEqual(["A1に文字を入力したい", "以前の回答"]);
    await exchange(legacyId, "新しい回答", "Excel VBA");
    expect((await db.query<{ subject: string }>("select subject from public.conversations where id = $1", [legacyId])).rows[0].subject).toBe("Excel VBA");
    await asUser(bob);
    expect((await db.query("select * from public.conversations where id = $1", [legacyId])).rows).toHaveLength(0);
  });
});
