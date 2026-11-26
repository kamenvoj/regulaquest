-- RegulaQuest · 06 · Import v prohlížeči a aktualizace na nové znění
-- Prohlížeč posílá části po dávkách (p_meta.chunk = true), na závěr volá rq_import_finish.
-- Režim p_meta.mode:
--   'new'    – první import: ověřené, ručně upravené a archivované části se nepřepisují (jako dosud);
--   'update' – nové znění předpisu: shodný text zůstává (i ověření), změněný se přepíše, vrátí do stavu
--              „Nutno ověřit“, jeho schválené vazby a komentáře jdou do kontroly a původní znění se uloží do historie.
-- Lze spustit opakovaně.

create or replace function rq_private.same_text(a text, b text) returns boolean
language sql immutable as $$
  select regexp_replace(btrim(coalesce(a, '')), '\s+', ' ', 'g') = regexp_replace(btrim(coalesce(b, '')), '\s+', ' ', 'g')
$$;

create or replace function public.rq_import_units(p_document_id text, p_units jsonb, p_meta jsonb,
  p_replace boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb; old public.units; v_added int := 0; v_updated int := 0; v_replaced int := 0; v_protected int := 0;
        v_same int := 0; v_changed int := 0; changed_ids text[] := '{}';
        applied text[] := '{}'; marked text[] := '{}'; edited boolean; mk text;
        v_mode text := coalesce(p_meta->>'mode', 'new');
        v_body text; v_status text; before jsonb;
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
    v_body := btrim(coalesce(d->>'body', ''));
    v_status := case when v_body <> '' then 'needs_review' else 'missing' end;
    select * into old from public.units where id = d->>'id';
    if not found then
      insert into public.units(id, document_id, kind, label, heading, body, locator, text_status, source_note, sort_order, updated_by)
      values (d->>'id', p_document_id, d->>'kind', d->>'label', coalesce(d->>'heading', ''), v_body,
              coalesce(d->>'locator', ''), v_status, coalesce(d->>'source_note', ''), coalesce((d->>'sort_order')::bigint, 0), auth.uid());
      v_added := v_added + 1; applied := applied || (d->>'id');
      continue;
    end if;
    if old.document_id <> p_document_id then raise exception 'Identifikátor % patří jinému dokumentu', old.id; end if;

    if v_mode = 'update' then
      if old.archived then
        v_protected := v_protected + 1;
      elsif rq_private.same_text(old.body, v_body) and rq_private.same_text(old.heading, d->>'heading') then
        update public.units set sort_order = coalesce((d->>'sort_order')::bigint, sort_order),
          locator = coalesce(d->>'locator', locator) where id = old.id;
        v_same := v_same + 1; marked := marked || old.id;
      else
        before := to_jsonb(old);
        update public.units set kind = d->>'kind', label = d->>'label', heading = coalesce(d->>'heading', ''),
          body = v_body, content_blocks = null, locator = coalesce(d->>'locator', ''), text_status = v_status,
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
        body = v_body, content_blocks = null, locator = coalesce(d->>'locator', ''), text_status = v_status,
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
    -- Archivují se jen části vzniklé importem (označení -art-, -annex-, -rule-), nikdy ručně založené.
    for r in select * from public.units where document_id = p_document_id and not archived
               and not (p_ids ? id) and left(id, length(p_document_id) + 1) = p_document_id || '-'
               and substr(id, length(p_document_id) + 2) ~ '^(art|annex|rule)-' loop
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
