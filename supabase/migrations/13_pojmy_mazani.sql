-- RegulaQuest · 13 · Smazání pojmů (jen koncepty a vyřazené; schválené je nutné nejdřív vyřadit). Lze spustit opakovaně.
create or replace function public.rq_delete_terms(p_ids jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform rq_private.require_admin();
  if exists (select 1 from public.terms where id in (select jsonb_array_elements_text(p_ids)) and status = 'approved') then
    raise exception 'Schválené pojmy nejdřív vyřaďte, teprve pak je lze smazat.';
  end if;
  delete from public.terms where id in (select jsonb_array_elements_text(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.rq_delete_terms(jsonb) from public, anon;
grant execute on function public.rq_delete_terms(jsonb) to authenticated;
