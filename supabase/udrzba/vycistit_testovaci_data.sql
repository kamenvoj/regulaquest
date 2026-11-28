-- RegulaQuest · Úklid testovacích dat před ostrým startem
-- SMAŽE: dokumenty, části, komentáře, vazby, pojmy, trasy, řešené případy, historii, importy, publikace.
-- Vyžaduje migrace až po 17_ctecka.sql. Smaže i záložky a postup studentů (odkazují na smazané části).
-- PONECHÁ: účty (profiles), skupiny studentů, nastavení přihlášení, štítky, oblasti (zařazení dokumentů do oblastí se smaže – po importu je nastavte znovu), otázky průvodce, aktuality a jejich zdroje, prezentace (vazby na ustanovení se zruší), užitečné odkazy, všechny funkce a migrace. SMAŽE i připomínky studentů a statistiky využívání z testování.
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
  truncate table public.reader_marks, public.reader_positions, public.reader_progress, public.path_steps, public.paths, public.publications, public.comment_history, public.comment_revisions, public.comments,
                 public.relation_history, public.relation_revisions, public.relations, public.terms,
                 public.unit_amendments, public.amendments, public.unit_edit_history, public.source_files,
                 public.import_log, public.units, public.documents restart identity;
  if to_regclass('public.cases') is not null then
    truncate table public.case_links, public.case_steps, public.cases;
  end if;
  -- Prezentace zůstávají; ruční vazby na smazaná ustanovení se zruší (odkazy uvnitř snímků se ve čtečce nezobrazí, dokud je neopravíte)
  if to_regclass('public.presentation_unit_links') is not null then
    truncate table public.presentation_unit_links;
  end if;
  -- Aktuality zůstávají (nejsou testovací), jen se zruší vazby na smazaná ustanovení
  if to_regclass('public.news_items') is not null then
    update public.news_items set unit_ids = '{}', group_keys = '{}' where unit_ids <> '{}' or group_keys <> '{}';
  end if;
  -- Zařazení dokumentů do oblastí patří ke smazaným dokumentům (nové importy dostanou nové klíče) – po importu zařadit znovu
  if to_regclass('public.document_areas') is not null then
    truncate table public.document_areas;
  end if;
  -- Průchody simulací z testování (scénáře a katalog simulací zůstávají)
  if to_regclass('public.sim_runs') is not null then truncate table public.sim_runs; end if;
  -- Připomínky a statistiky využívání z testování
  if to_regclass('public.feedback') is not null then
    truncate table public.feedback, public.usage_days, public.usage_content, public.usage_search restart identity;
  end if;
  raise notice 'Hotovo: testovací data smazána. Účty a skupiny zůstaly.';
end $$;

select (select count(*) from public.documents) as dokumenty, (select count(*) from public.units) as casti,
       (select count(*) from public.profiles) as ucty, (select count(*) from public.student_groups) as skupiny;
