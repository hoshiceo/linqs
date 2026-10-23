import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const writerKey = "a".repeat(64);
const hash = createHash("sha256").update("元の質問\u001fAIの回答").digest("hex");
let db: PGlite;
let conversationId: string;
let receiptId: string;
async function asRole(role = "authenticated", id = alice) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec(`set role ${role}`);
}
async function exchange() {
  const ticket = await db.query<{ ticket: string }>("select public.reserve_question_exchange($1) ticket", [writerKey]);
  const result = await db.query<{ id: string }>("select public.save_question_exchange(null, '質問タイトル', 'すべて', '元の質問', 'AIの回答', $1, $2, 'website-production') id", [writerKey, ticket.rows[0].ticket]);
  return result.rows[0].id;
}
async function submit(id = conversationId, index = 1, key = writerKey, context = hash, question = "詳しく教えてください") {
  return db.query<{ id: string; original_question: string; ai_answer: string; course_id: string }>("select (public.submit_instructor_question($1, $2, $3, $4, $5)).*", [id, index, question, context, key]);
}

describe("Instructor questions database security and persistence", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      insert into auth.users values ('${alice}'), ('${bob}');
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
    for (const file of ["001_learning_assistant", "002_vocational_subjects", "004_server_exchange_writer", "006_conversation_courses", "007_instructor_questions"]) {
      await db.exec(readFileSync(new URL(`../supabase/migrations/${file}.sql`, import.meta.url), "utf8"));
    }
    await asRole("service_role");
    await db.query("select public.configure_exchange_writer($1, $2)", [alice, writerKey]);
    await db.query("select public.configure_exchange_writer($1, $2)", [bob, writerKey]);
    await asRole(); conversationId = await exchange();
  });
  afterAll(async () => { await db.close(); });

  it("snapshots the actual exchange, course and question and deduplicates retries", async () => {
    const result = await submit(); receiptId = result.rows[0].id;
    expect(result.rows[0]).toMatchObject({ original_question: "元の質問", ai_answer: "AIの回答", course_id: "website-production" });
    expect((await submit()).rows[0].id).toBe(receiptId);
    expect((await db.query("select * from public.instructor_questions")).rows).toHaveLength(1);
  });
  it("rejects a wrong writer, a user message, changed content, and invalid questions", async () => {
    await expect(submit(conversationId, 1, "wrong")).rejects.toThrow("Server writer required");
    await expect(submit(conversationId, 0)).rejects.toThrow("Answer not found");
    await expect(submit(conversationId, 1, writerKey, "0".repeat(64))).rejects.toThrow("Answer changed");
    for (const question of [" ", "a".repeat(2001)]) await expect(submit(conversationId, 1, writerKey, hash, question)).rejects.toThrow("Invalid instructor question");
  });
  it("prevents students forging replies or inserting, deleting and editing submissions", async () => {
    for (const sql of ["update public.instructor_questions set reply = '偽の返信'", "update public.instructor_questions set question = '改ざん'", "delete from public.instructor_questions", "insert into public.instructor_questions(question) values('偽装')"]) {
      await expect(db.exec(sql)).rejects.toThrow("permission denied");
    }
    await asRole("authenticated", bob);
    expect((await db.query("select * from public.instructor_questions")).rows).toHaveLength(0);
    await expect(submit()).rejects.toThrow("Answer not found");
    await asRole("anon", "");
    await expect(db.exec("select * from public.instructor_questions")).rejects.toThrow("permission denied");
    await expect(submit()).rejects.toThrow("permission denied");
    await asRole();
  });
  it("lets administrators reply with an automatic timestamp", async () => {
    await asRole("service_role");
    await db.query("update public.instructor_questions set reply = $1 where id = $2", ["講師からの解説です。", receiptId]);
    await asRole();
    const result = await db.query<{ reply: string; replied_at: string }>("select reply, replied_at from public.instructor_questions");
    expect(result.rows[0].reply).toBe("講師からの解説です。"); expect(result.rows[0].replied_at).toBeTruthy();
  });
  it("limits new submissions to ten per class per hour, but permits retries", async () => {
    for (let i = 0; i < 9; i++) await submit(await exchange());
    await expect(submit(await exchange())).rejects.toThrow("Instructor question limit");
    expect((await submit()).rows[0].id).toBe(receiptId);
    expect((await db.query("select * from public.instructor_questions")).rows).toHaveLength(10);
  });
  it("preserves the instructor request and reply when shared chat history is deleted", async () => {
    await db.query("delete from public.conversations where id = $1", [conversationId]);
    const result = await db.query<{ source_message_id: string | null; original_question: string; ai_answer: string; reply: string }>("select * from public.instructor_questions where id = $1", [receiptId]);
    expect(result.rows[0]).toMatchObject({ source_message_id: null, original_question: "元の質問", ai_answer: "AIの回答", reply: "講師からの解説です。" });
  });
});
