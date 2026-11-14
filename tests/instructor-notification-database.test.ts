import { PGlite } from "@electric-sql/pglite";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const writer = "a".repeat(64);
const bobWriter = "b".repeat(64);
const hash = createHash("sha256").update("元の質問\u001fAIの回答").digest("hex");
type Job = { attemptId: string; sender: string; question: { id: string; question: string; ai_answer: string; reply?: string } };
let db: PGlite;
let historicId: string;
let questionId: string;
let conversationId: string;

async function asRole(role = "authenticated", id = alice) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  if (role !== "postgres") await db.exec(`set role ${role}`);
}
async function submit() {
  await asRole();
  const ticket = await db.query<{ ticket: string }>("select public.reserve_question_exchange($1) ticket", [writer]);
  const result = await db.query<{ id: string }>("select public.save_question_exchange(null, '質問タイトル', 'すべて', '元の質問', 'AIの回答', $1, $2, 'website-production') id", [writer, ticket.rows[0].ticket]);
  conversationId = result.rows[0].id;
  const saved = await db.query<{ id: string }>("select (public.submit_instructor_question($1, 1, '詳しく教えて', $2, $3)).id", [conversationId, hash, writer]);
  return saved.rows[0].id;
}
async function claim(id: string | null = questionId, key = writer, owner = alice, sender = "Linqs <mail@example.com>") {
  const result = await db.query<{ job: Job | null }>("select public.claim_instructor_notification($1, $2, $3, $4) job", [owner, key, sender, id]);
  return result.rows[0].job;
}
async function finish(id: string, attempt: string, provider: string | null, key = writer, owner = alice) {
  return (await db.query<{ done: boolean }>("select public.finish_instructor_notification($1, $2, $3, $4, $5) done", [owner, key, id, attempt, provider])).rows[0].done;
}
async function queue(id = questionId) {
  await asRole("postgres");
  return (await db.query<{ status: string; attempts: number; provider_id: string; next_attempt_at: string; sent_at: string | null }>("select * from linqs_private.instructor_question_notifications where question_id = $1", [id])).rows[0];
}
async function due(id = questionId) {
  await asRole("postgres");
  await db.query("update linqs_private.instructor_question_notifications set next_attempt_at = clock_timestamp() - interval '1 second' where question_id = $1", [id]);
  await asRole("anon", "");
}

describe("Instructor notification outbox security and delivery lifecycle", () => {
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
    await db.query("select public.configure_exchange_writer($1, $2)", [alice, writer]);
    await db.query("select public.configure_exchange_writer($1, $2)", [bob, bobWriter]);
    historicId = await submit();
    await asRole("postgres");
    await db.exec(readFileSync(new URL("../supabase/migrations/008_instructor_question_notifications.sql", import.meta.url), "utf8"));
    // PGlite has no hosted HTTP/cron/Vault services. These fixtures record the
    // actual migration's dispatches and leave all application SQL unchanged.
    await db.exec(`create schema extensions; create schema vault; create schema net; create schema cron;
      create table vault.decrypted_secrets(name text primary key, decrypted_secret text);
      create table net.requests(id bigserial primary key, url text, body jsonb, headers jsonb, timeout_ms integer);
      create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer) returns bigint
      language plpgsql as $$ declare v_id bigint; begin
        if current_setting('test.net_failure', true) = 'yes' then raise exception 'Network enqueue unavailable'; end if;
        insert into net.requests(url,body,headers,timeout_ms) values($1,$2,$3,$4) returning id into v_id; return v_id;
      end; $$;
      create table cron.job(jobid bigserial primary key, jobname text unique, schedule text, command text);
      create function cron.schedule(text,text,text) returns bigint language sql as $$
        insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid; $$;
      create function extensions.hmac(data bytea, key bytea, algorithm text) returns bytea language plpgsql as $$
      declare inner_pad bytea := decode(repeat('36',64),'hex'); outer_pad bytea := decode(repeat('5c',64),'hex'); i integer;
      begin
        if octet_length(key) <> 64 or algorithm <> 'sha256' then raise exception 'Unexpected test key'; end if;
        for i in 0..63 loop
          inner_pad := set_byte(inner_pad,i,get_byte(key,i) # 54);
          outer_pad := set_byte(outer_pad,i,get_byte(key,i) # 92);
        end loop;
        return sha256(outer_pad || sha256(inner_pad || data));
      end; $$;`);
    await db.exec(readFileSync(new URL("../supabase/migrations/009_instructor_edge_dispatch.sql", import.meta.url), "utf8")
      .replace(/^create extension if not exists .*;$/gm, ""));
    await db.exec(readFileSync(new URL("../supabase/migrations/010_notification_recipients.sql", import.meta.url), "utf8"));
    questionId = await submit();
  });
  afterAll(async () => { await db.close(); });

  it("enqueues only new questions atomically and never backfills or duplicates a receipt", async () => {
    expect(await queue(historicId)).toBeUndefined();
    expect(await queue()).toMatchObject({ status: "pending", attempts: 0, sent_at: null });
    await asRole();
    await db.query("select public.submit_instructor_question($1, 1, '再送', $2, $3)", [conversationId, hash, writer]);
    await asRole("postgres");
    expect((await db.query("select * from linqs_private.instructor_question_notifications")).rows).toHaveLength(1);
  });
  it("blocks anonymous and student access to outbox state and requires the class-specific writer capability", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await asRole(role);
      await expect(db.exec("select * from linqs_private.instructor_question_notifications")).rejects.toThrow("permission denied");
      await expect(db.exec("update linqs_private.instructor_question_notifications set status = 'sent'")).rejects.toThrow("permission denied");
    }
    await asRole("anon", "");
    for (const key of [null, "", "wrong", bobWriter]) {
      await expect(claim(questionId, key as string)).rejects.toThrow("Server writer required");
      await expect(finish(questionId, alice, "fake", key as string)).rejects.toThrow("Server writer required");
    }
    expect(await claim(questionId, bobWriter, bob)).toBeNull();
    expect(await queue()).toMatchObject({ attempts: 0 });
  });
  it("claims a job without a student JWT, leases it, and returns only the stored context", async () => {
    await asRole("anon", "");
    await expect(claim(questionId, writer, alice, "mail@example.com\nBcc: outsider@example.com")).rejects.toThrow("Invalid notification sender");
    const job = (await claim())!;
    expect(job).toMatchObject({ sender: "Linqs <mail@example.com>", question: { id: questionId, question: "詳しく教えて", ai_answer: "AIの回答" } });
    expect(job.question.reply).toBeUndefined();
    expect(await claim()).toBeNull();
    expect(await finish(questionId, bob, "fake")).toBe(false);
    expect(await finish(questionId, job.attemptId, "fake", bobWriter, bob)).toBe(false);
    expect(await queue()).toMatchObject({ attempts: 1, status: "pending" });
  });
  it("recovers an expired lease with the original sender and ignores a stale worker completion", async () => {
    await due();
    const second = (await claim(questionId, writer, alice, "changed@example.com"))!;
    expect(second.sender).toBe("Linqs <mail@example.com>");
    expect(await finish(questionId, alice, "stale-receipt")).toBe(false);
    expect(await finish(questionId, second.attemptId, null)).toBe(true);
    expect(await claim()).toBeNull();
    expect(await queue()).toMatchObject({ attempts: 2, status: "pending", sent_at: null });
  });
  it("records delivery permanently so retries cannot notify twice, including beyond the provider's 24h window", async () => {
    await due();
    const third = (await claim())!;
    await expect(finish(questionId, third.attemptId, "")).rejects.toThrow("Invalid provider receipt");
    expect(await finish(questionId, third.attemptId, "provider-receipt")).toBe(true);
    expect(await queue()).toMatchObject({ status: "sent", provider_id: "provider-receipt", attempts: 3 });
    await db.query("update linqs_private.instructor_question_notifications set first_attempt_at = clock_timestamp() - interval '2 days' where question_id = $1", [questionId]);
    await due();
    expect(await claim()).toBeNull();
  });
  it("retains the queued context after chat deletion and excludes changing replies from retries", async () => {
    const id = await submit();
    await asRole("service_role");
    await db.query("update public.instructor_questions set reply = '新しい返信' where id = $1", [id]);
    await asRole();
    await db.query("delete from public.conversations where id = $1", [conversationId]);
    await asRole("anon", "");
    const job = (await claim(id))!;
    expect(job.question).toMatchObject({ id, question: "詳しく教えて", ai_answer: "AIの回答" });
    expect(job.question.reply).toBeUndefined();
    await finish(id, job.attemptId, "provider-receipt-2");
  });
  it("stops ambiguous retries before idempotency expiry, and caps repeated failures for administrator review", async () => {
    const old = await submit();
    await asRole("postgres");
    await db.query("update linqs_private.instructor_question_notifications set first_attempt_at = clock_timestamp() - interval '23 hours', attempts = 1 where question_id = $1", [old]);
    await asRole("anon", "");
    expect(await claim(old)).toBeNull();
    expect(await queue(old)).toMatchObject({ status: "needs_review" });
    const failing = await submit();
    await asRole("postgres");
    await db.query("update linqs_private.instructor_question_notifications set attempts = 11 where question_id = $1", [failing]);
    await asRole("anon", "");
    const last = (await claim(failing))!;
    expect(await finish(failing, last.attemptId, null)).toBe(true);
    expect(await queue(failing)).toMatchObject({ status: "needs_review", attempts: 12 });
    await asRole("anon", "");
    expect(await claim(failing)).toBeNull();
  });
  it("pins the recipient on the first claim and preserves it across configuration changes", async () => {
    const id = await submit();
    await asRole("anon", "");
    const invoke = async (recipient: string, key = writer) => (await db.query<{ job: (Job & { recipient: string }) | null }>(
      "select public.claim_instructor_notification_for_recipient($1,$2,$3,$4,$5) job", [alice, key, "mail@example.com", recipient, id],
    )).rows[0].job;
    await expect(invoke("teacher@example.com", bobWriter)).rejects.toThrow("Server writer required");
    for (const recipient of ["", "invalid", "teacher@example.com,other@example.com", "teacher@example.com\nBcc:other@example.com", "teacher@exa\tmple.com"]) {
      await expect(invoke(recipient)).rejects.toThrow("Invalid notification recipient");
    }
    const first = (await invoke("teacher@example.com"))!;
    expect(first.recipient).toBe("teacher@example.com");
    expect(await finish(id, first.attemptId, null)).toBe(true);
    await due(id);
    const retry = (await invoke("different@example.com"))!;
    expect(retry.recipient).toBe("teacher@example.com");
    expect(await finish(id, retry.attemptId, "recipient-test-receipt")).toBe(true);
  });
  it("holds older attempted jobs for review instead of guessing or redirecting their recipient", async () => {
    const id = await submit();
    await asRole("anon", "");
    expect(await claim(id)).not.toBeNull(); // Legacy worker never stored a recipient.
    await due(id);
    const result = await db.query<{ job: Job | null }>("select public.claim_instructor_notification_for_recipient($1,$2,$3,$4,$5) job", [alice, writer, "mail@example.com", "new@example.com", id]);
    expect(result.rows[0].job).toBeNull();
    expect(await queue(id)).toMatchObject({ status: "needs_review" });
  });
  it("schedules signed Edge Function dispatches and keeps secrets out of the HTTP queue", async () => {
    await asRole("postgres");
    expect((await db.query("select jobname,schedule,command from cron.job")).rows).toEqual([
      { jobname: "linqs-instructor-notifications", schedule: "*/5 * * * *", command: "select linqs_private.dispatch_instructor_notifications();" },
    ]);
    expect((await db.query("select * from net.requests")).rows).toHaveLength(0);
    await db.query("insert into vault.decrypted_secrets values ('linqs_notification_project_url',$1),('linqs_notification_worker_key',$2)", ["https://abcdefghijklmnopqrst.supabase.co", writer]);
    const id = await submit();
    await asRole("postgres");
    const req = (await db.query<{ url: string; body: { questionId: string }; headers: Record<string,string>; timeout_ms: number; signed_body: string }>("select *, body::text signed_body from net.requests order by id desc limit 1")).rows[0];
    expect(req.url).toBe("https://abcdefghijklmnopqrst.supabase.co/functions/v1/instructor-notifications");
    expect(req.body).toEqual({ questionId: id });
    expect(req.timeout_ms).toBe(25000);
    const expected = createHmac("sha256", writer).update(`${req.headers["x-linqs-timestamp"]}.${req.signed_body}`).digest("hex");
    expect(req.headers["x-linqs-signature"]).toBe(expected);
    expect(JSON.stringify(req)).not.toContain(writer);
    for (const role of ["anon", "authenticated"]) {
      await asRole(role);
      await expect(db.exec("select linqs_private.dispatch_instructor_notifications()")).rejects.toThrow("permission denied");
    }
  });
  it("rolls back dispatches with the question but preserves the question if HTTP enqueue fails", async () => {
    await asRole("postgres");
    const count = (await db.query<{ count: number }>("select count(*)::int count from net.requests")).rows[0].count;
    await db.exec("begin");
    const rolledBack = await submit();
    await db.exec("rollback");
    await asRole("postgres");
    expect((await db.query("select id from public.instructor_questions where id = $1", [rolledBack])).rows).toHaveLength(0);
    expect((await db.query<{ count: number }>("select count(*)::int count from net.requests")).rows[0].count).toBe(count);
    await db.exec("set test.net_failure = 'yes'");
    const preserved = await submit();
    expect(await queue(preserved)).toMatchObject({ status: "pending", attempts: 0 });
    await db.exec("set test.net_failure = 'no'");
    expect((await db.query<{ count: number }>("select count(*)::int count from net.requests")).rows[0].count).toBe(count);
    await db.exec("select linqs_private.dispatch_instructor_notifications()");
    expect((await db.query<{ count: number }>("select count(*)::int count from net.requests")).rows[0].count).toBe(count + 1);
  });
});
