#!/bin/zsh
# Arma informe.html con las partes y lo imprime a PDF con Chrome sin ventana. Revisa desbordes y choques (título).
cd "${0:A:h}"
cat cabeza.part cuerpo*.html cola.part > informe.html
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$C" --headless=new --disable-gpu --allow-file-access-from-files --virtual-time-budget=20000 --dump-dom "file://$PWD/informe.html" 2>/dev/null | grep -o "<title>[^<]*</title>"
"$C" --headless=new --disable-gpu --allow-file-access-from-files --no-pdf-header-footer --virtual-time-budget=20000 --print-to-pdf="$PWD/NOVA-informe-tecnico.pdf" "file://$PWD/informe.html" 2>&1 | tail -1
