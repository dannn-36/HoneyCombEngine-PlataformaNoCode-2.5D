// Pruebas de ExportedGame: como reconoce el motor un juego exportado desde el
// editor, con que nivel arranca y donde guarda las partidas.

#include "doctest/doctest.h"

#include <cstdlib>
#include <string>

#include "nlohmann/json.hpp"

#include "game/ExportedGame.hpp"
#include "support/TestSupport.hpp"

using nlohmann::json;
using TestSupport::TempDir;

TEST_SUITE("juego exportado") {

TEST_CASE("sin marca no es un juego exportado: es el motor del editor") {
    TempDir dir;
    dir.WriteJson("game.json", json{{"name", "Mi juego"}});
    CHECK_FALSE(ExportedGame::Detect(dir.Path()).exported);
}

TEST_CASE("la marca dice el nombre y el nivel inicial") {
    TempDir dir;
    dir.WriteJson(ExportedGame::kMarkerFile, json{{"name", "La Cripta"}, {"startLevel", "inicio.json"}});
    const ExportedGame::Info info = ExportedGame::Detect(dir.Path());
    CHECK(info.exported);
    CHECK(info.name == "La Cripta");
    CHECK(info.startLevel == "inicio.json");
}

TEST_CASE("una marca rota sigue siendo un juego exportado, sin nombre") {
    TempDir dir;
    dir.WriteText(ExportedGame::kMarkerFile, "{ roto");
    const ExportedGame::Info info = ExportedGame::Detect(dir.Path());
    CHECK(info.exported);
    CHECK(info.name.empty());
}

TEST_CASE("arranca en el nivel inicial de la marca") {
    TempDir dir;
    dir.WriteJson("levels/a.json", json::object());
    dir.WriteJson("levels/mundo/inicio.json", json::object());
    ExportedGame::Info info;
    info.exported = true;
    info.startLevel = "mundo/inicio.json";
    CHECK(ExportedGame::StartLevel(dir.Path(), info) == dir.Path() / "levels" / "mundo" / "inicio.json");
}

TEST_CASE("sin nivel inicial valido arranca en el primero por orden alfabetico") {
    TempDir dir;
    dir.WriteJson("levels/b.json", json::object());
    dir.WriteJson("levels/a.json", json::object());
    dir.WriteText("levels/notas.txt", "no es un nivel");
    ExportedGame::Info info;
    info.exported = true;
    for (const std::string startLevel : {"", "no_existe.json", "../../fuera.json", "C:/Windows/win.ini"}) {
        info.startLevel = startLevel;
        CHECK_MESSAGE(ExportedGame::StartLevel(dir.Path(), info) == dir.Path() / "levels" / "a.json", startLevel);
    }
}

TEST_CASE("sin niveles no hay con que arrancar") {
    TempDir dir;
    ExportedGame::Info info;
    info.exported = true;
    CHECK(ExportedGame::StartLevel(dir.Path(), info).empty());
}

TEST_CASE("el nombre del juego se vuelve un nombre de carpeta valido") {
    CHECK(ExportedGame::SafeFolderName("La Cripta") == "La Cripta");
    CHECK(ExportedGame::SafeFolderName("Año: 2/3 <final>?") == "Año 23 final");
    CHECK(ExportedGame::SafeFolderName("  juego. . ") == "juego");
    CHECK(ExportedGame::SafeFolderName("") == "HoneyComb");
    CHECK(ExportedGame::SafeFolderName("???") == "HoneyComb");
    CHECK(ExportedGame::SafeFolderName("con") == "HoneyComb");
    CHECK(ExportedGame::SafeFolderName("NUL.txt") == "HoneyComb");
    CHECK(ExportedGame::SafeFolderName("Consola") == "Consola");
}

#ifdef _WIN32
TEST_CASE("las partidas del juego exportado van a appdata con su nombre") {
    const wchar_t* appData = _wgetenv(L"APPDATA");
    REQUIRE(appData != nullptr);
    CHECK(ExportedGame::UserSaveRoot("La Cripta") == std::filesystem::path(appData) / "La Cripta");
    CHECK(ExportedGame::UserSaveRoot("a/b:c") == std::filesystem::path(appData) / "abc");
}
#endif

}  // TEST_SUITE
