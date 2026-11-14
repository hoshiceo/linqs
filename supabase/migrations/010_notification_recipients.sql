-- Pin recipients per notification so retries retain the same idempotent payload.
-- Deploy this migration before the updated Edge Function. No historical email
-- address is inferred or backfilled from a particular installation.
begin;
alter table linqs_private.instructor_question_notifications add column recipient text
  check (recipient is null or (char_length(recipient) between 3 and 254 and recipient !~ '[[:space:],<>]' and recipient ~ '^[^@]+@[^@]+\.[^@]+$'));

create function public.claim_instructor_notification_for_recipient(
  p_owner_id uuid, p_write_key text, p_sender text, p_recipient text, p_question_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_job jsonb; v_recipient text;
begin
  perform linqs_private.verify_notification_worker(p_owner_id, p_write_key);
  if p_recipient is null or char_length(btrim(p_recipient)) not between 3 and 254
    or btrim(p_recipient) ~ '[[:space:],<>]' or btrim(p_recipient) !~ '^[^@]+@[^@]+\.[^@]+$'
    then raise exception 'Invalid notification recipient' using errcode = '22023'; end if;

  -- Older attempted jobs have no trustworthy recipient snapshot. An administrator
  -- must reconcile their provider receipts; never silently redirect these retries.
  update linqs_private.instructor_question_notifications set status = 'needs_review'
    where owner_id = p_owner_id and status = 'pending' and attempts > 0 and recipient is null;
  v_job := public.claim_instructor_notification(p_owner_id, p_write_key, p_sender, p_question_id);
  if v_job is null then return null; end if;
  update linqs_private.instructor_question_notifications
    set recipient = coalesce(recipient, btrim(p_recipient))
    where question_id = (v_job->'question'->>'id')::uuid and owner_id = p_owner_id
    returning recipient into v_recipient;
  return v_job || jsonb_build_object('recipient', v_recipient);
end;
$$;
revoke all on function public.claim_instructor_notification_for_recipient(uuid, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_instructor_notification_for_recipient(uuid, text, text, text, uuid) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
