// Implementacion de ZSortSystem. El contrato de la clase esta en el .hpp.
//
// La idea entera del archivo: durante el frame nadie dibuja: todos ENCOLAN con
// Submit(). Al final del frame, Flush() ordena la cola por profundidad y recien
// ahi dibuja. Eso es lo que hace que en isometrico una pared pueda tapar a un
// personaje que se encolo despues que ella.

#include "ZSortSystem.hpp"

#include <algorithm>
#include <cmath>

namespace {

// Donde cae el sprite en el mundo. destinationSize en {0,0} significa "sin
// escalar": se dibuja al tamano original del recorte del spritesheet.
Rectangle DestinationOf(const SpriteInstance& sprite) {
    return Rectangle{
        sprite.screenPosition.x, sprite.screenPosition.y,
        sprite.destinationSize.x > 0 ? sprite.destinationSize.x : sprite.source.width,
        sprite.destinationSize.y > 0 ? sprite.destinationSize.y : sprite.source.height
    };
}

}  // namespace

ZSortSystem::ZSortSystem(GraphicsDevice& gfx) : gfx_(gfx) {}

void ZSortSystem::SetView(Rectangle view) {
    view_ = view;
}

// Encolar es barato a proposito: no ordena ni dibuja nada. Todo el trabajo se
// hace de una sola vez en Flush(). Lo unico que se decide aca es si vale la
// pena: lo que la camara no ve se descarta antes de que cueste nada.
void ZSortSystem::Submit(const SpriteInstance& sprite) {
    // Un sprite rotado ocupa otra caja que la de su destino: se dibuja siempre
    // antes que arriesgar recortarlo mal. Hoy no hay ninguno.
    if (view_.width > 0 && sprite.rotation == 0.0f) {
        const Rectangle dest = DestinationOf(sprite);
        // fabs: un recorte con ancho negativo es un sprite espejado, no vacio.
        const Rectangle bounds{dest.x, dest.y, std::fabs(dest.width), std::fabs(dest.height)};
        if (!CheckCollisionRecs(bounds, view_)) {
            ++stats_.culled;
            return;
        }
    }

    if (sprite.layer <= SpriteLayer::Ground) {
        ground_.push_back(sprite);
    } else {
        queue_.push_back(sprite);
    }
}

void ZSortSystem::Draw(const SpriteInstance& sprite) const {
    gfx_.DrawSprite(*sprite.texture, sprite.source, DestinationOf(sprite),
                    sprite.origin, sprite.rotation, sprite.tint);
}

// Dibuja el piso, despues ordena el resto por profundidad y lo dibuja de una
// sola pasada, dejando las colas vacias para el frame siguiente.
void ZSortSystem::Flush() {
    // El piso va entero primero, sin ordenar: es el plano sobre el que se
    // apoya todo lo demas. Si compitiera por Y con el resto, una baldosa por
    // delante del jugador (Y mayor) se dibujaria encima y lo taparia.
    for (const auto& sprite : ground_) {
        Draw(sprite);
    }

    // Algoritmo del pintor: lo que esta mas "atras" (menor Y en pantalla) se
    // dibuja primero, para que lo de adelante lo tape. En isometrico, la Y de
    // pantalla del punto de apoyo es exactamente la profundidad.
    //
    // Se usa sortPosition y no screenPosition a proposito: screenPosition
    // incluye los offsets visuales (centrar el sprite, levantar una pared), y
    // ordenar por eso daria un orden equivocado.
    std::sort(queue_.begin(), queue_.end(),
        [](const SpriteInstance& a, const SpriteInstance& b) {
            if (a.sortPosition.y != b.sortPosition.y) {
                return a.sortPosition.y < b.sortPosition.y;
            }

            // En un empate, el layer garantiza pared -> entidad sin depender
            // del orden en que se hayan encolado.
            return a.layer < b.layer;
        });

    for (const auto& sprite : queue_) {
        Draw(sprite);
    }

    stats_.ground = static_cast<int>(ground_.size());
    stats_.sorted = static_cast<int>(queue_.size());
    lastStats_ = stats_;
    stats_ = Stats{};

    // Las colas son por frame: quien dibuja vuelve a encolar todo el frame que viene.
    ground_.clear();
    queue_.clear();
}
