# Změny

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
