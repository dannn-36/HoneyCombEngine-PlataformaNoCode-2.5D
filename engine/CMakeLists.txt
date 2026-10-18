cmake_minimum_required(VERSION 3.20)
# La version sale en el panel F3 de la compilacion Debug (ver game/DevTools.hpp).
project(honeycomb_engine VERSION 0.1.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(SDL2 CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)

# raylib se compila desde el codigo fuente (no via vcpkg) para usar el backend
# de ventanas SDL2 en vez de GLFW: en esta maquina, GLFW se cuelga al crear
# la ventana OpenGL (bug de interaccion GLFW + driver NVIDIA, confirmado con
# depurador: el hilo principal queda bloqueado dentro de nvoglv64.dll).
set(PLATFORM "SDL" CACHE STRING "" FORCE)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)

include(FetchContent)
FetchContent_Declare(
    raylib
    GIT_REPOSITORY https://github.com/raysan5/raylib.git
    GIT_TAG 6.0
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(raylib)

# Todo el motor menos el punto de entrada. Esta en una lista aparte para que
# las pruebas (tests/, con HONEYCOMB_BUILD_TESTS) compilen exactamente los
# mismos archivos que el ejecutable, sin el main() que abre el juego.
set(HONEYCOMB_ENGINE_SOURCES core/GraphicsDevice.cpp core/ResourceManager.cpp
    systems/iso_grid/IsoGridSystem.cpp systems/z_sort/ZSortSystem.cpp
    systems/collision/CollisionSystem.cpp systems/event_system/EventSystem.cpp
    systems/animation/AnimationSystem.cpp systems/audio/AudioSystem.cpp
    systems/input/InputSystem.cpp loader/AssetResolver.cpp loader/EventLoader.cpp
    loader/LevelLoader.cpp loader/ItemLoader.cpp game/Movement.cpp game/Combat.cpp
    game/Inventory.cpp game/Mobility.cpp game/Loot.cpp game/Zones.cpp game/CombatView.cpp
    systems/camera/CameraSystem.cpp game/EventBindings.cpp game/GameSession.cpp
    game/DevTools.cpp game/GameConfig.cpp game/Progress.cpp game/Screens.cpp game/HealthHud.cpp
    game/ExportedGame.cpp)

add_executable(engine main.cpp ${HONEYCOMB_ENGINE_SOURCES})
target_link_libraries(engine PRIVATE raylib SDL2::SDL2 nlohmann_json::nlohmann_json)
target_include_directories(engine PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

# Las dos compilaciones del motor, que el editor deja elegir (Ejecutar > Motor):
#   Debug    la version de desarrollo: sin optimizar, para el depurador, y con
#            las herramientas de administrador (F3) -> HONEYCOMB_DEV_TOOLS
#   Release  la que se juega: optimizada (-O3) y sin herramientas
# Van en carpetas distintas (engine/build y engine/build-release) para tener
# las dos listas a la vez; ver editor/ipc/engine-build.js.
target_compile_definitions(engine PRIVATE
    HONEYCOMB_VERSION="${PROJECT_VERSION}"
    HONEYCOMB_BUILD_TYPE="$<IF:$<CONFIG:Debug>,Debug,Release>"
    $<$<CONFIG:Debug>:HONEYCOMB_DEV_TOOLS>)

if(TARGET SDL2::SDL2)
    add_custom_command(TARGET engine POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<TARGET_FILE:SDL2::SDL2>" "$<TARGET_FILE_DIR:engine>"
    )
endif()

# Con MinGW el ejecutable queda enlazado a libstdc++/libgcc/libwinpthread, que
# solo estan en el bin/ del toolchain. Sin esto, engine.exe corre desde una
# shell de MSYS2 pero falla con "falta un DLL" al abrirlo con doble clic.
if(MINGW)
    get_filename_component(_mingw_bin "${CMAKE_CXX_COMPILER}" DIRECTORY)
    foreach(_dll libstdc++-6.dll libgcc_s_seh-1.dll libwinpthread-1.dll)
        if(EXISTS "${_mingw_bin}/${_dll}")
            add_custom_command(TARGET engine POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                    "${_mingw_bin}/${_dll}" "$<TARGET_FILE_DIR:engine>"
            )
        endif()
    endforeach()
endif()

# main.cpp abre "levels/..." y AssetResolver usa "assets/" como raiz: ambas
# rutas son relativas al directorio de trabajo. Copiarlas junto al binario
# hace que engine.exe funcione sin depender de donde se lo lance.
foreach(_data assets levels)
    add_custom_command(TARGET engine POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E remove_directory
            "$<TARGET_FILE_DIR:engine>/${_data}"
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${CMAKE_CURRENT_SOURCE_DIR}/../${_data}" "$<TARGET_FILE_DIR:engine>/${_data}"
    )
endforeach()

# --- Pruebas automaticas -------------------------------------------------------
# Apagadas por defecto: las compilaciones que arma el editor (engine/build y
# engine/build-release, ver editor/ipc/engine-modes.js) no las piden y quedan
# igual que siempre. Se prenden en una carpeta aparte, engine/build-tests; los
# comandos estan en tests/CMakeLists.txt.
option(HONEYCOMB_BUILD_TESTS "Compilar las pruebas del motor (doctest + CTest)" OFF)
if(HONEYCOMB_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()

# --- Rendimiento -----------------------------------------------------------------
# Tambien apagado por defecto: la sonda engine_perf (mide cada cuadro, la carga y
# la memoria, ver perf/SondaRendimiento.cpp) y el chequeo del presupuesto con
# "ctest -L perf". Va en su propia carpeta, engine/build-perf, en Release; los
# comandos estan en perf/CMakeLists.txt.
option(HONEYCOMB_BUILD_PERF "Compilar la sonda de rendimiento (engine_perf) y su chequeo de presupuesto" OFF)
if(HONEYCOMB_BUILD_PERF)
    enable_testing()
    add_subdirectory(perf)
endif()
