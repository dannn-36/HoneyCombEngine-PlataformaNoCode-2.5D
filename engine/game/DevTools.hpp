#pragma once

// =============================================================================
// Herramientas de administrador del runtime (panel F3)
// =============================================================================
//
// Existen SOLO en la compilacion Debug, la version de desarrollo: CMake define
// HONEYCOMB_DEV_TOOLS en Debug y no en Release (ver CMakeLists.txt). La
// Release es la que se juega: optimizada y sin nada de esto. En vez de llenar
// GameSession de #ifdef se pregunta por kEnabled, que es constexpr: en Release
// el compilador borra esas ramas enteras.
//
// Teclas, con el panel abierto o cerrado:
//   F3  panel con FPS, tiempo por cuadro, sprites y estado del nivel
//   F1  grilla              F2  hitboxes
//   F4  ver el recorte de la camara (lo achica para que se vea trabajar)
//   F6  sin tope de FPS: para medir cuanto margen hay de verdad
//   F7  invencible          F8  recargar el nivel desde el disco
//
// Los textos van sin acentos: la fuente por defecto de raylib no los tiene
// todos, igual que el resto del HUD.
// =============================================================================

#include <string>

#include "raylib.h"

#include "core/GraphicsDevice.hpp"

namespace DevTools {

#ifdef HONEYCOMB_DEV_TOOLS
inline constexpr bool kEnabled = true;
#else
inline constexpr bool kEnabled = false;
#endif

// "HoneyComb 0.1.0 | Debug": la version y el tipo de compilacion, de CMake.
std::string VersionLabel();

struct State {
    bool panel = false;        // F3
    bool showCulling = false;  // F4
    bool uncapped = false;     // F6
    bool godMode = false;      // F7
    float workMs = 0.0f;       // tiempo de un cuadro sin contar la espera del tope, suavizado
};

// Lo que GameSession tiene que hacer despues de leer las teclas.
struct Requests {
    bool reloadLevel = false;    // F8
    bool fpsCapChanged = false;  // F6: hay que volver a fijar el tope
};

// Lee F3, F4, F6, F7 y F8. F1 y F2 los sigue leyendo GameSession, que es quien
// dibuja la grilla y las hitboxes.
Requests HandleKeys(State& state);

// Mezcla el tiempo de este cuadro con los anteriores, para que el numero no
// salte de un cuadro a otro y se pueda leer.
void RecordFrame(State& state, float workMs);

// Con F4, el limite del recorte: la vista de verdad achicada un octavo por
// lado, para que quede en pantalla y se vea lo que desaparece al cruzarlo.
Rectangle PreviewView(Rectangle view);

// Lo que muestra el panel. Lo arma GameSession, que es quien tiene los datos.
struct Report {
    int fps = 0;
    int ground = 0;    // piso dibujado (sin ordenar)
    int sorted = 0;    // paredes y entidades dibujadas (ordenadas)
    int culled = 0;    // fuera de la camara y de su margen
    float cullMarginTiles = 0.0f;
    int entities = 0;
    int activeEntities = 0;
    int collisions = 0;
    bool hasPlayer = false;
    Vector2 playerCell{0, 0};
    float zoom = 1.0f;
    std::string levelFile;
    bool showGrid = false;
    bool showHitboxes = false;
};

void DrawPanel(GraphicsDevice& gfx, const Font& font, const State& state, const Report& report);

// Con el panel cerrado, una marca chica arriba a la derecha: deja claro que
// esta es la version de desarrollo y como abrir el panel.
void DrawBadge(GraphicsDevice& gfx, const Font& font);

}  // namespace DevTools
