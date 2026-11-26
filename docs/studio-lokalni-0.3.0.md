# RegulaQuest

Výukový projekt FBMI ČVUT pro práci s evropskou regulací zdravotnických prostředků. Má dvě části:

| Část | Pro koho | Kde běží |
|---|---|---|
| **Studio** (`server.py`, `app/`) | redakce: import, ověřování, komentáře, vazby, schvalování | jen lokálně na tvém počítači |
| **Čtečka** (`reader/`) | studenti: ověřené texty, výklady, související ustanovení | GitHub Pages (statický web, bez účtů) |

Studio je „moderátorský“ pohled, čtečka je to, co vidí studenti. Do čtečky se dostane jen to, co projde ověřením a schválením ve Studiu.

## Spuštění Studia (Mac)

```bash
bash spustit-mac.command
```

Studio se otevře na `http://127.0.0.1:8765/`. Import MDCG z PDF potřebuje jednorázově `bash nainstalovat-pdf-mac.command`. Oficiální podklady stáhne `bash stahnout-podklady-mac.command` (do složky `podklady/`).

## Jak se obsah dostane ke studentům

1. Ve Studiu ověř texty, schval komentáře a vazby.
2. **Publikování → Pohled studenta** ukáže čtečku přesně s daty, která by studenti dostali. **Pracovní náhled** ukáže i neověřené texty a návrhy (jen pro redakci, nikdy se neexportuje).
3. **Publikování → Uložit do čtečky pro GitHub** zapíše export do `reader/data/regulaquest-student-data.json`.
4. Změnu odešli na GitHub (commit + push). GitHub Actions čtečku automaticky nasadí na Pages.

Pravidla exportu (hlídá je server i testy na GitHubu):
- jen texty ve stavu „Ověřený text“; nadřazené části bez ověřeného textu jen jako položka navigace (označení, bez textu a nadpisu);
- jen schválené komentáře k ověřeným částem;
- jen schválené vazby, jejichž oba konce jsou ověřené.

## Co je v repozitáři a co ne

V repozitáři je kód a publikovaný export pro čtečku. **Nejsou** v něm (viz `.gitignore`):
- `data/` – pracovní databáze SQLite a uložené originály PDF,
- `podklady/` – stažené zdroje z EUR-Lex a Evropské komise,
- zálohy Studia.

Databázi zálohuj zvlášť (tlačítko **Záloha** ve Studiu nebo kopie složky `data/`).

## Struktura

```
server.py              lokální server Studia (Python, jen standardní knihovna)
importer.py            import EUR-Lex HTML a MDCG PDF
eurlex_dom.py          čtení struktury EUR-Lex HTML
reference_suggest.py   výslovné odkazy (článek 61, příloha XIV…)
related_search.py      strukturální a slovníková podobnost MDR ↔ MDCG
app/                   rozhraní Studia
reader/                studentská čtečka (statická, čte reader/data/*.json)
tests/                 automatické testy (python3 -m unittest discover -s tests)
docs/                  ukázky formátů
.github/workflows/     testy a nasazení čtečky
```

## Testy

```bash
python3 -m unittest discover -s tests -v
```

Testy se skutečným MDR se spustí, pokud nastavíš cestu k HTML: `RQ_REAL_MDR_HTML=podklady/MDR_CS_20260719.html`.

## Upozornění

Čtečka je studijní pomůcka, ne oficiální zdroj práva. Rozhodující je vždy aktuální znění na EUR-Lex a v dokumentech Evropské komise.
