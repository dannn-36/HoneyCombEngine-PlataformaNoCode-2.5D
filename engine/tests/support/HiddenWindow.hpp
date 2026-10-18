#pragma once

// La ventana oculta de las pruebas, en un encabezado sin raylib.h: main.cpp
// incluye la implementacion de doctest, que en Windows trae windows.h, y
// windows.h choca con raylib.h (Rectangle, CloseWindow, ShowCursor...).

#include <functional>

namespace TestSupport {

// Abre una ventana oculta de raylib (con su contexto OpenGL), corre "run"
// adentro y la cierra. Devuelve lo que devuelve "run", o 2 si no se pudo
// abrir la ventana.
int RunWithHiddenWindow(const std::function<int()>& run);

}  // namespace TestSupport
