#include "EventBindings.hpp"

#include <algorithm>
#include <exception>
#include <iostream>

#include "game/Combat.hpp"
#include "game/Movement.hpp"
#include "game/Zones.hpp"

namespace EventBindings {

namespace {

// Un parametro numerico de un evento. Acepta numero o texto con un numero: el
// JSON se puede escribir a mano, y los niveles guardados por versiones
// anteriores del editor guardaban los campos numericos como texto.
float NumberParam(const nlohmann::json &params, const char *key, float fallback)
{
    if (!params.contains(key))
    {
        return fallback;
    }
    const auto &value = params.at(key);
    if (value.is_number())
    {
        return value.get<float>();
    }
    if (value.is_string())
    {
        try
        {
            return std::stof(value.get<std::string>());
        }
        catch (const std::exception &)
        {
        }
    }
    return fallback;
}

std::string StringParam(const nlohmann::json &params, const char *key)
{
    return params.contains(key) && params.at(key).is_string() ? params.at(key).get<std::string>() : std::string();
}

}  // namespace

void RegisterAll(EventSystem &events, Context &ctx)
{
    // Alias con los mismos nombres que tenian las variables en main(). Existen
    // para que los registros de abajo sean IDENTICOS a los de antes: siguen
    // capturando "&level", "&player", "&inventory"... y no hay que releer 24
    // lambdas para convencerse de que ninguna cambio de comportamiento.
    //
    // Son referencias, no copias: capturar por referencia una referencia deja
    // en la lambda una referencia al objeto apuntado (el de main()), no a este
    // alias local, asi que siguen siendo validas cuando RegisterAll termina.
    // "player" y "level" cambian al pasar de nivel, y los eventos lo ven.
    LoadedLevel &level = *ctx.level;
    LevelEntity *&player = *ctx.player;
    auto &entityById = *ctx.entityById;
    auto &flags = *ctx.flags;
    auto &currentCollisions = *ctx.collisions;
    Inventory &inventory = *ctx.inventory;
    Loot::State &loot = *ctx.loot;
    auto &abilitiesUsedThisFrame = *ctx.abilitiesUsed;
    ResourceManager &resources = *ctx.resources;
    AssetResolver &assets = *ctx.assets;
    AudioSystem &audio = *ctx.audio;
    std::filesystem::path &currentLevelPath = *ctx.currentLevelPath;
    auto &beginTransition = ctx.beginTransition;
    auto &showMessage = ctx.showMessage;

    // Trigger "on_collision": las dos entidades nombradas se tocan en este frame.
    events.RegisterTrigger("on_collision", [&currentCollisions, &entityById](const nlohmann::json &params) -> bool
                           {
        auto itA = entityById.find(params.value("entityA", std::string("")));
        auto itB = entityById.find(params.value("entityB", std::string("")));
        // Un id inexistente no rompe el nivel: el evento simplemente nunca
        // dispara (el editor pudo dejar guardada una referencia a algo borrado).
        if (itA == entityById.end() || itB == entityById.end()) {
            return false;
        }
        void* a = itA->second;
        void* b = itB->second;
        // CollisionSystem no garantiza el orden dentro del par: hay que probar
        // las dos combinaciones.
        for (const auto& pair : currentCollisions) {
            if ((pair.a == a && pair.b == b) || (pair.a == b && pair.b == a)) {
                return true;
            }
        }
        return false; });

    // Trigger "on_entity_destroyed": la entidad ya no esta en el nivel, porque
    // la vencieron en combate o la destruyo un evento. Es el "al eliminar a
    // este enemigo, pasar de nivel".
    events.RegisterTrigger("on_entity_destroyed", [&entityById](const nlohmann::json &params) -> bool
                           {
        auto it = entityById.find(params.value("entity", std::string("")));
        return it != entityById.end() && it->second->destroyed; });

    // Trigger "on_all_enemies_defeated": no queda ningun enemigo en pie. Un
    // nivel sin enemigos no lo dispara nunca: "vencer a todos" tiene que costar
    // algo, no cumplirse solo al arrancar.
    events.RegisterTrigger("on_all_enemies_defeated", [&level](const nlohmann::json &) -> bool
                           {
        bool anyEnemy = false;
        for (const auto& entity : level.entities) {
            if (!Combat::IsEnemy(entity)) {
                continue;
            }
            if (!entity.destroyed) {
                return false;
            }
            anyEnemy = true;
        }
        return anyEnemy; });

    // Condicion "flag_is_set": una accion set_flag ya activo esa marca.
    events.RegisterCondition("flag_is_set", [&flags](const nlohmann::json &params) -> bool
                             { return flags.count(params.value("flag", std::string(""))) > 0; });

    // Condicion "flag_is_not_set": la contraria. Una sala ya resuelta no vuelve
    // a cerrar sus puertas al entrar.
    events.RegisterCondition("flag_is_not_set", [&flags](const nlohmann::json &params) -> bool
                             { return flags.count(StringParam(params, "flag")) == 0; });

    // Accion "set_flag": activa una marca con nombre (la llave de un puzzle).
    events.RegisterAction("set_flag", [&flags](const nlohmann::json &params)
                          {
        std::string flag = params.value("flag", std::string(""));
        if (!flag.empty()) {
            flags.insert(flag);
        } });

    // Accion "destroy_entity": borrado suave. No se saca del vector porque eso
    // invalidaria los punteros de entityById; se marca la entidad y el resto
    // del bucle la saltea al dibujar y al colisionar.
    events.RegisterAction("destroy_entity", [&entityById](const nlohmann::json &params)
                          {
        auto it = entityById.find(params.value("entity", std::string("")));
        if (it != entityById.end() && !it->second->destroyed) {
            it->second->destroyed = true;
            std::cout << "Accion destroy_entity ejecutada sobre '" << it->first << "'" << std::endl;
        } });

    // Accion "play_sound": ResourceManager cachea por ruta, asi que dispararla
    // varias veces no vuelve a leer el .wav del disco.
    events.RegisterAction("play_sound", [&resources, &assets, &audio](const nlohmann::json &params)
                          {
        const Sound& sound = resources.GetSound(assets.Resolve(params.value("soundPath", std::string(""))));
        audio.PlaySoundEffect(sound); });

    // Accion "load_level": agenda el paso a otro nivel de la MISMA carpeta
    // levels/ que el actual. "level" es el nombre del archivo; si viene sin
    // extension se le agrega .json.
    events.RegisterAction("load_level", [&beginTransition, &currentLevelPath](const nlohmann::json &params)
                          {
        std::string file = params.value("level", std::string(""));
        if (file.empty()) {
            std::cerr << "load_level sin nivel de destino: se ignora." << std::endl;
            return;
        }
        std::filesystem::path target = currentLevelPath.parent_path() / file;
        if (!target.has_extension()) {
            target += ".json";
        }
        std::string title = params.value("message", std::string(""));
        beginTransition(target, title.empty() ? "¡Nivel superado!" : title, false); });

    // --- Eventos de combate, objetos y puzzles --------------------------------

    // Trigger "on_boss_defeated": cayo el ultimo jefe. Sin jefes no dispara.
    events.RegisterTrigger("on_boss_defeated", [&level](const nlohmann::json &) -> bool
                           {
        bool anyBoss = false;
        for (const auto& entity : level.entities) {
            if (!entity.boss) {
                continue;
            }
            if (!entity.destroyed) {
                return false;
            }
            anyBoss = true;
        }
        return anyBoss; });

    // Trigger "on_zone_cleared": cayeron todos los enemigos que arrancaron en la zona.
    events.RegisterTrigger("on_zone_cleared", [&level](const nlohmann::json &params) -> bool
                           {
        const Zone* zone = Zones::Find(level, StringParam(params, "zone"));
        return zone && Zones::IsCleared(level, *zone); });

    // Trigger "on_items_collected": la recoleccion. Con count 0 (o sin count)
    // hay que juntar TODOS los objetos colocados de ese tipo; con count N, N
    // juntados de cualquier origen (colocados o soltados por enemigos).
    events.RegisterTrigger("on_items_collected", [&level, &loot](const nlohmann::json &params) -> bool
                           {
        const std::string item = StringParam(params, "item");
        const int count = static_cast<int>(NumberParam(params, "count", 0.0f));
        if (count > 0) {
            if (item.empty()) {
                return loot.collectedTotal >= count;
            }
            auto it = loot.collected.find(item);
            return it != loot.collected.end() && it->second >= count;
        }
        bool anyPlaced = false;
        for (const auto& entity : level.entities) {
            if (entity.itemId.empty() || (!item.empty() && entity.itemId != item)) {
                continue;
            }
            if (!entity.destroyed) {
                return false;
            }
            anyPlaced = true;
        }
        return anyPlaced; });

    // Trigger "on_player_enter_zone" y condicion "player_in_zone": la misma
    // pregunta. Como trigger dispara al ENTRAR (EventSystem ejecuta cuando pasa
    // a cumplirse); como condicion vale mientras siga adentro.
    auto playerInZone = [&level, &player](const nlohmann::json &params) -> bool
    {
        const Zone *zone = Zones::Find(level, StringParam(params, "zone"));
        return zone && player && Combat::IsActive(*player) &&
               Zones::Contains(*zone, Movement::BoxCenter(*player));
    };
    events.RegisterTrigger("on_player_enter_zone", playerInZone);
    events.RegisterCondition("player_in_zone", playerInZone);

    // Trigger "on_ability_used": el jugador lanzo la habilidad de esa arma en este frame.
    events.RegisterTrigger("on_ability_used", [&abilitiesUsedThisFrame](const nlohmann::json &params) -> bool
                           {
        const std::string item = StringParam(params, "item");
        return std::any_of(abilitiesUsedThisFrame.begin(), abilitiesUsedThisFrame.end(),
                           [&item](const std::string& used) { return item.empty() || used == item; }); });

    events.RegisterCondition("has_item", [&inventory](const nlohmann::json &params) -> bool
                             { return inventory.HasItem(StringParam(params, "item")); });

    events.RegisterCondition("coins_at_least", [&inventory](const nlohmann::json &params) -> bool
                             { return inventory.coins >= NumberParam(params, "amount", 0.0f); });

    // Acciones "show_entity" / "hide_entity": las puertas de un puzzle. Ocultar
    // no es destruir: no dispara "Al eliminar una entidad" y se puede deshacer.
    events.RegisterAction("show_entity", [&entityById](const nlohmann::json &params)
                          {
        auto it = entityById.find(StringParam(params, "entity"));
        if (it != entityById.end()) {
            it->second->hidden = false;
        } });
    events.RegisterAction("hide_entity", [&entityById](const nlohmann::json &params)
                          {
        auto it = entityById.find(StringParam(params, "entity"));
        if (it != entityById.end()) {
            it->second->hidden = true;
        } });

    events.RegisterAction("give_item", [&level, &player, &inventory, &loot, &showMessage](const nlohmann::json &params)
                          {
        auto it = level.items.find(StringParam(params, "item"));
        if (it == level.items.end() || !player || player->destroyed) {
            return;
        }
        std::string text;
        Loot::Give(it->second, *player, inventory, loot.ground, true, text);
        showMessage(text, kPickupMessageSeconds); });

    events.RegisterAction("add_coins", [&inventory](const nlohmann::json &params)
                          {
        inventory.coins = std::max(0, inventory.coins + static_cast<int>(NumberParam(params, "amount", 0.0f))); });

    events.RegisterAction("heal_player", [&player](const nlohmann::json &params)
                          {
        if (player && !player->destroyed) {
            player->health = std::min(player->maxHealth, player->health + NumberParam(params, "amount", 0.0f));
        } });

    // Accion "set_inventory_slots": respeta el limite bloqueado (Inventory lo
    // ignora), y lo que ya no entra queda en el piso para no perderlo.
    events.RegisterAction("set_inventory_slots", [&player, &inventory, &loot](const nlohmann::json &params)
                          {
        const std::vector<ItemDef> dropped =
            inventory.SetSlots(static_cast<int>(NumberParam(params, "slots", static_cast<float>(inventory.Slots()))));
        if (player) {
            Loot::DropItems(loot, dropped, player->precisePosition);
        } });

    events.RegisterAction("show_message", [&showMessage](const nlohmann::json &params)
                          { showMessage(StringParam(params, "text"), kMessageSeconds); });
}

}  // namespace EventBindings
