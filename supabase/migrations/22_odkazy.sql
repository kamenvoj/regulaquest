-- RegulaQuest · 22 · Užitečné odkazy pro studenty (SÚKL, EUDAMED, ČMI, EUR-Lex…)
-- Odkaz = název, adresa, popisek, kategorie, oblasti, štítky, pořadí, stav (draft / published).
-- Zveřejněné studenti vidí hned (bez publikace obsahu). Úklid testovacích dat je nemaže. Lze spustit opakovaně.

create table if not exists public.links (
  id          bigint generated always as identity primary key,
  title       text not null check (length(title) between 1 and 200),
  url         text not null check (url ~ '^https?://' and length(url) <= 1000),
  description text not null default '' check (length(description) <= 600),
  category    text not null default 'Ostatní' check (length(category) between 1 and 80),
  area_keys   text[] not null default '{}',
  tags        text[] not null default '{}',
  status      text not null default 'draft' check (status in ('draft', 'published')),
  sort        int not null default 100,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
alter table public.links enable row level security;
revoke all on public.links from anon, authenticated;
grant select on public.links to authenticated;
drop policy if exists admin_read on public.links;
create policy admin_read on public.links for select to authenticated using (public.rq_is_admin());

-- Výchozí sada (koncepty – zkontrolujte a zveřejněte ve Studiu)
insert into public.links(title, url, description, category, area_keys, sort)
select x.t, x.u, x.d, x.c, case when exists (select 1 from public.areas where key = any(x.a)) then x.a else '{}' end, x.s
from (values
  ('SÚKL – Státní ústav pro kontrolu léčiv', 'https://sukl.gov.cz/', 'Český příslušný orgán pro zdravotnické prostředky a léčiva: aktuality, bezpečnostní upozornění, pokyny.', 'Úřady a instituce', '{zp,lecive_pripravky}'::text[], 10),
  ('ČMI – Český metrologický institut', 'https://www.cmi.gov.cz/', 'Metrologie, ověřování stanovených měřidel a schvalování typu.', 'Úřady a instituce', '{metrologie}'::text[], 20),
  ('EUDAMED', 'https://ec.europa.eu/tools/eudamed', 'Evropská databáze zdravotnických prostředků: hospodářské subjekty, UDI a prostředky, certifikáty, oznámené subjekty.', 'Databáze a registry', '{zp}'::text[], 10),
  ('EUR-Lex', 'https://eur-lex.europa.eu/', 'Oficiální znění předpisů EU včetně konsolidovaných znění (MDR, IVDR, GDPR, AI Act…).', 'Legislativa', '{}'::text[], 10),
  ('e-Sbírka', 'https://www.e-sbirka.cz/', 'Oficiální elektronická Sbírka zákonů ČR – aktuální znění českých předpisů.', 'Legislativa', '{}'::text[], 20),
  ('Pokyny MDCG', 'https://health.ec.europa.eu/medical-devices-sector/new-regulations/guidance-mdcg-endorsed-documents-and-other-guidance_en', 'Přehled pokynů Koordinační skupiny pro zdravotnické prostředky (MDCG) a dalších metodik Evropské komise.', 'Metodiky a pokyny', '{zp}'::text[], 10),
  ('ÚNMZ – technické normy', 'https://www.unmz.cz/', 'Úřad pro technickou normalizaci, metrologii a státní zkušebnictví: technické normy ČSN.', 'Normy', '{zp,metrologie}'::text[], 10)
) x(t, u, d, c, a, s)
where not exists (select 1 from public.links);

-- p: {title, url, description, category, area_keys, tags, status, sort}
create or replace function public.rq_save_link(p_id bigint default null, p jsonb default '{}') returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
  ar text[] := rq_private.clean_area_keys(rq_private.jtext(p->'area_keys'));
  tg text[] := coalesce((select array_agg(distinct x order by x) from unnest(rq_private.jtext(p->'tags')) x), '{}');
  st text := coalesce(nullif(p->>'status', ''), 'draft');
begin
  perform rq_private.require_admin();
  if coalesce(btrim(p->>'title'), '') = '' then raise exception 'Napište název odkazu'; end if;
  if coalesce(btrim(p->>'url'), '') !~ '^https?://' then raise exception 'Adresa musí začínat https://'; end if;
  if st not in ('draft', 'published') then raise exception 'Neznámý stav'; end if;
  if exists (select 1 from unnest(tg) k where not exists (select 1 from public.tags t where t.key = k)) then raise exception 'Neznámý štítek'; end if;
  if p_id is null then
    insert into public.links(title, url, description, category, area_keys, tags, status, sort, updated_by)
    values (left(btrim(p->>'title'), 200), btrim(p->>'url'), left(btrim(coalesce(p->>'description', '')), 600),
            coalesce(nullif(left(btrim(p->>'category'), 80), ''), 'Ostatní'), ar, tg, st,
            coalesce((p->>'sort')::int, (select coalesce(max(sort), 0) + 10 from public.links where category = coalesce(nullif(btrim(p->>'category'), ''), 'Ostatní'))), auth.uid())
    returning id into v;
  else
    update public.links set title = left(btrim(p->>'title'), 200), url = btrim(p->>'url'), description = left(btrim(coalesce(p->>'description', '')), 600),
      category = coalesce(nullif(left(btrim(p->>'category'), 80), ''), 'Ostatní'), area_keys = ar, tags = tg, status = st,
      sort = coalesce((p->>'sort')::int, sort), updated_at = now(), updated_by = auth.uid()
    where id = p_id returning id into v;
    if v is null then raise exception 'Odkaz nebyl nalezen'; end if;
  end if;
  return v;
end $$;

create or replace function public.rq_delete_link(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  delete from public.links where id = p_id;
  if not found then raise exception 'Odkaz nebyl nalezen'; end if;
end $$;

-- Posun v rámci kategorie (-1 nahoru, +1 dolů)
create or replace function public.rq_move_link(p_id bigint, p_dir int) returns void
language plpgsql security definer set search_path = public as $$
declare c text; ids bigint[]; i int; t bigint;
begin
  perform rq_private.require_admin();
  select category into c from public.links where id = p_id;
  if c is null then raise exception 'Odkaz nebyl nalezen'; end if;
  select array_agg(id order by sort, id) into ids from public.links where category = c;
  i := array_position(ids, p_id);
  if i + p_dir between 1 and array_length(ids, 1) then t := ids[i]; ids[i] := ids[i + p_dir]; ids[i + p_dir] := t; end if;
  update public.links l set sort = x.n * 10 from unnest(ids) with ordinality x(id, n) where l.id = x.id;
end $$;

create or replace function public.rq_links_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(l) order by l.category, l.sort, l.id) from public.links l), '[]');
end $$;

create or replace function public.rq_reader_links() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.rq_is_member() then raise exception 'Přístup není aktivní.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'url', url, 'description', description, 'category', category,
      'area_keys', area_keys, 'tags', tags) order by category, sort, id) from public.links where status = 'published'), '[]');
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
    'news_items', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.news_items x where x.status <> 'rejected'),
    'student_groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.student_groups x));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.rq_save_link(bigint, jsonb)', 'public.rq_delete_link(bigint)', 'public.rq_move_link(bigint, int)',
                           'public.rq_links_admin()', 'public.rq_reader_links()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
