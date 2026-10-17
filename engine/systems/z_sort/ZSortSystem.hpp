#pragma once

#include <vector>

#include "raylib.h"

#include "core/GraphicsDevice.hpp"

// Capas de dibujo. El suelo es un caso aparte: no compite en profundidad con
// nadie, siempre queda debajo. Paredes y entidades si se intercalan entre si
// segun su Y en pantalla, y la capa solo los desempata a igual profundidad.
namespace SpriteLayer {
    constexpr int Ground = 0;  // piso: plano de fondo, nunca tapa nada
    constexpr int Object = 1;  // paredes y props apoyados en la grilla
    constexpr int Entity = 2;  // jugador, enemigos, objetos moviles
}

struct SpriteInstance {
    const Texture2D* texture;
    Rectangle source;

    Vector2 screenPosition;  // dónde se dibuja el sprite
    Vector2 sortPosition;    // punto de apoyo para profundidad

    Vector2 origin;
    float rotation;
    Color tint;
    int layer = SpriteLayer::Ground;
    Vector2 destinationSize = Vector2{0, 0};
};

// Ordena sprites por profundidad (algoritmo del pintor: menor Y en pantalla
// primero) y los dibuja via GraphicsDevice. No conoce grillas ni coordenadas
// de mundo -- solo posiciones ya proyectadas a pantalla -- para servir tanto
// a tiles alineados a la grilla como a entidades que se mueven libremente.
//
// Dos cosas para no hacer trabajo de mas en cada frame:
//   - RECORTE: con SetView, lo que cae fuera de la camara ni se encola. No se
//     ordena ni se dibuja, y en un mapa grande eso es casi todo.
//   - PISO APARTE: el piso no entra al ordenamiento. Va en su propia lista y se
//     dibuja primero, en el orden en que llego: quien lo encola ya lo manda de
//     atras hacia adelante (ver GameSession::PrepareLevel), asi que ordenarlo
//     de nuevo cada frame era trabajo repetido.
class ZSortSystem {
public:
    // Lo que paso en el ultimo Flush, para el panel de depuracion (F3).
    struct Stats {
        int ground = 0;  // piso dibujado, sin ordenar
        int sorted = 0;  // paredes y entidades: lo unico que se ordena
        int culled = 0;  // fuera de la camara: ni se encolo
    };

    explicit ZSortSystem(GraphicsDevice& gfx);

    // La porcion del mundo que se ve. Un rectangulo de ancho 0 apaga el recorte.
    void SetView(Rectangle view);

    void Submit(const SpriteInstance& sprite);
    void Flush();

    const Stats& LastStats() const { return lastStats_; }

private:
    void Draw(const SpriteInstance& sprite) const;

    GraphicsDevice& gfx_;
    std::vector<SpriteInstance> ground_;
    std::vector<SpriteInstance> queue_;
    Rectangle view_{0, 0, 0, 0};
    Stats stats_;
    Stats lastStats_;
};
