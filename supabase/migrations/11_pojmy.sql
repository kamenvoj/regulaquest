-- RegulaQuest · 11 · Pojmy z definic (čl. 2) a vrstvy zvýraznění
-- Pojem = bod definičního článku (unit_id + číslo bodu). Definici čtečka bere z aktuálního textu článku.
-- forms = vzory pro vyhledání v textu, jeden na řádek; „*“ na konci slova = libovolná koncovka.
-- Nové druhy zvýraznění: duty (povinnost), deadline (lhůta / číslo), exception (výjimka / podmínka).
-- Lze spustit opakovaně.

create table if not exists public.terms (
  id          text primary key,
  unit_id     text not null references public.units(id),
  number      int not null check (number between 1 and 999),
  source_label text not null default '' check (length(source_label) <= 300),
  name        text not null check (length(name) between 1 and 300),
  forms       text not null default '' check (length(forms) <= 3000),
  language    text not null check (language in ('cs', 'en')),
  status      text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (unit_id, number)
);
alter table public.terms enable row level security;
revoke all on public.terms from anon, authenticated;
grant select on public.terms to authenticated;
drop policy if exists admin_read on public.terms;
create policy admin_read on public.terms for select to authenticated using (public.rq_is_admin());

alter table public.comments drop constraint if exists comments_kind_check;
alter table public.comments add constraint comments_kind_check
  check (kind in ('explanation', 'warning', 'example', 'definition', 'reference', 'key', 'duty', 'deadline', 'exception'));
alter table public.comments drop constraint if exists comments_anchor_check;
alter table public.comments add constraint comments_anchor_check
  check (length(anchor_text) <= 1000 and anchor_occurrence between 1 and 500
         and (kind not in ('key', 'duty', 'deadline', 'exception') or anchor_text <> ''));

create or replace function public.rq_new_comment(p_unit_id text, p_kind text, p_language text, p_body text,
  p_author text default '', p_translated_from text default '', p_anchor_text text default '', p_anchor_occurrence int default 1)
returns text
language plpgsql security definer set search_path = public as $$
declare v_id text := rq_private.token('comment'); u public.units := rq_private.unit_row(p_unit_id); src public.comments;
        v_anchor text := btrim(regexp_replace(coalesce(p_anchor_text, ''), '\s+', ' ', 'g'));
        v_body text := btrim(coalesce(p_body, ''));
begin
  perform rq_private.require_admin();
  if u.archived then raise exception 'K archivované části nelze přidat komentář'; end if;
  if p_kind in ('key', 'duty', 'deadline', 'exception') and v_anchor = '' then raise exception 'Zvýraznění musí mít vybraný text'; end if;
  if v_body = '' then v_body := case p_kind when 'key' then 'Klíčová pasáž' when 'duty' then 'Povinnost'
                                     when 'deadline' then 'Lhůta / číslo' when 'exception' then 'Výjimka / podmínka' else '' end; end if;
  if v_anchor <> '' and position(v_anchor in regexp_replace(coalesce(u.body, '') || ' ' || regexp_replace(coalesce(u.content_blocks::text, ''), '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')) = 0 then
    raise exception 'Vybraný text v ustanovení nebyl nalezen. Načtěte aktuální znění a vyberte ho znovu.';
  end if;
  if coalesce(p_translated_from, '') <> '' then
    select * into src from public.comments where id = p_translated_from;
    if not found then raise exception 'Původní komentář nebyl nalezen'; end if;
  end if;
  insert into public.comments(id, unit_id, kind, language, body, author, created_by, updated_by, translated_from, source_body,
                              anchor_text, anchor_occurrence)
  values (v_id, p_unit_id, p_kind, p_language, v_body, btrim(coalesce(p_author, '')), auth.uid(), auth.uid(),
          coalesce(src.id, ''), coalesce(src.body, ''), v_anchor, greatest(1, coalesce(p_anchor_occurrence, 1)));
  perform rq_private.log_comment(v_id, 'created', null, to_jsonb(rq_private.comment_row(v_id)));
  return v_id;
end $$;

create or replace function public.rq_propose_comment_revision(p_id text, p_change_type text, p_reason text,
  p_kind text default null, p_language text default null, p_body text default null, p_author text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.comments := rq_private.comment_row(p_id); v_rev text := rq_private.token('crev');
        k text; l text; b text; a text;
begin
  perform rq_private.require_admin();
  if p_change_type not in ('edit', 'archive', 'restore') then raise exception 'Neplatný druh změny'; end if;
  if p_change_type in ('edit', 'archive') and c.status <> 'approved' then raise exception 'Upravovat nebo archivovat lze jen schválený komentář'; end if;
  if p_change_type = 'restore' and (c.status <> 'archived' or not rq_private.comment_was_approved(p_id)) then
    raise exception 'Takto lze obnovit pouze dříve schválený komentář';
  end if;
  if coalesce(btrim(p_reason), '') = '' or length(p_reason) > 3000 then raise exception 'Uveďte důvod změny do 3000 znaků'; end if;
  if p_change_type = 'edit' then
    k := coalesce(p_kind, c.kind); l := coalesce(p_language, c.language);
    b := btrim(coalesce(p_body, c.body)); a := btrim(coalesce(p_author, c.author));
    if (k, l, b, a) = (c.kind, c.language, c.body, c.author) then raise exception 'Obsah komentáře se nezměnil'; end if;
    if k not in ('explanation', 'warning', 'example', 'definition', 'reference', 'key', 'duty', 'deadline', 'exception') or l not in ('cs', 'en')
       or b = '' or length(b) > 15000 or length(a) > 200 then raise exception 'Neplatný obsah komentáře'; end if;
  else
    k := c.kind; l := c.language; b := c.body; a := c.author;
  end if;
  insert into public.comment_revisions(id, comment_id, change_type, kind, language, body, author, change_reason, base_updated_at, created_by)
  values (v_rev, p_id, p_change_type, k, l, b, a, btrim(p_reason), c.updated_at, auth.uid());
  perform rq_private.log_comment(p_id, 'revision_proposed', to_jsonb(c), to_jsonb(c));
  return v_rev;
exception when unique_violation then
  raise exception 'U komentáře už čeká návrh změny';
end $$;

-- Načtení pojmů z definičního článku: nové body se přidají jako koncept, upravené (název, vzory) zůstanou.
create or replace function public.rq_import_terms(p_unit_id text, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare u public.units := rq_private.unit_row(p_unit_id); x jsonb; n int := 0; v_lang text;
begin
  perform rq_private.require_admin();
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Neplatný seznam pojmů'; end if;
  select language into v_lang from public.documents where id = u.document_id;
  for x in select * from jsonb_array_elements(p_items) loop
    if exists (select 1 from public.terms where unit_id = p_unit_id and number = (x->>'number')::int) then
      update public.terms set source_label = left(coalesce(x->>'source_label', ''), 300)
        where unit_id = p_unit_id and number = (x->>'number')::int and source_label is distinct from left(coalesce(x->>'source_label', ''), 300);
    else
      insert into public.terms(id, unit_id, number, source_label, name, forms, language, created_by, updated_by)
      values (rq_private.token('term'), p_unit_id, (x->>'number')::int, left(coalesce(x->>'source_label', ''), 300),
              left(btrim(x->>'name'), 300), left(coalesce(x->>'forms', ''), 3000), v_lang, auth.uid(), auth.uid());
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.rq_edit_term(p_id text, p_name text, p_forms text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  update public.terms set name = btrim(p_name), forms = btrim(coalesce(p_forms, '')), updated_at = now(), updated_by = auth.uid()
   where id = p_id;
  if not found then raise exception 'Pojem nebyl nalezen'; end if;
end $$;

create or replace function public.rq_term_status(p_ids jsonb, p_status text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform rq_private.require_admin();
  if p_status not in ('draft', 'approved', 'archived') then raise exception 'Neplatný stav'; end if;
  update public.terms set status = p_status, updated_at = now(), updated_by = auth.uid()
   where id in (select jsonb_array_elements_text(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function rq_private.reader_data(p_draft boolean) returns jsonb
language sql stable set search_path = public as $$
  with recursive live as (select * from public.units where not archived),
  good as (select id from live where btrim(body) <> '' and (p_draft or text_status = 'verified')),
  anc as (
    select l.parent_id as id from live l join good g on g.id = l.id where l.parent_id is not null
    union
    select l.parent_id from live l join anc a on a.id = l.id where l.parent_id is not null),
  included as (select id from good union select a.id from anc a join live l on l.id = a.id),
  u as (
    select l.*, (l.id not in (select id from good)) as nav from live l where l.id in (select id from included)),
  docs as (select * from public.documents where id in (select document_id from u)),
  rel as (select * from public.relations where status = any(case when p_draft then array['approved','proposed'] else array['approved'] end)
          and source_id in (select id from good) and target_id in (select id from good)),
  com as (select * from public.comments where status = any(case when p_draft then array['approved','draft'] else array['approved'] end)
          and unit_id in (select id from good)),
  trm as (select * from public.terms where status = any(case when p_draft then array['approved','draft'] else array['approved'] end)
          and unit_id in (select id from good))
  select jsonb_build_object(
    'format', 'regulaquest-education-v1',
    'mode', case when p_draft then 'draft' else 'published' end,
    'published_at', now(),
    'notice', 'Legislativní texty jsou informační kopií. Ověřujte aktuální oficiální znění a právní závaznost zdrojů.',
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'family', family, 'kind', kind,
        'language', language, 'version', version, 'valid_date', valid_date, 'publisher', publisher, 'url', url,
        'group_key', group_key, 'jurisdiction', jurisdiction, 'document_type', document_type, 'topics', topics) order by id) from docs), '[]'),
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'document_id', document_id, 'parent_id', parent_id,
        'kind', kind, 'label', label,
        'heading', heading,
        'body', case when nav then '' else body end,
        'content_blocks', case when nav then null else content_blocks end,
        'locator', locator,
        'text_status', case when nav then 'navigation_only' else text_status end,
        'sort_order', sort_order, 'navigation_only', nav) order by document_id, sort_order, id) from u), '[]'),
    'relations', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'source_id', source_id, 'target_id', target_id,
        'relation_type', relation_type, 'rationale', rationale, 'status', status) order by id) from rel), '[]'),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'unit_id', unit_id, 'kind', kind, 'language', language,
        'body', body, 'author', author, 'status', status, 'updated_at', updated_at,
        'anchor_text', anchor_text, 'anchor_occurrence', anchor_occurrence) order by id) from com), '[]'),
    'terms', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'unit_id', unit_id, 'number', number, 'name', name,
        'forms', forms, 'language', language, 'status', status) order by unit_id, number) from trm), '[]'),
    'counts', jsonb_build_object('documents', (select count(*) from docs), 'units', (select count(*) from u),
        'verified_units', (select count(*) from good), 'navigation_units', (select count(*) from u where nav),
        'relations', (select count(*) from rel), 'comments', (select count(*) from com)))
$$;

create or replace function public.rq_studio_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform rq_private.require_admin();
  return jsonb_build_object(
    'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at, d.id) from public.documents d), '[]'),
    'units', coalesce((select jsonb_agg(to_jsonb(u) || jsonb_build_object('editor_archived', u.archived)
                       order by u.document_id, u.sort_order, u.id) from public.units u), '[]'),
    'comments', coalesce((select jsonb_agg(to_jsonb(c) order by c.updated_at desc) from public.comments c), '[]'),
    'relations', coalesce((select jsonb_agg(to_jsonb(r) order by r.updated_at desc) from public.relations r), '[]'),
    'terms', coalesce((select jsonb_agg(to_jsonb(t) order by t.unit_id, t.number) from public.terms t), '[]'),
    'amendments', coalesce((select jsonb_agg(to_jsonb(a) order by a.document_id, a.marker) from public.amendments a), '[]'),
    'unit_amendments', coalesce((select jsonb_agg(to_jsonb(a) order by a.unit_id, a.marker) from public.unit_amendments a), '[]'),
    'imports', coalesce((select jsonb_agg(to_jsonb(i) order by i.id desc) from (select * from public.import_log order by id desc limit 20) i), '[]'),
    'source_files', coalesce((select jsonb_agg(to_jsonb(s) order by s.document_id) from public.source_files s), '[]'),
    'relation_revisions', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from public.relation_revisions r), '[]'),
    'relation_history', coalesce((select jsonb_agg(to_jsonb(h) order by h.id desc) from public.relation_history h), '[]'),
    'comment_revisions', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from public.comment_revisions r), '[]'),
    'comment_history', coalesce((select jsonb_agg(to_jsonb(h) order by h.id desc) from public.comment_history h), '[]'),
    'unit_edit_history', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'unit_id', h.unit_id, 'event', h.event,
        'reason', h.reason, 'actor', h.actor, 'created_at', h.created_at) order by h.id desc)
        from (select * from public.unit_edit_history order by id desc limit 250) h), '[]'),
    'people', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'username', p.username,
        'display_name', p.display_name, 'role', p.role)) from public.profiles p where p.role in ('owner', 'admin')), '[]'),
    'publication', (select jsonb_build_object('id', id, 'created_at', created_at, 'note', note, 'counts', counts)
        from public.publications where is_current),
    'counts', jsonb_build_object(
      'documents', (select count(*) from public.documents),
      'units', (select count(*) from public.units where not archived),
      'verified', (select count(*) from public.units where not archived and text_status = 'verified' and btrim(body) <> ''),
      'proposed', (select count(*) from public.relations where status = 'proposed'),
      'approved_links', (select count(*) from public.relations where status = 'approved'),
      'approved_comments', (select count(*) from public.comments where status = 'approved'),
      'proposed_revisions', (select count(*) from public.relation_revisions where status = 'proposed'),
      'comment_revisions_pending', (select count(*) from public.comment_revisions where status = 'proposed')));
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
    'student_groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.student_groups x));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.rq_import_terms(text, jsonb)', 'public.rq_edit_term(text, text, text)', 'public.rq_term_status(jsonb, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.rq_new_comment(text, text, text, text, text, text, text, int) from public, anon;
grant execute on function public.rq_new_comment(text, text, text, text, text, text, text, int) to authenticated;
