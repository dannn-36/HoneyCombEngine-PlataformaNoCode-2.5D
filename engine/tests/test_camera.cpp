// Pruebas de CameraSystem: encuadre fijo, seguimiento con zona muerta y
// suavizado, limites del nivel y las dos transformaciones pantalla/mundo.

#include "doctest/doctest.h"

#include <algorithm>
#include <cmath>

#include "systems/camera/CameraSystem.hpp"

namespace {

CameraSystem MakeCamera(CameraFraming mode, float zoom = 1.0f, float smoothing = 0.0f, Vector2 deadzone = {0, 0},
                    bool clamp = false) {
    CameraSettings settings;
    settings.mode = mode;
    settings.zoom = zoom;
    settings.smoothing = smoothing;
    settings.deadzone = deadzone;
    settings.clampToBounds = clamp;
    CameraSystem camera;
    camera.Configure(settings);
    camera.SetScreenSize(Vector2{800, 450});
    return camera;
}

const Rectangle kNoBounds{0, 0, 0, 0};

}  // namespace

TEST_SUITE("camara") {

TEST_CASE("la configuracion fuera de rango se lleva al rango") {
    CameraSettings settings;
    settings.zoom = 100.0f;
    settings.smoothing = 5.0f;
    settings.deadzone = Vector2{-10, -20};
    CameraSystem camera;
    camera.Configure(settings);
    CHECK(camera.Settings().zoom == doctest::Approx(CameraSystem::kMaxZoom));
    CHECK(camera.Settings().smoothing == doctest::Approx(CameraSystem::kMaxSmoothing));
    CHECK(camera.Settings().deadzone.x == doctest::Approx(0.0f));
    CHECK(camera.Settings().deadzone.y == doctest::Approx(0.0f));

    settings.zoom = 0.0f;
    settings.smoothing = -1.0f;
    camera.Configure(settings);
    CHECK(camera.Settings().zoom == doctest::Approx(CameraSystem::kMinZoom));
    CHECK(camera.Settings().smoothing == doctest::Approx(0.0f));
}

TEST_CASE("la camara fija pone el centro del encuadre en el medio de la pantalla") {
    CameraSystem camera = MakeCamera(CameraFraming::Fixed);
    camera.SnapTo(Vector2{999, 999}, Vector2{100, 50}, kNoBounds);
    const Camera2D raw = camera.GetCamera();
    CHECK(raw.offset.x == doctest::Approx(300.0f));
    CHECK(raw.offset.y == doctest::Approx(175.0f));
    CHECK(raw.target.x == doctest::Approx(0.0f));
    CHECK(raw.zoom == doctest::Approx(1.0f));
    const Vector2 screen = camera.WorldToScreen(Vector2{100, 50});
    CHECK(screen.x == doctest::Approx(400.0f));
    CHECK(screen.y == doctest::Approx(225.0f));
}

TEST_CASE("la camara fija ignora al jugador al actualizar") {
    CameraSystem camera = MakeCamera(CameraFraming::Fixed);
    camera.Update(Vector2{500, 500}, Vector2{100, 50}, kNoBounds, 0.016f);
    const Vector2 screen = camera.WorldToScreen(Vector2{100, 50});
    CHECK(screen.x == doctest::Approx(400.0f));
    CHECK(screen.y == doctest::Approx(225.0f));
}

TEST_CASE("con zoom el centro sigue en el medio de la pantalla") {
    CameraSystem camera = MakeCamera(CameraFraming::Fixed, 2.0f);
    camera.SnapTo(Vector2{0, 0}, Vector2{100, 50}, kNoBounds);
    CHECK(camera.GetCamera().zoom == doctest::Approx(2.0f));
    const Vector2 screen = camera.WorldToScreen(Vector2{100, 50});
    CHECK(screen.x == doctest::Approx(400.0f));
    CHECK(screen.y == doctest::Approx(225.0f));
    const Vector2 oneRight = camera.WorldToScreen(Vector2{101, 50});
    CHECK(oneRight.x == doctest::Approx(402.0f));
}

TEST_CASE("pantalla a mundo es la inversa de mundo a pantalla") {
    CameraSystem camera = MakeCamera(CameraFraming::Follow, 1.5f);
    camera.SnapTo(Vector2{37, -12}, Vector2{0, 0}, kNoBounds);
    const Vector2 points[] = {{0, 0}, {123.5f, -40.0f}, {-300, 900}};
    for (const Vector2& point : points) {
        const Vector2 back = camera.ScreenToWorld(camera.WorldToScreen(point));
        CHECK(back.x == doctest::Approx(point.x));
        CHECK(back.y == doctest::Approx(point.y));
    }
}

TEST_CASE("siguiendo sin suavizado la camara queda pegada al foco") {
    CameraSystem camera = MakeCamera(CameraFraming::Follow);
    camera.SnapTo(Vector2{0, 0}, Vector2{0, 0}, kNoBounds);
    camera.Update(Vector2{10, 20}, Vector2{0, 0}, kNoBounds, 0.016f);
    const Camera2D raw = camera.GetCamera();
    CHECK(raw.offset.x == doctest::Approx(390.0f));
    CHECK(raw.offset.y == doctest::Approx(205.0f));
}

TEST_CASE("siguiendo el desplazamiento se lleva a pixeles enteros") {
    CameraSystem camera = MakeCamera(CameraFraming::Follow);
    camera.SetScreenSize(Vector2{801, 451});
    camera.SnapTo(Vector2{10.4f, 0.6f}, Vector2{0, 0}, kNoBounds);
    const Camera2D raw = camera.GetCamera();
    CHECK(raw.offset.x == doctest::Approx(390.0f));  // round(400 - 10.4)
    CHECK(raw.offset.y == doctest::Approx(224.0f));  // round(225 - 0.6)
}

TEST_CASE("dentro de la zona muerta la camara no se mueve") {
    CameraSystem camera = MakeCamera(CameraFraming::Follow, 1.0f, 0.0f, Vector2{100, 50});
    camera.SnapTo(Vector2{0, 0}, Vector2{0, 0}, kNoBounds);
    camera.Update(Vector2{30, 10}, Vector2{0, 0}, kNoBounds, 0.016f);
    CHECK(camera.WorldToScreen(Vector2{0, 0}).x == doctest::Approx(400.0f));

    // Al salir, se corre lo justo para dejar el foco en el borde: 80 - 50.
    camera.Update(Vector2{80, 10}, Vector2{0, 0}, kNoBounds, 0.016f);
    CHECK(camera.WorldToScreen(Vector2{30, 0}).x == doctest::Approx(400.0f));
    camera.Update(Vector2{80, -40}, Vector2{0, 0}, kNoBounds, 0.016f);
    CHECK(camera.WorldToScreen(Vector2{0, -15}).y == doctest::Approx(225.0f));
}

TEST_CASE("el suavizado recorre la parte exponencial de la distancia") {
    CameraSystem camera = MakeCamera(CameraFraming::Follow, 1.0f, 0.5f);
    camera.SnapTo(Vector2{0, 0}, Vector2{0, 0}, kNoBounds);
    camera.Update(Vector2{100, 0}, Vector2{0, 0}, kNoBounds, 0.5f);
    // Con dt igual a smoothing se recorre 1 - e^-1 = 63.2 % del camino.
    const float expected = 100.0f * (1.0f - std::exp(-1.0f));
    const float center = 400.0f - camera.GetCamera().offset.x;
    CHECK(center == doctest::Approx(expected).epsilon(0.01));
}

TEST_CASE("con limites la camara no muestra el vacio fuera del nivel") {
    CameraSystem camera = MakeCamera(CameraFraming::Follow, 1.0f, 0.0f, Vector2{0, 0}, true);
    const Rectangle bounds{0, 0, 2000, 1000};
    camera.SnapTo(Vector2{0, 0}, Vector2{0, 0}, bounds);
    // Media vista: 400 x 225. El centro no puede acercarse mas al borde.
    CHECK(camera.WorldToScreen(Vector2{400, 225}).x == doctest::Approx(400.0f));
    CHECK(camera.WorldToScreen(Vector2{400, 225}).y == doctest::Approx(225.0f));
    camera.Update(Vector2{5000, 5000}, Vector2{0, 0}, bounds, 0.016f);
    CHECK(camera.WorldToScreen(Vector2{1600, 775}).x == doctest::Approx(400.0f));
    CHECK(camera.WorldToScreen(Vector2{1600, 775}).y == doctest::Approx(225.0f));
}

TEST_CASE("un nivel mas chico que la vista queda centrado") {
    CameraSystem camera = MakeCamera(CameraFraming::Follow, 1.0f, 0.0f, Vector2{0, 0}, true);
    const Rectangle bounds{100, 0, 300, 200};
    camera.SnapTo(Vector2{120, 10}, Vector2{0, 0}, bounds);
    CHECK(camera.WorldToScreen(Vector2{250, 100}).x == doctest::Approx(400.0f));
    CHECK(camera.WorldToScreen(Vector2{250, 100}).y == doctest::Approx(225.0f));
}

TEST_CASE("sin limites validos la camara sigue al foco") {
    CameraSystem camera = MakeCamera(CameraFraming::Follow, 1.0f, 0.0f, Vector2{0, 0}, true);
    camera.SnapTo(Vector2{-500, -500}, Vector2{0, 0}, kNoBounds);
    CHECK(camera.WorldToScreen(Vector2{-500, -500}).x == doctest::Approx(400.0f));
}

}  // TEST_SUITE

TEST_SUITE("camara: sacudida") {

TEST_CASE("sacudir mueve el encuadre del dibujo y se calma hasta quedar quieto") {
    CameraSystem camera = MakeCamera(CameraFraming::Fixed);
    camera.SnapTo(Vector2{0, 0}, Vector2{0, 0}, kNoBounds);
    const Vector2 still = camera.GetCamera().offset;

    camera.Shake(10.0f, 0.5f);
    CHECK(camera.IsShaking());
    float moved = 0.0f;
    for (int i = 0; i < 10; ++i) {
        camera.Update(Vector2{0, 0}, Vector2{0, 0}, kNoBounds, 0.02f);
        const Vector2 offset = camera.GetCamera().offset;
        moved = std::max(moved, std::fabs(offset.x - still.x) + std::fabs(offset.y - still.y));
        CHECK(std::fabs(offset.x - still.x) <= 10.0f);
        CHECK(std::fabs(offset.y - still.y) <= 10.0f);
    }
    CHECK(moved > 0.0f);

    for (int i = 0; i < 30; ++i) camera.Update(Vector2{0, 0}, Vector2{0, 0}, kNoBounds, 0.02f);
    CHECK_FALSE(camera.IsShaking());
    CHECK(camera.GetCamera().offset.x == doctest::Approx(still.x));
    CHECK(camera.GetCamera().offset.y == doctest::Approx(still.y));
}

TEST_CASE("apuntar con el mouse no tiembla con la sacudida") {
    CameraSystem camera = MakeCamera(CameraFraming::Fixed);
    camera.SnapTo(Vector2{0, 0}, Vector2{0, 0}, kNoBounds);
    const Vector2 before = camera.ScreenToWorld(Vector2{100, 100});
    camera.Shake(20.0f, 1.0f);
    camera.Update(Vector2{0, 0}, Vector2{0, 0}, kNoBounds, 0.05f);
    const Vector2 after = camera.ScreenToWorld(Vector2{100, 100});
    CHECK(after.x == doctest::Approx(before.x));
    CHECK(after.y == doctest::Approx(before.y));
}

TEST_CASE("una sacudida sin fuerza o sin tiempo no hace nada, y la fuerza tiene tope") {
    CameraSystem camera = MakeCamera(CameraFraming::Fixed);
    camera.Shake(0.0f, 1.0f);
    CHECK_FALSE(camera.IsShaking());
    camera.Shake(5.0f, -1.0f);
    CHECK_FALSE(camera.IsShaking());
    camera.Shake(1000.0f, 1.0f);
    camera.Update(Vector2{0, 0}, Vector2{0, 0}, kNoBounds, 0.01f);
    const Vector2 shake = camera.ShakeOffset();
    CHECK(std::fabs(shake.x) <= CameraSystem::kMaxShakeIntensity);
    CHECK(std::fabs(shake.y) <= CameraSystem::kMaxShakeIntensity);
}

}  // TEST_SUITE
