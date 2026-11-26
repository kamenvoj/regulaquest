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

revoke all on function public.rq_archive_unit(text, timestamptz, text) from public, anon;
revoke all on function public.rq_restore_unit(text, text) from public, anon;
grant execute on function public.rq_archive_unit(text, timestamptz, text) to authenticated;
grant execute on function public.rq_restore_unit(text, text) to authenticated;
