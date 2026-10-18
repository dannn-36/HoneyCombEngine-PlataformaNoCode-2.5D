// =============================================================================
// HoneyComb Engine - Runtime (la partida en curso)
// =============================================================================
//
// El cuerpo de lo que antes era main(): armar las capas, cargar el nivel y
// correr el bucle. Ver la cabecera de GameSession.hpp para por que existe este
// tipo y por que el orden de sus miembros no se toca.
// =============================================================================

#include "GameSession.hpp"

#include <algorithm>
#include <cmath>
#include <exception>
#include <fstream>
#include <iostream>

#include "nlohmann/json.hpp"
#include "rlgl.h"

#include "game/Progress.hpp"
#include "loader/ItemLoader.hpp"

#include "game/CombatView.hpp"
#include "game/Movement.hpp"
#include "game/Zones.hpp"

namespace {

// Cuanto dura la pantalla entre un nivel y el siguiente. Lo justo para leer el
// mensaje; mas largo se siente como una carga lenta.
constexpr float kTransitionSeconds = 2.0f;
// Cuanto se ve un aviso de error (por ejemplo, un nivel siguiente que no existe).
constexpr float kNoticeSeconds = 4.0f;

// El rectangulo agrandado "margin" por cada lado (achicado, si es negativo).
Rectangle Grow(Rectangle rect, float margin) {
    return Rectangle{rect.x - margin, rect.y - margin, rect.width + 2.0f * margin, rect.height + 2.0f * margin};
}

// Dibuja un texto centrado en X. raylib no centra solo: hay que medirlo.
void DrawCentered(GraphicsDevice& gfx, const Font& font, const std::string& text, float centerX,
                  float y, float size, Color color) {
    const Vector2 measured = MeasureTextEx(font, text.c_str(), size, size / 10.0f);
    gfx.DrawText(font, text.c_str(), Vector2{centerX - measured.x / 2.0f, y}, size, color);
}

// Barra de vida: fondo oscuro y relleno proporcional a la vida que queda.
void DrawHealthBar(float x, float y, float width, float height, float ratio, Color fill) {
    DrawRectangle(static_cast<int>(x), static_cast<int>(y), static_cast<int>(width),
                  static_cast<int>(height), Color{30, 30, 30, 200});
    DrawRectangle(static_cast<int>(x), static_cast<int>(y),
                  static_cast<int>(width * std::clamp(ratio, 0.0f, 1.0f)), static_cast<int>(height),
                  fill);
}

}  // namespace

// El orden de la lista de inicializacion sigue al de declaracion en el header,
// que es el que importa: la ventana antes que los recursos, y el loader antes
// que el nivel que carga.
GameSession::GameSession(const std::filesystem::path &levelPath, const GameConfig &gameConfig, StartMode start)
    : config(gameConfig),
      // La raiz del proyecto: levels/ esta adentro, y ahi viven game.json,
      // assets/ y saves/.
      projectRoot(levelPath.parent_path().parent_path()),
      // El titulo dice cual es: el nombre del juego, y si es la de desarrollo.
      windowTitle(WindowTitle(gameConfig, DevTools::kEnabled)),
      gfx(gameConfig.width, gameConfig.height, windowTitle.c_str()),
      assets((levelPath.parent_path().parent_path() / "assets").string()),
      loader(resources, assets),
      // Load() concentra todo el trabajo de Capa 3: parsea el JSON, construye
      // la grilla con las medidas del nivel, resuelve y carga las texturas, y
      // deja los eventos del nivel ya cargados dentro de "events".
      level(loader.Load(levelPath.string(), events)),
      currentLevelPath(levelPath),
      zsort(gfx),
      initialLevelPath(levelPath)
{
    // Esc es la pausa: sin esto, raylib cierra la ventana con Esc.
    SetExitKey(KEY_NULL);
    if (!config.icon.empty())
    {
        Image icon = LoadImage(assets.Resolve(config.icon).c_str());
        if (icon.data)
        {
            SetWindowIcon(icon);
            UnloadImage(icon);
        }
    }
    // Pantalla completa "sin bordes": ocupa el monitor a su resolucion, sin
    // cambiar el modo de video (F11 hace lo mismo).
    if (config.fullscreen)
    {
        ToggleBorderlessWindowed();
    }

    // Las imagenes del estilo, ya con la ventana abierta (la GPU existe).
    titleBackground = StyleTexture(config.titleScreen.backgroundImage);
    if (titleBackground && config.titleScreen.backgroundFit == BackgroundFit::Tile)
    {
        SetTextureWrap(*titleBackground, TEXTURE_WRAP_REPEAT);
    }
    hudImages.heartFull = StyleTexture(config.hud.heartFull);
    hudImages.heartEmpty = StyleTexture(config.hud.heartEmpty);
    hudImages.barFill = StyleTexture(config.hud.barFill);
    hudImages.barFrame = StyleTexture(config.hud.barFrame);

    variables = config.variables;
    PrepareLevel(LevelStart::Fresh);
    BindInput();
    RegisterEvents();
    defaultFont = GetFontDefault();
    gfx.SetTargetFPS(60);

    // Directo en el nivel es probarlo desde el editor: sus puntos de control
    // guardan en la partida de prueba y no pisan la del juego.
    saveSlot = start == StartMode::Level ? Progress::kTestSlot : Progress::kGameSlot;
    if (start == StartMode::Title)
    {
        GoToTitle();
    }
    else if (start == StartMode::Continue)
    {
        ContinueGame();
    }
}

const Texture2D *GameSession::StyleTexture(const std::string &relativePath)
{
    if (relativePath.empty())
    {
        return nullptr;
    }
    const Texture2D &texture = resources.GetTexture(assets.Resolve(relativePath));
    return texture.id != 0 ? &texture : nullptr;
}

std::filesystem::path GameSession::LevelsDir() const
{
    return projectRoot / "levels";
}

// Cada accion se enlaza dos veces (flechas y WASD, Espacio y J) en vez de leer
// las teclas sueltas, para que el resto del codigo pregunte por la ACCION
// ("move_up") y no por la tecla: asi se puede reasignar sin tocar la logica.
void GameSession::BindInput()
{
    input.BindAction("move_up", KEY_UP);
    input.BindAction("move_down", KEY_DOWN);
    input.BindAction("move_left", KEY_LEFT);
    input.BindAction("move_right", KEY_RIGHT);
    input.BindAction("move_up_wasd", KEY_W);
    input.BindAction("move_down_wasd", KEY_S);
    input.BindAction("move_left_wasd", KEY_A);
    input.BindAction("move_right_wasd", KEY_D);
    input.BindAction("attack", KEY_SPACE);
    input.BindAction("attack_alt", KEY_J);
    input.BindAction("ability", KEY_Q);
    input.BindAction("dash", KEY_LEFT_SHIFT);
    input.BindAction("defend", KEY_K);
    input.BindAction("interact", KEY_E);
}

// Cada "type" del catalogo se implementa en game/EventBindings.cpp. Aca solo se
// arma el Context con punteros a los miembros de esta sesion: al pasar de nivel
// se reasignan "level" y "player", y los eventos tienen que ver los nuevos.
void GameSession::RegisterEvents()
{
    eventContext.level = &level;
    eventContext.player = &player;
    eventContext.entityById = &entityById;
    eventContext.flags = &flags;
    eventContext.gameFlags = &gameFlags;
    eventContext.variables = &variables;
    eventContext.saveGame = [this]()
    { SaveGame(); };
    eventContext.collisions = &currentCollisions;
    eventContext.inventory = &inventory;
    eventContext.loot = &loot;
    eventContext.abilitiesUsed = &abilitiesUsedThisFrame;
    eventContext.resources = &resources;
    eventContext.assets = &assets;
    eventContext.audio = &audio;
    eventContext.currentLevelPath = &currentLevelPath;
    // Las dos cosas que los eventos piden y resuelve main(): la pantalla de
    // paso de nivel y el mensaje en pantalla con su temporizador.
    eventContext.beginTransition = [this](const std::filesystem::path &target,
                                      const std::string &title, bool restart)
    { BeginTransition(target, title, restart); };
    eventContext.showMessage = [this](const std::string &text, float seconds)
    { ShowMessage(text, seconds); };
    EventBindings::RegisterAll(events, eventContext);
}

void GameSession::PrepareLevel(LevelStart start)
{
    entityById.clear();
    animInstances.clear();
    // Las marcas del nivel se borran; las de la partida (gameFlags) siguen.
    flags.clear();
    lastCheckpointId.clear();
    for (auto &entity : level.entities)
    {
        entityById[entity.id] = &entity;
    }

    // El piso, de atras hacia adelante y en coordenadas de mundo, de una vez.
    // En isometrico la Y de pantalla de una celda es (col + row) * alto / 2, asi
    // que ordenar por col + row es ordenar por profundidad. Es el mismo orden
    // en que el ZSortSystem lo ordenaba en cada frame; las baldosas de una
    // misma fila no se tocan entre si, y el empate da igual.
    //
    // Cada baldosa lleva su textura: la de su sala, tunel o casilla pintada si
    // el editor le puso una (floorTileVariants), o la del nivel. Se dibuja al
    // ANCHO de la casilla, con su proporcion, para que cualquier imagen sirva
    // de piso; una del ancho justo (la de siempre) queda igual que antes.
    // Ancha o cuadrada, va centrada en la casilla; mas alta que ancha (un
    // lienzo alto con la baldosa abajo, como las piezas de Kenney), apoyada en
    // el vertice de abajo de la casilla. El editor dibuja con la misma regla
    // (core/iso-canvas-renderer.ts).
    std::vector<size_t> floorOrder(level.floorTiles.size());
    for (size_t i = 0; i < floorOrder.size(); ++i)
    {
        floorOrder[i] = i;
    }
    std::stable_sort(floorOrder.begin(), floorOrder.end(), [&](size_t a, size_t b)
                     { return level.floorTiles[a].col + level.floorTiles[a].row <
                              level.floorTiles[b].col + level.floorTiles[b].row; });
    const float tileWidth = static_cast<float>(level.grid.GetTileWidth());
    const float tileHeight = static_cast<float>(level.grid.GetTileHeight());
    floorDrawOrder.clear();
    floorDrawOrder.reserve(floorOrder.size());
    for (const size_t index : floorOrder)
    {
        const int variant = index < level.floorTileVariants.size() ? level.floorTileVariants[index] : -1;
        const FloorLook look = variant >= 0 ? level.floorVariants[static_cast<size_t>(variant)]
                                            : FloorLook{level.floorTexture, level.floorSourceRect};
        if (!look.texture || look.source.width <= 0.0f || look.source.height <= 0.0f)
        {
            continue;
        }
        const Vector2 center = level.grid.GridToScreen(level.floorTiles[index]);
        const Vector2 size{tileWidth, look.source.height * tileWidth / look.source.width};
        const float top = size.y > size.x ? center.y + tileHeight / 2.0f - size.y : center.y - size.y / 2.0f;
        floorDrawOrder.push_back(
            FloorSprite{look.texture, look.source, Vector2{center.x - size.x / 2.0f, top}, center, size});
    }

    // AnimationSystem: un clip por entidad animada, armado desde el nivel.
    // Cada entidad declara cuantos cuadros tiene ("frames") y el clip se
    // arma desde SU recorte: los cuadros van uno al lado del otro, del
    // ancho de ese recorte. (Antes habia un unico clip escrito aca, con
    // cuadros fijos de 16x16, y ese era el tope de tamano del jugador.)
    for (auto &entity : level.entities)
    {
        if (entity.frames <= 1)
        {
            continue;
        }
        AnimationClip clip{{}, entity.frameDuration, true};
        for (int frame = 0; frame < entity.frames; ++frame)
        {
            clip.frames.push_back(Rectangle{
                entity.sourceRect.x + frame * entity.sourceRect.width,
                entity.sourceRect.y,
                entity.sourceRect.width,
                entity.sourceRect.height});
        }
        // Registrado con el id de la entidad. Registrar de nuevo el mismo
        // id (al recargar) pisa el clip en su lugar, y GetClip devuelve una
        // referencia al elemento del mapa, que sigue valida.
        animations.RegisterClip(entity.id, std::move(clip));
        AnimationInstance instance;
        instance.Play(animations.GetClip(entity.id));
        animInstances[entity.id] = instance;
    }

    player = entityById.count("player_1") ? entityById["player_1"] : nullptr;

    // Todo lo del combate apunta a entidades del nivel anterior: se vacia.
    combatState.Clear();
    loot.ClearLevel();
    mobility = Mobility::State{};
    shopNpc = nullptr;
    abilitiesUsedThisFrame.clear();
    const InventoryConfig noConfig;
    const InventoryConfig &inventoryConfig = player ? player->inventory : noConfig;
    switch (start)
    {
    case LevelStart::Fresh:
        inventory.Configure(inventoryConfig, level.items);
        break;
    case LevelStart::Carry:
        inventory.CarryInto(inventoryConfig, level.items);
        break;
    case LevelStart::Restart:
        inventory = inventoryAtLevelStart;
        break;
    }
    inventoryAtLevelStart = inventory;

    // En mosaico, la imagen de fondo se repite en la GPU (ver
    // DrawBackgroundImage): su textura tiene que estar en modo repeticion.
    if (level.backgroundTexture && level.backgroundTexture->id != 0 && level.backgroundFit == BackgroundFit::Tile)
    {
        SetTextureWrap(*level.backgroundTexture, TEXTURE_WRAP_REPEAT);
    }

    // La camara del nivel nuevo, puesta en su lugar sin transicion. Va al
    // final porque necesita saber quien es el jugador.
    camera.Configure(level.camera);
    camera.SetScreenSize(ScreenSize());
    FrameCamera();
    camera.SnapTo(CameraFocus(), cameraFixedCenter, cameraBounds);

    // Al final: el nivel nuevo ya esta armado y el inventario ya es el que va.
    ReleaseUnusedTextures();

    std::cout << "Nivel cargado: " << level.name
              << " (" << level.entities.size() << " entidades)" << std::endl;
}

void GameSession::ReleaseUnusedTextures()
{
    // Toda textura que alguien siga apuntando. Si se agrega un lugar nuevo que
    // guarde un const Texture2D*, tiene que sumarse aca: una que falte quedaria
    // colgando y el siguiente dibujo cerraria el juego.
    std::unordered_set<const Texture2D *> inUse;
    const auto keep = [&inUse](const Texture2D *texture) {
        if (texture)
        {
            inUse.insert(texture);
        }
    };
    // El nivel en curso.
    keep(level.backgroundTexture);
    keep(level.floorTexture);
    keep(level.wallTexture);
    for (const auto &look : level.floorVariants)
        keep(look.texture);
    for (const auto &entity : level.entities)
        keep(entity.texture);
    for (const auto &[id, item] : level.items)
        keep(item.texture);
    // Lo que viaja con el jugador: sus armas pueden ser de un nivel anterior.
    for (const auto &slot : inventory.Weapons())
        keep(slot.item.texture);
    for (const auto &slot : inventoryAtLevelStart.Weapons())
        keep(slot.item.texture);
    for (const auto &ground : loot.ground)
        keep(ground.item.texture);
    // Lo de game.json: la portada y el HUD, cargados una vez al arrancar.
    keep(titleBackground);
    keep(hudImages.heartFull);
    keep(hudImages.heartEmpty);
    keep(hudImages.barFill);
    keep(hudImages.barFrame);

    // Las armas de todo el proyecto (para "Continuar") traen las texturas de
    // todos los niveles: se olvidan, y se vuelven a leer si hacen falta.
    projectItems.clear();
    projectItemsLoaded = false;

    const std::size_t released = resources.ReleaseTexturesExcept(inUse);
    if (released > 0)
    {
        std::cout << "Texturas liberadas al cambiar de nivel: " << released << std::endl;
    }
}

void GameSession::BeginTransition(const std::filesystem::path &target, const std::string &title, bool restart)
{
    // Una sola a la vez: la primera que se pida es la que vale.
    if (transition.active)
    {
        return;
    }
    transition = Transition{true, target, title,
                            "Cargando " + target.stem().string() + "...", kTransitionSeconds, restart};
    std::cout << title << " -> " << target.string() << std::endl;
}

void GameSession::ShowMessage(const std::string &text, float seconds)
{
    message = text;
    messageRemaining = seconds;
}

void GameSession::FrameCamera()
{
    const IsoGridSystem &grid = level.grid;

    // El encuadre fijo: el centro horizontal en x = 0 y, en vertical, la mitad
    // de la altura proyectada del rombo del nivel. Es EXACTAMENTE la cuenta que
    // el motor hacia en cada frame antes de tener camara ("levelOriginY"), y se
    // conserva tal cual, en el mismo orden, porque es la que define el modo
    // Fixed: un nivel sin bloque "camera" tiene que verse igual que siempre.
    cameraFixedCenter =
        Vector2{0.0f, (grid.GetGridWidth() + grid.GetGridHeight() - 2) * grid.GetTileHeight() / 4.0f};

    // Los limites: la caja que encierra todas las celdas de piso y de pared,
    // cada una con su rombo entero (las celdas van centradas en su punto).
    // Arriba se deja un tile de ancho de margen para lo que se levanta sobre
    // su celda -- una pared se dibuja hacia arriba --, asi la fila de atras no
    // queda cortada contra el borde de la pantalla.
    bool any = false;
    Vector2 min{0, 0};
    Vector2 max{0, 0};
    const auto include = [&](const GridCoord &cell)
    {
        const Vector2 point = grid.GridToScreen(Vector2{static_cast<float>(cell.col), static_cast<float>(cell.row)});
        if (!any)
        {
            min = max = point;
            any = true;
            return;
        }
        min = Vector2{std::min(min.x, point.x), std::min(min.y, point.y)};
        max = Vector2{std::max(max.x, point.x), std::max(max.y, point.y)};
    };
    for (const auto &cell : level.floorTiles)
    {
        include(cell);
    }
    for (const auto &cell : level.wallTiles)
    {
        include(cell);
    }
    if (!any)
    {
        // Un nivel sin celdas: sin limites, la camara no se frena en ningun lado.
        cameraBounds = Rectangle{0, 0, 0, 0};
        return;
    }
    const float halfTileWidth = grid.GetTileWidth() / 2.0f;
    const float halfTileHeight = grid.GetTileHeight() / 2.0f;
    const float top = min.y - halfTileHeight - static_cast<float>(grid.GetTileWidth());
    cameraBounds = Rectangle{min.x - halfTileWidth, top, (max.x - min.x) + 2.0f * halfTileWidth,
                             (max.y + halfTileHeight) - top};
}

Vector2 GameSession::CameraFocus() const
{
    // Los pies del jugador: el mismo punto que usa el motor para ordenar por
    // profundidad. Si cae, se sigue mirando donde quedo; saltar al centro del
    // nivel justo en la pantalla de "Derrotado" se veria como un error.
    return player ? level.grid.GridToScreen(Movement::BoxCenter(*player)) : cameraFixedCenter;
}

Vector2 GameSession::ScreenSize() const
{
    return Vector2{static_cast<float>(gfx.GetScreenWidth()), static_cast<float>(gfx.GetScreenHeight())};
}

// La imagen de fondo llena la VENTANA, no el mundo: se dibuja en pantalla,
// antes de la pasada del mundo, y por eso queda quieta aunque la camara se
// mueva y no depende de su resolucion. Va encima del color con el que
// BeginFrame limpio la pantalla: lo transparente deja ver ese color.
void GameSession::DrawBackgroundImage()
{
    // El mismo dibujo que la portada (cubrir, estirar o mosaico): ver
    // Screens::DrawFillImage.
    Screens::DrawFillImage(gfx, level.backgroundTexture, level.backgroundFit, ScreenSize());
}

void GameSession::Run()
{
    while (!gfx.ShouldClose() && !quitRequested)
    {
        Frame(gfx.GetDeltaTime());
    }
    // Sin limpieza manual: ResourceManager y GraphicsDevice liberan todo en sus
    // destructores (RAII), en orden inverso al de declaracion en el header.
}

// =============================================================================
// LA PARTIDA: portada, creditos, guardado y puntos de control
// =============================================================================

namespace
{
// Las opciones de los menus. La fuente por defecto de raylib trae los
// caracteres de Latin-1, asi que las tildes se ven (probado con "isométrica").
const char *const kNewGame = "Nueva partida";
const char *const kContinue = "Continuar";
const char *const kCredits = "Créditos";
const char *const kQuit = "Salir";
const char *const kResume = "Continuar";
const char *const kRestartLevel = "Reiniciar el nivel";
const char *const kBackToTitle = "Volver a la portada";
const char *const kQuitGame = "Salir del juego";
const char *const kBackToCheckpoint = "Volver al punto de control";
const char *const kRetryLevel = "Reintentar el nivel";
// A cuantas celdas del centro de un punto de control hay que estar para que guarde.
constexpr float kCheckpointReach = 0.9f;
} // namespace

void GameSession::Frame(float deltaTime)
{
    switch (screen)
    {
    case Screen::Title:
        UpdateTitle();
        break;
    case Screen::Credits:
        UpdateCredits(deltaTime);
        break;
    case Screen::Playing:
    default:
        Update(deltaTime);
        break;
    }
}

void GameSession::FinishFrame()
{
    // Captura pedida por Benchmark ("--captura"): lo dibujado se lee del
    // buffer ANTES de presentarlo. Primero se vacia el lote de raylib, que
    // todavia puede tener sprites sin mandar a la GPU.
    if (!pendingScreenshot.empty())
    {
        rlDrawRenderBatchActive();
        TakeScreenshot(pendingScreenshot.c_str());
        pendingScreenshot.clear();
    }
    gfx.EndFrame();
}

void GameSession::GoToTitle()
{
    screen = Screen::Title;
    paused = false;
    gameOver = false;
    // La portada es el juego de verdad, aunque se haya llegado desde una prueba.
    saveSlot = Progress::kGameSlot;
    // "Continuar" solo si hay una partida que continuar; "Creditos" solo si hay creditos.
    titleMenu = Screens::Menu{{kNewGame}, 0};
    if (Progress::Exists(projectRoot, saveSlot))
    {
        titleMenu.items.push_back(kContinue);
        titleMenu.selected = 1;
    }
    if (!config.screens.credits.empty())
    {
        titleMenu.items.push_back(kCredits);
    }
    titleMenu.items.push_back(kQuit);

    if (!config.titleScreen.music.empty())
    {
        // GetMusic devuelve la cache: la musica es un stream que se reproduce
        // en su lugar, no una copia.
        Music &music = const_cast<Music &>(resources.GetMusic(assets.Resolve(config.titleScreen.music)));
        if (music.frameCount > 0)
        {
            audio.PlayMusic(music);
        }
    }
}

void GameSession::UpdateTitle()
{
    gfx.BeginFrame(config.titleScreen.backgroundColor);
    const std::string title = !config.titleScreen.title.empty() ? config.titleScreen.title
                              : !config.name.empty()            ? config.name
                                                                : std::string("HoneyComb");
    const int choice = Screens::RunTitle(gfx, defaultFont, config.titleScreen, title, titleBackground, titleMenu);
    // Los avisos tambien en la portada: "Continuar" con una partida rota tiene
    // que decir por que no hizo nada. Sobre una franja oscura, porque el fondo
    // de la portada es del color que haya elegido el juego.
    if (noticeRemaining > 0.0f)
    {
        noticeRemaining = std::max(0.0f, noticeRemaining - GetFrameTime());
        DrawRectangle(0, 0, static_cast<int>(ScreenSize().x), 36, Fade(BLACK, 0.7f));
        gfx.DrawText(defaultFont, notice.c_str(), {10, 9}, 18, Color{255, 140, 140, 255});
    }
    if constexpr (DevTools::kEnabled)
    {
        DevTools::DrawBadge(gfx, defaultFont);
    }
    audio.Update();
    FinishFrame();

    if (choice < 0)
    {
        return;
    }
    const std::string picked = titleMenu.items[static_cast<size_t>(choice)];
    if (picked == kNewGame)
    {
        NewGame();
    }
    else if (picked == kContinue)
    {
        ContinueGame();
    }
    else if (picked == kCredits)
    {
        screen = Screen::Credits;
        creditsElapsed = 0.0f;
    }
    else if (picked == kQuit)
    {
        quitRequested = true;
    }
}

void GameSession::UpdateCredits(float deltaTime)
{
    creditsElapsed += deltaTime;
    gfx.BeginFrame(config.titleScreen.backgroundColor);
    const bool back = Screens::RunCredits(gfx, defaultFont, config.titleScreen, config.screens.credits,
                                          titleBackground, creditsElapsed);
    audio.Update();
    FinishFrame();
    if (back)
    {
        screen = Screen::Title;
    }
}

void GameSession::NewGame()
{
    const std::filesystem::path target =
        !config.startLevel.empty() ? LevelsDir() / config.startLevel : initialLevelPath;
    try
    {
        level = loader.Load(target.string(), events);
    }
    catch (const std::exception &error)
    {
        std::cerr << "No se pudo cargar " << target.string() << ": " << error.what() << std::endl;
        notice = "No se pudo cargar " + target.filename().string();
        noticeRemaining = kNoticeSeconds;
        return;
    }
    currentLevelPath = target;
    gameFlags.clear();
    variables = config.variables;
    PrepareLevel(LevelStart::Fresh);
    currentCollisions.clear();
    transition = Transition{};
    screen = Screen::Playing;
    paused = false;
    gameOver = false;
    audio.StopMusic();
}

bool GameSession::ContinueGame()
{
    SaveData save;
    Progress::LoadStatus status = Progress::LoadStatus::Missing;
    if (!Progress::Load(projectRoot, save, saveSlot, &status))
    {
        // Sin partida no hay nada que decir; una rota o de otra version, si:
        // si no, "Continuar" parece no hacer nada.
        if (status == Progress::LoadStatus::Broken)
        {
            notice = "La partida guardada está dañada y no se pudo recuperar";
            noticeRemaining = kNoticeSeconds;
        }
        else if (status == Progress::LoadStatus::TooNew)
        {
            notice = "La partida guardada es de una versión más nueva del juego";
            noticeRemaining = kNoticeSeconds;
        }
        return false;
    }
    const std::filesystem::path target = LevelsDir() / save.level;
    try
    {
        level = loader.Load(target.string(), events);
    }
    catch (const std::exception &error)
    {
        std::cerr << "No se pudo cargar la partida (" << target.string() << "): " << error.what() << std::endl;
        notice = "No se pudo cargar la partida guardada";
        noticeRemaining = kNoticeSeconds;
        return false;
    }
    currentLevelPath = target;
    PrepareLevel(LevelStart::Fresh);
    currentCollisions.clear();
    transition = Transition{};

    // Las armas salen del catalogo del nivel; una que se trajo de otro nivel
    // se busca en los demas niveles del proyecto.
    ItemCatalog catalog = level.items;
    for (const auto &id : save.weapons)
    {
        if (catalog.count(id) == 0)
        {
            const ItemCatalog &all = ProjectItems();
            const auto it = all.find(id);
            if (it != all.end())
            {
                catalog.emplace(id, it->second);
            }
        }
    }
    inventory.Restore(player ? player->inventory : InventoryConfig{}, catalog, save.weapons, save.activeWeapon,
                      save.coins);
    inventoryAtLevelStart = inventory;

    // Lo que ya se junto sigue juntado, y cuenta para "Al juntar objetos". Un
    // id que ya no es un objeto del nivel (se edito) se ignora.
    for (const auto &id : save.collectedItems)
    {
        const auto it = entityById.find(id);
        if (it != entityById.end() && !it->second->itemId.empty())
        {
            it->second->destroyed = true;
        }
    }
    loot.collected = save.collectedCounts;
    loot.collectedTotal = save.collectedTotal;
    // Los eventos que ya se dispararon no vuelven a dar su recompensa aunque
    // los enemigos hayan reaparecido (ver EventBindings::RegisterAll).
    events.RestoreFired(save.firedEvents);

    if (player)
    {
        // Donde aparece: donde se guardo, si todavia se puede estar ahi. Si el
        // nivel se edito despues (una pared nueva, una sala que se movio), en
        // el punto de control donde se guardo; y si tampoco, donde lo puso el
        // editor. Asi una partida vieja nunca deja al jugador adentro de una pared.
        Vector2 spot = player->precisePosition;
        if (save.hasPosition && Movement::CanOccupy(level, *player, save.position))
        {
            spot = save.position;
        }
        else if (save.hasPosition)
        {
            const auto checkpoint = entityById.find(save.checkpoint);
            if (!save.checkpoint.empty() && checkpoint != entityById.end() &&
                Movement::CanOccupy(level, *player, checkpoint->second->precisePosition))
            {
                spot = checkpoint->second->precisePosition;
            }
            std::cerr << "La posicion guardada ya no se puede pisar: el jugador aparece en "
                      << (spot.x == player->precisePosition.x && spot.y == player->precisePosition.y
                              ? "el inicio del nivel"
                              : "su punto de control")
                      << std::endl;
        }
        player->precisePosition = spot;
        player->position = GridCoord{static_cast<int>(std::round(spot.x)), static_cast<int>(std::round(spot.y))};
        if (save.health > 0.0f)
        {
            player->health = std::min(save.health, player->maxHealth);
        }
        camera.SnapTo(CameraFocus(), cameraFixedCenter, cameraBounds);
    }
    flags = std::unordered_set<std::string>(save.levelFlags.begin(), save.levelFlags.end());
    gameFlags = std::unordered_set<std::string>(save.gameFlags.begin(), save.gameFlags.end());
    variables = save.variables;
    // Aparece parado en su punto de control: ese no vuelve a guardar hasta salir de el.
    lastCheckpointId = CheckpointInReach();

    screen = Screen::Playing;
    paused = false;
    gameOver = false;
    audio.StopMusic();
    if (status == Progress::LoadStatus::Recovered)
    {
        notice = "La partida guardada estaba dañada: se recuperó la anterior";
        noticeRemaining = kNoticeSeconds;
    }
    std::cout << "Partida retomada en " << save.level << std::endl;
    return true;
}

void GameSession::SaveGame()
{
    if (!player)
    {
        return;
    }
    SaveData save;
    // La ruta del nivel relativa a levels/ (puede estar en una subcarpeta). Un
    // nivel de afuera no se puede guardar: antes se anotaba solo su nombre, y
    // "Continuar" despues lo buscaba en levels/, donde no esta.
    const std::filesystem::path relative =
        currentLevelPath.lexically_normal().lexically_relative(LevelsDir().lexically_normal());
    if (relative.empty() || !Progress::IsLevelInsideLevels(relative.generic_string()))
    {
        notice = "No se puede guardar la partida: el nivel no está dentro de levels/";
        noticeRemaining = kNoticeSeconds;
        return;
    }
    save.level = relative.generic_string();
    save.checkpoint = CheckpointInReach();
    for (const auto &entity : level.entities)
    {
        if (!entity.itemId.empty() && entity.destroyed)
        {
            save.collectedItems.push_back(entity.id);
        }
    }
    save.collectedCounts = loot.collected;
    save.collectedTotal = loot.collectedTotal;
    save.firedEvents = events.FiredKeys();
    save.hasPosition = true;
    save.position = player->precisePosition;
    save.health = player->health;
    save.coins = inventory.coins;
    save.weapons = inventory.WeaponIds();
    save.activeWeapon = inventory.ActiveIndex();
    save.levelFlags.assign(flags.begin(), flags.end());
    save.gameFlags.assign(gameFlags.begin(), gameFlags.end());
    save.variables = variables;
    if (Progress::Write(projectRoot, save, saveSlot))
    {
        ShowMessage("Partida guardada", EventBindings::kPickupMessageSeconds);
    }
    else
    {
        notice = "No se pudo guardar la partida";
        noticeRemaining = kNoticeSeconds;
    }
}

std::string GameSession::CheckpointInReach() const
{
    if (!player)
    {
        return "";
    }
    const Vector2 at = Movement::BoxCenter(*player);
    for (const auto &entity : level.entities)
    {
        if (entity.type != "checkpoint" || entity.destroyed || entity.hidden)
        {
            continue;
        }
        const Vector2 center = Movement::BoxCenter(entity);
        if (std::hypot(center.x - at.x, center.y - at.y) <= kCheckpointReach)
        {
            return entity.id;
        }
    }
    return "";
}

void GameSession::CheckCheckpoints()
{
    const std::string id = CheckpointInReach();
    if (!id.empty() && id != lastCheckpointId)
    {
        lastCheckpointId = id;
        SaveGame();
    }
}

ItemCatalog GameSession::ProjectItems()
{
    if (!projectItemsLoaded)
    {
        projectItemsLoaded = true;
        std::error_code error;
        for (const auto &entry : std::filesystem::recursive_directory_iterator(LevelsDir(), error))
        {
            if (entry.path().extension() != ".json")
            {
                continue;
            }
            try
            {
                std::ifstream stream(entry.path());
                const nlohmann::json levelJson = nlohmann::json::parse(stream);
                if (levelJson.contains("items"))
                {
                    for (auto &[id, item] : ItemLoader::ParseItems(levelJson.at("items"), resources, assets))
                    {
                        projectItems.emplace(id, item);
                    }
                }
            }
            catch (const std::exception &)
            {
                // Un nivel roto no impide continuar: solo no aporta sus armas.
            }
        }
    }
    return projectItems;
}

void GameSession::RunMenuAction(const std::string &action)
{
    if (action == kResume)
    {
        paused = false;
    }
    else if (action == kRestartLevel || action == kRetryLevel)
    {
        paused = false;
        gameOver = false;
        BeginTransition(currentLevelPath, "Reiniciando", true);
        transition.remaining = 0.0f;
    }
    else if (action == kBackToCheckpoint)
    {
        if (!ContinueGame())
        {
            gameOver = false;
            BeginTransition(currentLevelPath, "Reiniciando", true);
            transition.remaining = 0.0f;
        }
    }
    else if (action == kBackToTitle)
    {
        GoToTitle();
    }
    else if (action == kQuitGame)
    {
        quitRequested = true;
    }
}

void GameSession::ShowScreenForTest(const std::string &name)
{
    if (name == "titulo")
    {
        GoToTitle();
    }
    else if (name == "creditos")
    {
        screen = Screen::Credits;
        creditsElapsed = 2.0f;
    }
    else if (name == "pausa")
    {
        screen = Screen::Playing;
        paused = true;
        pauseMenu = Screens::Menu{{kResume, kRestartLevel, kBackToTitle, kQuitGame}, 0};
    }
    else if (name == "fin")
    {
        screen = Screen::Playing;
        gameOver = true;
        gameOverMenu = Screens::Menu{
            {Progress::Exists(projectRoot, saveSlot) ? kBackToCheckpoint : kRetryLevel, kBackToTitle, kQuitGame}, 0};
    }
}

void GameSession::Benchmark(float seconds, const std::string &screenshot)
{
    gfx.SetTargetFPS(0);
    // El primer medio segundo no cuenta: subir texturas a la GPU y llenar las
    // caches hace lentos los primeros cuadros, y eso no es el ritmo del juego.
    const double warmup = 0.5;
    const double start = GetTime();
    double measuredFrom = 0.0;
    long frames = 0;
    while (!gfx.ShouldClose() && !quitRequested)
    {
        const double now = GetTime() - start;
        if (now >= warmup + seconds)
        {
            break;
        }
        if (now >= warmup && measuredFrom == 0.0)
        {
            measuredFrom = now;
        }
        Frame(gfx.GetDeltaTime());
        if (measuredFrom > 0.0)
        {
            ++frames;
        }
    }
    const double elapsed = (GetTime() - start) - measuredFrom;
    const ZSortSystem::Stats &drawn = zsort.LastStats();
    std::cout << "BENCH " << (DevTools::kEnabled ? "Debug" : "Release")
              << (culling ? "" : " sin recorte") << " | " << level.name << " | "
              << frames << " cuadros en " << elapsed << " s | " << (frames / elapsed) << " FPS | "
              << (elapsed * 1000.0 / frames) << " ms por cuadro | sprites dibujados "
              << (drawn.ground + drawn.sorted) << ", recortados " << drawn.culled << std::endl;

    // Un cuadro mas, que se guarda como imagen al terminar de dibujarse (ver
    // el final de Update). raylib lo deja junto al ejecutable, con ese nombre.
    if (!screenshot.empty() && !gfx.ShouldClose())
    {
        pendingScreenshot = screenshot;
        Frame(gfx.GetDeltaTime());
        std::cout << "CAPTURA " << screenshot << std::endl;
    }
}

// =============================================================================
// UN FRAME
//
// Orden de cada frame. NO es arbitrario:
//   1. teclas: F11 pantalla completa, y en Debug las de administrador (F1
//      grilla, F2 hitboxes, F3 panel... ver game/DevTools.hpp)
//   2. tamano de la ventana para la camara, y apuntar con el mouse
//   3. si no se esta pasando de nivel: movimiento del jugador y combate
//   4. la camara sigue al jugador (en modo Fixed, el encuadre de siempre)
//   5. pasada del MUNDO, por la camara: lo que ve la camara (el recorte),
//      piso -> paredes -> entidades al ZSortSystem, Flush (piso sin ordenar,
//      el resto ordenado por profundidad), overlays de depuracion, golpes y
//      proyectiles
//   6. barras de vida, ya en pantalla
//   7. resolver colisiones -> correr eventos -> actualizar audio
//   8. HUD, pantalla de paso de nivel, panel F3 (solo Debug), y la carga
//      cuando termina
// =============================================================================
void GameSession::Update(float deltaTime)
{
    // Desde aca hasta antes de EndFrame es el TRABAJO del cuadro. EndFrame
    // ademas espera lo que falte para el tope de 60 FPS, y eso no es costo.
    const double frameStart = GetTime();

    // Herramientas de administrador: solo en Debug (ver game/DevTools.hpp). En
    // Release kEnabled es false y el compilador borra el bloque entero.
    if constexpr (DevTools::kEnabled)
    {
        if (IsKeyPressed(KEY_F1))
        {
            showGrid = !showGrid;
        }
        if (IsKeyPressed(KEY_F2))
        {
            showHitboxes = !showHitboxes;
        }
        const DevTools::Requests requests = DevTools::HandleKeys(dev);
        if (requests.fpsCapChanged)
        {
            gfx.SetTargetFPS(dev.uncapped ? 0 : 60);
        }
        // Recargar es volver a empezar el nivel tal como esta en el disco, sin
        // la pantalla de espera: sirve para ver al instante lo que se acaba de
        // guardar en el editor.
        if (requests.reloadLevel && !transition.active)
        {
            BeginTransition(currentLevelPath, "Recargando", true);
            transition.remaining = 0.0f;
        }
    }
    if (IsKeyPressed(KEY_F11))
    {
        // Sin bordes, como la pantalla completa de game.json: ocupa el monitor
        // a su resolucion sin cambiar el modo de video.
        ToggleBorderlessWindowed();
    }
    // Esc pausa y despausa. Con la pantalla de paso o la de fin de partida no:
    // ahi ya hay algo al frente.
    if (IsKeyPressed(KEY_ESCAPE) && !transition.active && !gameOver)
    {
        paused = !paused;
        pauseMenu = Screens::Menu{{kResume, kRestartLevel, kBackToTitle, kQuitGame}, 0};
    }
    // Congelado: pasando de nivel, en pausa o derrotado. Nadie se mueve, nadie
    // pega, los eventos no corren; la escena se sigue dibujando quieta.
    const bool frozen = transition.active || paused || gameOver;

    // --- Camara: tamano de la ventana -------------------------------------
    // Antes de apuntar: el mouse tiene que leerse con el mismo encuadre que se
    // va a dibujar, y la ventana se puede redimensionar en cualquier momento.
    camera.SetScreenSize(ScreenSize());

    // Proyeccion isometrica al MUNDO, sin encuadre: el encuadre lo pone la
    // camara al dibujar (GraphicsDevice::BeginWorld). Todo lo que se dibuja
    // del nivel y todo lo que colisiona usa estas coordenadas, asi que las
    // colisiones no dependen ni de la ventana ni de la camara.
    //
    // El editor proyecta con la misma cuenta (core/iso-projection.ts), y ese
    // paralelismo es lo que garantiza que lo que se ve en el canvas del editor
    // coincida con lo que termina dibujando el runtime.
    auto gridToWorld = [&](Vector2 gridPosition) { return level.grid.GridToScreen(gridPosition); };

    // --- Apuntar ----------------------------------------------------------
    // El mouse apunta a un LUGAR del mapa, no a una casilla: su posicion en
    // pantalla se lleva al mundo con la inversa de la camara, y de ahi a
    // celdas continuas con la inversa de la proyeccion.
    const Vector2 mouse = input.GetMousePosition();
    const Vector2 aim = level.grid.ScreenToGridContinuous(camera.ScreenToWorld(mouse));

    // --- Jugador, combate y objetos --------------------------------------
    // Con la pantalla de paso de nivel en marcha el juego queda congelado:
    // ni el jugador ni los enemigos se mueven, y nadie pega. Con una tienda
    // abierta tambien, y ahi las teclas 1-9 compran en vez de elegir arma.
    prompt.clear();
    abilitiesUsedThisFrame.clear();
    const bool playerAlive = player && !player->destroyed;
    const bool interactPressed = input.IsActionPressed("interact");
    if (!frozen && shopNpc)
    {
        if (interactPressed || !playerAlive)
        {
            shopNpc = nullptr;
        }
        else
        {
            for (int key = 0; key < 9; ++key)
            {
                if (IsKeyPressed(KEY_ONE + key))
                {
                    const std::string result = Loot::Buy(level, *shopNpc, key, *player, inventory, loot);
                    if (!result.empty())
                    {
                        shopFeedback = result;
                    }
                }
            }
        }
    }
    else if (!frozen)
    {
        if (playerAlive)
        {
            for (int key = 0; key < 9; ++key)
            {
                if (IsKeyPressed(KEY_ONE + key))
                {
                    inventory.Select(key);
                }
            }
            const float wheel = GetMouseWheelMove();
            if (wheel != 0.0f)
            {
                inventory.Cycle(wheel > 0.0f ? -1 : 1);
            }

            // La intencion se lee EN PANTALLA (arriba = arriba visual), no en
            // coordenadas de grilla: en isometrico son cosas distintas.
            // Mobility hace la conversion.
            Mobility::Intent move;
            if (input.IsActionDown("move_up") || input.IsActionDown("move_up_wasd"))
                move.screenDirection.y -= 1;
            if (input.IsActionDown("move_down") || input.IsActionDown("move_down_wasd"))
                move.screenDirection.y += 1;
            if (input.IsActionDown("move_left") || input.IsActionDown("move_left_wasd"))
                move.screenDirection.x -= 1;
            if (input.IsActionDown("move_right") || input.IsActionDown("move_right_wasd"))
                move.screenDirection.x += 1;
            move.dashPressed = input.IsActionPressed("dash");
            move.defendHeld = input.IsActionDown("defend") || input.IsMouseButtonDown(MOUSE_BUTTON_RIGHT);
            const Vector2 center = Movement::BoxCenter(*player);
            move.aimDirection = Vector2{aim.x - center.x, aim.y - center.y};
            Mobility::UpdatePlayer(level, *player, mobility, move, deltaTime);
        }

        Combat::PlayerIntent intent;
        intent.aim = aim;
        intent.attack = input.IsActionPressed("attack") || input.IsActionPressed("attack_alt") ||
                        input.IsMouseButtonPressed(MOUSE_BUTTON_LEFT);
        intent.ability = input.IsActionPressed("ability");
        intent.defending = mobility.defending;
        // F7 (solo Debug): invencible, para probar un nivel sin morir.
        intent.invulnerable = Mobility::IsInvulnerable(mobility) || (DevTools::kEnabled && dev.godMode);
        intent.defenseReduction = player ? player->defense.reduction : 0.0f;
        const Combat::FrameResult combat =
            Combat::Update(level, combatState, player, inventory, intent, deltaTime);
        for (LevelEntity *enemy : combat.defeated)
        {
            std::cout << "Enemigo vencido: '" << enemy->id << "'" << std::endl;
            Loot::RollDrops(level, *enemy, loot);
        }
        abilitiesUsedThisFrame = combat.abilitiesUsed;

        if (playerAlive)
        {
            // Junto a un NPC con tienda, E abre la tienda en vez de cambiar un
            // arma: las dos cosas no pueden colgar de la misma tecla a la vez.
            LevelEntity *nearShop = Loot::NearbyShop(level, *player);
            const Loot::PickupFrame pickup =
                Loot::UpdatePickups(level, *player, inventory, loot, interactPressed && !nearShop, deltaTime);
            if (!pickup.message.empty())
            {
                ShowMessage(pickup.message, EventBindings::kPickupMessageSeconds);
            }
            prompt = pickup.prompt;
            if (nearShop && interactPressed)
            {
                shopNpc = nearShop;
                shopFeedback.clear();
            }
            else if (nearShop && prompt.empty())
            {
                prompt = "E: tienda de " + nearShop->id;
            }
        }

        // Perder vuelve a empezar el MISMO nivel, con la misma pantalla de
        // paso: recargarlo desde el disco lo deja exactamente como arranca,
        // y el inventario vuelve a como estaba al entrar.
        // Perder abre la pantalla de fin de partida (ver el final del cuadro):
        // volver al ultimo punto de control si hay partida guardada, o
        // reintentar el nivel como estaba al entrar.
        if (combat.playerDefeated)
        {
            gameOver = true;
            gameOverMenu = Screens::Menu{
                {Progress::Exists(projectRoot, saveSlot) ? kBackToCheckpoint : kRetryLevel, kBackToTitle, kQuitGame},
                0};
        }
        else if (playerAlive)
        {
            CheckCheckpoints();
        }
    }
    if (!paused && !gameOver)
    {
        messageRemaining = std::max(0.0f, messageRemaining - deltaTime);
    }

    // --- Camara: seguir al jugador ----------------------------------------
    // Despues de moverlo y antes de dibujar: la camara mira donde el jugador
    // ESTA en este frame. En modo Fixed solo sostiene el encuadre de siempre.
    camera.Update(CameraFocus(), cameraFixedCenter, cameraBounds, deltaTime);

    // Fondo elegido en el editor. El texto del HUD cambia a claro sobre un
    // fondo oscuro, porque el gris oscuro de siempre ahi no se leeria.
    const Color background = level.backgroundColor;
    const bool darkBackground =
        0.299f * background.r + 0.587f * background.g + 0.114f * background.b < 128.0f;
    const Color hudText = darkBackground ? LIGHTGRAY : DARKGRAY;
    gfx.BeginFrame(background);
    // La imagen de fondo, si el nivel tiene, en pantalla y debajo de todo.
    DrawBackgroundImage();
    // Pasada del MUNDO: todo lo que sigue, hasta los proyectiles, pasa por la
    // camara. El HUD se dibuja despues de EndWorld, en pantalla.
    gfx.BeginWorld(camera.GetCamera());

    // --- Recorte: lo que ve la camara, y un margen ------------------------
    // Las dos esquinas de la ventana llevadas al mundo, agrandadas
    // level.cullMarginTiles casillas por lado ("camera.cullMargin", 2 si el
    // nivel no lo dice; se cambia en el editor, Nivel › Avanzado). Lo que esta
    // por entrar en pantalla -- la camara avanzando, un enemigo que se acerca
    // -- ya esta dibujado cuando aparece. Lo que cae afuera no se ordena ni se
    // dibuja (ver ZSortSystem::Submit). Solo el dibujo: las colisiones, la IA
    // y los eventos siguen corriendo en todo el nivel. Vale igual en Debug y
    // en Release: es parte del motor, no de las herramientas.
    const Vector2 viewTopLeft = camera.ScreenToWorld(Vector2{0, 0});
    const Vector2 viewBottomRight = camera.ScreenToWorld(ScreenSize());
    const Rectangle cameraView{viewTopLeft.x, viewTopLeft.y, viewBottomRight.x - viewTopLeft.x,
                               viewBottomRight.y - viewTopLeft.y};
    const float cullMargin = level.cullMarginTiles * static_cast<float>(level.grid.GetTileWidth());
    Rectangle visibleView = cameraView;
    Rectangle cullView = Grow(cameraView, cullMargin);
    // F4 (solo Debug): el limite del recorte se mete dentro de la ventana, para
    // que se vea, y la "ventana" queda adentro de el, a cullMargin. Abajo se
    // dibujan los dos bordes: lo que sale del de afuera desaparece. Con mucho
    // zoom o una ventana chica el margen no entra, y solo se ve el de afuera.
    const bool previewCulling = DevTools::kEnabled && dev.showCulling;
    if (previewCulling)
    {
        cullView = DevTools::PreviewView(cameraView);
        visibleView = Grow(cullView, -cullMargin);
    }
    // Un rectangulo vacio apaga el recorte (ver SetCulling).
    zsort.SetView(culling ? cullView : Rectangle{0, 0, 0, 0});

    // --- Piso (SpriteLayer::Ground) --------------------------------------
    // Nada se dibuja directo: todo se ENCOLA en el ZSortSystem, que al final
    // ordena por profundidad y recien ahi dibuja. Por eso un personaje puede
    // quedar tapado por una pared que se encolo antes que el.
    //
    // El piso es la excepcion: va en el orden de floorDrawOrder, ya de atras
    // hacia adelante, y el ZSortSystem lo dibuja entero primero sin ordenarlo.
    for (const FloorSprite &tile : floorDrawOrder)
    {
        zsort.Submit(SpriteInstance{
            tile.texture,
            tile.source,

            // posición visual: la textura se centra sobre el rombo
            tile.topLeft,

            // posición para Z-sort: el centro de la celda, que es el punto de
            // apoyo real. Va separado de la posicion visual justamente para que
            // el offset de arriba no altere el orden de profundidad.
            tile.center,

            Vector2{0, 0},
            0.0f,
            WHITE,
            SpriteLayer::Ground,

            // Al ancho de la casilla (ver PrepareLevel).
            tile.size});
    }

    // --- Paredes (SpriteLayer::Object) -----------------------------------
    // Se generan desde las celdas de pared del nivel, no desde el array de
    // entidades. Mismo recorrido de celdas que usa Movement para frenar.
    if (level.wallTexture)
    {
        for (const auto& wallTile : level.wallTiles)
        {
            Vector2 screenPos = gridToWorld(
                Vector2{static_cast<float>(wallTile.col), static_cast<float>(wallTile.row)});
            zsort.Submit(SpriteInstance{
                level.wallTexture,
                level.wallSourceRect,

                // posición visual: la pared se "levanta" sobre su celda,
                // por eso el offset vertical es mayor que medio tile
                Vector2{
                    screenPos.x - level.grid.GetTileWidth() / 2.0f,
                    screenPos.y - level.grid.GetTileWidth() / 1.5f},

                // posición lógica/depth: sigue siendo el centro de la
                // celda, para ordenar igual que el piso y las entidades
                screenPos,

                Vector2{0, 0},
                0.0f,
                WHITE,
                SpriteLayer::Object,  // desempata contra otros objetos a igual profundidad

                // Destino cuadrado de tileWidth x tileWidth: la textura
                // fuente es de 32px y hay que estirarla al tamano del tile.
                Vector2{
                    static_cast<float>(level.grid.GetTileWidth()),
                    static_cast<float>(level.grid.GetTileWidth())}});
        }
    }

    healthBars.clear();
    for (auto &entity : level.entities)
    {
        // Oculta = una puerta abierta: ni se ve ni colisiona.
        if (entity.destroyed || entity.hidden)
        {
            continue;
        }

        // Si la entidad se anima, el frame actual reemplaza al sourceRect
        // fijo del JSON. El Update() se hace aca y no en un paso aparte
        // para que una entidad destruida deje de animarse sola.
        Rectangle sourceRect = entity.sourceRect;
        auto animIt = animInstances.find(entity.id);
        if (animIt != animInstances.end())
        {
            // En pausa o derrotado, las animaciones tambien quedan quietas.
            animIt->second.Update(paused || gameOver ? 0.0f : deltaTime);
            sourceRect = animIt->second.GetCurrentFrame();
        }

        // Una entidad de span N ocupa NxN celdas a partir de su celda y se
        // apoya en el CENTRO de ese bloque. El tamano de dibujo combina las
        // celdas que ocupa (span) con la escala configurada (scale).
        const float spanScale = static_cast<float>(entity.span) * entity.scale;
        const Vector2 sortPosition = gridToWorld(Movement::BoxCenter(entity));

        // El sprite se apoya en el suelo: centrado en X y con los "pies"
        // sobre el punto de la celda, por eso se resta el alto completo.
        //
        // groundOffset corrige eso para el arte que no se apoya en su
        // borde inferior: un solido que llena la casilla lo usa para bajar
        // medio tile y apoyar el centro del rombo de su base en el punto de
        // la celda. Se agranda con el sprite, porque esta medido en pixeles
        // del sprite original.
        const float drawWidth = sourceRect.width * spanScale;
        const float drawHeight = sourceRect.height * spanScale;
        const Vector2 drawPosition{
            sortPosition.x - drawWidth / 2.0f,
            sortPosition.y - drawHeight + entity.groundOffset * spanScale};

        // Rojo mientras dura el destello de un golpe recibido; si no, el
        // tinte de depuracion de siempre para los obstaculos.
        Color tint = WHITE;
        if (entity.hurtTimer > 0.0f)
        {
            tint = Color{255, 90, 90, 255};
        }
        else if (entity.type == "obstacle")
        {
            tint = RED;
        }

        zsort.Submit(SpriteInstance{
            entity.texture,
            sourceRect,

            drawPosition, // visual

            sortPosition, // profundidad

            Vector2{0, 0},
            0.0f,
            tint,
            SpriteLayer::Entity,

            Vector2{drawWidth, drawHeight}
        });

        // Los colliders se encolan en este mismo recorrido para no volver a
        // iterar el vector; CollisionSystem los cruza todos contra todos
        // cuando se le pida el Flush().
        if (entity.colliderSize.x > 0 && entity.colliderSize.y > 0)
        {
            collision.Submit(ColliderInstance{
                &entity,
                Rectangle{sortPosition.x, sortPosition.y,
                          entity.colliderSize.x, entity.colliderSize.y}});
        }

        // Barra de vida sobre el jugador y sobre cada enemigo.
        if (&entity == player || Combat::IsEnemy(entity))
        {
            healthBars.push_back(HealthBarMark{
                Vector2{sortPosition.x, drawPosition.y},
                entity.health / entity.maxHealth,
                &entity == player});
        }
    }

    // Objetos tirados en el piso: sprites como los demas, ordenados con ellos.
    CombatView::SubmitGroundItems(zsort, loot, gridToWorld, static_cast<float>(GetTime()));

    // Recien aca se dibuja todo lo encolado, ya ordenado por profundidad.
    zsort.Flush();

    // --- Overlay de grilla (F1) -----------------------------------------
    // Va despues del Flush a proposito: tiene que verse ENCIMA de todo.
    // Dibuja directo con raylib porque es ayuda de depuracion, no parte de
    // la escena, y no debe participar del orden por profundidad.
    if (showGrid)
    {
        // El mismo azul claro que las lineas de la grilla del editor
        // (#70bafa en iso-canvas-renderer.ts), para que se lean igual.
        const Color gridColor{112, 186, 250, 255};
        float halfTileWidth = level.grid.GetTileWidth() / 2.0f;
        float halfTileHeight = level.grid.GetTileHeight() / 2.0f;
        for (int row = 0; row < level.grid.GetGridHeight(); ++row)
        {
            for (int col = 0; col < level.grid.GetGridWidth(); ++col)
            {
                Vector2 screenPos = gridToWorld(
                    Vector2{static_cast<float>(col), static_cast<float>(row)});

                // Los cuatro vertices del rombo que representa la celda.
                Vector2 top{screenPos.x, screenPos.y - halfTileHeight};
                Vector2 right{screenPos.x + halfTileWidth, screenPos.y};
                Vector2 bottom{screenPos.x, screenPos.y + halfTileHeight};
                Vector2 left{screenPos.x - halfTileWidth, screenPos.y};
                DrawLineV(top, right, gridColor);
                DrawLineV(right, bottom, gridColor);
                DrawLineV(bottom, left, gridColor);
                DrawLineV(left, top, gridColor);
            }
        }
    }

    // --- Overlay de hitboxes (F2) --------------------------------------
    // Lo que bloquea y lo que detecta contactos, con las mismas cuentas de
    // Movement y los mismos colores que la vista "Colisiones" del editor:
    //   rojo     pared: celdas de pared del mapa y entidades "wall" (bloque entero)
    //   amarillo colision: collider solido, con su forma (caja o elipse)
    //   verde    sensor: collider no solido, la caja en pixeles de CollisionSystem
    // Independiente de F1: va despues de la grilla para quedar encima.
    if (showHitboxes)
    {
        const Color wallColor{192, 80, 80, 255};       // #c05050
        const Color collisionColor{224, 192, 74, 255};  // #e0c04a
        const Color sensorColor{107, 158, 63, 255};     // #6b9e3f
        const float thickness = 2.0f;

        // Un contorno cerrado de puntos en CELDAS, proyectado a pantalla.
        auto drawLoop = [&](const std::vector<Vector2>& cells, Color color)
        {
            for (size_t i = 0; i < cells.size(); ++i)
            {
                DrawLineEx(gridToWorld(cells[i]), gridToWorld(cells[(i + 1) % cells.size()]),
                           thickness, color);
            }
        };
        auto drawBox = [&](Vector2 center, Vector2 half, Color color)
        {
            drawLoop({{center.x - half.x, center.y - half.y},
                      {center.x + half.x, center.y - half.y},
                      {center.x + half.x, center.y + half.y},
                      {center.x - half.x, center.y + half.y}},
                     color);
        };
        auto drawEllipse = [&](Vector2 center, Vector2 radii, Color color)
        {
            const int steps = 32;
            std::vector<Vector2> points;
            points.reserve(steps);
            for (int i = 0; i < steps; ++i)
            {
                const float angle = (static_cast<float>(i) / steps) * 2.0f * PI;
                points.push_back({center.x + std::cos(angle) * radii.x,
                                  center.y + std::sin(angle) * radii.y});
            }
            drawLoop(points, color);
        };

        // Paredes del mapa: sin textura de pared no bloquean (ver Movement).
        if (level.wallTexture)
        {
            for (const auto& tile : level.wallTiles)
            {
                drawBox({static_cast<float>(tile.col), static_cast<float>(tile.row)},
                        {0.5f, 0.5f}, wallColor);
            }
        }

        for (const auto& entity : level.entities)
        {
            if (entity.destroyed || entity.hidden)
            {
                continue;
            }
            const Vector2 center = Movement::BoxCenter(entity);
            if (entity.wall)
            {
                drawBox(center, Movement::WallHalfExtents(entity), wallColor);
            }
            if (entity.colliderSize.x <= 0 || entity.colliderSize.y <= 0)
            {
                continue;
            }
            if (entity.colliderSolid)
            {
                const Vector2 half = Movement::HalfExtentsInCells(level, entity);
                if (entity.colliderRound)
                {
                    drawEllipse(center, half, collisionColor);
                }
                else
                {
                    drawBox(center, half, collisionColor);
                }
            }
            else
            {
                const Vector2 anchor = gridToWorld(center);
                DrawRectangleLinesEx(
                    Rectangle{anchor.x, anchor.y, entity.colliderSize.x, entity.colliderSize.y},
                    thickness, sensorColor);
            }
        }
    }

    // --- Golpes, areas y proyectiles --------------------------------------
    // Encima de la escena: son la lectura del combate y no deben quedar
    // tapados por una pared.
    CombatView::DrawEffects(combatState, gridToWorld);
    CombatView::DrawProjectiles(combatState, gridToWorld);

    // F4: adentro, lo que haria de ventana (fino); afuera, hasta donde se
    // dibuja con el margen (grueso). Lo que esta mas alla del grueso no se dibujo.
    if (previewCulling)
    {
        const float pixel = 1.0f / camera.GetCamera().zoom;
        if (visibleView.width > 8.0f * pixel && visibleView.height > 8.0f * pixel)
        {
            DrawRectangleLinesEx(visibleView, pixel, Color{242, 179, 61, 160});
        }
        DrawRectangleLinesEx(cullView, 2.0f * pixel, Color{242, 179, 61, 255});
    }
    gfx.EndWorld();

    // --- Barras de vida sobre las cabezas --------------------------------
    // En PANTALLA, no en el mundo: se ubican sobre cada sprite con la camara
    // pero no se agrandan con el zoom. Una barra es lectura, no escenario, y
    // con zoom 3 una barra de mundo seria mas ancha que el personaje.
    // La del jugador, en el color de su vida del HUD (game.json).
    if (config.hud.showOverheadBars)
    {
        for (const auto &bar : healthBars)
        {
            const Vector2 top = camera.WorldToScreen(bar.topCenter);
            DrawHealthBar(top.x - 16.0f, top.y - 8.0f, 32.0f, 4.0f, bar.ratio,
                          bar.isPlayer ? config.hud.healthFill : Color{220, 70, 70, 255});
        }
    }

    // --- Cierre del frame -----------------------------------------------
    // Flush() devuelve los pares que se solapan y vacia la cola; hay que
    // llamarlo SIEMPRE, aunque el juego este congelado, o la cola crece.
    // Con la pantalla de paso activa los eventos no corren: el nivel ya
    // termino, y un evento mas podria pedir otro cambio encima.
    currentCollisions = collision.Flush();
    if (!frozen)
    {
        events.Update();
    }
    audio.Update();  // raylib necesita esto continuo para musica en streaming

    // --- HUD --------------------------------------------------------------
    // La vida, con el estilo de game.json (ver game/HealthHud). Sin game.json
    // queda igual que siempre: barra arriba a la izquierda.
    const HudConfig &hudConfig = config.hud;
    float coinsTop = 37.0f;
    if (player)
    {
        const float bottomReserve = hudConfig.showControls ? 24.0f : 0.0f;
        const Rectangle healthBox = HealthHud::Draw(gfx, defaultFont, hudConfig, hudImages, player->health,
                                                    player->maxHealth, hudText, bottomReserve);
        // La fila de monedas va debajo de la vida si la vida esta arriba a la
        // izquierda, y si no, en su lugar.
        coinsTop = hudConfig.healthCorner == HudCorner::TopLeft ? healthBox.y + healthBox.height + 7.0f : 10.0f;
    }
    if (hudConfig.showControls)
    {
        gfx.DrawText(defaultFont,
                     "WASD mover | Clic/Espacio atacar | Q habilidad | Shift esquivar | "
                     "Clic der./K defender | 1-9 armas | E usar | Esc pausa",
                     {10, static_cast<float>(gfx.GetScreenHeight() - 22)}, 14, hudText);
    }

    // Inventario, monedas, esquive, jefe, avisos y mensajes.
    CombatView::Hud hud;
    hud.player = player;
    hud.inventory = player ? &inventory : nullptr;
    hud.mobility = &mobility;
    hud.prompt = prompt;
    hud.message = message;
    // Se desvanece en su ultimo medio segundo en vez de cortarse de golpe.
    hud.messageAlpha = std::clamp(messageRemaining / 0.5f, 0.0f, 1.0f);
    hud.text = hudText;
    hud.showCoins = hudConfig.showCoins;
    hud.showInventory = hudConfig.showInventory;
    hud.showBossBar = hudConfig.showBossBar;
    hud.coinsTop = coinsTop;
    // La barra del jefe aparece cuando la pelea empieza: el jugador lo tiene
    // a la vista o ya lo lastimo. Antes se veia desde el primer frame, con el
    // jefe todavia encerrado del otro lado del mapa.
    for (const auto &entity : level.entities)
    {
        if (!entity.boss || !Combat::IsActive(entity) || !player)
        {
            continue;
        }
        const Vector2 bossCenter = Movement::BoxCenter(entity);
        const float distance = std::hypot(bossCenter.x - player->precisePosition.x,
                                          bossCenter.y - player->precisePosition.y);
        if (distance <= Combat::kEnemyAggroRange || entity.health < entity.maxHealth)
        {
            hud.boss = &entity;
            break;
        }
    }
    CombatView::DrawHud(gfx, defaultFont, hud);
    if (shopNpc && player)
    {
        CombatView::DrawShop(gfx, defaultFont, level, *shopNpc, inventory, shopFeedback);
    }

    if (noticeRemaining > 0.0f)
    {
        noticeRemaining = std::max(0.0f, noticeRemaining - deltaTime);
        gfx.DrawText(defaultFont, notice.c_str(), {10, 64}, 18, MAROON);
    }

    // --- Pantalla de paso de nivel --------------------------------------
    if (transition.active)
    {
        const float width = static_cast<float>(gfx.GetScreenWidth());
        const float height = static_cast<float>(gfx.GetScreenHeight());
        DrawRectangle(0, 0, static_cast<int>(width), static_cast<int>(height), Color{0, 0, 0, 210});
        DrawCentered(gfx, defaultFont, transition.title, width / 2.0f, height / 2.0f - 40.0f, 48.0f,
                     Color{255, 214, 102, 255});
        DrawCentered(gfx, defaultFont, transition.detail, width / 2.0f, height / 2.0f + 24.0f, 20.0f,
                     RAYWHITE);
        transition.remaining -= deltaTime;
    }

    // --- Pausa y fin de partida -----------------------------------------
    // Un velo sobre la escena quieta, con su menu. Lo elegido se hace
    // despues de cerrar el cuadro (ver abajo): puede cargar otro nivel.
    if (paused)
    {
        const int choice = Screens::RunOverlay(gfx, defaultFont, config.screens.pauseTitle,
                                               config.titleScreen.titleColor, Color{0, 0, 0, 160},
                                               config.titleScreen, pauseMenu);
        if (choice >= 0)
        {
            pendingMenuAction = pauseMenu.items[static_cast<size_t>(choice)];
        }
    }
    else if (gameOver)
    {
        const int choice = Screens::RunOverlay(gfx, defaultFont, config.screens.gameOverTitle,
                                               config.screens.gameOverColor, Color{20, 0, 0, 185},
                                               config.titleScreen, gameOverMenu);
        if (choice >= 0)
        {
            pendingMenuAction = gameOverMenu.items[static_cast<size_t>(choice)];
        }
    }

    // --- Herramientas de administrador (solo Debug) ----------------------
    // Al final, para quedar encima de todo, pantalla de paso incluida.
    if constexpr (DevTools::kEnabled)
    {
        DevTools::RecordFrame(dev, static_cast<float>((GetTime() - frameStart) * 1000.0));
        if (dev.panel)
        {
            const ZSortSystem::Stats &drawn = zsort.LastStats();
            DevTools::Report report;
            report.fps = GetFPS();
            report.ground = drawn.ground;
            report.sorted = drawn.sorted;
            report.culled = drawn.culled;
            report.cullMarginTiles = level.cullMarginTiles;
            report.entities = static_cast<int>(level.entities.size());
            report.activeEntities = static_cast<int>(std::count_if(
                level.entities.begin(), level.entities.end(),
                [](const LevelEntity &entity) { return !entity.destroyed && !entity.hidden; }));
            report.collisions = static_cast<int>(currentCollisions.size());
            report.hasPlayer = player != nullptr;
            report.playerCell = player ? player->precisePosition : Vector2{0, 0};
            report.zoom = camera.GetCamera().zoom;
            report.levelFile = currentLevelPath.filename().string();
            report.showGrid = showGrid;
            report.showHitboxes = showHitboxes;
            DevTools::DrawPanel(gfx, defaultFont, dev, report);
        }
        else
        {
            DevTools::DrawBadge(gfx, defaultFont);
        }
    }

    FinishFrame();

    // --- Lo que eligio el menu de pausa o de fin --------------------------
    if (!pendingMenuAction.empty())
    {
        const std::string action = pendingMenuAction;
        pendingMenuAction.clear();
        RunMenuAction(action);
    }

    // --- Carga del nivel siguiente ---------------------------------------
    // Despues de EndFrame y fuera de events.Update(): cambiar de nivel
    // reemplaza las entidades (y con ellas todos los punteros de este
    // frame) y la lista de eventos.
    if (transition.active && transition.remaining <= 0.0f)
    {
        try
        {
            level = loader.Load(transition.target.string(), events);
            currentLevelPath = transition.target;
            PrepareLevel(transition.restart ? LevelStart::Restart : LevelStart::Carry);
        }
        catch (const std::exception &error)
        {
            // Un nivel siguiente que no existe o esta roto no cierra el
            // juego: se sigue en el nivel actual y se avisa en pantalla.
            std::cerr << "No se pudo cargar " << transition.target.string() << ": " << error.what()
                      << std::endl;
            notice = "No se pudo cargar " + transition.target.filename().string();
            noticeRemaining = kNoticeSeconds;
        }
        currentCollisions.clear();
        transition = Transition{};
    }
}
