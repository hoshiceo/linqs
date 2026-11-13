begin;

-- A transactional outbox: a saved question cannot lose its notification on a crash.
-- Do not backfill historical questions when enabling email notifications.
create table linqs_private.instructor_question_notifications (
  question_id uuid primary key references public.instructor_questions(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'needs_review')),
  attempts integer not null default 0,
  attempt_id uuid,
  sender text,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  provider_id text
);
create index instructor_notification_pending_idx
  on linqs_private.instructor_question_notifications(owner_id, next_attempt_at) where status = 'pending';
alter table linqs_private.instructor_question_notifications enable row level security;
revoke all on linqs_private.instructor_question_notifications from public, anon, authenticated, service_role;

create function linqs_private.enqueue_instructor_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into linqs_private.instructor_question_notifications(question_id, owner_id) values(new.id, new.user_id);
  return new;
end;
$$;
revoke all on function linqs_private.enqueue_instructor_notification() from public, anon, authenticated, service_role;
create trigger enqueue_instructor_notification after insert on public.instructor_questions
  for each row execute function linqs_private.enqueue_instructor_notification();

-- The scheduled worker has no student JWT or admin key. Verify the existing
-- server capability for this class before allowing access to its outbox.
create function linqs_private.verify_notification_worker(p_owner_id uuid, p_write_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_owner_id is null or p_write_key is null or p_write_key !~ '^[a-f0-9]{64}$'
    or not exists(select 1 from linqs_private.exchange_writers
      where owner_id = p_owner_id and key_hash = sha256(convert_to(p_write_key, 'UTF8')))
  then raise exception 'Server writer required' using errcode = '42501'; end if;
end;
$$;
revoke all on function linqs_private.verify_notification_worker(uuid, text) from public, anon, authenticated, service_role;

create function public.claim_instructor_notification(
  p_owner_id uuid, p_write_key text, p_sender text, p_question_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_job linqs_private.instructor_question_notifications;
  v_question public.instructor_questions;
begin
  perform linqs_private.verify_notification_worker(p_owner_id, p_write_key);
  if p_sender is null or char_length(btrim(p_sender)) not between 3 and 320
    or p_sender ~ '[\r\n]' then raise exception 'Invalid notification sender' using errcode = '22023'; end if;
  -- Resend retains idempotency keys for 24h. Stop ambiguous retries before that
  -- window expires; an administrator must review them instead of risking duplicates.
  update linqs_private.instructor_question_notifications set status = 'needs_review'
    where owner_id = p_owner_id and status = 'pending' and next_attempt_at <= clock_timestamp()
      and (attempts >= 12 or first_attempt_at <= clock_timestamp() - interval '23 hours');
  select * into v_job from linqs_private.instructor_question_notifications
    where owner_id = p_owner_id and status = 'pending' and next_attempt_at <= clock_timestamp()
      and (p_question_id is null or question_id = p_question_id)
    order by next_attempt_at, question_id limit 1 for update skip locked;
  if v_job.question_id is null then return null; end if;
  update linqs_private.instructor_question_notifications
    set attempts = attempts + 1, attempt_id = gen_random_uuid(),
      sender = coalesce(sender, btrim(p_sender)),
      first_attempt_at = coalesce(first_attempt_at, clock_timestamp()),
      next_attempt_at = clock_timestamp() + interval '2 minutes'
    where question_id = v_job.question_id returning * into v_job;
  select * into strict v_question from public.instructor_questions where id = v_job.question_id;
  return jsonb_build_object('attemptId', v_job.attempt_id, 'sender', v_job.sender,
    'question', jsonb_build_object('id', v_question.id, 'course_id', v_question.course_id,
      'conversation_title', v_question.conversation_title, 'original_question', v_question.original_question,
      'ai_answer', v_question.ai_answer, 'question', v_question.question, 'created_at', v_question.created_at));
end;
$$;

create function public.finish_instructor_notification(
  p_owner_id uuid, p_write_key text, p_question_id uuid, p_attempt_id uuid, p_provider_id text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_updated integer;
begin
  perform linqs_private.verify_notification_worker(p_owner_id, p_write_key);
  if p_provider_id is not null and char_length(btrim(p_provider_id)) not between 1 and 100
  then raise exception 'Invalid provider receipt' using errcode = '22023'; end if;
  update linqs_private.instructor_question_notifications
    set status = case when p_provider_id is not null then 'sent'
      when attempts >= 12 or first_attempt_at <= clock_timestamp() - interval '23 hours' then 'needs_review'
      else 'pending' end,
      sent_at = case when p_provider_id is not null then clock_timestamp() else null end,
      provider_id = p_provider_id,
      next_attempt_at = clock_timestamp() + make_interval(secs => least(3600, 60 * power(2, attempts)::integer))
    where question_id = p_question_id and owner_id = p_owner_id and attempt_id = p_attempt_id and status = 'pending';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;
revoke all on function public.claim_instructor_notification(uuid, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.finish_instructor_notification(uuid, text, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_instructor_notification(uuid, text, text, uuid) to anon, authenticated;
grant execute on function public.finish_instructor_notification(uuid, text, uuid, uuid, text) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
