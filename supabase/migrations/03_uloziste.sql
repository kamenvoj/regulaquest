-- RegulaQuest · 03 · Úložiště souborů (Supabase Storage)
--  originals: originální dokumenty (HTML, PDF) – jen admini; soubory se nepřepisují ani nemažou.
--  figures:   obrázky z importu a editoru – čtou přihlášení uživatelé (studenti jen v publikovaném obsahu).
insert into storage.buckets (id, name, public) values ('originals', 'originals', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('figures', 'figures', false) on conflict (id) do nothing;

drop policy if exists rq_originals_read on storage.objects;
create policy rq_originals_read on storage.objects for select to authenticated
  using (bucket_id = 'originals' and public.rq_is_admin());
drop policy if exists rq_originals_insert on storage.objects;
create policy rq_originals_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'originals' and public.rq_is_admin());

drop policy if exists rq_figures_read on storage.objects;
create policy rq_figures_read on storage.objects for select to authenticated
  using (bucket_id = 'figures' and public.rq_is_member());
drop policy if exists rq_figures_insert on storage.objects;
create policy rq_figures_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'figures' and public.rq_is_admin());
