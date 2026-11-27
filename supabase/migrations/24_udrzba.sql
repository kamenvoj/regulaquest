-- RegulaQuest · 24 · Údržba návazností
-- Smazání dokumentu uklidí i odkazy, které na jeho ustanovení vedou z výukových částí (kroky a vazby řešených případů,
-- ruční vazby prezentací, aktuality); když ve skupině jazykových verzí nezůstane žádný dokument, zruší se i zařazení
-- skupiny do oblastí. Zpřístupnění prezentací se počítá podle českého data (ne UTC). Lze spustit opakovaně.

create or replace function rq_private.drop_unit_refs(p_ids text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  if to_regclass('public.case_steps') is not null then
    update public.case_steps set unit_id = null where unit_id = any(p_ids) and (title <> '' or body <> '');
    delete from public.case_steps where unit_id = any(p_ids);
    delete from public.case_links where unit_id = any(p_ids);
  end if;
  if to_regclass('public.presentation_unit_links') is not null then
    delete from public.presentation_unit_links where unit_id = any(p_ids);
  end if;
  if to_regclass('public.news_items') is not null then
    update public.news_items set unit_ids = coalesce((select array_agg(x) from unnest(unit_ids) x where not x = any(p_ids)), '{}') where unit_ids && p_ids;
  end if;
end $$;

create or replace function rq_private.drop_empty_group(p_group text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.documents where coalesce(group_key, id) = p_group) then return; end if;
  delete from public.document_areas where group_key = p_group;
  if to_regclass('public.news_items') is not null then
    update public.news_items set group_keys = array_remove(group_keys, p_group) where p_group = any(group_keys);
  end if;
end $$;

-- Datum zpřístupnění prezentací podle českého času
create or replace function rq_private.today_cz() returns date language sql stable as $$ select (now() at time zone 'Europe/Prague')::date $$;
alter table public.presentation_groups alter column visible_from set default (now() at time zone 'Europe/Prague')::date;
create or replace function rq_private.can_see_presentation(p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.rq_is_admin() or (public.rq_is_member() and exists (
    select 1 from public.presentations pr
      join public.presentation_groups g on g.presentation_id = pr.id
      join public.profiles p on p.group_id = g.group_id
     where pr.id = p_id and pr.status = 'ready' and p.user_id = auth.uid() and g.visible_from <= rq_private.today_cz()))
$$;
create or replace function public.rq_set_presentation_group(p_presentation_id text, p_group_id uuid, p_visible_from date default null, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  if p_on then
    insert into public.presentation_groups(presentation_id, group_id, visible_from) values (p_presentation_id, p_group_id, coalesce(p_visible_from, rq_private.today_cz()))
    on conflict (presentation_id, group_id) do update set visible_from = excluded.visible_from;
  else
    delete from public.presentation_groups where presentation_id = p_presentation_id and group_id = p_group_id;
  end if;
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
  -- odkazy z výukových částí na mazaná ustanovení (bez cizích klíčů) – uklidit, ať nezůstávají viset
  perform rq_private.drop_unit_refs(array(select id from _rq_del_units));
  delete from public.units where document_id = p_id;
  delete from public.amendments where document_id = p_id;
  delete from public.source_files where document_id = p_id;
  delete from public.import_log where document_id = p_id;
  delete from public.documents where id = p_id;
  perform rq_private.drop_empty_group(coalesce(d.group_key, p_id));
  return jsonb_build_object('document', p_id, 'units', n_units);
end $$;

revoke all on function rq_private.drop_unit_refs(text[]), rq_private.drop_empty_group(text) from public, anon, authenticated;
