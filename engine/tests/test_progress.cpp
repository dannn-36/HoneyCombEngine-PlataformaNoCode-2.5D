// Pruebas de Progress: escribir y leer la partida guardada
// (<raiz>/saves/partida.json).

#include "doctest/doctest.h"

#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>

#include "nlohmann/json.hpp"

#include "game/Progress.hpp"
#include "support/TestSupport.hpp"

using TestSupport::TempDir;

TEST_SUITE("partida guardada") {

TEST_CASE("la partida vive en saves partida json") {
    const std::filesystem::path root("proyecto");
    CHECK(Progress::SavePath(root) == root / "saves" / "partida.json");
}

TEST_CASE("sin partida no hay nada para continuar") {
    TempDir dir;
    SaveData data;
    CHECK_FALSE(Progress::Exists(dir.Path()));
    CHECK_FALSE(Progress::Load(dir.Path(), data));
}

TEST_CASE("una partida escrita se lee igual") {
    TempDir dir;
    SaveData out;
    out.level = "nivel2.json";
    out.hasPosition = true;
    out.position = Vector2{3.5f, 7.25f};
    out.health = 42.0f;
    out.coins = 17;
    out.weapons = {"espada", "arco"};
    out.activeWeapon = 1;
    out.levelFlags = {"puerta_abierta"};
    out.gameFlags = {"jefe_vencido"};
    out.variables = {{"llaves", 2.0f}, {"puntos", 150.5f}};
    REQUIRE(Progress::Write(dir.Path(), out));
    CHECK(Progress::Exists(dir.Path()));

    SaveData in;
    REQUIRE(Progress::Load(dir.Path(), in));
    CHECK(in.level == "nivel2.json");
    CHECK(in.hasPosition);
    CHECK(in.position.x == doctest::Approx(3.5f));
    CHECK(in.position.y == doctest::Approx(7.25f));
    CHECK(in.health == doctest::Approx(42.0f));
    CHECK(in.coins == 17);
    CHECK(in.weapons == out.weapons);
    CHECK(in.activeWeapon == 1);
    CHECK(in.levelFlags == out.levelFlags);
    CHECK(in.gameFlags == out.gameFlags);
    CHECK(in.variables.size() == 2);
    CHECK(in.variables.at("puntos") == doctest::Approx(150.5f));
}

TEST_CASE("una partida sin posicion arranca donde dice el nivel") {
    TempDir dir;
    SaveData out;
    out.level = "a.json";
    REQUIRE(Progress::Write(dir.Path(), out));
    SaveData in;
    REQUIRE(Progress::Load(dir.Path(), in));
    CHECK_FALSE(in.hasPosition);
    CHECK(in.health == doctest::Approx(-1.0f));
    CHECK(in.activeWeapon == -1);
}

TEST_CASE("guardar de nuevo reemplaza la partida anterior") {
    TempDir dir;
    SaveData first;
    first.level = "a.json";
    first.coins = 1;
    Progress::Write(dir.Path(), first);
    SaveData second;
    second.level = "b.json";
    second.coins = 2;
    Progress::Write(dir.Path(), second);
    SaveData in;
    REQUIRE(Progress::Load(dir.Path(), in));
    CHECK(in.level == "b.json");
    CHECK(in.coins == 2);
}

TEST_CASE("una partida rota se ignora sin romper") {
    TempDir dir;
    dir.WriteText("saves/partida.json", "{ \"level\": ");
    SaveData data;
    data.coins = 99;
    CHECK_FALSE(Progress::Load(dir.Path(), data));
    CHECK(data.coins == 99);  // no se toca lo que habia
}

TEST_CASE("una partida sin nivel no sirve para continuar") {
    TempDir dir;
    dir.WriteText("saves/partida.json", "{ \"coins\": 3 }");
    SaveData data;
    CHECK_FALSE(Progress::Load(dir.Path(), data));
}

TEST_CASE("una partida con un tipo equivocado se ignora sin romper") {
    TempDir dir;
    dir.WriteText("saves/partida.json", "{ \"level\": \"a.json\", \"coins\": \"muchas\" }");
    SaveData data;
    CHECK_FALSE(Progress::Load(dir.Path(), data));
}

TEST_CASE("las variables que no son numeros se descartan al leer") {
    TempDir dir;
    dir.WriteText("saves/partida.json",
                  "{ \"level\": \"a.json\", \"variables\": { \"x\": 1, \"y\": \"dos\", \"z\": true } }");
    SaveData data;
    REQUIRE(Progress::Load(dir.Path(), data));
    CHECK(data.variables.size() == 1);
    CHECK(data.variables.count("x") == 1);
}

TEST_CASE("no poder escribir la partida se informa") {
    TempDir dir;
    // "saves" ya existe como ARCHIVO: no se puede crear la carpeta.
    dir.WriteText("saves", "no soy una carpeta");
    SaveData out;
    out.level = "a.json";
    CHECK_FALSE(Progress::Write(dir.Path(), out));
}

// --- Escritura segura y copia anterior ------------------------------------------

namespace {

SaveData SaveIn(const std::string& level, int coins) {
    SaveData data;
    data.level = level;
    data.coins = coins;
    return data;
}

std::string ReadAll(const std::filesystem::path& path) {
    std::ifstream stream(path, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>());
}

}  // namespace

TEST_CASE("la partida se escribe con su version") {
    TempDir dir;
    REQUIRE(Progress::Write(dir.Path(), SaveIn("a.json", 1)));
    const auto saved = nlohmann::json::parse(ReadAll(Progress::SavePath(dir.Path())));
    CHECK(saved.at("version") == Progress::kVersion);
}

TEST_CASE("lo que evita repetir recompensas se lee igual") {
    TempDir dir;
    SaveData out = SaveIn("a.json", 1);
    out.checkpoint = "cp_1";
    out.collectedItems = {"moneda_1", "llave"};
    out.collectedCounts = {{"moneda", 3}, {"llave", 1}};
    out.collectedTotal = 4;
    out.firedEvents = {"0123456789abcdef", "fedcba9876543210#2"};
    REQUIRE(Progress::Write(dir.Path(), out));

    SaveData in;
    REQUIRE(Progress::Load(dir.Path(), in));
    CHECK(in.checkpoint == "cp_1");
    CHECK(in.collectedItems == out.collectedItems);
    CHECK(in.collectedCounts == out.collectedCounts);
    CHECK(in.collectedTotal == 4);
    CHECK(in.firedEvents == out.firedEvents);
}

TEST_CASE("una partida de antes de la version se sigue leyendo") {
    TempDir dir;
    dir.WriteText("saves/partida.json", "{ \"level\": \"a.json\", \"coins\": 5 }");
    SaveData in;
    Progress::LoadStatus status = Progress::LoadStatus::Missing;
    REQUIRE(Progress::Load(dir.Path(), in, Progress::kGameSlot, &status));
    CHECK(status == Progress::LoadStatus::Loaded);
    CHECK(in.coins == 5);
    CHECK(in.collectedItems.empty());
}

TEST_CASE("guardar no deja el temporal y la partida anterior queda en bak") {
    TempDir dir;
    REQUIRE(Progress::Write(dir.Path(), SaveIn("a.json", 1)));
    CHECK_FALSE(std::filesystem::exists(dir.Path() / "saves" / "partida.json.bak"));
    REQUIRE(Progress::Write(dir.Path(), SaveIn("b.json", 2)));
    CHECK_FALSE(std::filesystem::exists(dir.Path() / "saves" / "partida.json.tmp"));
    const auto backup = nlohmann::json::parse(ReadAll(dir.Path() / "saves" / "partida.json.bak"));
    CHECK(backup.at("level") == "a.json");
}

TEST_CASE("una partida rota se recupera de la copia anterior") {
    TempDir dir;
    REQUIRE(Progress::Write(dir.Path(), SaveIn("a.json", 1)));
    REQUIRE(Progress::Write(dir.Path(), SaveIn("b.json", 2)));
    dir.WriteText("saves/partida.json", "{ \"level\": ");  // se corto a la mitad
    SaveData in;
    Progress::LoadStatus status = Progress::LoadStatus::Missing;
    REQUIRE(Progress::Load(dir.Path(), in, Progress::kGameSlot, &status));
    CHECK(status == Progress::LoadStatus::Recovered);
    CHECK(in.level == "a.json");
}

TEST_CASE("una partida rota sin copia se informa como rota") {
    TempDir dir;
    dir.WriteText("saves/partida.json", "{ \"level\": ");
    SaveData in;
    Progress::LoadStatus status = Progress::LoadStatus::Missing;
    CHECK_FALSE(Progress::Load(dir.Path(), in, Progress::kGameSlot, &status));
    CHECK(status == Progress::LoadStatus::Broken);
}

TEST_CASE("una partida borrada no se recupera de la copia") {
    // Borrar partida (en el editor) es para empezar de cero.
    TempDir dir;
    REQUIRE(Progress::Write(dir.Path(), SaveIn("a.json", 1)));
    REQUIRE(Progress::Write(dir.Path(), SaveIn("b.json", 2)));
    std::filesystem::remove(Progress::SavePath(dir.Path()));
    SaveData in;
    Progress::LoadStatus status = Progress::LoadStatus::Loaded;
    CHECK_FALSE(Progress::Load(dir.Path(), in, Progress::kGameSlot, &status));
    CHECK(status == Progress::LoadStatus::Missing);
}

TEST_CASE("guardar encima de una partida rota no pisa la copia buena") {
    TempDir dir;
    REQUIRE(Progress::Write(dir.Path(), SaveIn("a.json", 1)));
    REQUIRE(Progress::Write(dir.Path(), SaveIn("b.json", 2)));
    dir.WriteText("saves/partida.json", "{ roto");
    REQUIRE(Progress::Write(dir.Path(), SaveIn("c.json", 3)));
    const auto backup = nlohmann::json::parse(ReadAll(dir.Path() / "saves" / "partida.json.bak"));
    CHECK(backup.at("level") == "a.json");
}

TEST_CASE("una partida de un motor mas nuevo no se lee ni se cambia por la copia") {
    TempDir dir;
    REQUIRE(Progress::Write(dir.Path(), SaveIn("a.json", 1)));
    REQUIRE(Progress::Write(dir.Path(), SaveIn("b.json", 2)));
    dir.WriteJson("saves/partida.json", nlohmann::json{{"version", Progress::kVersion + 1}, {"level", "c.json"}});
    SaveData in;
    Progress::LoadStatus status = Progress::LoadStatus::Missing;
    CHECK_FALSE(Progress::Load(dir.Path(), in, Progress::kGameSlot, &status));
    CHECK(status == Progress::LoadStatus::TooNew);
}

TEST_CASE("la partida de prueba y la del juego no se pisan") {
    TempDir dir;
    REQUIRE(Progress::Write(dir.Path(), SaveIn("juego.json", 1), Progress::kGameSlot));
    REQUIRE(Progress::Write(dir.Path(), SaveIn("prueba.json", 2), Progress::kTestSlot));
    CHECK(Progress::SavePath(dir.Path(), Progress::kTestSlot) == dir.Path() / "saves" / "prueba.json");
    SaveData game;
    SaveData test;
    REQUIRE(Progress::Load(dir.Path(), game, Progress::kGameSlot));
    REQUIRE(Progress::Load(dir.Path(), test, Progress::kTestSlot));
    CHECK(game.level == "juego.json");
    CHECK(test.level == "prueba.json");
}

TEST_CASE("el nivel de la partida tiene que quedar dentro de levels") {
    CHECK(Progress::IsLevelInsideLevels("a.json"));
    CHECK(Progress::IsLevelInsideLevels("mundo/a.json"));
    CHECK_FALSE(Progress::IsLevelInsideLevels(""));
    CHECK_FALSE(Progress::IsLevelInsideLevels("../a.json"));
    CHECK_FALSE(Progress::IsLevelInsideLevels("mundo/../../a.json"));
    CHECK_FALSE(Progress::IsLevelInsideLevels("..\\..\\a.json"));
    CHECK_FALSE(Progress::IsLevelInsideLevels("C:/Windows/win.ini"));
    CHECK_FALSE(Progress::IsLevelInsideLevels("/etc/passwd"));
    CHECK_FALSE(Progress::IsLevelInsideLevels("//servidor/recurso/a.json"));
}

}  // TEST_SUITE
