-- RegulaQuest · 08 · Komentář převzatý z jiné jazykové verze
-- U převzatého komentáře se pamatuje, ze kterého komentáře vznikl a jaké měl tehdy znění.
-- Když se originál později změní, Studio na to upozorní; po kontrole lze překlad označit jako aktuální.
-- Lze spustit opakovaně.

alter table public.comments add column if not exists translated_from text not null default '';
alter table public.comments add column if not exists source_body text not null default '';

drop function if exists public.rq_new_comment(text, text, text, text, text);
create or replace function public.rq_new_comment(p_unit_id text, p_kind text, p_language text, p_body text,
  p_author text default '', p_translated_from text default '') returns text
language plpgsql security definer set search_path = public as $$
declare v_id text := rq_private.token('comment'); u public.units := rq_private.unit_row(p_unit_id); src public.comments;
begin
  perform rq_private.require_admin();
  if u.archived then raise exception 'K archivované části nelze přidat komentář'; end if;
  if coalesce(p_translated_from, '') <> '' then
    select * into src from public.comments where id = p_translated_from;
    if not found then raise exception 'Původní komentář nebyl nalezen'; end if;
  end if;
  insert into public.comments(id, unit_id, kind, language, body, author, created_by, updated_by, translated_from, source_body)
  values (v_id, p_unit_id, p_kind, p_language, btrim(p_body), btrim(coalesce(p_author, '')), auth.uid(), auth.uid(),
          coalesce(src.id, ''), coalesce(src.body, ''));
  perform rq_private.log_comment(v_id, 'created', null, to_jsonb(rq_private.comment_row(v_id)));
  return v_id;
end $$;

-- Překlad zkontrolován proti aktuálnímu originálu.
create or replace function public.rq_mark_translation_current(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.comments := rq_private.comment_row(p_id); src public.comments;
begin
  perform rq_private.require_admin();
  select * into src from public.comments where id = c.translated_from;
  if not found then raise exception 'Komentář nevznikl převzetím nebo originál neexistuje'; end if;
  update public.comments set source_body = src.body where id = p_id;
  perform rq_private.log_comment(p_id, 'translation_checked', to_jsonb(c), to_jsonb(rq_private.comment_row(p_id)));
end $$;

revoke all on function public.rq_new_comment(text, text, text, text, text, text) from public, anon;
revoke all on function public.rq_mark_translation_current(text) from public, anon;
grant execute on function public.rq_new_comment(text, text, text, text, text, text) to authenticated;
grant execute on function public.rq_mark_translation_current(text) to authenticated;
