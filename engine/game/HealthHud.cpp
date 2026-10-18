// Implementacion de HealthHud. Los estilos, en el .hpp.
//
// Cada estilo primero MIDE lo que va a ocupar y recien despues dibuja: asi se
// puede apoyar en cualquier esquina. Con los valores por defecto (barra, escala
// 1, arriba a la izquierda) cae justo donde se dibujaba antes de existir esto:
// "Vida" en (10, 10), la barra de 160x14 en (60, 13) y el numero en (230, 10).

#include "HealthHud.hpp"

#include <algorithm>
#include <cmath>
#include <string>

namespace HealthHud {

namespace {

constexpr float kMargin = 10.0f;
constexpr float kLetterSpacing = 1.0f;  // el de GraphicsDevice::DrawText

bool Usable(const Texture2D* texture) {
    return texture && texture->id != 0 && texture->width > 0 && texture->height > 0;
}

void DrawImage(GraphicsDevice& gfx, const Texture2D& texture, Rectangle dest, Color tint = WHITE) {
    gfx.DrawSprite(texture, Rectangle{0, 0, static_cast<float>(texture.width), static_cast<float>(texture.height)},
                   dest, Vector2{0, 0}, 0.0f, tint);
}

// Un corazon dibujado: dos circulos y un triangulo, dentro de un cuadrado de lado "size".
void DrawHeartShape(Rectangle box, Color color) {
    const float d = box.width;
    const float cx = box.x + d / 2.0f;
    const float cy = box.y + d / 2.0f;
    const float radius = d * 0.27f;
    DrawCircleV(Vector2{cx - d * 0.22f, cy - d * 0.1f}, radius, color);
    DrawCircleV(Vector2{cx + d * 0.22f, cy - d * 0.1f}, radius, color);
    const Vector2 left{cx - d * 0.48f, cy - d * 0.02f};
    const Vector2 right{cx + d * 0.48f, cy - d * 0.02f};
    const Vector2 bottom{cx, cy + d * 0.44f};
    // raylib solo pinta los triangulos en un sentido de giro: se mandan los dos.
    DrawTriangle(left, bottom, right, color);
    DrawTriangle(left, right, bottom, color);
}

// Un corazon lleno en "fraction" (0 a 1), de izquierda a derecha.
void DrawHeart(GraphicsDevice& gfx, const HudConfig& config, const Images& images, Rectangle box, float fraction) {
    const bool full = Usable(images.heartFull);
    const bool empty = Usable(images.heartEmpty);
    // Vacio: la imagen vacia, o la llena apagada, o el dibujo en el color vacio.
    if (empty) {
        DrawImage(gfx, *images.heartEmpty, box);
    } else if (full) {
        DrawImage(gfx, *images.heartFull, box, Color{70, 70, 70, 170});
    } else {
        DrawHeartShape(box, config.healthEmpty);
    }
    if (fraction <= 0.0f) {
        return;
    }
    // Lleno: recortado al ancho que le toca, para los corazones a medias.
    BeginScissorMode(static_cast<int>(box.x), static_cast<int>(box.y),
                     static_cast<int>(std::ceil(box.width * fraction)), static_cast<int>(box.height) + 1);
    if (full) {
        DrawImage(gfx, *images.heartFull, box);
    } else {
        DrawHeartShape(box, config.healthFill);
    }
    EndScissorMode();
}

}  // namespace

Rectangle Draw(GraphicsDevice& gfx, const Font& font, const HudConfig& config, const Images& images, float health,
               float maxHealth, Color text, float bottomReserve) {
    const float s = config.healthScale;
    const float ratio = maxHealth > 0.0f ? std::clamp(health / maxHealth, 0.0f, 1.0f) : 0.0f;
    const float textSize = 20.0f * s;
    const std::string label = "Vida";
    const std::string number =
        std::to_string(static_cast<int>(std::ceil(std::max(0.0f, health)))) + " / " +
        std::to_string(static_cast<int>(maxHealth));
    const float labelWidth = config.showHealthLabel ? 50.0f * s : 0.0f;
    const float numberWidth = config.showHealthNumber ? MeasureTextEx(font, number.c_str(), textSize, kLetterSpacing).x : 0.0f;

    // --- Medir ---
    const float barWidth = 160.0f * s;
    const float barHeight = 14.0f * s;
    const float heartSize = 22.0f * s;
    const float heartGap = 4.0f * s;
    const int hearts = std::clamp(static_cast<int>(std::ceil(maxHealth / config.healthPerHeart)), 1, 20);
    float bodyWidth = 0.0f;
    float height = textSize;
    switch (config.healthStyle) {
    case HealthStyle::Hearts:
        bodyWidth = hearts * heartSize + (hearts - 1) * heartGap;
        height = std::max(textSize, heartSize);
        break;
    case HealthStyle::Number:
        bodyWidth = 0.0f;
        break;
    case HealthStyle::Bar:
    case HealthStyle::Segments:
    default:
        bodyWidth = barWidth;
        break;
    }
    const float numberGap = config.showHealthNumber && bodyWidth > 0.0f ? 10.0f * s : 0.0f;
    const float width = labelWidth + bodyWidth + numberGap + numberWidth;

    // --- Ubicar segun la esquina ---
    const float screenWidth = static_cast<float>(gfx.GetScreenWidth());
    const float screenHeight = static_cast<float>(gfx.GetScreenHeight());
    const bool right = config.healthCorner == HudCorner::TopRight || config.healthCorner == HudCorner::BottomRight;
    const bool bottom = config.healthCorner == HudCorner::BottomLeft || config.healthCorner == HudCorner::BottomRight;
    const float x = right ? screenWidth - width - kMargin : kMargin;
    const float y = bottom ? screenHeight - height - kMargin - bottomReserve : kMargin;

    // --- Dibujar ---
    if (config.showHealthLabel) {
        gfx.DrawText(font, label.c_str(), Vector2{x, y + (height - textSize) / 2.0f}, textSize, text);
    }
    const float bodyX = x + labelWidth;
    const float middle = y + height / 2.0f;
    const bool border = config.healthBorder.a > 0;

    switch (config.healthStyle) {
    case HealthStyle::Hearts: {
        for (int i = 0; i < hearts; ++i) {
            const float fraction = std::clamp((health - i * config.healthPerHeart) / config.healthPerHeart, 0.0f, 1.0f);
            DrawHeart(gfx, config, images,
                      Rectangle{bodyX + i * (heartSize + heartGap), middle - heartSize / 2.0f, heartSize, heartSize},
                      fraction);
        }
        break;
    }
    case HealthStyle::Segments: {
        const int segments = config.segments;
        const float gap = 2.0f * s;
        const float segmentWidth = (barWidth - gap * (segments - 1)) / segments;
        const int lit = health > 0.0f ? static_cast<int>(std::ceil(ratio * segments)) : 0;
        for (int i = 0; i < segments; ++i) {
            const Rectangle box{bodyX + i * (segmentWidth + gap), middle - barHeight / 2.0f, segmentWidth, barHeight};
            DrawRectangleRec(box, i < lit ? config.healthFill : config.healthEmpty);
            if (border) {
                DrawRectangleLinesEx(box, std::max(1.0f, s), config.healthBorder);
            }
        }
        break;
    }
    case HealthStyle::Number:
        break;
    case HealthStyle::Bar:
    default: {
        // La barra de siempre: fondo oscuro y relleno proporcional. Con imagen
        // de relleno, la imagen recortada al ancho que toca; con marco, el
        // marco estirado encima de la barra.
        const Rectangle box{bodyX, middle - barHeight / 2.0f, barWidth, barHeight};
        DrawRectangleRec(box, config.healthEmpty);
        if (Usable(images.barFill)) {
            const Texture2D& fill = *images.barFill;
            gfx.DrawSprite(fill, Rectangle{0, 0, fill.width * ratio, static_cast<float>(fill.height)},
                           Rectangle{box.x, box.y, box.width * ratio, box.height}, Vector2{0, 0}, 0.0f, WHITE);
        } else {
            DrawRectangle(static_cast<int>(box.x), static_cast<int>(box.y), static_cast<int>(box.width * ratio),
                          static_cast<int>(box.height), config.healthFill);
        }
        if (Usable(images.barFrame)) {
            DrawImage(gfx, *images.barFrame, box);
        } else if (border) {
            DrawRectangleLinesEx(box, std::max(1.0f, s), config.healthBorder);
        }
        break;
    }
    }

    if (config.showHealthNumber) {
        // Solo numero: el numero va en el color de la vida, para que se lea como tal.
        const Color color = config.healthStyle == HealthStyle::Number ? config.healthFill : text;
        gfx.DrawText(font, number.c_str(), Vector2{bodyX + bodyWidth + numberGap, y + (height - textSize) / 2.0f},
                     textSize, color);
    }
    return Rectangle{x, y, width, height};
}

}  // namespace HealthHud
