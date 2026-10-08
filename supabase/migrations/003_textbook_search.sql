-- Private textbook retrieval. Run after 001 and 002.
begin;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table public.textbook_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  filename text not null check (char_length(filename) between 1 and 200),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  source_format text not null check (source_format in ('pdf', 'docx')),
  page_count integer not null check (page_count > 0),
  ocr_pages integer not null check (ocr_pages between 0 and page_count),
  embedding_model text not null default 'gemini-embedding-001' check (embedding_model = 'gemini-embedding-001'),
  imported_at timestamptz not null default now(),
  unique(owner_id, filename)
);
create table public.textbook_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.textbook_documents(id) on delete cascade,
  page integer not null check (page > 0),
  position integer not null check (position >= 0),
  content text not null check (char_length(content) between 1 and 2000),
  extraction_method text not null check (extraction_method in ('text', 'ocr')),
  embedding extensions.vector(768) not null,
  unique(document_id, page, position)
);
create index textbook_chunks_document_idx on public.textbook_chunks(document_id);
create index textbook_chunks_embedding_idx on public.textbook_chunks using hnsw (embedding extensions.vector_cosine_ops);
alter table public.textbook_documents enable row level security;
alter table public.textbook_chunks enable row level security;
create policy "Read class textbooks" on public.textbook_documents for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Read class textbook excerpts" on public.textbook_chunks for select to authenticated
  using (exists (select 1 from public.textbook_documents d where d.id = document_id and d.owner_id = (select auth.uid())));
revoke all on public.textbook_documents, public.textbook_chunks from anon, authenticated;
grant select on public.textbook_documents, public.textbook_chunks to authenticated;
grant all on public.textbook_documents, public.textbook_chunks to service_role;
grant usage on schema extensions to authenticated, service_role;

create function public.textbook_catalog()
returns table(filename text, page_count integer, source_format text)
language sql stable security invoker set search_path = '' as $$
  select d.filename, d.page_count, d.source_format from public.textbook_documents d
  where d.owner_id = (select auth.uid()) order by d.filename;
$$;

create function public.match_textbook_chunks(
  p_embedding extensions.vector(768), p_count integer default 6,
  p_min_similarity double precision default 0.45, p_filename text default null, p_page integer default null
) returns table(id uuid, filename text, page integer, content text, extraction_method text, source_format text, similarity double precision)
language sql stable security invoker set search_path = '' as $$
  select c.id, d.filename, c.page, c.content, c.extraction_method, d.source_format,
    1 - (c.embedding operator(extensions.<=>) p_embedding) as similarity
  from public.textbook_chunks c join public.textbook_documents d on d.id = c.document_id
  where d.owner_id = (select auth.uid())
    and (p_filename is null or d.filename = p_filename)
    and (p_page is null or c.page = p_page)
    and 1 - (c.embedding operator(extensions.<=>) p_embedding) >= p_min_similarity
  order by c.embedding operator(extensions.<=>) p_embedding
  limit least(greatest(p_count, 1), 12);
$$;

-- Only a local administrator can import or replace a document. Replacement is atomic.
create function public.replace_textbook_document(
  p_owner_id uuid, p_filename text, p_hash text, p_format text,
  p_page_count integer, p_ocr_pages integer, p_chunks jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if jsonb_array_length(p_chunks) = 0 then raise exception 'No textbook excerpts'; end if;
  insert into public.textbook_documents(owner_id, filename, content_hash, source_format, page_count, ocr_pages)
  values(p_owner_id, p_filename, p_hash, p_format, p_page_count, p_ocr_pages)
  on conflict(owner_id, filename) do update set
    content_hash = excluded.content_hash, source_format = excluded.source_format,
    page_count = excluded.page_count, ocr_pages = excluded.ocr_pages, imported_at = now()
  returning id into v_id;
  delete from public.textbook_chunks where document_id = v_id;
  insert into public.textbook_chunks(document_id, page, position, content, extraction_method, embedding)
  select v_id, r.page, r.position, r.content, r.extraction_method, r.embedding::extensions.vector(768)
  from jsonb_to_recordset(p_chunks) as r(page integer, position integer, content text, extraction_method text, embedding text);
  if exists(select 1 from public.textbook_chunks where document_id = v_id and page > p_page_count) then raise exception 'Invalid page'; end if;
  return v_id;
end;
$$;
revoke all on function public.textbook_catalog() from public, anon;
revoke all on function public.match_textbook_chunks(extensions.vector, integer, double precision, text, integer) from public, anon;
revoke all on function public.replace_textbook_document(uuid, text, text, text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.textbook_catalog() to authenticated;
grant execute on function public.match_textbook_chunks(extensions.vector, integer, double precision, text, integer) to authenticated;
grant execute on function public.replace_textbook_document(uuid, text, text, text, integer, integer, jsonb) to service_role;
commit;
