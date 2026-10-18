# =============================================================================
# Pruebas automaticas del motor (doctest + CTest)
# =============================================================================
#
# Se compilan solo con -DHONEYCOMB_BUILD_TESTS=ON, en una carpeta propia para
# no tocar engine/build ni engine/build-release, que son las que usa el editor.
# Desde la raiz del repositorio, en la terminal de MSYS2 UCRT64:
#
#   cmake -S engine -B engine/build-tests -G Ninja -DCMAKE_BUILD_TYPE=Debug
#         -DCMAKE_TOOLCHAIN_FILE=<vcpkg>/scripts/buildsystems/vcpkg.cmake
#         -DVCPKG_TARGET_TRIPLET=x64-mingw-dynamic -DHONEYCOMB_BUILD_TESTS=ON
#   cmake --build engine/build-tests --target engine_tests
#   ctest --test-dir engine/build-tests --output-on-failure
#
# Cobertura: lo mismo en engine/build-coverage agregando -DHONEYCOMB_COVERAGE=ON
# (instrumenta con --coverage solo el ejecutable de pruebas, no el motor).
#
# Las pruebas compilan los MISMOS archivos que el motor (HONEYCOMB_ENGINE_SOURCES,
# ver ../CMakeLists.txt) con las mismas definiciones, y les suman su propio
# main(): ese main abre una ventana OCULTA de raylib antes de correr, porque
# LevelLoader sube las texturas a la GPU (LoadTexture necesita un contexto
# OpenGL) y ZSortSystem dibuja. Sin ventana, cargar un nivel se caeria.
# =============================================================================

option(HONEYCOMB_COVERAGE "Instrumentar las pruebas para medir cobertura (gcov)" OFF)

include(FetchContent)
# doctest es un solo encabezado; se fija la version para que las pruebas den
# lo mismo en cualquier maquina.
set(DOCTEST_WITH_TESTS OFF CACHE BOOL "" FORCE)
set(DOCTEST_WITH_MAIN_IN_STATIC_LIB OFF CACHE BOOL "" FORCE)
set(DOCTEST_NO_INSTALL ON CACHE BOOL "" FORCE)
FetchContent_Declare(
    doctest
    GIT_REPOSITORY https://github.com/doctest/doctest.git
    GIT_TAG v2.4.12
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(doctest)

list(TRANSFORM HONEYCOMB_ENGINE_SOURCES PREPEND "${PROJECT_SOURCE_DIR}/" OUTPUT_VARIABLE _engine_sources)

set(HONEYCOMB_TEST_SOURCES
    main.cpp
    support/TestSupport.cpp
    support/HiddenWindow.cpp
    test_asset_resolver.cpp
    test_resource_manager.cpp
    test_level_loader.cpp
    test_event_loader.cpp
    test_item_loader.cpp
    test_event_system.cpp
    test_event_bindings.cpp
    test_iso_grid.cpp
    test_collision.cpp
    test_zsort.cpp
    test_camera.cpp
    test_animation.cpp
    test_movement.cpp
    test_mobility.cpp
    test_combat.cpp
    test_inventory.cpp
    test_loot.cpp
    test_zones.cpp
    test_game_config.cpp
    test_progress.cpp
    test_exported_game.cpp
    test_contract.cpp
    test_security.cpp
)

add_executable(engine_tests ${HONEYCOMB_TEST_SOURCES} ${_engine_sources})
target_link_libraries(engine_tests PRIVATE raylib SDL2::SDL2 nlohmann_json::nlohmann_json doctest::doctest)
target_include_directories(engine_tests PRIVATE "${PROJECT_SOURCE_DIR}" "${CMAKE_CURRENT_SOURCE_DIR}")

# La raiz del repositorio, para leer levels/, assets/ y tests/contract/ en
# tiempo de ejecucion sin copiarlos.
get_filename_component(_repo_dir "${PROJECT_SOURCE_DIR}/.." ABSOLUTE)
target_compile_definitions(engine_tests PRIVATE
    HONEYCOMB_VERSION="${PROJECT_VERSION}"
    HONEYCOMB_BUILD_TYPE="$<IF:$<CONFIG:Debug>,Debug,Release>"
    $<$<CONFIG:Debug>:HONEYCOMB_DEV_TOOLS>
    HONEYCOMB_REPO_DIR="${_repo_dir}")

if(HONEYCOMB_COVERAGE AND CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
    target_compile_options(engine_tests PRIVATE --coverage -O0 -fno-inline)
    target_link_options(engine_tests PRIVATE --coverage)
endif()

# El ejecutable va junto a engine.exe y con las mismas DLL al lado, por la
# misma razon que el motor (ver ../CMakeLists.txt): sin ellas no arranca fuera
# de una shell de MSYS2.
set_target_properties(engine_tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
if(TARGET SDL2::SDL2)
    add_custom_command(TARGET engine_tests POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<TARGET_FILE:SDL2::SDL2>" "$<TARGET_FILE_DIR:engine_tests>")
endif()
if(MINGW)
    get_filename_component(_mingw_bin "${CMAKE_CXX_COMPILER}" DIRECTORY)
    foreach(_dll libstdc++-6.dll libgcc_s_seh-1.dll libwinpthread-1.dll)
        if(EXISTS "${_mingw_bin}/${_dll}")
            add_custom_command(TARGET engine_tests POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                    "${_mingw_bin}/${_dll}" "$<TARGET_FILE_DIR:engine_tests>")
        endif()
    endforeach()
endif()

# Una prueba de CTest por suite de doctest: asi ctest muestra que parte del
# motor fallo. Los nombres tienen que coincidir con los TEST_SUITE(...) de
# cada archivo (main.cpp hace fallar una corrida que no encontro pruebas).
set(HONEYCOMB_TEST_SUITES
    "rutas de assets"
    "cargador de niveles"
    "cargador de eventos"
    "cargador de objetos"
    "sistema de eventos"
    "enlaces de eventos"
    "grilla isometrica"
    "colisiones"
    "orden de dibujo"
    "camara"
    "animaciones"
    "movimiento"
    "movilidad del jugador"
    "combate"
    "inventario"
    "objetos y tienda"
    "zonas"
    "configuracion del juego"
    "partida guardada"
    "contrato json"
    "seguridad"
)
foreach(_suite IN LISTS HONEYCOMB_TEST_SUITES)
    add_test(NAME "${_suite}"
        COMMAND engine_tests "--test-suite=${_suite}" --no-intro --no-version
        WORKING_DIRECTORY "${CMAKE_BINARY_DIR}")
endforeach()
