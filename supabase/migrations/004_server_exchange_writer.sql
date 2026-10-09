-- Apply after 003. A class JWT alone must never authorize model-history writes.
begin;
create schema linqs_private;
revoke all on schema linqs_private from public, anon, authenticated, service_role;

create table linqs_private.exchange_writers (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  key_hash bytea not null check (octet_length(key_hash) = 32)
);
create table linqs_private.exchange_tickets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create index exchange_tickets_owner_idx on linqs_private.exchange_tickets(owner_id);
alter table linqs_private.exchange_writers enable row level security;
alter table linqs_private.exchange_tickets enable row level security;
revoke all on linqs_private.exchange_writers, linqs_private.exchange_tickets from public, anon, authenticated, service_role;

-- Administrator provisioning only; store a digest rather than the runtime key.
create function public.configure_exchange_writer(p_owner_id uuid, p_write_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_write_key is null or p_write_key !~ '^[a-f0-9]{64}$' then raise exception 'Invalid writer key'; end if;
  insert into linqs_private.exchange_writers(owner_id, key_hash)
  values(p_owner_id, sha256(convert_to(p_write_key, 'UTF8')))
  on conflict(owner_id) do update set key_hash = excluded.key_hash;
  delete from linqs_private.exchange_tickets where owner_id = p_owner_id;
end;
$$;
revoke all on function public.configure_exchange_writer(uuid, text) from public, anon, authenticated;
grant execute on function public.configure_exchange_writer(uuid, text) to service_role;

create function linqs_private.verify_exchange_writer(p_write_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_write_key is null or p_write_key !~ '^[a-f0-9]{64}$'
    or not exists(select 1 from linqs_private.exchange_writers
      where owner_id = auth.uid() and key_hash = sha256(convert_to(p_write_key, 'UTF8')))
  then raise exception 'Server writer required' using errcode = '42501'; end if;
end;
$$;
revoke all on function linqs_private.verify_exchange_writer(text) from public, anon, authenticated, service_role;

-- Retain validation and existing history; remove the old public write entry point.
revoke all on function public.save_question_exchange(uuid, text, text, text, text) from public, anon, authenticated, service_role;
alter function public.save_question_exchange(uuid, text, text, text, text) set schema linqs_private;
revoke all on function public.consume_question_quota() from public, anon, authenticated, service_role;

create function public.reserve_question_exchange(p_write_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ticket uuid;
begin
  perform linqs_private.verify_exchange_writer(p_write_key);
  delete from linqs_private.exchange_tickets
    where owner_id = auth.uid() and created_at <= clock_timestamp() - interval '5 minutes';
  if not public.consume_question_quota() then return null; end if;
  insert into linqs_private.exchange_tickets(owner_id) values(auth.uid()) returning id into v_ticket;
  return v_ticket;
end;
$$;

create function public.save_question_exchange(
  p_conversation_id uuid, p_title text, p_subject text, p_question text, p_answer text,
  p_write_key text, p_ticket uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ticket uuid;
begin
  perform linqs_private.verify_exchange_writer(p_write_key);
  -- DELETE locks the ticket: simultaneous/replayed saves cannot spend it twice.
  delete from linqs_private.exchange_tickets
    where id = p_ticket and owner_id = auth.uid()
      and created_at > clock_timestamp() - interval '5 minutes'
    returning id into v_ticket;
  if v_ticket is null then raise exception 'Valid unused ticket required' using errcode = '42501'; end if;
  return linqs_private.save_question_exchange(p_conversation_id, p_title, p_subject, p_question, p_answer);
end;
$$;
revoke all on function public.reserve_question_exchange(text) from public, anon, authenticated, service_role;
revoke all on function public.save_question_exchange(uuid, text, text, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.reserve_question_exchange(text) to authenticated;
grant execute on function public.save_question_exchange(uuid, text, text, text, text, text, uuid) to authenticated;
commit;
