#pragma once

#include <cstddef>
#include <deque>
#include <filesystem>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "raylib.h"

#include "core/GraphicsDevice.hpp"
#include "core/ResourceManager.hpp"
#include "game/Combat.hpp"
#include "game/DevTools.hpp"
#include "game/EventBindings.hpp"
#include "game/GameConfig.hpp"
#include "game/HealthHud.hpp"
#include "game/Inventory.hpp"
#include "game/Screens.hpp"
#include "game/Loot.hpp"
#include "game/Mobility.hpp"
#include "game/Progress.hpp"
#include "loader/AssetResolver.hpp"
#include "loader/LevelLoader.hpp"
#include "systems/animation/AnimationSystem.hpp"
#include "systems/audio/AudioSystem.hpp"
#include "systems/camera/CameraSystem.hpp"
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
    // Por donde arranca:
    //   Level     directo en el nivel que se abrio (Ejecutar del editor, F5)
    //   Title     en la portada (Ejecutar desde la portada, o el juego exportado)
    //   Continue  retomando la partida guardada, o en el nivel si no hay
    enum class StartMode { Level, Title, Continue };

    // "savesRoot": donde va la carpeta saves/. Vacio = la raiz del proyecto
    // (<nivel>/../..), que es lo de siempre; un juego exportado pasa la carpeta
    // del usuario (ver game/ExportedGame.hpp).
    GameSession(const std::filesystem::path &levelPath, const GameConfig &gameConfig, StartMode start,
                const std::filesystem::path &savesRoot = {});

    GameSession(const GameSession &) = delete;
    GameSession &operator=(const GameSession &) = delete;

    // El bucle principal, hasta que se cierre la ventana o se elija Salir.
    void Run();

    // Para capturas y pruebas ("--pantalla"): abre directo "titulo",
    // "creditos", "pausa" o "fin".
    void ShowScreenForTest(const std::string &name);

    // Medicion ("engine <nivel> --bench <segundos>"): corre el nivel sin tope
    // de FPS durante ese tiempo, imprime cuantos cuadros por segundo dio y
    // termina. Existe en las dos compilaciones, para poder comparar Debug con
    // Release con el mismo nivel; la Release no tiene el panel F3.
    // Con "screenshot" (--captura), al terminar guarda tambien lo que dibujo
    // el ultimo cuadro: sirve para comprobar un nivel sin mirar la pantalla.
    void Benchmark(float seconds, const std::string &screenshot = "");

    // Con false se dibuja todo el nivel, se vea o no ("--sin-recorte"): sirve
    // para medir cuanto ahorra el recorte por camara. Por defecto, encendido.
    void SetCulling(bool enabled) { culling = enabled; }

private:
    // La sonda de rendimiento (engine/perf, solo con HONEYCOMB_BUILD_PERF)
    // maneja el mismo bucle que Run() para medir cada cuadro, la carga y la
    // memoria. Es la unica puerta: no cambia nada de lo que hace la partida.
    friend class SondaRendimiento;

    void BindInput();
    void RegisterEvents();

    // Rearma todo lo que depende del nivel cargado. Se llama al arrancar y
    // cada vez que se pasa de nivel.
    void PrepareLevel(LevelStart start);

    // Descarga las texturas que ya nadie usa (las del nivel anterior). La
    // llama PrepareLevel al final; la lista de lo que se conserva esta en el .cpp.
    void ReleaseUnusedTextures();

    // Agenda el paso a otro nivel. No carga nada: primero corre la pantalla de
    // transicion, y la carga pasa al final del frame (ver Update).
    void BeginTransition(const std::filesystem::path &target, const std::string &title, bool restart);

    void ShowMessage(const std::string &text, float seconds);

    // La musica que suena: la del nivel al empezarlo, la de la portada, o la
    // que pida un evento ("Cambiar la musica"). Vacio = silencio. Una pista que
    // ya esta sonando sigue, sin volver a empezar (pasar a un nivel con la
    // misma musica no la corta).
    void PlayTrack(const std::string &relativePath);

    // "Crear entidad": una copia de "templateId" en "cell", con un id nuevo.
    // false si no hay plantilla, no se puede estar ahi o ya se crearon
    // demasiadas (ver kSpawnReserve).
    bool SpawnEntity(const std::string &templateId, Vector2 cell);

    // El cuadro de dialogo de "Mostrar dialogo", si hay alguno esperando.
    void DrawDialog();

    // Calcula lo que la camara necesita saber del nivel cargado: el centro del
    // encuadre fijo y el rectangulo del mundo que ocupa el mapa.
    void FrameCamera();

    // Lo que sigue la camara: los pies del jugador, o el centro del encuadre
    // fijo si el nivel no tiene jugador.
    Vector2 CameraFocus() const;

    Vector2 ScreenSize() const;
    // La imagen de fondo del nivel, en pantalla y antes que el mundo. Ver el .cpp.
    void DrawBackgroundImage();

    // Un frame entero. El orden de sus pasos es semantico: ver el comentario
    // que lo encabeza en GameSession.cpp.
    void Update(float deltaTime);

    // --- La partida: pantallas y progreso (ver game/Screens y game/Progress) --
    // Un cuadro de la pantalla que este al frente: portada, creditos o juego.
    void Frame(float deltaTime);
    void UpdateTitle();
    void UpdateCredits(float deltaTime);
    // Cierra el cuadro: la captura pedida por Benchmark, si hay, y EndFrame.
    void FinishFrame();
    void GoToTitle();
    void NewGame();
    // false si no hay partida guardada o no se pudo cargar su nivel.
    bool ContinueGame();
    void SaveGame();
    // Si el jugador esta parado en un punto de control nuevo, guarda.
    void CheckCheckpoints();
    // El punto de control al alcance del jugador, o "" si no hay ninguno.
    std::string CheckpointInReach() const;
    // Lo que el menu de pausa o de fin de partida pidio, para hacerlo despues
    // de terminar el cuadro (cargar un nivel en medio del dibujo no conviene).
    void RunMenuAction(const std::string &action);
    // Las armas de todos los niveles del proyecto: para restaurar al continuar
    // una que se trajo de otro nivel y este no tiene en su catalogo.
    ItemCatalog ProjectItems();
    std::filesystem::path LevelsDir() const;
    // Una textura de game.json (ruta relativa a assets/), o nullptr si no hay.
    const Texture2D *StyleTexture(const std::string &relativePath);

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

    // --- La configuracion del juego (game.json) ------------------------------
    // Antes que la ventana: de aca salen su tamaño y su titulo. El titulo se
    // guarda en un miembro porque raylib se queda con el puntero.
    GameConfig config;
    std::filesystem::path projectRoot;
    // Donde se leen y escriben las partidas (<saveRoot>/saves/). Va despues
    // de projectRoot: se construyen en orden de declaracion.
    std::filesystem::path saveRoot;
    std::string windowTitle;

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

    // --- Lo que agregan los eventos de tiempo, dialogo y musica --------------
    // Segundos de juego en el nivel (sin pausas ni pantallas encima) y los del
    // ultimo cuadro: el reloj de "Al pasar un tiempo". Vuelve a 0 en PrepareLevel.
    float levelTime = 0.0f;
    float lastFrameTime = 0.0f;
    // E se apreto en este cuadro y no la uso una tienda: "Al hablar con".
    bool interactForEvents = false;
    // Los dialogos de "Mostrar dialogo" que faltan leer, en orden. Mientras
    // haya alguno, el juego espera (como con la tienda abierta).
    struct DialogLine
    {
        std::string speaker;
        std::string text;
    };
    std::deque<DialogLine> dialogs;
    // Las entidades a las que un evento "Al hablar con" escucha: junto a ellas
    // se muestra "E: hablar". Sale de los eventos del nivel, en PrepareLevel.
    std::unordered_set<std::string> talkableIds;
    // La pista que suena ahora (ruta relativa a assets/), o vacio.
    std::string currentTrack;
    // Las entidades se guardan en un vector y los eventos, el combate y la
    // camara les guardan punteros: crear una no puede hacer que el vector se
    // mude de lugar. Por eso se reserva lugar para estas de mas al cargar el
    // nivel, y no se crean mas que esas.
    static constexpr std::size_t kSpawnReserve = 256;
    std::size_t spawnedCount = 0;

    // Se llena en cada frame con lo que devuelve CollisionSystem::Flush(); el
    // trigger on_collision consulta esta lista.
    std::vector<CollisionPair> currentCollisions;
    EventBindings::Context eventContext;

    ZSortSystem zsort;
    CollisionSystem collision;

    // La camara, y lo que necesita saber del nivel para encuadrarlo. Los dos
    // datos dependen solo del nivel, asi que se calculan al cargarlo
    // (FrameCamera) y no en cada frame.
    CameraSystem camera;
    Vector2 cameraFixedCenter{0, 0};
    Rectangle cameraBounds{0, 0, 0, 0};
    Font defaultFont;
    // F1 y F2: solo en Debug, como el resto de las herramientas (ver DevTools).
    bool showGrid = false;
    bool showHitboxes = false;  // F2, independiente de F1: se pueden ver los dos
    DevTools::State dev;
    bool culling = true;
    // Archivo donde guardar el cuadro que se esta dibujando (ver Benchmark).
    // Vacio = ninguno.
    std::string pendingScreenshot;

    // Una baldosa de piso lista para encolar: su textura (la del nivel o la de
    // su sala, tunel o casilla), su recorte y donde va, al ancho de la casilla.
    struct FloorSprite
    {
        const Texture2D *texture;
        Rectangle source;
        Vector2 topLeft;
        Vector2 center;
        Vector2 size;
    };
    // Las baldosas de piso, ya ordenadas de atras hacia adelante. El piso no se
    // mueve: se calcula y se ordena una vez al cargar el nivel (PrepareLevel) y
    // no en cada frame (ver ZSortSystem).
    std::vector<FloorSprite> floorDrawOrder;

    std::vector<HealthBarMark> healthBars;

    // --- La partida: pantallas, progreso y estilo ----------------------------
    enum class Screen { Title, Credits, Playing };
    Screen screen = Screen::Playing;
    bool paused = false;
    bool gameOver = false;
    bool quitRequested = false;
    Screens::Menu titleMenu;
    Screens::Menu pauseMenu;
    Screens::Menu gameOverMenu;
    float creditsElapsed = 0.0f;
    // Lo que eligio un menu de pausa o de fin, para hacerlo al terminar el cuadro.
    std::string pendingMenuAction;
    // El nivel con que se abrio el motor: el de "Nueva partida" si game.json no
    // dice otro.
    std::filesystem::path initialLevelPath;
    // Marcas y variables que duran la partida (las del nivel son "flags").
    std::unordered_set<std::string> gameFlags;
    std::unordered_map<std::string, float> variables;
    // El ultimo punto de control que guardo: no se vuelve a guardar en el mismo
    // mientras el jugador siga parado ahi.
    std::string lastCheckpointId;
    // Que partida se lee y se escribe (ver Progress.hpp): la de prueba cuando
    // se abrio directo en un nivel (Ejecutar desde el editor), la del juego
    // desde la portada. Volver a la portada pasa a la del juego.
    std::string saveSlot = Progress::kGameSlot;
    // Imagenes del estilo de game.json, ya cargadas.
    const Texture2D *titleBackground = nullptr;
    HealthHud::Images hudImages;
    // Armas de todo el proyecto, armado la primera vez que hace falta.
    bool projectItemsLoaded = false;
    ItemCatalog projectItems;
};
