// Pruebas de ZSortSystem: el orden de dibujo isometrico (algoritmo del pintor)
// y el recorte por camara.
//
// El orden no se ve desde afuera de la clase: se comprueba DIBUJANDO. Dos
// sprites de colores distintos se dibujan en el mismo lugar de una textura de
// destino, y el color que queda en el pixel dice cual se dibujo ultimo. Por eso
// esta suite usa la ventana oculta que abre main.cpp.

#include "doctest/doctest.h"

#include "raylib.h"

#include "support/TestSupport.hpp"
#include "systems/z_sort/ZSortSystem.hpp"

namespace {

constexpr int kSize = 8;

// Dos texturas lisas, una por color, y una textura de destino donde dibujar.
struct ZSortFixture {
    Texture2D red{};
    Texture2D blue{};
    RenderTexture2D target{};
    ZSortSystem zsort{TestSupport::Graphics()};

    ZSortFixture() {
        // Colores puros: el RED de raylib es (230, 41, 55), no rojo puro.
        red = Solid(Color{255, 0, 0, 255});
        blue = Solid(Color{0, 0, 255, 255});
        target = LoadRenderTexture(kSize, kSize);
    }

    ~ZSortFixture() {
        UnloadTexture(red);
        UnloadTexture(blue);
        UnloadRenderTexture(target);
    }

    static Texture2D Solid(Color color) {
        Image image = GenImageColor(kSize, kSize, color);
        Texture2D texture = LoadTextureFromImage(image);
        UnloadImage(image);
        return texture;
    }

    // Un sprite que cubre toda la textura de destino.
    SpriteInstance Sprite(const Texture2D& texture, float sortY, int layer) const {
        SpriteInstance sprite{};
        sprite.texture = &texture;
        sprite.source = Rectangle{0, 0, kSize, kSize};
        sprite.screenPosition = Vector2{0, 0};
        sprite.sortPosition = Vector2{0, sortY};
        sprite.origin = Vector2{0, 0};
        sprite.rotation = 0.0f;
        sprite.tint = WHITE;
        sprite.layer = layer;
        return sprite;
    }

    // Dibuja lo encolado y devuelve el color del pixel del medio.
    Color FlushAndSample() {
        BeginTextureMode(target);
        ClearBackground(BLACK);
        zsort.Flush();
        EndTextureMode();
        Image image = LoadImageFromTexture(target.texture);
        const Color color = GetImageColor(image, kSize / 2, kSize / 2);
        UnloadImage(image);
        return color;
    }
};

bool IsRed(Color c) {
    return c.r > 200 && c.g < 50 && c.b < 50;
}

bool IsBlue(Color c) {
    return c.b > 200 && c.r < 50;
}

}  // namespace

TEST_SUITE("orden de dibujo") {

TEST_CASE("lo que esta mas adelante se dibuja encima aunque se encole primero") {
    ZSortFixture fx;
    fx.zsort.Submit(fx.Sprite(fx.red, 10.0f, SpriteLayer::Entity));   // adelante
    fx.zsort.Submit(fx.Sprite(fx.blue, 5.0f, SpriteLayer::Entity));   // atras
    CHECK(IsRed(fx.FlushAndSample()));
}

TEST_CASE("el orden depende de la profundidad y no del orden de encolado") {
    ZSortFixture fx;
    fx.zsort.Submit(fx.Sprite(fx.red, 5.0f, SpriteLayer::Entity));
    fx.zsort.Submit(fx.Sprite(fx.blue, 10.0f, SpriteLayer::Entity));
    CHECK(IsBlue(fx.FlushAndSample()));
}

TEST_CASE("a igual profundidad la entidad se dibuja sobre la pared") {
    ZSortFixture fx;
    fx.zsort.Submit(fx.Sprite(fx.blue, 7.0f, SpriteLayer::Entity));
    fx.zsort.Submit(fx.Sprite(fx.red, 7.0f, SpriteLayer::Object));
    CHECK(IsBlue(fx.FlushAndSample()));
}

TEST_CASE("el piso queda siempre debajo aunque este mas adelante") {
    ZSortFixture fx;
    fx.zsort.Submit(fx.Sprite(fx.red, 0.0f, SpriteLayer::Object));
    fx.zsort.Submit(fx.Sprite(fx.blue, 1000.0f, SpriteLayer::Ground));
    CHECK(IsRed(fx.FlushAndSample()));
}

TEST_CASE("las estadisticas cuentan piso ordenados y recortados") {
    ZSortFixture fx;
    fx.zsort.SetView(Rectangle{0, 0, 100, 100});
    fx.zsort.Submit(fx.Sprite(fx.red, 0.0f, SpriteLayer::Ground));
    fx.zsort.Submit(fx.Sprite(fx.red, 0.0f, SpriteLayer::Ground));
    fx.zsort.Submit(fx.Sprite(fx.blue, 1.0f, SpriteLayer::Entity));
    SpriteInstance far = fx.Sprite(fx.blue, 2.0f, SpriteLayer::Entity);
    far.screenPosition = Vector2{500, 500};
    fx.zsort.Submit(far);
    fx.FlushAndSample();
    CHECK(fx.zsort.LastStats().ground == 2);
    CHECK(fx.zsort.LastStats().sorted == 1);
    CHECK(fx.zsort.LastStats().culled == 1);

    // Las colas son por frame: el siguiente Flush arranca vacio.
    fx.FlushAndSample();
    CHECK(fx.zsort.LastStats().ground == 0);
    CHECK(fx.zsort.LastStats().sorted == 0);
    CHECK(fx.zsort.LastStats().culled == 0);
}

TEST_CASE("sin vista configurada no se recorta nada") {
    ZSortFixture fx;
    SpriteInstance far = fx.Sprite(fx.blue, 0.0f, SpriteLayer::Entity);
    far.screenPosition = Vector2{-9000, 9000};
    fx.zsort.Submit(far);
    fx.FlushAndSample();
    CHECK(fx.zsort.LastStats().culled == 0);
    CHECK(fx.zsort.LastStats().sorted == 1);
}

TEST_CASE("un sprite que asoma en el borde de la vista no se recorta") {
    ZSortFixture fx;
    fx.zsort.SetView(Rectangle{0, 0, 100, 100});
    SpriteInstance edge = fx.Sprite(fx.blue, 0.0f, SpriteLayer::Entity);
    edge.screenPosition = Vector2{-6, 95};
    fx.zsort.Submit(edge);
    fx.FlushAndSample();
    CHECK(fx.zsort.LastStats().culled == 0);
}

TEST_CASE("un sprite rotado nunca se recorta") {
    ZSortFixture fx;
    fx.zsort.SetView(Rectangle{0, 0, 100, 100});
    SpriteInstance rotated = fx.Sprite(fx.blue, 0.0f, SpriteLayer::Entity);
    rotated.screenPosition = Vector2{500, 500};
    rotated.rotation = 45.0f;
    fx.zsort.Submit(rotated);
    fx.FlushAndSample();
    CHECK(fx.zsort.LastStats().culled == 0);
}

TEST_CASE("un sprite espejado no se toma como vacio al recortar") {
    ZSortFixture fx;
    fx.zsort.SetView(Rectangle{0, 0, 100, 100});
    SpriteInstance mirrored = fx.Sprite(fx.blue, 0.0f, SpriteLayer::Entity);
    mirrored.source.width = -kSize;
    fx.zsort.Submit(mirrored);
    fx.FlushAndSample();
    CHECK(fx.zsort.LastStats().culled == 0);
    CHECK(fx.zsort.LastStats().sorted == 1);
}

TEST_CASE("el tamano de destino manda sobre el recorte al recortar") {
    ZSortFixture fx;
    fx.zsort.SetView(Rectangle{0, 0, 100, 100});
    SpriteInstance big = fx.Sprite(fx.blue, 0.0f, SpriteLayer::Entity);
    big.screenPosition = Vector2{-50, 0};
    big.destinationSize = Vector2{60, 8};  // con el recorte de 8 no llegaria a la vista
    fx.zsort.Submit(big);
    fx.FlushAndSample();
    CHECK(fx.zsort.LastStats().culled == 0);
}

}  // TEST_SUITE
