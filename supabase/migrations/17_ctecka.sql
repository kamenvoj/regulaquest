-- RegulaQuest · 17 · Čtečka pro studenty: přehled, „Co je nového“, záložky a postup u účtu
-- documents: krátký název pro studenty, doporučení na úvodní stránku.
-- publications.changes: souhrn změn proti předchozí publikaci (počítá se při publikaci; jednotky kB).
-- reader_*: záložky, poslední pozice a prošlé kroky tras – jen pro vlastní účet, mažou se s účtem.
-- Lze spustit opakovaně.

alter table public.documents add column if not exists short_title text not null default '';
alter table public.documents add column if not exists featured boolean not null default false;
alter table public.documents add column if not exists featured_sort int not null default 100;
alter table public.publications add column if not exists changes jsonb not null default '{}';

create or replace function public.rq_update_document(p_id text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare d public.documents; v_topics text[];
begin
  perform rq_private.require_admin();
  select * into d from public.documents where id = p_id;
  if not found then raise exception 'Neznámý dokument'; end if;
  if p ? 'topics' then
    if jsonb_typeof(p->'topics') <> 'array' or jsonb_array_length(p->'topics') > 40 then
      raise exception 'Neplatné odborné tagy (max. 40)';
    end if;
    select coalesce(array_agg(distinct btrim(t)), '{}') into v_topics
      from jsonb_array_elements_text(p->'topics') t where btrim(t) <> '';
    if exists (select 1 from unnest(v_topics) t where length(t) > 70) then raise exception 'Tag může mít nejvýše 70 znaků'; end if;
  end if;
  update public.documents set
    title = coalesce(nullif(btrim(p->>'title'), ''), title),
    family = coalesce(nullif(btrim(p->>'family'), ''), family),
    kind = coalesce(p->>'kind', kind),
    version = coalesce(p->>'version', version),
    valid_date = case when p ? 'valid_date' then nullif(p->>'valid_date', '')::date else valid_date end,
    publisher = coalesce(p->>'publisher', publisher),
    url = coalesce(btrim(p->>'url'), url),
    short_title = coalesce(left(btrim(p->>'short_title'), 120), short_title),
    updated_at = now(), updated_by = auth.uid()
  where id = p_id;
  -- Původ, druh a tagy jsou společné pro všechny jazykové verze téhož předpisu.
  update public.documents set
    jurisdiction = coalesce(p->>'jurisdiction', jurisdiction),
    document_type = coalesce(p->>'document_type', document_type),
    topics = coalesce(v_topics, topics),
    featured = coalesce((p->>'featured')::boolean, featured),
    featured_sort = coalesce((p->>'featured_sort')::int, featured_sort),
    updated_at = now(), updated_by = auth.uid()
  where group_key = d.group_key;
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

-- Otisk části pro porovnání publikací (text + tabulky + stav).
create or replace function rq_private.unit_sig(u jsonb) returns text language sql immutable as $$
  select md5(coalesce(u->>'body', '') || '|' || coalesce(u->>'content_blocks', '') || '|' || coalesce(u->>'label', '') || '|' || coalesce(u->>'heading', ''))
$$;

-- Souhrn změn nové publikace proti předchozí.
create or replace function rq_private.publication_changes(p_old jsonb, p_new jsonb, p_prev_changes jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  items jsonb := '[]'; s_new int := 0; s_chg int := 0; c_new int := 0; r_new int := 0; n_paths int := 0;
  doc_upd jsonb := coalesce(p_prev_changes->'doc_updated', '{}'); today text := to_char(now(), 'YYYY-MM-DD');
  u jsonb; old_sig text; what text; new_paths jsonb := '[]';
begin
  if p_old is null then
    -- první publikace: vše je nové, seznam položek nevypisujeme
    select coalesce(jsonb_object_agg(d->>'id', today), '{}') into doc_upd from jsonb_array_elements(p_new->'documents') d;
    return jsonb_build_object('first', true, 'summary', jsonb_build_object('units_new', jsonb_array_length(p_new->'units')), 'items', '[]'::jsonb, 'doc_updated', doc_upd, 'paths_new', '[]'::jsonb);
  end if;
  for u in select * from jsonb_array_elements(p_new->'units') loop
    if coalesce((u->>'navigation_only')::boolean, false) then continue; end if;
    select rq_private.unit_sig(o) into old_sig from jsonb_array_elements(p_old->'units') o where o->>'id' = u->>'id' and not coalesce((o->>'navigation_only')::boolean, false);
    what := null;
    if old_sig is null then what := 'nově zveřejněno'; s_new := s_new + 1;
    elsif old_sig <> rq_private.unit_sig(u) then what := 'změněné znění'; s_chg := s_chg + 1; end if;
    if what is not null then
      items := items || jsonb_build_array(jsonb_build_object('unit_id', u->>'id', 'document_id', u->>'document_id', 'what', what));
      doc_upd := doc_upd || jsonb_build_object(u->>'document_id', today);
    end if;
  end loop;
  -- nové výklady a vazby (počítáno po částech)
  for u in
    select jsonb_build_object('unit_id', c->>'unit_id', 'n', count(*)) from jsonb_array_elements(p_new->'comments') c
     where not exists (select 1 from jsonb_array_elements(p_old->'comments') o where o->>'id' = c->>'id')
       and c->>'kind' not in ('key', 'duty', 'deadline', 'exception')
     group by c->>'unit_id'
  loop
    c_new := c_new + (u->>'n')::int;
    items := items || jsonb_build_array(jsonb_build_object('unit_id', u->>'unit_id', 'what', case when (u->>'n')::int = 1 then 'nový výklad' else (u->>'n') || ' nové výklady' end));
  end loop;
  for u in
    select jsonb_build_object('unit_id', r->>'source_id', 'n', count(*)) from jsonb_array_elements(p_new->'relations') r
     where not exists (select 1 from jsonb_array_elements(p_old->'relations') o where o->>'id' = r->>'id')
     group by r->>'source_id'
  loop
    r_new := r_new + (u->>'n')::int;
    items := items || jsonb_build_array(jsonb_build_object('unit_id', u->>'unit_id', 'what', case when (u->>'n')::int = 1 then 'nová vazba' else (u->>'n') || ' nové vazby' end));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', p->>'id', 'title', p->>'title')), '[]'), count(*) into new_paths, n_paths
    from jsonb_array_elements(coalesce(p_new->'paths', '[]')) p
   where not exists (select 1 from jsonb_array_elements(coalesce(p_old->'paths', '[]')) o where o->>'id' = p->>'id');
  -- dokument u nových výkladů a vazeb
  select coalesce(jsonb_agg(case when i ? 'document_id' then i else i || jsonb_build_object('document_id',
           (select x->>'document_id' from jsonb_array_elements(p_new->'units') x where x->>'id' = i->>'unit_id' limit 1)) end), '[]')
    into items from jsonb_array_elements(items) i;
  select doc_upd || coalesce(jsonb_object_agg(i->>'document_id', today), '{}') into doc_upd
    from jsonb_array_elements(items) i where i->>'document_id' is not null;
  return jsonb_build_object('summary', jsonb_build_object('units_new', s_new, 'units_changed', s_chg, 'comments_new', c_new, 'relations_new', r_new, 'paths_new', n_paths),
    'items', (select coalesce(jsonb_agg(x), '[]') from (select x from jsonb_array_elements(items) x limit 80) t),
    'items_total', jsonb_array_length(items), 'paths_new', new_paths, 'doc_updated', doc_upd);
end $$;
revoke all on function rq_private.publication_changes(jsonb, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.rq_publish(p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_data jsonb := rq_private.reader_data(false); v_id bigint; prev public.publications; v_changes jsonb;
begin
  perform rq_private.require_admin();
  select * into prev from public.publications where is_current;
  v_changes := rq_private.publication_changes(prev.data, v_data, prev.changes);
  update public.publications set is_current = false where is_current;
  insert into public.publications(created_by, note, counts, data, is_current, changes)
  values (auth.uid(), left(coalesce(p_note, ''), 2000), v_data->'counts', v_data, true, v_changes) returning id into v_id;
  return jsonb_build_object('id', v_id, 'counts', v_data->'counts', 'changes', v_changes->'summary');
end $$;

-- Historie publikací pro „Co je nového“ (posledních 10).
create or replace function rq_private.publication_history() returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'published_at', created_at, 'note', note, 'changes', changes - 'doc_updated') order by id desc), '[]')
    from (select * from public.publications order by id desc limit 10) p
$$;
revoke all on function rq_private.publication_history() from public, anon, authenticated;

create or replace function public.rq_current_publication() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.rq_is_member() then
    raise exception 'Přístup není aktivní. Obraťte se na vyučujícího.' using errcode = '42501';
  end if;
  select data || jsonb_build_object('publication_id', id, 'published_at', created_at,
         'doc_updated', coalesce(changes->'doc_updated', '{}'), 'history', rq_private.publication_history()) into v
    from public.publications where is_current;
  return v;
end $$;

create or replace function public.rq_draft_preview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  return rq_private.reader_data(true) || jsonb_build_object('history', rq_private.publication_history(),
    'doc_updated', coalesce((select changes->'doc_updated' from public.publications where is_current), '{}'));
end $$;

-- ---------------------------------------------------------------- osobní data čtenáře (jen vlastní účet)
create table if not exists public.reader_marks (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  unit_id    text not null check (length(unit_id) <= 160),
  label      text not null default '' check (length(label) <= 80),
  created_at timestamptz not null default now()
);
create index if not exists ix_reader_marks on public.reader_marks(user_id, created_at desc);
create table if not exists public.reader_positions (
  user_id    uuid not null references auth.users(id) on delete cascade,
  doc_group  text not null,
  unit_id    text not null check (length(unit_id) <= 160),
  updated_at timestamptz not null default now(),
  primary key (user_id, doc_group)
);
create table if not exists public.reader_progress (
  user_id  uuid not null references auth.users(id) on delete cascade,
  path_id  text not null,
  step_id  text not null,
  done_at  timestamptz not null default now(),
  primary key (user_id, path_id, step_id)
);
do $$
declare t text;
begin
  foreach t in array array['reader_marks', 'reader_positions', 'reader_progress'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists own_read on public.%I', t);
    execute format('create policy own_read on public.%I for select to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;

create or replace function public.rq_my_reader_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.rq_is_member() then raise exception 'Přístup není aktivní.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'marks', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'unit_id', unit_id, 'label', label, 'created_at', created_at) order by created_at desc)
                       from public.reader_marks where user_id = auth.uid()), '[]'),
    'positions', coalesce((select jsonb_agg(jsonb_build_object('doc_group', doc_group, 'unit_id', unit_id, 'updated_at', updated_at) order by updated_at desc)
                       from public.reader_positions where user_id = auth.uid()), '[]'),
    'progress', coalesce((select jsonb_agg(jsonb_build_object('path_id', path_id, 'step_id', step_id))
                       from public.reader_progress where user_id = auth.uid()), '[]'));
end $$;

create or replace function public.rq_save_mark(p_unit_id text, p_label text default '') returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if not public.rq_is_member() then raise exception 'Přístup není aktivní.' using errcode = '42501'; end if;
  if (select count(*) from public.reader_marks where user_id = auth.uid()) >= 300 then raise exception 'Máte už 300 záložek. Nějakou smažte.'; end if;
  select id into v from public.reader_marks where user_id = auth.uid() and unit_id = p_unit_id;
  if found then
    update public.reader_marks set label = left(btrim(coalesce(p_label, '')), 80) where id = v;
  else
    insert into public.reader_marks(user_id, unit_id, label) values (auth.uid(), left(p_unit_id, 160), left(btrim(coalesce(p_label, '')), 80)) returning id into v;
  end if;
  return v;
end $$;

create or replace function public.rq_delete_mark(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.reader_marks where id = p_id and user_id = auth.uid();
end $$;

create or replace function public.rq_set_position(p_doc_group text, p_unit_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.rq_is_member() then return; end if;
  insert into public.reader_positions(user_id, doc_group, unit_id) values (auth.uid(), left(p_doc_group, 160), left(p_unit_id, 160))
  on conflict (user_id, doc_group) do update set unit_id = excluded.unit_id, updated_at = now();
end $$;

create or replace function public.rq_step_done(p_path_id text, p_step_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.rq_is_member() then return; end if;
  insert into public.reader_progress(user_id, path_id, step_id) values (auth.uid(), left(p_path_id, 80), left(p_step_id, 80))
  on conflict do nothing;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.rq_my_reader_state()', 'public.rq_save_mark(text, text)', 'public.rq_delete_mark(bigint)',
                           'public.rq_set_position(text, text)', 'public.rq_step_done(text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
