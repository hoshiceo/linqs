-- Run once in Supabase SQL Editor, or apply using `supabase db push`.
begin;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 50),
  subject text not null default 'すべて' check (subject in ('すべて', 'AI活用', 'Excel VBA')),
  bookmarked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 20000),
  created_at timestamptz not null default clock_timestamp()
);

create table public.question_quotas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(),
  attempts integer not null default 0
);

create index conversations_user_updated_idx on public.conversations(user_id, updated_at desc);
create index messages_conversation_created_idx on public.messages(conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.question_quotas enable row level security;

create policy "Read own conversations" on public.conversations for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Update own conversations" on public.conversations for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own conversations" on public.conversations for delete to authenticated
  using ((select auth.uid()) = user_id);
create policy "Read own messages" on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = (select auth.uid())));

-- Only the quota function accesses this table. The UPSERT serializes simultaneous requests.
create function public.consume_question_quota() returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_attempts integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.question_quotas(user_id, window_start, attempts)
  values(auth.uid(), now(), 1)
  on conflict(user_id) do update set
    window_start = case when public.question_quotas.window_start <= now() - interval '1 hour' then now() else public.question_quotas.window_start end,
    attempts = case when public.question_quotas.window_start <= now() - interval '1 hour' then 1 else least(public.question_quotas.attempts + 1, 31) end
  returning attempts into v_attempts;
  return v_attempts <= 30;
end;
$$;

-- Own-ID verification and both message inserts are a single transaction.
create function public.save_question_exchange(
  p_conversation_id uuid, p_title text, p_subject text, p_question text, p_answer text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(p_question) not between 1 and 3000 then raise exception 'Invalid question'; end if;
  if char_length(p_answer) not between 1 and 20000 then raise exception 'Invalid answer'; end if;
  if p_conversation_id is null then
    insert into public.conversations(user_id, title, subject)
    values(auth.uid(), p_title, p_subject) returning id into v_id;
  else
    select id into v_id from public.conversations
    where id = p_conversation_id and user_id = auth.uid() for update;
    if v_id is null then raise exception 'Conversation not found'; end if;
    update public.conversations set updated_at = now(), subject = p_subject where id = v_id;
  end if;
  insert into public.messages(conversation_id, role, content, created_at)
  values (v_id, 'user', p_question, clock_timestamp()),
         (v_id, 'assistant', p_answer, clock_timestamp() + interval '1 microsecond');
  return v_id;
end;
$$;

revoke all on public.conversations, public.messages, public.question_quotas from anon, authenticated;
grant select, delete on public.conversations to authenticated;
grant update(bookmarked) on public.conversations to authenticated;
grant select on public.messages to authenticated;
revoke all on function public.consume_question_quota() from public, anon;
revoke all on function public.save_question_exchange(uuid, text, text, text, text) from public, anon;
grant execute on function public.consume_question_quota() to authenticated;
grant execute on function public.save_question_exchange(uuid, text, text, text, text) to authenticated;

commit;
