import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
let conversationId: string;
const writerKeys: Record<string, string> = { [alice]: "a".repeat(64), [bob]: "b".repeat(64) };
let currentUser = alice;

async function asUser(id: string) {
  currentUser = id;
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec("set role authenticated");
}

async function exchange(id: string | null, answer = "考え方の解説です。", subject = "Excel VBA") {
  const ticket = await reserve();
  const result = await db.query<{ id: string }>("select public.save_question_exchange($1, $2, $3, $4, $5, $6, $7) as id", [id, "セルA1への書き込み", subject, "A1に文字を入力したい", answer, writerKeys[currentUser], ticket]);
  return result.rows[0].id;
}

async function reserve() {
  const result = await db.query<{ ticket: string | null }>("select public.reserve_question_exchange($1) as ticket", [writerKeys[currentUser]]);
  return result.rows[0].ticket;
}

describe("Supabase migration: ownership, grants, transactions and shared quota", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      insert into auth.users values('${alice}'), ('${bob}');
    `);
    await db.exec(readFileSync(new URL("../supabase/migrations/001_learning_assistant.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../supabase/migrations/002_vocational_subjects.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../supabase/migrations/004_server_exchange_writer.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../supabase/migrations/006_conversation_courses.sql", import.meta.url), "utf8"));
    await db.exec("set role service_role");
    for (const id of [alice, bob]) await db.query("select public.configure_exchange_writer($1, $2)", [id, writerKeys[id]]);
    await db.exec("reset role");
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
    await db.exec("reset role");
    await db.query("delete from public.question_quotas where user_id = $1", [alice]);
    await asUser(alice);
    for (let i = 0; i < 30; i++) {
      expect(await reserve()).toBeTruthy();
    }
    expect(await reserve()).toBeNull();
    await expect(exchange(null)).rejects.toThrow("Valid unused ticket required");
    await asUser(bob);
    expect(await reserve()).toBeTruthy();
    await db.exec("reset role");
    await db.query("update public.question_quotas set window_start = now() - interval '61 minutes' where user_id = $1", [alice]);
    await asUser(alice);
    expect(await reserve()).toBeTruthy();
  });

  it("denies browser-only calls, the old public writer and access to writer keys/tickets", async () => {
    await asUser(alice);
    await expect(db.query("select public.save_question_exchange($1, $2, $3, $4, $5)", [null, "fake", "Excel VBA", "fake", "fake assistant"])).rejects.toThrow("does not exist");
    await expect(db.exec("select public.consume_question_quota()")).rejects.toThrow("permission denied");
    await expect(db.query("select public.reserve_question_exchange($1)", [null])).rejects.toThrow("Server writer required");
    await expect(db.query("select public.reserve_question_exchange($1)", ["c".repeat(64)])).rejects.toThrow("Server writer required");
    await expect(db.query("select public.save_question_exchange($1,$2,$3,$4,$5,$6,$7)", [null, "fake", "Excel VBA", "fake", "fake", "c".repeat(64), null])).rejects.toThrow("Server writer required");
    await expect(db.exec("select * from linqs_private.exchange_writers")).rejects.toThrow("permission denied");
    await expect(db.exec("select * from linqs_private.exchange_tickets")).rejects.toThrow("permission denied");
    await expect(db.query("select public.configure_exchange_writer($1, $2)", [alice, writerKeys[alice]])).rejects.toThrow("permission denied");
  });

  it("allows one save per ticket and rejects another owner's or an expired ticket", async () => {
    await asUser(alice);
    const ticket = await reserve();
    const args = [null, "audit", "Excel VBA", "question", "answer", writerKeys[alice], ticket];
    await asUser(bob);
    await expect(db.query("select public.reserve_question_exchange($1)", [writerKeys[alice]])).rejects.toThrow("Server writer required");
    await expect(db.query("select public.save_question_exchange($1,$2,$3,$4,$5,$6,$7)", [...args.slice(0, 5), writerKeys[bob], ticket])).rejects.toThrow("Valid unused ticket required");
    await asUser(alice);
    const result = await db.query<{ id: string }>("select public.save_question_exchange($1,$2,$3,$4,$5,$6,$7) as id", args);
    await expect(db.query("select public.save_question_exchange($1,$2,$3,$4,$5,$6,$7)", args)).rejects.toThrow("Valid unused ticket required");
    await db.query("delete from public.conversations where id = $1", [result.rows[0].id]);
    const expired = await reserve();
    await db.exec("reset role");
    await db.query("update linqs_private.exchange_tickets set created_at = clock_timestamp() - interval '6 minutes' where id = $1", [expired]);
    await asUser(alice);
    await expect(db.query("select public.save_question_exchange($1,$2,$3,$4,$5,$6,$7)", [...args.slice(0, 6), expired])).rejects.toThrow("Valid unused ticket required");
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

  it("persists a course atomically, blocks retagging, and preserves old unassigned history", async () => {
    await asUser(alice);
    const ticket = await reserve();
    const args = [null, "コースの質問", "すべて", "質問", "解説", writerKeys[alice], ticket];
    await expect(db.query("select public.save_question_exchange($1,$2,$3,$4,$5,$6,$7,$8)", [...args, "invalid"])).rejects.toThrow("Invalid course");
    const { rows } = await db.query<{ id: string }>("select public.save_question_exchange($1,$2,$3,$4,$5,$6,$7,$8) as id", [...args, "website-production"]);
    const id = rows[0].id;
    expect((await db.query("select course_id from public.conversations where id = $1", [id])).rows).toEqual([{ course_id: "website-production" }]);
    const next = [id, ...args.slice(1, 6), await reserve()];
    await expect(db.query("select public.save_question_exchange($1,$2,$3,$4,$5,$6,$7,$8)", [...next, "pc-ai-skills"])).rejects.toThrow("course cannot change");
    await expect(db.query("select public.save_question_exchange($1,$2,$3,$4,$5,$6,$7)", next)).rejects.toThrow("course cannot change");
    await expect(db.query("update public.conversations set course_id = null where id = $1", [id])).rejects.toThrow("permission denied");
    expect((await db.query("select * from public.messages where conversation_id = $1", [id])).rows).toHaveLength(2);
    await db.query("select public.save_question_exchange($1,$2,$3,$4,$5,$6,$7,$8)", [...next, "website-production"]);
    expect((await db.query("select * from public.messages where conversation_id = $1", [id])).rows).toHaveLength(4);
    await asUser(bob);
    await expect(db.query("select public.save_question_exchange($1,$2,$3,$4,$5,$6,$7,$8)", [id, ...args.slice(1, 5), writerKeys[bob], await reserve(), "website-production"])).rejects.toThrow("Conversation not found");
    await asUser(alice);
    await db.query("delete from public.conversations where id = $1", [id]);
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
