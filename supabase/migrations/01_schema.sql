-- RegulaQuest · 01 · Schéma, role a pravidla přístupu (RLS)
-- Spouští se v Supabase → SQL Editor. Lze spustit opakovaně (vše je "if not exists").
--
-- Zásady:
--  * Klienti (Studio, čtečka) tabulky NIKDY nemění přímo. Všechny změny jdou přes funkce
--    rq_* (soubor 02), které vynucují odborná pravidla (ověřování, schvalování, historie).
--  * Admini smí pracovní tabulky číst. Studenti nesmí číst nic z pracovních dat;
--    dostanou jen aktuální publikovanou verzi přes funkci rq_current_publication().
--  * Vnitřní pomocné funkce jsou ve schématu rq_private, které API nezveřejňuje.

create schema if not exists rq_private;
revoke all on schema rq_private from public, anon, authenticated;

-- ---------------------------------------------------------------- účty a skupiny
create table if not exists public.student_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(name) between 1 and 120),
  note        text not null default '',
  valid_until date,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid
);

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9._-]{2,40}$'),
  display_name text not null default '',
  role         text not null check (role in ('owner', 'admin', 'student')),
  group_id     uuid references public.student_groups(id),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  check (role = 'student' or group_id is null)
);

-- ---------------------------------------------------------------- obsah
create table if not exists public.documents (
  id            text primary key check (id ~ '^[a-z0-9][a-z0-9._-]{1,79}$'),
  title         text not null,
  family        text not null,
  kind          text not null default '',
  language      text not null check (language in ('cs', 'en')),
  version       text not null default '',
  valid_date    date,
  publisher     text not null default '',
  url           text not null default '' check (url = '' or url ~ '^https?://'),
  group_key     text not null,
  jurisdiction  text not null default 'other' check (jurisdiction in ('eu', 'cz', 'international', 'other')),
  document_type text not null default 'other' check (document_type in ('regulation', 'directive', 'law', 'decree', 'guidance', 'standard', 'other')),
  topics        text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

create table if not exists public.units (
  id             text primary key check (length(id) between 2 and 160),
  document_id    text not null references public.documents(id),
  parent_id      text references public.units(id),
  kind           text not null check (kind in ('article', 'paragraph', 'annex', 'rule', 'section', 'chapter', 'part', 'point', 'other')),
  label          text not null check (length(label) between 1 and 240),
  heading        text not null default '' check (length(heading) <= 500),
  body           text not null default '' check (length(body) <= 450000),
  content_blocks jsonb,
  locator        text not null default '' check (length(locator) <= 300),
  text_status    text not null default 'missing' check (text_status in ('missing', 'needs_review', 'verified')),
  source_note    text not null default '',
  sort_order     bigint not null default 0,
  archived       boolean not null default false,
  merged_into    text not null default '',
  verified_at    timestamptz,
  verified_by    uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  check (id <> parent_id)
);
create index if not exists ix_units_doc on public.units(document_id, sort_order);
create index if not exists ix_units_parent on public.units(parent_id);

create table if not exists public.amendments (
  document_id text not null references public.documents(id),
  marker      text not null,
  title       text not null default '',
  kind        text not null default '',
  url         text not null default '',
  primary key (document_id, marker)
);
create table if not exists public.unit_amendments (
  unit_id text not null references public.units(id),
  marker  text not null,
  primary key (unit_id, marker)
);

create table if not exists public.comments (
  id          text primary key,
  unit_id     text not null references public.units(id),
  kind        text not null check (kind in ('explanation', 'warning', 'example', 'definition', 'reference')),
  language    text not null check (language in ('cs', 'en')),
  body        text not null check (length(body) between 1 and 15000),
  status      text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'archived')),
  author      text not null default '' check (length(author) <= 200),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create index if not exists ix_comments_unit on public.comments(unit_id);

create table if not exists public.comment_revisions (
  id              text primary key,
  comment_id      text not null references public.comments(id),
  change_type     text not null check (change_type in ('edit', 'archive', 'restore')),
  kind            text not null,
  language        text not null,
  body            text not null,
  author          text not null default '',
  change_reason   text not null,
  status          text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  base_updated_at timestamptz not null,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  reviewed_at     timestamptz,
  reviewed_by     uuid
);
create unique index if not exists ix_comment_pending_unique on public.comment_revisions(comment_id) where status = 'proposed';

create table if not exists public.comment_history (
  id          bigint generated always as identity primary key,
  comment_id  text not null references public.comments(id),
  event_type  text not null,
  before_json jsonb,
  after_json  jsonb,
  actor       uuid,
  created_at  timestamptz not null default now()
);
create index if not exists ix_comment_history on public.comment_history(comment_id, id);

create table if not exists public.relations (
  id            text primary key,
  source_id     text not null references public.units(id),
  target_id     text not null references public.units(id),
  relation_type text not null check (relation_type in ('guidance', 'references', 'related', 'supplements', 'amends')),
  rationale     text not null check (length(rationale) between 1 and 15000),
  evidence      text not null default '' check (length(evidence) <= 15000),
  status        text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'archived')),
  provenance    text not null default 'manual',
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  unique (source_id, target_id, relation_type),
  check (source_id <> target_id)
);
create index if not exists ix_rel_src on public.relations(source_id);
create index if not exists ix_rel_dst on public.relations(target_id);

create table if not exists public.relation_revisions (
  id              text primary key,
  relation_id     text not null references public.relations(id),
  change_type     text not null check (change_type in ('edit', 'archive')),
  source_id       text not null references public.units(id),
  target_id       text not null references public.units(id),
  relation_type   text not null,
  rationale       text not null,
  evidence        text not null default '',
  change_reason   text not null,
  status          text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  base_updated_at timestamptz not null,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  reviewed_at     timestamptz,
  reviewed_by     uuid
);
create unique index if not exists ix_relation_pending_unique on public.relation_revisions(relation_id) where status = 'proposed';

create table if not exists public.relation_history (
  id          bigint generated always as identity primary key,
  relation_id text not null references public.relations(id),
  event_type  text not null,
  before_json jsonb,
  after_json  jsonb,
  actor       uuid,
  created_at  timestamptz not null default now()
);
create index if not exists ix_relation_history on public.relation_history(relation_id, id);

create table if not exists public.unit_edit_history (
  id          bigint generated always as identity primary key,
  unit_id     text not null references public.units(id),
  event       text not null,
  before_json jsonb,
  after_json  jsonb,
  reason      text not null default '',
  actor       uuid,
  created_at  timestamptz not null default now()
);
create index if not exists ix_unit_edit_history on public.unit_edit_history(unit_id, id);

create table if not exists public.source_files (
  document_id  text primary key references public.documents(id),
  storage_path text not null,
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  filename     text not null,
  mime         text not null default '',
  uploaded_at  timestamptz not null default now(),
  uploaded_by  uuid
);

create table if not exists public.import_log (
  id          bigint generated always as identity primary key,
  document_id text not null references public.documents(id),
  filename    text not null,
  sha256      text not null,
  format      text not null,
  added       integer not null default 0,
  updated     integer not null default 0,
  replaced    integer not null default 0,
  protected   integer not null default 0,
  warnings    jsonb not null default '[]',
  actor       uuid,
  imported_at timestamptz not null default now()
);

create table if not exists public.publications (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  created_by uuid,
  note       text not null default '',
  counts     jsonb not null default '{}',
  data       jsonb not null,
  is_current boolean not null default false
);
create unique index if not exists ix_publication_current on public.publications(is_current) where is_current;

-- ---------------------------------------------------------------- role
create or replace function rq_private.my_role() returns text
language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p
  left join public.student_groups g on g.id = p.group_id
  where p.user_id = auth.uid() and p.active
    and (p.role <> 'student' or (g.active and (g.valid_until is null or g.valid_until >= current_date)))
$$;

create or replace function public.rq_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(rq_private.my_role() in ('owner', 'admin'), false)
$$;

create or replace function public.rq_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(rq_private.my_role() = 'owner', false)
$$;

create or replace function public.rq_is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select rq_private.my_role() is not null
$$;

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['student_groups','profiles','documents','units','amendments','unit_amendments',
    'comments','comment_revisions','comment_history','relations','relation_revisions','relation_history',
    'unit_edit_history','source_files','import_log','publications']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Admini čtou všechna pracovní data (zápis jen přes funkce rq_*).
do $$
declare t text;
begin
  foreach t in array array['student_groups','documents','units','amendments','unit_amendments',
    'comments','comment_revisions','comment_history','relations','relation_revisions','relation_history',
    'unit_edit_history','source_files','import_log','publications']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists admin_read on public.%I', t);
    execute format('create policy admin_read on public.%I for select to authenticated using (public.rq_is_admin())', t);
  end loop;
end $$;

-- Profil: každý vidí svůj, admini všechny.
grant select on public.profiles to authenticated;
drop policy if exists own_or_admin_read on public.profiles;
create policy own_or_admin_read on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.rq_is_admin());

grant execute on function public.rq_is_admin(), public.rq_is_owner(), public.rq_is_member() to authenticated;
revoke execute on function public.rq_is_admin(), public.rq_is_owner(), public.rq_is_member() from public, anon;
