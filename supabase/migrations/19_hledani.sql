-- RegulaQuest · 19 · Vyhledávač „Najít předpisy“ a průvodce otázkami
-- Obojí je obecné – nic není napsané pro zdravotnické prostředky natvrdo:
--   * pole vyhledávače se generují ze skupin štítků; skupina může platit jen pro některé oblasti
--     (tag_groups.area_keys, prázdné = všechny oblasti),
--   * otázky průvodce se definují ve Studiu; každá odpověď může přidat oblasti a štítky a otázka se může
--     zobrazit jen u některých oblastí. Výsledkem průvodce je předvyplněný vyhledávač.
-- Otázky průvodce jsou nastavení (jako oblasti a štítky) – úklid testovacích dat je nemaže. Lze spustit opakovaně.

alter table public.tag_groups add column if not exists area_keys text[] not null default '{}';

create table if not exists public.guide_questions (
  id         bigint generated always as identity primary key,
  prompt     text not null check (length(prompt) between 1 and 200),
  help       text not null default '' check (length(help) <= 400),
  multi      boolean not null default false,
  area_keys  text[] not null default '{}',
  options    jsonb not null default '[]' check (jsonb_typeof(options) = 'array'),
  sort       int not null default 100,
  archived   boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.guide_questions enable row level security;
revoke all on public.guide_questions from anon, authenticated;
grant select on public.guide_questions to authenticated;
drop policy if exists admin_read on public.guide_questions;
create policy admin_read on public.guide_questions for select to authenticated using (public.rq_is_admin());

-- JSON pole textů → text[]
create or replace function rq_private.jtext(p jsonb) returns text[]
language sql immutable as $$
  select coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x), '{}')
$$;

-- Kontrola seznamu klíčů oblastí
create or replace function rq_private.clean_area_keys(p text[]) returns text[]
language plpgsql stable set search_path = public as $$
declare v text[] := coalesce((select array_agg(distinct btrim(x) order by btrim(x)) from unnest(coalesce(p, '{}')) x where btrim(x) <> ''), '{}');
begin
  if exists (select 1 from unnest(v) k where not exists (select 1 from public.areas a where a.key = k)) then
    raise exception 'Neznámá oblast';
  end if;
  return v;
end $$;

drop function if exists public.rq_set_tag_group_areas(text, text[]);
create or replace function public.rq_set_tag_group_areas(p_key text, p_area_keys jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  update public.tag_groups set area_keys = rq_private.clean_area_keys(rq_private.jtext(p_area_keys)) where key = p_key;
  if not found then raise exception 'Skupina štítků nebyla nalezena'; end if;
end $$;

-- Odpovědi: [{label, help, areas: [...], tags: [...]}]
create or replace function rq_private.clean_guide_options(p jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare o jsonb; out jsonb := '[]'; lbl text; ar text[]; tg text[];
begin
  if p is null or jsonb_typeof(p) <> 'array' then raise exception 'Odpovědi musí být seznam'; end if;
  for o in select * from jsonb_array_elements(p) loop
    lbl := btrim(coalesce(o->>'label', ''));
    if lbl = '' then continue; end if;
    if length(lbl) > 120 then raise exception 'Odpověď je příliš dlouhá (max. 120 znaků)'; end if;
    ar := rq_private.clean_area_keys(rq_private.jtext(o->'areas'));
    tg := coalesce((select array_agg(distinct x order by x) from unnest(rq_private.jtext(o->'tags')) x), '{}');
    if exists (select 1 from unnest(tg) k where not exists (select 1 from public.tags t where t.key = k)) then
      raise exception 'Neznámý štítek v odpovědi „%“', lbl;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('label', lbl, 'help', left(btrim(coalesce(o->>'help', '')), 300),
      'areas', to_jsonb(ar), 'tags', to_jsonb(tg)));
  end loop;
  if jsonb_array_length(out) < 2 then raise exception 'Otázka potřebuje alespoň dvě odpovědi'; end if;
  if jsonb_array_length(out) > 20 then raise exception 'Otázka může mít nejvýš 20 odpovědí'; end if;
  return out;
end $$;

drop function if exists public.rq_save_guide_question(bigint, text, text, boolean, text[], jsonb, int);
create or replace function public.rq_save_guide_question(p_id bigint default null, p_prompt text default '', p_help text default '',
  p_multi boolean default false, p_area_keys jsonb default '[]', p_options jsonb default '[]', p_sort int default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  perform rq_private.require_admin();
  if btrim(coalesce(p_prompt, '')) = '' then raise exception 'Napište otázku'; end if;
  if p_id is null then
    insert into public.guide_questions(prompt, help, multi, area_keys, options, sort)
    values (btrim(p_prompt), btrim(coalesce(p_help, '')), coalesce(p_multi, false), rq_private.clean_area_keys(rq_private.jtext(p_area_keys)),
            rq_private.clean_guide_options(p_options), coalesce(p_sort, (select coalesce(max(sort), 0) + 10 from public.guide_questions)))
    returning id into v;
  else
    update public.guide_questions set prompt = btrim(p_prompt), help = btrim(coalesce(p_help, '')), multi = coalesce(p_multi, false),
      area_keys = rq_private.clean_area_keys(rq_private.jtext(p_area_keys)), options = rq_private.clean_guide_options(p_options),
      sort = coalesce(p_sort, sort), updated_at = now()
    where id = p_id returning id into v;
    if v is null then raise exception 'Otázka nebyla nalezena'; end if;
  end if;
  return v;
end $$;

create or replace function public.rq_archive_guide_question(p_id bigint, p_archived boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  update public.guide_questions set archived = p_archived, updated_at = now() where id = p_id;
  if not found then raise exception 'Otázka nebyla nalezena'; end if;
end $$;

create or replace function public.rq_delete_guide_question(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  delete from public.guide_questions where id = p_id;
  if not found then raise exception 'Otázka nebyla nalezena'; end if;
end $$;

-- Posun otázky nahoru (-1) / dolů (+1); pořadí se přečísluje po deseti.
create or replace function public.rq_move_guide_question(p_id bigint, p_dir int) returns void
language plpgsql security definer set search_path = public as $$
declare ids bigint[]; i int; t bigint;
begin
  perform rq_private.require_admin();
  select array_agg(id order by sort, id) into ids from public.guide_questions;
  i := array_position(ids, p_id);
  if i is null then raise exception 'Otázka nebyla nalezena'; end if;
  if i + p_dir between 1 and array_length(ids, 1) then
    t := ids[i]; ids[i] := ids[i + p_dir]; ids[i + p_dir] := t;
  end if;
  update public.guide_questions q set sort = x.n * 10 from unnest(ids) with ordinality x(id, n) where q.id = x.id;
end $$;

-- Výchozí ukázková sada (jen pokud zatím žádné otázky nejsou). Vše lze ve Studiu upravit nebo smazat.
do $$
begin
  if exists (select 1 from public.guide_questions) then return; end if;
  if (select count(*) from public.areas where key in ('zp','metrologie','zdroje_iz','zdravotni_pece','verejne_zakazky','uhrady','osobni_udaje','kyberbezpecnost','ai','lecive_pripravky','prumyslove_vlastnictvi')) < 11 then return; end if;
  insert into public.guide_questions(prompt, help, multi, area_keys, options, sort) values
  ('Čeho se vaše otázka týká?', 'Vyberte vše, co k situaci patří. Podle toho průvodce nabídne další otázky.', true, '{}',
   '[{"label":"Výrobek, přístroj nebo software pro zdravotnické účely","help":"","areas":["zp"],"tags":[]},
     {"label":"Měření a měřidla","help":"","areas":["metrologie"],"tags":[]},
     {"label":"Rentgen, CT, radioterapie nebo jiný zdroj záření","help":"","areas":["zdroje_iz"],"tags":[]},
     {"label":"Poskytování péče v nemocnici nebo ordinaci","help":"","areas":["zdravotni_pece"],"tags":[]},
     {"label":"Nákup pro nemocnici nebo jiného veřejného zadavatele","help":"","areas":["verejne_zakazky"],"tags":[]},
     {"label":"Úhrada ze zdravotního pojištění","help":"","areas":["uhrady"],"tags":[]},
     {"label":"Data pacientů a osobní údaje","help":"","areas":["osobni_udaje"],"tags":[]},
     {"label":"Zabezpečení IT systémů a sítí","help":"","areas":["kyberbezpecnost"],"tags":[]},
     {"label":"Umělá inteligence","help":"","areas":["ai"],"tags":[]},
     {"label":"Léky","help":"","areas":["lecive_pripravky"],"tags":[]},
     {"label":"Patenty, ochranné známky, užitné vzory","help":"","areas":["prumyslove_vlastnictvi"],"tags":[]}]'::jsonb, 10),
  ('V jaké roli jste vy (nebo firma, o kterou jde)?', '', false, '{zp}',
   '[{"label":"Vyrábím nebo vyvíjím prostředek","help":"","areas":[],"tags":["role_vyrobce"]},
     {"label":"Dovážím prostředek ze země mimo EU","help":"","areas":[],"tags":["role_dovozce"]},
     {"label":"Prodávám nebo distribuuji prostředek","help":"","areas":[],"tags":["role_distributor"]},
     {"label":"Zastupuji výrobce mimo EU","help":"","areas":[],"tags":["role_zplnomocneny"]},
     {"label":"Používám prostředek ve zdravotnickém zařízení","help":"","areas":[],"tags":["role_zz"]},
     {"label":"Chystám klinickou zkoušku","help":"","areas":[],"tags":["role_zadavatel"]},
     {"label":"Jsem oznámený subjekt nebo úřad","help":"","areas":[],"tags":["role_os","role_organ"]}]'::jsonb, 20),
  ('Jaký prostředek to je?', 'Vyberte vše, co platí. Když si nejste jistí, otázku přeskočte.', true, '{zp}',
   '[{"label":"Software nebo aplikace","help":"","areas":[],"tags":["typ_software"]},
     {"label":"Implantát (zůstává v těle)","help":"","areas":[],"tags":["typ_implantabilni"]},
     {"label":"Zavádí se do těla","help":"","areas":[],"tags":["typ_invazivni"]},
     {"label":"Napájený (elektřina, baterie)","help":"","areas":[],"tags":["typ_aktivni"]},
     {"label":"Na jedno použití","help":"","areas":[],"tags":["typ_jednorazovy"]},
     {"label":"Obsahuje léčivou látku","help":"","areas":["lecive_pripravky"],"tags":["typ_lecivo"]},
     {"label":"Vyrobený na zakázku pro konkrétního pacienta","help":"","areas":[],"tags":["typ_zakazka"]},
     {"label":"Nemá léčebný účel (např. estetický)","help":"","areas":[],"tags":["typ_bez_ucelu"]}]'::jsonb, 30),
  ('Má prostředek něco z tohoto?', 'Tyto vlastnosti přinášejí další předpisy z jiných oblastí.', true, '{zp}',
   '[{"label":"Měří nějakou hodnotu (tlak, teplotu, hmotnost…)","help":"","areas":["metrologie"],"tags":["trida_im"]},
     {"label":"Vydává ionizující záření","help":"","areas":["zdroje_iz"],"tags":[]},
     {"label":"Zpracovává údaje o pacientech","help":"","areas":["osobni_udaje"],"tags":[]},
     {"label":"Je připojený k síti nebo internetu","help":"","areas":["kyberbezpecnost"],"tags":[]},
     {"label":"Využívá umělou inteligenci","help":"","areas":["ai"],"tags":[]},
     {"label":"Nic z toho","help":"","areas":[],"tags":[]}]'::jsonb, 40),
  ('Víte, do jaké třídy rizika prostředek patří?', 'Když nevíte, zvolte „Nevím“ – pravidla klasifikace najdete ve výsledcích.', false, '{zp}',
   '[{"label":"Třída I","help":"","areas":[],"tags":["trida_i"]},
     {"label":"Třída IIa","help":"","areas":[],"tags":["trida_iia"]},
     {"label":"Třída IIb","help":"","areas":[],"tags":["trida_iib"]},
     {"label":"Třída III","help":"","areas":[],"tags":["trida_iii"]},
     {"label":"Nevím","help":"","areas":[],"tags":[]}]'::jsonb, 50);
end $$;

-- Výchozí skupiny štítků pro ZP navázat na oblast ZP („Koho se týká“ ponechat obecné)
update public.tag_groups set area_keys = '{zp}' where key in ('trida', 'typ') and area_keys = '{}' and exists (select 1 from public.areas where key = 'zp');

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
    'tag_groups', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'name', name, 'area_keys', area_keys) order by sort, name) from public.tag_groups), '[]'),
    'guide', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'prompt', prompt, 'help', help, 'multi', multi, 'area_keys', area_keys, 'options', options)
        order by sort, id) from public.guide_questions where not archived), '[]'),
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
    'guide_questions', coalesce((select jsonb_agg(to_jsonb(q) order by q.sort, q.id) from public.guide_questions q), '[]'),
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
    'guide_questions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.guide_questions x),
    'student_groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.student_groups x));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.rq_set_tag_group_areas(text, jsonb)',
                           'public.rq_save_guide_question(bigint, text, text, boolean, jsonb, jsonb, int)',
                           'public.rq_archive_guide_question(bigint, boolean)', 'public.rq_delete_guide_question(bigint)',
                           'public.rq_move_guide_question(bigint, int)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
