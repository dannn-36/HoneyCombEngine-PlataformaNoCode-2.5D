#pragma once

#include <filesystem>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "raylib.h"

#include "core/GraphicsDevice.hpp"
#include "core/ResourceManager.hpp"
#include "game/Combat.hpp"
#include "game/EventBindings.hpp"
#include "game/Inventory.hpp"
#include "game/Loot.hpp"
#include "game/Mobility.hpp"
#include "loader/AssetResolver.hpp"
#include "loader/LevelLoader.hpp"
#include "systems/animation/AnimationSystem.hpp"
#include "systems/audio/AudioSystem.hpp"
#include "systems/collision/CollisionSystem.hpp"
#include "systems/event_system/EventSystem.hpp"
#include "systems/input/InputSystem.hpp"
#include "systems/z_sort/ZSortSystem.hpp"
#include "world/Level.hpp"

// Como se llego a un nivel. Decide que pasa con el inventario del jugador.
enum class LevelStart
{
    Fresh,    // el primer nivel: el inventario que declara el jugador
    Carry,    // se paso de nivel: se conservan armas y monedas
    Restart,  // se perdio: vuelve a como estaba al entrar a este nivel
};

// UNA PARTIDA EN CURSO: las capas del motor ya armadas, el nivel cargado y
// todo el estado que el bucle principal lleva de un frame al siguiente.
//
// Antes esto era el cuerpo de main(): unas setenta variables locales y el
// bucle entero en la misma funcion. No es que estuviera mal repartido -- es
// que no habia reparto: no existia ningun tipo que representara "la partida",
// asi que no se podia nombrar, ni inspeccionar, ni construir sin abrir una
// ventana. Ahora main() resuelve rutas, construye una GameSession y la corre.
//
// El ORDEN DE LOS MIEMBROS es significativo y no se toca:
//   - se construyen en orden de declaracion, y GraphicsDevice tiene que abrir
//     la ventana (y con ella el contexto de OpenGL) antes de que
//     ResourceManager pueda subir una textura a la GPU;
//   - se destruyen en orden INVERSO, asi que gfx, declarado primero, se libera
//     el ultimo, cuando ya no queda nada que dependa de la ventana.
// Es el mismo orden que tenian como variables locales de main(), y por eso el
// apagado se comporta igual que antes.
//
// No es copiable ni movible a proposito: eventContext guarda punteros a estos
// mismos miembros, y moverla los dejaria colgando.
class GameSession
{
public:
    explicit GameSession(const std::filesystem::path &levelPath);

    GameSession(const GameSession &) = delete;
    GameSession &operator=(const GameSession &) = delete;

    // El bucle principal, hasta que se cierre la ventana.
    void Run();

private:
    void BindInput();
    void RegisterEvents();

    // Rearma todo lo que depende del nivel cargado. Se llama al arrancar y
    // cada vez que se pasa de nivel.
    void PrepareLevel(LevelStart start);

    // Agenda el paso a otro nivel. No carga nada: primero corre la pantalla de
    // transicion, y la carga pasa al final del frame (ver Update).
    void BeginTransition(const std::filesystem::path &target, const std::string &title, bool restart);

    void ShowMessage(const std::string &text, float seconds);

    // Un frame entero. El orden de sus pasos es semantico: ver el comentario
    // que lo encabeza en GameSession.cpp.
    void Update(float deltaTime);

    // Pasar de nivel no es instantaneo: primero se muestra la pantalla con el
    // mensaje ("¡Nivel superado!"), con el juego congelado, y recien al
    // terminar se carga el nivel siguiente. La carga pasa FUERA de
    // events.Update(): reemplaza los eventos del nivel, y hacerlo mientras se
    // recorren seria pisar la lista que se esta leyendo.
    struct Transition
    {
        bool active = false;
        std::filesystem::path target;
        std::string title;
        std::string detail;
        float remaining = 0.0f;
        // true = se perdio y se vuelve a empezar: el inventario no se conserva.
        bool restart = false;
    };

    // Barra de vida a dibujar encima de la escena. Se juntan mientras se
    // encolan las entidades (ahi se sabe donde queda cada sprite en pantalla).
    struct HealthBarMark
    {
        Vector2 topCenter;
        float ratio;
        bool isPlayer;
    };

    // --- Capa 1 + Capa 3: ventana, recursos y carga del nivel ---------------
    GraphicsDevice gfx;
    ResourceManager resources;
    AssetResolver assets;
    EventSystem events;
    LevelLoader loader;
    LoadedLevel level;
    // El nivel EN CURSO: cambia al pasar de nivel, y es la base contra la que
    // se resuelve el archivo del nivel siguiente.
    std::filesystem::path currentLevelPath;

    // --- Estado que depende del nivel cargado -------------------------------
    // Todo esto se vuelve a armar en PrepareLevel. Los eventos registrados
    // guardan punteros a estos miembros, asi que al pasar de nivel se rellenan
    // en su lugar y las mismas funciones siguen apuntando bien.
    //
    // entityById: indice por id para los eventos (entity_ref) y el jugador.
    // Los punteros son estables mientras el vector de entidades no cambie.
    std::unordered_map<std::string, LevelEntity *> entityById;
    AnimationSystem animations;
    std::unordered_map<std::string, AnimationInstance> animInstances;
    // Marcas del puzzle ("tiene_llave"): las activa set_flag, las consulta
    // flag_is_set. Son del nivel: se borran al cambiar de nivel.
    std::unordered_set<std::string> flags;
    // El jugador es, por convencion, la entidad con id "player_1". Si el nivel
    // no define ninguna, el nivel igual corre: solo que no hay nada que mover.
    LevelEntity *player = nullptr;

    // Combate, objetos y movilidad (ver game/). El inventario es lo unico que
    // NO es del nivel: viaja con el jugador de un nivel al siguiente.
    Combat::State combatState;
    Inventory inventory;
    Inventory inventoryAtLevelStart;
    Loot::State loot;
    Mobility::State mobility;
    // El NPC cuya tienda esta abierta. Mientras no es nullptr el juego se pausa.
    LevelEntity *shopNpc = nullptr;
    std::string shopFeedback;
    // Armas cuya habilidad se lanzo en este frame, para "Al usar una habilidad".
    std::vector<std::string> abilitiesUsedThisFrame;

    AudioSystem audio;
    InputSystem input;

    Transition transition;

    std::string notice;
    float noticeRemaining = 0.0f;
    // Mensaje en el centro: "Mostrar mensaje" y lo que se junta. Aviso: texto
    // al pie del inventario mientras dura una situacion (parado sobre un arma
    // con el inventario lleno, junto a una tienda); se recalcula cada frame.
    std::string message;
    float messageRemaining = 0.0f;
    std::string prompt;

    // Se llena en cada frame con lo que devuelve CollisionSystem::Flush(); el
    // trigger on_collision consulta esta lista.
    std::vector<CollisionPair> currentCollisions;
    EventBindings::Context eventContext;

    ZSortSystem zsort;
    CollisionSystem collision;
    Font defaultFont;
    bool showGrid = false;
    bool showHitboxes = false;  // F2, independiente de F1: se pueden ver los dos

    std::vector<HealthBarMark> healthBars;
};
