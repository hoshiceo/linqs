begin;

-- Snapshot the referenced exchange so instructors can still read it after history deletion.
create table public.instructor_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_message_id uuid unique references public.messages(id) on delete set null,
  course_id text,
  conversation_title text not null,
  original_question text not null,
  ai_answer text not null,
  question text not null check (char_length(btrim(question)) between 1 and 2000),
  reply text check (reply is null or char_length(btrim(reply)) between 1 and 10000),
  created_at timestamptz not null default clock_timestamp(),
  replied_at timestamptz
);
create index instructor_questions_user_created_idx on public.instructor_questions(user_id, created_at desc);
alter table public.instructor_questions enable row level security;
create policy "Read class instructor questions" on public.instructor_questions for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.instructor_questions from public, anon, authenticated, service_role;
grant select on public.instructor_questions to authenticated, service_role;
grant update(reply) on public.instructor_questions to service_role;

create function linqs_private.stamp_instructor_reply() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.reply is distinct from old.reply then
    new.replied_at = case when new.reply is null then null else clock_timestamp() end;
  end if;
  return new;
end;
$$;
revoke all on function linqs_private.stamp_instructor_reply() from public, anon, authenticated, service_role;
create trigger instructor_reply_timestamp before update on public.instructor_questions
  for each row execute function linqs_private.stamp_instructor_reply();

create function public.submit_instructor_question(
  p_conversation_id uuid, p_message_index integer, p_question text, p_context_hash text, p_write_key text
) returns public.instructor_questions
language plpgsql security definer set search_path = '' as $$
declare
  v_conversation public.conversations;
  v_message public.messages;
  v_original text;
  v_result public.instructor_questions;
begin
  perform linqs_private.verify_exchange_writer(p_write_key);
  if p_message_index is null or p_message_index < 0 or p_message_index > 10000
    or p_context_hash is null or p_context_hash !~ '^[a-f0-9]{64}$'
    or p_question is null or char_length(btrim(p_question)) not between 1 and 2000
  then raise exception 'Invalid instructor question' using errcode = '22023'; end if;
  -- Serialize duplicate checks and the class-wide limit across server instances.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 7));
  select * into v_conversation from public.conversations
    where id = p_conversation_id and user_id = auth.uid();
  if v_conversation.id is null then raise exception 'Answer not found' using errcode = 'P0002'; end if;
  select * into v_message from public.messages where conversation_id = v_conversation.id
    order by created_at, id offset p_message_index limit 1;
  if v_message.id is null or v_message.role <> 'assistant' then
    raise exception 'Answer not found' using errcode = 'P0002';
  end if;
  select content into v_original from public.messages
    where conversation_id = v_conversation.id and role = 'user'
      and (created_at, id) < (v_message.created_at, v_message.id)
    order by created_at desc, id desc limit 1;
  if v_original is null then raise exception 'Answer not found' using errcode = 'P0002'; end if;
  if encode(sha256(convert_to(v_original || chr(31) || v_message.content, 'UTF8')), 'hex') <> p_context_hash then
    raise exception 'Answer changed' using errcode = '40001';
  end if;
  select * into v_result from public.instructor_questions where source_message_id = v_message.id;
  if v_result.id is not null then return v_result; end if;
  if (select count(*) from public.instructor_questions
    where user_id = auth.uid() and created_at > clock_timestamp() - interval '1 hour') >= 10
  then raise exception 'Instructor question limit' using errcode = 'P0001'; end if;

  insert into public.instructor_questions(user_id, source_message_id, course_id, conversation_title, original_question, ai_answer, question)
    values(auth.uid(), v_message.id, v_conversation.course_id, v_conversation.title, v_original, v_message.content, btrim(p_question))
    returning * into v_result;
  return v_result;
end;
$$;
revoke all on function public.submit_instructor_question(uuid, integer, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.submit_instructor_question(uuid, integer, text, text, text) to authenticated;
-- Refresh the API schema after the new table and RPC become visible at commit.
notify pgrst, 'reload schema';
commit;
