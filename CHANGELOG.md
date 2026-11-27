# Změny

## 0.35.1 – 2026-11-27 · O aplikaci
- Čtečka: v horní liště tlačítko „O aplikaci“ (#/o-aplikaci) – účel, výukový obsah, zdroje a závaznost textů,
  využití AI při vývoji, omezení, připomínky a soukromí, institucionální zázemí.

## 0.35.0 – 2026-11-27 · Připomínky studentů a přehled využívání
- Čtečka – tlačítko „⚑ Nahlásit chybu / nejasnost“ u ustanovení, snímku prezentace, řešeného případu a trasy
  (typ: chyba / nejasnost / návrh). Připomínka se ukládá bez vazby na účet; student je upozorněn, ať se nepodepisuje.
- Studio – nová stránka Připomínky studentů (nové / vyřešené, poznámka redakce, odkaz na místo v pracovním náhledu),
  počet nových v levém panelu.
- Čtečka – souhrnné měření využívání: čas (jen při otevřené kartě a aktivitě), návštěvy, co se otevírá a co se hledá
  (hledaný výraz až po 3 s bez psaní). Admini se nezaznamenávají.
- Studio – nová stránka Využívání: filtr skupina (nebo všechny) a období; kolik studentů čtečku použilo („10 z 15“),
  návštěvy, čas, typický čas a četnost návštěv na studenta (jen při ≥ 5 aktivních), aktivita po dnech a dnech v týdnu,
  co otevírali, oblasti, nejčtenější části, nejčastěji hledané a hledání bez výsledku. Nikdy po jednotlivých účtech.
- Denní záznamy „účet × den“ (jen čas a počet návštěv) se po 13 měsících mažou (pg_cron); co se čte a hledá, je bez vazby na účet.
- Nápověda ve čtečce (Připomínky a soukromí) i ve Studiu. Úklid testovacích dat maže i připomínky a statistiky.
- Migrace 26_vyuziti.sql.

## 0.34.0 – 2026-11-27 · Hledání napříč obsahem
- Čtečka – hledání nahoře prohledává i snímky prezentací (nadpisy a texty, bez poznámek řečníka), řešené případy,
  užitečné odkazy a aktuality.
- Čtečka – Najít předpisy vrací i prezentace (podle oblasti a štítků prezentace, odkazů snímků na nalezená ustanovení
  a slova v textu snímků); výsledek vede rovnou na odpovídající snímek.
- Čtečka – pojmy z definic jsou podtržené i ve snímcích; klepnutím se definice ukáže v rámečku pod snímkem
  (funguje i na celé obrazovce).
- Čtečka – Co je nového: nové řešené případy v přehledu publikace a seznam prezentací zpřístupněných za posledních 60 dní.
- Čtečka – „přečtené aktuality“ se pamatují u účtu (ne jen v prohlížeči), takže značka nových aktualit platí i na jiném počítači.
- Studio – u části textu jsou aktuality, řešené případy a prezentace v jednom rozbalovacím řádku „Souvisí“ se souhrnem počtů.
- Studio – Publikování: přehled, co jde přes publikaci a co se ukáže hned, a upozornění na zveřejněné případy a připravené
  prezentace, které odkazují na neověřené části (studenti je neotevřou). Hlášení po publikaci uvádí i nové případy.
- Migrace 25_hledani_obsah.sql.

## 0.33.0 – 2026-11-27 · Kontrola návazností před čistým importem
- Smazání dokumentu uklidí i odkazy z výukových částí na jeho ustanovení (kroky a vazby řešených případů – text kroku zůstane,
  ruční vazby prezentací, odkazy aktualit); když ve skupině jazykových verzí nezůstane žádný dokument, zruší se i její zařazení do oblastí.
- Zpřístupnění prezentací podle českého data (dříve UTC – po půlnoci mohla být prezentace hodinu „ještě skrytá“).
- Úklid testovacích dat: smaže i zařazení dokumentů do oblastí a odkazy aktualit na dokumenty – po čistém importu dostanou
  dokumenty nové klíče, takže by staré zařazení stejně nefungovalo. Po importu je potřeba dokumenty do oblastí zařadit znovu.
- Migrace 24_udrzba.sql.

## 0.32.0 – 2026-11-27 · Před pilotem
- Čtečka: na telefonu upozornění „Čtečka je určená hlavně pro počítač…“ s tlačítkem Rozumím (zobrazí se jednou, pamatuje si ho prohlížeč).
- Studio → Pokrytí: kromě jednoho dokumentu lze zvolit **celou oblast** (všechny zařazené dokumenty, z každé jazykové verze jeden);
  filtry včetně „Bez štítků“ pak platí napříč oblastí, u řádků je zkratka dokumentu.

## 0.31.1 – 2026-11-27
- Přehled pro studenty: dlaždice Najít předpisy vypadá stejně jako ostatní (bez tmavého zvýraznění a tlačítek).

## 0.31.0 – 2026-11-27 · Nový Přehled pro studenty
- **Pokračovat:** čtení, rozpracovaná trasa a nově i prezentace (poslední snímek se ukládá k účtu – bez migrace, stejným
  způsobem jako místo ve čtení).
- **Rozcestník:** osm dlaždic (Dokumenty, Najít předpisy s průvodcem otázkami, Prezentace, Trasy, Řešené případy, Aktuality,
  Odkazy, Pojmy) s počty a novinkami (nové prezentace, nové aktuality, rozpracované trasy).
- **Moje záložky** (posledních pět) a **Nové pro vás** (souhrn poslední aktualizace, nové prezentace, nejnovější aktuality).
- **Procházet podle oblasti** otevře Najít předpisy s vybranou oblastí; dokumenty kompaktně (připnuté, doporučené, naposledy otevřené).
- Nápověda k Přehledu aktualizovaná.
- Oprava: Najít předpisy ukazovalo řešené případy i tehdy, když zadané slovo neobsahovaly.

## 0.30.0 – 2026-11-27 · Přehled Studia doplněný o výuku
- Přehled Studia: nová karta **Výuka** – nové aktuality k přečtení, prezentace (připravené a které brzy uvidí studenti),
  rozpracované řešené případy, koncepty odkazů a počet úprav od poslední publikace, které studenti ještě nevidí.
- Rychlé cesty doplněné o Prezentace, Řešené případy, Aktuality a Užitečné odkazy.
- Poslední aktivita zahrnuje i úpravy případů a prezentací a zveřejněné aktuality a odkazy.
- Nápověda: aktualizované úvodní sekce ve Studiu i ve čtečce (nové části, rozcestník, aktuality na Přehledu).

## 0.29.0 – 2026-11-27 · Prezentace
- **Studio – Výuka → Prezentace** (samostatně od dokumentů): import z PowerPointu přímo v prohlížeči – převezme nadpisy, sekce,
  štítky (DISKUZE), karty, pruhy, otázky, tabulky, klíčovou myšlenku a poznámky řečníka. Vzhled dělá jednotná šablona ve stylu
  aplikace, takže prezentace všech autorů vypadají stejně.
- Editor snímků: náhled, formulář (typ snímku, sekce, štítek, nadpis, bloky textu / pruhů / otázek / karet / tabulek, klíčová
  myšlenka, poznámky), přidání, duplikace, posun a mazání snímků. **Odkazy** se nastaví klepnutím na část snímku v náhledu:
  na ustanovení nebo na jiný snímek téže či jiné prezentace (odstavec, karta, pruh, řádek tabulky, klíčová myšlenka, nadpis).
- **Nová verze z PowerPointu** bez duplicit: snímky se spárují podle nadpisu a sekce (případně pořadí), ponechají si identitu,
  odkazy se přenesou na stejné části; před nahráním přehled změn, nepřenesených odkazů a odkazů na odstraněné snímky.
- Zpřístupnění: stav Koncept / Připravená / Archivovaná a skupiny studentů s datem, od kdy prezentaci vidí.
- V textu dokumentu řádek „Prezentace“ (odkazy ze snímků + ruční připojení snímku nebo celé prezentace).
- **Čtečka – Prezentace:** seznam zpřístupněných prezentací, prohlížení snímků (šipky a klávesy, celá obrazovka F, přehled snímků),
  klikací odkazy s lištou „Zpět na prezentaci“ / „Zpět na snímek“, u ustanovení v Souvislostech „V prezentacích“.
  Poznámky řečníka vidí jen redakce. Obrázky ve snímcích se doplní po zapojení úložiště (Cloudflare R2).
- Migrace 23_prezentace.sql. Úklid testovacích dat prezentace ponechá (zruší jen ruční vazby na ustanovení).

## 0.28.0 – 2026-11-27 · Užitečné odkazy
- **Studio – Výuka → Užitečné odkazy:** název, adresa, krátký popisek, kategorie (Úřady a instituce, Databáze a registry,
  Legislativa, Metodiky a pokyny, Normy, Ostatní – lze napsat i vlastní), oblasti, štítky, stav koncept / zveřejněný,
  pořadí v kategorii. Výchozí sada jako koncepty: SÚKL, ČMI, EUDAMED, EUR-Lex, e-Sbírka, pokyny MDCG, ÚNMZ.
- **Čtečka – Odkazy:** karty podle kategorií s filtrem kategorie a oblasti a hledáním; doména u každého odkazu,
  tlačítko „Otevřít ↗“ (nové okno), celá adresa po rozkliknutí. Zveřejněné odkazy jsou vidět hned (bez publikace).
- Migrace 22_odkazy.sql. Úklid testovacích dat odkazy ponechá.

## 0.27.0 – 2026-11-27 · Řešené případy
- **Studio – Výuka → Řešené případy:** případ = název, krátký popis, zadání, kroky, závěr, stav (koncept / zveřejněný /
  archivovaný), oblasti a štítky. Kroky s textem a odkazem na ustanovení (hledání podle označení a nadpisu), pořadí šipkami.
  Jednoduchý formát textu: odstavce, odrážky „- “, tabulky „| a | b |“. Propojená ustanovení a náhled ve čtečce.
- V textu dokumentu pod nadpisem řádek „Případy“ s „+ Případ“ (propojení s existujícím případem).
- **Čtečka:** položka Řešené případy (seznam s filtrem oblasti), stránka případu (zadání, číslovaný postup, závěr, související
  ustanovení), u kroku „Číst v předpisu“ a nad ustanovením lišta „Zpět na řešený případ“; u ustanovení v Souvislostech odkaz;
  případy i ve výsledcích Najít předpisy. Studenti vidí zveřejněné případy po publikaci.
- Migrace 21_pripady.sql. Úklid testovacích dat smaže i případy.

## 0.26.0 – 2026-11-27 · Řazení a stránkování aktualit
- Studio → Aktuality: řazení (nejnovější / nejstarší nahoře), počet na stránku (10 / 25 / 50 / vše – pamatuje si prohlížeč)
  a stránkování dole. „Vybrat“ a hromadné akce platí jen pro aktuální stránku.
- Čtečka → Aktuality: po 10 na stránku se stránkováním.

## 0.25.0 – 2026-11-27 · Aktuality
- **Studio – Výuka → Aktuality:** novinky ze zdrojů RSS/Atom (výchozí: SÚKL – Aktuality ZP, Evropská komise – Medical devices:
  latest updates) a ručně přidané odkazy (EUDAMED, MDCG, MZ ČR…). Stavy Nové / Přečtené / Zveřejněné / Zamítnuté, filtr podle
  zdroje a oblasti, hledání, hromadné akce. Úprava: komentář redakce pro studenty, oblasti, štítky, dokumenty a ustanovení.
  Správa zdrojů (adresa, oblasti, zapnutí, stav posledního načtení). Odznak s počtem nových v levém panelu.
- Propojení z textu dokumentu: pod nadpisem ustanovení řádek „Aktuality“ s tlačítkem „+ Aktualita“.
- Načítání přímo v Supabase (pg_net + pg_cron, 5:50 a 13:50 UTC) nebo tlačítkem „Načíst nové“. Ukládá se jen název,
  výtah a odkaz. Nevyřízené po 90 dnech mezi zamítnuté, zamítnuté po roce smazány.
- **Čtečka – Aktuality:** zveřejněné hned (bez publikace obsahu), filtr podle oblasti a zdroje, hledání, řazení, komentář
  redakce, odkazy na dokumenty a ustanovení; počet nových od poslední návštěvy v navigaci; nejnovější tři na Přehledu;
  u propojených ustanovení v Souvislostech.
- Migrace 20_aktuality.sql. Úklid testovacích dat aktuality ponechá (zruší jen vazby na ustanovení).

## 0.24.0 – 2026-11-27 · Osnova ve vlastním panelu
- Čtečka: při čtení dokumentu nebo trasy se hlavní navigace zúží na pruh ikon (název po najetí myší, počet záložek
  jako odznak) a osnova dokumentu / kroky trasy mají vlastní panel s vlastním posuvníkem. Trasy a ostatní stránky jsou tak
  vždy na jedno klepnutí.
- Osnovu lze skrýt (« v panelu, zpět ikonou osnovy v pruhu; pamatuje si to prohlížeč), tlačítko » rozbalí navigaci s popisky.
- Na stránkách bez dokumentu (Přehled, Najít předpisy, Trasy…) zůstává navigace s popisky. Na telefonu je osnova pod
  navigací v záložce Menu.

## 0.23.0 – 2026-11-27 · Najít předpisy a průvodce otázkami
- **Čtečka – Najít předpisy** (levý panel, odkaz i z Přehledu): pole Oblast, skupiny štítků (Koho se týká, Třída rizika, Typ…),
  další upřesnění (druh dokumentu, původ, téma) a slovo v textu. Výsledky hned: dokumenty seřazené podle shody s důvodem
  („hlavní předpis · Zdravotnické prostředky“, „3 odpovídající ustanovení“), zvlášť předpisy pro specifické situace s „kdy“,
  konkrétní ustanovení podle počtu shodných štítků a trasy k tématu. Výběr je v adrese – odkaz lze zkopírovat a poslat.
- **Čtečka – Průvodce otázkami:** pro konkrétní situaci; otázky se větví podle oblastí z dřívějších odpovědí, na konci se otevře
  vyhledávač s předvyplněným výběrem (lze dál upravit, „Upravit odpovědi“, „Začít znovu“).
- Obojí je obecné: pole = skupiny štítků (u skupiny se nastaví, pro které oblasti platí), otázky a odpovědi definuje redakce.
- **Studio – Výuka → Vyhledávání a průvodce:** otázky (přidat, upravit, pořadí, vyřadit, smazat; odpověď přidá oblasti a štítky;
  otázka jen u zvolených oblastí), oblasti pro pole vyhledávače, odkazy do pracovního náhledu. Výchozí ukázková sada pěti otázek.
- Migrace 19_hledani.sql (tag_groups.area_keys, guide_questions). Úklid testovacích dat otázky průvodce ponechá.

## 0.22.0 – 2026-11-27 · Oblasti
- **Oblasti** (stejné pro všechny studenty): Zdravotnické prostředky, Metrologie, Zdroje ionizujícího záření, Poskytování zdravotní péče,
  Veřejné zakázky, Úhrady, Ochrana osobních údajů, Kyberbezpečnost, Regulace AI, Léčivé přípravky, Ochrana průmyslového vlastnictví.
  Ve Studiu Katalog → „Spravovat oblasti…“ (přidat, přejmenovat, popis, vyřadit).
- Dokument (všechny jazykové verze) může být ve více oblastech, v každé s rolí: hlavní předpis, metodika / výklad, doplňkový,
  pro specifické situace (s poznámkou, kdy je relevantní). Zařazení v „Údaje dokumentu“; váže se na skupinu dokumentu, takže
  přežije úklid testovacích dat i nový import.
- Katalog ve Studiu: filtr Oblast (i „Bez oblasti“), štítky oblastí u dokumentů.
- Čtečka: přepínač oblastí na Přehledu a v Dokumentech; stránka oblasti rozdělená na hlavní předpisy, metodiky, doplňkové
  a „Pro specifické situace“ (s „Kdy: …“); u dokumentu jeho oblasti a role. Zvolená oblast se pamatuje v prohlížeči.
- Migrace 18_oblasti.sql.

## 0.21.0 – 2026-11-27 · Nová čtečka pro studenty
- Rozložení: hlavní navigace vlevo (Přehled, Dokumenty s osnovou otevřeného dokumentu, Trasy s kroky, Pojmy, Záložky, Co je nového,
  Značky a nápověda), hledání v horní liště, panel Souvislosti jen při čtení ustanovení. Nápověda v bočním panelu (? Nápověda).
- **Přehled:** stav obsahu (datum poslední aktualizace a souhrn), Pokračovat ve čtení, rozpracovaná trasa, dokumenty
  (připnuté ☆, doporučené redakcí, naposledy otevřené; jazykové verze na jedné kartě), trasy, moje záložky.
- **Dokumenty:** všechny dokumenty s hledáním a filtrem předpisy / metodiky; v osnově přepínač CS / EN (na stejné místo) a filtr štítků.
- **Co je nového:** shrnutí redakce + seznam změn, který se spočítá sám při publikaci (nové výklady, vazby, změněná a nově zveřejněná
  ustanovení, nové trasy); značka NOVÉ v osnově 14 dní, upozornění „nové“ v menu.
- **Pojmy:** slovník definic CS / EN s hledáním a odkazem na místo v předpisu.
- **Hledání** ve všech dokumentech: texty, výklady redakce i pojmy.
- **Záložky s popiskem, poslední pozice v dokumentech a prošlé kroky tras se ukládají k účtu** (vidí je jen student; mažou se s účtem).
- Studio: u dokumentu „Krátký název pro studenty“ a „Doporučit studentům“ (s pořadím); poznámka k publikaci = shrnutí pro „Co je nového“;
  po publikaci Studio ukáže souhrn změn.
- Migrace 17_ctecka.sql. Úklidový skript maže i záložky a postup studentů.

## 0.20.0 – 2026-11-27 · Moje dokumenty, katalog po skupinách, kontrast
- Přehled: místo úplného seznamu **Moje dokumenty** – připnuté (☆/★, každý admin sám, v prohlížeči) a 5 naposledy upravovaných;
  rychlé hledání (Enter otevře katalog s výsledkem) a odkaz „Všech N dokumentů v katalogu“.
- Jazykové verze jednoho dokumentu (CS/EN) jsou v jednom řádku, každá se svým postupem ověřování – na Přehledu i v katalogu.
- Katalog: nový filtr **Stav** (připnuté, nezačaté, rozpracované, hotové); údaje každé jazykové verze přes „Údaje CS / EN“.
- Tmavší drobný šedý text (kontrast ≥ 4,5 : 1) ve Studiu i čtečce; nadpisy stránek sjednoceny podle sekcí levého panelu.

## 0.19.0 – 2026-11-27 · Úvodní stránka a nápověda
- Přehled Studia: **Pokračovat, kde jsem skončil** (poslední otevřené ustanovení v tomto prohlížeči, počet vlastních konceptů),
  **Rychlé cesty** a **Poslední aktivita** (kdo co udělal a kde – z existující historie, bez nových dat v databázi).
- Horní lišta: **? Nápověda** – postranní panel s návodem ke všem částem Studia, otevírá se u části, kde právě pracujete.

## 0.18.0 – 2026-11-27 · Přehled pokrytí
- Nová stránka **Pokrytí** (Redakce): tabulka článků / příloh / pravidel vybraného dokumentu včetně jejich odstavců –
  ověřený text, štítky, výklady, zvýraznění, vazby, vazby na metodiku (MDCG), kroky tras. Souhrn nahoře, filtry
  (neověřený text, bez štítků, bez výkladu, bez vazeb, bez metodiky, zatím nic), řazení „nejméně zpracované nahoře“; klepnutím se část otevře.

## 0.17.0 – 2026-11-27 · Trasy
- Nová stránka **Trasy** ve Studiu: seřazené průchody předpisy a metodikami s komentářem ke každému kroku.
  Krok = celé ustanovení („⇢ Do trasy“ pod textem), konkrétní místo v textu (lišta výběru → „⇢ Do trasy“) nebo samostatný text (úvod, shrnutí).
  Pořadí šipkami, stav koncept / zveřejněná / archivovaná, náhled ve čtečce.
- Čtečka: přepínač **Osnova | Trasy** v levém panelu, karty tras na úvodní stránce; průchod krok za krokem s komentářem,
  zvýrazněným místem v textu a tlačítky Zpět / Další krok. Prohlížeč si pamatuje prošlé kroky (✓, ukazatel postupu).
- Zveřejněné trasy se studentům ukážou po publikaci; kroky na neověřená ustanovení se vynechají.
- Úklidový skript maže i trasy. Migrace 16_trasy.sql.

## 0.16.0 – 2026-11-27 · Archivace a smazání dokumentu
- Katalog → „Upravit údaje a tagy“ → **Archivovat dokument** (skryje v katalogu a od příští publikace ve čtečce; obnovit lze na úvodní stránce
  v „Archivované dokumenty“) nebo **Smazat dokument trvale…** (jen nepublikovaný dokument bez schválených komentářů, vazeb a pojmů;
  potvrzení opsáním názvu; smaže i soubory v úložišti).
- Migrace 15_dokumenty.sql.

## 0.15.0 – 2026-11-26 · Štítky a úklid testovacích dat
- Štítky u částí: obecný slovník skupin a štítků spravovaný ve Studiu („+ Štítek“ → „Spravovat štítky…“), použitelný i pro jiné předpisy.
  Předvyplněno pro ZP: Koho se týká (výrobce, dovozce, oznámený subjekt …), Třída rizika (I, Is, Im, Ir, IIa, IIb, III),
  Typ prostředku (implantabilní, invazivní, aktivní, software …). Štítek se zrcadlí do druhé jazykové verze; import ho nemění.
- Čtečka: výběr „Jen: …“ pod hledáním zúží osnovu na ustanovení se štítkem (včetně nadřazených a podřazených částí);
  u ustanovení je řádek „Štítky“.
- `supabase/udrzba/vycistit_testovaci_data.sql`: smaže dokumenty, části, komentáře, vazby, pojmy, historii a publikace;
  ponechá účty, skupiny a slovník štítků. Vyžaduje ruční potvrzení v souboru.
- Migrace 14_stitky.sql.

## 0.14.0 – 2026-11-26 · Zaměření z bočního panelu
- Klepnutím na položku v panelu Souvislosti (čtečka) nebo Naše komentáře / Propojené pasáže (Studio) se v textu výrazně označí
  jen tato položka (tmavý rámeček), ostatní značky se ztlumí. Funguje i tehdy, když je její vrstva vypnutá.
- Nad textem štítek „Zvýrazněno jen: …“ s tlačítkem „Zobrazit vše ✕“; opětovné klepnutí na kartu zaměření zruší.

## 0.13.0 – 2026-11-26 · Přepínače vrstev ve Studiu, více položek na jednom místě
- Studio má nad textem stejnou řadu přepínačů jako čtečka: Klíčové, Povinnosti, Lhůty, Výjimky, Poznámky, Pozor, Odkazy, Pojmy
  (jen ty, které v části jsou, s počtem). Volba se pamatuje v prohlížeči; ve Studiu je výchozí vše zapnuté.
- Čtečka nově přepíná i Poznámky, Pozor a Odkazy.
- Když na stejném místě končí víc položek (např. výklad + pozor + odkaz), je v textu jedna společná značka s ikonami a počtem.
  Po klepnutí se ukážou všechny v pevném pořadí: pozor → definice → výklad → příklad → odkazy (ve Studiu přehled s tlačítky na detail).
- Spolehlivější hledání kotev v textu, který už obsahuje jiné značky.

## 0.12.0 – 2026-11-26 · Pojmy CS ↔ EN, úpravy pojmů, přichycená lišta
- Pojmy se s jinou jazykovou verzí párují samy podle čísla bodu definice; v seznamu i v definici se ukazuje protějšek („EN: medical device“).
- V okně Pojmy z definic tlačítko „Přepnout na EN/CS“ a „Smazat vybrané“ (koncepty a vyřazené; migrace 13_pojmy_mazani.sql).
- Ve Studiu má definice po klepnutí na pojem tlačítko „Upravit pojem“ – otevře seznam pojmů rovnou s tímto pojmem.
- Lišta tlačítek pod textem (Editor, Struktura, …, Pojmy z definic) zůstává při posouvání dlouhého textu viditelná dole v panelu.
- Totožné vzory dvou pojmů se v textu neoznačují dvakrát.

## 0.11.0 – 2026-11-26 · Vazby z místa v textu
- Vazbu lze vytvořit z vybraného úseku textu (lišta výběru → **Propojit**). V textu je místo podtržené a označené ikonou řetízku;
  ve čtečce se po klepnutí rozbalí seznam propojených ustanovení. Totéž cílové ustanovení lze propojit z více míst jedné části.
- Návrhy výslovných odkazů (✧ Návrhy) se ukládají rovnou ukotvené k nalezené citaci (např. „čl. 17 odst. 5“).
- Panel ve Studiu skrývá archivované a zamítnuté komentáře a vazby (odkaz „zobrazit ve správě“).
  U konceptu komentáře je tlačítko **Odstranit** (přesune do archivu), u návrhu vazby **Odstranit návrh** (zamítne).
- Migrace 12_vazby_z_textu.sql.

## 0.10.0 – 2026-11-26 · Pojmy z definic a vrstvy zvýraznění
- Vrstvy zvýraznění: **Klíčové** (žlutá), **Povinnost** (zelená), **Lhůta / číslo** (fialová), **Výjimka / podmínka** (růžová). Ve Studiu z lišty po výběru textu.
- Čtečka: nad textem přepínače vrstev, které v části jsou (s počtem). Výchozí: klíčové a pojmy zapnuté, ostatní vypnuté; volba se pamatuje v prohlížeči.
- Pojmy z definic: u definičního článku (např. čl. 2) tlačítko „Pojmy z definic“ – načte body jako koncept s návrhem vzorů pro české tvary
  (např. `zdravotnick* prostred*`), ukáže počet výskytů, umožní upravit vzory a hromadně schválit / vyřadit.
- Ve čtečce je první výskyt pojmu v části plně podtržený; po klepnutí se ukáže definice z aktuálního znění článku.
- Zvýraznění se nepočítají mezi výklady v panelu Souvislosti.
- Migrace 11_pojmy.sql (tabulka terms, nové druhy zvýraznění, záloha včetně pojmů).

## 0.9.0 – 2026-11-26 · Poznámky k vybranému textu
- Studio: po označení textu myší se nabídne lišta **Zvýraznit · Poznámka · Pozor**. Kotva = přesné znění výběru + pořadí výskytu v části.
- Nový druh komentáře „Klíčová pasáž“ (zvýraznění), prochází stejným schvalováním jako ostatní komentáře.
- Po novém znění se poznámky, jejichž text už v části není, označí „Kotva nenalezena“.
- Jednotné ikony (sdilene/anotace.js) ve Studiu i čtečce; drobné značky v osnově (klíčová pasáž / pozor / komentář / vazba).
- Čtečka: podtržení + ikonka u poznámky, klepnutím se rozbalí pod řádkem; panel Souvislosti v pořadí pozor → výklad → MDCG → odkazy → příklady; legenda „Značky“.
- Hledaný výraz se zvýrazní modře (odlišně od klíčových pasáží) i ve formátovaném textu metodik; funguje i u právě otevřené části.
- Migrace 10_anotace.sql.

## 0.8.0 – souvislosti mezi dokumenty

- **◎ Souvislosti** (celý dokument) a **◎ Souvislosti** u části: kandidáti vazeb do jiného dokumentu – shodné číslo klasifikačního pravidla předpis ↔ metodika (MDR příloha VIII ↔ MDCG 2021-24: 22 pravidel, typ „Metodický výklad“) a shoda odborných pojmů z česko-anglického slovníku (pojem musí začínat na začátku slova; obecné pojmy mají malou váhu). Ukládají se jen návrhy do „Ke kontrole“; už existující vazby (i z jiné jazykové verze) se poznají.

## 0.7.0 – import PDF (MDCG)

- **Import dokumentu** přijímá i PDF (pdf.js v prohlížeči, `web/studio/vendor/pdfjs`, Apache-2.0). Kapitoly podle obsahu dokumentu (včetně nečíslovaných podkapitol), v kapitolách s pravidly dál „Rule N“.
- **Tabulky** s orámováním se převádějí na upravitelné tabulky (včetně sloučených buněk), **schémata** (strany s rámečky a velkými obrázky) se ukládají jako obrázek stránky do úložiště `figures`; jejich text zůstává pro vyhledávání. MDCG 2021-24 Rev.1: 56 částí, 22 pravidel, 9 schémat.
- Import PDF: čísla poznámek pod čarou jako horní index (gels²), poznámky pod čarou na konci části, tučné podnadpisy („General explanation of the rule“), tabulky pokračující na další straně spojené do jedné (MDCG: 26 tabulek).
- Čtečka: jednotná šířka textu, odsazení bodů a odrážek podle úrovně; upozornění, když student otevře odkaz na pracovní náhled.
- Studio zobrazuje obrázky v textu i v editoru (popisek lze upravit); sekce „Změny a původ znění“ jen u dokumentů se seznamem změn.
- Aktualizace na nové znění porovnává i bloky obsahu (tabulky, obrázky).
- Opravy databáze: kontrola cesty k obrázku (PostgreSQL nepovolí `{3,300}`), čtečka ukazuje nadpisy i u navigačních částí (migrace `06_import.sql` znovu, `09_ctecka.sql`).

## 0.6.0 – návrhy výslovných odkazů

- **Vazby platí pro všechny jazykové verze předpisu:** tvoří se jednou, v kterékoli jazykové verzi (obvykle CS), čtečka je ukáže i u anglické části a cíl převede na verzi ve stejném jazyce (MDR EN čl. 61 → MDR EN příloha I). Ve Studiu jsou u jiné jazykové verze vidět jako „Z jiné jazykové verze · platí i zde“. Návrhy odkazů a ruční propojení poznají vazbu vytvořenou u jiné verze jako už existující. Komentáře zůstávají jazykové; při přidání komentáře lze převzít text z jiné jazykové verze a přeložit ho. Když se originál později změní, Studio převzatý komentář označí („Originál překladu změněn“, filtr ve Správě komentářů), ukáže staré a nové znění originálu a po kontrole ho lze označit jako aktuální (migrace `08_preklady.sql`).
- Archivované části nejsou v přehledech ani ve výběrech cílů; při otevření jsou zřetelně označené.

- **✧ Návrhy odkazů** (celý dokument) a **✧ Návrhy** u části: v textu se najdou výslovné odkazy na články, odstavce, přílohy a pravidla téhož dokumentu, s citací místa v textu. Vybrané se uloží jako návrhy vazeb do „Ke kontrole“ (po 50, nic se neschválí samo). Výsledky jsou shodné s dřívější Python verzí (MDR CS 1382, EN 1323 nalezených odkazů); u hromadného zobrazení se odkaz z odstavce nenabízí znovu za celý článek.
- Nenalezené cíle (rozsahy „články 38 a 39“, jiné předpisy) se zobrazí zvlášť k ruční kontrole.

## 0.5.0 – import z EUR-Lexu v prohlížeči

- **Import z EUR-Lexu** ve Studiu: uložené HTML konsolidovaného znění se převede v prohlížeči na články, odstavce, přílohy a klasifikační pravidla (stejný výsledek jako dřívější Python import, včetně kontroly úplnosti textu a seznamu změnových aktů). Originál se uloží do Supabase Storage.
- **Aktualizace na nové znění**: shodné části zůstanou ověřené, změněné se vrátí k ověření (staré znění v historii, schválené vazby a komentáře do kontroly), nové přibudou, chybějící se archivují. Náhled ukáže seznam změn před importem.
- Rozpoznání CELEX, jazyka a data znění; nastavení verze a odkazu dokumentu.
- Nový dokument lze zařadit jako jinou jazykovou verzi existujícího předpisu (společné tagy a zařazení).
- **Archivace části** (tlačítko Archivovat u části; obnovení v přehledu dokumentu → Archivované části). Nic se nemaže, historie zůstává (migrace `07_archivace.sql`).
- Databáze: migrace `06_import.sql` (`rq_import_units` po dávkách a v režimu nového znění, `rq_import_finish`).

## 0.4.0 – webové Studio (Supabase)

**Nové**
- Studio na `regulaquest-studio.pages.dev` obsahuje celou redakci: katalog, práci s dokumentem, editor textu a tabulek, strukturu (rozdělit, přesunout, sloučit), historii změn s autorem, vazby, komentáře, schvalovací frontu.
- Publikování pro studenty z prohlížeče (`rq_publish`), historie publikací a vrácení starší verze; ruční záloha obsahu jako JSON.
- Přístupy jsou stránkou Studia; tlačítko **Obnovit** a automatické načtení změn druhého admina po návratu do okna.
- Konflikt verzí (stejnou část mezitím upravil jiný admin) ohlásí chybu a načte aktuální stav.
- Noční záloha databáze, účtů a souborů do soukromého repozitáře (`zalohy/`).
- Lokální zkouška Studia v prohlížeči proti PostgreSQL (`tests/web_e2e/`).

**Opravy (0.4.1)**
- Text vložený do editoru neztrácí odstavce (migrace `05_odstavce.sql`).
- Formulář dokumentu má pole Vydavatel; v „Upravit údaje a tagy“ lze změnit i název, zkratku, verzi, vydavatele a URL.
- Lokátor a nadpis nové části nejsou předvyplněné ukázkovým textem.

**Další etapa:** zobrazení vazeb a poznámek pro studenty (ukotvené poznámky, zvýraznění, ikony).

## 0.3.0 – studentská čtečka (navazuje na 0.2.15)

**Nové**
- Studentská čtečka `reader/` (nahrazuje `student-preview.html`): tři panely (obsah, text, souvislosti), na mobilu přepínání záložkami; hledání bez ohledu na diakritiku; přepnutí CS ↔ EN u stejného ustanovení; předchozí/další část; odkazy na konkrétní ustanovení (`#/u/mdr-cs-art-10-par-3`); zobrazuje tabulky a formátování z editoru 0.2.15 (formátování znovu čistí).
- Studio: tlačítko **Pohled studenta** v horní liště, **Pracovní náhled** (i neověřené texty, jen lokálně) a **Uložit do čtečky pro GitHub**.
- Nové rozhraní serveru: `/api/draft-preview`, akce `publish_to_reader`, obsluha `/reader/`.
- GitHub: `.gitignore`, testy v GitHub Actions, automatické nasazení čtečky na GitHub Pages.

**Opravy a úklid**
- Soubor `app/app(1).js` přejmenován na `app/app.js` (index.html jej jinak nenačetl).
- Nefunkční odkaz na `student-preview.html` nahrazen čtečkou.
- Číslo verze je na jednom místě (`VERSION` v `server.py`); dříve se lišilo (0.2.12 / 0.2.14).
- Navigace Studia rozdělena do skupin Obsah / Návrhy vazeb / Redakce / Výstup.
- Export pro studenty obsahuje jen pole, která čtečka potřebuje (bez interních poznámek k importu).
- Opraven zastaralý test publikování; přidány testy pracovního náhledu, zápisu do čtečky a exportu tabulek, sloučených částí a vracení schválení po změně textu (`tests/test_structure_editor.py`).
- Části archivované sloučením se do čtečky nedostanou ani v pracovním náhledu.
- Odstraněny staré instalační README jednotlivých oprav (obsah je v README.md a zde).

## 0.2.15 – editor struktury, textu a tabulek
Editor bloků a tabulek, úprava struktury, rozdělení, přesun a sloučení textu, historie změn; každá změna obsahu ruší ověření a vrací schválené vazby a komentáře ke kontrole.

## 0.2.3 – 0.2.14
Import MDR CZ/EN a MDCG 2021-24, navigace, vazby a jejich správa, katalog a metadata, editor a historie komentářů, výslovné odkazy, hledání souvislostí MDR ↔ MDCG.
