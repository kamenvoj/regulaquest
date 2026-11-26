# Zkouška webového Studia v prohlížeči (lokálně)

Studio běží proti lokálnímu PostgreSQL se všemi migracemi a RLS; `supabase-mock.js` nahrazuje supabase-js a posílá RPC na `server.py`.
Funkce `ucty` ani Storage se zde nezkouší.

```bash
# databáze rqe2e: 00_lokalni_napodobeni_supabase.sql + migrace 01–03 + profily vojta (owner) a ondra (admin), id UUID 1 a 2
cp -r web /tmp/e2e-web && cp tests/web_e2e/supabase-mock.js /tmp/e2e-web/studio/sdilene/supabase.js
sed -i "s#supabaseUrl:'[^']*'#supabaseUrl:'http://127.0.0.1:8765'#" /tmp/e2e-web/studio/sdilene/config.js
python3 tests/web_e2e/server.py "host=/tmp/pg port=5544 user=postgres dbname=rqe2e" /tmp/e2e-web &
python3 tests/web_e2e/test_ui.py      # heslo v testu: Heslo12345AB
```
