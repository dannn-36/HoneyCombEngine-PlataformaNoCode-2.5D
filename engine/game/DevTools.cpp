// Implementacion de DevTools. Que es y por que solo existe en Debug esta en el .hpp.

#include "DevTools.hpp"

#include <algorithm>
#include <cstdio>
#include <vector>

// Los define CMake (target_compile_definitions). Los valores de respaldo son
// para quien compile este archivo por fuera de CMake.
#ifndef HONEYCOMB_VERSION
#define HONEYCOMB_VERSION "0.0.0"
#endif
#ifndef HONEYCOMB_BUILD_TYPE
#define HONEYCOMB_BUILD_TYPE "?"
#endif

namespace DevTools {

namespace {

// Chico a proposito: la ventana arranca en 800 px y el panel no puede tapar la
// barra de vida del HUD, que esta arriba a la izquierda.
constexpr float kFontSize = 14.0f;
constexpr float kLineHeight = 17.0f;
constexpr float kPadding = 8.0f;
constexpr float kMargin = 10.0f;

std::string OnOff(bool value) {
    return value ? "SI" : "no";
}

// printf a std::string: el panel arma una linea por dato y casi todas llevan numeros.
template <typename... Args>
std::string Format(const char* pattern, Args... args) {
    char buffer[256];
    std::snprintf(buffer, sizeof(buffer), pattern, args...);
    return buffer;
}

// Un recuadro oscuro arriba a la derecha con una linea de texto por elemento.
void DrawBox(GraphicsDevice& gfx, const Font& font, const std::vector<std::string>& lines, Color text) {
    float width = 0.0f;
    for (const auto& line : lines) {
        width = std::max(width, MeasureTextEx(font, line.c_str(), kFontSize, kFontSize / 10.0f).x);
    }
    const float boxWidth = width + 2.0f * kPadding;
    const float boxHeight = static_cast<float>(lines.size()) * kLineHeight + 2.0f * kPadding;
    const float x = static_cast<float>(gfx.GetScreenWidth()) - boxWidth - kMargin;
    const float y = kMargin;
    DrawRectangle(static_cast<int>(x), static_cast<int>(y), static_cast<int>(boxWidth),
                  static_cast<int>(boxHeight), Color{12, 12, 12, 215});
    DrawRectangleLines(static_cast<int>(x), static_cast<int>(y), static_cast<int>(boxWidth),
                       static_cast<int>(boxHeight), Color{242, 179, 61, 255});
    for (size_t i = 0; i < lines.size(); ++i) {
        gfx.DrawText(font, lines[i].c_str(),
                     Vector2{x + kPadding, y + kPadding + static_cast<float>(i) * kLineHeight}, kFontSize,
                     i == 0 ? Color{242, 179, 61, 255} : text);
    }
}

}  // namespace

std::string VersionLabel() {
    return std::string("HoneyComb ") + HONEYCOMB_VERSION + " | " + HONEYCOMB_BUILD_TYPE;
}

Requests HandleKeys(State& state) {
    Requests requests;
    if (IsKeyPressed(KEY_F3)) {
        state.panel = !state.panel;
    }
    if (IsKeyPressed(KEY_F4)) {
        state.showCulling = !state.showCulling;
    }
    if (IsKeyPressed(KEY_F6)) {
        state.uncapped = !state.uncapped;
        requests.fpsCapChanged = true;
    }
    if (IsKeyPressed(KEY_F7)) {
        state.godMode = !state.godMode;
    }
    if (IsKeyPressed(KEY_F8)) {
        requests.reloadLevel = true;
    }
    return requests;
}

void RecordFrame(State& state, float workMs) {
    // Media movil exponencial: cada cuadro pesa un 10 %, asi un pico aislado
    // se nota sin que el numero tiemble.
    state.workMs = state.workMs <= 0.0f ? workMs : state.workMs * 0.9f + workMs * 0.1f;
}

Rectangle PreviewView(Rectangle view) {
    return Rectangle{view.x + view.width / 8.0f, view.y + view.height / 8.0f, view.width * 0.75f,
                     view.height * 0.75f};
}

void DrawPanel(GraphicsDevice& gfx, const Font& font, const State& state, const Report& report) {
    std::vector<std::string> lines;
    lines.push_back(VersionLabel() + " (desarrollo, sin optimizar)");
    lines.push_back(Format("FPS %d (%s)   cuadro %.2f ms", report.fps,
                           state.uncapped ? "sin tope" : "tope 60", state.workMs));
    lines.push_back(Format("Sprites %d dibujados, %d recortados", report.ground + report.sorted,
                           report.culled));
    lines.push_back(Format("  recorte: la ventana + %.0f casillas por lado", report.cullMarginTiles));
    lines.push_back(Format("  piso %d sin ordenar | %d ordenados", report.ground, report.sorted));
    lines.push_back(Format("Entidades %d (%d activas)   colisiones %d", report.entities,
                           report.activeEntities, report.collisions));
    if (report.hasPlayer) {
        lines.push_back(Format("Jugador en %.1f, %.1f   zoom %.2f", report.playerCell.x,
                               report.playerCell.y, report.zoom));
    } else {
        lines.push_back(Format("Sin jugador (player_1)   zoom %.2f", report.zoom));
    }
    lines.push_back("Nivel " + report.levelFile);
    lines.push_back("");
    lines.push_back("F1 grilla " + OnOff(report.showGrid) + "  F2 hitboxes " + OnOff(report.showHitboxes) +
                    "  F4 recorte " + OnOff(state.showCulling));
    lines.push_back("F6 sin tope " + OnOff(state.uncapped) + "  F7 invencible " + OnOff(state.godMode));
    lines.push_back("F8 recargar nivel   F3 cerrar");
    DrawBox(gfx, font, lines, RAYWHITE);
}

void DrawBadge(GraphicsDevice& gfx, const Font& font) {
    DrawBox(gfx, font, {VersionLabel() + "  -  F3 herramientas"}, RAYWHITE);
}

}  // namespace DevTools
