-- Additive course metadata. Existing history stays unassigned; old seven-argument calls still work.
begin;
alter table public.conversations add column course_id text
  check (course_id in ('website-production', 'pc-ai-skills'));

-- Replace the old signature rather than adding an ambiguous PostgREST overload.
drop function public.save_question_exchange(uuid, text, text, text, text, text, uuid);
create function public.save_question_exchange(
  p_conversation_id uuid, p_title text, p_subject text, p_question text, p_answer text,
  p_write_key text, p_ticket uuid, p_course_id text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ticket uuid; v_id uuid; v_course text;
begin
  perform linqs_private.verify_exchange_writer(p_write_key);
  if p_course_id is not null and p_course_id not in ('website-production', 'pc-ai-skills')
    then raise exception 'Invalid course'; end if;
  if p_conversation_id is not null then
    select course_id into v_course from public.conversations
      where id = p_conversation_id and user_id = auth.uid() for update;
    if not found then raise exception 'Conversation not found'; end if;
    if v_course is distinct from p_course_id then raise exception 'Conversation course cannot change'; end if;
  end if;
  delete from linqs_private.exchange_tickets
    where id = p_ticket and owner_id = auth.uid()
      and created_at > clock_timestamp() - interval '5 minutes'
    returning id into v_ticket;
  if v_ticket is null then raise exception 'Valid unused ticket required' using errcode = '42501'; end if;
  v_id := linqs_private.save_question_exchange(p_conversation_id, p_title, p_subject, p_question, p_answer);
  if p_conversation_id is null then
    update public.conversations set course_id = p_course_id where id = v_id and user_id = auth.uid();
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_question_exchange(uuid, text, text, text, text, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.save_question_exchange(uuid, text, text, text, text, text, uuid, text) to authenticated;
notify pgrst, 'reload schema';
commit;
