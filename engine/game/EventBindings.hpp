#pragma once

#include <filesystem>
#include <functional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "core/ResourceManager.hpp"
#include "game/Inventory.hpp"
#include "game/Loot.hpp"
#include "loader/AssetResolver.hpp"
#include "systems/audio/AudioSystem.hpp"
#include "systems/collision/CollisionSystem.hpp"
#include "systems/event_system/EventSystem.hpp"
#include "world/Level.hpp"

// QUE SIGNIFICA cada bloque del catalogo de eventos.
//
// Cada "type" de schema/event_catalog.json necesita su implementacion en C++
// registrada UNA sola vez. El nivel dice "que" pasa; esto define "como". Sumar
// un bloque nuevo al catalogo del editor = sumar un Register aca; no hay que
// recompilar por cada nivel nuevo.
//
// Antes esto vivia dentro de main(), como 24 lambdas que capturaban por
// referencia las variables locales del bucle. Estan aca para que el punto de
// entrada se ocupe de armar el juego y no de las reglas del catalogo, pero el
// mecanismo no cambio: Context reune EXACTAMENTE lo que aquellas lambdas
// capturaban, y lo hace con punteros a las variables de main(), no con copias.
namespace EventBindings {

// Cuanto se ve un mensaje de "Mostrar mensaje", y uno de lo que se junto.
// kPickupMessageSeconds lo usa tambien el bucle principal, al juntar objetos.
constexpr float kMessageSeconds = 3.0f;
constexpr float kPickupMessageSeconds = 1.5f;

// Lo que las acciones y condiciones necesitan tocar del juego en curso.
//
// Son PUNTEROS a las variables de main() y no copias, por dos razones:
//   - el estado cambia cada frame (el inventario, los objetos en el piso);
//   - al pasar de nivel, main() reasigna "level" y "player", y los eventos
//     tienen que ver el nivel nuevo, no quedarse con el anterior. Por eso
//     player es LevelEntity** y no LevelEntity*: lo que cambia es el puntero.
//
// OJO con el tiempo de vida: RegisterAll deja funciones que guardan referencias
// a este Context y a lo que apunta. El Context tiene que vivir tanto como el
// EventSystem (en main() es una variable local del mismo alcance), y no puede
// ser un temporal.
struct Context {
    LoadedLevel* level = nullptr;
    LevelEntity** player = nullptr;
    std::unordered_map<std::string, LevelEntity*>* entityById = nullptr;
    // Marcas del puzzle ("tiene_llave"): las activa set_flag, las lee flag_is_set.
    std::unordered_set<std::string>* flags = nullptr;
    // La llena cada frame CollisionSystem::Flush(); la lee on_collision.
    std::vector<CollisionPair>* collisions = nullptr;
    Inventory* inventory = nullptr;
    Loot::State* loot = nullptr;
    // Armas cuya habilidad se lanzo en este frame, para "Al usar una habilidad".
    std::vector<std::string>* abilitiesUsed = nullptr;
    ResourceManager* resources = nullptr;
    AssetResolver* assets = nullptr;
    AudioSystem* audio = nullptr;
    // El nivel EN CURSO: load_level resuelve su destino relativo a esta carpeta.
    std::filesystem::path* currentLevelPath = nullptr;

    // Las dos cosas que los eventos piden pero no resuelven: agendar el paso a
    // otro nivel y mostrar un mensaje en pantalla. Las implementa main(), que
    // es quien lleva la pantalla de transicion y el temporizador del mensaje.
    std::function<void(const std::filesystem::path& target, const std::string& title, bool restart)>
        beginTransition;
    std::function<void(const std::string& text, float seconds)> showMessage;
};

// Registra los triggers, condiciones y acciones del catalogo en "events".
// Se llama UNA vez, antes del bucle principal: los registros no dependen del
// nivel cargado, solo del Context, que sigue apuntando a lo correcto al
// cambiar de nivel.
void RegisterAll(EventSystem& events, Context& ctx);

}  // namespace EventBindings
