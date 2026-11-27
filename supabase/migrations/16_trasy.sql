-- RegulaQuest · 16 · Trasy (průchody dokumenty)
-- Trasa = seřazené kroky; krok míří na část libovolného dokumentu (volitelně na místo v textu) a má komentář redakce.
-- Ve čtečce jsou jen zveřejněné trasy (od příští publikace) a jen kroky na publikované části. Lze spustit opakovaně.

create table if not exists public.paths (
  id          text primary key,
  title       text not null check (length(title) between 1 and 200),
  description text not null default '' check (length(description) <= 5000),
  status      text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort        int not null default 100,
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create table if not exists public.path_steps (
  id                text primary key,
  path_id           text not null references public.paths(id),
  sort              int not null default 0,
  unit_id           text references public.units(id),
  title             text not null default '' check (length(title) <= 200),
  note              text not null default '' check (length(note) <= 15000),
  anchor_text       text not null default '' check (length(anchor_text) <= 1000),
  anchor_occurrence int not null default 1 check (anchor_occurrence between 1 and 500),
  check (unit_id is not null or title <> '' or note <> '')
);
create index if not exists ix_path_steps on public.path_steps(path_id, sort);

do $$
declare t text;
begin
  foreach t in array array['paths', 'path_steps'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists admin_read on public.%I', t);
    execute format('create policy admin_read on public.%I for select to authenticated using (public.rq_is_admin())', t);
  end loop;
end $$;

create or replace function public.rq_save_path(p_id text, p_title text, p_description text default '', p_status text default 'draft') returns text
language plpgsql security definer set search_path = public as $$
declare v text := nullif(btrim(coalesce(p_id, '')), '');
begin
  perform rq_private.require_admin();
  if v is null then
    v := rq_private.token('path');
    insert into public.paths(id, title, description, status, sort, created_by, updated_by)
    values (v, btrim(p_title), btrim(coalesce(p_description, '')), coalesce(p_status, 'draft'),
            coalesce((select max(sort) + 10 from public.paths), 10), auth.uid(), auth.uid());
  else
    update public.paths set title = btrim(p_title), description = btrim(coalesce(p_description, '')), status = coalesce(p_status, status),
           updated_at = now(), updated_by = auth.uid() where id = v;
    if not found then raise exception 'Trasa nebyla nalezena'; end if;
  end if;
  return v;
end $$;

create or replace function public.rq_save_path_step(p_id text, p_path_id text, p_unit_id text, p_title text default '', p_note text default '',
  p_anchor_text text default '', p_anchor_occurrence int default 1) returns text
language plpgsql security definer set search_path = public as $$
declare v text := nullif(btrim(coalesce(p_id, '')), ''); a text := '';
begin
  perform rq_private.require_admin();
  if nullif(p_unit_id, '') is not null then a := rq_private.check_anchor(p_unit_id, p_anchor_text); end if;
  if v is null then
    if not exists (select 1 from public.paths where id = p_path_id) then raise exception 'Trasa nebyla nalezena'; end if;
    v := rq_private.token('step');
    insert into public.path_steps(id, path_id, sort, unit_id, title, note, anchor_text, anchor_occurrence)
    values (v, p_path_id, coalesce((select max(sort) + 10 from public.path_steps where path_id = p_path_id), 10), nullif(p_unit_id, ''),
            btrim(coalesce(p_title, '')), btrim(coalesce(p_note, '')), a, greatest(1, coalesce(p_anchor_occurrence, 1)));
  else
    update public.path_steps set unit_id = nullif(p_unit_id, ''), title = btrim(coalesce(p_title, '')), note = btrim(coalesce(p_note, '')),
           anchor_text = a, anchor_occurrence = greatest(1, coalesce(p_anchor_occurrence, 1)) where id = v;
    if not found then raise exception 'Krok nebyl nalezen'; end if;
  end if;
  update public.paths set updated_at = now(), updated_by = auth.uid() where id = (select path_id from public.path_steps where id = v);
  return v;
end $$;

-- Posun kroku o jedno místo nahoru (-1) nebo dolů (+1).
create or replace function public.rq_move_path_step(p_id text, p_dir int) returns void
language plpgsql security definer set search_path = public as $$
declare s public.path_steps; o public.path_steps;
begin
  perform rq_private.require_admin();
  select * into s from public.path_steps where id = p_id;
  if not found then raise exception 'Krok nebyl nalezen'; end if;
  if p_dir < 0 then select * into o from public.path_steps where path_id = s.path_id and (sort, id) < (s.sort, s.id) order by sort desc, id desc limit 1;
  else select * into o from public.path_steps where path_id = s.path_id and (sort, id) > (s.sort, s.id) order by sort, id limit 1; end if;
  if o.id is null then return; end if;
  update public.path_steps set sort = case id when s.id then o.sort when o.id then s.sort end where id in (s.id, o.id);
  if s.sort = o.sort then update public.path_steps set sort = sort + (case when p_dir < 0 then -1 else 1 end) where id = s.id; end if;
end $$;

create or replace function public.rq_delete_path_step(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  delete from public.path_steps where id = p_id;
end $$;

create or replace function public.rq_delete_path(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  if exists (select 1 from public.paths where id = p_id and status = 'published') then
    raise exception 'Zveřejněnou trasu nejdřív vraťte do konceptu nebo archivujte.';
  end if;
  delete from public.path_steps where path_id = p_id;
  delete from public.paths where id = p_id;
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
  delete from public.path_steps where unit_id in (select id from _rq_del_units);
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
        'group_key', group_key, 'jurisdiction', jurisdiction, 'document_type', document_type, 'topics', topics) order by id) from docs), '[]'),
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
    'paths', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.paths x),
    'path_steps', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.path_steps x),
    'tag_groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.tag_groups x),
    'tags', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.tags x),
    'student_groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.student_groups x));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.rq_save_path(text, text, text, text)', 'public.rq_save_path_step(text, text, text, text, text, text, int)',
    'public.rq_move_path_step(text, int)', 'public.rq_delete_path_step(text)', 'public.rq_delete_path(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
