-- Upgrade the learning fields without deleting existing questions or answers.
begin;
alter table public.conversations drop constraint if exists conversations_subject_check;
update public.conversations
set subject = 'すべて'
where subject not in ('すべて', 'AI活用', 'Excel VBA');
alter table public.conversations
  add constraint conversations_subject_check check (subject in ('すべて', 'AI活用', 'Excel VBA'));
commit;
