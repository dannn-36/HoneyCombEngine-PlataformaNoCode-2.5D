#pragma once

// Ayudas compartidas por las pruebas del motor: rutas del repositorio, una
// carpeta temporal por prueba y niveles armados a mano para probar las reglas
// del juego sin pasar por un archivo.

#include <filesystem>
#include <string>

#include "nlohmann/json.hpp"
#include "raylib.h"

#include "core/GraphicsDevice.hpp"
#include "world/Level.hpp"

namespace TestSupport {

// Ruta dentro del repositorio (HONEYCOMB_REPO_DIR, lo define tests/CMakeLists.txt).
std::filesystem::path RepoPath(const std::string& relative = "");

// Carpeta temporal propia de una prueba. Se borra entera al salir de alcance,
// asi una prueba nunca ve los archivos de otra.
class TempDir {
public:
    TempDir();
    ~TempDir();

    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;

    const std::filesystem::path& Path() const { return path_; }

    std::filesystem::path WriteText(const std::string& name, const std::string& text) const;
    std::filesystem::path WriteJson(const std::string& name, const nlohmann::json& value) const;
    // Un PNG de un solo color, para cargar texturas reales en la GPU.
    std::filesystem::path WritePng(const std::string& name, int width, int height, Color color) const;

private:
    std::filesystem::path path_;
};

// El nivel mas chico que el schema acepta: nombre, grilla, sin entidades ni eventos.
nlohmann::json MinimalLevel(int width = 4, int height = 3);

// Una entidad del JSON con lo obligatorio: posicion, textura y recorte.
nlohmann::json EntityJson(const std::string& id, const std::string& type, int col, int row,
                          const std::string& texture = "textures/prueba.png");

// Un nivel ya cargado, armado a mano: grilla de width x height con piso en
// todas las celdas y sin paredes (sin textura de pared las paredes no frenan).
LoadedLevel OpenLevel(int width, int height);

// Una entidad parada en (col, row), sin collider.
LevelEntity MakeEntity(const std::string& id, const std::string& type, float col, float row);

// Un puntero no nulo para LoadedLevel::wallTexture: con el, las paredes por
// celda bloquean (ver Movement::CanOccupy). Nunca se dibuja.
const Texture2D* WallTextureFlag();

// La ventana oculta que abre main.cpp. ZSortSystem necesita un GraphicsDevice.
GraphicsDevice& Graphics();
void SetGraphics(GraphicsDevice* graphics);

}  // namespace TestSupport
