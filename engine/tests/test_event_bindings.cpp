// Pruebas de EventBindings: que significa cada bloque del catalogo de eventos
// (schema/event_catalog.json) en el juego. Se registran todos sobre un
// EventSystem real y se los dispara con eventos sueltos, igual que los dispara
// un nivel.

#include "doctest/doctest.h"

#include <filesystem>
#include <string>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "nlohmann/json.hpp"

#include "core/ResourceManager.hpp"
#include "game/EventBindings.hpp"
#include "game/Inventory.hpp"
#include "game/Loot.hpp"
#include "loader/AssetResolver.hpp"
#include "support/TestSupport.hpp"
#include "systems/audio/AudioSystem.hpp"
#include "systems/event_system/EventSystem.hpp"

using nlohmann::json;
using TestSupport::MakeEntity;
using TestSupport::OpenLevel;

namespace {

EventStep Step(const std::string& type, json params = json::object()) {
    return EventStep{type, std::move(params)};
}

ItemDef Weapon(const std::string& id) {
    ItemDef item;
    item.id = id;
    item.name = id;
    item.kind = ItemKind::Weapon;
    return item;
}

// Todo lo que main()/GameSession le pasan a RegisterAll, como variables de
// la prueba. Lo que los eventos piden afuera (transicion, mensaje, guardar)
// queda anotado para poder revisarlo.
struct BindingsFixture {
    LoadedLevel level = OpenLevel(8, 8);
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
    std::filesystem::path currentLevelPath = std::filesystem::path("proyecto") / "levels" / "actual.json";
    EventBindings::Context ctx;
    EventSystem events;

    std::vector<std::tuple<std::filesystem::path, std::string, bool>> transitions;
    std::vector<std::pair<std::string, float>> messages;
    int saves = 0;
    int probes = 0;

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
        ctx.beginTransition = [this](const std::filesystem::path& target, const std::string& title, bool restart) {
            transitions.emplace_back(target, title, restart);
        };
        ctx.showMessage = [this](const std::string& text, float seconds) { messages.emplace_back(text, seconds); };
        ctx.saveGame = [this]() { ++saves; };
        EventBindings::RegisterAll(events, ctx);
        // Una accion de la prueba: cuenta cuantas veces se ejecuto el evento.
        events.RegisterAction("prueba_disparo", [this](const json&) { ++probes; });
    }

    LevelEntity& Add(const std::string& id, const std::string& type, float col, float row) {
        level.entities.push_back(MakeEntity(id, type, col, row));
        Index();
        return level.entities.back();
    }

    // Rearma entityById y player como GameSession::PrepareLevel: con punteros
    // al vector de entidades, que no se vuelve a tocar.
    void Index() {
        entityById.clear();
        player = nullptr;
        for (auto& entity : level.entities) {
            entityById[entity.id] = &entity;
            if (entity.type == "player") {
                player = &entity;
            }
        }
    }

    LevelEntity& Entity(const std::string& id) { return *entityById.at(id); }

    // true si el trigger (y las condiciones) disparan en este frame. Se carga
    // de nuevo cada vez, asi la memoria de "ya se cumplia" arranca en falso.
    bool Fires(EventStep trigger, std::vector<EventStep> conditions = {}) {
        probes = 0;
        events.LoadEvents({EventDefinition{std::move(trigger), std::move(conditions), {Step("prueba_disparo")}}});
        events.Update();
        return probes > 0;
    }

    bool Holds(EventStep condition) { return Fires(Step("siempre_para_prueba"), {std::move(condition)}); }

    void Run(EventStep action) {
        events.LoadEvents({EventDefinition{Step("siempre_para_prueba"), {}, {std::move(action)}}});
        events.Update();
    }
};

// Las condiciones y acciones se prueban detras de un trigger que siempre dispara.
struct Fixture : BindingsFixture {
    Fixture() {
        events.RegisterTrigger("siempre_para_prueba", [](const json&) { return true; });
    }
};

}  // namespace

TEST_SUITE("enlaces de eventos") {

// --- Triggers ------------------------------------------------------------------

TEST_CASE("al chocar dispara con el par en cualquier orden") {
    Fixture fx;
    fx.Add("a", "player", 1, 1);
    fx.Add("b", "npc", 2, 1);
    const EventStep trigger = Step("on_collision", {{"entityA", "a"}, {"entityB", "b"}});
    CHECK_FALSE(fx.Fires(trigger));

    fx.collisions = {CollisionPair{&fx.Entity("b"), &fx.Entity("a")}};
    CHECK(fx.Fires(trigger));
}

TEST_CASE("al chocar con un id que no existe no dispara") {
    Fixture fx;
    fx.Add("a", "player", 1, 1);
    fx.collisions = {CollisionPair{&fx.Entity("a"), &fx.Entity("a")}};
    CHECK_FALSE(fx.Fires(Step("on_collision", {{"entityA", "a"}, {"entityB", "borrada"}})));
}

TEST_CASE("al eliminar una entidad dispara cuando queda destruida") {
    Fixture fx;
    fx.Add("orco", "enemy", 3, 3);
    const EventStep trigger = Step("on_entity_destroyed", {{"entity", "orco"}});
    CHECK_FALSE(fx.Fires(trigger));
    fx.Entity("orco").destroyed = true;
    CHECK(fx.Fires(trigger));
    CHECK_FALSE(fx.Fires(Step("on_entity_destroyed", {{"entity", "nadie"}})));
}

TEST_CASE("vencer a todos no dispara en un nivel sin enemigos") {
    Fixture fx;
    fx.Add("jugador", "player", 1, 1);
    CHECK_FALSE(fx.Fires(Step("on_all_enemies_defeated")));
}

TEST_CASE("vencer a todos dispara cuando cae el ultimo enemigo") {
    Fixture fx;
    fx.Add("e1", "enemy", 1, 1);
    fx.Add("e2", "enemy", 2, 2);
    fx.Add("npc", "npc", 3, 3);
    fx.Entity("e1").destroyed = true;
    CHECK_FALSE(fx.Fires(Step("on_all_enemies_defeated")));
    fx.Entity("e2").destroyed = true;
    CHECK(fx.Fires(Step("on_all_enemies_defeated")));
}

TEST_CASE("vencer al jefe dispara cuando caen todos los jefes") {
    Fixture fx;
    CHECK_FALSE(fx.Fires(Step("on_boss_defeated")));
    fx.Add("jefe", "enemy", 1, 1).boss = true;
    CHECK_FALSE(fx.Fires(Step("on_boss_defeated")));
    fx.Entity("jefe").destroyed = true;
    CHECK(fx.Fires(Step("on_boss_defeated")));
}

TEST_CASE("limpiar una zona dispara cuando caen sus enemigos") {
    Fixture fx;
    fx.level.zones.push_back(Zone{"sala", 0, 0, 3, 3});
    fx.Add("adentro", "enemy", 1, 1);
    fx.Add("afuera", "enemy", 6, 6);
    const EventStep trigger = Step("on_zone_cleared", {{"zone", "sala"}});
    CHECK_FALSE(fx.Fires(trigger));
    fx.Entity("adentro").destroyed = true;
    CHECK(fx.Fires(trigger));
    CHECK_FALSE(fx.Fires(Step("on_zone_cleared", {{"zone", "no_existe"}})));
}

TEST_CASE("juntar objetos sin cantidad pide todos los colocados") {
    Fixture fx;
    CHECK_FALSE(fx.Fires(Step("on_items_collected", {{"item", "moneda"}})));
    fx.Add("m1", "item", 1, 1).itemId = "moneda";
    fx.Add("m2", "item", 2, 1).itemId = "moneda";
    const EventStep trigger = Step("on_items_collected", {{"item", "moneda"}});
    fx.Entity("m1").destroyed = true;
    CHECK_FALSE(fx.Fires(trigger));
    fx.Entity("m2").destroyed = true;
    CHECK(fx.Fires(trigger));
}

TEST_CASE("juntar objetos con cantidad cuenta lo juntado de cualquier origen") {
    Fixture fx;
    fx.loot.collected["moneda"] = 2;
    fx.loot.collectedTotal = 3;
    CHECK(fx.Fires(Step("on_items_collected", {{"item", "moneda"}, {"count", 2}})));
    CHECK_FALSE(fx.Fires(Step("on_items_collected", {{"item", "moneda"}, {"count", 3}})));
    // Una cantidad escrita como texto, como la guardaban editores viejos.
    CHECK(fx.Fires(Step("on_items_collected", {{"count", "3"}})));
    CHECK_FALSE(fx.Fires(Step("on_items_collected", {{"item", "llave"}, {"count", 1}})));
}

TEST_CASE("entrar a una zona dispara con el jugador adentro y activo") {
    Fixture fx;
    fx.level.zones.push_back(Zone{"puerta", 4, 4, 2, 2});
    const EventStep trigger = Step("on_player_enter_zone", {{"zone", "puerta"}});
    CHECK_FALSE(fx.Fires(trigger));  // sin jugador
    fx.Add("jugador", "player", 1, 1);
    CHECK_FALSE(fx.Fires(trigger));
    fx.player->precisePosition = Vector2{4.6f, 5.2f};
    CHECK(fx.Fires(trigger));
    CHECK(fx.Holds(Step("player_in_zone", {{"zone", "puerta"}})));
    fx.player->hidden = true;
    CHECK_FALSE(fx.Fires(trigger));
}

TEST_CASE("usar una habilidad dispara con el arma que la lanzo") {
    Fixture fx;
    CHECK_FALSE(fx.Fires(Step("on_ability_used", {{"item", "espada"}})));
    fx.abilitiesUsed = {"espada"};
    CHECK(fx.Fires(Step("on_ability_used", {{"item", "espada"}})));
    CHECK(fx.Fires(Step("on_ability_used")));  // sin arma: cualquiera
    CHECK_FALSE(fx.Fires(Step("on_ability_used", {{"item", "arco"}})));
}

// --- Marcas y variables --------------------------------------------------------

TEST_CASE("una marca del nivel y una de la partida se guardan en lugares distintos") {
    Fixture fx;
    fx.Run(Step("set_flag", {{"flag", "llave"}}));
    fx.Run(Step("set_flag", {{"flag", "jefe_vencido"}, {"persist", true}}));
    fx.Run(Step("set_flag", {{"flag", "texto"}, {"persist", "true"}}));
    fx.Run(Step("set_flag", {{"flag", ""}}));
    CHECK(fx.flags == std::unordered_set<std::string>{"llave"});
    CHECK(fx.gameFlags == std::unordered_set<std::string>{"jefe_vencido", "texto"});
}

TEST_CASE("las condiciones de marca miran el nivel y la partida") {
    Fixture fx;
    CHECK_FALSE(fx.Holds(Step("flag_is_set", {{"flag", "llave"}})));
    CHECK(fx.Holds(Step("flag_is_not_set", {{"flag", "llave"}})));
    fx.gameFlags.insert("llave");
    CHECK(fx.Holds(Step("flag_is_set", {{"flag", "llave"}})));
    CHECK_FALSE(fx.Holds(Step("flag_is_not_set", {{"flag", "llave"}})));
}

TEST_CASE("fijar y sumar variables aceptan numeros escritos como texto") {
    Fixture fx;
    fx.Run(Step("set_variable", {{"variable", "puntos"}, {"value", "3.5"}}));
    CHECK(fx.variables.at("puntos") == doctest::Approx(3.5f));
    fx.Run(Step("add_variable", {{"variable", "puntos"}, {"amount", -1}}));
    CHECK(fx.variables.at("puntos") == doctest::Approx(2.5f));
    // Sin cantidad suma uno, y una variable nueva arranca en cero.
    fx.Run(Step("add_variable", {{"variable", "llaves"}}));
    CHECK(fx.variables.at("llaves") == doctest::Approx(1.0f));
    // Un texto que no es numero usa el valor por defecto.
    fx.Run(Step("set_variable", {{"variable", "x"}, {"value", "abc"}}));
    CHECK(fx.variables.at("x") == doctest::Approx(0.0f));
    fx.Run(Step("set_variable", {{"value", 9}}));
    CHECK(fx.variables.count("") == 0);
}

TEST_CASE("comparar una variable usa el operador del catalogo") {
    Fixture fx;
    fx.variables["llaves"] = 3.0f;
    const auto compare = [&fx](const char* op, float value) {
        return fx.Holds(Step("variable_compare", {{"variable", "llaves"}, {"comparison", op}, {"value", value}}));
    };
    CHECK(compare("==", 3));
    CHECK_FALSE(compare("==", 2));
    CHECK(compare("!=", 2));
    CHECK(compare(">", 2));
    CHECK_FALSE(compare(">", 3));
    CHECK(compare("<", 4));
    CHECK(compare("<=", 3));
    CHECK(compare(">=", 3));
    // Un operador desconocido se toma como ">=".
    CHECK(compare("mas o menos", 3));
    CHECK_FALSE(compare("mas o menos", 4));
    // Una variable que nunca se fijo vale cero.
    CHECK(fx.Holds(Step("variable_compare", {{"variable", "nueva"}, {"comparison", "=="}, {"value", 0}})));
}

// --- Acciones sobre el juego ---------------------------------------------------

TEST_CASE("guardar partida llama a quien sabe guardar") {
    Fixture fx;
    fx.Run(Step("save_game"));
    CHECK(fx.saves == 1);
    fx.ctx.saveGame = nullptr;
    CHECK_NOTHROW(fx.Run(Step("save_game")));
}

TEST_CASE("destruir una entidad la marca sin sacarla del nivel") {
    Fixture fx;
    fx.Add("orco", "enemy", 2, 2);
    fx.Run(Step("destroy_entity", {{"entity", "orco"}}));
    CHECK(fx.Entity("orco").destroyed);
    CHECK(fx.level.entities.size() == 1);
    CHECK_NOTHROW(fx.Run(Step("destroy_entity", {{"entity", "nadie"}})));
}

TEST_CASE("ocultar y mostrar una entidad no la destruye") {
    Fixture fx;
    fx.Add("puerta", "prop", 2, 2);
    fx.Run(Step("hide_entity", {{"entity", "puerta"}}));
    CHECK(fx.Entity("puerta").hidden);
    CHECK_FALSE(fx.Entity("puerta").destroyed);
    fx.Run(Step("show_entity", {{"entity", "puerta"}}));
    CHECK_FALSE(fx.Entity("puerta").hidden);
}

TEST_CASE("pasar de nivel agenda el destino en la misma carpeta") {
    Fixture fx;
    fx.Run(Step("load_level", {{"level", "siguiente"}}));
    REQUIRE(fx.transitions.size() == 1);
    const auto& [target, title, restart] = fx.transitions[0];
    CHECK(target == std::filesystem::path("proyecto") / "levels" / "siguiente.json");
    CHECK(title == "\xC2\xA1Nivel superado!");
    CHECK_FALSE(restart);

    fx.Run(Step("load_level", {{"level", "final.json"}, {"message", "Fin"}}));
    REQUIRE(fx.transitions.size() == 2);
    CHECK(std::get<0>(fx.transitions[1]).filename() == "final.json");
    CHECK(std::get<1>(fx.transitions[1]) == "Fin");
}

TEST_CASE("pasar de nivel sin destino se ignora") {
    Fixture fx;
    fx.Run(Step("load_level"));
    CHECK(fx.transitions.empty());
}

TEST_CASE("mostrar mensaje pide el texto por tres segundos") {
    Fixture fx;
    fx.Run(Step("show_message", {{"text", "Hola"}}));
    REQUIRE(fx.messages.size() == 1);
    CHECK(fx.messages[0].first == "Hola");
    CHECK(fx.messages[0].second == doctest::Approx(EventBindings::kMessageSeconds));
}

TEST_CASE("dar un objeto lo entrega y avisa") {
    Fixture fx;
    LevelEntity& player = fx.Add("jugador", "player", 1, 1);
    player.health = 50.0f;
    player.maxHealth = 100.0f;
    ItemDef potion;
    potion.id = "pocion";
    potion.name = "Pocion";
    potion.kind = ItemKind::Healing;
    potion.heal = 30.0f;
    fx.level.items["pocion"] = potion;

    fx.Run(Step("give_item", {{"item", "pocion"}}));
    CHECK(fx.player->health == doctest::Approx(80.0f));
    REQUIRE(fx.messages.size() == 1);
    CHECK(fx.messages[0].second == doctest::Approx(EventBindings::kPickupMessageSeconds));

    fx.Run(Step("give_item", {{"item", "no_definido"}}));
    CHECK(fx.messages.size() == 1);
}

TEST_CASE("dar un objeto sin jugador no hace nada") {
    Fixture fx;
    fx.level.items["moneda"] = ItemDef{};
    CHECK_NOTHROW(fx.Run(Step("give_item", {{"item", "moneda"}})));
    CHECK(fx.messages.empty());
}

TEST_CASE("las monedas suman y nunca quedan negativas") {
    Fixture fx;
    fx.Run(Step("add_coins", {{"amount", 5}}));
    CHECK(fx.inventory.coins == 5);
    CHECK(fx.Holds(Step("coins_at_least", {{"amount", 5}})));
    CHECK_FALSE(fx.Holds(Step("coins_at_least", {{"amount", 6}})));
    fx.Run(Step("add_coins", {{"amount", -100}}));
    CHECK(fx.inventory.coins == 0);
}

TEST_CASE("curar al jugador no pasa de su vida maxima") {
    Fixture fx;
    LevelEntity& player = fx.Add("jugador", "player", 1, 1);
    player.health = 90.0f;
    player.maxHealth = 100.0f;
    fx.Run(Step("heal_player", {{"amount", 50}}));
    CHECK(fx.player->health == doctest::Approx(100.0f));
}

TEST_CASE("tener un objeto mira el inventario") {
    Fixture fx;
    CHECK_FALSE(fx.Holds(Step("has_item", {{"item", "espada"}})));
    ItemDef dropped;
    fx.inventory.AddWeapon(Weapon("espada"), false, dropped);
    CHECK(fx.Holds(Step("has_item", {{"item", "espada"}})));
}

TEST_CASE("achicar el inventario deja en el piso lo que no entra") {
    Fixture fx;
    fx.Add("jugador", "player", 2, 3);
    ItemCatalog catalog{{"a", Weapon("a")}, {"b", Weapon("b")}, {"c", Weapon("c")}};
    InventoryConfig config;
    config.present = true;
    config.slots = 3;
    config.items = {"a", "b", "c"};
    fx.inventory.Configure(config, catalog);

    fx.Run(Step("set_inventory_slots", {{"slots", 1}}));
    CHECK(fx.inventory.Slots() == 1);
    CHECK(fx.inventory.Weapons().size() == 1);
    REQUIRE(fx.loot.ground.size() == 2);
    CHECK(fx.loot.ground[0].position.x == doctest::Approx(2.0f));
    CHECK(fx.loot.ground[0].position.y == doctest::Approx(3.0f));
}

TEST_CASE("reproducir un sonido no rompe aunque el archivo falte") {
    Fixture fx;
    CHECK_NOTHROW(fx.Run(Step("play_sound", {{"soundPath", "sounds/hit.wav"}})));
    CHECK_NOTHROW(fx.Run(Step("play_sound", {{"soundPath", "sounds/no_esta.wav"}})));
}

TEST_CASE("un parametro de texto escrito como numero no rompe los bloques que usan string param") {
    Fixture fx;
    fx.Add("5", "npc", 1, 1);
    CHECK_NOTHROW(fx.Fires(Step("on_zone_cleared", {{"zone", 5}})));
    CHECK_NOTHROW(fx.Holds(Step("flag_is_set", {{"flag", 5}})));
    CHECK_NOTHROW(fx.Run(Step("hide_entity", {{"entity", 5}})));
    CHECK_NOTHROW(fx.Run(Step("show_message", {{"text", 5}})));
}

// Todos los bloques leen sus parametros de texto con StringParam: un numero
// donde va un texto se trata como un id que no existe, sin lanzar. Antes
// on_collision, on_entity_destroyed, set_flag, destroy_entity, play_sound y
// load_level usaban params.value(clave, std::string()), que lanzaba
// nlohmann::json::type_error y cerraba el juego.
TEST_CASE("un parametro de texto escrito como numero no rompe ningun bloque") {
    Fixture fx;
    fx.Add("5", "npc", 1, 1);
    CHECK_NOTHROW(fx.Fires(Step("on_collision", {{"entityA", 5}, {"entityB", "5"}})));
    CHECK_NOTHROW(fx.Fires(Step("on_entity_destroyed", {{"entity", 5}})));
    CHECK_NOTHROW(fx.Run(Step("set_flag", {{"flag", 5}})));
    CHECK_NOTHROW(fx.Run(Step("destroy_entity", {{"entity", 5}})));
    CHECK_NOTHROW(fx.Run(Step("play_sound", {{"soundPath", 5}})));
    CHECK_NOTHROW(fx.Run(Step("load_level", {{"level", 5}})));
    CHECK_NOTHROW(fx.Run(Step("load_level", {{"level", "otro"}, {"message", 5}})));
}

}  // TEST_SUITE
