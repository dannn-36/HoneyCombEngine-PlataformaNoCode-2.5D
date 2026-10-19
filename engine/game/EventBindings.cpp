#include "EventBindings.hpp"

#include <algorithm>
#include <cmath>
#include <exception>
#include <iostream>
#include <unordered_map>

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

// El "Volumen %" de un sonido o una musica (0 a 100, sin el campo = 100),
// como lo espera AudioSystem: de 0 a 1.
float VolumeParam(const nlohmann::json &params)
{
    return std::clamp(NumberParam(params, "volume", 100.0f), 0.0f, 100.0f) / 100.0f;
}

std::string StringParam(const nlohmann::json &params, const char *key)
{
    return params.contains(key) && params.at(key).is_string() ? params.at(key).get<std::string>() : std::string();
}

// Un parametro de si/no. Acepta true/false o el texto "true", que es como
// guardaban los campos las versiones anteriores del editor.
bool BoolParam(const nlohmann::json &params, const char *key)
{
    if (!params.contains(key))
    {
        return false;
    }
    const auto &value = params.at(key);
    return value.is_boolean() ? value.get<bool>() : value.is_string() && value.get<std::string>() == "true";
}

// La comparacion de "Si la variable…": el texto del catalogo ("<", ">=",
// "=="...). Una que no se conoce se toma como ">=", la de por defecto.
bool Compare(float left, const std::string &op, float right)
{
    if (op == "==")
        return left == right;
    if (op == "!=")
        return left != right;
    if (op == ">")
        return left > right;
    if (op == "<")
        return left < right;
    if (op == "<=")
        return left <= right;
    return left >= right;
}

}  // namespace

int KeyFromName(const std::string &name)
{
    // Las que ofrece el catalogo ("key" de "Al pulsar una tecla"). No estan las
    // que ya usa el juego para moverse, pelear o elegir arma: un evento en esas
    // dispararia con cada paso o cada golpe.
    static const std::unordered_map<std::string, int> kKeys{
        {"E", KEY_E}, {"F", KEY_F}, {"R", KEY_R}, {"T", KEY_T}, {"G", KEY_G}, {"Z", KEY_Z},
        {"X", KEY_X}, {"C", KEY_C}, {"V", KEY_V}, {"B", KEY_B}, {"ENTER", KEY_ENTER}, {"TAB", KEY_TAB},
    };
    const auto it = kKeys.find(name);
    return it == kKeys.end() ? KEY_NULL : it->second;
}

bool InInteractReach(const LevelEntity &player, const LevelEntity &entity)
{
    if (!Combat::IsActive(entity) || &player == &entity)
    {
        return false;
    }
    const Vector2 a = Movement::BoxCenter(player);
    const Vector2 b = Movement::BoxCenter(entity);
    return std::hypot(a.x - b.x, a.y - b.y) <= kInteractReach + (static_cast<float>(entity.span) - 1.0f) / 2.0f;
}

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
    auto &gameFlags = *ctx.gameFlags;
    auto &variables = *ctx.variables;
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
        auto itA = entityById.find(StringParam(params, "entityA"));
        auto itB = entityById.find(StringParam(params, "entityB"));
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
        auto it = entityById.find(StringParam(params, "entity"));
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

    // Condicion "flag_is_set": una accion set_flag ya activo esa marca, en
    // este nivel o en la partida.
    events.RegisterCondition("flag_is_set", [&flags, &gameFlags](const nlohmann::json &params) -> bool
                             {
        const std::string flag = StringParam(params, "flag");
        return flags.count(flag) > 0 || gameFlags.count(flag) > 0; });

    // Condicion "flag_is_not_set": la contraria. Una sala ya resuelta no vuelve
    // a cerrar sus puertas al entrar.
    events.RegisterCondition("flag_is_not_set", [&flags, &gameFlags](const nlohmann::json &params) -> bool
                             {
        const std::string flag = StringParam(params, "flag");
        return flags.count(flag) == 0 && gameFlags.count(flag) == 0; });

    // Accion "set_flag": activa una marca con nombre (la llave de un puzzle).
    // Con "persist" dura toda la partida; sin el, como siempre, solo el nivel.
    events.RegisterAction("set_flag", [&flags, &gameFlags](const nlohmann::json &params)
                          {
        std::string flag = StringParam(params, "flag");
        if (!flag.empty()) {
            (BoolParam(params, "persist") ? gameFlags : flags).insert(flag);
        } });

    // --- Variables de la partida y guardado -------------------------------------

    // Accion "set_variable": la variable pasa a valer ese numero.
    events.RegisterAction("set_variable", [&variables](const nlohmann::json &params)
                          {
        const std::string name = StringParam(params, "variable");
        if (!name.empty()) {
            variables[name] = NumberParam(params, "value", 0.0f);
        } });

    // Accion "add_variable": le suma (o resta, con negativo) a la variable.
    // Una que no existia arranca en 0.
    events.RegisterAction("add_variable", [&variables](const nlohmann::json &params)
                          {
        const std::string name = StringParam(params, "variable");
        if (!name.empty()) {
            variables[name] += NumberParam(params, "amount", 1.0f);
        } });

    // Condicion "variable_compare": compara la variable con un numero. Una
    // variable que nunca se fijo vale 0.
    events.RegisterCondition("variable_compare", [&variables](const nlohmann::json &params) -> bool
                             {
        const auto it = variables.find(StringParam(params, "variable"));
        const float current = it == variables.end() ? 0.0f : it->second;
        return Compare(current, StringParam(params, "comparison"), NumberParam(params, "value", 0.0f)); });

    // Accion "save_game": guarda la partida donde esta el jugador, como un punto de control.
    events.RegisterAction("save_game", [&ctx](const nlohmann::json &)
                          {
        if (ctx.saveGame) {
            ctx.saveGame();
        } });

    // Accion "destroy_entity": borrado suave. No se saca del vector porque eso
    // invalidaria los punteros de entityById; se marca la entidad y el resto
    // del bucle la saltea al dibujar y al colisionar.
    events.RegisterAction("destroy_entity", [&entityById](const nlohmann::json &params)
                          {
        auto it = entityById.find(StringParam(params, "entity"));
        if (it != entityById.end() && !it->second->destroyed) {
            it->second->destroyed = true;
            std::cout << "Accion destroy_entity ejecutada sobre '" << it->first << "'" << std::endl;
        } });

    // Accion "play_sound": ResourceManager cachea por ruta, asi que dispararla
    // varias veces no vuelve a leer el .wav del disco. "volume" (0-100) baja
    // ese uso del sonido sin tocar el archivo.
    events.RegisterAction("play_sound", [&resources, &assets, &audio](const nlohmann::json &params)
                          {
        const Sound& sound = resources.GetSound(assets.Resolve(StringParam(params, "soundPath")));
        audio.PlaySoundEffect(sound, VolumeParam(params)); });

    // Accion "load_level": agenda el paso a otro nivel de la MISMA carpeta
    // levels/ que el actual. "level" es el nombre del archivo; si viene sin
    // extension se le agrega .json.
    events.RegisterAction("load_level", [&beginTransition, &currentLevelPath](const nlohmann::json &params)
                          {
        std::string file = StringParam(params, "level");
        if (file.empty()) {
            std::cerr << "load_level sin nivel de destino: se ignora." << std::endl;
            return;
        }
        std::filesystem::path target = currentLevelPath.parent_path() / file;
        if (!target.has_extension()) {
            target += ".json";
        }
        std::string title = StringParam(params, "message");
        beginTransition(target, title.empty() ? "¡Nivel superado!" : title, false); });

    // Accion "show_credits": el final del juego. Corta la partida y muestra los
    // creditos de game.json; al terminarlos se vuelve a la portada. Lo resuelve
    // GameSession, que es quien sabe de pantallas.
    events.RegisterAction("show_credits", [&ctx](const nlohmann::json &)
                          {
        if (ctx.showCredits) {
            ctx.showCredits();
        } });

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

    // --- Tiempo, teclas, dialogos, musica y camara ------------------------------

    // Trigger "on_level_start": se cumple siempre, asi que dispara una vez, en
    // el primer cuadro del nivel (EventSystem ejecuta al PASAR a cumplirse).
    // Vuelve a disparar si el nivel empieza de nuevo: al perder, al recargarlo
    // o al continuar la partida.
    events.RegisterTrigger("on_level_start", [](const nlohmann::json &) -> bool
                           { return true; });

    // Trigger "on_timer": a los "seconds" segundos de juego en el nivel. Con
    // "repeat", cada "seconds" segundos: dispara solo en el cuadro en que el
    // reloj cruza un multiplo, y en el siguiente ya no se cumple, asi que
    // EventSystem lo ve empezar de nuevo cada vez.
    events.RegisterTrigger("on_timer", [&ctx](const nlohmann::json &params) -> bool
                           {
        if (!ctx.levelTime || !ctx.frameTime) {
            return false;
        }
        const float seconds = NumberParam(params, "seconds", 5.0f);
        if (!(seconds > 0.0f)) {
            return false;
        }
        const float now = *ctx.levelTime;
        if (!BoolParam(params, "repeat")) {
            return now >= seconds;
        }
        // Un periodo mas corto que un cuadro se toma como un cuadro: no puede
        // disparar dos veces en el mismo.
        const float period = std::max(seconds, 0.05f);
        const float before = now - *ctx.frameTime;
        return now >= period && std::floor(now / period) > std::floor(before / period); });

    // Trigger "on_key_pressed": la tecla esta apretada. Dispara al apretarla
    // (EventSystem ejecuta cuando PASA a cumplirse) y, para volver a disparar,
    // hay que soltarla.
    events.RegisterTrigger("on_key_pressed", [](const nlohmann::json &params) -> bool
                           {
        const int key = KeyFromName(StringParam(params, "key"));
        return key != KEY_NULL && IsKeyDown(key); });

    // Trigger "on_interact": el jugador aprieta E junto a la entidad. Es el
    // "hablar con un NPC": con "Mostrar dialogo" arma una conversacion.
    events.RegisterTrigger("on_interact", [&ctx, &player, &entityById](const nlohmann::json &params) -> bool
                           {
        if (!ctx.interactPressed || !*ctx.interactPressed || !player || !Combat::IsActive(*player)) {
            return false;
        }
        const auto it = entityById.find(StringParam(params, "entity"));
        return it != entityById.end() && InInteractReach(*player, *it->second); });

    // Accion "show_dialog": un cuadro de dialogo abajo, con quien habla. El
    // juego espera a que se lea (E, Enter, Espacio o clic); varios seguidos en
    // un mismo evento se muestran de a uno, en orden.
    events.RegisterAction("show_dialog", [&ctx](const nlohmann::json &params)
                          {
        const std::string text = StringParam(params, "text");
        if (ctx.showDialog && !text.empty()) {
            ctx.showDialog(StringParam(params, "speaker"), text);
        } });

    // Accion "wait": la espera la hace EventSystem (ver kWaitAction): corta las
    // acciones del evento ahi, y las que siguen corren solas despues de
    // "seconds". Se registra para que el catalogo y el motor declaren los
    // mismos bloques; esta funcion no se llega a llamar.
    events.RegisterAction("wait", [](const nlohmann::json &) {});

    // Acciones "play_music" y "stop_music": cambia la musica que suena (la del
    // nivel, si tenia). Una pista que ya esta sonando no vuelve a empezar (solo
    // toma el volumen nuevo). "volume" (0-100) baja esa musica.
    events.RegisterAction("play_music", [&ctx](const nlohmann::json &params)
                          {
        if (ctx.playMusic) {
            ctx.playMusic(StringParam(params, "music"), VolumeParam(params));
        } });
    events.RegisterAction("stop_music", [&ctx](const nlohmann::json &)
                          {
        if (ctx.playMusic) {
            ctx.playMusic("", 1.0f);
        } });

    // Accion "shake_camera": la imagen tiembla y se calma (ver CameraSystem::Shake).
    events.RegisterAction("shake_camera", [&ctx](const nlohmann::json &params)
                          {
        if (ctx.shakeCamera) {
            ctx.shakeCamera(NumberParam(params, "intensity", 8.0f), NumberParam(params, "seconds", 0.4f));
        } });

    // Accion "move_entity": lleva la entidad a esa casilla, de una. Si ahi no
    // puede estar (una pared, otra cosa solida), no se mueve: dejar al jugador
    // adentro de una pared lo trabaria.
    events.RegisterAction("move_entity", [&level, &entityById](const nlohmann::json &params)
                          {
        const auto it = entityById.find(StringParam(params, "entity"));
        if (it == entityById.end() || it->second->destroyed) {
            return;
        }
        LevelEntity &entity = *it->second;
        const Vector2 target{std::round(NumberParam(params, "col", entity.precisePosition.x)),
                             std::round(NumberParam(params, "row", entity.precisePosition.y))};
        if (!Movement::CanOccupy(level, entity, target)) {
            std::cerr << "move_entity: '" << entity.id << "' no puede estar en (" << target.x << ", " << target.y
                      << "); no se mueve." << std::endl;
            return;
        }
        entity.precisePosition = target;
        entity.position = GridCoord{static_cast<int>(target.x), static_cast<int>(target.y)}; });

    // Accion "spawn_entity": una copia de otra entidad del nivel (la
    // "plantilla", que puede estar oculta) en esa casilla. Sirve para que
    // aparezcan enemigos, objetos o NPCs. La crea GameSession, que es quien
    // lleva los indices de entidades.
    events.RegisterAction("spawn_entity", [&ctx](const nlohmann::json &params)
                          {
        if (ctx.spawnEntity) {
            ctx.spawnEntity(StringParam(params, "template"),
                            Vector2{std::round(NumberParam(params, "col", 0.0f)), std::round(NumberParam(params, "row", 0.0f))});
        } });

    // Recompensas que no se repiten al continuar una partida (ver
    // EventSystem::SetNonRepeatable). Los triggers son los que, en una misma
    // partida, solo pueden cumplirse una vez: lo vencido sigue vencido y lo
    // juntado sigue juntado. Solo vuelven a cumplirse porque al continuar los
    // enemigos reaparecen. Las acciones son las que dan algo que se guarda con
    // la partida: repetirlas duplicaria objetos, monedas o contadores.
    // "Al empezar el nivel" y "Al pasar un tiempo" (sin repetir) entran aca por
    // lo mismo: al continuar, el nivel vuelve a empezar y el reloj a cero.
    events.SetNonRepeatable(
        {"on_entity_destroyed", "on_all_enemies_defeated", "on_boss_defeated", "on_zone_cleared",
         "on_items_collected", "on_level_start", "on_timer"},
        {"give_item", "add_coins", "add_variable"});
}

}  // namespace EventBindings
