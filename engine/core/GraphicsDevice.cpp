// Implementacion de GraphicsDevice. El contrato de la clase (unico punto de
// entrada a raylib para ventana y dibujo) esta documentado en el .hpp.
//
// Casi todos los metodos son envoltorios de una linea sobre raylib, y es a
// proposito: el valor no esta en lo que agregan, sino en que exista UN solo
// lugar por donde pasa el dibujo. Cambiar de backend se hace aca y en ningun
// otro archivo.

#include "GraphicsDevice.hpp"

#include <cstdlib>

GraphicsDevice::GraphicsDevice(int width, int height, const char* title) {
    // El orden importa: SetConfigFlags configura la ventana que se VA a crear,
    // asi que va siempre antes de InitWindow. Al reves no tiene efecto.
    SetConfigFlags(FLAG_WINDOW_RESIZABLE);
#ifdef _WIN32
    // El icono de la ventana y de la barra de tareas: el del propio .exe (el
    // recurso 1, ver resources/engine.rc), que en un juego exportado es el del
    // juego. SDL lo lee de estas dos variables al registrar la ventana, asi
    // que tambien van antes de InitWindow. Sin ellas, SDL deja el icono
    // generico de Windows. Un icono de game.json se pone despues, encima
    // (SetWindowIcon en GameSession).
    _putenv_s("SDL_WINDOWS_INTRESOURCE_ICON", "1");
    _putenv_s("SDL_WINDOWS_INTRESOURCE_ICON_SMALL", "1");
#endif
    InitWindow(width, height, title);
}

// RAII: cerrar la ventana en el destructor garantiza que se libere aunque se
// salga del main por una excepcion.
GraphicsDevice::~GraphicsDevice() {
    CloseWindow();
}

bool GraphicsDevice::ShouldClose() const {
    return WindowShouldClose();
}

void GraphicsDevice::SetTargetFPS(int fps) {
    // Calificado con :: para llamar a la funcion global de raylib y no
    // recursar sobre este mismo metodo (mismo nombre).
    ::SetTargetFPS(fps);
}

float GraphicsDevice::GetDeltaTime() const {
    return GetFrameTime();
}

// BeginFrame y EndFrame van siempre de a pares y envuelven todo el dibujo del
// frame. Limpiar el fondo va junto al Begin porque olvidarlo deja restos del
// frame anterior en pantalla.
void GraphicsDevice::BeginFrame(Color clearColor) {
    BeginDrawing();
    ClearBackground(clearColor);
}

void GraphicsDevice::EndFrame() {
    EndDrawing();
}

void GraphicsDevice::BeginWorld(const Camera2D& camera) {
    BeginMode2D(camera);
}

void GraphicsDevice::EndWorld() {
    EndMode2D();
}

void GraphicsDevice::DrawSprite(const Texture2D& texture, Rectangle source, Rectangle dest,
                                 Vector2 origin, float rotation, Color tint) {
    DrawTexturePro(texture, source, dest, origin, rotation, tint);
}

void GraphicsDevice::DrawText(const Font& font, const char* text, Vector2 position,
                               float fontSize, Color color) {
    DrawTextEx(font, text, position, fontSize, 1.0f, color);
}

int GraphicsDevice::GetScreenWidth() const {
    return ::GetScreenWidth();
}

int GraphicsDevice::GetScreenHeight() const {
    return ::GetScreenHeight();
}
