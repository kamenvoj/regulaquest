-- RegulaQuest · 29 · Simulace – katalog „světa“: subjekty, obecné ZP, výrobky výrobců, kusy, vztahy
-- * Obecný produkt (druh ZP, např. volumetrická infuzní pumpa) → výrobek výrobce (obchodní název, identifikátory,
--   verze; dědí vlastnosti obecného produktu a smí je přepsat) → kus u subjektu (výrobní číslo, umístění, BTK…).
-- * Vztah: subjekt – druh vztahu – výrobek / subjekt – podrobnosti (platnost, číslo smlouvy/certifikátu…).
-- * Pole subjektů, produktů, výrobků, kusů i druhy vztahů nastavuje redakce (sim_catalog_config) – bez programování.
-- * Vše je smyšlené; identifikátory ve formátu SIM-…. Zatím jen pro redakci (Studio); studentům se katalog dostane
--   až přes scénář (fáze B).
-- Jen nové tabulky sim_* a funkce rq_sim_*. Lze spustit opakovaně.

create table if not exists public.sim_catalog_config (
  id         int primary key default 1 check (id = 1),
  config     jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.sim_subjects (
  id text primary key, type text not null, name text not null, data jsonb not null default '{}',
  archived boolean not null default false, updated_at timestamptz not null default now()
);
create table if not exists public.sim_products (
  id text primary key, name text not null, data jsonb not null default '{}',
  archived boolean not null default false, updated_at timestamptz not null default now()
);
create table if not exists public.sim_models (
  id text primary key,
  product_id text not null references public.sim_products(id),
  manufacturer_id text not null references public.sim_subjects(id),
  name text not null, data jsonb not null default '{}',
  archived boolean not null default false, updated_at timestamptz not null default now()
);
create table if not exists public.sim_units (
  id text primary key,
  model_id text not null references public.sim_models(id),
  holder_id text references public.sim_subjects(id),
  data jsonb not null default '{}',
  archived boolean not null default false, updated_at timestamptz not null default now()
);
create table if not exists public.sim_relations (
  id bigserial primary key,
  subject_id text not null references public.sim_subjects(id) on delete cascade,
  kind text not null,
  target_kind text not null check (target_kind in ('model', 'subject')),
  target_id text not null,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create index if not exists sim_relations_target on public.sim_relations(target_kind, target_id);
alter table public.sim_catalog_config enable row level security;
alter table public.sim_subjects enable row level security;
alter table public.sim_products enable row level security;
alter table public.sim_models enable row level security;
alter table public.sim_units enable row level security;
alter table public.sim_relations enable row level security;

create or replace function public.rq_sim_catalog() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  return jsonb_build_object(
    'config', (select config from public.sim_catalog_config where id = 1),
    'subjects', coalesce((select jsonb_agg(to_jsonb(s) order by s.type, s.name) from public.sim_subjects s), '[]'),
    'products', coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from public.sim_products p), '[]'),
    'models', coalesce((select jsonb_agg(to_jsonb(m) order by m.name) from public.sim_models m), '[]'),
    'units', coalesce((select jsonb_agg(to_jsonb(u) order by u.id) from public.sim_units u), '[]'),
    'relations', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.sim_relations r), '[]'));
end $$;

create or replace function public.rq_sim_cat_config(p_config jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  insert into public.sim_catalog_config(id, config) values (1, p_config)
  on conflict (id) do update set config = excluded.config, updated_at = now();
end $$;

-- Uložení položky katalogu: p_kind = subject | product | model | unit; p_id null = nová; patch smí být částečný
create or replace function public.rq_sim_cat_save(p_kind text, p_id text default null, p_patch jsonb default '{}') returns text
language plpgsql security definer set search_path = public as $$
declare v text := nullif(p_id, ''); pre text := case p_kind when 'subject' then 's-' when 'product' then 'p-' when 'model' then 'v-' when 'unit' then 'k-' end;
  arch boolean := (p_patch->>'archived')::boolean;
begin
  perform rq_private.require_admin();
  if pre is null then raise exception 'Neznámý druh položky.'; end if;
  if p_kind = 'subject' then
    if v is not null and exists (select 1 from public.sim_subjects where id = v) then
      update public.sim_subjects set type = coalesce(p_patch->>'type', type), name = coalesce(nullif(p_patch->>'name', ''), name),
        data = coalesce(p_patch->'data', data), archived = coalesce(arch, archived), updated_at = now() where id = v;
    else
      v := coalesce(v, pre || substr(md5(random()::text || clock_timestamp()::text), 1, 8));
      insert into public.sim_subjects(id, type, name, data, archived) values (v, coalesce(p_patch->>'type', 'vyrobce'), coalesce(nullif(p_patch->>'name', ''), 'Nový subjekt'), coalesce(p_patch->'data', '{}'), coalesce(arch, false));
    end if;
  elsif p_kind = 'product' then
    if v is not null and exists (select 1 from public.sim_products where id = v) then
      update public.sim_products set name = coalesce(nullif(p_patch->>'name', ''), name), data = coalesce(p_patch->'data', data), archived = coalesce(arch, archived), updated_at = now() where id = v;
    else
      v := coalesce(v, pre || substr(md5(random()::text || clock_timestamp()::text), 1, 8));
      insert into public.sim_products(id, name, data, archived) values (v, coalesce(nullif(p_patch->>'name', ''), 'Nový produkt'), coalesce(p_patch->'data', '{}'), coalesce(arch, false));
    end if;
  elsif p_kind = 'model' then
    if v is not null and exists (select 1 from public.sim_models where id = v) then
      update public.sim_models set product_id = coalesce(p_patch->>'product_id', product_id), manufacturer_id = coalesce(p_patch->>'manufacturer_id', manufacturer_id),
        name = coalesce(nullif(p_patch->>'name', ''), name), data = coalesce(p_patch->'data', data), archived = coalesce(arch, archived), updated_at = now() where id = v;
    else
      if coalesce(p_patch->>'product_id', '') = '' or coalesce(p_patch->>'manufacturer_id', '') = '' then raise exception 'Výrobek potřebuje obecný produkt a výrobce.'; end if;
      v := coalesce(v, pre || substr(md5(random()::text || clock_timestamp()::text), 1, 8));
      insert into public.sim_models(id, product_id, manufacturer_id, name, data, archived) values (v, p_patch->>'product_id', p_patch->>'manufacturer_id', coalesce(nullif(p_patch->>'name', ''), 'Nový výrobek'), coalesce(p_patch->'data', '{}'), coalesce(arch, false));
    end if;
  else
    if v is not null and exists (select 1 from public.sim_units where id = v) then
      update public.sim_units set model_id = coalesce(p_patch->>'model_id', model_id),
        holder_id = case when p_patch ? 'holder_id' then nullif(p_patch->>'holder_id', '') else holder_id end,
        data = coalesce(p_patch->'data', data), archived = coalesce(arch, archived), updated_at = now() where id = v;
    else
      if coalesce(p_patch->>'model_id', '') = '' then raise exception 'Kus potřebuje výrobek.'; end if;
      v := coalesce(v, pre || substr(md5(random()::text || clock_timestamp()::text), 1, 8));
      insert into public.sim_units(id, model_id, holder_id, data, archived) values (v, p_patch->>'model_id', nullif(p_patch->>'holder_id', ''), coalesce(p_patch->'data', '{}'), coalesce(arch, false));
    end if;
  end if;
  return v;
end $$;

-- Smazání jen nepoužité položky (jinak archivovat)
create or replace function public.rq_sim_cat_delete(p_kind text, p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  if p_kind = 'product' and exists (select 1 from public.sim_models where product_id = p_id) then raise exception 'Produkt má výrobky – lze ho jen archivovat.'; end if;
  if p_kind = 'model' and (exists (select 1 from public.sim_units where model_id = p_id) or exists (select 1 from public.sim_relations where target_kind = 'model' and target_id = p_id)) then raise exception 'Výrobek má kusy nebo vztahy – lze ho jen archivovat.'; end if;
  if p_kind = 'subject' and (exists (select 1 from public.sim_models where manufacturer_id = p_id) or exists (select 1 from public.sim_units where holder_id = p_id)
      or exists (select 1 from public.sim_relations where target_kind = 'subject' and target_id = p_id)) then raise exception 'Subjekt je použitý (výrobky, kusy nebo vztahy) – lze ho jen archivovat.'; end if;
  if exists (select 1 from public.sim_scenarios where definition::text like '%"' || p_id || '"%') then raise exception 'Položku používá scénář – lze ji jen archivovat.'; end if;
  if p_kind = 'subject' then delete from public.sim_subjects where id = p_id;
  elsif p_kind = 'product' then delete from public.sim_products where id = p_id;
  elsif p_kind = 'model' then delete from public.sim_models where id = p_id;
  elsif p_kind = 'unit' then delete from public.sim_units where id = p_id;
  end if;
end $$;

create or replace function public.rq_sim_rel_save(p_id bigint default null, p_patch jsonb default '{}') returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint := p_id;
begin
  perform rq_private.require_admin();
  if v is null then
    insert into public.sim_relations(subject_id, kind, target_kind, target_id, data)
    values (p_patch->>'subject_id', p_patch->>'kind', coalesce(p_patch->>'target_kind', 'model'), p_patch->>'target_id', coalesce(p_patch->'data', '{}')) returning id into v;
  else
    update public.sim_relations set kind = coalesce(p_patch->>'kind', kind), target_kind = coalesce(p_patch->>'target_kind', target_kind),
      target_id = coalesce(p_patch->>'target_id', target_id), data = coalesce(p_patch->'data', data), updated_at = now() where id = v;
  end if;
  return v;
end $$;

create or replace function public.rq_sim_rel_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  delete from public.sim_relations where id = p_id;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.rq_sim_catalog()', 'public.rq_sim_cat_config(jsonb)', 'public.rq_sim_cat_save(text, text, jsonb)', 'public.rq_sim_cat_delete(text, text)',
    'public.rq_sim_rel_save(bigint, jsonb)', 'public.rq_sim_rel_delete(bigint)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------- výchozí nastavení polí (redakce může měnit ve Studiu) ----------
insert into public.sim_catalog_config(id, config) values (1, $cfg$
{
  "subject_types": [
    {"id": "vyrobce", "label": "Výrobce", "fields": [
      {"id": "sidlo", "label": "Sídlo", "type": "text"}, {"id": "srn", "label": "SRN (simulované)", "type": "text"},
      {"id": "prrc", "label": "Osoba odpovědná za dodržování předpisů (PRRC)", "type": "text"}, {"id": "qms", "label": "Certifikovaný systém řízení kvality", "type": "bool"}]},
    {"id": "zastupce", "label": "Zplnomocněný zástupce", "fields": [{"id": "sidlo", "label": "Sídlo", "type": "text"}, {"id": "srn", "label": "SRN (simulované)", "type": "text"}]},
    {"id": "dovozce", "label": "Dovozce", "fields": [{"id": "sidlo", "label": "Sídlo", "type": "text"}, {"id": "srn", "label": "SRN (simulované)", "type": "text"}]},
    {"id": "distributor", "label": "Distributor", "fields": [{"id": "sidlo", "label": "Sídlo", "type": "text"}, {"id": "iszp", "label": "Ohlášen v ISZP", "type": "bool"}]},
    {"id": "poskytovatel", "label": "Poskytovatel zdravotních služeb", "fields": [{"id": "sidlo", "label": "Sídlo", "type": "text"},
      {"id": "druh", "label": "Druh", "type": "select", "options": ["Nemocnice", "Ambulantní zařízení", "Laboratoř", "Jiné"]}, {"id": "luzka", "label": "Počet lůžek", "type": "number"}]},
    {"id": "servis", "label": "Servisní organizace", "fields": [{"id": "sidlo", "label": "Sídlo", "type": "text"}, {"id": "zkousky", "label": "Provádí BTK", "type": "bool"}, {"id": "revize", "label": "Provádí elektrorevize", "type": "bool"}]},
    {"id": "nb", "label": "Oznámený subjekt", "fields": [{"id": "cislo", "label": "Identifikační číslo (simulované)", "type": "text"},
      {"id": "rozsah", "label": "Rozsah jmenování (kódy)", "type": "text"}, {"id": "lhuta", "label": "Obvyklá doba posouzení (týdny)", "type": "number"}]},
    {"id": "organ", "label": "Příslušný / dozorový orgán", "fields": [{"id": "oblast", "label": "Oblast", "type": "select", "options": ["Zdravotnické prostředky", "Metrologie", "Ionizující záření", "Veřejné zakázky", "Ochrana osobních údajů", "Kybernetická bezpečnost"]}]},
    {"id": "ams", "label": "Metrologické středisko / laboratoř", "fields": [{"id": "autorizace", "label": "Autorizace / akreditace (rozsah)", "type": "text"}]}
  ],
  "product_fields": [
    {"id": "ucel", "label": "Určený účel", "type": "text"},
    {"id": "trida", "label": "Třída rizika", "type": "select", "options": ["I", "Is", "Im", "Ir", "IIa", "IIb", "III"]},
    {"id": "aktivni", "label": "Aktivní zdravotnický prostředek", "type": "bool"},
    {"id": "software", "label": "Obsahuje software", "type": "bool"},
    {"id": "btk", "label": "Interval BTK (měsíce)", "type": "number"},
    {"id": "revize", "label": "Interval elektrorevize (měsíce)", "type": "number"},
    {"id": "mereni", "label": "Má měřicí funkci", "type": "bool"},
    {"id": "stanovene", "label": "Stanovené měřidlo", "type": "bool", "when": "mereni"},
    {"id": "overeni", "label": "Doba platnosti ověření (roky)", "type": "number", "when": "mereni"},
    {"id": "izz", "label": "Obsahuje zdroj ionizujícího záření", "type": "bool"},
    {"id": "izz_kat", "label": "Kategorie zdroje", "type": "text", "when": "izz"},
    {"id": "zps", "label": "Zkoušky provozní stálosti – interval (měsíce)", "type": "number", "when": "izz"}
  ],
  "model_fields": [
    {"id": "basic_udi", "label": "Basic UDI-DI (simulované)", "type": "text"}, {"id": "udi_di", "label": "UDI-DI (simulované)", "type": "text"},
    {"id": "kat", "label": "Katalogové číslo", "type": "text"}, {"id": "sw", "label": "Verze softwaru", "type": "text"},
    {"id": "uvedeno", "label": "Uvedeno na trh", "type": "date"}
  ],
  "unit_fields": [
    {"id": "sn", "label": "Výrobní číslo", "type": "text"}, {"id": "umisteni", "label": "Umístění", "type": "text"},
    {"id": "instalace", "label": "Datum instalace", "type": "date"}, {"id": "sw", "label": "Verze softwaru", "type": "text"},
    {"id": "btk_posl", "label": "Poslední BTK", "type": "date"}, {"id": "revize_posl", "label": "Poslední elektrorevize", "type": "date"},
    {"id": "overeni_posl", "label": "Poslední ověření / kalibrace", "type": "date"},
    {"id": "stav", "label": "Stav", "type": "select", "options": ["V provozu", "Mimo provoz", "V opravě", "Vyřazen"]}
  ],
  "relation_kinds": [
    {"id": "distribuuje", "label": "Distribuuje", "target": "model"},
    {"id": "dovazi", "label": "Dováží", "target": "model"},
    {"id": "servisuje", "label": "Oprávněný servis", "target": "model"},
    {"id": "certifikoval", "label": "Certifikoval (oznámený subjekt)", "target": "model"},
    {"id": "zastupuje", "label": "Zastupuje výrobce", "target": "subject"},
    {"id": "dodava", "label": "Dodává poskytovateli", "target": "subject"},
    {"id": "dozoruje", "label": "Dozoruje", "target": "subject"}
  ],
  "relation_fields": [
    {"id": "od", "label": "Platí od", "type": "date"}, {"id": "do", "label": "Platí do", "type": "date"},
    {"id": "cislo", "label": "Číslo smlouvy / certifikátu", "type": "text"}, {"id": "poznamka", "label": "Poznámka", "type": "text"}
  ]
}
$cfg$::jsonb) on conflict (id) do nothing;

-- ---------- ukázkový svět (smyšlený) ----------
insert into public.sim_subjects(id, type, name, data) values
  ('s-medivia', 'vyrobce', 'Medivia Systems s.r.o.', '{"sidlo": "Lipovec (fiktivní)", "srn": "SIM-CZ-MF-000123", "qms": true}'),
  ('s-medidistrib', 'distributor', 'MediDistrib a.s.', '{"sidlo": "Bor (fiktivní)", "iszp": true}'),
  ('s-servisplus', 'servis', 'ServisPlus s.r.o.', '{"sidlo": "Rovina (fiktivní)", "zkousky": true, "revize": true}'),
  ('s-nb0123', 'nb', 'CertiMed (simulovaný oznámený subjekt)', '{"cislo": "SIM-NB-0123", "rozsah": "MDA 0201, MDA 0306, MDS 1009", "lhuta": 12}'),
  ('s-lipovec', 'poskytovatel', 'Krajská nemocnice Lipovec', '{"sidlo": "Lipovec (fiktivní)", "druh": "Nemocnice", "luzka": 540}'),
  ('s-bor', 'poskytovatel', 'Nemocnice Bor', '{"sidlo": "Bor (fiktivní)", "druh": "Nemocnice", "luzka": 210}'),
  ('s-sukl', 'organ', 'SÚKL (simulace)', '{"oblast": "Zdravotnické prostředky"}'),
  ('s-cmi', 'organ', 'ČMI (simulace)', '{"oblast": "Metrologie"}'),
  ('s-ams1', 'ams', 'MetroLab s.r.o. (simulované AMS)', '{"autorizace": "ověřování tonometrů a vah (simulace)"}')
on conflict (id) do nothing;
insert into public.sim_products(id, name, data) values
  ('p-infuzni-pumpa', 'Volumetrická infuzní pumpa', '{"ucel": "Řízené kontinuální a bolusové podávání léčiv a roztoků", "trida": "IIb", "aktivni": true, "software": true, "btk": 12, "revize": 24}'),
  ('p-tonometr', 'Digitální tonometr (měřič krevního tlaku)', '{"ucel": "Neinvazivní měření krevního tlaku", "trida": "IIa", "aktivni": true, "software": true, "btk": 24, "mereni": true, "stanovene": true, "overeni": 2}'),
  ('p-rtg-mobil', 'Mobilní RTG přístroj', '{"ucel": "Skiagrafické zobrazování u lůžka", "trida": "IIb", "aktivni": true, "software": true, "btk": 12, "revize": 12, "izz": true, "izz_kat": "významný zdroj (simulace)", "zps": 3}')
on conflict (id) do nothing;
insert into public.sim_models(id, product_id, manufacturer_id, name, data) values
  ('v-infusim-p3', 'p-infuzni-pumpa', 's-medivia', 'InfuSIM P3', '{"basic_udi": "SIM-BUDI-MED-P3", "udi_di": "SIM-UDI-0450001", "kat": "MED-P3-01", "sw": "2.3", "uvedeno": "2021-03-01"}'),
  ('v-pressim-t2', 'p-tonometr', 's-medivia', 'PresSIM T2', '{"basic_udi": "SIM-BUDI-MED-T2", "udi_di": "SIM-UDI-0450107", "kat": "MED-T2", "sw": "1.4", "uvedeno": "2019-09-01"}')
on conflict (id) do nothing;
insert into public.sim_units(id, model_id, holder_id, data) values
  ('k-lip-004417', 'v-infusim-p3', 's-lipovec', '{"sn": "SIM-P3-004417", "umisteni": "ARO, lůžko 4", "instalace": "2022-05-10", "sw": "2.3", "btk_posl": "2025-06-12", "stav": "V provozu"}'),
  ('k-lip-004418', 'v-infusim-p3', 's-lipovec', '{"sn": "SIM-P3-004418", "umisteni": "ARO, lůžko 5", "instalace": "2022-05-10", "sw": "2.3", "btk_posl": "2025-06-12", "stav": "V provozu"}'),
  ('k-lip-t2-0091', 'v-pressim-t2', 's-lipovec', '{"sn": "SIM-T2-0091", "umisteni": "Interní ambulance", "instalace": "2023-01-15", "sw": "1.4", "btk_posl": "2024-02-01", "overeni_posl": "2023-01-10", "stav": "V provozu"}'),
  ('k-bor-003902', 'v-infusim-p3', 's-bor', '{"sn": "SIM-P3-003902", "umisteni": "Interní JIP", "instalace": "2021-11-02", "sw": "2.3", "btk_posl": "2025-03-20", "stav": "V provozu"}')
on conflict (id) do nothing;
insert into public.sim_relations(subject_id, kind, target_kind, target_id, data)
select * from (values
  ('s-medidistrib', 'distribuuje', 'model', 'v-infusim-p3', '{"od": "2021-03-01"}'::jsonb),
  ('s-servisplus', 'servisuje', 'model', 'v-infusim-p3', '{"od": "2022-01-01", "do": "2026-12-31", "cislo": "SIM-SML-2022-07"}'::jsonb),
  ('s-nb0123', 'certifikoval', 'model', 'v-infusim-p3', '{"cislo": "SIM-CERT-0123-4471", "od": "2021-02-15", "do": "2026-02-14"}'::jsonb),
  ('s-medidistrib', 'dodava', 'subject', 's-lipovec', '{}'::jsonb)
) v(a, b, c, d, e)
where not exists (select 1 from public.sim_relations);
