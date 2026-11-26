-- RegulaQuest · Úklid testovacích dat před ostrým startem
-- SMAŽE: dokumenty, části, komentáře, vazby, pojmy, historii, importy, publikace.
-- PONECHÁ: účty (profiles), skupiny studentů, nastavení přihlášení, všechny funkce a migrace.
-- Soubory v úložišti (originals, figures) se SQL smazat nedají – vysypte je ručně v Supabase → Storage.
--
-- Postup: 1) GitHub → Actions → záloha → Run workflow (pro jistotu),
--         2) níže změňte 'NE' na 'ANO, SMAZAT TESTOVACÍ DATA' a spusťte celý soubor v SQL Editoru.

do $$
declare potvrzeni text := 'NE';
begin
  if potvrzeni <> 'ANO, SMAZAT TESTOVACÍ DATA' then
    raise exception 'Nic nesmazáno. Pro smazání změňte v souboru potvrzení na: ANO, SMAZAT TESTOVACÍ DATA';
  end if;
  truncate table public.publications, public.comment_history, public.comment_revisions, public.comments,
                 public.relation_history, public.relation_revisions, public.relations, public.terms,
                 public.unit_amendments, public.amendments, public.unit_edit_history, public.source_files,
                 public.import_log, public.units, public.documents restart identity;
  raise notice 'Hotovo: testovací data smazána. Účty a skupiny zůstaly.';
end $$;

select (select count(*) from public.documents) as dokumenty, (select count(*) from public.units) as casti,
       (select count(*) from public.profiles) as ucty, (select count(*) from public.student_groups) as skupiny;
