// Implementacion de Screens. Que es cada pantalla, en el .hpp.

#include "Screens.hpp"

#include <algorithm>
#include <cmath>
#include <initializer_list>

namespace Screens {

namespace {

// GraphicsDevice::DrawText dibuja con 1 px de espacio entre letras: se mide igual.
constexpr float kLetterSpacing = 1.0f;

Vector2 Measure(const Font& font, const std::string& text, float size) {
    return MeasureTextEx(font, text.c_str(), size, kLetterSpacing);
}

// El tamaño mas grande hasta "size" con el que el texto entra en "maxWidth".
float FitSize(const Font& font, const std::string& text, float size, float maxWidth) {
    const float width = Measure(font, text, size).x;
    return width > maxWidth && width > 0.0f ? std::max(8.0f, size * maxWidth / width) : size;
}

// Con una sombra oscura corrida abajo a la derecha: los textos de estas
// pantallas van sobre la imagen que el juego elija, y sin sombra un texto
// amarillo sobre un sol amarillo desaparece.
void DrawTextAt(GraphicsDevice& gfx, const Font& font, const std::string& text, Vector2 position, float size,
                Color color) {
    const float offset = std::max(1.0f, size / 14.0f);
    gfx.DrawText(font, text.c_str(), Vector2{position.x + offset, position.y + offset}, size,
                 Color{0, 0, 0, static_cast<unsigned char>(color.a * 0.75f)});
    gfx.DrawText(font, text.c_str(), position, size, color);
}

void DrawCentered(GraphicsDevice& gfx, const Font& font, const std::string& text, float centerX, float y, float size,
                  Color color) {
    DrawTextAt(gfx, font, text, Vector2{centerX - Measure(font, text, size).x / 2.0f, y}, size, color);
}

bool Pressed(std::initializer_list<int> keys) {
    return std::any_of(keys.begin(), keys.end(), [](int key) { return IsKeyPressed(key); });
}

}  // namespace

int RunMenu(GraphicsDevice& gfx, const Font& font, Menu& menu, const MenuStyle& style) {
    const int count = static_cast<int>(menu.items.size());
    if (count == 0) {
        return -1;
    }
    menu.selected = std::clamp(menu.selected, 0, count - 1);

    // Donde cae cada opcion, para dibujarla y para el mouse.
    std::vector<Rectangle> boxes;
    boxes.reserve(count);
    if (style.row) {
        float total = 0.0f;
        for (const auto& item : menu.items) {
            total += Measure(font, item, style.size).x;
        }
        total += style.spacing * static_cast<float>(count - 1);
        float x = style.anchor.x - total / 2.0f;
        for (const auto& item : menu.items) {
            const float width = Measure(font, item, style.size).x;
            boxes.push_back(Rectangle{x, style.anchor.y, width, style.size});
            x += width + style.spacing;
        }
    } else {
        for (int i = 0; i < count; ++i) {
            const float width = Measure(font, menu.items[i], style.size).x;
            const float x = style.leftAligned ? style.anchor.x : style.anchor.x - width / 2.0f;
            boxes.push_back(Rectangle{x, style.anchor.y + style.spacing * static_cast<float>(i), width, style.size});
        }
    }

    // Teclado: en columna arriba y abajo; en fila, izquierda y derecha.
    const bool back = style.row ? Pressed({KEY_LEFT, KEY_A}) : Pressed({KEY_UP, KEY_W});
    const bool forward = style.row ? Pressed({KEY_RIGHT, KEY_D}) : Pressed({KEY_DOWN, KEY_S});
    if (back) {
        menu.selected = (menu.selected + count - 1) % count;
    }
    if (forward) {
        menu.selected = (menu.selected + 1) % count;
    }

    // Mouse: resalta solo si se movio, para no pelearle al teclado.
    const Vector2 mouse = GetMousePosition();
    const Vector2 moved = GetMouseDelta();
    int hovered = -1;
    for (int i = 0; i < count; ++i) {
        const Rectangle hit{boxes[i].x - 12.0f, boxes[i].y - 6.0f, boxes[i].width + 24.0f, boxes[i].height + 12.0f};
        if (CheckCollisionPointRec(mouse, hit)) {
            hovered = i;
        }
    }
    if (hovered >= 0 && (moved.x != 0.0f || moved.y != 0.0f)) {
        menu.selected = hovered;
    }

    for (int i = 0; i < count; ++i) {
        const bool active = i == menu.selected;
        const Color color = active ? style.highlight : style.normal;
        DrawTextAt(gfx, font, menu.items[i], Vector2{boxes[i].x, boxes[i].y}, style.size, color);
        if (active) {
            // Una marca al costado de la opcion elegida, y en fila una raya abajo.
            if (style.row) {
                DrawRectangle(static_cast<int>(boxes[i].x), static_cast<int>(boxes[i].y + style.size + 4.0f),
                              static_cast<int>(boxes[i].width), 3, style.highlight);
            } else {
                DrawTextAt(gfx, font, ">", Vector2{boxes[i].x - style.size * 0.9f, boxes[i].y}, style.size,
                           style.highlight);
            }
        }
    }

    if (Pressed({KEY_ENTER, KEY_KP_ENTER, KEY_SPACE})) {
        return menu.selected;
    }
    if (hovered >= 0 && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
        menu.selected = hovered;
        return hovered;
    }
    return -1;
}

void DrawFillImage(GraphicsDevice& gfx, const Texture2D* texture, BackgroundFit fit, Vector2 screen) {
    // Una imagen que no se pudo cargar queda con id 0 y medida 0: se dibujaria
    // como un rectangulo blanco, o dividiria por cero.
    if (!texture || texture->id == 0 || texture->width <= 0 || texture->height <= 0) {
        return;
    }
    const float width = static_cast<float>(texture->width);
    const float height = static_cast<float>(texture->height);
    switch (fit) {
    case BackgroundFit::Stretch:
        gfx.DrawSprite(*texture, Rectangle{0, 0, width, height}, Rectangle{0, 0, screen.x, screen.y}, Vector2{0, 0},
                       0.0f, WHITE);
        break;
    case BackgroundFit::Tile:
        // Un solo dibujo: un recorte del tamaño de la pantalla sobre una
        // textura con repeticion la repite sola en la GPU (quien la carga le
        // pone TEXTURE_WRAP_REPEAT). Con un bucle, una imagen de 1x1 serian
        // millones de dibujos por cuadro.
        gfx.DrawSprite(*texture, Rectangle{0, 0, screen.x, screen.y}, Rectangle{0, 0, screen.x, screen.y},
                       Vector2{0, 0}, 0.0f, WHITE);
        break;
    case BackgroundFit::Cover:
    default: {
        // La escala que cubre los dos lados; lo que sobra queda afuera, centrado.
        const float scale = std::max(screen.x / width, screen.y / height);
        const float drawWidth = width * scale;
        const float drawHeight = height * scale;
        gfx.DrawSprite(*texture, Rectangle{0, 0, width, height},
                       Rectangle{(screen.x - drawWidth) / 2.0f, (screen.y - drawHeight) / 2.0f, drawWidth, drawHeight},
                       Vector2{0, 0}, 0.0f, WHITE);
        break;
    }
    }
}

int RunTitle(GraphicsDevice& gfx, const Font& font, const TitleScreenConfig& config, const std::string& title,
             const Texture2D* background, Menu& menu) {
    const Vector2 screen{static_cast<float>(gfx.GetScreenWidth()), static_cast<float>(gfx.GetScreenHeight())};
    DrawFillImage(gfx, background, config.backgroundFit, screen);

    MenuStyle style;
    style.normal = config.buttonColor;
    style.highlight = config.buttonHighlight;

    switch (config.style) {
    case TitleStyle::Side: {
        // Una franja oscura a la izquierda, para que el texto se lea sobre
        // cualquier fondo, y todo alineado a su borde.
        const float panel = screen.x * 0.42f;
        DrawRectangle(0, 0, static_cast<int>(panel), static_cast<int>(screen.y), Color{0, 0, 0, 150});
        const float x = screen.x * 0.06f;
        const float titleSize = FitSize(font, title, config.titleSize, panel - 2.0f * x);
        float y = screen.y * 0.18f;
        DrawTextAt(gfx, font, title, Vector2{x, y}, titleSize, config.titleColor);
        y += titleSize + 10.0f;
        if (!config.subtitle.empty()) {
            const float subtitleSize = FitSize(font, config.subtitle, config.subtitleSize, panel - 2.0f * x);
            DrawTextAt(gfx, font, config.subtitle, Vector2{x, y}, subtitleSize, config.subtitleColor);
        }
        style.anchor = Vector2{x + 24.0f, screen.y * 0.5f};
        style.leftAligned = true;
        break;
    }
    case TitleStyle::Minimal: {
        const float titleSize = FitSize(font, title, config.titleSize, screen.x * 0.9f);
        const float y = screen.y * 0.36f;
        DrawCentered(gfx, font, title, screen.x / 2.0f, y, titleSize, config.titleColor);
        if (!config.subtitle.empty()) {
            const float subtitleSize = FitSize(font, config.subtitle, config.subtitleSize, screen.x * 0.9f);
            DrawCentered(gfx, font, config.subtitle, screen.x / 2.0f, y + titleSize + 10.0f, subtitleSize,
                         config.subtitleColor);
        }
        style.anchor = Vector2{screen.x / 2.0f, screen.y * 0.8f};
        style.row = true;
        style.size = 22.0f;
        style.spacing = 36.0f;
        break;
    }
    case TitleStyle::Centered:
    default: {
        const float titleSize = FitSize(font, title, config.titleSize, screen.x * 0.9f);
        const float y = screen.y * 0.2f;
        DrawCentered(gfx, font, title, screen.x / 2.0f, y, titleSize, config.titleColor);
        if (!config.subtitle.empty()) {
            const float subtitleSize = FitSize(font, config.subtitle, config.subtitleSize, screen.x * 0.9f);
            DrawCentered(gfx, font, config.subtitle, screen.x / 2.0f, y + titleSize + 10.0f, subtitleSize,
                         config.subtitleColor);
        }
        style.anchor = Vector2{screen.x / 2.0f, screen.y * 0.52f};
        break;
    }
    }
    return RunMenu(gfx, font, menu, style);
}

bool RunCredits(GraphicsDevice& gfx, const Font& font, const TitleScreenConfig& config,
                const std::vector<std::string>& lines, const Texture2D* background, float elapsed) {
    const Vector2 screen{static_cast<float>(gfx.GetScreenWidth()), static_cast<float>(gfx.GetScreenHeight())};
    DrawFillImage(gfx, background, config.backgroundFit, screen);
    DrawRectangle(0, 0, static_cast<int>(screen.x), static_cast<int>(screen.y), Color{0, 0, 0, 160});

    // Alto de cada renglon: los titulos de seccion ("# ...") van mas grandes.
    const auto isHeading = [](const std::string& line) { return line.rfind("# ", 0) == 0; };
    const auto lineHeight = [&](const std::string& line) { return isHeading(line) ? 46.0f : 30.0f; };
    float total = 0.0f;
    for (const auto& line : lines) {
        total += lineHeight(line);
    }

    // Suben de abajo hacia arriba y vuelven a empezar al terminar. Se recortan
    // antes de la linea de ayuda de abajo, para no pasarle por encima.
    constexpr float kSpeed = 40.0f;
    constexpr float kFooter = 46.0f;
    const float area = screen.y - kFooter;
    const float cycle = total + area;
    float y = area - std::fmod(elapsed * kSpeed, std::max(1.0f, cycle));
    BeginScissorMode(0, 0, static_cast<int>(screen.x), static_cast<int>(area));
    for (const auto& line : lines) {
        if (isHeading(line)) {
            DrawCentered(gfx, font, line.substr(2), screen.x / 2.0f, y, 30.0f, config.buttonHighlight);
        } else if (!line.empty()) {
            DrawCentered(gfx, font, line, screen.x / 2.0f, y, 20.0f, config.buttonColor);
        }
        y += lineHeight(line);
    }
    EndScissorMode();

    DrawCentered(gfx, font, "Enter o Esc: volver", screen.x / 2.0f, screen.y - 30.0f, 16.0f, config.subtitleColor);
    return Pressed({KEY_ENTER, KEY_KP_ENTER, KEY_SPACE, KEY_ESCAPE}) || IsMouseButtonPressed(MOUSE_BUTTON_LEFT);
}

int RunOverlay(GraphicsDevice& gfx, const Font& font, const std::string& title, Color titleColor, Color veil,
               const TitleScreenConfig& colors, Menu& menu) {
    const Vector2 screen{static_cast<float>(gfx.GetScreenWidth()), static_cast<float>(gfx.GetScreenHeight())};
    DrawRectangle(0, 0, static_cast<int>(screen.x), static_cast<int>(screen.y), veil);
    const float titleSize = FitSize(font, title, 52.0f, screen.x * 0.9f);
    DrawCentered(gfx, font, title, screen.x / 2.0f, screen.y * 0.26f, titleSize, titleColor);

    MenuStyle style;
    style.anchor = Vector2{screen.x / 2.0f, screen.y * 0.48f};
    style.normal = colors.buttonColor;
    style.highlight = colors.buttonHighlight;
    return RunMenu(gfx, font, menu, style);
}

}  // namespace Screens
