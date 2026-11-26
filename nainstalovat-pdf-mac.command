#!/bin/bash
set -e
cd "$(dirname "$0")"
echo 'RegulaQuest Studio – instalace čtečky PDF (jen pro import MDCG)'
python3 -m venv .venv
P=".venv/bin/python"
"$P" -m pip --disable-pip-version-check install --upgrade pip
if "$P" -c 'import sys;raise SystemExit(0 if sys.version_info >= (3,10) else 1)'; then
  "$P" -m pip --disable-pip-version-check install pymupdf
else
  "$P" -m pip --disable-pip-version-check install 'pymupdf==1.26.5'
fi
echo 'PDF podpora je připravena. Spusťte aplikaci znovu pomocí bash spustit-mac.command.'
