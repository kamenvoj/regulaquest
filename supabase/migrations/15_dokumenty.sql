-- RegulaQuest · 15 · Archivace a smazání dokumentu
-- Archivace: dokument zmizí z katalogu a čtečky (příští publikace), vše zůstane a lze ho obnovit.
-- Smazání: jen pro omyly – dokument nesmí být v žádné publikaci a nesmí mít schválené komentáře, vazby ani pojmy.
-- Soubory v úložišti maže Studio po úspěšném smazání (proto pravidla pro mazání v úložišti pro adminy). Lze spustit opakovaně.

alter table public.documents add column if not exists archived boolean not null default false;

create or replace function public.rq_archive_document(p_id text, p_archived boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  update public.documents set archived = p_archived, updated_at = now(), updated_by = auth.uid() where id = p_id;
  if not found then raise exception 'Dokument nebyl nalezen'; end if;
end $$;

create or replace function public.rq_delete_document(p_id text, p_confirm_title text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.documents; n_units int;
begin
  perform rq_private.require_admin();
  select * into d from public.documents where id = p_id;
  if not found then raise exception 'Dokument nebyl nalezen'; end if;
  if btrim(coalesce(p_confirm_title, '')) <> btrim(d.title) then
    raise exception 'Pro potvrzení opište přesně název dokumentu.';
  end if;
  if exists (select 1 from public.publications p where p.data->'documents' @> jsonb_build_array(jsonb_build_object('id', p_id))) then
    raise exception 'Dokument už byl publikován studentům – nelze ho smazat, jen archivovat.';
  end if;
  create temporary table if not exists _rq_del_units(id text primary key) on commit drop;
  truncate _rq_del_units;
  insert into _rq_del_units select id from public.units where document_id = p_id;
  if exists (select 1 from public.comments where unit_id in (select id from _rq_del_units) and status = 'approved') then
    raise exception 'Dokument má schválené komentáře – nelze ho smazat, jen archivovat.';
  end if;
  if exists (select 1 from public.relations where (source_id in (select id from _rq_del_units) or target_id in (select id from _rq_del_units)) and status = 'approved') then
    raise exception 'Dokument má schválené vazby (i z jiných dokumentů) – nelze ho smazat, jen archivovat.';
  end if;
  if exists (select 1 from public.terms where unit_id in (select id from _rq_del_units) and status = 'approved') then
    raise exception 'Dokument má schválené pojmy – nejdřív je vyřaďte, nebo dokument jen archivujte.';
  end if;
  select count(*) into n_units from _rq_del_units;
  delete from public.terms where unit_id in (select id from _rq_del_units);
  delete from public.comment_history where comment_id in (select id from public.comments where unit_id in (select id from _rq_del_units));
  delete from public.comment_revisions where comment_id in (select id from public.comments where unit_id in (select id from _rq_del_units));
  delete from public.comments where unit_id in (select id from _rq_del_units);
  delete from public.relation_history where relation_id in (select id from public.relations where source_id in (select id from _rq_del_units) or target_id in (select id from _rq_del_units));
  delete from public.relation_revisions where relation_id in (select id from public.relations where source_id in (select id from _rq_del_units) or target_id in (select id from _rq_del_units));
  delete from public.relations where source_id in (select id from _rq_del_units) or target_id in (select id from _rq_del_units);
  delete from public.unit_amendments where unit_id in (select id from _rq_del_units);
  delete from public.unit_edit_history where unit_id in (select id from _rq_del_units);
  delete from public.units where document_id = p_id;
  delete from public.amendments where document_id = p_id;
  delete from public.source_files where document_id = p_id;
  delete from public.import_log where document_id = p_id;
  delete from public.documents where id = p_id;
  return jsonb_build_object('document', p_id, 'units', n_units);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.rq_archive_document(text, boolean)', 'public.rq_delete_document(text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

drop policy if exists rq_originals_delete on storage.objects;
create policy rq_originals_delete on storage.objects for delete to authenticated
  using (bucket_id = 'originals' and public.rq_is_admin());
drop policy if exists rq_figures_delete on storage.objects;
create policy rq_figures_delete on storage.objects for delete to authenticated
  using (bucket_id = 'figures' and public.rq_is_admin());

create or replace function rq_private.reader_data(p_draft boolean) returns jsonb
language sql stable set search_path = public as $$
  with recursive live as (select * from public.units where not archived
    and document_id not in (select id from public.documents where archived)),
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
          and unit_id in (select id from good)),
  trm as (select * from public.terms where status = any(case when p_draft then array['approved','draft'] else array['approved'] end)
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
        'sort_order', sort_order, 'navigation_only', nav, 'tags', tags) order by document_id, sort_order, id) from u), '[]'),
    'tag_groups', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'name', name) order by sort, name) from public.tag_groups), '[]'),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('key', t.key, 'group_key', t.group_key, 'name', t.name) order by g.sort, t.sort, t.name)
        from public.tags t join public.tag_groups g on g.key = t.group_key where not t.archived), '[]'),
    'relations', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'source_id', source_id, 'target_id', target_id,
        'relation_type', relation_type, 'rationale', rationale, 'status', status,
        'anchor_text', anchor_text, 'anchor_occurrence', anchor_occurrence) order by id) from rel), '[]'),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'unit_id', unit_id, 'kind', kind, 'language', language,
        'body', body, 'author', author, 'status', status, 'updated_at', updated_at,
        'anchor_text', anchor_text, 'anchor_occurrence', anchor_occurrence) order by id) from com), '[]'),
    'terms', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'unit_id', unit_id, 'number', number, 'name', name,
        'forms', forms, 'language', language, 'status', status) order by unit_id, number) from trm), '[]'),
    'counts', jsonb_build_object('documents', (select count(*) from docs), 'units', (select count(*) from u),
        'verified_units', (select count(*) from good), 'navigation_units', (select count(*) from u where nav),
        'relations', (select count(*) from rel), 'comments', (select count(*) from com)))
$$;
