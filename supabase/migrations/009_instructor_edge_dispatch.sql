begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Vault holds only the existing notification capability and project URL. The
-- pg_net queue receives a short-lived HMAC signature, never the capability itself.
create function linqs_private.dispatch_instructor_notifications(p_question_id uuid default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
  v_body jsonb;
  v_timestamp text;
  v_signature text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'linqs_notification_project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'linqs_notification_worker_key';
  if v_url is null or v_key is null then return null; end if;
  if v_url !~ '^https://[a-z0-9]{20}\.supabase\.co$' or v_key !~ '^[a-f0-9]{64}$'
  then raise exception 'Invalid notification dispatch configuration'; end if;
  v_body := case when p_question_id is null then '{}'::jsonb else jsonb_build_object('questionId', p_question_id) end;
  v_timestamp := floor(extract(epoch from clock_timestamp()))::bigint::text;
  v_signature := encode(extensions.hmac(convert_to(v_timestamp || '.' || v_body::text, 'UTF8'), convert_to(v_key, 'UTF8'), 'sha256'), 'hex');
  return net.http_post(
    url := v_url || '/functions/v1/instructor-notifications',
    body := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-linqs-timestamp', v_timestamp, 'x-linqs-signature', v_signature),
    timeout_milliseconds := 25000
  );
end;
$$;
revoke all on function linqs_private.dispatch_instructor_notifications(uuid) from public, anon, authenticated, service_role;

create function linqs_private.invoke_instructor_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform linqs_private.dispatch_instructor_notifications(new.question_id);
  exception when others then
    -- A failed HTTP enqueue must not roll back a student's question or outbox.
    raise warning 'Instructor notification dispatch deferred to scheduled retry';
  end;
  return new;
end;
$$;
revoke all on function linqs_private.invoke_instructor_notification() from public, anon, authenticated, service_role;
create trigger invoke_instructor_notification after insert on linqs_private.instructor_question_notifications
  for each row execute function linqs_private.invoke_instructor_notification();

select cron.schedule('linqs-instructor-notifications', '*/5 * * * *',
  'select linqs_private.dispatch_instructor_notifications();');
commit;
