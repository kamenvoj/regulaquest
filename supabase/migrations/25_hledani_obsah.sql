-- RegulaQuest · 25 · Hledání a novinky napříč obsahem
-- * Co je nového: přehled změn publikace počítá i nové řešené případy (cases_new).
-- * Seznam prezentací pro čtečku nese u snímků prostý text (hledání nahoře, Najít předpisy) – bez poznámek řečníka.
-- Lze spustit opakovaně.

create or replace function rq_private.publication_changes(p_old jsonb, p_new jsonb, p_prev_changes jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  items jsonb := '[]'; s_new int := 0; s_chg int := 0; c_new int := 0; r_new int := 0; n_paths int := 0; n_cases int := 0; new_cases jsonb := '[]';
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
  select coalesce(jsonb_agg(jsonb_build_object('id', c->>'id', 'title', c->>'title')), '[]'), count(*) into new_cases, n_cases
    from jsonb_array_elements(coalesce(p_new->'cases', '[]')) c
   where not exists (select 1 from jsonb_array_elements(coalesce(p_old->'cases', '[]')) o where o->>'id' = c->>'id');
  -- dokument u nových výkladů a vazeb
  select coalesce(jsonb_agg(case when i ? 'document_id' then i else i || jsonb_build_object('document_id',
           (select x->>'document_id' from jsonb_array_elements(p_new->'units') x where x->>'id' = i->>'unit_id' limit 1)) end), '[]')
    into items from jsonb_array_elements(items) i;
  select doc_upd || coalesce(jsonb_object_agg(i->>'document_id', today), '{}') into doc_upd
    from jsonb_array_elements(items) i where i->>'document_id' is not null;
  return jsonb_build_object('summary', jsonb_build_object('units_new', s_new, 'units_changed', s_chg, 'comments_new', c_new, 'relations_new', r_new, 'paths_new', n_paths, 'cases_new', n_cases),
    'items', (select coalesce(jsonb_agg(x), '[]') from (select x from jsonb_array_elements(items) x limit 80) t),
    'items_total', jsonb_array_length(items), 'paths_new', new_paths, 'cases_new', new_cases, 'doc_updated', doc_upd);
end $$;

-- Prostý text snímku (nadpisy, texty, tabulky) pro hledání
create or replace function rq_private.slide_text(p jsonb) returns text
language sql immutable as $$
  select left(regexp_replace(coalesce(string_agg(v #>> '{}', ' '), ''), '\*\*|\s+', ' ', 'g'), 4000) from (
    select jsonb_path_query(p, 'strict $.**.text') v union all select jsonb_path_query(p, 'strict $.**.heading')
    union all select jsonb_path_query(p, 'lax $.subtitle') union all select jsonb_path_query(p, 'strict $.**.rows[*][*]')
    union all select jsonb_path_query(p, 'strict $.**.caption')) x where jsonb_typeof(v) = 'string'
$$;

create or replace function public.rq_reader_presentations() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.rq_is_member() then raise exception 'Přístup není aktivní.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'subtitle', p.subtitle, 'description', p.description,
      'status', p.status, 'area_keys', p.area_keys, 'tags', p.tags,
      'visible_from', (select min(g.visible_from) from public.presentation_groups g join public.profiles pf on pf.group_id = g.group_id where g.presentation_id = p.id and pf.user_id = auth.uid()),
      'slides', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', coalesce(s.data->>'title', ''), 'kicker', coalesce(s.data->>'kicker', ''),
          'units', rq_private.slide_units(s.data), 'text', rq_private.slide_text(s.data)) order by s.sort, s.id) from public.presentation_slides s where s.presentation_id = p.id), '[]'),
      'unit_links', coalesce((select jsonb_agg(jsonb_build_object('slide_id', l.slide_id, 'unit_id', l.unit_id)) from public.presentation_unit_links l where l.presentation_id = p.id), '[]'))
    order by p.sort, p.title)
    from public.presentations p where p.status <> 'archived' and rq_private.can_see_presentation(p.id)), '[]');
end $$;
