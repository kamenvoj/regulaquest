-- RegulaQuest · 21 · Řešené případy (např. klasifikace aplikace, analýza rizik)
-- Případ = zadání, kroky (každý může odkazovat na ustanovení), závěr; přiřazení k oblastem a štítkům.
-- Z textu dokumentu lze ustanovení s případem propojit (case_links); ve čtečce se u ustanovení ukáže jen odkaz.
-- Studenti případy vidí po publikaci (stav „Zveřejněný“), v pracovním náhledu i koncepty. Lze spustit opakovaně.

create table if not exists public.cases (
  id          text primary key,
  title       text not null check (length(title) between 1 and 200),
  summary     text not null default '' check (length(summary) <= 1000),
  assignment  text not null default '' check (length(assignment) <= 15000),
  conclusion  text not null default '' check (length(conclusion) <= 15000),
  status      text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  area_keys   text[] not null default '{}',
  tags        text[] not null default '{}',
  sort        int not null default 100,
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create table if not exists public.case_steps (
  id      text primary key,
  case_id text not null references public.cases(id) on delete cascade,
  sort    int not null default 0,
  title   text not null default '' check (length(title) <= 200),
  body    text not null default '' check (length(body) <= 15000),
  unit_id text,
  check (title <> '' or body <> '' or unit_id is not null)
);
create index if not exists ix_case_steps on public.case_steps(case_id, sort);
create table if not exists public.case_links (
  case_id text not null references public.cases(id) on delete cascade,
  unit_id text not null,
  primary key (case_id, unit_id)
);
do $$
declare t text;
begin
  foreach t in array array['cases', 'case_steps', 'case_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists admin_read on public.%I', t);
    execute format('create policy admin_read on public.%I for select to authenticated using (public.rq_is_admin())', t);
  end loop;
end $$;

-- p: {title, summary, assignment, conclusion, status, area_keys, tags}
create or replace function public.rq_save_case(p_id text default null, p jsonb default '{}') returns text
language plpgsql security definer set search_path = public as $$
declare v text := nullif(btrim(coalesce(p_id, '')), '');
  ar text[] := rq_private.clean_area_keys(rq_private.jtext(p->'area_keys'));
  tg text[] := coalesce((select array_agg(distinct x order by x) from unnest(rq_private.jtext(p->'tags')) x), '{}');
  st text := coalesce(nullif(p->>'status', ''), 'draft');
begin
  perform rq_private.require_admin();
  if coalesce(btrim(p->>'title'), '') = '' then raise exception 'Napište název případu'; end if;
  if st not in ('draft', 'published', 'archived') then raise exception 'Neznámý stav'; end if;
  if exists (select 1 from unnest(tg) k where not exists (select 1 from public.tags t where t.key = k)) then raise exception 'Neznámý štítek'; end if;
  if v is null then
    v := rq_private.token('case');
    insert into public.cases(id, title, summary, assignment, conclusion, status, area_keys, tags, sort, created_by, updated_by)
    values (v, left(btrim(p->>'title'), 200), left(btrim(coalesce(p->>'summary', '')), 1000), left(btrim(coalesce(p->>'assignment', '')), 15000),
            left(btrim(coalesce(p->>'conclusion', '')), 15000), st, ar, tg, coalesce((select max(sort) + 10 from public.cases), 10), auth.uid(), auth.uid());
  else
    update public.cases set title = left(btrim(p->>'title'), 200), summary = left(btrim(coalesce(p->>'summary', '')), 1000),
      assignment = left(btrim(coalesce(p->>'assignment', '')), 15000), conclusion = left(btrim(coalesce(p->>'conclusion', '')), 15000),
      status = st, area_keys = ar, tags = tg, updated_at = now(), updated_by = auth.uid()
    where id = v;
    if not found then raise exception 'Případ nebyl nalezen'; end if;
  end if;
  return v;
end $$;

create or replace function public.rq_delete_case(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  delete from public.cases where id = p_id;
  if not found then raise exception 'Případ nebyl nalezen'; end if;
end $$;

-- Krok: p {title, body, unit_id}
create or replace function public.rq_save_case_step(p_id text default null, p_case_id text default null, p jsonb default '{}') returns text
language plpgsql security definer set search_path = public as $$
declare v text := nullif(btrim(coalesce(p_id, '')), ''); u text := nullif(btrim(coalesce(p->>'unit_id', '')), '');
begin
  perform rq_private.require_admin();
  if u is not null then perform rq_private.unit_row(u); end if;
  if coalesce(btrim(p->>'title'), '') = '' and coalesce(btrim(p->>'body'), '') = '' and u is null then raise exception 'Krok je prázdný'; end if;
  if v is null then
    if not exists (select 1 from public.cases where id = p_case_id) then raise exception 'Případ nebyl nalezen'; end if;
    v := rq_private.token('cstep');
    insert into public.case_steps(id, case_id, sort, title, body, unit_id)
    values (v, p_case_id, coalesce((select max(sort) + 10 from public.case_steps where case_id = p_case_id), 10),
            left(btrim(coalesce(p->>'title', '')), 200), left(btrim(coalesce(p->>'body', '')), 15000), u);
  else
    update public.case_steps set title = left(btrim(coalesce(p->>'title', '')), 200), body = left(btrim(coalesce(p->>'body', '')), 15000), unit_id = u where id = v;
    if not found then raise exception 'Krok nebyl nalezen'; end if;
  end if;
  update public.cases set updated_at = now(), updated_by = auth.uid() where id = (select case_id from public.case_steps where id = v);
  return v;
end $$;

create or replace function public.rq_move_case_step(p_id text, p_dir int) returns void
language plpgsql security definer set search_path = public as $$
declare c text; ids text[]; i int; t text;
begin
  perform rq_private.require_admin();
  select case_id into c from public.case_steps where id = p_id;
  if c is null then raise exception 'Krok nebyl nalezen'; end if;
  select array_agg(id order by sort, id) into ids from public.case_steps where case_id = c;
  i := array_position(ids, p_id);
  if i + p_dir between 1 and array_length(ids, 1) then t := ids[i]; ids[i] := ids[i + p_dir]; ids[i + p_dir] := t; end if;
  update public.case_steps s set sort = x.n * 10 from unnest(ids) with ordinality x(id, n) where s.id = x.id;
end $$;

create or replace function public.rq_delete_case_step(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  delete from public.case_steps where id = p_id;
  if not found then raise exception 'Krok nebyl nalezen'; end if;
end $$;

-- Propojení ustanovení s případem (z textu dokumentu)
create or replace function public.rq_link_case_unit(p_case_id text, p_unit_id text, p_add boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  if not exists (select 1 from public.cases where id = p_case_id) then raise exception 'Případ nebyl nalezen'; end if;
  if p_add then
    perform rq_private.unit_row(p_unit_id);
    insert into public.case_links(case_id, unit_id) values (p_case_id, p_unit_id) on conflict do nothing;
  else
    delete from public.case_links where case_id = p_case_id and unit_id = p_unit_id;
  end if;
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
  cas as (select * from public.cases where status = any(case when p_draft then array['published','draft'] else array['published'] end)),
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
    'cases', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'summary', c.summary, 'assignment', c.assignment,
        'conclusion', c.conclusion, 'status', c.status, 'area_keys', c.area_keys, 'tags', c.tags,
        'steps', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'body', s.body,
            'unit_id', case when s.unit_id in (select id from good) then s.unit_id end) order by s.sort, s.id) from public.case_steps s where s.case_id = c.id), '[]'),
        'unit_ids', coalesce((select jsonb_agg(l.unit_id order by l.unit_id) from public.case_links l where l.case_id = c.id and l.unit_id in (select id from good)), '[]'))
        order by c.sort, c.title) from cas c), '[]'),
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
    'cases', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort, c.title) from public.cases c), '[]'),
    'case_steps', coalesce((select jsonb_agg(to_jsonb(s) order by s.case_id, s.sort) from public.case_steps s), '[]'),
    'case_links', coalesce((select jsonb_agg(to_jsonb(l)) from public.case_links l), '[]'),
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
    'news_sources', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.news_sources x),
    'cases', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.cases x),
    'case_steps', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.case_steps x),
    'case_links', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.case_links x),
    'news_items', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.news_items x where x.status <> 'rejected'),
    'student_groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.student_groups x));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.rq_save_case(text, jsonb)', 'public.rq_delete_case(text)', 'public.rq_save_case_step(text, text, jsonb)',
                           'public.rq_move_case_step(text, int)', 'public.rq_delete_case_step(text)', 'public.rq_link_case_unit(text, text, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
