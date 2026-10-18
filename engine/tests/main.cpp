// =============================================================================
// Punto de entrada de las pruebas del motor
// =============================================================================
//
// Corre las pruebas dentro de una ventana OCULTA de raylib (ver
// support/HiddenWindow.cpp). Hace falta porque LevelLoader carga las texturas
// de cada entidad con LoadTexture, que sube la imagen a la GPU y necesita un
// contexto OpenGL; sin ventana, cargar cualquier nivel con entidades se caeria.
// Se abre a traves de GraphicsDevice, igual que el juego, para que
// ZSortSystem tenga con que dibujar.
//
// Ademas, una corrida que no encontro ninguna prueba (un --test-suite mal
// escrito en tests/CMakeLists.txt) termina con error en vez de pasar en blanco.
//
// Este archivo no incluye raylib.h: la implementacion de doctest trae
// windows.h, que choca con raylib.h.
// =============================================================================

#define DOCTEST_CONFIG_IMPLEMENT
#include "doctest/doctest.h"

#include <iostream>

#include "support/HiddenWindow.hpp"

namespace {

// Cuantas pruebas pasaron el filtro de la linea de comandos.
unsigned g_casesRun = 0;

struct CaseCounter : public doctest::IReporter {
    explicit CaseCounter(const doctest::ContextOptions&) {}
    void report_query(const doctest::QueryData&) override {}
    void test_run_start() override {}
    void test_run_end(const doctest::TestRunStats& stats) override {
        g_casesRun = stats.numTestCasesPassingFilters;
    }
    void test_case_start(const doctest::TestCaseData&) override {}
    void test_case_reenter(const doctest::TestCaseData&) override {}
    void test_case_end(const doctest::CurrentTestCaseStats&) override {}
    void test_case_exception(const doctest::TestCaseException&) override {}
    void subcase_start(const doctest::SubcaseSignature&) override {}
    void subcase_end() override {}
    void log_assert(const doctest::AssertData&) override {}
    void log_message(const doctest::MessageData&) override {}
    void test_case_skipped(const doctest::TestCaseData&) override {}
};

REGISTER_LISTENER("contador", 1, CaseCounter);

}  // namespace

int main(int argc, char** argv) {
    doctest::Context context;
    context.applyCommandLine(argc, argv);

    const int result = TestSupport::RunWithHiddenWindow([&context]() { return context.run(); });

    if (context.shouldExit()) {
        return result;
    }
    if (result == 0 && g_casesRun == 0) {
        std::cerr << "No se corrio ninguna prueba: revisar el filtro (--test-suite)." << std::endl;
        return 3;
    }
    return result;
}
