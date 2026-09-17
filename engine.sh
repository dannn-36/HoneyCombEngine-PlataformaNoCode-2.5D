#!/usr/bin/env bash
# Arregla el entorno de audio/build y compila+corre el motor HoneyComb en Linux.
#
# Uso: ./engine.sh          -> arregla audio, recompila y abre el motor
#      ./engine.sh build    -> arregla audio y recompila, sin abrir
#      ./engine.sh run      -> solo abre el binario ya compilado

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$SCRIPT_DIR/engine"

export VCPKG_ROOT="${VCPKG_ROOT:-$HOME/vcpkg}"

fix_audio() {
    echo "[honeycomb] revisando audio (PipeWire/WirePlumber)..."
    if ! timeout 3 pactl info > /dev/null 2>&1; then
        echo "[honeycomb] audio no responde, reiniciando WirePlumber..."
        pkill -9 -f wireplumber 2>/dev/null || true
        sleep 1
        setsid /usr/bin/wireplumber > /dev/null 2>&1 &
        disown
        sleep 2
        if timeout 3 pactl info > /dev/null 2>&1; then
            echo "[honeycomb] audio OK."
        else
            echo "[honeycomb] el audio sigue sin responder. El motor puede tardar en abrir la ventana."
        fi
    else
        echo "[honeycomb] audio OK."
    fi
}

build_engine() {
    echo "[honeycomb] configurando (preset linux)..."
    cmake --preset linux -S "$ENGINE_DIR" -B "$ENGINE_DIR/build"
    echo "[honeycomb] compilando..."
    cmake --build "$ENGINE_DIR/build"
}

run_engine() {
    echo "[honeycomb] abriendo el motor..."
    cd "$ENGINE_DIR/build"
    ./engine
}

trap 'echo -e "\n[honeycomb] Algo falló. Revisa el mensaje de arriba."' ERR

case "$1" in
    run)
        fix_audio
        run_engine
        ;;
    build)
        fix_audio
        build_engine
        ;;
    *)
        fix_audio
        build_engine
        run_engine
        ;;
esac
