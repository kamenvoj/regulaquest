-- RegulaQuest · 26 · Připomínky studentů a souhrnný přehled využívání
-- * Připomínky (chyba / nejasnost / návrh) u ustanovení, snímku, případu, trasy – ukládají se BEZ vazby na účet.
-- * Využívání: jen souhrny. Interně se drží denní řádek „účet × den“ (sekundy, počet návštěv) – nutné pro „10 z 15“
--   a typický čas; bez IP, zařízení a bez toho, co kdo četl. Co se čte a co se hledá, se ukládá bez vazby na účet.
--   Denní řádky účtů se po 13 měsících mažou. Redakce (admini) se nepočítá.
-- Lze spustit opakovaně.

-- ---------------------------------------------------------------- připomínky
create table if not exists public.feedback (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  kind         text not null check (kind in ('error', 'unclear', 'idea')),
  target_kind  text not null check (target_kind in ('unit', 'slide', 'case', 'path', 'other')),
  target_id    text not null default '',
  target_ref   text not null default '',          -- u snímku id prezentace
  target_label text not null default '',
  message      text not null check (length(message) between 3 and 2000),
  status       text not null default 'new' check (status in ('new', 'done')),
  resolved_at  timestamptz,
  note         text not null default ''
);
alter table public.feedback enable row level security;

create or replace function public.rq_send_feedback(p_kind text, p_target_kind text, p_target_id text default '', p_target_ref text default '', p_label text default '', p_message text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.rq_is_member() then raise exception 'Nejste přihlášen(a).' using errcode = '42501'; end if;
  if length(trim(coalesce(p_message, ''))) < 3 then raise exception 'Napište prosím alespoň pár slov.'; end if;
  -- jednoduchá brzda proti zahlcení (bez vazby na účet): nejvýš 200 připomínek za hodinu celkem
  if (select count(*) from public.feedback where created_at > now() - interval '1 hour') >= 200 then
    raise exception 'Připomínek je teď příliš mnoho, zkuste to prosím později.'; end if;
  insert into public.feedback(kind, target_kind, target_id, target_ref, target_label, message)
  values (p_kind, coalesce(nullif(p_target_kind, ''), 'other'), left(coalesce(p_target_id, ''), 160), left(coalesce(p_target_ref, ''), 160),
          left(coalesce(p_label, ''), 300), left(trim(p_message), 2000));
end $$;

create or replace function public.rq_feedback_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(f) order by (f.status = 'done'), f.created_at desc) from public.feedback f), '[]');
end $$;

create or replace function public.rq_feedback_set(p_id bigint, p_status text default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  update public.feedback set status = coalesce(p_status, status), note = coalesce(p_note, note),
         resolved_at = case when coalesce(p_status, status) = 'done' then coalesce(resolved_at, now()) else null end
   where id = p_id;
end $$;

create or replace function public.rq_delete_feedback(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  delete from public.feedback where id = p_id;
end $$;

-- ---------------------------------------------------------------- využívání
create table if not exists public.usage_days (           -- účet × den; jen pro souhrny, po 13 měsících se maže
  user_id  uuid not null references auth.users(id) on delete cascade,
  day      date not null,
  group_id uuid references public.student_groups(id) on delete set null,
  seconds  int not null default 0,
  visits   int not null default 0,
  primary key (user_id, day)
);
create table if not exists public.usage_content (        -- co se otevírá; bez vazby na účet
  day       date not null,
  group_id  uuid references public.student_groups(id) on delete set null,
  kind      text not null check (kind in ('unit', 'doc', 'pres', 'case', 'path', 'page')),
  target_id text not null,
  n         int not null default 0
);
create unique index if not exists usage_content_key on public.usage_content (day, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, target_id);
create table if not exists public.usage_search (         -- co se hledá; bez vazby na účet
  day      date not null,
  group_id uuid references public.student_groups(id) on delete set null,
  query    text not null,
  n        int not null default 0,
  misses   int not null default 0
);
create unique index if not exists usage_search_key on public.usage_search (day, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), query);
alter table public.usage_days enable row level security;
alter table public.usage_content enable row level security;
alter table public.usage_search enable row level security;

-- Záznam ze čtečky (dávka zhruba jednou za minutu). Admini a neaktivní účty se nezaznamenávají.
create or replace function public.rq_track(p_seconds int default 0, p_visit boolean default false, p_views jsonb default '[]', p_search jsonb default '[]')
returns void language plpgsql security definer set search_path = public as $$
declare g uuid; d date := rq_private.today_cz(); v jsonb;
begin
  select p.group_id into g from public.profiles p where p.user_id = auth.uid() and p.role = 'student' and p.active;
  if not found then return; end if;
  insert into public.usage_days(user_id, day, group_id, seconds, visits)
  values (auth.uid(), d, g, least(greatest(coalesce(p_seconds, 0), 0), 180), case when p_visit then 1 else 0 end)
  on conflict (user_id, day) do update set seconds = public.usage_days.seconds + excluded.seconds, visits = public.usage_days.visits + excluded.visits, group_id = excluded.group_id;
  for v in select * from jsonb_array_elements(coalesce(p_views, '[]')) limit 50 loop
    if v->>'kind' in ('unit', 'doc', 'pres', 'case', 'path', 'page') and coalesce(v->>'id', '') <> '' then
      insert into public.usage_content(day, group_id, kind, target_id, n) values (d, g, v->>'kind', left(v->>'id', 160), 1)
      on conflict (day, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, target_id) do update set n = public.usage_content.n + 1;
    end if;
  end loop;
  for v in select * from jsonb_array_elements(coalesce(p_search, '[]')) limit 20 loop
    if length(trim(coalesce(v->>'q', ''))) between 2 and 100 then
      insert into public.usage_search(day, group_id, query, n, misses) values (d, g, lower(trim(v->>'q')), 1, case when coalesce((v->>'hits')::int, 1) = 0 then 1 else 0 end)
      on conflict (day, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), query) do update set n = public.usage_search.n + 1, misses = public.usage_search.misses + excluded.misses;
    end if;
  end loop;
end $$;

-- Souhrnný přehled pro Studio. p_group null = všechny skupiny. Rozložení na studenty jen při ≥ 5 aktivních.
create or replace function public.rq_usage_report(p_group uuid default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f date := coalesce(p_from, rq_private.today_cz() - 29); t date := coalesce(p_to, rq_private.today_cz());
  accounts int; active int; per jsonb; dist jsonb := null; daily jsonb; kinds jsonb; areas jsonb; top jsonb; miss jsonb; searches jsonb; wk jsonb;
begin
  perform rq_private.require_admin();
  select count(*) into accounts from public.profiles p where p.role = 'student' and p.active and (p_group is null or p.group_id = p_group);
  -- na studenta (jen pro výpočet souhrnů, nevrací se)
  with s as (select user_id, sum(seconds) sec, sum(visits) vis, count(*) days from public.usage_days
              where day between f and t and (p_group is null or group_id = p_group) and (seconds > 0 or visits > 0) group by user_id)
  select count(*), jsonb_build_object(
      'minutes_total', coalesce(round(sum(sec) / 60.0), 0), 'visits_total', coalesce(sum(vis), 0),
      'minutes_median', round((percentile_cont(0.5) within group (order by sec) / 60.0)::numeric),
      'minutes_p25', round((percentile_cont(0.25) within group (order by sec) / 60.0)::numeric),
      'minutes_p75', round((percentile_cont(0.75) within group (order by sec) / 60.0)::numeric),
      'minutes_mean', round((avg(sec) / 60.0)::numeric),
      'visits_median', percentile_cont(0.5) within group (order by vis), 'visits_mean', round(avg(vis)::numeric, 1),
      'days_median', percentile_cont(0.5) within group (order by days), 'days_mean', round(avg(days)::numeric, 1),
      'visit_minutes_median', round((percentile_cont(0.5) within group (order by sec::numeric / greatest(vis, 1)) / 60.0)::numeric),
      'visits_buckets', jsonb_build_object('1', count(*) filter (where vis <= 1), '2–3', count(*) filter (where vis between 2 and 3),
                                           '4–9', count(*) filter (where vis between 4 and 9), '10+', count(*) filter (where vis >= 10)),
      'minutes_buckets', jsonb_build_object('do 15 min', count(*) filter (where sec < 900), '15–60 min', count(*) filter (where sec >= 900 and sec < 3600),
                                            '1–3 h', count(*) filter (where sec >= 3600 and sec < 10800), 'nad 3 h', count(*) filter (where sec >= 10800)))
    into active, per from s;
  if active < 5 then per := jsonb_build_object('minutes_total', per->'minutes_total', 'visits_total', per->'visits_total'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('day', day, 'active', a, 'minutes', m, 'visits', v) order by day), '[]') into daily from (
    select day, count(distinct user_id) a, round(sum(seconds) / 60.0) m, sum(visits) v from public.usage_days
     where day between f and t and (p_group is null or group_id = p_group) group by day) x;
  -- dny v týdnu (1 = pondělí) a jak často se vrací
  select coalesce(jsonb_object_agg(dw, v), '{}') into wk from (
    select extract(isodow from day)::int dw, sum(visits) v from public.usage_days where day between f and t and (p_group is null or group_id = p_group) group by 1) x;
  select coalesce(jsonb_object_agg(kind, n), '{}') into kinds from (
    select kind, sum(n) n from public.usage_content where day between f and t and (p_group is null or group_id = p_group) group by kind) x;
  -- oblasti: ustanovení/dokumenty přes zařazení dokumentu, prezentace a případy podle svých oblastí
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'name', name, 'n', n) order by n desc), '[]') into areas from (
    select a.key, a.name, sum(x.n) n from (
      select da.area_key k, c.n from public.usage_content c
        join public.units u on c.kind = 'unit' and u.id = c.target_id join public.documents d on d.id = u.document_id
        join public.document_areas da on da.group_key = d.group_key
       where c.day between f and t and (p_group is null or c.group_id = p_group)
      union all
      select da.area_key, c.n from public.usage_content c join public.documents d on c.kind = 'doc' and d.id = c.target_id
        join public.document_areas da on da.group_key = d.group_key where c.day between f and t and (p_group is null or c.group_id = p_group)
      union all
      select k, c.n from public.usage_content c join public.presentations p on c.kind = 'pres' and p.id = c.target_id, unnest(p.area_keys) k
       where c.day between f and t and (p_group is null or c.group_id = p_group)
      union all
      select k, c.n from public.usage_content c join public.cases cs on c.kind = 'case' and cs.id = c.target_id, unnest(cs.area_keys) k
       where c.day between f and t and (p_group is null or c.group_id = p_group)) x
    join public.areas a on a.key = x.k group by a.key, a.name) y;
  select coalesce(jsonb_object_agg(kind, items), '{}') into top from (
    select kind, jsonb_agg(jsonb_build_object('id', target_id, 'n', n, 'label', label) order by n desc) items from (
      select c.kind, c.target_id, sum(c.n) n,
             case c.kind when 'unit' then (select d.family || ' · ' || upper(d.language) || ' · ' || u.label from public.units u join public.documents d on d.id = u.document_id where u.id = c.target_id)
                         when 'doc' then (select coalesce(nullif(d.family, ''), d.title) || ' · ' || upper(d.language) from public.documents d where d.id = c.target_id)
                         when 'pres' then (select p.title from public.presentations p where p.id = c.target_id)
                         when 'case' then (select cs.title from public.cases cs where cs.id = c.target_id)
                         when 'path' then (select p.title from public.paths p where p.id = c.target_id)
                         else c.target_id end label,
             row_number() over (partition by c.kind order by sum(c.n) desc) rn
        from public.usage_content c where c.day between f and t and (p_group is null or c.group_id = p_group)
       group by c.kind, c.target_id) z where rn <= 10 group by kind) y;
  select coalesce(jsonb_agg(jsonb_build_object('q', query, 'n', n) order by n desc), '[]') into miss from (
    select query, sum(misses) n from public.usage_search where day between f and t and (p_group is null or group_id = p_group) group by query having sum(misses) > 0 order by 2 desc limit 25) x;
  select coalesce(jsonb_agg(jsonb_build_object('q', query, 'n', n) order by n desc), '[]') into searches from (
    select query, sum(n) n from public.usage_search where day between f and t and (p_group is null or group_id = p_group) group by query order by 2 desc limit 15) x;
  return jsonb_build_object('from', f, 'to', t, 'accounts', accounts, 'active', active, 'per_student', per, 'small', active < 5,
    'daily', daily, 'weekdays', wk, 'kinds', kinds, 'areas', areas, 'top', top, 'search_misses', miss, 'searches', searches,
    'groups', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name), '[]') from public.student_groups g));
end $$;

create or replace function rq_private.usage_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from public.usage_days where day < rq_private.today_cz() - interval '13 months';
$$;

do $$ begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('rq-vyuziti-uklid', '20 3 * * *', 'select rq_private.usage_cleanup()');
  end if;
exception when others then raise notice 'Naplánování úklidu se nepodařilo: %', sqlerrm;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.rq_send_feedback(text, text, text, text, text, text)', 'public.rq_feedback_admin()', 'public.rq_feedback_set(bigint, text, text)',
                           'public.rq_delete_feedback(bigint)', 'public.rq_track(int, boolean, jsonb, jsonb)', 'public.rq_usage_report(uuid, date, date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
