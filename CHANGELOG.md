# Změny

## 0.4.0 – webové Studio (Supabase)

**Nové**
- Studio na `regulaquest-studio.pages.dev` obsahuje celou redakci: katalog, práci s dokumentem, editor textu a tabulek, strukturu (rozdělit, přesunout, sloučit), historii změn s autorem, vazby, komentáře, schvalovací frontu.
- Publikování pro studenty z prohlížeče (`rq_publish`), historie publikací a vrácení starší verze; ruční záloha obsahu jako JSON.
- Přístupy jsou stránkou Studia; tlačítko **Obnovit** a automatické načtení změn druhého admina po návratu do okna.
- Konflikt verzí (stejnou část mezitím upravil jiný admin) ohlásí chybu a načte aktuální stav.
- Noční záloha databáze, účtů a souborů do soukromého repozitáře (`zalohy/`).
- Lokální zkouška Studia v prohlížeči proti PostgreSQL (`tests/web_e2e/`).

**Zatím chybí (další etapy):** import dokumentů v prohlížeči, automatické návrhy výslovných odkazů a souvislostí.

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
