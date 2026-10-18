// Pruebas de Movement: por donde se puede caminar. Es la colision del juego
// contra el mapa (piso, paredes por celda, entidades pared y colliders
// solidos), que comparten el jugador, los enemigos y los proyectiles.

#include "doctest/doctest.h"

#include "game/Movement.hpp"
#include "support/TestSupport.hpp"

using TestSupport::MakeEntity;
using TestSupport::OpenLevel;

namespace {

// Un collider de una celda entera (64x32 pixeles en un tile de 64x32): media
// celda por lado.
LevelEntity Solid(const std::string& id, float col, float row, bool round = false) {
    LevelEntity entity = MakeEntity(id, "prop", col, row);
    entity.colliderSize = Vector2{64, 32};
    entity.colliderSolid = true;
    entity.colliderRound = round;
    return entity;
}

}  // namespace

TEST_SUITE("movimiento") {

TEST_CASE("el collider se pasa de pixeles a celdas") {
    const LoadedLevel level = OpenLevel(5, 5);
    LevelEntity entity = MakeEntity("a", "player", 0, 0);
    entity.colliderSize = Vector2{32, 16};
    const Vector2 half = Movement::HalfExtentsInCells(level, entity);
    CHECK(half.x == doctest::Approx(0.25f));
    CHECK(half.y == doctest::Approx(0.25f));
}

TEST_CASE("el centro de una entidad grande esta en el medio de su bloque") {
    LevelEntity entity = MakeEntity("a", "prop", 1, 1);
    entity.span = 3;
    const Vector2 center = Movement::BoxCenter(entity);
    CHECK(center.x == doctest::Approx(2.0f));
    CHECK(center.y == doctest::Approx(2.0f));
    CHECK(Movement::WallHalfExtents(entity).x == doctest::Approx(1.5f));
}

TEST_CASE("una posicion se lleva al interior de la grilla") {
    const LoadedLevel level = OpenLevel(5, 4);
    const Vector2 clamped = Movement::ClampToGrid(level, Vector2{-1.0f, 10.0f});
    CHECK(clamped.x == doctest::Approx(0.0f));
    CHECK(clamped.y == doctest::Approx(3.0f));
}

TEST_CASE("no se puede estar donde no hay piso") {
    LoadedLevel level = OpenLevel(5, 5);
    level.floorTiles = {GridCoord{0, 0}};
    const LevelEntity mover = MakeEntity("m", "player", 0, 0);
    CHECK(Movement::CanOccupy(level, mover, Vector2{0.4f, 0.0f}));
    CHECK_FALSE(Movement::CanOccupy(level, mover, Vector2{2.0f, 2.0f}));
}

// Una entidad sin collider (half = 0) parada EXACTAMENTE en el borde entre dos
// casillas con piso (x = 6.5) esta sobre piso. Antes CanOccupy comparaba con <
// estricto, no tocaba ninguna de las dos y TryMove la dejaba clavada (pasaba
// con un esquive de 3 celdas en 0.2 s a 10 FPS de paso).
TEST_CASE("el borde entre dos casillas con piso tambien es piso") {
    const LoadedLevel level = OpenLevel(10, 10);
    const LevelEntity mover = MakeEntity("m", "player", 5, 5);
    CHECK(Movement::CanOccupy(level, mover, Vector2{6.5f, 5.0f}));
}

TEST_CASE("el borde de una pared no frena: rozarla no es atravesarla") {
    LoadedLevel level = OpenLevel(10, 10);
    level.wallTiles = {GridCoord{7, 5}};
    level.wallTexture = TestSupport::WallTextureFlag();
    const LevelEntity mover = MakeEntity("m", "player", 5, 5);
    CHECK(Movement::CanOccupy(level, mover, Vector2{6.5f, 5.0f}));
    CHECK_FALSE(Movement::CanOccupy(level, mover, Vector2{6.6f, 5.0f}));
}

TEST_CASE("el borde de afuera del ultimo piso no lleva a la nada") {
    // Con piso solo en (0,0), a mas de media celda ya no hay piso.
    LoadedLevel level = OpenLevel(5, 5);
    level.floorTiles = {GridCoord{0, 0}};
    const LevelEntity mover = MakeEntity("m", "player", 0, 0);
    CHECK(Movement::CanOccupy(level, mover, Vector2{0.5f, 0.0f}));
    CHECK_FALSE(Movement::CanOccupy(level, mover, Vector2{0.6f, 0.0f}));
}

TEST_CASE("las paredes por celda solo frenan si el nivel tiene textura de pared") {
    LoadedLevel level = OpenLevel(5, 5);
    level.wallTiles = {GridCoord{2, 2}};
    const LevelEntity mover = MakeEntity("m", "player", 0, 0);
    CHECK(Movement::CanOccupy(level, mover, Vector2{2.0f, 2.0f}));
    level.wallTexture = TestSupport::WallTextureFlag();
    CHECK_FALSE(Movement::CanOccupy(level, mover, Vector2{2.0f, 2.0f}));
    CHECK(Movement::CanOccupy(level, mover, Vector2{2.6f, 2.0f}));
}

TEST_CASE("el tamano de quien se mueve cuenta contra la pared") {
    LoadedLevel level = OpenLevel(5, 5);
    level.wallTiles = {GridCoord{2, 2}};
    level.wallTexture = TestSupport::WallTextureFlag();
    LevelEntity mover = MakeEntity("m", "player", 0, 0);
    mover.colliderSize = Vector2{32, 16};  // 0.25 celdas por lado
    CHECK_FALSE(Movement::CanOccupy(level, mover, Vector2{2.6f, 2.0f}));
    CHECK(Movement::CanOccupy(level, mover, Vector2{2.8f, 2.0f}));
}

TEST_CASE("un collider solido bloquea y un sensor no") {
    LoadedLevel level = OpenLevel(5, 5);
    level.entities.push_back(Solid("caja", 2, 2));
    const LevelEntity mover = MakeEntity("m", "player", 0, 0);
    CHECK_FALSE(Movement::CanOccupy(level, mover, Vector2{2.4f, 2.0f}));
    CHECK(Movement::CanOccupy(level, mover, Vector2{2.6f, 2.0f}));

    level.entities.back().colliderSolid = false;
    CHECK(Movement::CanOccupy(level, mover, Vector2{2.4f, 2.0f}));
}

TEST_CASE("una entidad oculta o destruida no bloquea") {
    LoadedLevel level = OpenLevel(5, 5);
    level.entities.push_back(Solid("puerta", 2, 2));
    const LevelEntity mover = MakeEntity("m", "player", 0, 0);
    level.entities.back().hidden = true;
    CHECK(Movement::CanOccupy(level, mover, Vector2{2.0f, 2.0f}));
    level.entities.back().hidden = false;
    level.entities.back().destroyed = true;
    CHECK(Movement::CanOccupy(level, mover, Vector2{2.0f, 2.0f}));
}

TEST_CASE("una entidad pared bloquea su bloque entero sin importar el collider") {
    LoadedLevel level = OpenLevel(6, 6);
    LevelEntity wall = MakeEntity("muro", "prop", 1, 1);
    wall.span = 2;
    wall.wall = true;
    level.entities.push_back(wall);
    const LevelEntity mover = MakeEntity("m", "player", 0, 0);
    CHECK_FALSE(Movement::CanOccupy(level, mover, Vector2{2.4f, 2.4f}));
    CHECK_FALSE(Movement::CanOccupy(level, mover, Vector2{1.0f, 1.0f}));
    CHECK(Movement::CanOccupy(level, mover, Vector2{2.6f, 1.2f}));
}

TEST_CASE("un collider redondo deja pasar por la esquina de su caja") {
    LoadedLevel level = OpenLevel(5, 5);
    level.entities.push_back(Solid("barril", 2, 2, true));
    const LevelEntity mover = MakeEntity("m", "player", 0, 0);
    CHECK(Movement::CanOccupy(level, mover, Vector2{2.4f, 2.4f}));
    CHECK_FALSE(Movement::CanOccupy(level, mover, Vector2{2.3f, 2.0f}));

    level.entities.back().colliderRound = false;
    CHECK_FALSE(Movement::CanOccupy(level, mover, Vector2{2.4f, 2.4f}));
}

TEST_CASE("quien se mueve nunca choca consigo mismo") {
    LoadedLevel level = OpenLevel(5, 5);
    level.entities.push_back(Solid("jugador", 2, 2));
    CHECK(Movement::CanOccupy(level, level.entities.back(), Vector2{2.0f, 2.0f}));
}

TEST_CASE("el bloqueador extra cuenta como solido aunque no lo sea") {
    LoadedLevel level = OpenLevel(5, 5);
    LevelEntity player = MakeEntity("jugador", "player", 3, 3);
    player.colliderSize = Vector2{64, 32};
    const LevelEntity enemy = MakeEntity("orco", "enemy", 0, 0);
    CHECK(Movement::CanOccupy(level, enemy, Vector2{3.0f, 3.0f}));
    CHECK_FALSE(Movement::CanOccupy(level, enemy, Vector2{3.0f, 3.0f}, &player));
    player.hidden = true;
    CHECK(Movement::CanOccupy(level, enemy, Vector2{3.0f, 3.0f}, &player));
}

TEST_CASE("moverse sin obstaculos llega al destino y actualiza la celda") {
    const LoadedLevel level = OpenLevel(5, 5);
    LevelEntity mover = MakeEntity("m", "player", 1, 1);
    CHECK(Movement::TryMove(level, mover, Vector2{0.6f, 1.2f}));
    CHECK(mover.precisePosition.x == doctest::Approx(1.6f));
    CHECK(mover.precisePosition.y == doctest::Approx(2.2f));
    CHECK(mover.position.col == 2);
    CHECK(mover.position.row == 2);
}

TEST_CASE("contra una pared en diagonal se desliza por el eje libre") {
    LoadedLevel level = OpenLevel(5, 5);
    level.wallTexture = TestSupport::WallTextureFlag();
    for (int row = 0; row < 5; ++row) {
        level.wallTiles.push_back(GridCoord{2, row});
    }
    LevelEntity mover = MakeEntity("m", "player", 1, 1);
    CHECK(Movement::TryMove(level, mover, Vector2{0.8f, 0.3f}));
    CHECK(mover.precisePosition.x == doctest::Approx(1.0f));
    CHECK(mover.precisePosition.y == doctest::Approx(1.3f));
}

TEST_CASE("encerrado no se mueve y lo informa") {
    LoadedLevel level = OpenLevel(3, 3);
    level.floorTiles = {GridCoord{1, 1}};
    LevelEntity mover = MakeEntity("m", "player", 1, 1);
    CHECK_FALSE(Movement::TryMove(level, mover, Vector2{1.0f, 1.0f}));
    CHECK(mover.precisePosition.x == doctest::Approx(1.0f));
    CHECK(mover.precisePosition.y == doctest::Approx(1.0f));
}

TEST_CASE("moverse nunca saca a la entidad de la grilla") {
    const LoadedLevel level = OpenLevel(5, 5);
    LevelEntity mover = MakeEntity("m", "player", 4, 4);
    Movement::TryMove(level, mover, Vector2{3.0f, 3.0f});
    CHECK(mover.precisePosition.x == doctest::Approx(4.0f));
    CHECK(mover.precisePosition.y == doctest::Approx(4.0f));
}

TEST_CASE("un proyectil choca fuera del piso y contra las paredes") {
    LoadedLevel level = OpenLevel(5, 5);
    CHECK_FALSE(Movement::BlocksProjectile(level, Vector2{2.0f, 2.0f}, nullptr));
    CHECK(Movement::BlocksProjectile(level, Vector2{7.0f, 2.0f}, nullptr));
    level.wallTiles = {GridCoord{2, 2}};
    CHECK_FALSE(Movement::BlocksProjectile(level, Vector2{2.2f, 1.9f}, nullptr));
    level.wallTexture = TestSupport::WallTextureFlag();
    CHECK(Movement::BlocksProjectile(level, Vector2{2.2f, 1.9f}, nullptr));
}

TEST_CASE("un proyectil choca contra entidades solidas y pared pero no contra quien lo tiro") {
    LoadedLevel level = OpenLevel(6, 6);
    level.entities.push_back(Solid("caja", 2, 2));
    LevelEntity wall = MakeEntity("muro", "prop", 4, 4);
    wall.wall = true;
    level.entities.push_back(wall);
    level.entities.push_back(Solid("barril", 4, 1, true));
    LevelEntity sensor = Solid("sensor", 1, 4);
    sensor.colliderSolid = false;
    level.entities.push_back(sensor);

    CHECK(Movement::BlocksProjectile(level, Vector2{2.3f, 2.3f}, nullptr));
    CHECK_FALSE(Movement::BlocksProjectile(level, Vector2{2.3f, 2.3f}, &level.entities[0]));
    CHECK(Movement::BlocksProjectile(level, Vector2{4.2f, 4.2f}, nullptr));
    // Elipse de radio media celda: el centro choca, la esquina de su caja no.
    CHECK(Movement::BlocksProjectile(level, Vector2{4.1f, 1.1f}, nullptr));
    CHECK_FALSE(Movement::BlocksProjectile(level, Vector2{4.4f, 1.4f}, nullptr));
    CHECK_FALSE(Movement::BlocksProjectile(level, Vector2{1.0f, 4.0f}, nullptr));
}

}  // TEST_SUITE
