#pragma once

// =============================================================================
// La vida del jugador en el HUD, con el estilo de game.json
// =============================================================================
//
// Cuatro estilos -- barra (la de siempre), corazones, segmentos o solo el
// numero --, en cualquier esquina, a cualquier tamaño, con sus colores, y con
// imagenes propias si el juego las trae: corazon lleno y vacio, o el relleno y
// el marco de la barra. Sin game.json se ve exactamente como antes.
// =============================================================================

#include "raylib.h"

#include "core/GraphicsDevice.hpp"
#include "game/GameConfig.hpp"

namespace HealthHud {

// Las imagenes propias ya cargadas (nullptr = no hay).
struct Images {
    const Texture2D* heartFull = nullptr;
    const Texture2D* heartEmpty = nullptr;
    const Texture2D* barFill = nullptr;
    const Texture2D* barFrame = nullptr;
};

// Dibuja la vida y devuelve el rectangulo que ocupo, para acomodar lo que va
// debajo. "bottomReserve" es el alto que hay que dejar libre abajo (la linea
// de ayuda de teclas) si va en una esquina de abajo.
Rectangle Draw(GraphicsDevice& gfx, const Font& font, const HudConfig& config, const Images& images, float health,
               float maxHealth, Color text, float bottomReserve);

}  // namespace HealthHud
