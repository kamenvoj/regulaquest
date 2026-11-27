# Zkouška webového Studia v prohlížeči (lokálně)

Studio běží proti lokálnímu PostgreSQL se všemi migracemi a RLS; `supabase-mock.js` nahrazuje supabase-js a posílá RPC na `server.py`.
Funkce `ucty` ani Storage se zde nezkouší.

```bash
# databáze rqe2e: 00_lokalni_napodobeni_supabase.sql + všechny migrace 01–10 + profily vojta (owner) a ondra (admin), id UUID 1 a 2
cp -r web /tmp/e2e-web && for a in studio ctecka; do cp tests/web_e2e/supabase-mock.js /tmp/e2e-web/$a/sdilene/supabase.js
  sed -i "s#supabaseUrl:'[^']*'#supabaseUrl:'http://127.0.0.1:8765'#" /tmp/e2e-web/$a/sdilene/config.js; done
python3 tests/web_e2e/server.py "host=/tmp/pg port=5544 user=postgres dbname=rqe2e" /tmp/e2e-web &
python3 tests/web_e2e/test_ui.py      # heslo v testu: Heslo12345AB
python3 tests/web_e2e/test_anotace.py # poznámky k výběru, zvýraznění, čtečka (pracovní náhled)
python3 tests/web_e2e/test_dokumenty.py # archivace a smazání dokumentu
python3 tests/web_e2e/test_trasy.py     # trasy ve Studiu a ve čtečce
python3 tests/web_e2e/test_pokryti.py   # přehled pokrytí (spouštět po test_anotace.py)
python3 tests/web_e2e/test_domov.py     # úvodní stránka a nápověda (spouštět po test_anotace.py)
python3 tests/web_e2e/test_prehled.py   # moje dokumenty, připnutí, katalog se stavem
python3 tests/web_e2e/test_oblasti.py   # oblasti a role dokumentů (po test_anotace.py)
python3 tests/web_e2e/test_hledani.py   # Najít předpisy a průvodce (po test_oblasti.py)
python3 tests/web_e2e/test_aktuality.py # aktuality: načtení (náhrada pg_net), Studio, propojení, čtečka (po test_anotace.py)
python3 tests/web_e2e/test_pripady.py   # řešené případy: Studio, kroky, propojení z textu, čtečka (po test_anotace.py)
```

`test_import.py` naimportuje celé MDR (soubor `podklady/MDR_CS_20260719.html`, v gitu není) a pak upravenou kopii
`/tmp/MDR_CS_upraveno.html` (změněný čl. 1, chybějící čl. 123) jako nové znění.
Převod HTML v prohlížeči dává pro MDR CS i EN stejné části a texty jako původní Python import (684 částí).
