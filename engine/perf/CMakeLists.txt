# =============================================================================
# Sonda de rendimiento del motor (engine_perf) y chequeo del presupuesto
# =============================================================================
#
# Solo con -DHONEYCOMB_BUILD_PERF=ON, en una carpeta propia y en Release (el
# protocolo mide la compilacion que se juega). Desde la raiz del repositorio,
# en la terminal de MSYS2 UCRT64:
#
#   cmake -S engine -B engine/build-perf -G Ninja -DCMAKE_BUILD_TYPE=Release
#         -DCMAKE_TOOLCHAIN_FILE=<vcpkg>/scripts/buildsystems/vcpkg.cmake
#         -DVCPKG_TARGET_TRIPLET=x64-mingw-dynamic -DHONEYCOMB_BUILD_PERF=ON
#   cmake --build engine/build-perf --target engine_perf
#   node tools/gen-escenas-rendimiento.mjs          (escenas en engine/build-perf/escenas)
#   node tools/medir-rendimiento.mjs protocolo      (el protocolo 6.5 entero)
#   ctest --test-dir engine/build-perf -L perf --output-on-failure   (presupuesto)
#
# engine_perf compila los MISMOS archivos que engine.exe (HONEYCOMB_ENGINE_SOURCES)
# con las mismas definiciones; ver SondaRendimiento.cpp para lo que mide.
# Las pruebas de CTest de aca llevan la etiqueta "perf" y viven en esta carpeta:
# las pruebas unitarias (engine/build-tests) no las corren.
# =============================================================================

list(TRANSFORM HONEYCOMB_ENGINE_SOURCES PREPEND "${PROJECT_SOURCE_DIR}/" OUTPUT_VARIABLE _engine_sources)

add_executable(engine_perf SondaRendimiento.cpp Proceso.cpp ${_engine_sources})
target_link_libraries(engine_perf PRIVATE raylib SDL2::SDL2 nlohmann_json::nlohmann_json)
target_include_directories(engine_perf PRIVATE "${PROJECT_SOURCE_DIR}")
target_compile_definitions(engine_perf PRIVATE
    HONEYCOMB_VERSION="${PROJECT_VERSION}"
    HONEYCOMB_BUILD_TYPE="$<IF:$<CONFIG:Debug>,Debug,Release>"
    $<$<CONFIG:Debug>:HONEYCOMB_DEV_TOOLS>)
if(WIN32)
    target_link_libraries(engine_perf PRIVATE psapi)
endif()

# Junto a engine.exe y con las mismas DLL al lado (ver ../CMakeLists.txt).
set_target_properties(engine_perf PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
if(TARGET SDL2::SDL2)
    add_custom_command(TARGET engine_perf POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<TARGET_FILE:SDL2::SDL2>" "$<TARGET_FILE_DIR:engine_perf>")
endif()
if(MINGW)
    get_filename_component(_mingw_bin "${CMAKE_CXX_COMPILER}" DIRECTORY)
    foreach(_dll libstdc++-6.dll libgcc_s_seh-1.dll libwinpthread-1.dll)
        if(EXISTS "${_mingw_bin}/${_dll}")
            add_custom_command(TARGET engine_perf POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                    "${_mingw_bin}/${_dll}" "$<TARGET_FILE_DIR:engine_perf>")
        endif()
    endforeach()
endif()

# --- Presupuesto de rendimiento (ctest -L perf) ---------------------------------
# Genera la escena de 500 entidades del protocolo y la corre 60 s con el
# jugador caminando; falla si no cumple M-01 (>= 60 FPS de promedio y >= 45 en
# el 1% mas lento), M-02 (carga <= 2 s) o M-03 (pico <= 256 MB). Lo medido
# queda en la salida de la prueba (lineas PRESUPUESTO y PERF): ctest -V lo muestra.
find_program(HONEYCOMB_NODE node)
get_filename_component(_repo_dir "${PROJECT_SOURCE_DIR}/.." ABSOLUTE)
set(_escenas "${CMAKE_BINARY_DIR}/escenas")
if(HONEYCOMB_NODE)
    add_test(NAME "rendimiento: generar escenas"
        COMMAND "${HONEYCOMB_NODE}" "${_repo_dir}/tools/gen-escenas-rendimiento.mjs"
            --salida "${_escenas}" --solo protocolo)
    set_tests_properties("rendimiento: generar escenas" PROPERTIES
        LABELS perf FIXTURES_SETUP escenas_rendimiento TIMEOUT 120)

    add_test(NAME "rendimiento: presupuesto 500 entidades"
        COMMAND engine_perf "${_escenas}/levels/rend_e0500.json" --segundos 60 --presupuesto
        WORKING_DIRECTORY "${CMAKE_BINARY_DIR}")
    set_tests_properties("rendimiento: presupuesto 500 entidades" PROPERTIES
        LABELS perf FIXTURES_REQUIRED escenas_rendimiento TIMEOUT 180)
else()
    message(STATUS "HoneyComb: sin node en el PATH, no se agrega el chequeo de presupuesto (ctest -L perf)")
endif()
