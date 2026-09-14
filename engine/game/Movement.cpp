// Implementacion de Movement. El contrato esta documentado en el .hpp.

#include "Movement.hpp"

#include <algorithm>
#include <cmath>

namespace Movement {

Vector2 HalfExtentsInCells(const LoadedLevel& level, const LevelEntity& entity) {
    return Vector2{
        entity.colliderSize.x / static_cast<float>(level.grid.GetTileWidth()) / 2.0f,
        entity.colliderSize.y / static_cast<float>(level.grid.GetTileHeight()) / 2.0f};
}

Vector2 BoxCenter(const LevelEntity& entity) {
    const float spanOffset = (entity.span - 1) / 2.0f;
    return Vector2{entity.precisePosition.x + spanOffset, entity.precisePosition.y + spanOffset};
}

Vector2 WallHalfExtents(const LevelEntity& entity) {
    const float half = static_cast<float>(entity.span) / 2.0f;
    return Vector2{half, half};
}

Vector2 ClampToGrid(const LoadedLevel& level, Vector2 position) {
    return Vector2{
        std::clamp(position.x, 0.0f, level.grid.GetGridWidth() - 1.0f),
        std::clamp(position.y, 0.0f, level.grid.GetGridHeight() - 1.0f)};
}

bool CanOccupy(const LoadedLevel& level, const LevelEntity& mover, Vector2 candidate,
               const LevelEntity* blocker) {
    const Vector2 half = HalfExtentsInCells(level, mover);

    // Solapamiento contra el cuadrado de una celda: media celda a cada lado de
    // su centro, mas el radio de quien se mueve.
    auto overlapsTile = [&](int col, int row) {
        return std::fabs(candidate.x - static_cast<float>(col)) < 0.5f + half.x &&
               std::fabs(candidate.y - static_cast<float>(row)) < 0.5f + half.y;
    };

    // Una forma irregular tambien es una frontera fisica: no se puede avanzar
    // a una zona que no declara piso.
    bool hasFloor = false;
    for (const auto& tile : level.floorTiles) {
        if (overlapsTile(tile.col, tile.row)) {
            hasFloor = true;
            break;
        }
    }
    if (!hasFloor) {
        return false;
    }

    // Paredes por celda. Sin textura de pared el nivel no tiene paredes: ni se
    // dibujan ni frenan (es la regla de siempre de LevelLoader).
    if (level.wallTexture) {
        for (const auto& tile : level.wallTiles) {
            if (overlapsTile(tile.col, tile.row)) {
                return false;
            }
        }
    }

    auto overlapsBox = [&](Vector2 center, Vector2 otherHalf) {
        return std::fabs(candidate.x - center.x) < half.x + otherHalf.x &&
               std::fabs(candidate.y - center.y) < half.y + otherHalf.y;
    };

    // Caja de quien se mueve contra una elipse: se escala el eje Y para que la
    // elipse sea un circulo y se mide la distancia al punto mas cercano de la caja.
    auto overlapsEllipse = [&](Vector2 center, Vector2 radii) {
        if (radii.x <= 0.0f || radii.y <= 0.0f) {
            return false;
        }
        const float scaleY = radii.x / radii.y;
        const float dx = std::max(std::fabs(candidate.x - center.x) - half.x, 0.0f);
        const float dy = std::max(std::fabs(candidate.y - center.y) - half.y, 0.0f) * scaleY;
        return dx * dx + dy * dy < radii.x * radii.x;
    };

    auto overlapsCollider = [&](const LevelEntity& other) {
        const Vector2 otherHalf = HalfExtentsInCells(level, other);
        const Vector2 center = BoxCenter(other);
        return other.colliderRound ? overlapsEllipse(center, otherHalf) : overlapsBox(center, otherHalf);
    };

    // Entidades que bloquean. Una entidad oculta (una puerta abierta) no
    // bloquea: por eso existe.
    //   Pared    -> todas las celdas de su bloque, sin importar su collider.
    //   Colision -> solo su collider (solid=true), con su forma y tamano.
    // Un collider con solid=false NO bloquea: funciona como sensor, dispara
    // on_collision y nada mas.
    for (const auto& entity : level.entities) {
        if (&entity == &mover || entity.destroyed || entity.hidden) {
            continue;
        }
        if (entity.wall && overlapsBox(BoxCenter(entity), WallHalfExtents(entity))) {
            return false;
        }
        if (entity.colliderSolid && overlapsCollider(entity)) {
            return false;
        }
    }

    if (blocker && blocker != &mover && !blocker->destroyed && !blocker->hidden &&
        overlapsCollider(*blocker)) {
        return false;
    }
    return true;
}

bool TryMove(const LoadedLevel& level, LevelEntity& mover, Vector2 delta,
             const LevelEntity* blocker) {
    const Vector2 from = mover.precisePosition;
    const Vector2 options[] = {
        ClampToGrid(level, {from.x + delta.x, from.y + delta.y}),
        ClampToGrid(level, {from.x + delta.x, from.y}),
        ClampToGrid(level, {from.x, from.y + delta.y}),
    };
    for (const Vector2& candidate : options) {
        if (CanOccupy(level, mover, candidate, blocker)) {
            mover.precisePosition = candidate;
            mover.position = GridCoord{static_cast<int>(std::round(candidate.x)),
                                       static_cast<int>(std::round(candidate.y))};
            return true;
        }
    }
    return false;
}

bool BlocksProjectile(const LoadedLevel& level, Vector2 point, const LevelEntity* ignore) {
    const int col = static_cast<int>(std::round(point.x));
    const int row = static_cast<int>(std::round(point.y));
    const auto sameCell = [col, row](const GridCoord& tile) {
        return tile.col == col && tile.row == row;
    };
    if (std::none_of(level.floorTiles.begin(), level.floorTiles.end(), sameCell)) {
        return true;
    }
    if (level.wallTexture &&
        std::any_of(level.wallTiles.begin(), level.wallTiles.end(), sameCell)) {
        return true;
    }
    for (const auto& entity : level.entities) {
        if (&entity == ignore || entity.destroyed || entity.hidden) {
            continue;
        }
        const Vector2 center = BoxCenter(entity);
        const float dx = std::fabs(point.x - center.x);
        const float dy = std::fabs(point.y - center.y);
        if (entity.wall) {
            const Vector2 wallHalf = WallHalfExtents(entity);
            if (dx < wallHalf.x && dy < wallHalf.y) {
                return true;
            }
        }
        if (!entity.colliderSolid) {
            continue;
        }
        const Vector2 half = HalfExtentsInCells(level, entity);
        if (entity.colliderRound) {
            if (half.x > 0.0f && half.y > 0.0f &&
                (dx * dx) / (half.x * half.x) + (dy * dy) / (half.y * half.y) < 1.0f) {
                return true;
            }
        } else if (dx < half.x && dy < half.y) {
            return true;
        }
    }
    return false;
}

}  // namespace Movement
