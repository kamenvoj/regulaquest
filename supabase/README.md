# Databáze RegulaQuest (Supabase)

Složka `migrations/` obsahuje celou definici databáze. Soubory se spouštějí v pořadí v **Supabase → SQL Editor**.
Všechny lze bezpečně spustit opakovaně (při úpravách stačí spustit změněný soubor znovu).

| Soubor | Obsah |
|---|---|
| `01_schema.sql` | tabulky, role (správce / admin / student), pravidla přístupu (RLS) |
| `02_funkce.sql` | funkce `rq_*` s odbornými pravidly: ověřování, schvalování, historie, editor struktury, import, publikování |
| `03_uloziste.sql` | úložiště souborů: `originals` (jen admini), `figures` (obrázky pro přihlášené) |
| `04_spravce.sql` | přidělí roli správce účtu `vojta@admin.regulaquest.cz` |

## Nasazení (jednorázově)

1. Supabase → **Authentication → Users → Add user → Create new user**: `vojta@admin.regulaquest.cz`, heslo, zaškrtnout *Auto Confirm User*.
2. Supabase → **SQL Editor → New query**. Vložit celý obsah `01_schema.sql` → **Run**.
3. Totéž pro `02_funkce.sql`, `03_uloziste.sql` a `04_spravce.sql` (každý soubor jako samostatný dotaz).
4. Poslední dotaz musí vypsat řádek `vojta | Vojta | owner | true`.

Pokud SQL Editor upozorní na „destructive operation“ (příkazy `revoke` a `drop policy`), je to v pořádku: odebírají se jen výchozí přístupová práva a nahrazují se pravidla přístupu.

## Zásady

- Studio i čtečka **nikdy nemění tabulky přímo**. Veškerý zápis jde přes funkce `rq_*`, které ověří roli a vynutí pravidla:
  - změna textu nebo struktury ruší ověření a vrací schválené vazby a komentáře ke kontrole,
  - nic se nemaže (sloučené části se archivují),
  - import nepřepíše ověřený ani ručně upravený text,
  - každá změna se zapíše do historie i s autorem.
- Admini smí pracovní data číst. **Studenti nevidí nic z pracovních dat**; jediný přístup k obsahu je
  `rq_current_publication()`, tedy aktuální publikovaná verze.
- Vnitřní pomocné funkce jsou ve schématu `rq_private`, které API nezveřejňuje.

## Testy

Lokálně proti PostgreSQL (Supabase se napodobí souborem `tests/00_lokalni_napodobeni_supabase.sql`):

```bash
RQ_PG_DSN="host=localhost port=5432 user=postgres" python3 -m unittest supabase/tests/test_databaze.py -v
```

Na GitHubu se testy spouštějí automaticky při každé změně. Testují mimo jiné, že nepřihlášený ani student
se k pracovním datům nedostanou, že student vidí jen publikovaný ověřený obsah a že výsledek publikování
odpovídá lokálnímu Studiu 0.3.0 (volitelně s `RQ_SQLITE=cesta/k/testovaci/databazi`).
