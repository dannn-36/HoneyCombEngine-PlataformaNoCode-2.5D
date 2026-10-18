#pragma once

// =============================================================================
// Pantallas fuera del nivel: portada, creditos, pausa y fin de partida
// =============================================================================
//
// Todas se arman con lo que dice game.json (ver GameConfig): el estilo de la
// portada, sus colores, su fondo, los textos. Son de modo inmediato, como el
// resto del dibujo de raylib: cada funcion dibuja y lee la entrada del cuadro,
// y devuelve que eligio el jugador. Que hacer con eso lo decide GameSession.
// =============================================================================

#include <string>
#include <vector>

#include "raylib.h"

#include "core/GraphicsDevice.hpp"
#include "game/GameConfig.hpp"

namespace Screens {

// Las opciones de un menu y cual esta resaltada.
struct Menu {
    std::vector<std::string> items;
    int selected = 0;
};

struct MenuStyle {
    Vector2 anchor{0, 0};  // en columna: el centro (o el borde izquierdo) de la primera opcion; en fila: el centro
    bool row = false;
    bool leftAligned = false;
    float size = 26.0f;
    float spacing = 42.0f;  // alto de cada renglon, o espacio entre opciones en fila
    Color normal{220, 220, 220, 255};
    Color highlight{255, 214, 102, 255};
};

// Dibuja el menu y lee la entrada de este cuadro: flechas o WASD mueven,
// Enter, Espacio o clic eligen, y el mouse resalta lo que tiene encima.
// Devuelve el indice elegido, o -1 si todavia no se eligio nada.
int RunMenu(GraphicsDevice& gfx, const Font& font, Menu& menu, const MenuStyle& style);

// Una imagen llenando la pantalla: cubrir, estirar o mosaico. Una textura que
// no se pudo cargar no dibuja nada.
void DrawFillImage(GraphicsDevice& gfx, const Texture2D* texture, BackgroundFit fit, Vector2 screen);

// La portada, segun su estilo. El fondo de color lo pone quien llama, en
// BeginFrame. Devuelve la opcion elegida, o -1.
int RunTitle(GraphicsDevice& gfx, const Font& font, const TitleScreenConfig& config, const std::string& title,
             const Texture2D* background, Menu& menu);

// Los creditos subiendo sobre el fondo de la portada. Devuelve true cuando el
// jugador pide volver (Esc, Enter o clic).
bool RunCredits(GraphicsDevice& gfx, const Font& font, const TitleScreenConfig& config,
                const std::vector<std::string>& lines, const Texture2D* background, float elapsed);

// Pausa y fin de partida: un velo sobre la escena quieta, el titulo y el menu.
int RunOverlay(GraphicsDevice& gfx, const Font& font, const std::string& title, Color titleColor, Color veil,
               const TitleScreenConfig& colors, Menu& menu);

}  // namespace Screens
