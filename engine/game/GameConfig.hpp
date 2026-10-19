#pragma once

// =============================================================================
// Configuracion del juego (game.json)
// =============================================================================
//
// Lo que es del JUEGO y no de un nivel: el nombre y la ventana, el nivel con
// que empieza, la portada, las pantallas de pausa, fin y creditos, el estilo
// del HUD y las variables de la partida con su valor inicial. Lo arma el
// editor (Archivo › Configuración del juego…) y vive en la raiz del proyecto,
// junto a levels/ y assets/: <raiz>/game.json (ver schema/game.schema.json).
//
// Sin game.json todo queda como era antes de que existiera: ventana de
// 800x450, el nivel que se abre, y el HUD de siempre.
// =============================================================================

#include <filesystem>
#include <string>
#include <unordered_map>
#include <vector>

#include "raylib.h"

#include "world/Level.hpp"

enum class TitleStyle {
    Centered,  // titulo y menu centrados
    Side,      // todo a la izquierda, sobre una franja oscura (estilo RPG)
    Minimal,   // titulo al medio y el menu en una fila abajo
};

enum class HealthStyle { Bar, Hearts, Segments, Number };

enum class HudCorner { TopLeft, TopRight, BottomLeft, BottomRight };

struct TitleScreenConfig {
    TitleStyle style = TitleStyle::Centered;
    std::string title;  // vacio = el nombre del juego
    std::string subtitle;
    Color titleColor{255, 214, 102, 255};
    Color subtitleColor{230, 230, 230, 255};
    float titleSize = 56.0f;
    float subtitleSize = 22.0f;
    Color backgroundColor{24, 24, 32, 255};
    std::string backgroundImage;  // ruta relativa a assets/
    BackgroundFit backgroundFit = BackgroundFit::Cover;
    Color buttonColor{220, 220, 220, 255};
    Color buttonHighlight{255, 214, 102, 255};
    std::string music;  // ruta relativa a assets/
    float musicVolume = 1.0f;  // "musicVolume" 0 a 100 en game.json, ya en 0..1
};

struct HudConfig {
    HealthStyle healthStyle = HealthStyle::Bar;
    HudCorner healthCorner = HudCorner::TopLeft;
    float healthScale = 1.0f;
    Color healthFill{90, 200, 90, 255};
    Color healthEmpty{30, 30, 30, 200};
    Color healthBorder{0, 0, 0, 0};  // alfa 0 = sin borde
    bool showHealthLabel = true;     // "Vida"
    bool showHealthNumber = true;    // "70 / 100"
    float healthPerHeart = 20.0f;
    int segments = 10;
    // Imagenes propias (rutas relativas a assets/). Vacias = dibujo de siempre.
    std::string heartFull;
    std::string heartEmpty;
    std::string barFill;
    std::string barFrame;
    bool showCoins = true;
    bool showInventory = true;
    bool showControls = true;
    bool showBossBar = true;
    bool showOverheadBars = true;
};

struct ScreensConfig {
    std::string pauseTitle = "Pausa";
    std::string gameOverTitle = "Derrotado";
    Color gameOverColor{230, 70, 70, 255};
    // Una linea por renglon; las que empiezan con "# " son titulos de seccion.
    std::vector<std::string> credits;
};

struct GameConfig {
    bool present = false;  // habia game.json
    std::string name;
    std::string icon;  // ruta relativa a assets/
    int width = 800;
    int height = 450;
    bool fullscreen = false;
    std::string startLevel;  // archivo en levels/; vacio = el que se abre
    TitleScreenConfig titleScreen;
    HudConfig hud;
    ScreensConfig screens;
    // Variables de la partida y su valor al empezar una nueva.
    std::unordered_map<std::string, float> variables;
};

// Lee <raiz>/game.json. Sin archivo, o con uno roto, devuelve los valores de
// siempre (y avisa por consola del roto): un game.json mal escrito no tiene
// que impedir jugar.
GameConfig LoadGameConfig(const std::filesystem::path& projectRoot);

// El titulo de la ventana: el nombre del juego, o el de siempre sin game.json.
std::string WindowTitle(const GameConfig& config, bool debugBuild);
