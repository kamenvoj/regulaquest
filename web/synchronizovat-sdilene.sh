#!/bin/bash
# Zkopíruje společné soubory (web/sdilene) do obou webů. Cloudflare Pages publikuje každou složku zvlášť.
set -e
cd "$(dirname "$0")"
for app in ctecka studio; do
  rm -rf "$app/sdilene"; cp -r sdilene "$app/sdilene"
done
echo "Společné soubory zkopírovány do web/ctecka a web/studio."
