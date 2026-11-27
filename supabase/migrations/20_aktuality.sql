-- RegulaQuest · 20 · Aktuality (novinky z RSS: SÚKL, Evropská komise, … a ručně přidané odkazy)
-- Stahování běží přímo v Supabase: pg_cron dvakrát denně zavolá rq_private.news_fetch() (pg_net pošle požadavky)
-- a o deset minut později rq_private.news_collect() (přečte odpovědi, rozebere RSS/Atom, uloží nové položky a uklidí staré).
-- Ukládá se jen název, krátký výtah (max. 600 znaků) a odkaz – celé články zůstávají u zdroje.
-- Stavy: new → read → published (studenti vidí hned) / rejected (skryté; po roce se smažou, do té doby brání novému načtení).
-- Nové a přečtené, které nikdo nezveřejní, se po 90 dnech samy přesunou mezi zamítnuté.
-- Lze spustit opakovaně. Pokud pg_cron / pg_net nejdou zapnout, migrace projde a stahování lze spustit ve Studiu ručně
-- (po zapnutí rozšíření v Database → Extensions stačí migraci spustit znovu).

do $$ begin
  begin execute 'create extension if not exists pg_net with schema extensions'; exception when others then raise notice 'pg_net nelze zapnout: %', sqlerrm; end;
  begin execute 'create extension if not exists pg_cron'; exception when others then raise notice 'pg_cron nelze zapnout: %', sqlerrm; end;
end $$;

create table if not exists public.news_sources (
  id            bigint generated always as identity primary key,
  name          text not null check (length(name) between 1 and 120),
  url           text not null unique check (url ~ '^https?://' and length(url) <= 500),
  area_keys     text[] not null default '{}',
  active        boolean not null default true,
  last_request  bigint,
  last_fetch_at timestamptz,
  last_ok_at    timestamptz,
  last_error    text not null default '',
  created_at    timestamptz not null default now()
);
create table if not exists public.news_items (
  id           bigint generated always as identity primary key,
  source_id    bigint references public.news_sources(id) on delete set null,
  source_name  text not null default '' check (length(source_name) <= 120),
  guid         text not null unique check (length(guid) <= 1000),
  url          text not null check (url ~ '^https?://' and length(url) <= 1000),
  title        text not null check (length(title) between 1 and 400),
  summary      text not null default '' check (length(summary) <= 1500),
  published_at timestamptz,
  fetched_at   timestamptz not null default now(),
  status       text not null default 'new' check (status in ('new', 'read', 'published', 'rejected')),
  comment      text not null default '' check (length(comment) <= 2000),
  area_keys    text[] not null default '{}',
  tags         text[] not null default '{}',
  group_keys   text[] not null default '{}',
  unit_ids     text[] not null default '{}',
  published_on timestamptz,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);
create index if not exists ix_news_items_status on public.news_items(status, published_at desc);
do $$
declare t text;
begin
  foreach t in array array['news_sources', 'news_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists admin_read on public.%I', t);
    execute format('create policy admin_read on public.%I for select to authenticated using (public.rq_is_admin())', t);
  end loop;
end $$;

insert into public.news_sources(name, url, area_keys)
select x.n, x.u, x.a from (values
  ('SÚKL – Aktuality ZP', 'https://sukl.gov.cz/category/zdravotnicke-prostredky/aktuality-zp/feed', '{zp}'::text[]),
  ('Evropská komise – Medical devices: latest updates', 'https://health.ec.europa.eu/node/12916/rss_en', '{zp}'::text[])) x(n, u, a)
where exists (select 1 from public.areas where key = 'zp') and not exists (select 1 from public.news_sources)
on conflict (url) do nothing;

-- ---------- rozbor kanálu ----------
create or replace function rq_private.feed_date(p text) returns timestamptz
language plpgsql immutable as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  return btrim(p)::timestamptz;
exception when others then
  begin return regexp_replace(btrim(p), '^[A-Za-z]{3},\s*', '')::timestamptz; exception when others then return null; end;
end $$;

create or replace function rq_private.unescape(p text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(regexp_replace(coalesce(p, ''), '<!\[CDATA\[(.*?)\]\]>', '\1', 'gs'),
    '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&apos;', ''''), '&nbsp;', ' '), '&#8211;', '–'), '&#8212;', '—'), '&#8230;', '…'), '&amp;', '&')
$$;
-- Text z XPath (Postgres ho vrací znovu escapovaný) → čistý text bez HTML značek
create or replace function rq_private.plain_text(p text, n int) returns text
language sql immutable as $$
  select left(btrim(regexp_replace(rq_private.unescape(regexp_replace(rq_private.unescape(p), '<[^>]*>', ' ', 'g')), '\s+', ' ', 'g')), n)
$$;

-- Uloží nové položky z textu kanálu (RSS 2.0 i Atom). Vrací počet nových.
create or replace function rq_private.news_ingest(p_source bigint, p_body text) returns int
language plpgsql set search_path = public as $$
declare src public.news_sources; doc xml; it xml; g text; u text; t text; d text; n int := 0; c int;
  f text := '/*/*[local-name()=''%s'']/text()';
begin
  select * into src from public.news_sources where id = p_source;
  doc := xmlparse(document regexp_replace(coalesce(p_body, ''), '^﻿?\s*', ''));
  for it in select unnest(xpath('//*[local-name()=''item'' or local-name()=''entry'']', doc)) loop
    t := rq_private.plain_text((xpath(format(f, 'title'), it))[1]::text, 400);
    u := btrim(rq_private.unescape(coalesce((xpath('/*/*[local-name()=''link'' and (not(@rel) or @rel=''alternate'')]/@href', it))[1]::text,
                  (xpath(format(f, 'link'), it))[1]::text)));
    g := coalesce(nullif(btrim(rq_private.unescape((xpath(format(f, 'guid'), it))[1]::text)), ''), nullif(btrim(rq_private.unescape((xpath(format(f, 'id'), it))[1]::text)), ''), u);
    d := coalesce((xpath(format(f, 'description'), it))[1]::text, (xpath(format(f, 'summary'), it))[1]::text, (xpath(format(f, 'content'), it))[1]::text, '');
    if coalesce(t, '') = '' or coalesce(u, '') !~ '^https?://' then continue; end if;
    insert into public.news_items(source_id, source_name, guid, url, title, summary, published_at, area_keys)
    values (src.id, coalesce(src.name, ''), left(g, 1000), left(u, 1000), t, rq_private.plain_text(d, 600),
            rq_private.feed_date(coalesce((xpath(format(f, 'pubDate'), it))[1]::text, (xpath(format(f, 'published'), it))[1]::text,
                                          (xpath(format(f, 'updated'), it))[1]::text, (xpath(format(f, 'date'), it))[1]::text)),
            coalesce(src.area_keys, '{}'))
    on conflict (guid) do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $$;

-- Úklid: nevyřízené po 90 dnech mezi zamítnuté (bez výtahu), zamítnuté po roce pryč.
create or replace function rq_private.news_cleanup() returns void
language sql set search_path = public as $$
  update public.news_items set status = 'rejected', summary = '', updated_at = now()
   where status in ('new', 'read') and fetched_at < now() - interval '90 days';
  update public.news_items set summary = '' where status = 'rejected' and summary <> '' and updated_at < now() - interval '30 days';
  delete from public.news_items where status = 'rejected' and updated_at < now() - interval '365 days';
$$;

-- Odeslání požadavků (pg_net); odpovědi se zpracují v news_collect()
create or replace function rq_private.news_fetch() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare s record; r bigint; n int := 0;
begin
  if to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is null then
    raise exception 'Rozšíření pg_net není zapnuté (Supabase → Database → Extensions → pg_net).';
  end if;
  for s in select * from public.news_sources where active loop
    execute 'select net.http_get($1, ''{}''::jsonb, $2, 20000)' into r
      using s.url, jsonb_build_object('User-Agent', 'RegulaQuest/1.0 (vyuka FBMI CVUT)', 'Accept', 'application/rss+xml, application/atom+xml, application/xml, text/xml');
    update public.news_sources set last_request = r, last_fetch_at = now() where id = s.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function rq_private.news_collect() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare s record; resp record; n int := 0;
begin
  if to_regclass('net._http_response') is null then return 0; end if;
  for s in select * from public.news_sources where last_request is not null loop
    execute 'select status_code, content, timed_out, error_msg from net._http_response where id = $1' into resp using s.last_request;
    if resp is null then
      if s.last_fetch_at < now() - interval '1 hour' then
        update public.news_sources set last_request = null, last_error = 'Zdroj neodpověděl.' where id = s.id;
      end if;
      continue;
    end if;
    if resp.status_code between 200 and 299 then
      begin
        n := n + rq_private.news_ingest(s.id, resp.content);
        update public.news_sources set last_request = null, last_ok_at = now(), last_error = '' where id = s.id;
      exception when others then
        update public.news_sources set last_request = null, last_error = left('Obsah nejde přečíst jako RSS/Atom: ' || sqlerrm, 300) where id = s.id;
      end;
    else
      update public.news_sources set last_request = null,
        last_error = left(case when resp.timed_out then 'Vypršel čas.' else 'Chyba ' || coalesce(resp.status_code::text, '') || ' ' || coalesce(resp.error_msg, '') end, 300)
      where id = s.id;
    end if;
  end loop;
  perform rq_private.news_cleanup();
  return n;
end $$;

-- Naplánování (jen pokud je pg_cron): stáhnout v 5:50 a 13:50 UTC, zpracovat o 10 minut později
do $$ begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('rq-aktuality-stahnout', '50 5,13 * * *', 'select rq_private.news_fetch()');
    perform cron.schedule('rq-aktuality-zpracovat', '0 6,14 * * *', 'select rq_private.news_collect()');
  else
    raise notice 'pg_cron není zapnutý – aktuality se načtou jen tlačítkem ve Studiu.';
  end if;
exception when others then raise notice 'Naplánování se nepodařilo: %', sqlerrm;
end $$;

-- ---------- RPC pro Studio ----------
create or replace function public.rq_news_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  return jsonb_build_object(
    'sources', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('items', (select count(*) from public.news_items i where i.source_id = s.id)) order by s.name) from public.news_sources s), '[]'),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by coalesce(i.published_at, i.fetched_at) desc, i.id desc) from public.news_items i
                       where i.status <> 'rejected' or i.updated_at > now() - interval '60 days'), '[]'),
    'scheduled', to_regnamespace('cron') is not null,
    'net', to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is not null);
end $$;

create or replace function public.rq_save_news_source(p_id bigint default null, p_name text default '', p_url text default '',
  p_area_keys jsonb default '[]', p_active boolean default true) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint; ar text[] := rq_private.clean_area_keys(rq_private.jtext(p_area_keys));
begin
  perform rq_private.require_admin();
  if btrim(coalesce(p_url, '')) !~ '^https?://' then raise exception 'Adresa zdroje musí začínat https://'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Napište název zdroje'; end if;
  if p_id is null then
    insert into public.news_sources(name, url, area_keys, active) values (btrim(p_name), btrim(p_url), ar, coalesce(p_active, true)) returning id into v;
  else
    update public.news_sources set name = btrim(p_name), url = btrim(p_url), area_keys = ar, active = coalesce(p_active, true) where id = p_id returning id into v;
    if v is null then raise exception 'Zdroj nebyl nalezen'; end if;
  end if;
  return v;
exception when unique_violation then raise exception 'Zdroj s touto adresou už existuje';
end $$;

create or replace function public.rq_delete_news_source(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  delete from public.news_sources where id = p_id;
  if not found then raise exception 'Zdroj nebyl nalezen'; end if;
end $$;

-- Hromadná změna stavu (přečteno / zveřejnit / zamítnout / vrátit mezi nové)
create or replace function public.rq_news_set_status(p_ids jsonb, p_status text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform rq_private.require_admin();
  if p_status not in ('new', 'read', 'published', 'rejected') then raise exception 'Neznámý stav'; end if;
  update public.news_items set status = p_status, updated_at = now(), updated_by = auth.uid(),
    published_on = case when p_status = 'published' then coalesce(published_on, now()) else published_on end
  where id in (select x::bigint from jsonb_array_elements_text(coalesce(p_ids, '[]')) x) and status <> p_status;
  get diagnostics n = row_count;
  return n;
end $$;

-- Úprava položky (komentář redakce, oblasti, štítky, dokumenty a ustanovení) nebo ruční přidání (p_id null; povinné url a title)
create or replace function public.rq_save_news_item(p_id bigint default null, p jsonb default '{}') returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint; tg text[] := coalesce((select array_agg(distinct x order by x) from unnest(rq_private.jtext(p->'tags')) x), '{}');
  ar text[] := rq_private.clean_area_keys(rq_private.jtext(p->'area_keys'));
  gk text[] := coalesce((select array_agg(distinct x) from unnest(rq_private.jtext(p->'group_keys')) x), '{}');
  ui text[] := coalesce((select array_agg(distinct x) from unnest(rq_private.jtext(p->'unit_ids')) x where exists (select 1 from public.units u where u.id = x)), '{}');
begin
  perform rq_private.require_admin();
  if exists (select 1 from unnest(tg) k where not exists (select 1 from public.tags t where t.key = k)) then raise exception 'Neznámý štítek'; end if;
  if p_id is null then
    if coalesce(btrim(p->>'url'), '') !~ '^https?://' then raise exception 'Odkaz musí začínat https://'; end if;
    if coalesce(btrim(p->>'title'), '') = '' then raise exception 'Napište název'; end if;
    insert into public.news_items(source_name, guid, url, title, summary, published_at, status, comment, area_keys, tags, group_keys, unit_ids, updated_by)
    values (left(coalesce(btrim(p->>'source_name'), 'Přidáno ručně'), 120), btrim(p->>'url'), btrim(p->>'url'), left(btrim(p->>'title'), 400),
            left(coalesce(btrim(p->>'summary'), ''), 1500), coalesce(rq_private.feed_date(p->>'published_at'), now()), 'read',
            left(coalesce(btrim(p->>'comment'), ''), 2000), ar, tg, gk, ui, auth.uid())
    returning id into v;
  else
    update public.news_items set
      title = coalesce(nullif(left(btrim(p->>'title'), 400), ''), title),
      summary = case when p ? 'summary' then left(btrim(p->>'summary'), 1500) else summary end,
      comment = case when p ? 'comment' then left(btrim(p->>'comment'), 2000) else comment end,
      area_keys = case when p ? 'area_keys' then ar else area_keys end,
      tags = case when p ? 'tags' then tg else tags end,
      group_keys = case when p ? 'group_keys' then gk else group_keys end,
      unit_ids = case when p ? 'unit_ids' then ui else unit_ids end,
      status = case when status = 'new' then 'read' else status end,
      updated_at = now(), updated_by = auth.uid()
    where id = p_id returning id into v;
    if v is null then raise exception 'Aktualita nebyla nalezena'; end if;
  end if;
  return v;
exception when unique_violation then raise exception 'Tento odkaz už mezi aktualitami je';
end $$;

-- Propojení s ustanovením přímo z dokumentu (přidá i dokument)
create or replace function public.rq_news_link_unit(p_id bigint, p_unit_id text, p_add boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare u public.units := rq_private.unit_row(p_unit_id); gk text;
begin
  perform rq_private.require_admin();
  select coalesce(group_key, id) into gk from public.documents where id = u.document_id;
  update public.news_items set
    unit_ids = case when p_add then (select array_agg(distinct x) from unnest(unit_ids || u.id) x) else array_remove(unit_ids, u.id) end,
    group_keys = case when p_add then (select array_agg(distinct x) from unnest(group_keys || gk) x) else group_keys end,
    status = case when status = 'new' then 'read' else status end, updated_at = now(), updated_by = auth.uid()
  where id = p_id;
  if not found then raise exception 'Aktualita nebyla nalezena'; end if;
end $$;

-- Ruční načtení ze Studia: nejdřív rq_news_fetch_now, za pár sekund rq_news_collect_now
create or replace function public.rq_news_fetch_now() returns int
language plpgsql security definer set search_path = public as $$
begin perform rq_private.require_admin(); return rq_private.news_fetch(); end $$;
create or replace function public.rq_news_collect_now() returns int
language plpgsql security definer set search_path = public as $$
begin perform rq_private.require_admin(); return rq_private.news_collect(); end $$;

-- ---------- pro studenty: zveřejněné aktuality (hned, bez publikace obsahu) ----------
create or replace function public.rq_reader_news() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.rq_is_member() then raise exception 'Přístup není aktivní.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'url', url, 'title', title, 'summary', summary, 'source', source_name,
      'published_at', published_at, 'published_on', published_on, 'comment', comment, 'area_keys', area_keys, 'tags', tags,
      'group_keys', group_keys, 'unit_ids', unit_ids) order by coalesce(published_at, published_on) desc, id desc)
    from (select * from public.news_items where status = 'published' order by coalesce(published_at, published_on) desc limit 400) x), '[]');
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
    'news_items', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.news_items x where x.status <> 'rejected'),
    'student_groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.student_groups x));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.rq_news_admin()', 'public.rq_save_news_source(bigint, text, text, jsonb, boolean)',
                           'public.rq_delete_news_source(bigint)', 'public.rq_news_set_status(jsonb, text)',
                           'public.rq_save_news_item(bigint, jsonb)', 'public.rq_news_link_unit(bigint, text, boolean)',
                           'public.rq_news_fetch_now()', 'public.rq_news_collect_now()', 'public.rq_reader_news()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function rq_private.news_fetch(), rq_private.news_collect(), rq_private.news_ingest(bigint, text) from public, anon, authenticated;
