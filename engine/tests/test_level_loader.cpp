// Pruebas de LevelLoader: que arma del JSON de un nivel, que corrige y que
// rechaza. La convencion del cargador es "lo obligatorio con at(), lo opcional
// con value()": un nivel roto se rechaza con una excepcion que explica que
// falta, y un valor fuera de rango se lleva al rango en vez de romper.
//
// Usa texturas reales (un PNG generado en una carpeta temporal): LevelLoader
// las sube a la GPU, y por eso estas pruebas corren con la ventana oculta que
// abre main.cpp.

#include "doctest/doctest.h"

#include <stdexcept>

#include "nlohmann/json.hpp"

#include "core/ResourceManager.hpp"
#include "loader/AssetResolver.hpp"
#include "loader/LevelLoader.hpp"
#include "support/TestSupport.hpp"
#include "systems/event_system/EventSystem.hpp"

using nlohmann::json;
using TestSupport::EntityJson;
using TestSupport::MinimalLevel;
using TestSupport::TempDir;

namespace {

// Todo lo que necesita una carga: carpeta propia con una textura de 16x8 en
// textures/prueba.png, recursos, eventos y el cargador.
struct LoaderFixture {
    TempDir dir;
    ResourceManager resources;
    AssetResolver assets;
    EventSystem events;
    LevelLoader loader;

    LoaderFixture() : assets(dir.Path().string()), loader(resources, assets) {
        dir.WritePng("textures/prueba.png", 16, 8, RED);
    }

    LoadedLevel Load(const json& level) {
        return loader.Load(dir.WriteJson("nivel.json", level).string(), events);
    }

    LoadedLevel LoadText(const std::string& text) {
        return loader.Load(dir.WriteText("nivel.json", text).string(), events);
    }
};

bool SameCoord(const GridCoord& a, const GridCoord& b) {
    return a.col == b.col && a.row == b.row;
}

}  // namespace

TEST_SUITE("cargador de niveles") {

// --- Lo que se rechaza --------------------------------------------------------

TEST_CASE("un archivo que no existe se rechaza con un mensaje") {
    LoaderFixture fx;
    const std::string path = (fx.dir.Path() / "no_esta.json").string();
    CHECK_THROWS_WITH_AS(fx.loader.Load(path, fx.events), doctest::Contains("no se pudo abrir"),
                         std::runtime_error);
}

TEST_CASE("un json mal formado se rechaza con un mensaje") {
    LoaderFixture fx;
    CHECK_THROWS_WITH_AS(fx.LoadText("{ \"grid\": { \"width\": 4, "), doctest::Contains("parse"),
                         json::parse_error);
}

TEST_CASE("un archivo vacio se rechaza con un mensaje") {
    LoaderFixture fx;
    CHECK_THROWS_AS(fx.LoadText(""), json::parse_error);
}

TEST_CASE("un nivel sin grilla se rechaza con un mensaje") {
    LoaderFixture fx;
    json level = MinimalLevel();
    level.erase("grid");
    CHECK_THROWS_WITH_AS(fx.Load(level), doctest::Contains("grid"), json::out_of_range);
}

TEST_CASE("una grilla sin alto se rechaza con un mensaje") {
    LoaderFixture fx;
    json level = MinimalLevel();
    level["grid"].erase("height");
    CHECK_THROWS_WITH_AS(fx.Load(level), doctest::Contains("height"), json::out_of_range);
}

TEST_CASE("una grilla con medidas de texto se rechaza con un mensaje") {
    LoaderFixture fx;
    json level = MinimalLevel();
    level["grid"]["width"] = "cuatro";
    CHECK_THROWS_AS(fx.Load(level), json::type_error);
}

TEST_CASE("un tile fuera de la grilla se rechaza con un mensaje") {
    LoaderFixture fx;
    json level = MinimalLevel(4, 3);
    level["tiles"] = json::array({{{"col", 4}, {"row", 0}}});
    CHECK_THROWS_WITH_AS(fx.Load(level), doctest::Contains("fuera de la grilla"), std::runtime_error);

    level["tiles"] = json::array({{{"col", 0}, {"row", -1}}});
    CHECK_THROWS_WITH_AS(fx.Load(level), doctest::Contains("fuera de la grilla"), std::runtime_error);
}

TEST_CASE("una entidad sin posicion se rechaza con un mensaje") {
    LoaderFixture fx;
    json level = MinimalLevel();
    json entity = EntityJson("a", "npc", 1, 1);
    entity.erase("position");
    level["entities"].push_back(entity);
    CHECK_THROWS_WITH_AS(fx.Load(level), doctest::Contains("position"), json::out_of_range);
}

TEST_CASE("una entidad sin textura se rechaza con un mensaje") {
    LoaderFixture fx;
    json level = MinimalLevel();
    json entity = EntityJson("a", "npc", 1, 1);
    entity.erase("texture");
    level["entities"].push_back(entity);
    CHECK_THROWS_WITH_AS(fx.Load(level), doctest::Contains("texture"), json::out_of_range);
}

TEST_CASE("una entidad sin recorte se rechaza con un mensaje") {
    LoaderFixture fx;
    json level = MinimalLevel();
    json entity = EntityJson("a", "npc", 1, 1);
    entity.erase("sourceRect");
    level["entities"].push_back(entity);
    CHECK_THROWS_WITH_AS(fx.Load(level), doctest::Contains("sourceRect"), json::out_of_range);
}

TEST_CASE("un piso sin recorte se rechaza con un mensaje") {
    LoaderFixture fx;
    json level = MinimalLevel();
    level["visuals"] = {{"floor", {{"texture", "textures/prueba.png"}}}};
    CHECK_THROWS_WITH_AS(fx.Load(level), doctest::Contains("sourceRect"), json::out_of_range);
}

TEST_CASE("un evento sin trigger se rechaza con un mensaje") {
    LoaderFixture fx;
    json level = MinimalLevel();
    level["events"] = json::array({{{"actions", json::array()}}});
    CHECK_THROWS_WITH_AS(fx.Load(level), doctest::Contains("trigger"), json::out_of_range);
}

// --- Lo que se lee y lo que se completa por defecto ---------------------------

TEST_CASE("un nivel minimo carga con los valores por defecto") {
    LoaderFixture fx;
    json level = MinimalLevel(4, 3);
    level.erase("name");
    level["grid"].erase("tileWidth");
    level["grid"].erase("tileHeight");
    const LoadedLevel loaded = fx.Load(level);

    CHECK(loaded.name == "sin_nombre");
    CHECK(loaded.grid.GetGridWidth() == 4);
    CHECK(loaded.grid.GetGridHeight() == 3);
    CHECK(loaded.grid.GetTileWidth() == 64);
    CHECK(loaded.grid.GetTileHeight() == 32);
    CHECK(loaded.entities.empty());
    CHECK(loaded.floorTexture == nullptr);
    CHECK(loaded.wallTexture == nullptr);
    CHECK(loaded.backgroundTexture == nullptr);
    CHECK(loaded.backgroundColor.r == RAYWHITE.r);
    CHECK(loaded.backgroundColor.g == RAYWHITE.g);
    CHECK(loaded.backgroundColor.b == RAYWHITE.b);
    CHECK(loaded.camera.mode == CameraFraming::Fixed);
    CHECK(loaded.camera.zoom == doctest::Approx(1.0f));
    CHECK(loaded.camera.clampToBounds);
    CHECK(loaded.cullMarginTiles == doctest::Approx(2.0f));
    CHECK(loaded.items.empty());
    CHECK(loaded.zones.empty());
}

TEST_CASE("las medidas del tile se leen del json") {
    LoaderFixture fx;
    json level = MinimalLevel(5, 6);
    level["grid"]["tileWidth"] = 96;
    level["grid"]["tileHeight"] = 40;
    const LoadedLevel loaded = fx.Load(level);
    CHECK(loaded.name == "prueba");
    CHECK(loaded.grid.GetGridWidth() == 5);
    CHECK(loaded.grid.GetGridHeight() == 6);
    CHECK(loaded.grid.GetTileWidth() == 96);
    CHECK(loaded.grid.GetTileHeight() == 40);
}

TEST_CASE("sin tiles el nivel es un rectangulo con paredes en el borde") {
    LoaderFixture fx;
    const LoadedLevel loaded = fx.Load(MinimalLevel(4, 3));
    CHECK(loaded.floorTiles.size() == 12);
    CHECK(loaded.floorTileVariants.size() == 12);
    // El perimetro de un 4x3: todas las celdas menos las 2 del medio.
    CHECK(loaded.wallTiles.size() == 10);
    for (const int variant : loaded.floorTileVariants) {
        CHECK(variant == -1);
    }
    for (const auto& wall : loaded.wallTiles) {
        const bool border = wall.col == 0 || wall.row == 0 || wall.col == 3 || wall.row == 2;
        CHECK(border);
    }
}

TEST_CASE("los tiles respetan piso pared y variante de piso") {
    LoaderFixture fx;
    json level = MinimalLevel(4, 3);
    level["visuals"] = {{"floorVariants", json::array({
        {{"texture", "textures/prueba.png"}},
        {{"texture", "textures/prueba.png"}, {"sourceRect", {{"x", 2}, {"y", 1}, {"width", 4}, {"height", 3}}}},
    })}};
    level["tiles"] = json::array({
        {{"col", 0}, {"row", 0}},
        {{"col", 1}, {"row", 0}, {"floor", false}, {"wall", true}},
        {{"col", 2}, {"row", 0}, {"floorVariant", 0}},
        {{"col", 3}, {"row", 0}, {"floorVariant", 5}},
    });
    const LoadedLevel loaded = fx.Load(level);

    REQUIRE(loaded.floorTiles.size() == 3);
    CHECK(SameCoord(loaded.floorTiles[0], GridCoord{0, 0}));
    CHECK(SameCoord(loaded.floorTiles[1], GridCoord{2, 0}));
    CHECK(SameCoord(loaded.floorTiles[2], GridCoord{3, 0}));
    REQUIRE(loaded.floorTileVariants.size() == 3);
    CHECK(loaded.floorTileVariants[0] == -1);
    CHECK(loaded.floorTileVariants[1] == 0);
    // Un indice que no existe vuelve al piso del nivel en vez de romper.
    CHECK(loaded.floorTileVariants[2] == -1);
    REQUIRE(loaded.wallTiles.size() == 1);
    CHECK(SameCoord(loaded.wallTiles[0], GridCoord{1, 0}));

    // Una variante sin recorte usa la imagen entera; con recorte, el suyo.
    REQUIRE(loaded.floorVariants.size() == 2);
    CHECK(loaded.floorVariants[0].source.width == doctest::Approx(16.0f));
    CHECK(loaded.floorVariants[0].source.height == doctest::Approx(8.0f));
    CHECK(loaded.floorVariants[1].source.x == doctest::Approx(2.0f));
    CHECK(loaded.floorVariants[1].source.width == doctest::Approx(4.0f));
    CHECK(loaded.floorVariants[1].texture == loaded.floorVariants[0].texture);
}

TEST_CASE("el piso y la pared cargan su textura y su recorte") {
    LoaderFixture fx;
    json level = MinimalLevel();
    const json source = {{"x", 1}, {"y", 2}, {"width", 3}, {"height", 4}};
    level["visuals"] = {
        {"floor", {{"texture", "textures/prueba.png"}, {"sourceRect", source}}},
        {"wall", {{"texture", "textures/prueba.png"}, {"sourceRect", source}}},
    };
    const LoadedLevel loaded = fx.Load(level);
    REQUIRE(loaded.floorTexture != nullptr);
    REQUIRE(loaded.wallTexture != nullptr);
    CHECK(loaded.floorTexture->id != 0);
    CHECK(loaded.floorTexture == loaded.wallTexture);
    CHECK(loaded.floorSourceRect.x == doctest::Approx(1.0f));
    CHECK(loaded.floorSourceRect.height == doctest::Approx(4.0f));
    CHECK(loaded.wallSourceRect.width == doctest::Approx(3.0f));
}

TEST_CASE("el color de fondo se lleva al rango de 0 a 255") {
    LoaderFixture fx;
    json level = MinimalLevel();
    level["backgroundColor"] = {{"r", 300}, {"g", -5}};
    const LoadedLevel loaded = fx.Load(level);
    CHECK(loaded.backgroundColor.r == 255);
    CHECK(loaded.backgroundColor.g == 0);
    CHECK(loaded.backgroundColor.b == 245);  // falta: el default del cargador
    CHECK(loaded.backgroundColor.a == 255);
}

TEST_CASE("la imagen de fondo lee su modo y uno desconocido es cover") {
    LoaderFixture fx;
    json level = MinimalLevel();
    const std::pair<const char*, BackgroundFit> cases[] = {
        {"stretch", BackgroundFit::Stretch},
        {"tile", BackgroundFit::Tile},
        {"cover", BackgroundFit::Cover},
        {"mosaico", BackgroundFit::Cover},
    };
    for (const auto& [mode, fit] : cases) {
        CAPTURE(mode);
        level["backgroundImage"] = {{"texture", "textures/prueba.png"}, {"mode", mode}};
        const LoadedLevel loaded = fx.Load(level);
        REQUIRE(loaded.backgroundTexture != nullptr);
        CHECK(loaded.backgroundTexture->width == 16);
        CHECK(loaded.backgroundFit == fit);
    }
}

TEST_CASE("la camara fuera de rango se lleva al rango") {
    LoaderFixture fx;
    json level = MinimalLevel();
    level["camera"] = {
        {"mode", "follow"}, {"zoom", 100}, {"smoothing", -1},
        {"deadzone", {{"width", -10}, {"height", 20}}},
        {"clampToLevel", false}, {"cullMargin", 50},
    };
    const LoadedLevel loaded = fx.Load(level);
    CHECK(loaded.camera.mode == CameraFraming::Follow);
    CHECK(loaded.camera.zoom == doctest::Approx(CameraSystem::kMaxZoom));
    CHECK(loaded.camera.smoothing == doctest::Approx(0.0f));
    CHECK(loaded.camera.deadzone.x == doctest::Approx(0.0f));
    CHECK(loaded.camera.deadzone.y == doctest::Approx(20.0f));
    CHECK_FALSE(loaded.camera.clampToBounds);
    CHECK(loaded.cullMarginTiles == doctest::Approx(20.0f));

    level["camera"] = {{"mode", "otro"}, {"zoom", 0.01}, {"smoothing", 9}};
    const LoadedLevel low = fx.Load(level);
    CHECK(low.camera.mode == CameraFraming::Fixed);
    CHECK(low.camera.zoom == doctest::Approx(CameraSystem::kMinZoom));
    CHECK(low.camera.smoothing == doctest::Approx(CameraSystem::kMaxSmoothing));
}

TEST_CASE("una entidad completa se lee con todos sus campos") {
    LoaderFixture fx;
    json level = MinimalLevel(6, 6);
    json entity = EntityJson("jugador", "player", 2, 3);
    entity["sourceRect"] = {{"x", 4}, {"y", 0}, {"width", 8}, {"height", 8}};
    entity["frames"] = 4;
    entity["frameDuration"] = 0.2;
    entity["groundOffset"] = 3.5;
    entity["span"] = 2;
    entity["scale"] = 1.5;
    entity["stats"] = {{"health", 50}, {"damage", 7}, {"speed", 4}};
    entity["collider"] = {{"width", 20}, {"height", 10}, {"solid", true}, {"shape", "ellipse"}};
    level["entities"].push_back(entity);
    const LoadedLevel loaded = fx.Load(level);

    REQUIRE(loaded.entities.size() == 1);
    const LevelEntity& e = loaded.entities[0];
    CHECK(e.id == "jugador");
    CHECK(e.type == "player");
    CHECK(SameCoord(e.position, GridCoord{2, 3}));
    CHECK(e.precisePosition.x == doctest::Approx(2.0f));
    CHECK(e.precisePosition.y == doctest::Approx(3.0f));
    CHECK(e.startPosition.x == doctest::Approx(2.0f));
    CHECK(e.sourceRect.x == doctest::Approx(4.0f));
    CHECK(e.sourceRect.width == doctest::Approx(8.0f));
    CHECK(e.frames == 4);
    CHECK(e.frameDuration == doctest::Approx(0.2f));
    CHECK(e.groundOffset == doctest::Approx(3.5f));
    CHECK(e.span == 2);
    CHECK(e.scale == doctest::Approx(1.5f));
    CHECK(e.health == doctest::Approx(50.0f));
    CHECK(e.maxHealth == doctest::Approx(50.0f));
    CHECK(e.damage == doctest::Approx(7.0f));
    CHECK(e.speed == doctest::Approx(4.0f));
    CHECK(e.colliderSize.x == doctest::Approx(20.0f));
    CHECK(e.colliderSize.y == doctest::Approx(10.0f));
    CHECK(e.colliderSolid);
    CHECK(e.colliderRound);
    CHECK_FALSE(e.wall);
    REQUIRE(e.texture != nullptr);
    CHECK(e.texture->width == 16);
}

TEST_CASE("una entidad minima toma los valores de siempre") {
    LoaderFixture fx;
    json level = MinimalLevel();
    json entity = EntityJson("x", "npc", 1, 1);
    entity.erase("id");
    entity.erase("type");
    level["entities"].push_back(entity);
    const LoadedLevel loaded = fx.Load(level);
    REQUIRE(loaded.entities.size() == 1);
    const LevelEntity& e = loaded.entities[0];
    CHECK(e.id.empty());
    CHECK(e.type.empty());
    CHECK(e.frames == 1);
    CHECK(e.span == 1);
    CHECK(e.scale == doctest::Approx(1.0f));
    CHECK(e.health == doctest::Approx(100.0f));
    CHECK(e.speed == doctest::Approx(3.0f));
    CHECK(e.colliderSize.x == doctest::Approx(0.0f));
    CHECK_FALSE(e.colliderSolid);
    CHECK_FALSE(e.hidden);
    CHECK(e.inventory.present == false);
}

TEST_CASE("los valores invalidos de una entidad se corrigen") {
    LoaderFixture fx;
    json level = MinimalLevel();
    json entity = EntityJson("x", "npc", 1, 1);
    entity["frames"] = 0;
    entity["frameDuration"] = -1;
    entity["span"] = 0;
    entity["scale"] = -2;
    entity["stats"] = {{"health", 0}};
    level["entities"].push_back(entity);
    const LoadedLevel loaded = fx.Load(level);
    REQUIRE(loaded.entities.size() == 1);
    const LevelEntity& e = loaded.entities[0];
    CHECK(e.frames == 1);
    CHECK(e.frameDuration == doctest::Approx(0.15f));
    CHECK(e.span == 1);
    CHECK(e.scale == doctest::Approx(1.0f));
    // La barra de vida no puede dividir por cero.
    CHECK(e.maxHealth == doctest::Approx(1.0f));
}

TEST_CASE("la animacion vieja player_idle conserva sus dos cuadros") {
    LoaderFixture fx;
    json level = MinimalLevel();
    json entity = EntityJson("x", "player", 1, 1);
    entity["animation"] = "player_idle";
    level["entities"].push_back(entity);
    const LoadedLevel loaded = fx.Load(level);
    REQUIRE(loaded.entities.size() == 1);
    CHECK(loaded.entities[0].frames == 2);
    CHECK(loaded.entities[0].frameDuration == doctest::Approx(0.4f));
}

TEST_CASE("una entidad pared deja su collider como sensor") {
    LoaderFixture fx;
    json level = MinimalLevel();
    json entity = EntityJson("muro", "prop", 1, 1);
    entity["wall"] = true;
    entity["collider"] = {{"width", 32}, {"height", 16}, {"solid", true}};
    level["entities"].push_back(entity);
    const LoadedLevel loaded = fx.Load(level);
    REQUIRE(loaded.entities.size() == 1);
    CHECK(loaded.entities[0].wall);
    CHECK_FALSE(loaded.entities[0].colliderSolid);
    CHECK_FALSE(loaded.entities[0].colliderRound);
}

TEST_CASE("dos entidades con la misma textura comparten la carga") {
    LoaderFixture fx;
    json level = MinimalLevel();
    level["entities"].push_back(EntityJson("a", "npc", 0, 0));
    level["entities"].push_back(EntityJson("b", "npc", 1, 0));
    const LoadedLevel loaded = fx.Load(level);
    REQUIRE(loaded.entities.size() == 2);
    CHECK(loaded.entities[0].texture == loaded.entities[1].texture);
}

TEST_CASE("una textura que no existe no impide cargar el nivel") {
    LoaderFixture fx;
    json level = MinimalLevel();
    level["entities"].push_back(EntityJson("a", "npc", 0, 0, "textures/no_esta.png"));
    LoadedLevel loaded = fx.Load(level);
    REQUIRE(loaded.entities.size() == 1);
    REQUIRE(loaded.entities[0].texture != nullptr);
    // raylib devuelve una textura vacia (id 0) y avisa por consola.
    CHECK(loaded.entities[0].texture->id == 0);
}

TEST_CASE("los bloques de combate de una entidad pasan por el cargador de objetos") {
    LoaderFixture fx;
    json level = MinimalLevel();
    json entity = EntityJson("jefe", "enemy", 1, 1);
    entity["boss"] = true;
    entity["weapon"] = "espada";
    entity["drops"] = json::array({{{"item", "moneda"}, {"chance", 2}}});
    level["entities"].push_back(entity);
    level["items"] = json::array({{{"id", "espada"}, {"kind", "weapon"}}, {{"id", "moneda"}}});
    const LoadedLevel loaded = fx.Load(level);
    REQUIRE(loaded.entities.size() == 1);
    CHECK(loaded.entities[0].boss);
    CHECK(loaded.entities[0].weaponId == "espada");
    REQUIRE(loaded.entities[0].drops.size() == 1);
    CHECK(loaded.entities[0].drops[0].chance == doctest::Approx(1.0f));
    CHECK(loaded.items.size() == 2);
    CHECK(loaded.items.at("espada").kind == ItemKind::Weapon);
}

TEST_CASE("las salas y las zonas se cargan como zonas") {
    LoaderFixture fx;
    json level = MinimalLevel(6, 6);
    level["rooms"] = json::array({{{"id", "sala"}, {"col", 1}, {"row", 1}, {"width", 2}, {"height", 3}}});
    level["zones"] = json::array({{{"id", "z"}, {"width", 0}}});
    const LoadedLevel loaded = fx.Load(level);
    REQUIRE(loaded.zones.size() == 2);
    CHECK(loaded.zones[0].id == "sala");
    CHECK(loaded.zones[0].height == 3);
    CHECK(loaded.zones[1].id == "z");
    CHECK(loaded.zones[1].width == 1);
}

TEST_CASE("unas salas que no son una lista se ignoran") {
    LoaderFixture fx;
    json level = MinimalLevel();
    level["rooms"] = {{"id", "sala"}};
    const LoadedLevel loaded = fx.Load(level);
    CHECK(loaded.zones.empty());
}

TEST_CASE("los eventos del nivel quedan cargados en el sistema de eventos") {
    LoaderFixture fx;
    int runs = 0;
    fx.events.RegisterTrigger("siempre", [](const json&) { return true; });
    fx.events.RegisterAction("contar", [&runs](const json&) { ++runs; });
    json level = MinimalLevel();
    level["events"] = json::array({{{"trigger", {{"type", "siempre"}}}, {"actions", json::array({{{"type", "contar"}}})}}});
    fx.Load(level);
    fx.events.Update();
    CHECK(runs == 1);
}

TEST_CASE("cargar un nivel nuevo reemplaza los eventos del anterior") {
    LoaderFixture fx;
    int runs = 0;
    fx.events.RegisterTrigger("siempre", [](const json&) { return true; });
    fx.events.RegisterAction("contar", [&runs](const json&) { ++runs; });
    json first = MinimalLevel();
    first["events"] = json::array({{{"trigger", {{"type", "siempre"}}}, {"actions", json::array({{{"type", "contar"}}})}}});
    fx.Load(first);

    fx.Load(MinimalLevel());  // "events": [] vacio
    fx.events.Update();
    CHECK(runs == 0);
}

// Defecto conocido: LevelLoader solo llama a EventSystem::LoadEvents si el
// nivel trae la clave "events" (LevelLoader.cpp, bloque "Eventos"). Un nivel
// escrito a mano sin esa clave (el schema la exige, pero el motor no la
// rechaza) hereda los eventos del nivel anterior al pasar de nivel, porque
// GameSession reutiliza el mismo EventSystem.
TEST_CASE("un nivel sin la clave events no hereda los eventos del anterior" * doctest::should_fail()) {
    LoaderFixture fx;
    int runs = 0;
    fx.events.RegisterTrigger("siempre", [](const json&) { return true; });
    fx.events.RegisterAction("contar", [&runs](const json&) { ++runs; });
    json first = MinimalLevel();
    first["events"] = json::array({{{"trigger", {{"type", "siempre"}}}, {"actions", json::array({{{"type", "contar"}}})}}});
    fx.Load(first);

    json second = MinimalLevel();
    second.erase("events");
    fx.Load(second);
    fx.events.Update();
    CHECK(runs == 0);
}

}  // TEST_SUITE
