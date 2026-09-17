#!/usr/bin/env bash
# Lanza el editor HoneyComb desde cualquier directorio.
#
# Uso: ./editor.sh         -> dev server + editor, con recarga en vivo
#      ./editor.sh build   -> compila y abre sin dev server

set -e

# Se ubica en el directorio del script + /editor sin importar desde dónde se ejecute
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/editor"

# Limpia la variable por si se ejecuta desde la terminal integrada de VS Code
unset ELECTRON_RUN_AS_NODE

trap 'echo -e "\n[honeycomb] Falló el arranque. Si es la primera vez, ejecuta: npm install"' ERR

if [ "$1" = "build" ]; then
    echo "[honeycomb] compilando el editor..."
    npm run build
    npm run electron
else
    npm run dev
fi