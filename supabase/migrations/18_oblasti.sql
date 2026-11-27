-- RegulaQuest · 18 · Oblasti (zdravotnické prostředky, metrologie, …) a role dokumentu v oblasti
-- Dokument (celá skupina jazykových verzí) může být ve více oblastech, v každé s rolí:
--   core = hlavní předpis, guidance = metodika / výklad, supplementary = doplňkový,
--   situational = pro specifické situace (s poznámkou, kdy je relevantní).
-- Zařazení se váže na group_key dokumentu, takže přežije úklid testovacích dat i nový import. Lze spustit opakovaně.

create table if not exists public.areas (
  key         text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  name        text not null check (length(name) between 1 and 80),
  description text not null default '' check (length(description) <= 500),
  sort        int not null default 100,
  archived    boolean not null default false
);
create table if not exists public.document_areas (
  group_key text not null check (length(group_key) between 1 and 120),
  area_key  text not null references public.areas(key),
  role      text not null default 'core' check (role in ('core', 'guidance', 'supplementary', 'situational')),
  note      text not null default '' check (length(note) <= 300),
  sort      int not null default 100,
  primary key (group_key, area_key),
  check (role <> 'situational' or note <> '')
);
do $$
declare t text;
begin
  foreach t in array array['areas', 'document_areas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists admin_read on public.%I', t);
    execute format('create policy admin_read on public.%I for select to authenticated using (public.rq_is_admin())', t);
  end loop;
end $$;

insert into public.areas(key, name, sort) values
  ('zp', 'Zdravotnické prostředky', 10), ('metrologie', 'Metrologie', 20), ('zdroje_iz', 'Zdroje ionizujícího záření', 30),
  ('zdravotni_pece', 'Poskytování zdravotní péče', 40), ('verejne_zakazky', 'Veřejné zakázky', 50), ('uhrady', 'Úhrady', 60),
  ('osobni_udaje', 'Ochrana osobních údajů', 70), ('kyberbezpecnost', 'Kyberbezpečnost', 80), ('ai', 'Regulace AI', 90),
  ('lecive_pripravky', 'Léčivé přípravky', 100), ('prumyslove_vlastnictvi', 'Ochrana průmyslového vlastnictví', 110)
on conflict (key) do nothing;

create or replace function public.rq_save_area(p_key text, p_name text, p_description text default '', p_sort int default null) returns text
language plpgsql security definer set search_path = public as $$
declare k text := coalesce(nullif(btrim(p_key), ''), left(btrim(regexp_replace(lower(rq_private.unaccent_cs(p_name)), '[^a-z0-9]+', '_', 'g'), '_'), 40));
begin
  perform rq_private.require_admin();
  insert into public.areas(key, name, description, sort)
  values (k, btrim(p_name), btrim(coalesce(p_description, '')), coalesce(p_sort, (select coalesce(max(sort), 0) + 10 from public.areas)))
  on conflict (key) do update set name = excluded.name, description = excluded.description, sort = coalesce(p_sort, public.areas.sort), archived = false;
  return k;
end $$;

create or replace function public.rq_archive_area(p_key text, p_archived boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  update public.areas set archived = p_archived where key = p_key;
  if not found then raise exception 'Oblast nebyla nalezena'; end if;
end $$;

create or replace function public.rq_set_document_area(p_group_key text, p_area_key text, p_role text, p_note text default '', p_sort int default 100) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  if p_role = 'situational' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'U zařazení „pro specifické situace“ napište, kdy je dokument relevantní.';
  end if;
  insert into public.document_areas(group_key, area_key, role, note, sort)
  values (p_group_key, p_area_key, p_role, btrim(coalesce(p_note, '')), coalesce(p_sort, 100))
  on conflict (group_key, area_key) do update set role = excluded.role, note = excluded.note, sort = excluded.sort;
end $$;

create or replace function public.rq_remove_document_area(p_group_key text, p_area_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  delete from public.document_areas where group_key = p_group_key and area_key = p_area_key;
end $$;

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
  pth as (select * from public.paths where status = any(case when p_draft then array['published','draft'] else array['published'] end)),
  stp as (select s.* from public.path_steps s join pth on pth.id = s.path_id where s.unit_id is null or s.unit_id in (select id from good)),
  trm as (select * from public.terms where status = any(case when p_draft then array['approved','draft'] else array['approved'] end)
          and unit_id in (select id from good))
  select jsonb_build_object(
    'format', 'regulaquest-education-v1',
    'mode', case when p_draft then 'draft' else 'published' end,
    'published_at', now(),
    'notice', 'Legislativní texty jsou informační kopií. Ověřujte aktuální oficiální znění a právní závaznost zdrojů.',
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'family', family, 'kind', kind,
        'language', language, 'version', version, 'valid_date', valid_date, 'publisher', publisher, 'url', url,
        'group_key', group_key, 'jurisdiction', jurisdiction, 'document_type', document_type, 'topics', topics,
        'short_title', short_title, 'featured', featured, 'featured_sort', featured_sort) order by id) from docs), '[]'),
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'document_id', document_id, 'parent_id', parent_id,
        'kind', kind, 'label', label,
        'heading', heading,
        'body', case when nav then '' else body end,
        'content_blocks', case when nav then null else content_blocks end,
        'locator', locator,
        'text_status', case when nav then 'navigation_only' else text_status end,
        'sort_order', sort_order, 'navigation_only', nav, 'tags', tags) order by document_id, sort_order, id) from u), '[]'),
    'paths', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'description', p.description, 'status', p.status,
        'steps', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'unit_id', s.unit_id, 'title', s.title, 'note', s.note,
            'anchor_text', s.anchor_text, 'anchor_occurrence', s.anchor_occurrence) order by s.sort, s.id) from stp s where s.path_id = p.id), '[]'))
        order by p.sort, p.title) from pth p where exists (select 1 from stp s where s.path_id = p.id)), '[]'),
    'areas', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'name', name, 'description', description) order by sort, name)
        from public.areas where not archived), '[]'),
    'document_areas', coalesce((select jsonb_agg(jsonb_build_object('group_key', da.group_key, 'area_key', da.area_key, 'role', da.role, 'note', da.note, 'sort', da.sort)
        order by da.area_key, da.sort) from public.document_areas da join public.areas ar on ar.key = da.area_key and not ar.archived
        where da.group_key in (select coalesce(group_key, id) from docs)), '[]'),
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

create or replace function public.rq_studio_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  return jsonb_build_object(
    'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at, d.id) from public.documents d), '[]'),
    'units', coalesce((select jsonb_agg(to_jsonb(u) || jsonb_build_object('editor_archived', u.archived)
                       order by u.document_id, u.sort_order, u.id) from public.units u), '[]'),
    'comments', coalesce((select jsonb_agg(to_jsonb(c) order by c.updated_at desc) from public.comments c), '[]'),
    'relations', coalesce((select jsonb_agg(to_jsonb(r) order by r.updated_at desc) from public.relations r), '[]'),
    'areas', coalesce((select jsonb_agg(to_jsonb(a) order by a.sort, a.name) from public.areas a), '[]'),
    'document_areas', coalesce((select jsonb_agg(to_jsonb(x) order by x.area_key, x.sort) from public.document_areas x), '[]'),
    'paths', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort, p.title) from public.paths p), '[]'),
    'path_steps', coalesce((select jsonb_agg(to_jsonb(s) order by s.path_id, s.sort) from public.path_steps s), '[]'),
    'tag_groups', coalesce((select jsonb_agg(to_jsonb(g) order by g.sort, g.name) from public.tag_groups g), '[]'),
    'tags', coalesce((select jsonb_agg(to_jsonb(t) order by g.sort, t.sort, t.name) from public.tags t join public.tag_groups g on g.key = t.group_key), '[]'),
    'terms', coalesce((select jsonb_agg(to_jsonb(t) order by t.unit_id, t.number) from public.terms t), '[]'),
    'amendments', coalesce((select jsonb_agg(to_jsonb(a) order by a.document_id, a.marker) from public.amendments a), '[]'),
    'unit_amendments', coalesce((select jsonb_agg(to_jsonb(a) order by a.unit_id, a.marker) from public.unit_amendments a), '[]'),
    'imports', coalesce((select jsonb_agg(to_jsonb(i) order by i.id desc) from (select * from public.import_log order by id desc limit 20) i), '[]'),
    'source_files', coalesce((select jsonb_agg(to_jsonb(s) order by s.document_id) from public.source_files s), '[]'),
    'relation_revisions', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from public.relation_revisions r), '[]'),
    'relation_history', coalesce((select jsonb_agg(to_jsonb(h) order by h.id desc) from public.relation_history h), '[]'),
    'comment_revisions', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from public.comment_revisions r), '[]'),
    'comment_history', coalesce((select jsonb_agg(to_jsonb(h) order by h.id desc) from public.comment_history h), '[]'),
    'unit_edit_history', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'unit_id', h.unit_id, 'event', h.event,
        'reason', h.reason, 'actor', h.actor, 'created_at', h.created_at) order by h.id desc)
        from (select * from public.unit_edit_history order by id desc limit 250) h), '[]'),
    'people', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'username', p.username,
        'display_name', p.display_name, 'role', p.role)) from public.profiles p where p.role in ('owner', 'admin')), '[]'),
    'publication', (select jsonb_build_object('id', id, 'created_at', created_at, 'note', note, 'counts', counts)
        from public.publications where is_current),
    'counts', jsonb_build_object(
      'documents', (select count(*) from public.documents),
      'units', (select count(*) from public.units where not archived),
      'verified', (select count(*) from public.units where not archived and text_status = 'verified' and btrim(body) <> ''),
      'proposed', (select count(*) from public.relations where status = 'proposed'),
      'approved_links', (select count(*) from public.relations where status = 'approved'),
      'approved_comments', (select count(*) from public.comments where status = 'approved'),
      'proposed_revisions', (select count(*) from public.relation_revisions where status = 'proposed'),
      'comment_revisions_pending', (select count(*) from public.comment_revisions where status = 'proposed')));
end $$;

create or replace function public.rq_backup() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  return jsonb_build_object('format', 'regulaquest-supabase-backup-v1', 'backup_at', now(),
    'documents', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.documents x),
    'units', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.units x),
    'amendments', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.amendments x),
    'unit_amendments', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.unit_amendments x),
    'comments', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.comments x),
    'comment_revisions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.comment_revisions x),
    'comment_history', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.comment_history x),
    'relations', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.relations x),
    'relation_revisions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.relation_revisions x),
    'relation_history', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.relation_history x),
    'unit_edit_history', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.unit_edit_history x),
    'source_files', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.source_files x),
    'import_log', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.import_log x),
    'publications', (select coalesce(jsonb_agg(to_jsonb(x) - 'data'), '[]') from public.publications x),
    'terms', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.terms x),
    'areas', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.areas x),
    'document_areas', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.document_areas x),
    'paths', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.paths x),
    'path_steps', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.path_steps x),
    'tag_groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.tag_groups x),
    'tags', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.tags x),
    'student_groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.student_groups x));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.rq_save_area(text, text, text, int)', 'public.rq_archive_area(text, boolean)',
                           'public.rq_set_document_area(text, text, text, text, int)', 'public.rq_remove_document_area(text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
