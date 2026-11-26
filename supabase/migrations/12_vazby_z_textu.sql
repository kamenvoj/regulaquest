-- RegulaQuest · 12 · Vazby z vybraného místa textu
-- Vazba může vycházet z konkrétního úseku zdrojové části (stejně jako poznámka): anchor_text + anchor_occurrence.
-- Totéž cílové ustanovení lze propojit z více míst jedné části. Lze spustit opakovaně.

alter table public.relations add column if not exists anchor_text text not null default '';
alter table public.relations add column if not exists anchor_occurrence int not null default 1;
alter table public.relations drop constraint if exists relations_anchor_check;
alter table public.relations add constraint relations_anchor_check check (length(anchor_text) <= 1000 and anchor_occurrence between 1 and 500);
alter table public.relations drop constraint if exists relations_source_id_target_id_relation_type_key;
create unique index if not exists ux_relations_anchor on public.relations(source_id, target_id, relation_type, anchor_text, anchor_occurrence);

-- Vybraný text musí být ve zdrojové části (bez ohledu na mezery); vrací normalizovaný text.
create or replace function rq_private.check_anchor(p_unit_id text, p_anchor text) returns text
language plpgsql stable set search_path = public as $$
declare v text := btrim(regexp_replace(coalesce(p_anchor, ''), '\s+', ' ', 'g')); u public.units := rq_private.unit_row(p_unit_id);
begin
  if v = '' then return ''; end if;
  if position(v in regexp_replace(coalesce(u.body, '') || ' ' || regexp_replace(coalesce(u.content_blocks::text, ''), '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')) = 0 then
    raise exception 'Vybraný text v ustanovení nebyl nalezen. Načtěte aktuální znění a vyberte ho znovu.';
  end if;
  return v;
end $$;
revoke all on function rq_private.check_anchor(text, text) from public, anon, authenticated;

drop function if exists public.rq_new_relation(text, text, text, text, text, text);
create or replace function public.rq_new_relation(p_source_id text, p_target_id text, p_relation_type text,
  p_rationale text, p_evidence text default '', p_provenance text default 'manual',
  p_anchor_text text default '', p_anchor_occurrence int default 1) returns text
language plpgsql security definer set search_path = public as $$
declare v_id text := rq_private.token('relation'); v_anchor text := rq_private.check_anchor(p_source_id, p_anchor_text);
begin
  perform rq_private.require_admin();
  perform rq_private.check_relation(p_source_id, p_target_id, p_relation_type, p_rationale);
  insert into public.relations(id, source_id, target_id, relation_type, rationale, evidence, provenance, created_by, updated_by, anchor_text, anchor_occurrence)
  values (v_id, p_source_id, p_target_id, p_relation_type, btrim(p_rationale), btrim(coalesce(p_evidence, '')),
          left(coalesce(nullif(p_provenance, ''), 'manual'), 200), auth.uid(), auth.uid(), v_anchor, greatest(1, coalesce(p_anchor_occurrence, 1)));
  perform rq_private.log_relation(v_id, 'created', null, to_jsonb(rq_private.relation_row(v_id)));
  return v_id;
exception when unique_violation then
  raise exception 'Tato vazba už existuje';
end $$;

create or replace function public.rq_batch_new_relations(p_links jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l jsonb; v_id text; created int := 0; skipped int := 0; ty text;
begin
  perform rq_private.require_admin();
  if jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) not between 1 and 50 then
    raise exception 'Vyberte 1–50 nových vazeb na jedno uložení';
  end if;
  for l in select * from jsonb_array_elements(p_links) loop
    ty := coalesce(l->>'relation_type', 'references');
    if exists (select 1 from public.relations where source_id = l->>'source_id' and target_id = l->>'target_id' and relation_type = ty) then
      skipped := skipped + 1; continue;
    end if;
    perform rq_private.check_relation(l->>'source_id', l->>'target_id', ty, l->>'rationale');
    v_id := rq_private.token('relation');
    insert into public.relations(id, source_id, target_id, relation_type, rationale, evidence, provenance, created_by, updated_by, anchor_text, anchor_occurrence)
    values (v_id, l->>'source_id', l->>'target_id', ty, btrim(l->>'rationale'), btrim(coalesce(l->>'evidence', '')),
            left(coalesce(l->>'provenance', 'automatic-batch'), 200) || '; pending-editor-review', auth.uid(), auth.uid(),
            rq_private.check_anchor(l->>'source_id', l->>'anchor_text'), greatest(1, coalesce((l->>'anchor_occurrence')::int, 1)));
    perform rq_private.log_relation(v_id, 'created_batch_candidate', null, to_jsonb(rq_private.relation_row(v_id)));
    created := created + 1;
  end loop;
  return jsonb_build_object('created', created, 'skipped', skipped);
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
        'sort_order', sort_order, 'navigation_only', nav) order by document_id, sort_order, id) from u), '[]'),
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

revoke all on function public.rq_new_relation(text, text, text, text, text, text, text, int) from public, anon;
grant execute on function public.rq_new_relation(text, text, text, text, text, text, text, int) to authenticated;
