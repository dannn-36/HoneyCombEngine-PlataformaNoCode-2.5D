# HoneyComb Engine — Plataforma de Desarrollo NoCode 2.5D Isométrico
## Guía del Entorno de Desarrollo

---

## ⚡ Instalación rápida (asistente)

Para **instalar y probar el proyecto** no hace falta seguir las secciones 1 a 8 a mano: el repositorio incluye un asistente que revisa los requisitos, instala lo que falte (pidiendo confirmación), compila el motor y el editor, y al terminar abre el editor.

| Sistema | Qué ejecutar |
| :--- | :--- |
| **Windows** | Doble clic en **`HoneyComb-Setup.cmd`** |
| **Linux** | `./HoneyComb-Setup.sh` |

El asistente hace, en orden:

1. **Requisitos** — Git, Node.js 20+, CMake 3.20+, Ninja, compilador C++17 (MinGW-w64 vía MSYS2 en Windows) y vcpkg. Muestra qué hay y qué falta.
2. **Instalación de lo que falte** — con `winget` en Windows y `apt`/`dnf`/`pacman` en Linux; vcpkg se clona y se deja configurado en `VCPKG_ROOT`. **Cada instalación pide confirmación** antes de ejecutarse.
3. **Editor** — `npm install` y compilación de la interfaz Angular.
4. **Motor** — configuración con CMake + vcpkg y compilación en `engine/build`, con barra de progreso.
5. **Verificación** — confirma que existan `engine/build/engine.exe`, `editor/dist` y los `assets/`+`levels/` junto al binario.
6. **Fin** — crea el acceso directo (Escritorio en Windows, menú de aplicaciones en Linux) y abre el editor.

La primera vez tarda entre **10 y 25 minutos**: raylib y el motor se compilan desde el código fuente. Hace falta conexión a internet.

> **Nota sobre Windows:** el asistente es un `.cmd` y no un `.ps1` a propósito — Windows trae la *ExecutionPolicy* en `Restricted`, así que un `.ps1` no se ejecuta con doble clic. La ventana del asistente está hecha con Windows Forms, que ya viene con el sistema: tiene que poder correr **antes** de que exista Node.js. Si prefieres verlo en la consola: `HoneyComb-Setup.cmd /texto`.

### Después de instalar

| Comando | Para qué |
| :--- | :--- |
| `HoneyComb.cmd` *(Windows)* / `./editor.sh build` *(Linux)* | Abre el editor ya compilado (arranque rápido, sin dev server) |
| `editor.cmd` / `./editor.sh` | Abre el editor en modo desarrollo, con recarga en vivo |
| `engine.sh` *(Linux)* | Recompila y abre el motor por separado |

#### Debug y Release

El motor se compila de dos formas, y el editor deja elegir con cuál se ejecuta (el selector junto a **Ejecutar**, o el menú *Ejecutar*):

| Motor | Carpeta | Para qué |
| :--- | :--- | :--- |
| **Debug** | `engine/build` | La versión de desarrollo: sin optimizar (para el depurador) y con **herramientas de administrador**: `F3` abre el panel con FPS, tiempo por cuadro y sprites; `F1` grilla, `F2` hitboxes, `F4` ver el recorte de la cámara, `F6` sin tope de FPS, `F7` invencible, `F8` recargar el nivel del disco. Es la que deja el instalador. |
| **Release** | `engine/build-release` | La que se juega: optimizada (`-O3`) y sin herramientas. El editor la compila la primera vez que se pide (unos minutos), copiando la configuración de `engine/build`. |

Desde la terminal: `cmake --preset release` y `cmake --build engine/build-release` (en Linux, `--preset linux-release`).

Los dos motores dibujan solo lo que ve la cámara **más un margen de casillas por lado**: lo que está por entrar en pantalla ya está dibujado cuando aparece, y lo demás no se ordena ni se dibuja. Las colisiones, la IA y los eventos siguen corriendo en todo el nivel. El margen es de cada nivel (*Nivel › Avanzado › Casillas de margen*, `camera.cullMargin` en el JSON; 2 si no lo dice). En Debug, `F4` muestra ese límite dentro de la ventana para verlo trabajar. Para medir: `engine.exe <nivel> --bench 6` (y `--sin-recorte` para comparar; `--captura cuadro.png` guarda además el último cuadro junto al ejecutable).

#### Imagen de fondo

En *Nivel › Básico*, debajo del color de fondo, *Imagen de fondo* pone cualquier imagen del proyecto detrás del mapa (`backgroundImage` en el JSON). Llena la ventana del juego entera sea cual sea su resolución y queda quieta aunque la cámara se mueva: **Cubrir** (por defecto) no la deforma y recorta lo que sobra, **Estirar** la ajusta justo a la ventana y **Mosaico** la repite a su tamaño. Lo transparente deja ver el color de fondo.

#### Textura del piso

El piso se arma en tres capas, y cada una pisa a la anterior: **todo el nivel**, **cada sala o túnel**, y **casillas sueltas** pintadas a mano. Se cambia desde *Recursos › Texturas*: al elegir una textura aparecen *Todo el nivel*, *Una sala o túnel…* y *Pintar casillas* (clic o arrastrar pinta; `Alt` + clic devuelve la casilla a la de su sala o del nivel). En *Nivel › Piso* se ve qué tiene cada capa y se deshace. Las mejores imágenes son rombos planos 2:1 (como `floor.png` o `presentacion/piso_*.png`); se dibujan al ancho de la casilla, y una más alta que ancha se apoya en el borde de abajo de la casilla. El motor no sabe de capas: al guardar, el editor las resuelve en `visuals.floorVariants` y en `floorVariant` de cada casilla de `tiles` (ver `editor/src/app/core/floors.ts`).

#### Configuración del juego

*Archivo › Configuración del juego…* arma lo que es del **juego** y no de un nivel. Se guarda en `game.json`, en la raíz de la carpeta del editor (formato en `schema/game.schema.json`); sin ese archivo el motor arranca como siempre. Cada pestaña tiene su vista previa a la proporción de la ventana del juego:

| Pestaña | Qué se elige |
| :--- | :--- |
| **General** | Nombre del juego (título de la ventana), ícono, resolución (de una lista o a mano), pantalla completa (`F11` la alterna jugando) y el **nivel inicial** de *Nueva partida*. |
| **Portada** | Estilo **Centrado**, **Lateral** (panel tipo RPG) o **Minimalista**; título y subtítulo con su color y tamaño; fondo de color o imagen (*Cubrir*, *Estirar*, *Mosaico*); colores de las opciones; música. El menú trae *Nueva partida*, *Continuar* (si hay partida guardada), *Créditos* (si hay) y *Salir*. |
| **Pausa y créditos** | Título de la pausa (`Esc`), título y color de la pantalla de derrota, y los créditos (un renglón por línea; `# ` al principio = título de sección). |
| **HUD** | La vida como **barra**, **corazones**, **segmentos** o **número**; esquina, tamaño, colores, borde, la palabra *Vida* y el número; imágenes propias (corazón lleno/vacío, relleno y marco de la barra); y qué más se ve: monedas, inventario, barra del jefe, barras sobre las cabezas, ayuda de teclas. |
| **Progreso** | Las **variables de la partida** con su valor inicial, y la partida guardada (se puede borrar para probar desde cero). |

**Guardar la partida.** Una entidad con *Qué es › Punto de control* guarda la partida cuando el jugador pasa cerca, y la acción de evento *Guardar partida* hace lo mismo. Hay una sola partida del juego (`saves/partida.json`): *Continuar* en la portada y *Volver al punto de control* al perder la retoman con la vida, las armas, las monedas, las marcas, las variables y los objetos ya juntados. Los enemigos reaparecen, pero un evento de "una sola vez" (vencer, limpiar una zona, juntar) que ya dio su recompensa (*Dar objeto*, *Sumar monedas*, *Sumar a variable*) no la vuelve a dar. Probar con *Ejecutar* en modo **Nivel** guarda aparte, en `saves/prueba.json`. Cada guardado deja la partida anterior en `.bak`: si la partida se rompe, el juego recupera esa copia y lo avisa en pantalla.

**Variables y marcas.** Las variables duran toda la partida, aunque se cambie de nivel: *Fijar variable* y *Sumar a variable* las cambian y *Si la variable…* las compara (en el desplegable de un evento, *+ Nueva variable…* crea una). Las marcas de *Activar marca* se borran al pasar de nivel, salvo que se marque su casilla `persist`.

**Nivel o Portada al ejecutar.** Junto a *Debug / Release* hay un segundo selector, **Nivel / Portada** (también en el menú *Ejecutar*), que se recuerda entre sesiones. Con **Nivel**, *Ejecutar* y `F5` abren directo el nivel que se está editando, para probarlo rápido. Con **Portada** arrancan como el juego terminado: la portada, y *Nueva partida* empieza en el nivel inicial. `Shift+F5` arranca en el que no está elegido, sin cambiar el selector.

Los niveles, imágenes y bibliotecas que crees con el editor se guardan en **`Documentos/HoneyComb`** (la *carpeta del editor*, ver sección 7.2), no en el repositorio. Se puede cambiar desde *Archivo › Cambiar carpeta del editor…* y abrir con *Archivo › Mostrar carpeta del editor*.

El asistente **no reemplaza** la guía de abajo: si prefieres montar el entorno paso a paso, o algo falla y quieres entender qué hace cada pieza, las secciones 1 a 9 siguen siendo la referencia completa.

---

## Descripción del proyecto!

**HoneyComb Engine** es un prototipo de plataforma de desarrollo **NoCode** orientada a la creación de experiencias interactivas isométricas 2.5D de puzle y acción. El proyecto combina:

- Un **Editor de Mapas y Niveles** (interfaz de escritorio) donde el diseñador construye niveles mediante arrastrar y soltar (drag & drop) sobre una grilla isométrica, y configura la lógica del juego (eventos, condiciones, acciones) sin escribir código.
- Un **Motor de Ejecución (Runtime)** nativo de alto rendimiento, escrito en C++ sobre `raylib`, que interpreta los niveles diseñados y los ejecuta con estabilidad de fotogramas por segundo (FPS).

Ambos módulos son aplicaciones **independientes** que se comunican exclusivamente a través de un **contrato de datos en formato JSON** (`level.schema.json` y `event_catalog.json`). Este diseño *data-driven* elimina la necesidad de recompilar el motor cada vez que se modifica un nivel, y permite que el editor y el runtime evolucionen por separado.

---

## 0. Resumen de la Arquitectura del Proyecto

El proyecto está unificado para trabajar completamente desde **Visual Studio Code**, dividiendo la solución en dos módulos principales:

| Componente | Módulo | Tecnología | Función |
| :--- | :--- | :--- | :--- |
| **Editor** | `/editor` | Angular + Electron | Interfaz gráfica NoCode (canvas isométrico, eventos, gestión de tiles). |
| **Runtime** | `/engine` | C++17 + raylib 6.0 | Motor de ejecución del juego, renderizado 2.5D, Z-sorting, colisiones y lógica dirigida por JSON. |
| **Herramientas** | Transversal | CMake + vcpkg + VS Code | Construcción, depuración y gestión de paquetes. |

```
Editor (Angular/Electron)  ──►  proyecto.json / event_catalog.json  ──►  Runtime (C++/raylib)
      diseño del nivel                 contrato de datos                  ejecución nativa
```

---

## 1. Requisitos Base del Sistema

Instala estas herramientas en tu sistema operativo antes de proceder con el entorno de desarrollo:

| Herramienta | Propósito | Verificación |
| :--- | :--- | :--- |
| **Git** | Control de versiones | `git --version` |
| **Node.js (LTS v20+)** | Runtime para Angular y Electron (incluye `npm`) | `node -v` y `npm -v` |
| **CMake (3.20+)** | Sistema de construcción (*build system*) para el Motor | `cmake --version` |
| **Ninja** (recomendado) | Generador de build más rápido que el predeterminado | `ninja --version` |
| **Compilador C++17** | MinGW-w64, MSVC, GCC o Clang, según SO (ver sección 2) | Ver verificación específica por opción |
| **vcpkg** | Gestor de paquetes C++ (`raylib`, `nlohmann-json`) | `./vcpkg version` |

> **Nota:** la verificación del compilador difiere según la ruta que elijas en la sección 2 — no todos los compiladores se verifican con el mismo comando.

---

## 2. Configuración del Compilador de C++ y Herramientas

Para compilar el módulo `/engine`, necesitas una cadena de herramientas (*toolchain*) C++17 válida según tu sistema operativo. Elige **una sola opción** y sé consistente con ella en la sección 3 (vcpkg).

### Opción A: Windows vía MSYS2 (MinGW-w64) — Recomendado

> **Requisito previo:** Windows 10 de 64 bits (versión 1809 o posterior).

1. **Instalar MSYS2:** Descarga el instalador desde [msys2.org](https://www.msys2.org/). Completa la instalación en la ruta predeterminada (`C:\msys64`). Marca **Run MSYS2 now** al finalizar.
2. **Instalar el toolchain y herramientas de build:** en la consola **MSYS2 UCRT64** (no la consola MSYS genérica), ejecuta:
   ```bash
   pacman -Syu
   pacman -S --needed base-devel mingw-w64-ucrt-x86_64-toolchain \
       mingw-w64-ucrt-x86_64-cmake mingw-w64-ucrt-x86_64-ninja
   ```
   Presiona `Enter` para aceptar el grupo completo de paquetes e ingresa `Y` para proceder. Si `pacman -Syu` pide reiniciar la terminal, ciérrala y reábrela antes de continuar.
3. **Añadir MinGW-w64 al PATH del sistema:** agrega `C:\msys64\ucrt64\bin` a la variable de entorno `PATH` de Windows (Panel de Control → Variables de entorno), para que VS Code y la terminal normal de Windows encuentren `g++`, `cmake` y `ninja`.
4. **Verificación** (desde una terminal normal de Windows, no MSYS2):
   ```bash
   g++ --version
   cmake --version
   ninja --version
   ```

> **Nota sobre MSVC:** si en cambio prefieres el compilador de Microsoft (`cl.exe`), instala **Build Tools for Visual Studio** (sin el IDE completo) y usa el **"Developer Command Prompt for VS"** — `cl.exe` no funciona desde una terminal genérica, a diferencia de `g++`. Si eliges esta ruta, el triplet de vcpkg en la sección 3 es distinto (ver nota ahí).

### Opción B: Linux

```bash
sudo apt update
sudo apt install build-essential cmake ninja-build git
```
Verificación:
```bash
g++ --version
cmake --version
```

### Opción C: macOS

```bash
xcode-select --install
brew install cmake ninja
```
Verificación:
```bash
clang++ --version
cmake --version
```

---

## 3. vcpkg — Gestor de Paquetes C++

### 3.1 Clonar y arrancar vcpkg (una sola vez)
```bash
git clone https://github.com/microsoft/vcpkg.git
cd vcpkg
./bootstrap-vcpkg.sh      # Linux / macOS
.\bootstrap-vcpkg.bat     # Windows
```

### 3.2 Instalar las dependencias del motor — atención al *triplet*

⚠️ **Importante:** el *triplet* de vcpkg debe coincidir con el compilador elegido en la sección 2, o el linkeo del motor fallará por incompatibilidad de ABI.

- Si usas **MinGW-w64 (Opción A recomendada)**:
  ```bash
  ./vcpkg install raylib nlohmann-json --triplet x64-mingw-dynamic
  ```
- Si usas **MSVC**:
  ```bash
  ./vcpkg install raylib nlohmann-json --triplet x64-windows
  ```
- Si usas **Linux/macOS**, el triplet por defecto (`x64-linux` / `x64-osx` / `arm64-osx`) es correcto sin flags adicionales:
  ```bash
  ./vcpkg install raylib nlohmann-json
  ```

Para no repetir el flag `--triplet` en cada comando, puedes fijarlo como variable de entorno:
```bash
export VCPKG_DEFAULT_TRIPLET=x64-mingw-dynamic   # ajusta según tu caso
```

### 3.3 Fijar la versión de raylib

Todo el diseño de arquitectura de este proyecto parte específicamente del diagrama **raylib 6.0**. Para evitar compilar contra una versión distinta sin darte cuenta, fija la versión en el manifiesto de vcpkg (`vcpkg.json` dentro de `/engine`):
```json
{
  "name": "honeycomb-engine",
  "version": "0.1.0",
  "dependencies": [
    { "name": "raylib", "version>=": "6.0" },
    "nlohmann-json"
  ]
}
```
Con un `vcpkg.json` presente, vcpkg trabaja en **modo manifiesto**: instala automáticamente las versiones correctas al configurar el proyecto con CMake, sin necesidad de correr `vcpkg install` manualmente cada vez.

---

## 4. VS Code — Extensiones Necesarias

### 4.1 Para el Runtime (C++ / raylib / CMake)
| Extensión | ID | Función |
| :--- | :--- | :--- |
| C/C++ | `ms-vscode.cpptools` | IntelliSense, depuración y navegación de código C++ |
| CMake Tools | `ms-vscode.cmake-tools` | Configurar, compilar y depurar el proyecto CMake |
| CMake Language Support | `twxs.cmake` | Resaltado de sintaxis de `CMakeLists.txt` |
| CodeLLDB *(opcional, Linux/macOS)* | `vadimcn.vscode-lldb` | Depurador alternativo a GDB |

### 4.2 Para el Editor (Angular / Electron / TypeScript)
| Extensión | ID | Función |
| :--- | :--- | :--- |
| Angular Language Service | `Angular.ng-template` | Autocompletado y validación de templates Angular |
| ESLint | `dbaeumer.vscode-eslint` | Linting de TypeScript/JavaScript |
| Prettier — Code formatter | `esbenp.prettier-vscode` | Formateo consistente de código |
| *(Incluido por defecto)* JavaScript Debugger | `ms-vscode.js-debug` | Depuración de Node/Electron sin instalación adicional |

### 4.3 Transversales / equipo
| Extensión | ID | Función |
| :--- | :--- | :--- |
| GitLens | `eamodio.gitlens` | Historial y blame de Git enriquecido |
| Error Lens | `usernamehw.errorlens` | Resalta errores/warnings inline |
| Live Share *(opcional)* | `ms-vsliveshare.vsliveshare` | Colaboración en tiempo real |

---

## 5. Configuración del módulo `/engine` (Runtime C++/raylib)

### 5.1 `CMakeLists.txt`
```cmake
cmake_minimum_required(VERSION 3.20)
project(honeycomb_engine CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(raylib CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)

add_executable(engine main.cpp)
target_link_libraries(engine PRIVATE raylib nlohmann_json::nlohmann_json)
```

### 5.2 Conectar VS Code con el toolchain de vcpkg
El proyecto usa `/engine/CMakePresets.json` (versionado en el repo) para apuntar al toolchain de vcpkg a través de la variable de entorno `VCPKG_ROOT`, en vez de una ruta fija — así cada persona del equipo puede tener vcpkg clonado donde quiera, sin tocar ningún archivo versionado.

Define `VCPKG_ROOT` una sola vez en tu máquina, apuntando a donde clonaste vcpkg en la sección 3:
```powershell
[Environment]::SetEnvironmentVariable("VCPKG_ROOT", "C:\ruta\a\tu\vcpkg", "User")
```
(cierra y vuelve a abrir la terminal/VS Code para que tome la variable). `CMakePresets.json` ya trae dos presets listos: `default` (MinGW-w64, `x64-mingw-dynamic`) y `msvc` (`x64-windows`) — CMake Tools los detecta automáticamente al abrir `/engine`.

### 5.3 Flujo de trabajo en VS Code
1. Abrir la carpeta `/engine` en VS Code.
2. `CMake Tools` detecta el `CMakeLists.txt` y pide seleccionar un **kit** (el compilador detectado: GCC/MinGW, Clang o MSVC).
3. `Ctrl+Shift+P → CMake: Configure`, luego `CMake: Build`.
4. Depurar con `F5` (CMake Tools genera el `launch.json` automáticamente).

### 5.4 Herramientas de calidad de memoria (mitigan el riesgo de "gestión manual de memoria")
- **AddressSanitizer (ASan):** agrega `-fsanitize=address` (GCC/Clang) a los flags de compilación en modo Debug.
- **Valgrind** *(solo Linux)*: análisis de leaks más exhaustivo.
- **Catch2** o **GoogleTest** *(instalables vía vcpkg)*: pruebas unitarias de `LevelLoader`, `ZSortSystem`, `EventSystem`.

---

## 6. Configuración del módulo `/editor` (Angular + Electron)

### 6.1 Instalar Angular CLI
```bash
npm install -g @angular/cli
```
Verificación: `ng version`.

### 6.2 Crear el proyecto Angular
```bash
ng new editor --routing --style=scss
cd editor
```

### 6.3 Añadir Electron
```bash
npm install --save-dev electron electron-builder
```
- **electron** → runtime de escritorio que envuelve la app Angular.
- **electron-builder** → empaquetado final (`.exe`, `.dmg`, `.AppImage`).

Se necesita un `main.js` (proceso principal de Electron) que cargue el build de Angular (`dist/editor/index.html`) dentro de una `BrowserWindow`, y un `preload.js` que exponga de forma segura el acceso al sistema de archivos vía `contextBridge` (para guardar/abrir proyectos `.json` en disco).

### 6.4 Librerías adicionales según necesidades del editor

Al empezar se evaluaron estas librerías. Ninguna terminó usándose, y se quitaron de `package.json` para no cargar dependencias muertas:

| Necesidad del proyecto | Se evaluó | Cómo se resolvió |
| :--- | :--- | :--- |
| Drag & drop de tiles/entidades en el canvas isométrico | `@angular/cdk` (`DragDropModule`) | Drag & drop nativo de HTML5 (`dataTransfer`) sobre el canvas |
| Formularios de configuración de eventos (Trigger→Condición→Acción) | `Reactive Forms` (`@angular/forms`) | Campos enlazados a signals; el panel se arma a partir de los `params` del catálogo |
| Validación del JSON contra `level.schema.json` / `event_catalog.json` | `ajv` (JSON Schema validator) | `parseLevel()` en `ProjectService` valida lo que el editor necesita al abrir |
| Navegación entre pantallas | `@angular/router` | No hace falta: el editor es una sola pantalla. Si se agrega otra, va en `app.config.ts` con `withHashLocation()` |

### 6.5 Testing del Editor
- **Jasmine + Karma** (incluidos por defecto con `ng new`) para pruebas unitarias de componentes.
- **Playwright** para pruebas end-to-end sobre la app Electron ya empaquetada.

### 6.6 Capa de lógica del editor (previa a los componentes visuales)

Antes de construir canvas/paneles, el editor tiene una capa de lógica sin UI, espejo del mismo contrato de datos que usa el runtime C++:

- **`main.js` / `preload.js` / `ipc/`** — API de proyecto vía `contextBridge`. La raíz es siempre la **carpeta del editor** (ver sección 7.2): ya no se elige ni se deduce. `readFile`/`writeFile`/`listDir`/`createDir` usan rutas relativas a ella, y el proceso principal (`ipc/project-root.js`) valida que ninguna se salga antes de tocar el disco. Abrir un nivel de afuera o importar una imagen los **copia** adentro.
- **`src/app/models/`** — interfaces TypeScript espejo de `level.schema.json` y `event_catalog.json` (`level.model.ts`, `event-catalog.model.ts`). Cualquier campo nuevo se agrega primero al schema, y aquí y en `LevelLoader.cpp` en simultáneo.
- **`src/app/core/iso-projection.ts`** — espejo exacto en TypeScript de `IsoGridSystem::GridToScreen`/`ScreenToGrid` (C++), para que el canvas ubique las entidades en pantalla de la misma forma que el runtime.
- **`src/app/services/`**:
  - `ProjectService` — único punto de contacto con la API de Electron; el resto del editor nunca llama `window.honeycombProject` directamente.
  - `CatalogService` — carga `event_catalog.json` una vez y lo deja disponible para consulta (qué triggers/condiciones/acciones existen, con qué parámetros).
  - `LevelService` — mantiene el nivel abierto en memoria (signals de Angular) y expone las operaciones para modificarlo (agregar/actualizar/quitar entidades y eventos); ningún componente visual muta el objeto `Level` directamente.

El panel de eventos que se construya sobre `CatalogService` debe generar sus formularios **dinámicamente** a partir de los `params` de cada entrada del catálogo (no un formulario fijo por tipo) — es el equivalente en el editor del patrón de registro que usa `EventSystem` en C++: agregar un bloque nuevo al catálogo no debería requerir tocar código Angular.

---

## 7. Estructura de Carpetas del Proyecto

Hay dos carpetas distintas, y no hay que confundirlas:

- **El repositorio** (lo que está en git): el código del editor y del motor, los schemas y el contenido de ejemplo.
- **La carpeta del editor**: donde el editor guarda y lee **todo** el trabajo del diseñador. Por defecto es `Documentos/HoneyComb`, y se cambia desde *Archivo › Cambiar carpeta del editor…*. El editor nunca lee ni escribe fuera de ella: lo que viene de afuera (una imagen, un nivel de Descargas) se **copia** adentro, y el original no se toca.

### 7.1 El repositorio

```
/honeycomb-engine
├── editor/                        # Angular + Electron
│   ├── src/app/
│   │   ├── app.ts / app.html        # Shell: menús, atajos, áreas fijas y cableado
│   │   ├── dialogs/                 # Diálogos grandes, cargados con @defer al abrirlos
│   │   ├── models/                  # Espejo TS de level.schema.json / event_catalog.json
│   │   ├── core/                    # Lógica pura con tests (iso-projection.ts, texture-fit.ts...)
│   │   ├── services/                # ProjectService, CatalogService, LevelService...
│   │   ├── textures/                # Biblioteca de texturas, miniaturas bajo demanda, convertidor
│   │   ├── sprites/                 # Herramienta de sprites (pixel art con capas y cuadros, @defer)
│   │   ├── project/                 # El nivel como documento y el explorador de archivos
│   │   ├── viewport/ entities/ map/ selection/ palette/ inspector/
│   │   ├── characters/ combat/ events/ ui/ menu-bar/
│   │   └── electron-api.d.ts        # Tipos de la API que expone preload.js
│   ├── ipc/                         # Proceso principal: un módulo por dominio
│   │   ├── project-root.js          # Carpeta del editor y barrera de rutas
│   │   ├── workspace.js             # Cuál es, cambiarla, catálogo de eventos
│   │   ├── levels.js                # Abrir / importar niveles
│   │   ├── files.js                 # Leer, escribir, listar, crear carpetas
│   │   ├── convert.js               # Importar imágenes (PNG, JPG, JPEG → PNG)
│   │   ├── textures.js              # Guardar el PNG de la herramienta de sprites
│   │   ├── run.js                   # Lanzar engine.exe
│   │   └── names.js / media-types.js
│   ├── main.js                      # Proceso principal de Electron (ventana y registro de IPC)
│   └── preload.js                   # Puente seguro renderer <-> sistema de archivos
├── engine/                        # C++17 / raylib (backend SDL2)
│   ├── core/                        # Capa 1: GraphicsDevice, ResourceManager (únicos que hablan con raylib)
│   ├── systems/                     # Capa 2: lógica reutilizable, sin saber de niveles
│   │   ├── iso_grid/  z_sort/  collision/  event_system/
│   │   └── animation/  audio/  input/  camera/
│   ├── loader/                      # Capa 3: LevelLoader, EventLoader, ItemLoader, AssetResolver
│   ├── game/                        # Capa 4: GameSession, Movement, Mobility, Combat, Inventory, Loot, Zones...
│   ├── world/                       # Modelo compartido: Level, ItemDefs
│   ├── vcpkg.json                   # Manifiesto de dependencias (sdl2, nlohmann-json; raylib se compila vía FetchContent)
│   ├── CMakePresets.json            # Toolchain de vcpkg vía $env{VCPKG_ROOT} (portable entre máquinas)
│   ├── CMakeLists.txt
│   └── main.cpp
├── schema/                        # Contrato entre editor y runtime (es del programa, no de cada proyecto)
│   ├── level.schema.json            # Contrato de niveles
│   └── event_catalog.json           # Catálogo de triggers/condiciones/acciones
├── docs/architecture/             # Diagramas PlantUML (contexto, componentes, secuencias)
├── tools/                         # Generadores de niveles y sprites, asistente de instalación
├── assets/                        # Contenido de ejemplo (se copia a la carpeta del editor la primera vez)
├── levels/                        # Niveles de ejemplo (ídem)
└── characters.json / items.json   # Bibliotecas de ejemplo (ídem)
```

### 7.2 La carpeta del editor

```
Documentos/HoneyComb/              # o la que se elija en Archivo › Cambiar carpeta del editor…
├── levels/                        # Los niveles (.json). Guardar y Guardar como escriben acá
├── assets/
│   ├── textures/                  # Imágenes ya convertidas a PNG, con nombres que el motor puede abrir
│   └── sounds/
├── characters.json                # Personajes configurados
├── items.json                     # Biblioteca de objetos
├── game.json                      # Configuración del juego: ventana, portada, HUD, variables
└── saves/partida.json             # La partida guardada (la escribe el juego, no el editor)
```

La primera vez que se abre el editor, si esta carpeta no existe, se crea con una **copia** de `levels/`, `assets/`, `characters.json` e `items.json` del repositorio. El runtime no necesita saber nada de esto: busca los assets en `<nivel>/../../assets`, así que un nivel guardado en `levels/` corre tal cual. La carpeta elegida se recuerda en `honeycomb-settings.json`, dentro de los datos de Electron.

---

## 8. Checklist de Instalación (orden recomendado)

1. [ ] Instalar **Git**.
2. [ ] Instalar **Node.js LTS** (v20+).
3. [ ] Instalar **VS Code**.
4. [ ] Instalar las extensiones de VS Code de la sección 4 (Runtime, Editor y Transversales).
5. [ ] Elegir e instalar el **compilador C++17** según tu SO (sección 2 — Opción A, B o C).
6. [ ] Instalar **CMake** y **Ninja** (si no vinieron incluidos con la opción elegida en el paso 5).
7. [ ] Clonar y arrancar **vcpkg** (`bootstrap-vcpkg`).
8. [ ] Confirmar el **triplet correcto** de vcpkg según el compilador elegido (sección 3.2).
9. [ ] Clonar el repositorio del proyecto (`honeycomb-engine`).
10. [ ] Crear/confirmar `vcpkg.json` en `/engine` con `raylib >= 6.0` y `nlohmann-json`.
11. [ ] Abrir `/engine` en VS Code → configurar `cmake.configureArgs` con la ruta al toolchain de vcpkg (sección 5.2).
12. [ ] `CMake: Configure` → `CMake: Build` en `/engine`. Confirmar que compila sin errores.
13. [ ] Instalar `@angular/cli` globalmente.
14. [ ] Dentro de `/editor`: `npm install` (Angular, Electron, electron-builder, Vitest).
15. [ ] Levantar el editor en modo desarrollo (`ng serve` + `electron .`) y confirmar que abre la ventana de escritorio.
16. [ ] Verificar que ambos módulos (`/editor` y `/engine`) compilan/corren **de forma independiente** antes de conectar el flujo de niveles JSON entre ambos.

---

## 9. Verificación Final (smoke test)

Antes de empezar a desarrollar funcionalidades, confirma este flujo mínimo end-to-end:

1. El editor Angular/Electron abre y permite guardar un archivo `.json` de prueba en disco.
2. El runtime C++/raylib abre una ventana (`InitWindow`) sin errores de linkeo.
3. El runtime puede leer y parsear ese mismo `.json` de prueba usando `nlohmann::json`, sin necesidad de recompilar el motor si el archivo cambia.

Si los tres puntos funcionan, el entorno está listo para empezar a implementar los sistemas del motor (`IsoGridSystem`, `ZSortSystem`, `CollisionSystem`, `EventSystem`) y las pantallas del editor.

---

## 10. Sistema de combate, objetos, inventario y puzzles

El editor arma el combate sin código y el runtime lo ejecuta desde el mismo JSON:

- **Armas** cuerpo a cuerpo y a distancia con seis formas de ataque: lineal, área, reloj (sector), proyectil, área remota con alcance máximo y proyectil explosivo con daño de área.
- **Habilidades** que se cargan acertando golpes, con contador por arma, lanzamiento automático o con Q, y pérdida del contador por tiempo.
- **Movilidad:** esquive con i-frames y defensa que reduce el daño.
- **Objetos:** armas, curaciones y monedas. Los enemigos pueden soltar botín con probabilidad y los NPC pueden tener tienda.
- **Inventario** de 1 a 9 armas con límite bloqueable y reemplazo automático, manual o bloqueado.
- **Puzzles de sala:** vencer a un jefe, completar una recolección o limpiar una zona para abrir el paso, más eventos con condiciones.

Guía completa (modelo de datos, eventos, controles): [`docs/sistema-de-combate.md`](docs/sistema-de-combate.md).
Nivel de ejemplo: `levels/combate_demo.json`, con la biblioteca `items.json`.
