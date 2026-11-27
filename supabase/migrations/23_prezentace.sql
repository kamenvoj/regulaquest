-- RegulaQuest · 23 · Prezentace (samostatně od dokumentů)
-- Prezentace = snímky skládané z bloků (JSON: rozvržení, sekce, štítek, nadpis, karty, pruhy, tabulky, klíčová myšlenka)
-- a poznámky řečníka. Vzhled dělá společná šablona aplikace, ne autor. Odkazy z částí snímků vedou na ustanovení
-- ({"link": {"unit": "…"}}) nebo na jiný snímek ({"link": {"slide": "…", "pres": "…"}}).
-- Studenti vidí prezentaci ve stavu „Připravená“, pokud je zpřístupněná jejich skupině a nastalo datum zpřístupnění.
-- Poznámky řečníka studenti nedostanou nikdy. Úklid testovacích dat zruší jen ruční vazby na ustanovení. Lze spustit opakovaně.

create table if not exists public.presentations (
  id          text primary key,
  title       text not null check (length(title) between 1 and 200),
  subtitle    text not null default '' check (length(subtitle) <= 300),
  description text not null default '' check (length(description) <= 2000),
  status      text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
  area_keys   text[] not null default '{}',
  tags        text[] not null default '{}',
  sort        int not null default 100,
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create table if not exists public.presentation_slides (
  id              text primary key,
  presentation_id text not null references public.presentations(id) on delete cascade,
  sort            int not null default 0,
  data            jsonb not null default '{}' check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 200000),
  notes           text not null default '' check (length(notes) <= 20000),
  updated_at      timestamptz not null default now()
);
create index if not exists ix_presentation_slides on public.presentation_slides(presentation_id, sort);
create table if not exists public.presentation_groups (
  presentation_id text not null references public.presentations(id) on delete cascade,
  group_id        uuid not null references public.student_groups(id) on delete cascade,
  visible_from    date not null default current_date,
  primary key (presentation_id, group_id)
);
create table if not exists public.presentation_unit_links (
  id              bigint generated always as identity primary key,
  presentation_id text not null references public.presentations(id) on delete cascade,
  slide_id        text references public.presentation_slides(id) on delete cascade,
  unit_id         text not null
);
create unique index if not exists ux_presentation_unit_links on public.presentation_unit_links(presentation_id, coalesce(slide_id, ''), unit_id);
do $$
declare t text;
begin
  foreach t in array array['presentations', 'presentation_slides', 'presentation_groups', 'presentation_unit_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists admin_read on public.%I', t);
    execute format('create policy admin_read on public.%I for select to authenticated using (public.rq_is_admin())', t);
  end loop;
end $$;

-- Smí aktuální uživatel prezentaci vidět? Admin vždy; student jen připravenou, zpřístupněnou jeho skupině od data.
create or replace function rq_private.can_see_presentation(p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.rq_is_admin() or (public.rq_is_member() and exists (
    select 1 from public.presentations pr
      join public.presentation_groups g on g.presentation_id = pr.id
      join public.profiles p on p.group_id = g.group_id
     where pr.id = p_id and pr.status = 'ready' and p.user_id = auth.uid() and g.visible_from <= current_date))
$$;

-- Ustanovení, na která odkazuje snímek (z libovolného místa v JSON)
create or replace function rq_private.slide_units(p jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct v #>> '{}'), '{}') from jsonb_path_query(p, 'strict $.**.link.unit') v where jsonb_typeof(v) = 'string'
$$;

create or replace function rq_private.slide_targets(p jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct v #>> '{}'), '{}') from jsonb_path_query(p, 'strict $.**.link.slide') v where jsonb_typeof(v) = 'string'
$$;

create or replace function rq_private.check_tags(p text[]) returns text[]
language plpgsql stable set search_path = public as $$
begin
  if exists (select 1 from unnest(coalesce(p, '{}')) k where not exists (select 1 from public.tags t where t.key = k)) then raise exception 'Neznámý štítek'; end if;
  return coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p, '{}')) x), '{}');
end $$;

-- ---------- Studio ----------
create or replace function public.rq_presentations_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  return jsonb_build_object(
    'presentations', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object(
        'slides', (select count(*) from public.presentation_slides s where s.presentation_id = p.id),
        'groups', coalesce((select jsonb_agg(jsonb_build_object('group_id', g.group_id, 'visible_from', g.visible_from)) from public.presentation_groups g where g.presentation_id = p.id), '[]'))
      order by p.sort, p.title) from public.presentations p), '[]'),
    'slide_index', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'presentation_id', x.presentation_id, 'n', x.n, 'title', coalesce(x.data->>'title', ''),
        'units', rq_private.slide_units(x.data), 'targets', rq_private.slide_targets(x.data))) from (select s.*, row_number() over (partition by s.presentation_id order by s.sort, s.id) n
        from public.presentation_slides s) x), '[]'),
    'unit_links', coalesce((select jsonb_agg(to_jsonb(l)) from public.presentation_unit_links l), '[]'),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'active', g.active) order by g.created_at desc) from public.student_groups g), '[]'));
end $$;

create or replace function public.rq_presentation_admin(p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  return (select to_jsonb(p) || jsonb_build_object(
      'slides', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'data', s.data, 'notes', s.notes, 'sort', s.sort) order by s.sort, s.id)
                          from public.presentation_slides s where s.presentation_id = p.id), '[]'),
      'groups', coalesce((select jsonb_agg(jsonb_build_object('group_id', g.group_id, 'visible_from', g.visible_from)) from public.presentation_groups g where g.presentation_id = p.id), '[]'))
    from public.presentations p where p.id = p_id);
end $$;

-- p: {title, subtitle, description, status, area_keys, tags}
create or replace function public.rq_save_presentation(p_id text default null, p jsonb default '{}') returns text
language plpgsql security definer set search_path = public as $$
declare v text := nullif(btrim(coalesce(p_id, '')), ''); st text := coalesce(nullif(p->>'status', ''), 'draft');
  ar text[] := rq_private.clean_area_keys(rq_private.jtext(p->'area_keys')); tg text[] := rq_private.check_tags(rq_private.jtext(p->'tags'));
begin
  perform rq_private.require_admin();
  if coalesce(btrim(p->>'title'), '') = '' then raise exception 'Napište název prezentace'; end if;
  if st not in ('draft', 'ready', 'archived') then raise exception 'Neznámý stav'; end if;
  if v is null then
    v := rq_private.token('pres');
    insert into public.presentations(id, title, subtitle, description, status, area_keys, tags, sort, created_by, updated_by)
    values (v, left(btrim(p->>'title'), 200), left(btrim(coalesce(p->>'subtitle', '')), 300), left(btrim(coalesce(p->>'description', '')), 2000),
            st, ar, tg, coalesce((select max(sort) + 10 from public.presentations), 10), auth.uid(), auth.uid());
  else
    update public.presentations set title = left(btrim(p->>'title'), 200), subtitle = left(btrim(coalesce(p->>'subtitle', '')), 300),
      description = left(btrim(coalesce(p->>'description', '')), 2000), status = st, area_keys = ar, tags = tg, updated_at = now(), updated_by = auth.uid()
    where id = v;
    if not found then raise exception 'Prezentace nebyla nalezena'; end if;
  end if;
  return v;
end $$;

create or replace function public.rq_delete_presentation(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  delete from public.presentations where id = p_id;
  if not found then raise exception 'Prezentace nebyla nalezena'; end if;
end $$;

-- Import: nová prezentace se snímky [{data, notes}]
create or replace function public.rq_import_presentation(p jsonb, p_slides jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v text; s jsonb; n int := 0;
begin
  perform rq_private.require_admin();
  if jsonb_typeof(p_slides) <> 'array' or jsonb_array_length(p_slides) = 0 then raise exception 'Prezentace nemá žádné snímky'; end if;
  if jsonb_array_length(p_slides) > 300 then raise exception 'Prezentace má víc než 300 snímků'; end if;
  v := public.rq_save_presentation(null, p);
  for s in select * from jsonb_array_elements(p_slides) loop
    n := n + 1;
    insert into public.presentation_slides(id, presentation_id, sort, data, notes)
    values (rq_private.token('slide'), v, n * 10, coalesce(s->'data', '{}'), left(coalesce(s->>'notes', ''), 20000));
  end loop;
  return v;
end $$;

-- Nová verze z PowerPointu: p_slides = [{id (spárovaný stávající snímek, jinak null), data, notes}] v novém pořadí.
-- Spárované snímky si ponechají id (odkazy na ně z jiných snímků a z ustanovení zůstanou), ostatní stávající se smažou.
create or replace function public.rq_replace_slides(p_presentation_id text, p_slides jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb; n int := 0; keep text[] := '{}'; v text; upd int := 0; ins int := 0; del int;
begin
  perform rq_private.require_admin();
  if not exists (select 1 from public.presentations where id = p_presentation_id) then raise exception 'Prezentace nebyla nalezena'; end if;
  if jsonb_typeof(p_slides) <> 'array' or jsonb_array_length(p_slides) = 0 then raise exception 'Nová verze nemá žádné snímky'; end if;
  if exists (select 1 from jsonb_array_elements(p_slides) x where nullif(x->>'id', '') is not null
             and not exists (select 1 from public.presentation_slides ps where ps.id = x->>'id' and ps.presentation_id = p_presentation_id)) then
    raise exception 'Snímek nepatří k této prezentaci';
  end if;
  select array_agg(x->>'id') into keep from jsonb_array_elements(p_slides) x where nullif(x->>'id', '') is not null;
  delete from public.presentation_slides where presentation_id = p_presentation_id and not (id = any(coalesce(keep, '{}')));
  get diagnostics del = row_count;
  for s in select * from jsonb_array_elements(p_slides) loop
    n := n + 1; v := nullif(s->>'id', '');
    if v is null then
      insert into public.presentation_slides(id, presentation_id, sort, data, notes)
      values (rq_private.token('slide'), p_presentation_id, n * 10, coalesce(s->'data', '{}'), left(coalesce(s->>'notes', ''), 20000));
      ins := ins + 1;
    else
      update public.presentation_slides set sort = n * 10, data = coalesce(s->'data', '{}'), notes = left(coalesce(s->>'notes', ''), 20000), updated_at = now() where id = v;
      upd := upd + 1;
    end if;
  end loop;
  update public.presentations set updated_at = now(), updated_by = auth.uid() where id = p_presentation_id;
  return jsonb_build_object('updated', upd, 'inserted', ins, 'deleted', del);
end $$;

-- Uložení snímku; nový se vloží za p_after (nebo na konec)
create or replace function public.rq_save_slide(p_id text default null, p_presentation_id text default null, p_data jsonb default '{}',
  p_notes text default '', p_after text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v text := nullif(btrim(coalesce(p_id, '')), ''); pos int;
begin
  perform rq_private.require_admin();
  if jsonb_typeof(p_data) <> 'object' then raise exception 'Neplatný obsah snímku'; end if;
  if v is null then
    if not exists (select 1 from public.presentations where id = p_presentation_id) then raise exception 'Prezentace nebyla nalezena'; end if;
    select sort into pos from public.presentation_slides where id = p_after and presentation_id = p_presentation_id;
    if pos is not null then
      update public.presentation_slides set sort = sort + 10 where presentation_id = p_presentation_id and sort > pos;
      pos := pos + 10;
    else
      pos := coalesce((select max(sort) + 10 from public.presentation_slides where presentation_id = p_presentation_id), 10);
    end if;
    v := rq_private.token('slide');
    insert into public.presentation_slides(id, presentation_id, sort, data, notes) values (v, p_presentation_id, pos, p_data, left(coalesce(p_notes, ''), 20000));
  else
    update public.presentation_slides set data = p_data, notes = left(coalesce(p_notes, ''), 20000), updated_at = now() where id = v;
    if not found then raise exception 'Snímek nebyl nalezen'; end if;
  end if;
  update public.presentations set updated_at = now(), updated_by = auth.uid() where id = (select presentation_id from public.presentation_slides where id = v);
  return v;
end $$;

create or replace function public.rq_move_slide(p_id text, p_dir int) returns void
language plpgsql security definer set search_path = public as $$
declare pr text; ids text[]; i int; t text;
begin
  perform rq_private.require_admin();
  select presentation_id into pr from public.presentation_slides where id = p_id;
  if pr is null then raise exception 'Snímek nebyl nalezen'; end if;
  select array_agg(id order by sort, id) into ids from public.presentation_slides where presentation_id = pr;
  i := array_position(ids, p_id);
  if i + p_dir between 1 and array_length(ids, 1) then t := ids[i]; ids[i] := ids[i + p_dir]; ids[i + p_dir] := t; end if;
  update public.presentation_slides s set sort = x.n * 10 from unnest(ids) with ordinality x(id, n) where s.id = x.id;
end $$;

create or replace function public.rq_delete_slide(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  delete from public.presentation_slides where id = p_id;
  if not found then raise exception 'Snímek nebyl nalezen'; end if;
end $$;

-- Zpřístupnění skupině od data (p_on = false odebere)
create or replace function public.rq_set_presentation_group(p_presentation_id text, p_group_id uuid, p_visible_from date default null, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  if p_on then
    insert into public.presentation_groups(presentation_id, group_id, visible_from) values (p_presentation_id, p_group_id, coalesce(p_visible_from, current_date))
    on conflict (presentation_id, group_id) do update set visible_from = excluded.visible_from;
  else
    delete from public.presentation_groups where presentation_id = p_presentation_id and group_id = p_group_id;
  end if;
end $$;

-- Ruční vazba z ustanovení na prezentaci nebo konkrétní snímek
create or replace function public.rq_link_presentation_unit(p_presentation_id text, p_slide_id text, p_unit_id text, p_add boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  if p_add then
    perform rq_private.unit_row(p_unit_id);
    if nullif(p_slide_id, '') is not null and not exists (select 1 from public.presentation_slides where id = p_slide_id and presentation_id = p_presentation_id) then
      raise exception 'Snímek nebyl nalezen';
    end if;
    insert into public.presentation_unit_links(presentation_id, slide_id, unit_id) values (p_presentation_id, nullif(p_slide_id, ''), p_unit_id) on conflict do nothing;
  else
    delete from public.presentation_unit_links where presentation_id = p_presentation_id and coalesce(slide_id, '') = coalesce(p_slide_id, '') and unit_id = p_unit_id;
  end if;
end $$;

-- ---------- čtečka ----------
-- Seznam viditelných prezentací s rejstříkem snímků (nadpis, odkazovaná ustanovení) – bez obsahu a poznámek
create or replace function public.rq_reader_presentations() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.rq_is_member() then raise exception 'Přístup není aktivní.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'subtitle', p.subtitle, 'description', p.description,
      'status', p.status, 'area_keys', p.area_keys, 'tags', p.tags,
      'visible_from', (select min(g.visible_from) from public.presentation_groups g join public.profiles pf on pf.group_id = g.group_id where g.presentation_id = p.id and pf.user_id = auth.uid()),
      'slides', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', coalesce(s.data->>'title', ''), 'kicker', coalesce(s.data->>'kicker', ''),
          'units', rq_private.slide_units(s.data)) order by s.sort, s.id) from public.presentation_slides s where s.presentation_id = p.id), '[]'),
      'unit_links', coalesce((select jsonb_agg(jsonb_build_object('slide_id', l.slide_id, 'unit_id', l.unit_id)) from public.presentation_unit_links l where l.presentation_id = p.id), '[]'))
    order by p.sort, p.title)
    from public.presentations p where p.status <> 'archived' and rq_private.can_see_presentation(p.id)), '[]');
end $$;

-- Obsah prezentace; poznámky řečníka jen pro redakci
create or replace function public.rq_reader_presentation(p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare adm boolean := public.rq_is_admin();
begin
  if not rq_private.can_see_presentation(p_id) then raise exception 'Prezentace není dostupná.' using errcode = '42501'; end if;
  return (select jsonb_build_object('id', p.id, 'title', p.title, 'subtitle', p.subtitle,
      'slides', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'data', s.data) || case when adm then jsonb_build_object('notes', s.notes) else '{}' end order by s.sort, s.id)
                          from public.presentation_slides s where s.presentation_id = p.id), '[]'))
    from public.presentations p where p.id = p_id);
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
    'links', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.links x),
    'presentations', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.presentations x),
    'presentation_slides', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.presentation_slides x),
    'presentation_groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.presentation_groups x),
    'presentation_unit_links', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.presentation_unit_links x),
    'news_items', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.news_items x where x.status <> 'rejected'),
    'student_groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.student_groups x));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.rq_presentations_admin()', 'public.rq_presentation_admin(text)', 'public.rq_save_presentation(text, jsonb)',
                           'public.rq_delete_presentation(text)', 'public.rq_import_presentation(jsonb, jsonb)', 'public.rq_replace_slides(text, jsonb)',
                           'public.rq_save_slide(text, text, jsonb, text, text)', 'public.rq_move_slide(text, int)', 'public.rq_delete_slide(text)',
                           'public.rq_set_presentation_group(text, uuid, date, boolean)', 'public.rq_link_presentation_unit(text, text, text, boolean)',
                           'public.rq_reader_presentations()', 'public.rq_reader_presentation(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
