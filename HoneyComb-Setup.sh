#!/usr/bin/env bash
# =============================================================================
#  HoneyComb Engine - Instalador (Linux)
# =============================================================================
#
#  Equivalente de HoneyComb-Setup.cmd para Linux. Hace lo mismo, en orden:
#
#    1. Revisa los requisitos (Node 20+, CMake, Ninja, g++, git, vcpkg).
#    2. Instala lo que falte, pidiendo confirmación antes de cada cosa.
#    3. Instala las dependencias del editor y compila su interfaz (Angular).
#    4. Configura y compila el motor C++ en engine/build (preset "linux").
#    5. Verifica el resultado y abre el editor.
#
#  Los diálogos usan whiptail si está disponible (viene en casi toda distro);
#  si no, pregunta por consola. Los pasos largos escriben en la terminal a
#  propósito: en una compilación de 15 minutos conviene ver qué está pasando.
#
#  Uso:  ./HoneyComb-Setup.sh            -> asistente
#        ./HoneyComb-Setup.sh --si       -> acepta todo sin preguntar
# =============================================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EDITOR_DIR="$SCRIPT_DIR/editor"
ENGINE_DIR="$SCRIPT_DIR/engine"
BUILD_DIR="$ENGINE_DIR/build"
ANGULAR_INDEX="$EDITOR_DIR/dist/editor/browser/index.html"
ENGINE_BIN="$BUILD_DIR/engine"

ASSUME_YES=0
if [ "${1:-}" = "--si" ] || [ "${1:-}" = "--yes" ] || [ "${1:-}" = "-y" ]; then
    ASSUME_YES=1
fi

# Colores solo si la salida es una terminal (si se redirige a un archivo, los
# códigos de escape ensucian el log).
if [ -t 1 ]; then
    C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_AMBER=$'\033[33m'
    C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_BOLD=$'\033[1m'
else
    C_RESET=''; C_DIM=''; C_AMBER=''; C_GREEN=''; C_RED=''; C_BOLD=''
fi

HAVE_WHIPTAIL=0
if command -v whiptail > /dev/null 2>&1; then
    HAVE_WHIPTAIL=1
fi

# -----------------------------------------------------------------------------
# Presentación
# -----------------------------------------------------------------------------

step()  { printf '\n%s[honeycomb]%s %s%s\n' "$C_AMBER" "$C_RESET" "$C_BOLD" "$1$C_RESET"; }
ok()    { printf '    %s[ok]%s    %s\n' "$C_GREEN" "$C_RESET" "$1"; }
miss()  { printf '    %s[falta]%s %s\n' "$C_RED" "$C_RESET" "$1"; }
info()  { printf '    %s%s%s\n' "$C_DIM" "$1" "$C_RESET"; }

die() {
    printf '\n%s[honeycomb] %s%s\n\n' "$C_RED" "$1" "$C_RESET" >&2
    if [ "$HAVE_WHIPTAIL" = "1" ] && [ "$ASSUME_YES" = "0" ]; then
        whiptail --title "HoneyComb Engine" --msgbox "La instalación se detuvo:\n\n$1" 12 70 3>&1 1>&2 2>&3 || true
    fi
    exit 1
}

# Pregunta sí/no. Con --si no pregunta nada; con whiptail usa el diálogo.
confirm() {
    local title="$1" message="$2"
    if [ "$ASSUME_YES" = "1" ]; then
        return 0
    fi
    if [ "$HAVE_WHIPTAIL" = "1" ]; then
        whiptail --title "$title" --yesno "$message" 14 72 3>&1 1>&2 2>&3
        return $?
    fi
    printf '\n  %s%s%s\n  %s\n' "$C_AMBER" "$title" "$C_RESET" "$message"
    read -r -p '  ¿Continuar? [S/n] ' reply
    case "$reply" in
        ''|s|S|y|Y) return 0 ;;
        *) return 1 ;;
    esac
}

welcome() {
    local message="Este asistente deja el proyecto listo para usar:

  1. Revisa los requisitos del sistema.
  2. Instala lo que falte (pidiendo confirmación).
  3. Instala las dependencias del editor y compila su interfaz.
  4. Configura y compila el motor C++ en engine/build.
  5. Verifica el resultado y abre el editor.

La primera vez tarda entre 10 y 25 minutos (raylib y el motor se compilan
desde el código). Hace falta conexión a internet.

Proyecto: $SCRIPT_DIR"

    if [ "$HAVE_WHIPTAIL" = "1" ] && [ "$ASSUME_YES" = "0" ]; then
        whiptail --title "HoneyComb Engine - Instalación" --yesno "$message" 22 76 \
            --yes-button "Comenzar" --no-button "Salir" 3>&1 1>&2 2>&3 \
            || { echo "[honeycomb] Instalación cancelada."; exit 0; }
    else
        printf '\n  %sHoneyComb Engine - Instalación%s\n' "$C_AMBER$C_BOLD" "$C_RESET"
        printf '%s\n' "$message"
    fi
}

# -----------------------------------------------------------------------------
# Gestor de paquetes
# -----------------------------------------------------------------------------

PKG=''
detect_package_manager() {
    if command -v apt-get > /dev/null 2>&1; then PKG='apt'
    elif command -v dnf > /dev/null 2>&1; then PKG='dnf'
    elif command -v pacman > /dev/null 2>&1; then PKG='pacman'
    elif command -v zypper > /dev/null 2>&1; then PKG='zypper'
    fi
}

SUDO=''
need_sudo() {
    if [ "$(id -u)" = "0" ]; then
        SUDO=''
    elif command -v sudo > /dev/null 2>&1; then
        SUDO='sudo'
    else
        die "Hace falta sudo (o correr como root) para instalar paquetes del sistema."
    fi
}

# Paquetes del sistema: el toolchain, y además las librerías de desarrollo que
# vcpkg necesita para compilar SDL2 en Linux (X11/Wayland/audio). Sin estas, el
# build de SDL2 falla a mitad de camino con un error de cabecera que no dice
# claramente qué instalar.
install_system_packages() {
    need_sudo
    case "$PKG" in
        apt)
            $SUDO apt-get update || die "apt-get update falló."
            $SUDO apt-get install -y \
                build-essential cmake ninja-build git curl zip unzip tar pkg-config \
                autoconf automake libtool python3 \
                libx11-dev libxext-dev libxrandr-dev libxi-dev libxcursor-dev \
                libxinerama-dev libxss-dev libxkbcommon-dev libwayland-dev \
                libgl1-mesa-dev libegl1-mesa-dev libibus-1.0-dev libdbus-1-dev \
                libudev-dev libasound2-dev libpulse-dev \
                || die "No se pudieron instalar los paquetes del sistema."
            ;;
        dnf)
            $SUDO dnf install -y \
                gcc-c++ make cmake ninja-build git curl zip unzip tar pkgconf-pkg-config \
                autoconf automake libtool python3 \
                libX11-devel libXext-devel libXrandr-devel libXi-devel libXcursor-devel \
                libXinerama-devel libXScrnSaver-devel libxkbcommon-devel wayland-devel \
                mesa-libGL-devel mesa-libEGL-devel ibus-devel dbus-devel \
                systemd-devel alsa-lib-devel pulseaudio-libs-devel \
                || die "No se pudieron instalar los paquetes del sistema."
            ;;
        pacman)
            $SUDO pacman -Sy --needed --noconfirm \
                base-devel cmake ninja git curl zip unzip tar pkgconf autoconf automake libtool python \
                libx11 libxext libxrandr libxi libxcursor libxinerama libxss libxkbcommon wayland \
                mesa libglvnd ibus dbus alsa-lib libpulse \
                || die "No se pudieron instalar los paquetes del sistema."
            ;;
        zypper)
            $SUDO zypper install -y -t pattern devel_C_C++ || true
            $SUDO zypper install -y \
                cmake ninja git curl zip unzip tar pkg-config autoconf automake libtool python3 \
                libX11-devel libXext-devel libXrandr-devel libXi-devel libXcursor-devel \
                libxkbcommon-devel wayland-devel Mesa-libGL-devel alsa-devel libpulse-devel \
                || die "No se pudieron instalar los paquetes del sistema."
            ;;
        *)
            die "No reconozco el gestor de paquetes de esta distro. Instala a mano lo de la sección 2 del README y vuelve a correr el instalador."
            ;;
    esac
}

# Node de la distro suele ser viejo. NodeSource es la vía oficial para tener la
# LTS en Debian/Ubuntu; en el resto se usa el paquete de la distro.
install_node() {
    need_sudo
    case "$PKG" in
        apt)
            curl -fsSL https://deb.nodesource.com/setup_lts.x | $SUDO -E bash - \
                || die "No se pudo configurar el repositorio de NodeSource."
            $SUDO apt-get install -y nodejs || die "No se pudo instalar Node.js."
            ;;
        dnf)    $SUDO dnf install -y nodejs npm || die "No se pudo instalar Node.js." ;;
        pacman) $SUDO pacman -Sy --needed --noconfirm nodejs npm || die "No se pudo instalar Node.js." ;;
        zypper) $SUDO zypper install -y nodejs npm || die "No se pudo instalar Node.js." ;;
        *)      die "Instala Node.js 20 o mayor a mano y vuelve a correr el instalador." ;;
    esac
}

# -----------------------------------------------------------------------------
# Requisitos
# -----------------------------------------------------------------------------

node_major() {
    command -v node > /dev/null 2>&1 || return 1
    node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1
}

cmake_ok() {
    command -v cmake > /dev/null 2>&1 || return 1
    local version
    version="$(cmake --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1)"
    [ -n "$version" ] || return 1
    # Comparación por orden de versión: 3.20 es el mínimo del CMakeLists.
    [ "$(printf '%s\n3.20\n' "$version" | sort -V | head -1)" = "3.20" ]
}

VCPKG_DIR=''
find_vcpkg() {
    local candidates=("${VCPKG_ROOT:-}" "$HOME/vcpkg" "/opt/vcpkg")
    for candidate in "${candidates[@]}"; do
        if [ -n "$candidate" ] && [ -f "$candidate/scripts/buildsystems/vcpkg.cmake" ]; then
            VCPKG_DIR="$candidate"
            return 0
        fi
    done
    VCPKG_DIR=''
    return 1
}

install_vcpkg() {
    local target="$HOME/vcpkg"
    if [ ! -f "$target/bootstrap-vcpkg.sh" ]; then
        step "Clonando vcpkg en $target"
        git clone --depth 1 https://github.com/microsoft/vcpkg.git "$target" \
            || die "No se pudo clonar vcpkg."
    fi
    step "Preparando vcpkg (bootstrap)"
    "$target/bootstrap-vcpkg.sh" -disableMetrics || die "El bootstrap de vcpkg falló."

    export VCPKG_ROOT="$target"
    VCPKG_DIR="$target"

    # Persistente: CMakePresets.json lee el toolchain de VCPKG_ROOT, así que sin
    # esto habría que exportarlo a mano en cada terminal nueva.
    local rc="$HOME/.bashrc"
    if [ -f "$rc" ] && ! grep -q 'VCPKG_ROOT' "$rc"; then
        printf '\n# HoneyComb Engine: toolchain de vcpkg\nexport VCPKG_ROOT="%s"\n' "$target" >> "$rc"
        info "VCPKG_ROOT agregado a ~/.bashrc"
    fi
}

check_requirements() {
    step "Revisando los requisitos"
    MISSING_SYSTEM=0
    MISSING_NODE=0
    MISSING_VCPKG=0

    if command -v git > /dev/null 2>&1; then ok "Git - $(git --version)"; else miss "Git"; MISSING_SYSTEM=1; fi
    if command -v g++ > /dev/null 2>&1; then ok "g++ - $(g++ --version | head -1)"; else miss "Compilador C++17 (g++)"; MISSING_SYSTEM=1; fi
    if cmake_ok; then ok "CMake - $(cmake --version | head -1)"; else miss "CMake 3.20 o mayor"; MISSING_SYSTEM=1; fi
    if command -v ninja > /dev/null 2>&1; then ok "Ninja - $(ninja --version)"; else miss "Ninja"; MISSING_SYSTEM=1; fi

    local major
    if major="$(node_major)" && [ -n "$major" ] && [ "$major" -ge 20 ] 2>/dev/null; then
        ok "Node.js - $(node -v)"
    else
        if command -v node > /dev/null 2>&1; then
            miss "Node.js 20 o mayor (hay $(node -v))"
        else
            miss "Node.js 20 o mayor"
        fi
        MISSING_NODE=1
    fi

    if find_vcpkg; then ok "vcpkg - $VCPKG_DIR"; else miss "vcpkg"; MISSING_VCPKG=1; fi
}

# -----------------------------------------------------------------------------
# Instalación del proyecto
# -----------------------------------------------------------------------------

install_project() {
    find_vcpkg || die "No encuentro vcpkg."
    export VCPKG_ROOT="$VCPKG_DIR"

    step "Instalando las dependencias del editor (npm install)"
    ( cd "$EDITOR_DIR" && npm install ) || die "npm install falló en editor/."

    step "Compilando la interfaz del editor (Angular)"
    ( cd "$EDITOR_DIR" && npm run build ) || die "La compilación de Angular falló."

    # El preset "linux" ya escribe en engine/build, que es donde el editor busca
    # el motor al darle a Ejecutar (ver editor/ipc/run.js).
    step "Configurando el motor (CMake + vcpkg)"
    cmake --preset linux -S "$ENGINE_DIR" -B "$BUILD_DIR" || die "La configuración de CMake falló."

    step "Compilando el motor C++ (la primera vez tarda varios minutos)"
    cmake --build "$BUILD_DIR" || die "La compilación del motor falló."

    step "Verificando la instalación"
    [ -x "$ENGINE_BIN" ]        || die "No se generó engine/build/engine."
    [ -f "$ANGULAR_INDEX" ]     || die "No se generó editor/dist."
    [ -d "$BUILD_DIR/levels" ]  || die "Faltan los niveles junto al motor."
    [ -d "$BUILD_DIR/assets" ]  || die "Faltan los assets junto al motor."
    ok "Motor:  $ENGINE_BIN"
    ok "Editor: $ANGULAR_INDEX"
}

# Entrada en el menú de aplicaciones: es el equivalente del acceso directo del
# Escritorio en Windows.
create_desktop_entry() {
    local dir="$HOME/.local/share/applications"
    local file="$dir/honeycomb-engine.desktop"
    mkdir -p "$dir"
    cat > "$file" <<EOF
[Desktop Entry]
Type=Application
Name=HoneyComb Engine
Comment=Editor de niveles NoCode 2.5D
Exec=$SCRIPT_DIR/editor.sh build
Path=$SCRIPT_DIR
Icon=$EDITOR_DIR/public/favicon.ico
Terminal=false
Categories=Development;Game;
EOF
    chmod +x "$file"
    ok "Entrada creada en el menú de aplicaciones"
}

# -----------------------------------------------------------------------------
# Flujo
# -----------------------------------------------------------------------------

main() {
    welcome
    detect_package_manager
    check_requirements

    if [ "$MISSING_SYSTEM" = "1" ]; then
        confirm "Paquetes del sistema" \
            "Faltan herramientas de compilación (compilador, CMake, Ninja o Git).\n\nSe instalarán con $PKG, junto con las librerías de desarrollo que SDL2 necesita.\n\nPedirá tu contraseña de sudo." \
            || die "Sin el toolchain no se puede compilar el motor."
        step "Instalando los paquetes del sistema"
        install_system_packages
    fi

    if [ "$MISSING_NODE" = "1" ]; then
        confirm "Node.js" \
            "El editor necesita Node.js 20 o mayor (Angular + Electron).\n\n¿Instalarlo ahora?" \
            || die "Sin Node.js no se puede instalar el editor."
        step "Instalando Node.js"
        install_node
    fi

    if [ "$MISSING_VCPKG" = "1" ]; then
        confirm "vcpkg" \
            "El motor usa vcpkg para SDL2 y nlohmann-json.\n\nSe clonará en $HOME/vcpkg y se dejará VCPKG_ROOT configurado." \
            || die "Sin vcpkg no se pueden resolver las dependencias del motor."
        install_vcpkg
    fi

    if [ "$MISSING_SYSTEM" = "1" ] || [ "$MISSING_NODE" = "1" ] || [ "$MISSING_VCPKG" = "1" ]; then
        check_requirements
        if [ "$MISSING_SYSTEM" = "1" ] || [ "$MISSING_NODE" = "1" ] || [ "$MISSING_VCPKG" = "1" ]; then
            die "Siguen faltando requisitos. Revisa la lista de arriba y la sección 1 del README."
        fi
    fi

    install_project

    if confirm "Menú de aplicaciones" "¿Agregar HoneyComb Engine al menú de aplicaciones?"; then
        create_desktop_entry
    fi

    printf '\n  %sListo. El editor está instalado.%s\n' "$C_GREEN$C_BOLD" "$C_RESET"
    info "./editor.sh build  -> abre el editor"
    info "./editor.sh        -> modo desarrollo, con recarga en vivo"
    info "./engine.sh        -> compila y abre el motor"

    if confirm "Abrir el editor" "¿Abrir el editor ahora?"; then
        exec "$SCRIPT_DIR/editor.sh" build
    fi
}

main "$@"
