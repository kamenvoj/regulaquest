-- RegulaQuest · 06 · Import v prohlížeči a aktualizace na nové znění
-- Prohlížeč posílá části po dávkách (p_meta.chunk = true), na závěr volá rq_import_finish.
-- Režim p_meta.mode:
--   'new'    – první import: ověřené, ručně upravené a archivované části se nepřepisují (jako dosud);
--   'update' – nové znění předpisu: shodný text zůstává (i ověření), změněný se přepíše, vrátí do stavu
--              „Nutno ověřit“, jeho schválené vazby a komentáře jdou do kontroly a původní znění se uloží do historie.
-- Lze spustit opakovaně.

-- Oprava kontroly cesty k obrázku (PostgreSQL nedovolí opakování {3,300}).
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

create or replace function rq_private.same_text(a text, b text) returns boolean
language sql immutable as $$
  -- shoda včetně odsazení a zalomení; ignorují se jen mezery na konci řádků a na okrajích
  select btrim(regexp_replace(replace(coalesce(a, ''), E'\r', ''), '[ \t]+(\n|$)', '\1', 'g'), E' \t\n')
       = btrim(regexp_replace(replace(coalesce(b, ''), E'\r', ''), '[ \t]+(\n|$)', '\1', 'g'), E' \t\n')
$$;

create or replace function public.rq_import_units(p_document_id text, p_units jsonb, p_meta jsonb,
  p_replace boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb; old public.units; v_added int := 0; v_updated int := 0; v_replaced int := 0; v_protected int := 0;
        v_same int := 0; v_changed int := 0; changed_ids text[] := '{}';
        applied text[] := '{}'; marked text[] := '{}'; edited boolean; mk text;
        v_mode text := coalesce(p_meta->>'mode', 'new');
        v_body text; v_status text; before jsonb; v_blocks jsonb; vb record;
begin
  perform rq_private.require_admin();
  if v_mode not in ('new', 'update') then raise exception 'Neznámý režim importu'; end if;
  if not exists (select 1 from public.documents where id = p_document_id) then raise exception 'Neznámý dokument'; end if;
  if jsonb_typeof(p_units) <> 'array' or jsonb_array_length(p_units) not between 1 and 5000 then
    raise exception 'Import musí obsahovat 1–5000 částí';
  end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_units) x) <> jsonb_array_length(p_units) then
    raise exception 'Duplicitní identifikátory v importu. Nic nebylo uloženo.';
  end if;
  for d in select * from jsonb_array_elements(p_units) loop
    -- obsah z PDF přichází jako bloky (text, tabulka, obrázek); prostý text se z nich odvodí
    if jsonb_typeof(d->'content_blocks') = 'array' and jsonb_array_length(d->'content_blocks') > 0 then
      select * into vb from rq_private.validate_blocks(d->'content_blocks');
      v_blocks := vb.blocks; v_body := btrim(vb.body);
    else
      v_blocks := null; v_body := btrim(coalesce(d->>'body', ''));
    end if;
    v_status := case when v_body <> '' then 'needs_review' else 'missing' end;
    select * into old from public.units where id = d->>'id';
    if not found then
      insert into public.units(id, document_id, kind, label, heading, body, content_blocks, locator, text_status, source_note, sort_order, updated_by)
      values (d->>'id', p_document_id, d->>'kind', d->>'label', coalesce(d->>'heading', ''), v_body, v_blocks,
              coalesce(d->>'locator', ''), v_status, coalesce(d->>'source_note', ''), coalesce((d->>'sort_order')::bigint, 0), auth.uid());
      v_added := v_added + 1; applied := applied || (d->>'id');
      continue;
    end if;
    if old.document_id <> p_document_id then raise exception 'Identifikátor % patří jinému dokumentu', old.id; end if;

    if v_mode = 'update' then
      if old.archived then
        v_protected := v_protected + 1;
      elsif rq_private.same_text(old.body, v_body) and rq_private.same_text(old.heading, d->>'heading')
            and old.content_blocks is not distinct from v_blocks then
        update public.units set sort_order = coalesce((d->>'sort_order')::bigint, sort_order),
          locator = coalesce(d->>'locator', locator) where id = old.id;
        v_same := v_same + 1; marked := marked || old.id;
      else
        before := to_jsonb(old);
        update public.units set kind = d->>'kind', label = d->>'label', heading = coalesce(d->>'heading', ''),
          body = v_body, content_blocks = v_blocks, locator = coalesce(d->>'locator', ''), text_status = v_status,
          verified_at = null, verified_by = null, source_note = coalesce(d->>'source_note', ''),
          sort_order = coalesce((d->>'sort_order')::bigint, sort_order), updated_at = clock_timestamp(), updated_by = auth.uid()
        where id = old.id;
        perform rq_private.log_unit(old.id, 'new_version', before, to_jsonb(rq_private.unit_row(old.id)),
                                    coalesce(p_meta->>'reason', 'Nové znění předpisu'));
        v_changed := v_changed + 1; changed_ids := changed_ids || old.id; applied := applied || old.id;
      end if;
      continue;
    end if;

    edited := exists (select 1 from public.unit_edit_history where unit_id = old.id and event <> 'verified');
    if old.archived or edited or old.text_status = 'verified' then
      v_protected := v_protected + 1;
    elsif btrim(old.body) = '' or (p_replace and old.text_status = 'needs_review'
                                   and position('automatický import' in lower(old.source_note)) > 0) then
      update public.units set kind = d->>'kind', label = d->>'label', heading = coalesce(d->>'heading', ''),
        body = v_body, content_blocks = v_blocks, locator = coalesce(d->>'locator', ''), text_status = v_status,
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
  perform rq_private.invalidate_approval(changed_ids);
  -- Rodiče až po vložení všech částí (rodič musí být ve stejném dokumentu; u dávek už v databázi).
  update public.units u set parent_id = x->>'parent_id'
    from jsonb_array_elements(p_units) x
    where u.id = x->>'id' and u.id = any(applied) and nullif(x->>'parent_id', '') is not null
      and exists (select 1 from public.units p where p.id = x->>'parent_id' and p.document_id = p_document_id and p.id <> u.id);
  marked := marked || applied;
  delete from public.unit_amendments where unit_id = any(marked);
  insert into public.unit_amendments(unit_id, marker)
    select k, jsonb_array_elements_text(v) from jsonb_each(coalesce(p_meta->'unit_amendments', '{}')) e(k, v)
    where k = any(marked) on conflict do nothing;
  if not coalesce((p_meta->>'chunk')::boolean, false) then
    perform rq_private.import_meta(p_document_id, p_meta);
    insert into public.import_log(document_id, filename, sha256, format, added, updated, replaced, protected, warnings, actor)
    values (p_document_id, coalesce(p_meta->>'filename', ''), coalesce(p_meta->>'sha256', ''), coalesce(p_meta->>'format', ''),
            v_added, v_updated, v_replaced + v_changed, v_protected, coalesce(p_meta->'warnings', '[]'), auth.uid());
  end if;
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'replaced', v_replaced, 'protected', v_protected,
                            'same', v_same, 'changed', v_changed);
end $$;

-- Seznam změn a uložený originál (společné pro jednorázový import i závěr dávkového importu).
create or replace function rq_private.import_meta(p_document_id text, p_meta jsonb) returns void
language plpgsql set search_path = public as $$
declare mk text; d jsonb;
begin
  for mk, d in select * from jsonb_each(coalesce(p_meta->'amendments', '{}')) loop
    insert into public.amendments(document_id, marker, title, kind, url)
    values (p_document_id, mk, coalesce(d->>'title', ''), coalesce(d->>'kind', ''), coalesce(d->>'url', ''))
    on conflict (document_id, marker) do update set title = excluded.title, kind = excluded.kind, url = excluded.url;
  end loop;
  if coalesce(p_meta->>'storage_path', '') <> '' then
    insert into public.source_files(document_id, storage_path, sha256, filename, mime, uploaded_by)
    values (p_document_id, p_meta->>'storage_path', p_meta->>'sha256', p_meta->>'filename', coalesce(p_meta->>'mime', ''), auth.uid())
    on conflict (document_id) do update set storage_path = excluded.storage_path, sha256 = excluded.sha256,
      filename = excluded.filename, mime = excluded.mime, uploaded_at = now(), uploaded_by = excluded.uploaded_by;
  end if;
end $$;

-- Závěr dávkového importu: v režimu 'update' archivuje části, které v novém znění nejsou,
-- uloží seznam změn, odkaz na originál a záznam do protokolu importů.
create or replace function public.rq_import_finish(p_document_id text, p_ids jsonb, p_meta jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.units; v_removed int := 0; removed text[] := '{}'; c jsonb := coalesce(p_meta->'counts', '{}');
begin
  perform rq_private.require_admin();
  if not exists (select 1 from public.documents where id = p_document_id) then raise exception 'Neznámý dokument'; end if;
  if coalesce(p_meta->>'mode', 'new') = 'update' then
    if jsonb_typeof(p_ids) <> 'array' or jsonb_array_length(p_ids) = 0 then raise exception 'Prázdný seznam částí nového znění'; end if;
    -- Archivují se jen části vzniklé importem (označení -art-, -annex-, -rule-, -sec-, -front), nikdy ručně založené.
    for r in select * from public.units where document_id = p_document_id and not archived
               and not (p_ids ? id) and left(id, length(p_document_id) + 1) = p_document_id || '-'
               and substr(id, length(p_document_id) + 2) ~ '^((art|annex|rule|sec)-|front$)' loop
      update public.units set archived = true, updated_at = clock_timestamp(), updated_by = auth.uid() where id = r.id;
      perform rq_private.log_unit(r.id, 'removed_in_new_version', to_jsonb(r), to_jsonb(rq_private.unit_row(r.id)),
                                  coalesce(p_meta->>'reason', 'Nové znění předpisu'));
      v_removed := v_removed + 1; removed := removed || r.id;
    end loop;
    perform rq_private.invalidate_approval(removed);
  end if;
  perform rq_private.import_meta(p_document_id, p_meta);
  insert into public.import_log(document_id, filename, sha256, format, added, updated, replaced, protected, warnings, actor)
  values (p_document_id, coalesce(p_meta->>'filename', ''), coalesce(p_meta->>'sha256', ''), coalesce(p_meta->>'format', ''),
          coalesce((c->>'added')::int, 0), coalesce((c->>'updated')::int, 0),
          coalesce((c->>'replaced')::int, 0) + coalesce((c->>'changed')::int, 0),
          coalesce((c->>'protected')::int, 0) + coalesce((c->>'same')::int, 0),
          coalesce(p_meta->'warnings', '[]') || case when coalesce(p_meta->>'mode', 'new') = 'update'
            then jsonb_build_array('Archivováno (není v novém znění): ' || v_removed) else '[]'::jsonb end, auth.uid());
  return jsonb_build_object('removed', v_removed);
end $$;

revoke all on function public.rq_import_finish(text, jsonb, jsonb) from public, anon;
grant execute on function public.rq_import_finish(text, jsonb, jsonb) to authenticated;
revoke all on function rq_private.import_meta(text, jsonb) from public, anon, authenticated;
revoke all on function rq_private.same_text(text, text) from public, anon, authenticated;
