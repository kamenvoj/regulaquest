# Zálohy RegulaQuest

Zálohy běží v soukromém repozitáři `regulaquest-zalohy` (GitHub Actions). Tento adresář obsahuje jen šablonu workflow. Žádné údaje se sem neukládají.

## Nastavení (jednou)

1. V `regulaquest-zalohy` → Settings → Secrets and variables → Actions přidat:
   - `RQ_DB_URL`: Supabase → **Connect** → Connection string → **Session pooler**, `[YOUR-PASSWORD]` nahradit heslem databáze.
   - `RQ_SECRET_KEY`: Supabase → Project Settings → API Keys → secret key.
2. Vytvořit soubor `.github/workflows/zaloha.yml` s obsahem `zaloha.yml`.
3. Actions → Záloha → **Run workflow** a ověřit první běh.

Záloha běží každou noc. Při neúspěchu přijde GitHubem e-mail vlastníkovi repozitáře.

## Co záloha obsahuje

| Soubor | Obsah |
|---|---|
| `databaze/regulaquest.sql` | schémata `public` a `rq_private`: tabulky, data, funkce, RLS, práva |
| `databaze/ucty.sql` | `auth.users`, `auth.identities`: přihlašovací účty (hesla jen jako hash) |
| `uloziste/<bucket>/…` | soubory ze Storage (`originals`, `figures`) |

Starší stavy jsou v historii gitu: `git log -- databaze/regulaquest.sql`, obnova konkrétního dne přes `git checkout <commit> -- databaze`.

## Obnova do nového prázdného projektu Supabase

1. Založit projekt, v Authentication nastavit totéž co v původním: e-mail provider zapnutý, bez potvrzování e-mailu, registrace vypnutá.
2. Z počítače s `psql` (verze ≥ verze serveru):
   ```bash
   export DB="<Session pooler URL nového projektu>"
   psql "$DB" -v ON_ERROR_STOP=1 -c "drop schema if exists rq_private cascade; drop schema public cascade;"
   psql "$DB" -v ON_ERROR_STOP=1 -f databaze/ucty.sql
   psql "$DB" -v ON_ERROR_STOP=1 -f databaze/regulaquest.sql
   ```
   Pořadí je důležité: profily odkazují na účty.
3. Spustit `supabase/migrations/03_uloziste.sql` (buckety a jejich pravidla) a nahrát soubory z `uloziste/` do stejnojmenných bucketů se stejnými cestami.
4. Nasadit Edge Function `ucty` a v `web/sdilene/config.js` změnit URL a publishable key.
