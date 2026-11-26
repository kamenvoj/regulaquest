# RegulaQuest

Výukový projekt FBMI ČVUT pro práci s evropskou regulací zdravotnických prostředků (MDR, MDCG).

- **Studio** – redakční prostředí: import, ověřování textů proti originálu, vazby, výklady, schvalování, publikování.
- **Čtečka** – aplikace pro studenty: jen ověřený a schválený obsah, přístup po přihlášení.

## Stav

Repozitář právě přechází z lokální aplikace (Python + SQLite) na webové Studio a čtečku nad Supabase,
hostované na Netlify. Cílová architektura a postup jsou v technickém návrhu (etapy 0–9).

Výchozí stav v tomto repozitáři je lokální Studio 0.2.15 s úpravami 0.3.0
(popis a spuštění: [docs/studio-lokalni-0.3.0.md](docs/studio-lokalni-0.3.0.md)).

V repozitáři je jen kód. Pracovní databáze, originální dokumenty a zálohy sem nepatří (viz `.gitignore`).

## Upozornění

Aplikace je studijní pomůcka, ne oficiální zdroj práva. Rozhodující je vždy znění na EUR-Lex
a v dokumentech Evropské komise.
