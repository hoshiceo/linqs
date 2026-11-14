import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
let db: PGlite;

async function asRole(role: "anon" | "authenticated" | "service_role", accountId = "") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [accountId]);
  await db.exec(`set role ${role}`);
}

async function addEntry(question: string, answer = "カレーです。", active = true) {
  return db.query<{ id: string }>(
    "insert into public.knowledge_entries(question, answer, is_active) values ($1, $2, $3) returning id",
    [question, answer, active],
  );
}

describe("Supplemental knowledge migration: shared reading and administrator writes", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      insert into auth.users values ('${userId}'), ('${otherUserId}');
      -- Supabase projects can have default grants; the migration must revoke them.
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    `);
    await db.exec(readFileSync(new URL("../supabase/migrations/005_knowledge_entries.sql", import.meta.url), "utf8"));
    await asRole("service_role");
    await addEntry("サンプル先生の好きな食べ物は？");
    await addEntry("非公開の小ネタ", "下書きです。", false);
    await addEntry("開校時間は？", "午前9時です。");
  });
  afterEach(async () => { await db.exec("reset role"); });
  afterAll(async () => { await db.close(); });

  it("exposes the same active entries to every authenticated account and hides drafts", async () => {
    await asRole("authenticated", userId);
    const query = "select question, answer from public.knowledge_entries order by question";
    const result = await db.query<{ question: string; answer: string }>(query);
    expect(result.rows).toHaveLength(2);
    expect(result.rows).toEqual(expect.arrayContaining([
      { question: "サンプル先生の好きな食べ物は？", answer: "カレーです。" },
      { question: "開校時間は？", answer: "午前9時です。" },
    ]));
    await asRole("authenticated", otherUserId);
    expect((await db.query(query)).rows).toEqual(result.rows);
  });

  it("denies anonymous reads and writes even with inherited default grants", async () => {
    await asRole("anon");
    await expect(db.exec("select * from public.knowledge_entries")).rejects.toThrow("permission denied");
    await expect(addEntry("偽の小ネタ")).rejects.toThrow("permission denied");
    await expect(db.exec("update public.knowledge_entries set answer = '偽情報'")).rejects.toThrow("permission denied");
    await expect(db.exec("delete from public.knowledge_entries")).rejects.toThrow("permission denied");
  });

  it("prevents students from adding, editing, deleting or truncating shared knowledge", async () => {
    await asRole("authenticated", userId);
    await expect(addEntry("偽の小ネタ")).rejects.toThrow("permission denied");
    await expect(db.exec("update public.knowledge_entries set answer = '偽情報'")).rejects.toThrow("permission denied");
    await expect(db.exec("update public.knowledge_entries set is_active = true")).rejects.toThrow("permission denied");
    await expect(db.exec("delete from public.knowledge_entries")).rejects.toThrow("permission denied");
    await expect(db.exec("truncate public.knowledge_entries")).rejects.toThrow("permission denied");
  });

  it("lets an administrator manage entries and updates the modification timestamp", async () => {
    await asRole("service_role");
    expect((await db.query("select * from public.knowledge_entries")).rows).toHaveLength(3);
    const { rows: [entry] } = await addEntry("更新・削除の確認");
    const { rows: [original] } = await db.query<{ created_at: Date; updated_at: Date }>(
      "select created_at, updated_at from public.knowledge_entries where id = $1", [entry.id],
    );
    const { rows: [updated] } = await db.query<{ created_at: Date; updated_at: Date }>(
      "update public.knowledge_entries set answer = $1, is_active = false, updated_at = '2000-01-01' where id = $2 returning created_at, updated_at",
      ["変更後の情報です。", entry.id],
    );
    expect(updated.created_at).toEqual(original.created_at);
    expect(updated.updated_at.getTime()).toBeGreaterThan(original.updated_at.getTime());
    await asRole("authenticated", userId);
    expect((await db.query("select * from public.knowledge_entries where id = $1", [entry.id])).rows).toHaveLength(0);
    await asRole("service_role");
    await db.query("delete from public.knowledge_entries where id = $1", [entry.id]);
    expect((await db.query("select * from public.knowledge_entries where id = $1", [entry.id])).rows).toHaveLength(0);
  });

  it("rejects blank or oversized facts and duplicate questions across the shared knowledge", async () => {
    await asRole("service_role");
    for (const question of ["", " \n\t", "あ".repeat(501)]) {
      await expect(addEntry(question)).rejects.toThrow("check constraint");
    }
    for (const answer of ["", " \n\t", "あ".repeat(3001)]) {
      await expect(addEntry("入力検証", answer)).rejects.toThrow("check constraint");
    }
    await expect(addEntry("サンプル先生の好きな食べ物は？")).rejects.toThrow("unique constraint");
    await expect(addEntry("あ".repeat(500), "あ".repeat(3000))).resolves.toBeDefined();
  });

  it("retains shared knowledge when an account is deleted", async () => {
    const before = await db.query("select * from public.knowledge_entries order by id");
    await db.query("delete from auth.users where id = $1", [userId]);
    expect((await db.query("select * from public.knowledge_entries order by id")).rows).toEqual(before.rows);
    await asRole("authenticated", otherUserId);
    expect((await db.query("select answer from public.knowledge_entries where question = $1", ["サンプル先生の好きな食べ物は？"])).rows).toEqual([{ answer: "カレーです。" }]);
  });
});
