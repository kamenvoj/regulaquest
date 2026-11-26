-- RegulaQuest · 02 · Funkce s odbornými pravidly
-- Převzato z lokálního Studia 0.2.15 (server.py, structure_editor.py).
-- Každá veřejná funkce rq_* ověří roli volajícího; zápis do tabulek jinak není možný.
-- Lze spustit opakovaně (create or replace).

-- ================================================================ vnitřní pomocné funkce
create or replace function rq_private.require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.rq_is_admin() then
    raise exception 'Tuto akci smí provést jen admin.' using errcode = '42501';
  end if;
end $$;

create or replace function rq_private.require_owner() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.rq_is_owner() then
    raise exception 'Tuto akci smí provést jen správce.' using errcode = '42501';
  end if;
end $$;

create or replace function rq_private.token(prefix text) returns text
language sql volatile as $$
  select prefix || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14)
$$;

create or replace function rq_private.unit_row(p_id text) returns public.units
language plpgsql stable set search_path = public as $$
declare u public.units;
begin
  select * into u from public.units where id = p_id;
  if not found then raise exception 'Ustanovení neexistuje: %', p_id; end if;
  return u;
end $$;

-- Kontrola souběžné práce: editor posílá čas poslední změny, který načetl.
create or replace function rq_private.check_current(u public.units, p_expected timestamptz, p_required boolean default false)
returns void language plpgsql as $$
begin
  if u.archived then raise exception 'Tato část je po sloučení archivovaná'; end if;
  if p_expected is null and p_required then
    raise exception 'Chybí čas poslední změny. Načtěte aktuální znění.';
  end if;
  if p_expected is not null and u.updated_at <> p_expected then
    raise exception 'Ustanovení se mezitím změnilo (pravděpodobně upravil jiný admin). Načtěte jeho aktuální znění.';
  end if;
end $$;

create or replace function rq_private.log_unit(p_id text, p_event text, p_before jsonb, p_after jsonb, p_reason text)
returns void language sql as $$
  insert into public.unit_edit_history(unit_id, event, before_json, after_json, reason, actor)
  values (p_id, p_event, p_before, p_after, left(coalesce(p_reason, ''), 400), auth.uid())
$$;

create or replace function rq_private.log_relation(p_id text, p_event text, p_before jsonb, p_after jsonb)
returns void language sql as $$
  insert into public.relation_history(relation_id, event_type, before_json, after_json, actor)
  values (p_id, p_event, p_before, p_after, auth.uid())
$$;

create or replace function rq_private.log_comment(p_id text, p_event text, p_before jsonb, p_after jsonb)
returns void language sql as $$
  insert into public.comment_history(comment_id, event_type, before_json, after_json, actor)
  values (p_id, p_event, p_before, p_after, auth.uid())
$$;

-- Změněný obsah vrací schválené vazby a komentáře ke kontrole (ID a historie zůstávají).
create or replace function rq_private.invalidate_approval(p_ids text[]) returns void
language plpgsql set search_path = public as $$
declare r record; after jsonb;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  for r in select * from public.relations
           where status = 'approved' and (source_id = any(p_ids) or target_id = any(p_ids)) loop
    update public.relations set status = 'proposed', updated_at = clock_timestamp(), updated_by = auth.uid()
      where id = r.id returning to_jsonb(relations.*) into after;
    perform rq_private.log_relation(r.id, 'unit_content_changed', to_jsonb(r), after);
    update public.relation_revisions set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
      where relation_id = r.id and status = 'proposed';
  end loop;
  for r in select * from public.comments where status = 'approved' and unit_id = any(p_ids) loop
    update public.comments set status = 'draft', updated_at = clock_timestamp(), updated_by = auth.uid()
      where id = r.id returning to_jsonb(comments.*) into after;
    perform rq_private.log_comment(r.id, 'unit_content_changed', to_jsonb(r), after);
    update public.comment_revisions set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
      where comment_id = r.id and status = 'proposed';
  end loop;
end $$;

-- Nový text vždy ruší ověření; zachová se původ textu.
create or replace function rq_private.body_change(p_id text, p_body text,
  p_note text default 'Redakční úprava struktury nebo obsahu') returns void
language plpgsql set search_path = public as $$
declare old_note text; note text := p_note;
begin
  select source_note into old_note from public.units where id = p_id;
  if coalesce(old_note, '') <> '' and position('Původní zdroj:' in old_note) = 0 then
    note := note || ' · Původní zdroj: ' || left(old_note, 600);
  elsif position('Původní zdroj:' in coalesce(old_note, '')) > 0 then
    note := left(old_note, 900);
  end if;
  update public.units set body = p_body,
    text_status = case when btrim(p_body) <> '' then 'needs_review' else 'missing' end,
    verified_at = null, verified_by = null, source_note = note,
    updated_at = clock_timestamp(), updated_by = auth.uid()
  where id = p_id;
end $$;

-- Povolené formátování: jen tučné, kurzíva, podtržení a zalomení řádku (bez atributů).
create or replace function rq_private.clean_html(p text) returns text
language sql immutable as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(coalesce(p, ''), '<(script|style|iframe|object|svg|math|template)[^>]*>.*?</\1\s*>', '', 'gis'),
             '<(b|strong|i|em|u)\s[^>]*>', '<\1>', 'gi'),
           '<(?!/?(b|strong|i|em|u)>|br\s*/?>)[^>]*>', '', 'gi')
$$;

create or replace function rq_private.html_text(p text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(replace(replace(
           regexp_replace(regexp_replace(coalesce(p, ''), '<br\s*/?>', E'\n', 'gi'), '<[^>]*>', '', 'g'),
         '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&amp;', '&')
$$;

-- Kontrola bloků obsahu (text / tabulka / obrázek); vrací vyčištěné bloky a prostý text pro hledání.
create or replace function rq_private.validate_blocks(p_blocks jsonb, out blocks jsonb, out body text)
language plpgsql as $$
declare b jsonb; r int; rows_n int; v_row jsonb; cell jsonb; cs int; rs int; maxcol int;
        used jsonb; col int; rr int; cc int; texts text[] := '{}'; clean jsonb := '[]'; newrows jsonb; newrow jsonb;
        t text; plain text;
begin
  if jsonb_typeof(p_blocks) <> 'array' or jsonb_array_length(p_blocks) > 100 then
    raise exception 'Obsah musí mít nejvýše 100 bloků';
  end if;
  for b in select * from jsonb_array_elements(p_blocks) loop
    if jsonb_typeof(b) <> 'object' then raise exception 'Neplatný blok obsahu'; end if;
    case b->>'type'
    when 'text' then
      t := b->>'html';
      if t is null or length(t) > 750000 then raise exception 'Neplatný nebo příliš dlouhý formátovaný text'; end if;
      t := rq_private.clean_html(t);
      clean := clean || jsonb_build_array(jsonb_build_object('type', 'text', 'html', t));
      texts := texts || rq_private.html_text(t);
    when 'table' then
      if jsonb_typeof(b->'rows') <> 'array' then raise exception 'Tabulka musí mít řádky'; end if;
      rows_n := jsonb_array_length(b->'rows');
      if rows_n < 1 or rows_n > 80 then raise exception 'Tabulka musí mít 1 až 80 řádků'; end if;
      used := '{}'; maxcol := 0; newrows := '[]';
      for r in 0 .. rows_n - 1 loop
        v_row := b->'rows'->r;
        if jsonb_typeof(v_row) <> 'array' or jsonb_array_length(v_row) > 35 then raise exception 'Neplatný řádek tabulky'; end if;
        col := 0; newrow := '[]';
        for cell in select * from jsonb_array_elements(v_row) loop
          while used ? (r || ',' || col) loop col := col + 1; end loop;
          if jsonb_typeof(cell) <> 'object' then raise exception 'Neplatná buňka tabulky'; end if;
          cs := coalesce((cell->>'colspan')::int, 1); rs := coalesce((cell->>'rowspan')::int, 1);
          if cs < 1 or cs > 30 or rs < 1 or rs > 30 or r + rs > rows_n then raise exception 'Neplatné sloučení buněk'; end if;
          if col + cs > 35 then raise exception 'Tabulka může mít nejvýše 35 sloupců'; end if;
          for rr in r .. r + rs - 1 loop
            for cc in col .. col + cs - 1 loop
              if used ? (rr || ',' || cc) then raise exception 'Buňky tabulky se překrývají'; end if;
              used := used || jsonb_build_object(rr || ',' || cc, true);
            end loop;
          end loop;
          t := coalesce(cell->>'text', '');
          if length(t) > 10000 then raise exception 'Příliš dlouhý text buňky'; end if;
          if coalesce(cell->>'align', 'left') not in ('left', 'center', 'right') then raise exception 'Neznámé zarovnání'; end if;
          newrow := newrow || jsonb_build_array(jsonb_build_object('text', t,
            'header', coalesce((cell->>'header')::boolean, false), 'align', coalesce(cell->>'align', 'left'),
            'colspan', cs, 'rowspan', rs));
          col := col + cs;
        end loop;
        maxcol := greatest(maxcol, col);
        newrows := newrows || jsonb_build_array(newrow);
      end loop;
      if maxcol = 0 then raise exception 'Prázdná tabulka'; end if;
      for rr in 0 .. rows_n - 1 loop
        for cc in 0 .. maxcol - 1 loop
          if not used ? (rr || ',' || cc) then raise exception 'Tabulka obsahuje mezeru v mřížce; upravte sloučené buňky'; end if;
        end loop;
      end loop;
      if length(coalesce(b->>'caption', '')) > 400 or length(coalesce(b->>'notes', '')) > 4000 then
        raise exception 'Příliš dlouhý nadpis nebo poznámka tabulky';
      end if;
      clean := clean || jsonb_build_array(jsonb_build_object('type', 'table', 'caption', coalesce(b->>'caption', ''),
        'rows', newrows, 'notes', coalesce(b->>'notes', '')));
      select coalesce(b->>'caption', '') || E'\n' || coalesce(string_agg(
               (select string_agg(x->>'text', ' | ') from jsonb_array_elements(rw) x), E'\n'), '')
             || E'\n' || coalesce(b->>'notes', '')
        into plain from jsonb_array_elements(newrows) rw;
      texts := texts || btrim(plain, E'\n ');
    when 'figure' then
      t := coalesce(b->>'path', '');
      if t !~ '^[A-Za-z0-9._/-]+$' or length(t) not between 3 and 300 or position('..' in t) > 0 then raise exception 'Neplatná cesta k obrázku'; end if;
      if length(coalesce(b->>'caption', '')) > 400 or length(coalesce(b->>'alt', '')) > 1000 then
        raise exception 'Příliš dlouhý popisek obrázku';
      end if;
      clean := clean || jsonb_build_array(jsonb_build_object('type', 'figure', 'path', t,
        'caption', coalesce(b->>'caption', ''), 'alt', coalesce(b->>'alt', ''),
        'page', case when b ? 'page' and jsonb_typeof(b->'page') = 'number' then b->'page' else 'null'::jsonb end));
      texts := texts || btrim(coalesce(b->>'caption', '') || E'\n' || coalesce(b->>'alt', ''), E'\n ');
    else
      raise exception 'Nepodporovaný typ bloku';
    end case;
  end loop;
  blocks := clean;
  body := btrim(array_to_string(array(select x from unnest(texts) x where btrim(x) <> ''), E'\n\n'));
  if length(body) > 450000 then raise exception 'Obsah je příliš dlouhý'; end if;
end $$;

-- Operace nad prostým textem nesmí zničit strukturované tabulky ani obrázky.
create or replace function rq_private.guard_plain_surgery(u public.units, p_confirm_flatten boolean) returns void
language plpgsql as $$
begin
  if u.content_blocks is null then return; end if;
  if exists (select 1 from jsonb_array_elements(u.content_blocks) b where b->>'type' in ('table', 'figure')) then
    raise exception 'Ustanovení % obsahuje tabulku nebo obrázek. Přesun či rozdělení přes prostý text by je zničil; upravte obsah v editoru.', u.label;
  end if;
  if not coalesce(p_confirm_flatten, false) then
    raise exception 'Text ustanovení % má formátování. Pro převod na prostý text je nutné výslovné potvrzení.', u.label;
  end if;
end $$;

-- ================================================================ dokumenty a ustanovení
create or replace function public.rq_new_document(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v_id text := coalesce(nullif(p->>'id', ''), rq_private.token('doc'));
begin
  perform rq_private.require_admin();
  if coalesce(btrim(p->>'title'), '') = '' or coalesce(btrim(p->>'family'), '') = '' then
    raise exception 'Doplňte název a zkratku dokumentu';
  end if;
  insert into public.documents(id, title, family, kind, language, version, valid_date, publisher, url,
                               group_key, jurisdiction, document_type, topics, updated_by)
  values (v_id, btrim(p->>'title'), btrim(p->>'family'), coalesce(p->>'kind', ''), p->>'language',
          coalesce(p->>'version', ''), nullif(p->>'valid_date', '')::date, coalesce(p->>'publisher', ''),
          coalesce(btrim(p->>'url'), ''), coalesce(nullif(p->>'group_key', ''), v_id),
          coalesce(p->>'jurisdiction', 'other'), coalesce(p->>'document_type', 'other'),
          coalesce(array(select jsonb_array_elements_text(p->'topics')), '{}'), auth.uid());
  return v_id;
exception when unique_violation then
  raise exception 'Dokument s identifikátorem % už existuje', v_id;
end $$;

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
    updated_at = now(), updated_by = auth.uid()
  where id = p_id;
  -- Původ, druh a tagy jsou společné pro všechny jazykové verze téhož předpisu.
  update public.documents set
    jurisdiction = coalesce(p->>'jurisdiction', jurisdiction),
    document_type = coalesce(p->>'document_type', document_type),
    topics = coalesce(v_topics, topics),
    updated_at = now(), updated_by = auth.uid()
  where group_key = d.group_key;
end $$;

create or replace function public.rq_new_unit(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v_id text := rq_private.token('unit'); v_parent text := nullif(p->>'parent_id', ''); v_order bigint;
begin
  perform rq_private.require_admin();
  if not exists (select 1 from public.documents where id = p->>'document_id') then raise exception 'Neznámý dokument'; end if;
  if v_parent is not null and not exists (select 1 from public.units where id = v_parent and document_id = p->>'document_id' and not archived) then
    raise exception 'Nadřazená část musí patřit ke stejnému dokumentu';
  end if;
  select coalesce(max(sort_order), 0) + 1 into v_order from public.units where document_id = p->>'document_id';
  insert into public.units(id, document_id, parent_id, kind, label, heading, locator, text_status, sort_order, updated_by)
  values (v_id, p->>'document_id', v_parent, p->>'kind', btrim(p->>'label'), coalesce(btrim(p->>'heading'), ''),
          coalesce(btrim(p->>'locator'), ''), 'missing', v_order, auth.uid());
  perform rq_private.log_unit(v_id, 'created', null, to_jsonb(rq_private.unit_row(v_id)), 'Nová část');
  return v_id;
end $$;

create or replace function public.rq_save_unit_text(p_unit_id text, p_body text,
  p_source_note text default 'Ručně vložený text', p_expected timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare u public.units := rq_private.unit_row(p_unit_id); v_body text := btrim(coalesce(p_body, ''));
begin
  perform rq_private.require_admin();
  perform rq_private.check_current(u, p_expected);
  if length(v_body) > 450000 then raise exception 'Text je příliš dlouhý; rozdělte jej na části'; end if;
  update public.units set body = v_body, content_blocks = null,
    text_status = case when v_body <> '' then 'needs_review' else 'missing' end,
    verified_at = null, verified_by = null, source_note = coalesce(nullif(p_source_note, ''), 'Ručně vložený text'),
    updated_at = clock_timestamp(), updated_by = auth.uid()
  where id = p_unit_id;
  perform rq_private.invalidate_approval(array[p_unit_id]);
  perform rq_private.log_unit(p_unit_id, 'edit_text', to_jsonb(u), to_jsonb(rq_private.unit_row(p_unit_id)), 'Přímá úprava textu');
end $$;

create or replace function public.rq_verify_unit(p_unit_id text, p_expected timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare u public.units := rq_private.unit_row(p_unit_id);
begin
  perform rq_private.require_admin();
  perform rq_private.check_current(u, p_expected);
  if btrim(u.body) = '' then raise exception 'Nelze ověřit prázdný text'; end if;
  update public.units set text_status = 'verified', verified_at = now(), verified_by = auth.uid(),
    updated_at = clock_timestamp(), updated_by = auth.uid()
  where id = p_unit_id;
  perform rq_private.log_unit(p_unit_id, 'verified', to_jsonb(u), to_jsonb(rq_private.unit_row(p_unit_id)), 'Ověřeno proti originálu');
end $$;

create or replace function public.rq_save_unit_content(p_unit_id text, p_blocks jsonb,
  p_expected timestamptz, p_reason text default 'Úprava obsahu a tabulek') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.units := rq_private.unit_row(p_unit_id); v record;
begin
  perform rq_private.require_admin();
  perform rq_private.check_current(u, p_expected, true);
  select * into v from rq_private.validate_blocks(p_blocks);
  if v.body = u.body and v.blocks is not distinct from u.content_blocks then return jsonb_build_object('changed', false); end if;
  update public.units set content_blocks = v.blocks where id = p_unit_id;
  perform rq_private.body_change(p_unit_id, v.body);
  perform rq_private.invalidate_approval(array[p_unit_id]);
  perform rq_private.log_unit(p_unit_id, 'edit_content', to_jsonb(u), to_jsonb(rq_private.unit_row(p_unit_id)), p_reason);
  return jsonb_build_object('changed', true);
end $$;

create or replace function public.rq_edit_unit_structure(p_unit_id text, p jsonb,
  p_expected timestamptz, p_reason text default 'Úprava struktury') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.units := rq_private.unit_row(p_unit_id);
        v_label text := coalesce(btrim(p->>'label'), u.label);
        v_heading text := coalesce(btrim(p->>'heading'), u.heading);
        v_locator text := coalesce(btrim(p->>'locator'), u.locator);
        v_kind text := coalesce(p->>'kind', u.kind);
        v_parent text := case when p ? 'parent_id' then nullif(p->>'parent_id', '') else u.parent_id end;
        v_order bigint := coalesce((p->>'sort_order')::bigint, u.sort_order);
        v_affected text[] := array[p_unit_id]; cur text; seen text[]; child record; before jsonb;
begin
  perform rq_private.require_admin();
  perform rq_private.check_current(u, p_expected, true);
  if v_parent is not null then
    if not exists (select 1 from public.units where id = v_parent and document_id = u.document_id and not archived) then
      raise exception 'Nadřazená část musí být ve stejném dokumentu';
    end if;
    cur := v_parent; seen := array[p_unit_id];
    while cur is not null loop
      if cur = any(seen) then raise exception 'Struktura by obsahovala cyklus'; end if;
      seen := seen || cur;
      select parent_id into cur from public.units where id = cur;
    end loop;
  end if;
  if (v_label, v_heading, v_locator, v_kind, v_parent, v_order) is not distinct from
     (u.label, u.heading, u.locator, u.kind, u.parent_id, u.sort_order) then
    return jsonb_build_object('changed', false);
  end if;
  update public.units set label = v_label, heading = v_heading, locator = v_locator, kind = v_kind,
    parent_id = v_parent, sort_order = v_order,
    text_status = case when btrim(body) <> '' then 'needs_review' else 'missing' end,
    verified_at = null, verified_by = null,
    source_note = 'Redakčně upravená struktura; původní zdroj: ' || left(u.source_note, 700),
    updated_at = clock_timestamp(), updated_by = auth.uid()
  where id = p_unit_id;
  -- Přesun či přejmenování nadřazené části mění výklad i jejích potomků.
  if v_parent is distinct from u.parent_id or v_label <> u.label or v_kind <> u.kind then
    for child in with recursive d as (
        select id from public.units where parent_id = p_unit_id
        union select x.id from public.units x join d on x.parent_id = d.id)
      select id from d loop
      before := to_jsonb(rq_private.unit_row(child.id));
      update public.units set text_status = case when btrim(body) <> '' then 'needs_review' else 'missing' end,
        verified_at = null, verified_by = null, updated_at = clock_timestamp(), updated_by = auth.uid()
      where id = child.id and text_status = 'verified';
      perform rq_private.log_unit(child.id, 'ancestor_structure_changed', before, to_jsonb(rq_private.unit_row(child.id)),
        'Změna nadřazené části ' || p_unit_id);
      v_affected := v_affected || child.id;
    end loop;
  end if;
  perform rq_private.invalidate_approval(v_affected);
  perform rq_private.log_unit(p_unit_id, 'edit_structure', to_jsonb(u), to_jsonb(rq_private.unit_row(p_unit_id)), p_reason);
  return jsonb_build_object('changed', true, 'affected', to_jsonb(v_affected));
end $$;

create or replace function public.rq_split_unit(p_unit_id text, p_index int, p_new_label text,
  p_new_heading text, p_new_locator text, p_expected timestamptz,
  p_confirm_flatten boolean default false, p_reason text default 'Rozdělení ustanovení') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.units := rq_private.unit_row(p_unit_id); v_left text; v_right text; v_new text := rq_private.token('unit');
begin
  perform rq_private.require_admin();
  perform rq_private.check_current(u, p_expected, true);
  perform rq_private.guard_plain_surgery(u, p_confirm_flatten);
  if p_index is null or p_index <= 0 or p_index >= length(u.body) then raise exception 'Vyberte místo rozdělení uvnitř textu'; end if;
  v_left := rtrim(left(u.body, p_index)); v_right := ltrim(substr(u.body, p_index + 1));
  if v_left = '' or v_right = '' then raise exception 'Obě části musí mít text'; end if;
  if coalesce(btrim(p_new_label), '') = '' then raise exception 'Zadejte označení nové části'; end if;
  -- Nová část hned za původní; následující sourozence posuneme, aby se pořadí neshodovalo.
  update public.units set sort_order = sort_order + 1
    where document_id = u.document_id and parent_id is not distinct from u.parent_id and sort_order > u.sort_order;
  insert into public.units(id, document_id, parent_id, kind, label, heading, body, locator, text_status, source_note, sort_order, updated_by)
  values (v_new, u.document_id, u.parent_id, u.kind, btrim(p_new_label), left(coalesce(btrim(p_new_heading), ''), 500), v_right,
          coalesce(nullif(btrim(p_new_locator), ''), u.locator), 'needs_review', 'Odděleno z ' || u.id, u.sort_order + 1, auth.uid());
  update public.units set content_blocks = null where id = p_unit_id;
  perform rq_private.body_change(p_unit_id, v_left);
  perform rq_private.invalidate_approval(array[p_unit_id]);
  perform rq_private.log_unit(p_unit_id, 'split_unit', to_jsonb(u), to_jsonb(rq_private.unit_row(p_unit_id)), p_reason);
  perform rq_private.log_unit(v_new, 'created_by_split', jsonb_build_object('source_id', u.id), to_jsonb(rq_private.unit_row(v_new)), p_reason);
  return jsonb_build_object('changed', true, 'created_unit_id', v_new);
end $$;

create or replace function public.rq_move_unit_text(p_unit_id text, p_target_id text, p_fragment text,
  p_expected timestamptz, p_target_expected timestamptz,
  p_confirm_flatten boolean default false, p_reason text default 'Přesun části textu') returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.units := rq_private.unit_row(p_unit_id); t public.units := rq_private.unit_row(p_target_id); n int;
begin
  perform rq_private.require_admin();
  perform rq_private.check_current(s, p_expected, true);
  perform rq_private.check_current(t, p_target_expected, true);
  if s.document_id <> t.document_id then raise exception 'Přesun je dovolen pouze uvnitř jednoho dokumentu'; end if;
  if s.id = t.id then raise exception 'Nelze přesunout text do stejné části'; end if;
  if coalesce(btrim(p_fragment), '') = '' or length(p_fragment) > 300000 then raise exception 'Vyberte úryvek k přesunu'; end if;
  n := (length(s.body) - length(replace(s.body, p_fragment, ''))) / length(p_fragment);
  if n <> 1 then raise exception 'Úryvek musí být ve zdroji přesně jednou; vyberte delší souvislou část'; end if;
  perform rq_private.guard_plain_surgery(s, p_confirm_flatten);
  perform rq_private.guard_plain_surgery(t, p_confirm_flatten);
  update public.units set content_blocks = null where id in (s.id, t.id);
  perform rq_private.body_change(s.id, btrim(replace(s.body, p_fragment, '')));
  perform rq_private.body_change(t.id, btrim(rtrim(t.body) || E'\n\n' || btrim(p_fragment)));
  perform rq_private.invalidate_approval(array[s.id, t.id]);
  perform rq_private.log_unit(s.id, 'move_text', to_jsonb(s), to_jsonb(rq_private.unit_row(s.id)), p_reason);
  perform rq_private.log_unit(t.id, 'move_text', to_jsonb(t), to_jsonb(rq_private.unit_row(t.id)), p_reason);
  return jsonb_build_object('changed', true, 'affected', jsonb_build_array(s.id, t.id));
end $$;

create or replace function public.rq_merge_units(p_unit_id text, p_target_id text,
  p_expected timestamptz, p_target_expected timestamptz,
  p_confirm_flatten boolean default false, p_reason text default 'Sloučení ustanovení') returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.units := rq_private.unit_row(p_unit_id); t public.units := rq_private.unit_row(p_target_id); v_body text;
begin
  perform rq_private.require_admin();
  perform rq_private.check_current(s, p_expected, true);
  perform rq_private.check_current(t, p_target_expected, true);
  if s.document_id <> t.document_id then raise exception 'Sloučení je dovoleno pouze uvnitř jednoho dokumentu'; end if;
  if s.id = t.id then raise exception 'Nelze sloučit stejnou část'; end if;
  if exists (select 1 from public.units where parent_id = s.id and not archived) then
    raise exception 'Zdroj obsahuje podřazené části. Nejprve je přesuňte.';
  end if;
  v_body := btrim(concat_ws(E'\n\n', nullif(btrim(t.body), ''), nullif(btrim(s.body), '')));
  if v_body = '' then raise exception 'Nelze sloučit dvě prázdné části'; end if;
  perform rq_private.guard_plain_surgery(s, p_confirm_flatten);
  perform rq_private.guard_plain_surgery(t, p_confirm_flatten);
  update public.units set content_blocks = null where id in (s.id, t.id);
  perform rq_private.body_change(s.id, '');
  perform rq_private.body_change(t.id, v_body);
  update public.units set archived = true, merged_into = t.id where id = s.id;
  perform rq_private.invalidate_approval(array[s.id, t.id]);
  perform rq_private.log_unit(s.id, 'merge_unit', to_jsonb(s), to_jsonb(rq_private.unit_row(s.id)), p_reason);
  perform rq_private.log_unit(t.id, 'merge_unit', to_jsonb(t), to_jsonb(rq_private.unit_row(t.id)), p_reason);
  return jsonb_build_object('changed', true, 'affected', jsonb_build_array(s.id, t.id));
end $$;

-- ================================================================ komentáře
create or replace function rq_private.comment_row(p_id text) returns public.comments
language plpgsql stable set search_path = public as $$
declare c public.comments;
begin
  select * into c from public.comments where id = p_id;
  if not found then raise exception 'Komentář neexistuje'; end if;
  return c;
end $$;

create or replace function rq_private.comment_was_approved(p_id text) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from public.comment_history where comment_id = p_id and after_json->>'status' = 'approved')
$$;

create or replace function public.rq_new_comment(p_unit_id text, p_kind text, p_language text, p_body text,
  p_author text default '') returns text
language plpgsql security definer set search_path = public as $$
declare v_id text := rq_private.token('comment'); u public.units := rq_private.unit_row(p_unit_id);
begin
  perform rq_private.require_admin();
  if u.archived then raise exception 'K archivované části nelze přidat komentář'; end if;
  insert into public.comments(id, unit_id, kind, language, body, author, created_by, updated_by)
  values (v_id, p_unit_id, p_kind, p_language, btrim(p_body), btrim(coalesce(p_author, '')), auth.uid(), auth.uid());
  perform rq_private.log_comment(v_id, 'created', null, to_jsonb(rq_private.comment_row(v_id)));
  return v_id;
end $$;

create or replace function public.rq_comment_status(p_id text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.comments := rq_private.comment_row(p_id);
begin
  perform rq_private.require_admin();
  if p_status not in ('approved', 'rejected') then raise exception 'Neplatný stav'; end if;
  if c.status <> 'draft' then raise exception 'Schválit či zamítnout lze jen nový koncept'; end if;
  update public.comments set status = p_status, updated_at = clock_timestamp(), updated_by = auth.uid() where id = p_id;
  perform rq_private.log_comment(p_id, 'status_' || p_status, to_jsonb(c), to_jsonb(rq_private.comment_row(p_id)));
end $$;

create or replace function public.rq_edit_comment_draft(p_id text, p_kind text, p_language text, p_body text,
  p_author text default '') returns void
language plpgsql security definer set search_path = public as $$
declare c public.comments := rq_private.comment_row(p_id);
begin
  perform rq_private.require_admin();
  if c.status not in ('draft', 'rejected') then raise exception 'Přímo lze upravit jen koncept či zamítnutý komentář'; end if;
  if (c.kind, c.language, c.body, c.author, c.status) = (p_kind, p_language, btrim(p_body), btrim(coalesce(p_author, '')), 'draft') then
    raise exception 'Komentář nebyl změněn';
  end if;
  update public.comments set kind = p_kind, language = p_language, body = btrim(p_body), author = btrim(coalesce(p_author, '')),
    status = 'draft', updated_at = clock_timestamp(), updated_by = auth.uid() where id = p_id;
  perform rq_private.log_comment(p_id, 'draft_edited', to_jsonb(c), to_jsonb(rq_private.comment_row(p_id)));
end $$;

create or replace function public.rq_archive_comment_draft(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.comments := rq_private.comment_row(p_id);
begin
  perform rq_private.require_admin();
  if c.status not in ('draft', 'rejected') then raise exception 'Tato akce je určena pouze pro koncepty a zamítnuté komentáře'; end if;
  update public.comments set status = 'archived', updated_at = clock_timestamp(), updated_by = auth.uid() where id = p_id;
  perform rq_private.log_comment(p_id, 'draft_archived', to_jsonb(c), to_jsonb(rq_private.comment_row(p_id)));
end $$;

create or replace function public.rq_restore_comment_draft(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.comments := rq_private.comment_row(p_id);
begin
  perform rq_private.require_admin();
  if c.status <> 'archived' or rq_private.comment_was_approved(p_id) then
    raise exception 'Schválené komentáře se obnovují pouze novým schváleným návrhem';
  end if;
  update public.comments set status = 'draft', updated_at = clock_timestamp(), updated_by = auth.uid() where id = p_id;
  perform rq_private.log_comment(p_id, 'draft_restored', to_jsonb(c), to_jsonb(rq_private.comment_row(p_id)));
end $$;

create or replace function public.rq_propose_comment_revision(p_id text, p_change_type text, p_reason text,
  p_kind text default null, p_language text default null, p_body text default null, p_author text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.comments := rq_private.comment_row(p_id); v_rev text := rq_private.token('crev');
        k text; l text; b text; a text;
begin
  perform rq_private.require_admin();
  if p_change_type not in ('edit', 'archive', 'restore') then raise exception 'Neplatný druh změny'; end if;
  if p_change_type in ('edit', 'archive') and c.status <> 'approved' then raise exception 'Upravovat nebo archivovat lze jen schválený komentář'; end if;
  if p_change_type = 'restore' and (c.status <> 'archived' or not rq_private.comment_was_approved(p_id)) then
    raise exception 'Takto lze obnovit pouze dříve schválený komentář';
  end if;
  if coalesce(btrim(p_reason), '') = '' or length(p_reason) > 3000 then raise exception 'Uveďte důvod změny do 3000 znaků'; end if;
  if p_change_type = 'edit' then
    k := coalesce(p_kind, c.kind); l := coalesce(p_language, c.language);
    b := btrim(coalesce(p_body, c.body)); a := btrim(coalesce(p_author, c.author));
    if (k, l, b, a) = (c.kind, c.language, c.body, c.author) then raise exception 'Obsah komentáře se nezměnil'; end if;
    if k not in ('explanation', 'warning', 'example', 'definition', 'reference') or l not in ('cs', 'en')
       or b = '' or length(b) > 15000 or length(a) > 200 then raise exception 'Neplatný obsah komentáře'; end if;
  else
    k := c.kind; l := c.language; b := c.body; a := c.author;
  end if;
  insert into public.comment_revisions(id, comment_id, change_type, kind, language, body, author, change_reason, base_updated_at, created_by)
  values (v_rev, p_id, p_change_type, k, l, b, a, btrim(p_reason), c.updated_at, auth.uid());
  perform rq_private.log_comment(p_id, 'revision_proposed', to_jsonb(c), to_jsonb(c));
  return v_rev;
exception when unique_violation then
  raise exception 'U komentáře už čeká návrh změny';
end $$;

create or replace function public.rq_decide_comment_revision(p_revision_id text, p_decision text) returns void
language plpgsql security definer set search_path = public as $$
declare rev public.comment_revisions; c public.comments;
begin
  perform rq_private.require_admin();
  if p_decision not in ('approved', 'rejected') then raise exception 'Neznámé rozhodnutí'; end if;
  select * into rev from public.comment_revisions where id = p_revision_id;
  if not found or rev.status <> 'proposed' then raise exception 'Návrh změny už není ke schválení'; end if;
  c := rq_private.comment_row(rev.comment_id);
  if c.status <> (case when rev.change_type = 'restore' then 'archived' else 'approved' end) or c.updated_at <> rev.base_updated_at then
    raise exception 'Komentář se mezitím změnil. Zkontrolujte aktuální znění.';
  end if;
  if p_decision = 'approved' then
    if rev.change_type = 'edit' then
      update public.comments set kind = rev.kind, language = rev.language, body = rev.body, author = rev.author,
        updated_at = clock_timestamp(), updated_by = auth.uid() where id = c.id;
    else
      update public.comments set status = case when rev.change_type = 'archive' then 'archived' else 'approved' end,
        updated_at = clock_timestamp(), updated_by = auth.uid() where id = c.id;
    end if;
    perform rq_private.log_comment(c.id, 'revision_' || rev.change_type || '_approved', to_jsonb(c), to_jsonb(rq_private.comment_row(c.id)));
  else
    perform rq_private.log_comment(c.id, 'revision_rejected', to_jsonb(c), to_jsonb(c));
  end if;
  update public.comment_revisions set status = p_decision, reviewed_at = now(), reviewed_by = auth.uid() where id = rev.id;
end $$;

-- ================================================================ vazby
create or replace function rq_private.relation_row(p_id text) returns public.relations
language plpgsql stable set search_path = public as $$
declare r public.relations;
begin
  select * into r from public.relations where id = p_id;
  if not found then raise exception 'Vazba neexistuje'; end if;
  return r;
end $$;

create or replace function rq_private.check_relation(p_source text, p_target text, p_type text, p_rationale text)
returns void language plpgsql stable set search_path = public as $$
begin
  if p_source = p_target then raise exception 'Nelze propojit ustanovení samo se sebou'; end if;
  if p_type not in ('guidance', 'references', 'related', 'supplements', 'amends') then raise exception 'Neznámý typ vazby'; end if;
  if coalesce(btrim(p_rationale), '') = '' or length(p_rationale) > 15000 then raise exception 'Doplňte přiměřené zdůvodnění vazby'; end if;
  if not exists (select 1 from public.units where id = p_source and not archived) then raise exception 'Neznámé ustanovení: %', p_source; end if;
  if not exists (select 1 from public.units where id = p_target and not archived) then raise exception 'Neznámé ustanovení: %', p_target; end if;
end $$;

create or replace function public.rq_new_relation(p_source_id text, p_target_id text, p_relation_type text,
  p_rationale text, p_evidence text default '', p_provenance text default 'manual') returns text
language plpgsql security definer set search_path = public as $$
declare v_id text := rq_private.token('relation');
begin
  perform rq_private.require_admin();
  perform rq_private.check_relation(p_source_id, p_target_id, p_relation_type, p_rationale);
  insert into public.relations(id, source_id, target_id, relation_type, rationale, evidence, provenance, created_by, updated_by)
  values (v_id, p_source_id, p_target_id, p_relation_type, btrim(p_rationale), btrim(coalesce(p_evidence, '')),
          left(coalesce(nullif(p_provenance, ''), 'manual'), 200), auth.uid(), auth.uid());
  perform rq_private.log_relation(v_id, 'created', null, to_jsonb(rq_private.relation_row(v_id)));
  return v_id;
exception when unique_violation then
  raise exception 'Tato vazba už existuje';
end $$;

create or replace function public.rq_relation_status(p_id text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.relations := rq_private.relation_row(p_id);
begin
  perform rq_private.require_admin();
  if p_status not in ('approved', 'rejected') then raise exception 'Neplatný stav'; end if;
  if r.status <> 'proposed' then raise exception 'Přímo lze rozhodovat pouze o nově navržené vazbě'; end if;
  update public.relations set status = p_status, updated_at = clock_timestamp(), updated_by = auth.uid() where id = p_id;
  perform rq_private.log_relation(p_id, 'status_' || p_status, to_jsonb(r), to_jsonb(rq_private.relation_row(p_id)));
end $$;

create or replace function public.rq_propose_relation_revision(p_relation_id text, p_change_type text, p_reason text,
  p_target_id text default null, p_relation_type text default null, p_rationale text default null,
  p_evidence text default null) returns text
language plpgsql security definer set search_path = public as $$
declare r public.relations := rq_private.relation_row(p_relation_id); v_rev text := rq_private.token('revision');
        t text; ty text; ra text; ev text;
begin
  perform rq_private.require_admin();
  if r.status <> 'approved' then raise exception 'Upravovat lze pouze schválené vazby'; end if;
  if p_change_type not in ('edit', 'archive') then raise exception 'Neplatný druh změny'; end if;
  if coalesce(btrim(p_reason), '') = '' or length(p_reason) > 3000 then raise exception 'Uveďte důvod změny'; end if;
  if p_change_type = 'edit' then
    t := coalesce(p_target_id, r.target_id); ty := coalesce(p_relation_type, r.relation_type);
    ra := btrim(coalesce(p_rationale, r.rationale)); ev := btrim(coalesce(p_evidence, r.evidence));
    if (t, ty, ra, ev) = (r.target_id, r.relation_type, r.rationale, r.evidence) then raise exception 'Ve vazbě nejsou žádné změny'; end if;
  else
    t := r.target_id; ty := r.relation_type; ra := r.rationale; ev := r.evidence;
  end if;
  perform rq_private.check_relation(r.source_id, t, ty, ra);
  if length(ev) > 15000 then raise exception 'Doklad je příliš dlouhý'; end if;
  insert into public.relation_revisions(id, relation_id, change_type, source_id, target_id, relation_type, rationale, evidence,
    change_reason, base_updated_at, created_by)
  values (v_rev, r.id, p_change_type, r.source_id, t, ty, ra, ev, btrim(p_reason), r.updated_at, auth.uid());
  return v_rev;
exception when unique_violation then
  raise exception 'U této vazby už čeká na kontrolu návrh změny';
end $$;

create or replace function public.rq_decide_relation_revision(p_revision_id text, p_decision text) returns void
language plpgsql security definer set search_path = public as $$
declare rev public.relation_revisions; r public.relations;
begin
  perform rq_private.require_admin();
  if p_decision not in ('approved', 'rejected') then raise exception 'Neznámé rozhodnutí'; end if;
  select * into rev from public.relation_revisions where id = p_revision_id;
  if not found or rev.status <> 'proposed' then raise exception 'Návrh změny již není ke schválení'; end if;
  r := rq_private.relation_row(rev.relation_id);
  if r.status <> 'approved' or r.updated_at <> rev.base_updated_at then
    raise exception 'Schválená vazba se mezitím změnila. Zkontrolujte její aktuální znění.';
  end if;
  if p_decision = 'approved' then
    if rev.change_type = 'archive' then
      update public.relations set status = 'archived', updated_at = clock_timestamp(), updated_by = auth.uid() where id = r.id;
    else
      perform rq_private.check_relation(rev.source_id, rev.target_id, rev.relation_type, rev.rationale);
      update public.relations set target_id = rev.target_id, relation_type = rev.relation_type, rationale = rev.rationale,
        evidence = rev.evidence, updated_at = clock_timestamp(), updated_by = auth.uid() where id = r.id;
    end if;
    perform rq_private.log_relation(r.id, 'revision_' || rev.change_type || '_approved', to_jsonb(r), to_jsonb(rq_private.relation_row(r.id)));
  else
    perform rq_private.log_relation(r.id, 'revision_rejected', to_jsonb(rev), to_jsonb(r));
  end if;
  update public.relation_revisions set status = p_decision, reviewed_at = now(), reviewed_by = auth.uid() where id = rev.id;
end $$;

-- Hromadné návrhy z automatické analýzy: vždy jen jako návrhy ke schválení.
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
    insert into public.relations(id, source_id, target_id, relation_type, rationale, evidence, provenance, created_by, updated_by)
    values (v_id, l->>'source_id', l->>'target_id', ty, btrim(l->>'rationale'), btrim(coalesce(l->>'evidence', '')),
            left(coalesce(l->>'provenance', 'automatic-batch'), 200) || '; pending-editor-review', auth.uid(), auth.uid());
    perform rq_private.log_relation(v_id, 'created_batch_candidate', null, to_jsonb(rq_private.relation_row(v_id)));
    created := created + 1;
  end loop;
  return jsonb_build_object('created', created, 'skipped', skipped);
end $$;

-- ================================================================ import
-- p_units: pole ustanovení v pořadí dokumentu (rodič před potomkem):
--   {id, parent_id, kind, label, heading, body, locator, source_note, sort_order}
-- p_meta: {filename, sha256, format, warnings[], amendments{marker:{title,kind,url}},
--          unit_amendments{unit_id:[marker]}, storage_path, mime}
-- Ověřené, ručně upravené ani archivované texty se nikdy nepřepíší.
create or replace function public.rq_import_units(p_document_id text, p_units jsonb, p_meta jsonb,
  p_replace boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb; old public.units; v_added int := 0; v_updated int := 0; v_replaced int := 0; v_protected int := 0;
        applied text[] := '{}'; edited boolean; m record; mk text;
begin
  perform rq_private.require_admin();
  if not exists (select 1 from public.documents where id = p_document_id) then raise exception 'Neznámý dokument'; end if;
  if jsonb_typeof(p_units) <> 'array' or jsonb_array_length(p_units) not between 1 and 5000 then
    raise exception 'Import musí obsahovat 1–5000 částí';
  end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_units) x) <> jsonb_array_length(p_units) then
    raise exception 'Duplicitní identifikátory v importu. Nic nebylo uloženo.';
  end if;
  for d in select * from jsonb_array_elements(p_units) loop
    select * into old from public.units where id = d->>'id';
    if not found then
      insert into public.units(id, document_id, kind, label, heading, body, locator, text_status, source_note, sort_order, updated_by)
      values (d->>'id', p_document_id, d->>'kind', d->>'label', coalesce(d->>'heading', ''), btrim(coalesce(d->>'body', '')),
              coalesce(d->>'locator', ''), case when btrim(coalesce(d->>'body', '')) <> '' then 'needs_review' else 'missing' end,
              coalesce(d->>'source_note', ''), coalesce((d->>'sort_order')::bigint, 0), auth.uid());
      v_added := v_added + 1; applied := applied || (d->>'id');
      continue;
    end if;
    if old.document_id <> p_document_id then raise exception 'Identifikátor % patří jinému dokumentu', old.id; end if;
    edited := exists (select 1 from public.unit_edit_history where unit_id = old.id and event <> 'verified');
    if old.archived or edited or old.text_status = 'verified' then
      v_protected := v_protected + 1;
    elsif btrim(old.body) = '' or (p_replace and old.text_status = 'needs_review'
                                   and position('automatický import' in lower(old.source_note)) > 0) then
      update public.units set kind = d->>'kind', label = d->>'label', heading = coalesce(d->>'heading', ''),
        body = btrim(coalesce(d->>'body', '')), content_blocks = null, locator = coalesce(d->>'locator', ''),
        text_status = case when btrim(coalesce(d->>'body', '')) <> '' then 'needs_review' else 'missing' end,
        verified_at = null, verified_by = null, source_note = coalesce(d->>'source_note', ''),
        sort_order = coalesce((d->>'sort_order')::bigint, sort_order), updated_at = clock_timestamp(), updated_by = auth.uid()
      where id = old.id;
      if btrim(old.body) = '' then v_updated := v_updated + 1;
      else v_replaced := v_replaced + 1; perform rq_private.invalidate_approval(array[old.id]); end if;
      applied := applied || old.id;
    else
      update public.units set sort_order = coalesce((d->>'sort_order')::bigint, sort_order) where id = old.id;
      v_protected := v_protected + 1;
    end if;
  end loop;
  -- Rodiče až po vložení všech částí (rodič musí být ve stejném dokumentu).
  update public.units u set parent_id = x->>'parent_id'
    from jsonb_array_elements(p_units) x
    where u.id = x->>'id' and u.id = any(applied) and nullif(x->>'parent_id', '') is not null
      and exists (select 1 from public.units p where p.id = x->>'parent_id' and p.document_id = p_document_id and p.id <> u.id);
  for mk, d in select * from jsonb_each(coalesce(p_meta->'amendments', '{}')) loop
    insert into public.amendments(document_id, marker, title, kind, url)
    values (p_document_id, mk, coalesce(d->>'title', ''), coalesce(d->>'kind', ''), coalesce(d->>'url', ''))
    on conflict (document_id, marker) do update set title = excluded.title, kind = excluded.kind, url = excluded.url;
  end loop;
  delete from public.unit_amendments where unit_id = any(applied);
  insert into public.unit_amendments(unit_id, marker)
    select k, jsonb_array_elements_text(v) from jsonb_each(coalesce(p_meta->'unit_amendments', '{}')) e(k, v)
    where k = any(applied) on conflict do nothing;
  if coalesce(p_meta->>'storage_path', '') <> '' then
    insert into public.source_files(document_id, storage_path, sha256, filename, mime, uploaded_by)
    values (p_document_id, p_meta->>'storage_path', p_meta->>'sha256', p_meta->>'filename', coalesce(p_meta->>'mime', ''), auth.uid())
    on conflict (document_id) do update set storage_path = excluded.storage_path, sha256 = excluded.sha256,
      filename = excluded.filename, mime = excluded.mime, uploaded_at = now(), uploaded_by = excluded.uploaded_by;
  end if;
  insert into public.import_log(document_id, filename, sha256, format, added, updated, replaced, protected, warnings, actor)
  values (p_document_id, coalesce(p_meta->>'filename', ''), coalesce(p_meta->>'sha256', ''), coalesce(p_meta->>'format', ''),
          v_added, v_updated, v_replaced, v_protected, coalesce(p_meta->'warnings', '[]'), auth.uid());
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'replaced', v_replaced, 'protected', v_protected);
end $$;

-- ================================================================ data pro čtečku a publikování
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
        'relation_type', relation_type, 'rationale', rationale, 'status', status) order by id) from rel), '[]'),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'unit_id', unit_id, 'kind', kind, 'language', language,
        'body', body, 'author', author, 'status', status, 'updated_at', updated_at) order by id) from com), '[]'),
    'counts', jsonb_build_object('documents', (select count(*) from docs), 'units', (select count(*) from u),
        'verified_units', (select count(*) from good), 'navigation_units', (select count(*) from u where nav),
        'relations', (select count(*) from rel), 'comments', (select count(*) from com)))
$$;

create or replace function public.rq_draft_preview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  return rq_private.reader_data(true);
end $$;

create or replace function public.rq_publish(p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_data jsonb := rq_private.reader_data(false); v_id bigint;
begin
  perform rq_private.require_admin();
  update public.publications set is_current = false where is_current;
  insert into public.publications(created_by, note, counts, data, is_current)
  values (auth.uid(), left(coalesce(p_note, ''), 500), v_data->'counts', v_data, true) returning id into v_id;
  return jsonb_build_object('id', v_id, 'counts', v_data->'counts');
end $$;

create or replace function public.rq_set_current_publication(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  if not exists (select 1 from public.publications where id = p_id) then raise exception 'Publikace neexistuje'; end if;
  update public.publications set is_current = false where is_current;
  update public.publications set is_current = true where id = p_id;
end $$;

-- Jediný způsob, jak student získá obsah: aktuální publikovaná verze.
create or replace function public.rq_current_publication() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.rq_is_member() then
    raise exception 'Přístup není aktivní. Obraťte se na vyučujícího.' using errcode = '42501';
  end if;
  select data || jsonb_build_object('publication_id', id, 'published_at', created_at) into v
    from public.publications where is_current;
  return v;
end $$;

-- ================================================================ stav Studia a zálohy
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

create or replace function public.rq_edit_history_item(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform rq_private.require_admin();
  select to_jsonb(h) into v from public.unit_edit_history h where id = p_id;
  if v is null then raise exception 'Záznam nebyl nalezen'; end if;
  return v;
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
    'student_groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.student_groups x));
end $$;

-- ================================================================ skupiny a účty
-- Zakládání účtů (Auth) obstarává serverová funkce s administrátorským klíčem;
-- zde jen skupiny a aktivace/deaktivace.
create or replace function public.rq_new_group(p_name text, p_note text default '', p_valid_until date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform rq_private.require_admin();
  insert into public.student_groups(name, note, valid_until, created_by)
  values (btrim(p_name), coalesce(p_note, ''), p_valid_until, auth.uid()) returning id into v;
  return v;
exception when unique_violation then
  raise exception 'Skupina s tímto názvem už existuje';
end $$;

create or replace function public.rq_update_group(p_id uuid, p_name text, p_note text, p_valid_until date, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  update public.student_groups set name = coalesce(nullif(btrim(p_name), ''), name), note = coalesce(p_note, note),
    valid_until = p_valid_until, active = coalesce(p_active, active) where id = p_id;
  if not found then raise exception 'Skupina neexistuje'; end if;
end $$;

create or replace function public.rq_set_profile_active(p_user_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  perform rq_private.require_admin();
  select role into v_role from public.profiles where user_id = p_user_id;
  if v_role is null then raise exception 'Účet neexistuje'; end if;
  if v_role <> 'student' then perform rq_private.require_owner(); end if;
  if p_user_id = auth.uid() and not p_active then raise exception 'Nelze deaktivovat vlastní účet'; end if;
  update public.profiles set active = p_active where user_id = p_user_id;
end $$;

-- ================================================================ oprávnění
revoke all on all functions in schema rq_private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Serverová funkce pro zakládání účtů pracuje s administrátorským klíčem (service_role).
grant select, insert, update on public.profiles, public.student_groups to service_role;
