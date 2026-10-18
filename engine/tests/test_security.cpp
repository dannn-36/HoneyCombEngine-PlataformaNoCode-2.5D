// =============================================================================
// Pruebas de seguridad del motor
// =============================================================================
//
// El motor abre archivos que no escribio el: el nivel (.json), game.json y la
// partida guardada. Cualquiera de los tres puede venir de otra persona (un
// proyecto compartido, una carpeta descargada) o estar roto a mano. Estas
// pruebas atacan esa entrada:
//
//   1. Fuzzing del cargador de niveles: se mutan los niveles validos del
//      repositorio (tests/contract/valid y levels/) de forma determinista
//      (semilla fija) y se cargan con el LevelLoader real. La regla es la misma
//      que en test_contract.cpp: un nivel roto se rechaza con una
//      std::exception con mensaje, nunca con otra cosa ni con un abort.
//   2. Anidamiento profundo: un JSON con miles de listas una dentro de otra.
//      Lo que puede agotar la pila mata el proceso entero, asi que esos casos
//      se cargan en un PROCESO APARTE (este mismo ejecutable, con la prueba
//      auxiliar de abajo) y se mira como termino.
//   3. Rutas que salen del proyecto: texturas, sonidos, el destino de
//      load_level, el nivel de la partida guardada y las rutas de game.json.
//      Lo seguro es que nada de eso lea fuera de assets/ ni de levels/.
//
// Las pruebas afirman el comportamiento SEGURO. Las que hoy fallan por un
// defecto conocido van marcadas con doctest::should_fail() y un comentario
// "Defecto conocido": la corrida pasa, y el dia que se corrija el defecto la
// prueba empieza a "fallar" para avisar que hay que sacarle la marca.
//
// Riesgo conocido que estas pruebas esquivan a proposito (EN-07): el cargador
// no tiene un maximo de grilla, y una grilla grande sin "tiles" arma
// width*height casillas en memoria. El fuzzing descarta esas mutaciones antes
// de cargarlas y cuenta cuantas fueron.
// =============================================================================

#include "doctest/doctest.h"

#include <algorithm>
#include <chrono>
#include <climits>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <random>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "nlohmann/json.hpp"
#include "raylib.h"

#include "core/ResourceManager.hpp"
#include "game/EventBindings.hpp"
#include "game/GameConfig.hpp"
#include "game/Inventory.hpp"
#include "game/Loot.hpp"
#include "game/Progress.hpp"
#include "loader/AssetResolver.hpp"
#include "loader/LevelLoader.hpp"
#include "support/TestSupport.hpp"
#include "systems/audio/AudioSystem.hpp"
#include "systems/event_system/EventSystem.hpp"

#ifdef _WIN32
// Se declaran a mano para no incluir windows.h, que choca con raylib.h.
extern "C" __declspec(dllimport) unsigned long __stdcall GetModuleFileNameA(void* module, char* fileName,
                                                                           unsigned long size);
extern "C" __declspec(dllimport) unsigned int __stdcall SetErrorMode(unsigned int mode);
#endif

namespace fs = std::filesystem;
using nlohmann::json;
using TestSupport::TempDir;

namespace {

// --- Ayudas generales ---------------------------------------------------------

std::string ReadText(const fs::path& file) {
    std::ifstream stream(file, std::ios::binary);
    std::ostringstream text;
    text << stream.rdbuf();
    return text.str();
}

// true si "target", ya normalizada, queda dentro de "dir" (o es la misma).
// Es una comparacion de rutas, sin tocar el disco: alcanza para saber si una
// ruta armada con lo que trae un JSON se sale de donde deberia.
bool InsideDir(const fs::path& dir, const fs::path& target) {
    const fs::path base = fs::absolute(dir).lexically_normal();
    const fs::path full = fs::absolute(target).lexically_normal();
    const fs::path relative = full.lexically_relative(base);
    return !relative.empty() && *relative.begin() != "..";
}

// Una ruta del JSON que, puesta debajo de cualquier carpeta, se queda adentro:
// relativa, sin raiz ni unidad, y sin ".." que la saque.
bool StaysInside(const std::string& reference) {
    const fs::path base = fs::path("proyecto") / "carpeta";
    return reference.empty() || InsideDir(base, base / fs::u8path(reference));
}

// --- Proceso aparte -------------------------------------------------------------
//
// Los casos que pueden agotar la pila no se cargan en este proceso: si se cae,
// se lleva puestas todas las pruebas. Se escriben a un archivo y se carga en
// otra copia de este ejecutable, que corre SOLO la prueba auxiliar.

const char* const kChildEnv = "HONEYCOMB_SEGURIDAD_NIVEL";
const char* const kChildCase = "auxiliar carga un nivel en un proceso aparte";

fs::path OwnExecutable() {
#ifdef _WIN32
    char buffer[4096] = {};
    const unsigned long length = GetModuleFileNameA(nullptr, buffer, sizeof(buffer));
    return fs::path(std::string(buffer, length));
#else
    return fs::read_symlink("/proc/self/exe");
#endif
}

void SetChildEnv(const std::string& value) {
#ifdef _WIN32
    _putenv_s(kChildEnv, value.c_str());
#else
    if (value.empty()) {
        unsetenv(kChildEnv);
    } else {
        setenv(kChildEnv, value.c_str(), 1);
    }
#endif
}

// Carga "file" en un proceso aparte y devuelve su codigo de salida: 0 si el
// cargador termino (bien o con una std::exception), otra cosa si el proceso
// se cayo (0xC00000FD es "stack overflow" en Windows).
int LoadInChildProcess(const fs::path& file) {
#ifdef _WIN32
    // Sin el cuadro de "dejo de funcionar" de Windows: se hereda al hijo, y
    // sin esto una caida dejaria la corrida esperando a que alguien lo cierre.
    SetErrorMode(0x0001u | 0x0002u);  // SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX
#endif
    SetChildEnv(file.string());
    std::string command = "\"" + OwnExecutable().string() + "\" \"--test-case=" + kChildCase +
                          "\" --no-skip --no-intro --no-version --no-colors";
#ifdef _WIN32
    command = "\"" + command + " > NUL 2>&1\"";
#else
    command += " > /dev/null 2>&1";
#endif
    const int code = std::system(command.c_str());
    SetChildEnv("");
#ifndef _WIN32
    return WIFEXITED(code) ? WEXITSTATUS(code) : 128 + WTERMSIG(code);
#else
    return code;
#endif
}

// N listas una dentro de otra: "[[[...]]]".
std::string NestedArrays(int depth) {
    return std::string(static_cast<size_t>(depth), '[') + std::string(static_cast<size_t>(depth), ']');
}

std::string Hex(int code) {
    std::ostringstream text;
    text << "0x" << std::hex << static_cast<unsigned int>(code);
    return text.str();
}

// --- Fuzzing ------------------------------------------------------------------

// Los niveles que se mutan: los validos del contrato y los de referencia.
std::vector<fs::path> FuzzSeeds() {
    std::vector<fs::path> seeds;
    for (const auto& dir : {TestSupport::RepoPath("tests/contract/valid"), TestSupport::RepoPath("levels")}) {
        std::vector<fs::path> files;
        std::error_code error;
        for (const auto& entry : fs::directory_iterator(dir, error)) {
            if (entry.is_regular_file() && entry.path().extension() == ".json") {
                files.push_back(entry.path());
            }
        }
        std::sort(files.begin(), files.end());
        seeds.insert(seeds.end(), files.begin(), files.end());
    }
    return seeds;
}

// Celdas que se dejan armar a una grilla sin "tiles" (EN-07). Con mas, la
// mutacion se descarta: no es lo que se esta probando y tardaria minutos.
constexpr double kMaxLegacyCells = 250000.0;

enum class GridCheck { Ok, Huge, OutOfInt };

// Mira la grilla ANTES de cargar, con el mismo parser (sin excepciones).
GridCheck CheckGrid(const std::string& text) {
    const json doc = json::parse(text, nullptr, false);
    if (doc.is_discarded() || !doc.is_object()) {
        return GridCheck::Ok;
    }
    const auto grid = doc.find("grid");
    if (grid == doc.end() || !grid->is_object()) {
        return GridCheck::Ok;
    }
    const auto width = grid->find("width");
    const auto height = grid->find("height");
    if (width == grid->end() || height == grid->end() || !width->is_number() || !height->is_number()) {
        return GridCheck::Ok;
    }
    const double w = width->get<double>();
    const double h = height->get<double>();
    // get<int>() de un numero fuera de rango es una conversion indefinida.
    if (w > INT_MAX || w < INT_MIN || h > INT_MAX || h < INT_MIN) {
        return GridCheck::OutOfInt;
    }
    if (!doc.contains("tiles") && w > 0 && h > 0 && w * h > kMaxLegacyCells) {
        return GridCheck::Huge;
    }
    return GridCheck::Ok;
}

class Mutator {
public:
    explicit Mutator(unsigned seed) : rng_(seed) {}

    int Int(int low, int high) { return std::uniform_int_distribution<int>(low, high)(rng_); }

    // Aplica de una a tres mutaciones seguidas. Devuelve el texto y anota cual
    // fue la ultima, para las estadisticas.
    std::string Mutate(std::string text, std::string& kind) {
        const int count = Int(1, 3);
        for (int i = 0; i < count; ++i) {
            text = MutateOnce(text, kind);
        }
        return text;
    }

private:
    std::mt19937 rng_;

    std::string MutateOnce(const std::string& text, std::string& kind) {
        const int choice = Int(0, 9);
        if (choice >= 3) {
            json doc = json::parse(text, nullptr, false);
            if (!doc.is_discarded()) {
                switch (choice) {
                    case 3: kind = "borrar clave"; return DeleteKey(doc);
                    case 4: kind = "duplicar clave"; return DuplicateKey(doc);
                    case 5: kind = "cambiar tipo"; return SwapType(doc);
                    case 6: kind = "numero enorme"; return HugeNumber(doc);
                    case 7: kind = "texto largo"; return LongString(doc);
                    case 8: kind = "anidar"; return Nest(doc);
                    default: kind = "grilla enorme"; return HugeGrid(doc);
                }
            }
        }
        switch (choice % 3) {
            case 0: kind = "cambiar bytes"; return FlipBytes(text);
            case 1: kind = "truncar"; return Truncate(text);
            default: kind = "insertar bytes"; return InsertBytes(text);
        }
    }

    // --- Sobre el texto ---

    std::string FlipBytes(std::string text) {
        if (text.empty()) {
            return "\x01";
        }
        const int flips = Int(1, 8);
        for (int i = 0; i < flips; ++i) {
            const size_t at = static_cast<size_t>(Int(0, static_cast<int>(text.size()) - 1));
            text[at] = static_cast<char>(Int(0, 1) ? (text[at] ^ (1 << Int(0, 7))) : Int(0, 255));
        }
        return text;
    }

    std::string Truncate(const std::string& text) {
        if (text.size() < 2) {
            return "";
        }
        return text.substr(0, static_cast<size_t>(Int(0, static_cast<int>(text.size()) - 1)));
    }

    std::string InsertBytes(std::string text) {
        static const std::string kSignificant = "{}[]\":,-+.eE0123456789\\/ntfu";
        const size_t at = static_cast<size_t>(Int(0, static_cast<int>(text.size())));
        std::string inserted;
        const int length = Int(1, 6);
        for (int i = 0; i < length; ++i) {
            inserted += Int(0, 3) ? kSignificant[static_cast<size_t>(Int(0, static_cast<int>(kSignificant.size()) - 1))]
                                  : static_cast<char>(Int(0, 255));
        }
        text.insert(at, inserted);
        return text;
    }

    // --- Sobre el JSON ya parseado ---

    static void Collect(json& node, std::vector<json*>& out) {
        out.push_back(&node);
        if (node.is_structured()) {
            for (auto& child : node) {
                Collect(child, out);
            }
        }
    }

    json* Pick(json& doc, bool (*accept)(const json&)) {
        std::vector<json*> all;
        Collect(doc, all);
        std::vector<json*> picked;
        for (json* node : all) {
            if (accept(*node)) {
                picked.push_back(node);
            }
        }
        if (picked.empty()) {
            return nullptr;
        }
        return picked[static_cast<size_t>(Int(0, static_cast<int>(picked.size()) - 1))];
    }

    // Reemplaza un nodo por un texto crudo (que puede no ser un JSON que
    // nlohmann sepa escribir, como 1e400): se marca con un texto unico y se
    // reemplaza al escribir.
    static std::string ReplaceWithRaw(json& doc, json& node, const std::string& raw) {
        const std::string marker = "__marca_de_fuzzing__";
        node = marker;
        std::string text = doc.dump();
        const std::string quoted = "\"" + marker + "\"";
        const size_t at = text.find(quoted);
        if (at != std::string::npos) {
            text.replace(at, quoted.size(), raw);
        }
        return text;
    }

    json RandomValue() {
        switch (Int(0, 11)) {
            case 0: return nullptr;
            case 1: return true;
            case 2: return false;
            case 3: return 0;
            case 4: return -1;
            case 5: return 3.5;
            case 6: return "texto";
            case 7: return json::array();
            case 8: return json::object();
            case 9: return json::array({1, "a", nullptr});
            case 10: return json{{"type", 7}, {"params", "x"}};
            default: return -2147483648.0;
        }
    }

    std::string DeleteKey(json& doc) {
        json* node = Pick(doc, [](const json& n) { return n.is_object() && !n.empty(); });
        if (node) {
            auto it = node->begin();
            std::advance(it, Int(0, static_cast<int>(node->size()) - 1));
            node->erase(it.key());
        }
        return doc.dump();
    }

    std::string DuplicateKey(json& doc) {
        static const char* const kKeys[] = {"grid", "width", "height", "entities", "events", "tiles", "texture",
                                            "sourceRect", "position", "col", "row", "trigger", "params", "items",
                                            "type", "id", "visuals", "floor", "backgroundImage", "rooms"};
        json* node = Pick(doc, [](const json& n) { return n.is_object(); });
        if (!node) {
            return doc.dump();
        }
        std::string key;
        if (!node->empty() && Int(0, 1)) {
            auto it = node->begin();
            std::advance(it, Int(0, static_cast<int>(node->size()) - 1));
            key = it.key();
        } else {
            key = kKeys[Int(0, static_cast<int>(sizeof(kKeys) / sizeof(kKeys[0])) - 1)];
        }
        const std::string original = node->dump();
        const std::string raw = "{" + json(key).dump() + ":" + RandomValue().dump() +
                                (node->empty() ? "" : ",") + original.substr(1);
        return ReplaceWithRaw(doc, *node, raw);
    }

    std::string SwapType(json& doc) {
        json* node = Pick(doc, [](const json&) { return true; });
        if (node) {
            *node = RandomValue();
        }
        return doc.dump();
    }

    std::string HugeNumber(json& doc) {
        static const char* const kHuge[] = {"1e400",
                                            "-1e400",
                                            "1e-400",
                                            "18446744073709551616",
                                            "18446744073709551615",
                                            "9223372036854775807",
                                            "-9223372036854775809",
                                            "2147483648",
                                            "-2147483649",
                                            "4294967296",
                                            "65536",
                                            "50000",
                                            "1.7976931348623157e308",
                                            "123456789012345678901234567890123456789",
                                            "-0",
                                            "0.00000000000000000000000000001"};
        json* node = Pick(doc, [](const json& n) { return n.is_number(); });
        if (!node) {
            node = Pick(doc, [](const json&) { return true; });
        }
        return ReplaceWithRaw(doc, *node, kHuge[Int(0, static_cast<int>(sizeof(kHuge) / sizeof(kHuge[0])) - 1)]);
    }

    std::string LongString(json& doc) {
        static const char* const kPieces[] = {"a", "../", "..\\", "%s%n", "\xC3\xB1", "/", "textures/"};
        json* node = Pick(doc, [](const json& n) { return n.is_string(); });
        if (!node) {
            node = Pick(doc, [](const json&) { return true; });
        }
        const std::string piece = kPieces[Int(0, static_cast<int>(sizeof(kPieces) / sizeof(kPieces[0])) - 1)];
        const int length = Int(10000, 200000);
        std::string value;
        while (static_cast<int>(value.size()) < length) {
            value += piece;
        }
        *node = value;
        return doc.dump();
    }

    // Una grilla grande, con o sin "tiles". Sin "tiles" es el riesgo EN-07 y
    // CheckGrid la descarta; con "tiles" se carga (la grilla no reserva nada).
    std::string HugeGrid(json& doc) {
        if (doc.is_object() && doc.contains("grid") && doc["grid"].is_object()) {
            doc["grid"]["width"] = Int(1000, 100000);
            doc["grid"]["height"] = Int(1000, 100000);
            if (Int(0, 1)) {
                doc.erase("tiles");
            }
        }
        return doc.dump();
    }

    // Anidamiento moderado: lo profundo de verdad se prueba en proceso aparte.
    std::string Nest(json& doc) {
        json* node = Pick(doc, [](const json&) { return true; });
        const int depth = Int(10, 400);
        const bool arrays = Int(0, 1) != 0;
        std::string raw;
        for (int i = 0; i < depth; ++i) {
            raw += arrays ? "[" : "{\"a\":";
        }
        raw += node->dump();
        for (int i = 0; i < depth; ++i) {
            raw += arrays ? "]" : "}";
        }
        return ReplaceWithRaw(doc, *node, raw);
    }
};

// --- Fixtures -----------------------------------------------------------------

// Un proyecto armado en una carpeta temporal, con un archivo AFUERA de
// assets/ y de levels/ que no deberia poder leerse desde el nivel:
//
//   <tmp>/proyecto/assets/textures/propia.png
//   <tmp>/proyecto/levels/
//   <tmp>/secreto/afuera.png       (7x5, para reconocerla si se carga)
//   <tmp>/secreto/afuera.txt
struct ProjectFixture {
    TempDir dir;
    fs::path project;
    fs::path assetsDir;
    fs::path levelsDir;
    fs::path secretPng;
    fs::path secretTxt;

    ProjectFixture() {
        project = dir.Path() / "proyecto";
        assetsDir = project / "assets";
        levelsDir = project / "levels";
        dir.WritePng("proyecto/assets/textures/propia.png", 16, 8, RED);
        fs::create_directories(levelsDir);
        secretPng = dir.WritePng("secreto/afuera.png", 7, 5, BLUE);
        secretTxt = dir.WriteText("secreto/afuera.txt", "dato privado");
    }
};

struct LoaderFixture : ProjectFixture {
    ResourceManager resources;
    AssetResolver assets;
    EventSystem events;
    LevelLoader loader;

    LoaderFixture() : assets(assetsDir.string()), loader(resources, assets) {}

    LoadedLevel Load(const json& level) {
        return loader.Load(dir.WriteJson("proyecto/levels/nivel.json", level).string(), events);
    }
};

// Lo que GameSession le pasa a EventBindings (ver test_event_bindings.cpp),
// con el nivel en curso dentro de <proyecto>/levels.
struct BindingsFixture {
    LoadedLevel level = TestSupport::OpenLevel(4, 4);
    LevelEntity* player = nullptr;
    std::unordered_map<std::string, LevelEntity*> entityById;
    std::unordered_set<std::string> flags;
    std::unordered_set<std::string> gameFlags;
    std::unordered_map<std::string, float> variables;
    std::vector<CollisionPair> collisions;
    Inventory inventory;
    Loot::State loot;
    std::vector<std::string> abilitiesUsed;
    ResourceManager resources;
    AssetResolver assets{TestSupport::RepoPath("assets").string()};
    AudioSystem audio;
    fs::path levelsDir = fs::path("proyecto") / "levels";
    fs::path currentLevelPath = levelsDir / "actual.json";
    EventBindings::Context ctx;
    EventSystem events;
    std::vector<fs::path> targets;

    BindingsFixture() {
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
        ctx.resources = &resources;
        ctx.assets = &assets;
        ctx.audio = &audio;
        ctx.currentLevelPath = &currentLevelPath;
        ctx.beginTransition = [this](const fs::path& target, const std::string&, bool) { targets.push_back(target); };
        ctx.showMessage = [](const std::string&, float) {};
        ctx.saveGame = []() {};
        EventBindings::RegisterAll(events, ctx);
        events.RegisterTrigger("siempre_para_prueba", [](const json&) { return true; });
    }

    // El destino al que load_level quiere pasar con ese "level".
    fs::path LoadLevelTarget(const std::string& file) {
        targets.clear();
        events.LoadEvents({EventDefinition{EventStep{"siempre_para_prueba", json::object()}, {},
                                           {EventStep{"load_level", json{{"level", file}}}}}});
        events.Update();
        REQUIRE(targets.size() == 1);
        return targets[0];
    }
};

// Rutas de prueba que intentan salir de la carpeta de assets/.
const std::vector<std::string> kClimbing = {"../../secreto/afuera.png", "textures/../../../secreto/afuera.png"};
const std::vector<std::string> kClimbingBackslash = {"..\\..\\secreto\\afuera.png",
                                                     "textures\\..\\..\\..\\secreto\\afuera.png"};

}  // namespace

TEST_SUITE("seguridad") {

// --- Auxiliar del proceso aparte ---------------------------------------------

// No corre sola: la lanza LoadInChildProcess con --no-skip y la ruta del nivel
// en HONEYCOMB_SEGURIDAD_NIVEL. Rechazar el nivel con una std::exception es un
// resultado valido; lo que se mide es si el proceso sobrevive.
TEST_CASE("auxiliar carga un nivel en un proceso aparte" * doctest::skip()) {
    const char* file = std::getenv(kChildEnv);
    if (file == nullptr || *file == '\0') {
        MESSAGE("sin " << kChildEnv << ": no hay nada que cargar");
        return;
    }
    ResourceManager resources;
    AssetResolver assets(TestSupport::RepoPath("assets").string());
    LevelLoader loader(resources, assets);
    EventSystem events;
    try {
        loader.Load(file, events);
        events.Update();
    } catch (const std::exception&) {
        // Rechazado con mensaje: es lo correcto.
    }
}

// --- Fuzzing del cargador de niveles ----------------------------------------

TEST_CASE("el cargador sobrevive a miles de niveles mutados") {
    // Cuantas mutaciones por nivel semilla. Con los ~26 niveles del
    // repositorio son unas 3000 cargas.
    constexpr int kPerSeed = 100;
    // Tope de tiempo por si una maquina lenta tarda mucho mas: se corta y se
    // informa, pero lo corrido cuenta igual.
    constexpr double kBudgetSeconds = 120.0;

    const std::vector<fs::path> seeds = FuzzSeeds();
    REQUIRE(seeds.size() >= 6);

    TempDir dir;
    const fs::path file = dir.Path() / "mutado.json";
    ResourceManager resources;
    AssetResolver assets(TestSupport::RepoPath("assets").string());
    LevelLoader loader(resources, assets);

    int iterations = 0;
    int loaded = 0;
    int skippedHuge = 0;
    int skippedOutOfInt = 0;
    int unknown = 0;
    std::map<std::string, int> rejectedBy;
    std::map<std::string, int> mutations;
    std::string firstUnknown;

    SetTraceLogLevel(LOG_NONE);
    const auto start = std::chrono::steady_clock::now();
    bool outOfTime = false;
    for (size_t s = 0; s < seeds.size() && !outOfTime; ++s) {
        const std::string original = ReadText(seeds[s]);
        Mutator mutator(0xC0FFEEu + static_cast<unsigned>(s) * 7919u);
        for (int i = 0; i < kPerSeed; ++i) {
            std::string kind;
            const std::string text = mutator.Mutate(original, kind);
            ++mutations[kind];

            switch (CheckGrid(text)) {
                case GridCheck::Huge: ++skippedHuge; continue;
                case GridCheck::OutOfInt: ++skippedOutOfInt; continue;
                case GridCheck::Ok: break;
            }

            {
                std::ofstream stream(file, std::ios::binary | std::ios::trunc);
                stream << text;
            }
            ++iterations;
            EventSystem events;
            try {
                LoadedLevel level = loader.Load(file.string(), events);
                ++loaded;
            } catch (const json::parse_error&) {
                ++rejectedBy["json::parse_error"];
            } catch (const json::type_error&) {
                ++rejectedBy["json::type_error"];
            } catch (const json::out_of_range&) {
                ++rejectedBy["json::out_of_range"];
            } catch (const json::exception&) {
                ++rejectedBy["json::otro"];
            } catch (const std::bad_alloc&) {
                ++rejectedBy["std::bad_alloc"];
            } catch (const std::runtime_error&) {
                ++rejectedBy["std::runtime_error"];
            } catch (const std::exception&) {
                ++rejectedBy["std::exception (otra)"];
            } catch (...) {
                // Sin mensaje: GameSession no puede avisar que paso.
                if (unknown++ == 0) {
                    firstUnknown = seeds[s].filename().u8string() + " / " + kind;
                }
            }
            // Las texturas que pidio cada mutacion se sueltan cada tanto: con
            // rutas de 200 KB la cache creceria sin parar.
            if (iterations % 50 == 0) {
                resources.UnloadAll();
            }
        }
        const double elapsed =
            std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
        outOfTime = elapsed > kBudgetSeconds;
    }
    const double seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
    SetTraceLogLevel(LOG_ERROR);

    std::ostringstream summary;
    summary << "fuzzing: " << seeds.size() << " semillas, " << iterations << " cargas en " << seconds
            << " s; cargaron " << loaded << "; descartadas por grilla enorme sin tiles (EN-07) " << skippedHuge
            << ", por medida fuera de int " << skippedOutOfInt << "; excepciones sin mensaje " << unknown;
    for (const auto& [type, count] : rejectedBy) {
        summary << "\n  rechazo " << type << ": " << count;
    }
    for (const auto& [kind, count] : mutations) {
        summary << "\n  mutacion " << kind << ": " << count;
    }
    MESSAGE(summary.str());

    CHECK_FALSE(outOfTime);
    CHECK(iterations >= 2000);
    CHECK_MESSAGE(unknown == 0, "primera excepcion que no es std::exception: " << firstUnknown);
}

// --- Anidamiento profundo (en proceso aparte) --------------------------------

TEST_CASE("un nivel que es solo cien mil listas anidadas se rechaza sin caerse") {
    // El parser de nlohmann es iterativo y su destructor tambien (3.10 en
    // adelante): ni leer ni liberar el documento usa la pila.
    TempDir dir;
    const fs::path file = dir.WriteText("anidado.json", NestedArrays(100000));
    const int code = LoadInChildProcess(file);
    CHECK_MESSAGE(code == 0, "el proceso termino con " << Hex(code));
}

TEST_CASE("un nombre de nivel con diez mil listas anidadas se rechaza sin caerse") {
    TempDir dir;
    const std::string text = "{\"name\":" + NestedArrays(10000) + ",\"grid\":{\"width\":2,\"height\":2}}";
    const int code = LoadInChildProcess(dir.WriteText("anidado.json", text));
    CHECK_MESSAGE(code == 0, "el proceso termino con " << Hex(code));
}

// Defecto conocido: EventLoader::ParseStep copia "params" con
// stepJson.value("params", ...), y el constructor de copia de nlohmann::json es
// RECURSIVO (a diferencia del parser y del destructor). Unos parametros con
// miles de listas anidadas agotan la pila y el motor se cierra con
// 0xC00000FD (stack overflow) sin mensaje: GameSession no puede atraparlo.
TEST_CASE("los parametros de un evento con diez mil listas anidadas no tiran el motor" *
          doctest::should_fail()) {
    TempDir dir;
    const std::string text = "{\"name\":\"x\",\"grid\":{\"width\":2,\"height\":2},\"entities\":[],"
                             "\"events\":[{\"trigger\":{\"type\":\"on_level_start\",\"params\":" +
                             NestedArrays(10000) + "}}]}";
    const int code = LoadInChildProcess(dir.WriteText("anidado.json", text));
    CHECK_MESSAGE(code == 0, "el proceso termino con " << Hex(code));
}

// Defecto conocido: igual que el anterior, en ItemLoader::ParseItems, que copia
// weapon.attack con weaponJson.value("attack", ...) antes de mirar su tipo.
TEST_CASE("el ataque de un arma con diez mil listas anidadas no tira el motor" * doctest::should_fail()) {
    TempDir dir;
    const std::string text = "{\"name\":\"x\",\"grid\":{\"width\":2,\"height\":2},\"entities\":[],"
                             "\"items\":[{\"id\":\"espada\",\"kind\":\"weapon\",\"weapon\":{\"attack\":" +
                             NestedArrays(10000) + "}}]}";
    const int code = LoadInChildProcess(dir.WriteText("anidado.json", text));
    CHECK_MESSAGE(code == 0, "el proceso termino con " << Hex(code));
}

// Defecto conocido: igual que el anterior, en ItemLoader::ParseEntityCombat,
// que copia shop.items con value("items", json::array()).
TEST_CASE("la tienda de una entidad con diez mil listas anidadas no tira el motor" * doctest::should_fail()) {
    TempDir dir;
    const std::string text =
        "{\"name\":\"x\",\"grid\":{\"width\":2,\"height\":2},\"entities\":[{\"id\":\"tendero\",\"type\":\"npc\","
        "\"position\":{\"col\":0,\"row\":0},\"texture\":\"textures/no_esta.png\","
        "\"sourceRect\":{\"x\":0,\"y\":0,\"width\":16,\"height\":16},\"shop\":{\"items\":" +
        NestedArrays(10000) + "}}]}";
    const int code = LoadInChildProcess(dir.WriteText("anidado.json", text));
    CHECK_MESSAGE(code == 0, "el proceso termino con " << Hex(code));
}

// --- Rutas de assets que salen de assets/ ------------------------------------
//
// AssetResolver::Resolve concatena "<raiz>/" + la ruta del JSON, sin
// normalizar. Lo usan todas las texturas del nivel (entidades, fondo, piso,
// pared, variantes de piso, objetos), play_sound (EventBindings.cpp) y las
// imagenes y la musica de game.json (GameSession.cpp).

// Defecto conocido: Resolve no rechaza ".." y Exists abre el archivo: un
// nivel puede leer cualquier archivo al que llegue subiendo carpetas.
TEST_CASE("assetresolver no lee archivos fuera de assets con rutas que suben" * doctest::should_fail()) {
    ProjectFixture fx;
    AssetResolver assets(fx.assetsDir.string());
    REQUIRE(assets.Exists("textures/propia.png"));
    CHECK_FALSE(assets.Exists("../../secreto/afuera.txt"));
    CHECK_FALSE(assets.Exists("textures/../../../secreto/afuera.txt"));
    for (const auto& reference : kClimbing) {
        CHECK_MESSAGE(InsideDir(fx.assetsDir, fs::u8path(assets.Resolve(reference))), reference);
    }
}

// Defecto conocido: en Windows la barra invertida tambien separa carpetas, y
// Resolve tampoco la mira.
TEST_CASE("assetresolver no lee fuera de assets con barras invertidas" * doctest::should_fail()) {
    ProjectFixture fx;
    AssetResolver assets(fx.assetsDir.string());
    CHECK_FALSE(assets.Exists("..\\..\\secreto\\afuera.txt"));
    for (const auto& reference : kClimbingBackslash) {
        CHECK_MESSAGE(InsideDir(fx.assetsDir, fs::u8path(assets.Resolve(reference))), reference);
    }
}

TEST_CASE("assetresolver no convierte una ruta absoluta en una lectura fuera de assets") {
    // "<raiz>/C:/..." no es una ruta valida en Windows: la ruta absoluta queda
    // DEBAJO de la raiz y no se abre. Seguro por como se arma, no porque se
    // valide.
    ProjectFixture fx;
    AssetResolver assets(fx.assetsDir.string());
    const std::string absolute = fs::absolute(fx.secretTxt).generic_u8string();
    REQUIRE(fs::exists(fx.secretTxt));
    CHECK_FALSE(assets.Exists(absolute));
    CHECK_FALSE(assets.Exists(fs::absolute(fx.secretTxt).string()));
#ifdef _WIN32
    if (fs::exists("C:/Windows/win.ini")) {
        CHECK_FALSE(assets.Exists("C:/Windows/win.ini"));
        CHECK_FALSE(assets.Exists("C:\\Windows\\win.ini"));
    }
#endif
}

TEST_CASE("assetresolver no convierte una ruta unc en una lectura de red") {
    // "<raiz>///servidor/recurso" ya no empieza con dos barras: no es UNC.
    ProjectFixture fx;
    AssetResolver assets(fx.assetsDir.string());
    for (const std::string reference : {"//servidor/recurso/x.png", "\\\\servidor\\recurso\\x.png"}) {
        const fs::path resolved = fs::u8path(assets.Resolve(reference));
        CHECK_MESSAGE(InsideDir(fx.assetsDir, resolved), reference);
        CHECK(resolved.root_name() == fs::absolute(fx.assetsDir).root_name());
    }
}

// Defecto conocido: la textura de una entidad se carga desde fuera de assets/
// (se reconoce porque mide 7x5, como la del archivo de afuera).
TEST_CASE("una textura de entidad con ruta que sube no se carga desde fuera de assets" *
          doctest::should_fail()) {
    for (const auto& reference : {kClimbing[0], kClimbingBackslash[0]}) {
        LoaderFixture fx;
        json level = TestSupport::MinimalLevel();
        level["entities"].push_back(TestSupport::EntityJson("intruso", "npc", 1, 1, reference));
        LoadedLevel loaded = fx.Load(level);
        REQUIRE(loaded.entities.size() == 1);
        CHECK_MESSAGE(loaded.entities[0].texture->width == 0, reference);
    }
}

// Defecto conocido: lo mismo con la imagen de fondo y las texturas de piso.
TEST_CASE("el fondo y el piso con ruta que sube no se cargan desde fuera de assets" * doctest::should_fail()) {
    LoaderFixture fx;
    const json rect = {{"x", 0}, {"y", 0}, {"width", 7}, {"height", 5}};
    json level = TestSupport::MinimalLevel();
    level["backgroundImage"] = {{"texture", kClimbing[0]}};
    level["visuals"] = {{"floor", {{"texture", kClimbing[1]}, {"sourceRect", rect}}},
                        {"floorVariants", json::array({{{"texture", kClimbingBackslash[0]}}})}};
    LoadedLevel loaded = fx.Load(level);
    REQUIRE(loaded.backgroundTexture != nullptr);
    CHECK(loaded.backgroundTexture->width == 0);
    REQUIRE(loaded.floorTexture != nullptr);
    CHECK(loaded.floorTexture->width == 0);
    REQUIRE(loaded.floorVariants.size() == 1);
    CHECK(loaded.floorVariants[0].texture->width == 0);
}

// Defecto conocido: lo mismo con la textura de un objeto (ItemLoader).
TEST_CASE("la textura de un objeto con ruta que sube no se carga desde fuera de assets" *
          doctest::should_fail()) {
    LoaderFixture fx;
    json level = TestSupport::MinimalLevel();
    level["items"] = json::array({{{"id", "moneda"}, {"kind", "coin"}, {"texture", kClimbing[0]}}});
    LoadedLevel loaded = fx.Load(level);
    REQUIRE(loaded.items.count("moneda") == 1);
    REQUIRE(loaded.items.at("moneda").texture != nullptr);
    CHECK(loaded.items.at("moneda").texture->width == 0);
}

TEST_CASE("una ruta de textura de doscientos mil caracteres no rompe el cargador") {
    LoaderFixture fx;
    json level = TestSupport::MinimalLevel();
    level["entities"].push_back(TestSupport::EntityJson("largo", "npc", 1, 1, std::string(200000, 'a') + ".png"));
    LoadedLevel loaded = fx.Load(level);
    REQUIRE(loaded.entities.size() == 1);
    CHECK(loaded.entities[0].texture->width == 0);
}

// --- load_level: el destino tiene que quedar en levels/ ----------------------
//
// EventBindings arma el destino como <carpeta del nivel>/<level>, con el
// operador / de std::filesystem. Ese operador, con una ruta absoluta a la
// derecha, DESCARTA la izquierda.

TEST_CASE("pasar de nivel con un nombre comun queda en levels") {
    BindingsFixture fx;
    CHECK(InsideDir(fx.levelsDir, fx.LoadLevelTarget("siguiente")));
    CHECK(InsideDir(fx.levelsDir, fx.LoadLevelTarget("mundo2/inicio.json")));
}

// Defecto conocido: ".." en "level" sale de levels/ (y del proyecto).
TEST_CASE("pasar de nivel con una ruta que sube no sale de levels" * doctest::should_fail()) {
    BindingsFixture fx;
    CHECK(InsideDir(fx.levelsDir, fx.LoadLevelTarget("../../fuera/nivel")));
    CHECK(InsideDir(fx.levelsDir, fx.LoadLevelTarget("..\\..\\fuera\\nivel.json")));
}

// Defecto conocido: una ruta absoluta reemplaza entera a la carpeta del nivel.
TEST_CASE("pasar de nivel con una ruta absoluta no sale de levels" * doctest::should_fail()) {
    BindingsFixture fx;
    const fs::path target = fx.LoadLevelTarget("C:/Windows/win.ini");
    CHECK_MESSAGE(InsideDir(fx.levelsDir, target), target.string());
}

// Defecto conocido: lo mismo con una ruta UNC; el motor intentaria abrir un
// recurso de red.
TEST_CASE("pasar de nivel con una ruta unc no sale de levels" * doctest::should_fail()) {
    BindingsFixture fx;
    const fs::path target = fx.LoadLevelTarget("//servidor/recurso/nivel.json");
    CHECK_MESSAGE(InsideDir(fx.levelsDir, target), target.string());
}

// --- Partida guardada y game.json ---------------------------------------------
//
// GameSession::ContinueGame abre LevelsDir() / save.level, y NewGame abre
// LevelsDir() / config.startLevel: el mismo operador / que load_level. Lo
// seguro es que Progress::Load y LoadGameConfig no entreguen una ruta que se
// salga.

// Defecto conocido: Progress::Load acepta cualquier "level".
TEST_CASE("la partida guardada no entrega un nivel fuera de levels" * doctest::should_fail()) {
    for (const std::string reference :
         {"../../fuera.json", "..\\..\\fuera.json", "C:/Windows/win.ini", "//servidor/recurso/nivel.json"}) {
        TempDir dir;
        dir.WriteJson("saves/partida.json", json{{"level", reference}});
        SaveData save;
        const bool loaded = Progress::Load(dir.Path(), save);
        CHECK_MESSAGE((!loaded || StaysInside(save.level)), reference);
    }
}

// Defecto conocido: LoadGameConfig guarda las rutas tal cual llegan.
TEST_CASE("game json no entrega rutas de assets que salen del proyecto" * doctest::should_fail()) {
    TempDir dir;
    dir.WriteJson("game.json",
                  json{{"name", "x"},
                       {"icon", "../../Windows/win.ini"},
                       {"titleScreen", {{"backgroundImage", "..\\..\\secreto.png"}, {"music", "../../musica.ogg"}}},
                       {"hud", {{"heartFull", "../../a.png"}, {"barFrame", "C:/Windows/b.png"}}}});
    const GameConfig config = LoadGameConfig(dir.Path());
    REQUIRE(config.present);
    CHECK(StaysInside(config.icon));
    CHECK(StaysInside(config.titleScreen.backgroundImage));
    CHECK(StaysInside(config.titleScreen.music));
    CHECK(StaysInside(config.hud.heartFull));
    CHECK(StaysInside(config.hud.barFrame));
}

// Defecto conocido: lo mismo con el nivel inicial.
TEST_CASE("game json no entrega un nivel inicial fuera de levels" * doctest::should_fail()) {
    for (const std::string reference : {"../../fuera.json", "C:/Windows/win.ini", "//servidor/recurso/nivel.json"}) {
        TempDir dir;
        dir.WriteJson("game.json", json{{"name", "x"}, {"startLevel", reference}});
        const GameConfig config = LoadGameConfig(dir.Path());
        CHECK_MESSAGE(StaysInside(config.startLevel), reference);
    }
}

TEST_CASE("la partida guardada y game json mutados nunca dejan escapar una excepcion") {
    // Los dos lectores atrapan sus errores y siguen con los valores de
    // siempre: ninguna mutacion tiene que llegar a GameSession como excepcion.
    SaveData sample;
    sample.level = "nivel.json";
    sample.hasPosition = true;
    sample.position = Vector2{2.5f, 3.0f};
    sample.health = 10.0f;
    sample.coins = 4;
    sample.weapons = {"espada"};
    sample.activeWeapon = 0;
    sample.levelFlags = {"a"};
    sample.gameFlags = {"b"};
    sample.variables = {{"llaves", 1.0f}};
    TempDir saveDir;
    REQUIRE(Progress::Write(saveDir.Path(), sample));
    const std::string saveText = ReadText(Progress::SavePath(saveDir.Path()));

    const std::string gameText =
        json{{"name", "Juego"},
             {"icon", "textures/icono.png"},
             {"window", {{"width", 1280}, {"height", 720}, {"fullscreen", false}}},
             {"startLevel", "inicio.json"},
             {"titleScreen", {{"style", "side"}, {"title", "T"}, {"titleColor", {{"r", 1}, {"g", 2}, {"b", 3}}}}},
             {"hud", {{"healthStyle", "hearts"}, {"segments", 5}, {"heartFull", "textures/c.png"}}},
             {"screens", {{"pauseTitle", "P"}, {"credits", json::array({"a", "b"})}}},
             {"variables", {{"puntos", 0}}}}
            .dump();

    Mutator mutator(0xBADC0DEu);
    TempDir dir;
    int iterations = 0;
    // Cada archivo roto se avisa por std::cerr: en la prueba es ruido.
    std::ostringstream discarded;
    std::streambuf* const previous = std::cerr.rdbuf(discarded.rdbuf());
    for (int i = 0; i < 400; ++i) {
        std::string kind;
        dir.WriteText("saves/partida.json", mutator.Mutate(saveText, kind));
        dir.WriteText("game.json", mutator.Mutate(gameText, kind));
        SaveData save;
        CHECK_NOTHROW(Progress::Load(dir.Path(), save));
        CHECK_NOTHROW(LoadGameConfig(dir.Path()));
        ++iterations;
    }
    std::cerr.rdbuf(previous);
    MESSAGE("partida y game.json: " << iterations << " mutaciones de cada uno");
}

}  // TEST_SUITE
