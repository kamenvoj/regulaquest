-- RegulaQuest · 10 · Poznámky ukotvené k textu a klíčové pasáže
-- Komentář může být ukotven k vybranému úseku textu (přesné znění + pořadí výskytu v části).
-- Nový druh „key“ = klíčová pasáž (zvýraznění ve čtečce); prochází stejným schvalováním jako komentář.
-- Lze spustit opakovaně.

alter table public.comments add column if not exists anchor_text text not null default '';
alter table public.comments add column if not exists anchor_occurrence int not null default 1;
alter table public.comments drop constraint if exists comments_kind_check;
alter table public.comments add constraint comments_kind_check
  check (kind in ('explanation', 'warning', 'example', 'definition', 'reference', 'key'));
alter table public.comments drop constraint if exists comments_anchor_check;
alter table public.comments add constraint comments_anchor_check
  check (length(anchor_text) <= 1000 and anchor_occurrence between 1 and 500 and (kind <> 'key' or anchor_text <> ''));

drop function if exists public.rq_new_comment(text, text, text, text, text);
drop function if exists public.rq_new_comment(text, text, text, text, text, text);
create or replace function public.rq_new_comment(p_unit_id text, p_kind text, p_language text, p_body text,
  p_author text default '', p_translated_from text default '', p_anchor_text text default '', p_anchor_occurrence int default 1)
returns text
language plpgsql security definer set search_path = public as $$
declare v_id text := rq_private.token('comment'); u public.units := rq_private.unit_row(p_unit_id); src public.comments;
        v_anchor text := btrim(regexp_replace(coalesce(p_anchor_text, ''), '\s+', ' ', 'g'));
        v_body text := btrim(coalesce(p_body, ''));
begin
  perform rq_private.require_admin();
  if u.archived then raise exception 'K archivované části nelze přidat komentář'; end if;
  if p_kind = 'key' and v_anchor = '' then raise exception 'Klíčová pasáž musí mít vybraný text'; end if;
  if p_kind = 'key' and v_body = '' then v_body := 'Klíčová pasáž'; end if;
  if v_anchor <> '' and position(v_anchor in regexp_replace(coalesce(u.body, '') || ' ' || regexp_replace(coalesce(u.content_blocks::text, ''), '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')) = 0 then
    raise exception 'Vybraný text v ustanovení nebyl nalezen. Načtěte aktuální znění a vyberte ho znovu.';
  end if;
  if coalesce(p_translated_from, '') <> '' then
    select * into src from public.comments where id = p_translated_from;
    if not found then raise exception 'Původní komentář nebyl nalezen'; end if;
  end if;
  insert into public.comments(id, unit_id, kind, language, body, author, created_by, updated_by, translated_from, source_body,
                              anchor_text, anchor_occurrence)
  values (v_id, p_unit_id, p_kind, p_language, v_body, btrim(coalesce(p_author, '')), auth.uid(), auth.uid(),
          coalesce(src.id, ''), coalesce(src.body, ''), v_anchor, greatest(1, coalesce(p_anchor_occurrence, 1)));
  perform rq_private.log_comment(v_id, 'created', null, to_jsonb(rq_private.comment_row(v_id)));
  return v_id;
end $$;

create or replace function public.rq_propose_comment_revision(p_id text, p_change_type text, p_reason text,
  p_kind text default null, p_language text default null, p_body text default null, p_author text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.comments := rq_private.comment_row(p_id); v_rev text := rq_private.token('crev');
        k text; l text; b text; a text;
begin
  perform rq_private.require_admin();
  if p_change_type not in ('edit', 'archive', 'restore') then raise exception 'Neplatný druh změny'; end if;
  if p_change_type in ('edit', 'archive') and c.status <> 'approved' then raise exception 'Upravovat nebo archivovat lze jen schválený komentář'; end if;
  if p_change_type = 'restore' and (c.status <> 'archived' or not rq_private.comment_was_approved(p_id)) then
    raise exception 'Takto lze obnovit pouze dříve schválený komentář';
  end if;
  if coalesce(btrim(p_reason), '') = '' or length(p_reason) > 3000 then raise exception 'Uveďte důvod změny do 3000 znaků'; end if;
  if p_change_type = 'edit' then
    k := coalesce(p_kind, c.kind); l := coalesce(p_language, c.language);
    b := btrim(coalesce(p_body, c.body)); a := btrim(coalesce(p_author, c.author));
    if (k, l, b, a) = (c.kind, c.language, c.body, c.author) then raise exception 'Obsah komentáře se nezměnil'; end if;
    if k not in ('explanation', 'warning', 'example', 'definition', 'reference', 'key') or l not in ('cs', 'en')
       or b = '' or length(b) > 15000 or length(a) > 200 then raise exception 'Neplatný obsah komentáře'; end if;
  else
    k := c.kind; l := c.language; b := c.body; a := c.author;
  end if;
  insert into public.comment_revisions(id, comment_id, change_type, kind, language, body, author, change_reason, base_updated_at, created_by)
  values (v_rev, p_id, p_change_type, k, l, b, a, btrim(p_reason), c.updated_at, auth.uid());
  perform rq_private.log_comment(p_id, 'revision_proposed', to_jsonb(c), to_jsonb(c));
  return v_rev;
exception when unique_violation then
  raise exception 'U komentáře už čeká návrh změny';
end $$;

create or replace function rq_private.reader_data(p_draft boolean) returns jsonb
language sql stable set search_path = public as $$
  with recursive live as (select * from public.units where not archived),
  good as (select id from live where btrim(body) <> '' and (p_draft or text_status = 'verified')),
  anc as (
    select l.parent_id as id from live l join good g on g.id = l.id where l.parent_id is not null
    union
    select l.parent_id from live l join anc a on a.id = l.id where l.parent_id is not null),
  included as (select id from good union select a.id from anc a join live l on l.id = a.id),
  u as (
    select l.*, (l.id not in (select id from good)) as nav from live l where l.id in (select id from included)),
  docs as (select * from public.documents where id in (select document_id from u)),
  rel as (select * from public.relations where status = any(case when p_draft then array['approved','proposed'] else array['approved'] end)
          and source_id in (select id from good) and target_id in (select id from good)),
  com as (select * from public.comments where status = any(case when p_draft then array['approved','draft'] else array['approved'] end)
          and unit_id in (select id from good))
  select jsonb_build_object(
    'format', 'regulaquest-education-v1',
    'mode', case when p_draft then 'draft' else 'published' end,
    'published_at', now(),
    'notice', 'Legislativní texty jsou informační kopií. Ověřujte aktuální oficiální znění a právní závaznost zdrojů.',
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'family', family, 'kind', kind,
        'language', language, 'version', version, 'valid_date', valid_date, 'publisher', publisher, 'url', url,
        'group_key', group_key, 'jurisdiction', jurisdiction, 'document_type', document_type, 'topics', topics) order by id) from docs), '[]'),
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'document_id', document_id, 'parent_id', parent_id,
        'kind', kind, 'label', label,
        'heading', heading,
        'body', case when nav then '' else body end,
        'content_blocks', case when nav then null else content_blocks end,
        'locator', locator,
        'text_status', case when nav then 'navigation_only' else text_status end,
        'sort_order', sort_order, 'navigation_only', nav) order by document_id, sort_order, id) from u), '[]'),
    'relations', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'source_id', source_id, 'target_id', target_id,
        'relation_type', relation_type, 'rationale', rationale, 'status', status) order by id) from rel), '[]'),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'unit_id', unit_id, 'kind', kind, 'language', language,
        'body', body, 'author', author, 'status', status, 'updated_at', updated_at,
        'anchor_text', anchor_text, 'anchor_occurrence', anchor_occurrence) order by id) from com), '[]'),
    'counts', jsonb_build_object('documents', (select count(*) from docs), 'units', (select count(*) from u),
        'verified_units', (select count(*) from good), 'navigation_units', (select count(*) from u where nav),
        'relations', (select count(*) from rel), 'comments', (select count(*) from com)))
$$;

revoke all on function public.rq_new_comment(text, text, text, text, text, text, text, int) from public, anon;
grant execute on function public.rq_new_comment(text, text, text, text, text, text, text, int) to authenticated;
