#!/bin/bash
set -e
cd "$(dirname "$0")" || exit 1
mkdir -p podklady
echo 'Stahuji oficiální MDR CZ / EN a MDCG PDF do složky podklady…'
curl -fLsS --retry 2 --connect-timeout 20 'https://eur-lex.europa.eu/legal-content/CS/TXT/HTML/?uri=CELEX:02017R0745-20260719' -o podklady/MDR_CS_20260719.html
curl -fLsS --retry 2 --connect-timeout 20 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02017R0745-20260719' -o podklady/MDR_EN_20260719.html
curl -fLsS --retry 2 --connect-timeout 20 'https://health.ec.europa.eu/system/files/2021-10/mdcg_2021-24_en_0.pdf' -o podklady/MDCG_2021-24_rev1.pdf
python3 - <<'PY'
from pathlib import Path
for p in sorted(Path('podklady').iterdir()):
    b=p.read_bytes()
    if p.suffix=='.pdf': ok=b[:4]==b'%PDF' and len(b)>100000
    else: ok=len(b)>100000 and b'<html' in b[:10000].lower()
    print(f"{'OK' if ok else 'VAROVÁNÍ'}: {p.name}, {len(b)/1024/1024:.1f} MB")
    if not ok:print('  Soubor ověřte; může jít o chybovou stránku namísto předpisu.')
PY
echo 'Podklady jsou uložené. Otevřete Studio a zvolte Import MDR / MDCG.'
