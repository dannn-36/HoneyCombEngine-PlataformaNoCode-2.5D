// Pruebas de ResourceManager: la cache de texturas y su descarga al pasar de
// nivel (ReleaseTexturesExcept). Cargan texturas de verdad: el main de las
// pruebas abre una ventana oculta con contexto OpenGL.

#include "doctest/doctest.h"

#include <unordered_set>

#include "core/ResourceManager.hpp"
#include "support/TestSupport.hpp"

using TestSupport::TempDir;

TEST_SUITE("recursos") {

TEST_CASE("la misma ruta devuelve la misma textura") {
    TempDir dir;
    const std::string path = dir.WritePng("a.png", 4, 4, RED).string();
    ResourceManager resources;
    const Texture2D& first = resources.GetTexture(path);
    const Texture2D& second = resources.GetTexture(path);
    CHECK(&first == &second);
    CHECK(first.id != 0);
}

TEST_CASE("liberar descarga solo las texturas que no estan en uso") {
    TempDir dir;
    const std::string kept = dir.WritePng("guardar.png", 4, 4, RED).string();
    const std::string dropped = dir.WritePng("soltar.png", 4, 4, BLUE).string();
    ResourceManager resources;
    const Texture2D* keptTexture = &resources.GetTexture(kept);
    const unsigned int keptId = keptTexture->id;
    resources.GetTexture(dropped);

    CHECK(resources.ReleaseTexturesExcept({keptTexture}) == 1);
    // La que se conserva sigue en el mismo lugar y con la misma textura de GPU:
    // quien la apuntaba no se entera.
    CHECK(&resources.GetTexture(kept) == keptTexture);
    CHECK(keptTexture->id == keptId);
}

TEST_CASE("una textura liberada se vuelve a cargar si se la pide") {
    TempDir dir;
    const std::string path = dir.WritePng("a.png", 4, 4, GREEN).string();
    ResourceManager resources;
    resources.GetTexture(path);
    CHECK(resources.ReleaseTexturesExcept({}) == 1);
    CHECK(resources.GetTexture(path).id != 0);
}

TEST_CASE("liberar sin nada cargado no hace nada") {
    ResourceManager resources;
    CHECK(resources.ReleaseTexturesExcept({}) == 0);
}

}  // TEST_SUITE
