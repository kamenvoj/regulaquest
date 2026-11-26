-- RegulaQuest · 07 · Archivace a obnovení části dokumentu
-- Části se nemažou: archivovaná část zmizí z osnovy i ze čtečky, zůstane v databázi s historií a lze ji obnovit.
-- Schválené vazby a komentáře archivované části se vrátí do kontroly. Lze spustit opakovaně.

create or replace function public.rq_archive_unit(p_unit_id text, p_expected timestamptz, p_reason text default 'Archivace části')
returns void language plpgsql security definer set search_path = public as $$
declare u public.units := rq_private.unit_row(p_unit_id);
begin
  perform rq_private.require_admin();
  perform rq_private.check_current(u, p_expected, true);
  if exists (select 1 from public.units where parent_id = u.id and not archived) then
    raise exception 'Část má podřazené části. Nejprve archivujte nebo přesuňte je.';
  end if;
  update public.units set archived = true, updated_at = clock_timestamp(), updated_by = auth.uid() where id = u.id;
  perform rq_private.invalidate_approval(array[u.id]);
  perform rq_private.log_unit(u.id, 'archived', to_jsonb(u), to_jsonb(rq_private.unit_row(u.id)), coalesce(nullif(btrim(p_reason), ''), 'Archivace části'));
end $$;

create or replace function public.rq_restore_unit(p_unit_id text, p_reason text default 'Obnovení části')
returns void language plpgsql security definer set search_path = public as $$
declare u public.units := rq_private.unit_row(p_unit_id);
begin
  perform rq_private.require_admin();
  if not u.archived then raise exception 'Část není archivovaná'; end if;
  if u.parent_id is not null and exists (select 1 from public.units where id = u.parent_id and archived) then
    raise exception 'Nadřazená část je archivovaná. Nejprve obnovte ji.';
  end if;
  update public.units set archived = false, text_status = case when btrim(body) <> '' then 'needs_review' else 'missing' end,
    verified_at = null, verified_by = null, updated_at = clock_timestamp(), updated_by = auth.uid() where id = u.id;
  perform rq_private.log_unit(u.id, 'restored', to_jsonb(u), to_jsonb(rq_private.unit_row(u.id)), coalesce(nullif(btrim(p_reason), ''), 'Obnovení části'));
end $$;

-- Komentář ani vazbu u archivované části nelze schválit.
create or replace function public.rq_comment_status(p_id text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.comments := rq_private.comment_row(p_id);
begin
  perform rq_private.require_admin();
  if p_status not in ('approved', 'rejected') then raise exception 'Neplatný stav'; end if;
  if c.status <> 'draft' then raise exception 'Schválit či zamítnout lze jen nový koncept'; end if;
  if p_status = 'approved' and exists (select 1 from public.units where id = c.unit_id and archived) then
    raise exception 'Komentář patří k archivované části; schválit ho nelze (zamítněte nebo archivujte).';
  end if;
  update public.comments set status = p_status, updated_at = clock_timestamp(), updated_by = auth.uid() where id = p_id;
  perform rq_private.log_comment(p_id, 'status_' || p_status, to_jsonb(c), to_jsonb(rq_private.comment_row(p_id)));
end $$;

create or replace function public.rq_relation_status(p_id text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.relations := rq_private.relation_row(p_id);
begin
  perform rq_private.require_admin();
  if p_status not in ('approved', 'rejected') then raise exception 'Neplatný stav'; end if;
  if r.status <> 'proposed' then raise exception 'Přímo lze rozhodovat pouze o nově navržené vazbě'; end if;
  if p_status = 'approved' and exists (select 1 from public.units where id in (r.source_id, r.target_id) and archived) then
    raise exception 'Vazba vede k archivované části; schválit ji nelze (zamítněte ji).';
  end if;
  update public.relations set status = p_status, updated_at = clock_timestamp(), updated_by = auth.uid() where id = p_id;
  perform rq_private.log_relation(p_id, 'status_' || p_status, to_jsonb(r), to_jsonb(rq_private.relation_row(p_id)));
end $$;

revoke all on function public.rq_archive_unit(text, timestamptz, text) from public, anon;
revoke all on function public.rq_restore_unit(text, text) from public, anon;
grant execute on function public.rq_archive_unit(text, timestamptz, text) to authenticated;
grant execute on function public.rq_restore_unit(text, text) to authenticated;
