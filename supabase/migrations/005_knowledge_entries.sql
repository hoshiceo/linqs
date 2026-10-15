-- Shared supplemental facts and FAQs. Apply after 004.
-- Schema only: chat retrieval and an editing screen are separate changes.
begin;

create table public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(question) <= 500 and question ~ '[^[:space:]]'),
  answer text not null check (char_length(answer) <= 3000 and answer ~ '[^[:space:]]'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question)
);

comment on table public.knowledge_entries is '全利用者共通の追加知識・小ネタ・FAQ。回答への参照処理は別途必要。';
comment on column public.knowledge_entries.question is '例：理恵子先生の好きな食べ物は？';
comment on column public.knowledge_entries.answer is '例：想夫恋の焼きそばです。';
comment on column public.knowledge_entries.is_active is 'falseにすると生徒からの読み取り対象外';

alter table public.knowledge_entries enable row level security;
create policy "Read active shared knowledge" on public.knowledge_entries
  for select to authenticated
  using (is_active);

-- A student login must not authorize knowledge edits.
revoke all on public.knowledge_entries from public, anon, authenticated;
grant select on public.knowledge_entries to authenticated;
grant select, insert, update, delete on public.knowledge_entries to service_role;

create function public.set_knowledge_entry_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
revoke all on function public.set_knowledge_entry_updated_at() from public, anon, authenticated, service_role;
create trigger knowledge_entries_updated_at
  before update on public.knowledge_entries
  for each row execute function public.set_knowledge_entry_updated_at();

commit;
