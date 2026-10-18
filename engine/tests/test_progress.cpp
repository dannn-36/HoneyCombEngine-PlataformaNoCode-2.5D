// Pruebas de Progress: escribir y leer la partida guardada
// (<raiz>/saves/partida.json).

#include "doctest/doctest.h"

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

}  // TEST_SUITE
