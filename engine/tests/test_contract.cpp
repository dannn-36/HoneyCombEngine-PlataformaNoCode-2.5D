// =============================================================================
// Pruebas del contrato JSON entre el editor y el motor
// =============================================================================
//
// Cargan con el LevelLoader real:
//   - todos los niveles de referencia de levels/*.json, y
//   - los casos compartidos con las pruebas del editor en tests/contract/:
//     valid/ (el schema los acepta), invalid/ (el schema los rechaza) y
//     limite/ (el schema los acepta aunque tienen un problema). El indice
//     tests/contract/casos.json dice, por archivo, que se espera del motor:
//     "carga", "rechaza", "tolera", "falla_al_evaluar" o "no_cargar".
//
// Los archivos se leen en tiempo de ejecucion desde la raiz del repositorio
// (HONEYCOMB_REPO_DIR): agregar un caso no pide recompilar. Un archivo que no
// esta en el indice se prueba igual, con lo que corresponde a su carpeta.
//
// La regla para todos: el motor no se cae. Un nivel roto se rechaza con una
// excepcion std::exception con mensaje (GameSession la atrapa y avisa en
// pantalla); nunca con otra cosa, ni con un abort.
// =============================================================================

#include "doctest/doctest.h"

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <optional>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "nlohmann/json.hpp"

#include "core/ResourceManager.hpp"
#include "game/EventBindings.hpp"
#include "game/Inventory.hpp"
#include "game/Loot.hpp"
#include "loader/AssetResolver.hpp"
#include "loader/LevelLoader.hpp"
#include "support/TestSupport.hpp"
#include "systems/audio/AudioSystem.hpp"
#include "systems/event_system/EventSystem.hpp"

namespace fs = std::filesystem;
using nlohmann::json;

namespace {

fs::path ContractDir() {
    return TestSupport::RepoPath("tests/contract");
}

json ReadJson(const fs::path& file) {
    std::ifstream stream(file);
    REQUIRE_MESSAGE(stream.good(), "no se pudo abrir " << file.string());
    return json::parse(stream);
}

json Index() {
    static const json index = ReadJson(ContractDir() / "casos.json");
    return index;
}

std::vector<fs::path> JsonFiles(const fs::path& dir) {
    std::vector<fs::path> files;
    std::error_code error;
    for (const auto& entry : fs::directory_iterator(dir, error)) {
        if (entry.is_regular_file() && entry.path().extension() == ".json") {
            files.push_back(entry.path());
        }
    }
    std::sort(files.begin(), files.end());
    return files;
}

std::string Name(const fs::path& file) {
    return file.filename().u8string();
}

struct Case {
    fs::path file;
    std::string section;   // valid, invalid o limite
    std::string expected;  // lo que dice el indice para el motor
    bool indexed = false;
};

// Los casos de una carpeta del contrato con lo que el indice espera de cada
// uno. Sin entrada en el indice: valid/ tiene que cargar, y de los demas solo
// se exige que el motor no se caiga ("" = cualquiera de las dos).
std::vector<Case> CasesIn(const std::string& section) {
    std::vector<Case> cases;
    const json& entries = Index().value(section, json::object());
    for (const auto& file : JsonFiles(ContractDir() / section)) {
        Case item{file, section, section == "valid" ? "carga" : "", false};
        const std::string name = Name(file);
        if (entries.contains(name)) {
            item.expected = entries.at(name).value("motor", item.expected);
            item.indexed = true;
        }
        cases.push_back(item);
    }
    return cases;
}

std::vector<Case> AllCases() {
    std::vector<Case> all;
    for (const char* section : {"valid", "invalid", "limite"}) {
        const auto cases = CasesIn(section);
        all.insert(all.end(), cases.begin(), cases.end());
    }
    return all;
}

// Lo que paso al cargar un archivo.
struct Outcome {
    std::optional<LoadedLevel> level;
    bool rejected = false;  // lanzo std::exception
    bool unknown = false;   // lanzo algo que no es std::exception: sin mensaje
    std::string message;
};

// Todo lo que hace falta para cargar como el juego: recursos con la raiz
// real de assets/, y un EventSystem con todos los bloques del catalogo
// registrados (para poder correr un frame de eventos despues de cargar).
struct Runtime {
    ResourceManager resources;
    AssetResolver assets{TestSupport::RepoPath("assets").string()};
    LevelLoader loader{resources, assets};

    Outcome Load(const fs::path& file, EventSystem& events) {
        Outcome outcome;
        try {
            outcome.level.emplace(loader.Load(file.string(), events));
        } catch (const std::exception& error) {
            outcome.rejected = true;
            outcome.message = error.what();
        } catch (...) {
            outcome.unknown = true;
        }
        return outcome;
    }

    Outcome Load(const fs::path& file) {
        EventSystem events;
        return Load(file, events);
    }
};

// Las variables de GameSession que EventBindings necesita, para correr un
// frame de eventos sobre un nivel recien cargado.
struct GameState {
    LoadedLevel& level;
    LevelEntity* player = nullptr;
    std::unordered_map<std::string, LevelEntity*> entityById;
    std::unordered_set<std::string> flags;
    std::unordered_set<std::string> gameFlags;
    std::unordered_map<std::string, float> variables;
    std::vector<CollisionPair> collisions;
    Inventory inventory;
    Loot::State loot;
    std::vector<std::string> abilitiesUsed;
    AudioSystem audio;
    fs::path currentLevelPath;
    EventBindings::Context ctx;

    GameState(LoadedLevel& loaded, Runtime& runtime, const fs::path& file) : level(loaded), currentLevelPath(file) {
        for (auto& entity : level.entities) {
            entityById[entity.id] = &entity;
            if (entity.type == "player" && !player) {
                player = &entity;
            }
        }
        ctx.level = &level;
        ctx.player = &player;
        ctx.entityById = &entityById;
        ctx.flags = &flags;
        ctx.gameFlags = &gameFlags;
        ctx.variables = &variables;
        ctx.collisions = &collisions;
        ctx.inventory = &inventory;
        ctx.loot = &loot;
        ctx.abilitiesUsed = &abilitiesUsed;
        ctx.resources = &runtime.resources;
        ctx.assets = &runtime.assets;
        ctx.audio = &audio;
        ctx.currentLevelPath = &currentLevelPath;
        ctx.beginTransition = [](const fs::path&, const std::string&, bool) {};
        ctx.showMessage = [](const std::string&, float) {};
        ctx.saveGame = []() {};
    }
};

// Carga el archivo con los bloques del catalogo registrados y corre un frame
// de eventos, como el primer frame del juego. "" si todo anduvo; si no, el error.
std::string LoadAndRunFrame(Runtime& runtime, const fs::path& file) {
    EventSystem events;
    std::optional<LoadedLevel> level;
    try {
        level.emplace(runtime.loader.Load(file.string(), events));
    } catch (const std::exception& error) {
        return std::string("al cargar: ") + error.what();
    }
    // Los registros no dependen del nivel: da lo mismo hacerlos despues de
    // cargar, y asi el Context ya apunta a las entidades de este nivel.
    GameState state(*level, runtime, file);
    EventBindings::RegisterAll(events, state.ctx);
    try {
        events.Update();
    } catch (const std::exception& error) {
        return std::string("al evaluar: ") + error.what();
    } catch (...) {
        return "al evaluar: excepcion desconocida";
    }
    return "";
}

const LevelEntity* FindEntity(const LoadedLevel& level, const std::string& id) {
    for (const auto& entity : level.entities) {
        if (entity.id == id) {
            return &entity;
        }
    }
    return nullptr;
}

// Las rutas de textura que nombra un nivel (entidades, piso, pared, fondo y
// variantes de piso), para avisar cuales faltan en assets/.
std::vector<std::string> TexturePaths(const json& level) {
    std::vector<std::string> paths;
    const auto add = [&paths](const json& node) {
        if (node.is_object() && node.contains("texture") && node.at("texture").is_string()) {
            paths.push_back(node.at("texture").get<std::string>());
        }
    };
    for (const auto& entity : level.value("entities", json::array())) add(entity);
    if (level.contains("visuals") && level.at("visuals").is_object()) {
        const json& visuals = level.at("visuals");
        add(visuals.value("floor", json::object()));
        add(visuals.value("wall", json::object()));
        for (const auto& variant : visuals.value("floorVariants", json::array())) add(variant);
    }
    add(level.value("backgroundImage", json::object()));
    for (const auto& item : level.value("items", json::array())) add(item);
    return paths;
}

}  // namespace

TEST_SUITE("contrato json") {

TEST_CASE("todos los niveles de referencia cargan sin errores") {
    Runtime runtime;
    const auto files = JsonFiles(TestSupport::RepoPath("levels"));
    REQUIRE_FALSE(files.empty());
    std::ostringstream summary;
    summary << files.size() << " niveles de levels/:";
    for (const auto& file : files) {
        CAPTURE(Name(file));
        const Outcome outcome = runtime.Load(file);
        CHECK_FALSE(outcome.unknown);
        CHECK_MESSAGE(outcome.level.has_value(), "rechazado: " << outcome.message);
        if (!outcome.level) {
            summary << "\n  " << Name(file) << ": RECHAZADO (" << outcome.message << ")";
            continue;
        }
        const json source = ReadJson(file);
        const LoadedLevel& level = *outcome.level;
        CHECK(level.grid.GetGridWidth() == source.at("grid").at("width").get<int>());
        CHECK(level.grid.GetGridHeight() == source.at("grid").at("height").get<int>());
        CHECK(level.entities.size() == source.value("entities", json::array()).size());

        int missing = 0;
        for (const auto& texture : TexturePaths(source)) {
            missing += runtime.assets.Exists(texture) ? 0 : 1;
        }
        summary << "\n  " << Name(file) << ": carga (" << level.entities.size() << " entidades, "
                << level.floorTiles.size() << " casillas";
        if (missing > 0) {
            summary << ", " << missing << " textura(s) que no estan en assets/";
        }
        summary << ")";
    }
    MESSAGE(summary.str());
}

TEST_CASE("los casos validos del contrato cargan igual que el archivo") {
    Runtime runtime;
    const auto cases = CasesIn("valid");
    REQUIRE_FALSE(cases.empty());
    for (const auto& item : cases) {
        CAPTURE(Name(item.file));
        const Outcome outcome = runtime.Load(item.file);
        REQUIRE_MESSAGE(outcome.level.has_value(), "rechazado: " << outcome.message);
        const json source = ReadJson(item.file);
        const LoadedLevel& level = *outcome.level;
        CHECK(level.name == source.at("name").get<std::string>());
        CHECK(level.grid.GetGridWidth() == source.at("grid").at("width").get<int>());
        CHECK(level.grid.GetGridHeight() == source.at("grid").at("height").get<int>());
        CHECK(level.grid.GetTileWidth() == source.at("grid").at("tileWidth").get<int>());
        CHECK(level.entities.size() == source.at("entities").size());
        for (std::size_t i = 0; i < level.entities.size(); ++i) {
            CHECK(level.entities[i].id == source.at("entities")[i].value("id", std::string()));
            CHECK(level.entities[i].position.col == source.at("entities")[i].at("position").at("col").get<int>());
        }
        const std::size_t zones = source.value("rooms", json::array()).size() + source.value("zones", json::array()).size();
        CHECK(level.zones.size() == zones);
        CHECK(level.items.size() == source.value("items", json::array()).size());
        if (source.contains("tiles")) {
            std::size_t floors = 0;
            std::size_t walls = 0;
            for (const auto& tile : source.at("tiles")) {
                floors += tile.value("floor", true) ? 1 : 0;
                walls += tile.value("wall", false) ? 1 : 0;
            }
            CHECK(level.floorTiles.size() == floors);
            CHECK(level.wallTiles.size() == walls);
        } else {
            const int w = level.grid.GetGridWidth();
            const int h = level.grid.GetGridHeight();
            CHECK(level.floorTiles.size() == static_cast<std::size_t>(w * h));
            CHECK(level.wallTiles.size() == static_cast<std::size_t>(2 * w + 2 * h - 4));
        }
        // Todas las texturas que nombra un caso valido existen (lo dice el indice).
        for (const auto& texture : TexturePaths(source)) {
            CAPTURE(texture);
            CHECK(runtime.assets.Exists(texture));
        }
    }
}

TEST_CASE("los casos que el indice manda rechazar se rechazan con un mensaje") {
    Runtime runtime;
    int checked = 0;
    for (const auto& item : AllCases()) {
        if (item.expected != "rechaza") {
            continue;
        }
        CAPTURE(item.section);
        CAPTURE(Name(item.file));
        const Outcome outcome = runtime.Load(item.file);
        CHECK_FALSE(outcome.unknown);
        CHECK_MESSAGE(outcome.rejected, "el motor lo acepto y deberia rechazarlo");
        CHECK_FALSE(outcome.message.empty());
        ++checked;
    }
    CHECK(checked > 0);
}

TEST_CASE("los casos que el indice manda tolerar cargan sin errores") {
    Runtime runtime;
    int checked = 0;
    for (const auto& item : AllCases()) {
        if (item.expected != "tolera" && item.expected != "falla_al_evaluar" && item.expected != "carga") {
            continue;
        }
        CAPTURE(item.section);
        CAPTURE(Name(item.file));
        const Outcome outcome = runtime.Load(item.file);
        CHECK_FALSE(outcome.unknown);
        CHECK_MESSAGE(outcome.level.has_value(), "rechazado: " << outcome.message);
        ++checked;
    }
    CHECK(checked > 0);
}

TEST_CASE("ningun caso del contrato tira el motor") {
    Runtime runtime;
    std::ostringstream summary;
    std::unordered_map<std::string, int> totals;
    for (const auto& item : AllCases()) {
        CAPTURE(item.section);
        CAPTURE(Name(item.file));
        if (item.expected == "no_cargar") {
            // No se carga a proposito: grid_enorme_sin_tiles.json es una grilla
            // de 50000x50000 sin "tiles", y el cargador armaria 2500 millones
            // de casillas (minutos de trabajo y decenas de GB, o bad_alloc).
            // El resto de las suites lo prueban sin necesidad de esto.
            summary << "\n  " << item.section << "/" << Name(item.file) << ": no se carga (ver casos.json)";
            ++totals["sin cargar"];
            continue;
        }
        // Que no salga nada que no sea std::exception, y que el primer frame
        // de eventos tampoco rompa (salvo lo que el indice ya anota).
        const Outcome outcome = runtime.Load(item.file);
        CHECK_FALSE(outcome.unknown);
        const std::string result = outcome.rejected ? "rechaza" : "carga";
        ++totals[result];
        summary << "\n  " << item.section << "/" << Name(item.file) << ": " << result;
        if (outcome.rejected) {
            summary << " (" << outcome.message << ")";
        }
        if (!item.indexed) {
            summary << " [no esta en el indice]";
        }
        if (!outcome.rejected) {
            const std::string frame = LoadAndRunFrame(runtime, item.file);
            if (item.expected != "falla_al_evaluar") {
                CHECK_MESSAGE(frame.empty(), frame);
            } else if (!frame.empty()) {
                summary << " -> primer frame: " << frame;
            }
        }
    }
    std::ostringstream head;
    head << "casos de tests/contract: " << totals["carga"] << " cargan, " << totals["rechaza"] << " se rechazan, "
         << totals["sin cargar"] << " sin cargar" << summary.str();
    MESSAGE(head.str());
}

TEST_CASE("el indice del contrato y las carpetas coinciden") {
    // Solo avisa: los casos los mantienen las pruebas del editor.
    for (const char* section : {"valid", "invalid", "limite"}) {
        const json& entries = Index().value(section, json::object());
        std::unordered_set<std::string> onDisk;
        for (const auto& file : JsonFiles(ContractDir() / section)) {
            onDisk.insert(Name(file));
            WARN_MESSAGE(entries.contains(Name(file)), section << "/" << Name(file) << " no esta en casos.json");
        }
        for (const auto& [name, entry] : entries.items()) {
            WARN_MESSAGE(onDisk.count(name) == 1, section << "/" << name << " esta en casos.json y no en disco");
        }
    }
}

TEST_CASE("los casos tolerados quedan como dice su nota") {
    Runtime runtime;
    const auto load = [&runtime](const std::string& name) {
        const Outcome outcome = runtime.Load(ContractDir() / "invalid" / name);
        INFO(name);
        REQUIRE_MESSAGE(outcome.level.has_value(), "rechazado: " << outcome.message);
        return *outcome.level;
    };
    const auto entity = [](const LoadedLevel& level, const std::string& id) -> const LevelEntity& {
        const LevelEntity* found = FindEntity(level, id);
        REQUIRE_MESSAGE(found != nullptr, "no esta la entidad " << id);
        return *found;
    };

    CHECK(load("falta_nombre.json").name == "sin_nombre");
    CHECK(load("falta_entities.json").entities.empty());
    CHECK(load("grid_falta_tile_width.json").grid.GetTileWidth() == 64);
    CHECK(load("grid_ancho_decimal.json").grid.GetGridWidth() == 6);
    CHECK(load("grid_ancho_cero.json").floorTiles.empty());
    CHECK(load("grid_alto_negativo.json").floorTiles.empty());
    CHECK(load("entidad_columna_decimal.json").entities.at(0).position.col == 1);
    CHECK(load("entidad_sin_id.json").entities.at(0).id.empty());
    CHECK(load("color_fondo_fuera_de_rango.json").backgroundColor.r == 255);
    CHECK(load("color_fondo_incompleto.json").backgroundColor.b == 245);
    {
        const LoadedLevel level = load("camara_zoom_fuera_de_rango.json");
        CHECK(level.camera.zoom == doctest::Approx(CameraSystem::kMaxZoom));
        CHECK(level.camera.mode == CameraFraming::Follow);
    }
    CHECK(load("camara_modo_desconocido.json").camera.mode == CameraFraming::Fixed);
    CHECK(load("imagen_fondo_modo_desconocido.json").backgroundFit == BackgroundFit::Cover);
    CHECK(entity(load("entidad_frames_cero.json"), "player_1").frames == 1);
    CHECK(entity(load("entidad_escala_negativa.json"), "player_1").scale == doctest::Approx(1.0f));
    {
        const LevelEntity& e = entity(load("entidad_colisionador_forma_desconocida.json"), "player_1");
        CHECK_FALSE(e.colliderRound);
        CHECK(e.colliderSolid);
    }
    CHECK(entity(load("inventario_demasiados_casilleros.json"), "player_1").inventory.slots == 9);
    CHECK(entity(load("botin_probabilidad_mayor_a_uno.json"), "enemy_1").drops.at(0).chance == doctest::Approx(1.0f));
    CHECK(entity(load("tienda_precio_negativo.json"), "npc_1").shop.at(0).price == 0);
    CHECK(load("sala_ancho_cero.json").zones.at(0).width == 1);
    {
        const LoadedLevel level = load("tile_variante_negativa.json");
        for (std::size_t i = 0; i < level.floorTiles.size(); ++i) {
            if (level.floorTiles[i].col == 0 && level.floorTiles[i].row == 0) {
                CHECK(level.floorTileVariants[i] == -1);
            }
        }
    }
    CHECK(load("objeto_tipo_desconocido.json").items.at("espada").kind == ItemKind::Coin);
    CHECK(load("objeto_sin_recorte_valido.json").items.at("espada").sourceRect.width == doctest::Approx(16.0f));
    CHECK(load("ataque_patron_desconocido.json").items.at("espada").weapon.attack.pattern == AttackPattern::Area);
    CHECK(load("ataque_sin_danio.json").items.at("espada").weapon.attack.damage == doctest::Approx(AttackDef{}.damage));
}

// Defecto conocido: un parametro de texto con otro tipo (aca "entityA": 5)
// hace que el trigger on_collision lance nlohmann::json::type_error en el
// primer frame (EventBindings.cpp usa params.value("entityA", std::string())
// en vez de StringParam). GameSession::Update llama a events.Update() sin
// try/catch, asi que la excepcion sale del bucle y main() cierra el juego con
// "No se pudo arrancar". El schema no valida el tipo de los params.
TEST_CASE("un parametro de evento con el tipo equivocado no cierra el juego" * doctest::should_fail()) {
    Runtime runtime;
    const fs::path file = ContractDir() / "limite" / "parametro_evento_tipo_incorrecto.json";
    REQUIRE(fs::exists(file));
    const std::string frame = LoadAndRunFrame(runtime, file);
    CHECK_MESSAGE(frame.empty(), frame);
}

}  // TEST_SUITE
