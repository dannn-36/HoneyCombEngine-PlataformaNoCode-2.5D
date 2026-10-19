// Pruebas de GameConfig: la lectura de <raiz>/game.json. Sin archivo, o con
// uno roto, quedan los valores de siempre; lo fuera de rango se lleva al rango.

#include "doctest/doctest.h"

#include "nlohmann/json.hpp"

#include "game/GameConfig.hpp"
#include "support/TestSupport.hpp"

using nlohmann::json;
using TestSupport::TempDir;

TEST_SUITE("configuracion del juego") {

TEST_CASE("sin game json quedan los valores de siempre") {
    TempDir dir;
    const GameConfig config = LoadGameConfig(dir.Path());
    CHECK_FALSE(config.present);
    CHECK(config.width == 800);
    CHECK(config.height == 450);
    CHECK_FALSE(config.fullscreen);
    CHECK(config.startLevel.empty());
    CHECK(config.hud.healthStyle == HealthStyle::Bar);
    CHECK(config.screens.pauseTitle == "Pausa");
    CHECK(config.variables.empty());
}

TEST_CASE("un game json completo se lee entero") {
    TempDir dir;
    dir.WriteJson("game.json", json{
        {"name", "Mi juego"},
        {"icon", "textures/icono.png"},
        {"window", {{"width", 1280}, {"height", 720}, {"fullscreen", true}}},
        {"startLevel", "inicio.json"},
        {"titleScreen", {{"style", "side"}, {"title", "Titulo"}, {"subtitle", "Sub"},
                         {"titleColor", {{"r", 10}, {"g", 20}, {"b", 30}}}, {"titleSize", 80},
                         {"backgroundMode", "tile"}, {"music", "sounds/tema.ogg"}, {"musicVolume", 35}}},
        {"hud", {{"healthStyle", "hearts"}, {"healthPosition", "bottom-right"}, {"healthScale", 2},
                 {"healthPerHeart", 25}, {"segments", 12}, {"showCoins", false}, {"heartFull", "h.png"}}},
        {"screens", {{"pauseTitle", "Alto"}, {"gameOverTitle", "Perdiste"},
                     {"credits", json::array({"# Equipo", "Ana", 3, "Beto"})}}},
        {"variables", {{"llaves", 0}, {"vida_extra", 2.5}, {"texto", "no"}}},
    });
    const GameConfig config = LoadGameConfig(dir.Path());
    CHECK(config.present);
    CHECK(config.name == "Mi juego");
    CHECK(config.icon == "textures/icono.png");
    CHECK(config.width == 1280);
    CHECK(config.height == 720);
    CHECK(config.fullscreen);
    CHECK(config.startLevel == "inicio.json");
    CHECK(config.titleScreen.style == TitleStyle::Side);
    CHECK(config.titleScreen.title == "Titulo");
    CHECK(config.titleScreen.subtitle == "Sub");
    CHECK(config.titleScreen.titleColor.r == 10);
    CHECK(config.titleScreen.titleColor.b == 30);
    CHECK(config.titleScreen.titleColor.a == 255);
    CHECK(config.titleScreen.titleSize == doctest::Approx(80.0f));
    CHECK(config.titleScreen.backgroundFit == BackgroundFit::Tile);
    CHECK(config.titleScreen.music == "sounds/tema.ogg");
    CHECK(config.titleScreen.musicVolume == doctest::Approx(0.35f));
    CHECK(config.hud.healthStyle == HealthStyle::Hearts);
    CHECK(config.hud.healthCorner == HudCorner::BottomRight);
    CHECK(config.hud.healthScale == doctest::Approx(2.0f));
    CHECK(config.hud.healthPerHeart == doctest::Approx(25.0f));
    CHECK(config.hud.segments == 12);
    CHECK_FALSE(config.hud.showCoins);
    CHECK(config.hud.heartFull == "h.png");
    CHECK(config.screens.pauseTitle == "Alto");
    CHECK(config.screens.gameOverTitle == "Perdiste");
    CHECK(config.screens.credits == std::vector<std::string>{"# Equipo", "Ana", "Beto"});
    CHECK(config.variables.size() == 2);
    CHECK(config.variables.at("vida_extra") == doctest::Approx(2.5f));
}

TEST_CASE("los valores fuera de rango se llevan al rango") {
    TempDir dir;
    dir.WriteJson("game.json", json{
        {"window", {{"width", 10}, {"height", 99999}}},
        {"titleScreen", {{"titleSize", 1}, {"subtitleSize", 500}, {"subtitleColor", {{"r", 900}, {"g", -4}}}, {"musicVolume", 300}}},
        {"hud", {{"healthScale", 9}, {"healthPerHeart", 0}, {"segments", 1}}},
    });
    const GameConfig config = LoadGameConfig(dir.Path());
    CHECK(config.width == 320);
    CHECK(config.height == 4320);
    CHECK(config.titleScreen.titleSize == doctest::Approx(10.0f));
    CHECK(config.titleScreen.subtitleSize == doctest::Approx(120.0f));
    CHECK(config.titleScreen.subtitleColor.r == 255);
    CHECK(config.titleScreen.subtitleColor.g == 0);
    CHECK(config.titleScreen.musicVolume == doctest::Approx(1.0f));
    CHECK(config.hud.healthScale == doctest::Approx(3.0f));
    CHECK(config.hud.healthPerHeart == doctest::Approx(1.0f));
    CHECK(config.hud.segments == 2);
}

TEST_CASE("los nombres desconocidos toman la opcion por defecto") {
    TempDir dir;
    dir.WriteJson("game.json", json{
        {"titleScreen", {{"style", "otro"}, {"backgroundMode", "otro"}}},
        {"hud", {{"healthStyle", "otro"}, {"healthPosition", "centro"}}},
        {"screens", {{"pauseTitle", ""}}},
    });
    const GameConfig config = LoadGameConfig(dir.Path());
    CHECK(config.titleScreen.style == TitleStyle::Centered);
    CHECK(config.titleScreen.backgroundFit == BackgroundFit::Cover);
    CHECK(config.hud.healthStyle == HealthStyle::Bar);
    CHECK(config.hud.healthCorner == HudCorner::TopLeft);
    CHECK(config.screens.pauseTitle == "Pausa");
}

TEST_CASE("el borde de la vida solo existe si el json lo trae") {
    TempDir dir;
    dir.WriteJson("game.json", json{{"hud", json::object()}});
    CHECK(LoadGameConfig(dir.Path()).hud.healthBorder.a == 0);
    dir.WriteJson("game.json", json{{"hud", {{"healthBorder", {{"r", 1}}}}}});
    const Color border = LoadGameConfig(dir.Path()).hud.healthBorder;
    CHECK(border.r == 1);
    CHECK(border.g == 255);
    CHECK(border.a == 255);
}

TEST_CASE("un game json roto vuelve a los valores de siempre") {
    TempDir dir;
    dir.WriteText("game.json", "{ \"name\": ");
    const GameConfig config = LoadGameConfig(dir.Path());
    CHECK_FALSE(config.present);
    CHECK(config.name.empty());
    CHECK(config.width == 800);
}

TEST_CASE("un game json con un tipo equivocado vuelve a los valores de siempre") {
    TempDir dir;
    dir.WriteJson("game.json", json{{"name", "Juego"}, {"window", {{"width", "grande"}}}});
    const GameConfig config = LoadGameConfig(dir.Path());
    CHECK_FALSE(config.present);
    CHECK(config.width == 800);
}

TEST_CASE("el titulo de la ventana usa el nombre del juego") {
    GameConfig config;
    CHECK(WindowTitle(config, false) == "HoneyComb Engine - Runtime");
    CHECK(WindowTitle(config, true) == "HoneyComb Engine - Runtime (Debug)");
    config.present = true;
    config.name = "Mi juego";
    CHECK(WindowTitle(config, false) == "Mi juego");
    CHECK(WindowTitle(config, true) == "Mi juego (Debug)");
    config.name.clear();
    CHECK(WindowTitle(config, false) == "HoneyComb Engine - Runtime");
}

}  // TEST_SUITE
