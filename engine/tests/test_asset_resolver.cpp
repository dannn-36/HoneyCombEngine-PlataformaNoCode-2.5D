// Pruebas de AssetResolver: la convencion de rutas de assets que comparten el
// editor y el motor.

#include "doctest/doctest.h"

#include "loader/AssetResolver.hpp"
#include "support/TestSupport.hpp"

using TestSupport::TempDir;

TEST_SUITE("rutas de assets") {

TEST_CASE("por defecto las rutas se resuelven dentro de assets") {
    AssetResolver assets;
    CHECK(assets.Resolve("textures/piso.png") == "assets/textures/piso.png");
}

TEST_CASE("la raiz configurada se antepone con barra normal") {
    AssetResolver assets("C:/proyecto/assets");
    CHECK(assets.Resolve("sounds/hit.wav") == "C:/proyecto/assets/sounds/hit.wav");
    // La ruta del JSON se usa tal cual: no se normaliza ni se le sacan barras.
    CHECK(assets.Resolve("") == "C:/proyecto/assets/");
}

TEST_CASE("un archivo que existe se informa como presente") {
    TempDir dir;
    dir.WriteText("textures/a.png", "x");
    AssetResolver assets(dir.Path().string());
    CHECK(assets.Exists("textures/a.png"));
}

TEST_CASE("un archivo que no existe se informa como ausente") {
    TempDir dir;
    AssetResolver assets(dir.Path().string());
    CHECK_FALSE(assets.Exists("textures/no_esta.png"));
}

TEST_CASE("los assets del repositorio se encuentran con la raiz real") {
    AssetResolver assets(TestSupport::RepoPath("assets").string());
    CHECK(assets.Exists("sounds/hit.wav"));
}

}  // TEST_SUITE
