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
#include <iostream>

#include "game/CombatView.hpp"
#include "game/Movement.hpp"
#include "game/Zones.hpp"

namespace {

// Cuanto dura la pantalla entre un nivel y el siguiente. Lo justo para leer el
// mensaje; mas largo se siente como una carga lenta.
constexpr float kTransitionSeconds = 2.0f;
// Cuanto se ve un aviso de error (por ejemplo, un nivel siguiente que no existe).
constexpr float kNoticeSeconds = 4.0f;

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
GameSession::GameSession(const std::filesystem::path &levelPath)
    : gfx(800, 450, "HoneyComb Engine - Runtime"),
      assets((levelPath.parent_path().parent_path() / "assets").string()),
      loader(resources, assets),
      // Load() concentra todo el trabajo de Capa 3: parsea el JSON, construye
      // la grilla con las medidas del nivel, resuelve y carga las texturas, y
      // deja los eventos del nivel ya cargados dentro de "events".
      level(loader.Load(levelPath.string(), events)),
      currentLevelPath(levelPath),
      zsort(gfx)
{
    PrepareLevel(LevelStart::Fresh);
    BindInput();
    RegisterEvents();
    defaultFont = GetFontDefault();
    gfx.SetTargetFPS(60);
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
        flags.clear();
        for (auto &entity : level.entities)
        {
            entityById[entity.id] = &entity;
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

        std::cout << "Nivel cargado: " << level.name
                  << " (" << level.entities.size() << " entidades)" << std::endl;
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

void GameSession::Run()
{
    while (!gfx.ShouldClose())
    {
        Update(gfx.GetDeltaTime());
    }
    // Sin limpieza manual: ResourceManager y GraphicsDevice liberan todo en sus
    // destructores (RAII), en orden inverso al de declaracion en el header.
}

// =============================================================================
// UN FRAME
//
// Orden de cada frame. NO es arbitrario:
//   1. teclas de depuracion (F1 grilla / F2 hitboxes / F11 pantalla completa)
//   2. encuadre de camara (se recalcula: la ventana es redimensionable)
//   3. si no se esta pasando de nivel: movimiento del jugador y combate
//   4. encolar en el ZSortSystem: piso -> paredes -> entidades
//   5. Flush del ZSort (ordena por profundidad y recien ahi dibuja)
//   6. overlays: grilla (F1), hitboxes (F2), golpe, barras de vida, HUD
//   7. resolver colisiones -> correr eventos -> actualizar audio
//   8. pantalla de paso de nivel, y la carga cuando termina
// =============================================================================
void GameSession::Update(float deltaTime)
{
        if (IsKeyPressed(KEY_F1))
    {
        showGrid = !showGrid;
    }
    if (IsKeyPressed(KEY_F2))
    {
        showHitboxes = !showHitboxes;
    }
    if (IsKeyPressed(KEY_F11))
    {
        ToggleFullscreen();
    }

    // --- Encuadre: centrar el rombo del nivel en la ventana -------------
    // Proyectado, el nivel completo mide (ancho + alto - 2) * tileHeight/2
    // de alto; se le resta la mitad de eso al centro vertical para que la
    // grilla quede centrada. Se recalcula cada frame porque la ventana se
    // puede redimensionar en cualquier momento.
    float levelOriginY = gfx.GetScreenHeight() / 2.0f -
                         (level.grid.GetGridWidth() + level.grid.GetGridHeight() - 2) *
                             level.grid.GetTileHeight() / 4.0f;
    // Atajo local: proyeccion isometrica + offset de camara en un solo paso.
    // El editor hace exactamente lo mismo en App.origin() (app.ts), y ese
    // paralelismo es lo que garantiza que lo que se ve en el canvas del
    // editor coincida con lo que termina dibujando el runtime.
    auto gridToScreen = [&](Vector2 gridPosition)
    {
        Vector2 screenPosition = level.grid.GridToScreen(gridPosition);
        screenPosition.x += gfx.GetScreenWidth() / 2.0f;
        screenPosition.y += levelOriginY;
        return screenPosition;
    };

    // --- Apuntar ----------------------------------------------------------
    // El mouse apunta a un LUGAR del mapa, no a una casilla: su posicion en
    // pantalla se lleva a celdas continuas con la inversa de gridToScreen.
    const Vector2 mouse = input.GetMousePosition();
    const Vector2 aim = level.grid.ScreenToGridContinuous(
        Vector2{mouse.x - gfx.GetScreenWidth() / 2.0f, mouse.y - levelOriginY});

    // --- Jugador, combate y objetos --------------------------------------
    // Con la pantalla de paso de nivel en marcha el juego queda congelado:
    // ni el jugador ni los enemigos se mueven, y nadie pega. Con una tienda
    // abierta tambien, y ahi las teclas 1-9 compran en vez de elegir arma.
    prompt.clear();
    abilitiesUsedThisFrame.clear();
    const bool playerAlive = player && !player->destroyed;
    const bool interactPressed = input.IsActionPressed("interact");
    if (!transition.active && shopNpc)
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
    else if (!transition.active)
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
        intent.invulnerable = Mobility::IsInvulnerable(mobility);
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
        if (combat.playerDefeated)
        {
            BeginTransition(currentLevelPath, "Derrotado", true);
        }
    }
    messageRemaining = std::max(0.0f, messageRemaining - deltaTime);

    // Fondo elegido en el editor. El texto del HUD cambia a claro sobre un
    // fondo oscuro, porque el gris oscuro de siempre ahi no se leeria.
    const Color background = level.backgroundColor;
    const bool darkBackground =
        0.299f * background.r + 0.587f * background.g + 0.114f * background.b < 128.0f;
    const Color hudText = darkBackground ? LIGHTGRAY : DARKGRAY;
    gfx.BeginFrame(background);

    // --- Piso (SpriteLayer::Ground) --------------------------------------
    // Nada se dibuja directo: todo se ENCOLA en el ZSortSystem, que al final
    // ordena por profundidad y recien ahi dibuja. Por eso un personaje puede
    // quedar tapado por una pared que se encolo antes que el.
    //
    // El piso es la excepcion: el ZSortSystem lo saca del orden por
    // profundidad y lo dibuja entero primero, asi nunca tapa a nadie.
    for (const auto& floorTile : level.floorTiles)
    {
        Vector2 screenPos = gridToScreen(
            Vector2{static_cast<float>(floorTile.col), static_cast<float>(floorTile.row)});

        if (level.floorTexture)
        {
            zsort.Submit(SpriteInstance{
                level.floorTexture,
                level.floorSourceRect,

                // posición visual: la textura se centra sobre el rombo
                Vector2{
                    screenPos.x - level.floorSourceRect.width / 2.0f,
                    screenPos.y - level.floorSourceRect.height / 2.0f},

                // posición para Z-sort: el centro de la celda, que es el
                // punto de apoyo real. Va separado de la posicion visual
                // justamente para que el offset de arriba no altere el
                // orden de profundidad.
                screenPos,

                Vector2{0, 0},
                0.0f,
                WHITE,
                SpriteLayer::Ground});
        }
    }

    // --- Paredes (SpriteLayer::Object) -----------------------------------
    // Se generan desde las celdas de pared del nivel, no desde el array de
    // entidades. Mismo recorrido de celdas que usa Movement para frenar.
    if (level.wallTexture)
    {
        for (const auto& wallTile : level.wallTiles)
        {
            Vector2 screenPos = gridToScreen(
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
            animIt->second.Update(deltaTime);
            sourceRect = animIt->second.GetCurrentFrame();
        }

        // Una entidad de span N ocupa NxN celdas a partir de su celda y se
        // apoya en el CENTRO de ese bloque. El tamano de dibujo combina las
        // celdas que ocupa (span) con la escala configurada (scale).
        const float spanScale = static_cast<float>(entity.span) * entity.scale;
        const Vector2 sortPosition = gridToScreen(Movement::BoxCenter(entity));

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
                Vector2{sortPosition.x, drawPosition.y - 8.0f},
                entity.health / entity.maxHealth,
                &entity == player});
        }
    }

    // Objetos tirados en el piso: sprites como los demas, ordenados con ellos.
    CombatView::SubmitGroundItems(zsort, loot, gridToScreen, static_cast<float>(GetTime()));

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
                Vector2 screenPos = gridToScreen(
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
                DrawLineEx(gridToScreen(cells[i]), gridToScreen(cells[(i + 1) % cells.size()]),
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
                const Vector2 anchor = gridToScreen(center);
                DrawRectangleLinesEx(
                    Rectangle{anchor.x, anchor.y, entity.colliderSize.x, entity.colliderSize.y},
                    thickness, sensorColor);
            }
        }
    }

    // --- Golpes, areas y proyectiles --------------------------------------
    // Encima de la escena: son la lectura del combate y no deben quedar
    // tapados por una pared.
    CombatView::DrawEffects(combatState, gridToScreen);
    CombatView::DrawProjectiles(combatState, gridToScreen);

    // --- Barras de vida sobre las cabezas --------------------------------
    for (const auto &bar : healthBars)
    {
        DrawHealthBar(bar.topCenter.x - 16.0f, bar.topCenter.y, 32.0f, 4.0f, bar.ratio,
                      bar.isPlayer ? Color{90, 200, 90, 255} : Color{220, 70, 70, 255});
    }

    // --- Cierre del frame -----------------------------------------------
    // Flush() devuelve los pares que se solapan y vacia la cola; hay que
    // llamarlo SIEMPRE, aunque el juego este congelado, o la cola crece.
    // Con la pantalla de paso activa los eventos no corren: el nivel ya
    // termino, y un evento mas podria pedir otro cambio encima.
    currentCollisions = collision.Flush();
    if (!transition.active)
    {
        events.Update();
    }
    audio.Update();  // raylib necesita esto continuo para musica en streaming

    // --- HUD --------------------------------------------------------------
    if (player)
    {
        gfx.DrawText(defaultFont, "Vida", {10, 10}, 20, hudText);
        DrawHealthBar(60.0f, 13.0f, 160.0f, 14.0f, player->health / player->maxHealth,
                      Color{90, 200, 90, 255});
        const std::string lifeText = std::to_string(static_cast<int>(std::ceil(player->health))) +
                                     " / " + std::to_string(static_cast<int>(player->maxHealth));
        gfx.DrawText(defaultFont, lifeText.c_str(), {230, 10}, 20, hudText);
    }
    gfx.DrawText(defaultFont,
                 "WASD mover | Clic/Espacio atacar | Q habilidad | Shift esquivar | "
                 "Clic der./K defender | 1-9 armas | E usar",
                 {10, static_cast<float>(gfx.GetScreenHeight() - 22)}, 14, hudText);

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

    gfx.EndFrame();

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
