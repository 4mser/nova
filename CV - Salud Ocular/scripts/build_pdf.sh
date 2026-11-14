#!/usr/bin/env bash
# Genera docs/nova-vision-ocular.pdf desde la pagina HTML (Chrome headless).
set -e
cd "$(dirname "$0")/.."
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
SRC="$(pwd -W)/docs/nova-vision-ocular.html"
OUT="$(pwd -W)/docs/nova-vision-ocular.pdf"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=8000 --print-to-pdf="$OUT" "file:///${SRC// /%20}" 2>/dev/null
sleep 2; echo "PDF: $OUT"
