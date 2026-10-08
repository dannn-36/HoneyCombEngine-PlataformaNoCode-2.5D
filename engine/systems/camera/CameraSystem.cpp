#include "CameraSystem.hpp"

#include <algorithm>
#include <cmath>

void CameraSystem::Configure(const CameraSettings& settings) {
    settings_ = settings;
    settings_.zoom = std::clamp(settings_.zoom, kMinZoom, kMaxZoom);
    settings_.smoothing = std::clamp(settings_.smoothing, 0.0f, kMaxSmoothing);
    settings_.deadzone.x = std::max(0.0f, settings_.deadzone.x);
    settings_.deadzone.y = std::max(0.0f, settings_.deadzone.y);
}

void CameraSystem::SetScreenSize(Vector2 screenSize) {
    screenSize_ = screenSize;
    Recompute();
}

void CameraSystem::SnapTo(Vector2 focus, Vector2 fixedCenter, Rectangle bounds) {
    center_ = settings_.mode == CameraFraming::Fixed ? fixedCenter : Clamp(focus, bounds);
    Recompute();
}

void CameraSystem::Update(Vector2 focus, Vector2 fixedCenter, Rectangle bounds, float deltaTime) {
    if (settings_.mode == CameraFraming::Fixed) {
        center_ = fixedCenter;
        Recompute();
        return;
    }

    // Zona muerta: mientras el foco este adentro, el objetivo no se mueve.
    // Cuando sale, el objetivo se corre lo justo para volver a dejarlo en el
    // borde -- no hasta el centro, que se sentiria como un tiron.
    const float zoom = settings_.zoom;
    const Vector2 half{settings_.deadzone.x / 2.0f / zoom, settings_.deadzone.y / 2.0f / zoom};
    Vector2 desired = center_;
    if (focus.x > desired.x + half.x) {
        desired.x = focus.x - half.x;
    } else if (focus.x < desired.x - half.x) {
        desired.x = focus.x + half.x;
    }
    if (focus.y > desired.y + half.y) {
        desired.y = focus.y - half.y;
    } else if (focus.y < desired.y - half.y) {
        desired.y = focus.y + half.y;
    }
    desired = Clamp(desired, bounds);

    // Suavizado exponencial: independiente de los FPS, porque depende del
    // tiempo transcurrido y no de cuantos frames pasaron. Interpolar entre dos
    // puntos que ya estan dentro de los limites no puede sacar a la camara.
    if (settings_.smoothing <= 0.0f) {
        center_ = desired;
    } else {
        const float t = 1.0f - std::exp(-deltaTime / settings_.smoothing);
        center_.x += (desired.x - center_.x) * t;
        center_.y += (desired.y - center_.y) * t;
    }
    Recompute();
}

Camera2D CameraSystem::GetCamera() const {
    // Target siempre en el origen y todo el encuadre en "offset": con zoom 1
    // la transformacion es una suma, y en modo Fixed es la MISMA suma que
    // hacia el motor antes de tener camara (ver Recompute).
    return Camera2D{offset_, Vector2{0, 0}, 0.0f, settings_.zoom};
}

Vector2 CameraSystem::ScreenToWorld(Vector2 screenPoint) const {
    return Vector2{(screenPoint.x - offset_.x) / settings_.zoom, (screenPoint.y - offset_.y) / settings_.zoom};
}

Vector2 CameraSystem::WorldToScreen(Vector2 worldPoint) const {
    return Vector2{worldPoint.x * settings_.zoom + offset_.x, worldPoint.y * settings_.zoom + offset_.y};
}

Vector2 CameraSystem::Clamp(Vector2 center, Rectangle bounds) const {
    if (!settings_.clampToBounds || bounds.width <= 0.0f || bounds.height <= 0.0f) {
        return center;
    }
    // Media vista en pixeles del mundo: lo que se ve a cada lado del centro.
    const float halfWidth = screenSize_.x / 2.0f / settings_.zoom;
    const float halfHeight = screenSize_.y / 2.0f / settings_.zoom;
    const auto axis = [](float value, float min, float size, float halfView) {
        // Si el nivel entra entero en la vista en este eje, se centra: no hay
        // posicion valida que no muestre vacio de algun lado.
        if (size <= halfView * 2.0f) {
            return min + size / 2.0f;
        }
        return std::clamp(value, min + halfView, min + size - halfView);
    };
    return Vector2{axis(center.x, bounds.x, bounds.width, halfWidth),
                   axis(center.y, bounds.y, bounds.height, halfHeight)};
}

void CameraSystem::Recompute() {
    const float zoom = settings_.zoom;
    if (settings_.mode == CameraFraming::Fixed) {
        // Sin redondear, a proposito. Con zoom 1 esto da offset_ = (W/2,
        // H/2 - centroY), que es exactamente el "levelOriginY" con que el motor
        // encuadraba antes de tener camara: un nivel sin bloque "camera" se
        // dibuja y se apunta igual que siempre.
        offset_ = Vector2{screenSize_.x / 2.0f - center_.x * zoom, screenSize_.y / 2.0f - center_.y * zoom};
        return;
    }
    // Siguiendo, el desplazamiento se lleva a pixeles enteros: si no, el
    // fondo entero titila al moverse la camara, porque cada frame cae en una
    // fraccion de pixel distinta y el pixel art no se puede interpolar.
    offset_ = Vector2{std::round(std::floor(screenSize_.x / 2.0f) - center_.x * zoom),
                      std::round(std::floor(screenSize_.y / 2.0f) - center_.y * zoom)};
}
