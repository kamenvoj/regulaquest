# Změny

## 0.6.0 – návrhy výslovných odkazů

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

**Zatím chybí (další etapy):** import PDF (MDCG), hledání souvislostí MDR ↔ MDCG.

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
