-- RegulaQuest · 14 · Štítky (role, třída rizika, typ prostředku …)
-- Obecný slovník: skupiny štítků a štítky spravuje redakce ve Studiu (pro jiné předpisy jiné skupiny).
-- units.tags = klíče štítků; nastavení se zrcadlí do odpovídající části jiné jazykové verze.
-- Import nového znění štítky nemění. Úklid testovacích dat slovník ponechá. Lze spustit opakovaně.

create table if not exists public.tag_groups (
  key   text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  name  text not null check (length(name) between 1 and 80),
  sort  int not null default 100
);
create table if not exists public.tags (
  key       text primary key check (key ~ '^[a-z0-9_]{2,60}$'),
  group_key text not null references public.tag_groups(key),
  name      text not null check (length(name) between 1 and 80),
  sort      int not null default 100,
  archived  boolean not null default false
);
alter table public.units add column if not exists tags text[] not null default '{}';

do $$
declare t text;
begin
  foreach t in array array['tag_groups', 'tags'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists admin_read on public.%I', t);
    execute format('create policy admin_read on public.%I for select to authenticated using (public.rq_is_admin())', t);
  end loop;
end $$;

-- Výchozí slovník pro zdravotnické prostředky (lze upravit ve Studiu)
insert into public.tag_groups(key, name, sort) values ('role', 'Koho se týká', 10), ('trida', 'Třída rizika', 20), ('typ', 'Typ prostředku', 30)
on conflict (key) do nothing;
insert into public.tags(key, group_key, name, sort) values
  ('role_vyrobce', 'role', 'Výrobce', 1), ('role_zplnomocneny', 'role', 'Zplnomocněný zástupce', 2), ('role_dovozce', 'role', 'Dovozce', 3),
  ('role_distributor', 'role', 'Distributor', 4), ('role_os', 'role', 'Oznámený subjekt', 5), ('role_organ', 'role', 'Příslušný orgán', 6),
  ('role_komise', 'role', 'Komise / MDCG', 7), ('role_zadavatel', 'role', 'Zadavatel klinické zkoušky', 8), ('role_zz', 'role', 'Zdravotnické zařízení', 9),
  ('trida_i', 'trida', 'Třída I', 1), ('trida_is', 'trida', 'Třída I – sterilní', 2), ('trida_im', 'trida', 'Třída I – s měřicí funkcí', 3),
  ('trida_ir', 'trida', 'Třída I – opakovaně použitelné chirurgické nástroje', 4), ('trida_iia', 'trida', 'Třída IIa', 5),
  ('trida_iib', 'trida', 'Třída IIb', 6), ('trida_iii', 'trida', 'Třída III', 7),
  ('typ_implantabilni', 'typ', 'Implantabilní', 1), ('typ_invazivni', 'typ', 'Invazivní', 2), ('typ_aktivni', 'typ', 'Aktivní', 3),
  ('typ_software', 'typ', 'Software (MDSW)', 4), ('typ_zakazka', 'typ', 'Na zakázku', 5), ('typ_jednorazovy', 'typ', 'Pro jedno použití', 6),
  ('typ_lecivo', 'typ', 'S léčivou látkou', 7), ('typ_nano', 'typ', 'S nanomateriálem', 8), ('typ_bez_ucelu', 'typ', 'Bez léčebného účelu (příloha XVI)', 9)
on conflict (key) do nothing;

create or replace function public.rq_set_unit_tags(p_unit_id text, p_tags jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare u public.units := rq_private.unit_row(p_unit_id); d public.documents; v text[]; r record; n int := 0;
begin
  perform rq_private.require_admin();
  select coalesce(array_agg(distinct x order by x), '{}') into v from jsonb_array_elements_text(p_tags) x;
  if exists (select 1 from unnest(v) k where not exists (select 1 from public.tags t where t.key = k)) then
    raise exception 'Neznámý štítek';
  end if;
  select * into d from public.documents where id = u.document_id;
  for r in
    select x.* from public.units x join public.documents xd on xd.id = x.document_id
     where x.id = u.id
        or (coalesce(xd.group_key, xd.id) = coalesce(d.group_key, d.id) and xd.id <> d.id
            and x.id = xd.id || substr(u.id, length(d.id) + 1) and u.id like d.id || '-%')
  loop
    if r.tags is distinct from v then
      update public.units set tags = v, updated_at = clock_timestamp(), updated_by = auth.uid() where id = r.id;
      perform rq_private.log_unit(r.id, 'tags', jsonb_build_object('tags', r.tags), jsonb_build_object('tags', v), 'Štítky');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function rq_private.unaccent_cs(t text) returns text language sql immutable as $$
  select translate(coalesce(t, ''), 'áäčďéěëíňóöřšťúůüýžÁÄČĎÉĚËÍŇÓÖŘŠŤÚŮÜÝŽ', 'aacdeeeinoorstuuuyzAACDEEEINOORSTUUUYZ')
$$;

-- Založení / přejmenování štítku nebo skupiny. Prázdný klíč = nový (klíč se odvodí z názvu).
create or replace function public.rq_save_tag(p_key text, p_group_key text, p_name text, p_sort int default 100) returns text
language plpgsql security definer set search_path = public as $$
declare k text := coalesce(nullif(btrim(p_key), ''), left(p_group_key || '_' || regexp_replace(lower(rq_private.unaccent_cs(p_name)), '[^a-z0-9]+', '_', 'g'), 60));
begin
  perform rq_private.require_admin();
  k := btrim(k, '_');
  insert into public.tags(key, group_key, name, sort) values (k, p_group_key, btrim(p_name), coalesce(p_sort, 100))
  on conflict (key) do update set name = excluded.name, group_key = excluded.group_key, sort = excluded.sort, archived = false;
  return k;
end $$;
create or replace function public.rq_save_tag_group(p_key text, p_name text, p_sort int default 100) returns text
language plpgsql security definer set search_path = public as $$
declare k text := coalesce(nullif(btrim(p_key), ''), left(btrim(regexp_replace(lower(rq_private.unaccent_cs(p_name)), '[^a-z0-9]+', '_', 'g'), '_'), 40));
begin
  perform rq_private.require_admin();
  insert into public.tag_groups(key, name, sort) values (k, btrim(p_name), coalesce(p_sort, 100))
  on conflict (key) do update set name = excluded.name, sort = excluded.sort;
  return k;
end $$;
-- Vyřazený štítek zmizí z nabídky a ze čtečky; u částí zůstane uložen a po obnovení se vrátí.
create or replace function public.rq_archive_tag(p_key text, p_archived boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  update public.tags set archived = p_archived where key = p_key;
  if not found then raise exception 'Štítek nebyl nalezen'; end if;
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
    'tag_groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.tag_groups x),
    'tags', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.tags x),
    'student_groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.student_groups x));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.rq_set_unit_tags(text, jsonb)', 'public.rq_save_tag(text, text, text, int)',
                           'public.rq_save_tag_group(text, text, int)', 'public.rq_archive_tag(text, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function rq_private.unaccent_cs(text) from public, anon, authenticated;
