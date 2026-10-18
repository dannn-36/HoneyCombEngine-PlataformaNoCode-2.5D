// Implementacion de la ventana oculta de las pruebas. El porque esta en main.cpp.

#include "support/HiddenWindow.hpp"

#include <iostream>

#include "raylib.h"

#include "core/GraphicsDevice.hpp"
#include "support/TestSupport.hpp"

namespace TestSupport {

int RunWithHiddenWindow(const std::function<int()>& run) {
    // Las texturas que faltan y el audio se avisan por consola con WARNING;
    // en las pruebas eso es ruido (hay pruebas que piden archivos que no existen).
    SetTraceLogLevel(LOG_ERROR);
    // SetConfigFlags suma banderas: GraphicsDevice agrega la de ventana
    // redimensionable y esta queda.
    SetConfigFlags(FLAG_WINDOW_HIDDEN);

    GraphicsDevice graphics(320, 240, "HoneyComb - pruebas");
    if (!IsWindowReady()) {
        std::cerr << "No se pudo abrir la ventana oculta: las pruebas necesitan un contexto OpenGL." << std::endl;
        return 2;
    }
    SetGraphics(&graphics);
    const int result = run();
    SetGraphics(nullptr);
    return result;
}

}  // namespace TestSupport
