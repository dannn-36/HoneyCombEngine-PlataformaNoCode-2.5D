// Pruebas de Zones: las salas y zonas de los puzzles.

#include "doctest/doctest.h"

#include "game/Zones.hpp"
#include "support/TestSupport.hpp"

using TestSupport::MakeEntity;
using TestSupport::OpenLevel;

TEST_SUITE("zonas") {

TEST_CASE("una zona se busca por su id") {
    LoadedLevel level = OpenLevel(6, 6);
    level.zones = {Zone{"a", 0, 0, 2, 2}, Zone{"b", 3, 3, 1, 1}};
    const Zone* zone = Zones::Find(level, "b");
    REQUIRE(zone != nullptr);
    CHECK(zone->col == 3);
    CHECK(Zones::Find(level, "c") == nullptr);
}

TEST_CASE("una zona cubre media celda antes de su primera celda y no incluye el borde final") {
    const Zone zone{"sala", 2, 3, 2, 1};
    CHECK(Zones::Contains(zone, Vector2{1.5f, 2.5f}));
    CHECK(Zones::Contains(zone, Vector2{3.49f, 3.49f}));
    CHECK_FALSE(Zones::Contains(zone, Vector2{3.5f, 3.0f}));
    CHECK_FALSE(Zones::Contains(zone, Vector2{2.0f, 3.5f}));
    CHECK_FALSE(Zones::Contains(zone, Vector2{1.49f, 3.0f}));
}

TEST_CASE("una zona sin enemigos nunca queda limpia") {
    LoadedLevel level = OpenLevel(6, 6);
    level.entities.push_back(MakeEntity("npc", "npc", 1, 1));
    CHECK_FALSE(Zones::IsCleared(level, Zone{"sala", 0, 0, 3, 3}));
}

TEST_CASE("una zona queda limpia cuando caen los enemigos que arrancaron en ella") {
    LoadedLevel level = OpenLevel(8, 8);
    level.entities.push_back(MakeEntity("a", "enemy", 1, 1));
    level.entities.push_back(MakeEntity("b", "enemy", 2, 2));
    level.entities.push_back(MakeEntity("afuera", "enemy", 6, 6));
    const Zone zone{"sala", 0, 0, 3, 3};
    CHECK_FALSE(Zones::IsCleared(level, zone));
    level.entities[0].destroyed = true;
    CHECK_FALSE(Zones::IsCleared(level, zone));
    level.entities[1].destroyed = true;
    CHECK(Zones::IsCleared(level, zone));
}

TEST_CASE("un enemigo que salio persiguiendo sigue contando para su sala") {
    LoadedLevel level = OpenLevel(8, 8);
    level.entities.push_back(MakeEntity("a", "enemy", 1, 1));
    level.entities[0].precisePosition = Vector2{7, 7};
    const Zone zone{"sala", 0, 0, 3, 3};
    CHECK_FALSE(Zones::IsCleared(level, zone));

    // Y uno que entro desde afuera no cuenta.
    LoadedLevel other = OpenLevel(8, 8);
    other.entities.push_back(MakeEntity("intruso", "enemy", 6, 6));
    other.entities[0].precisePosition = Vector2{1, 1};
    CHECK_FALSE(Zones::IsCleared(other, zone));
}

TEST_CASE("un enemigo grande cuenta desde el centro de su bloque") {
    LoadedLevel level = OpenLevel(8, 8);
    LevelEntity big = MakeEntity("jefe", "enemy", 2, 2);
    big.span = 3;  // centro en (3,3)
    level.entities.push_back(big);
    level.entities[0].destroyed = true;
    CHECK_FALSE(Zones::IsCleared(level, Zone{"chica", 0, 0, 3, 3}));
    CHECK(Zones::IsCleared(level, Zone{"grande", 0, 0, 4, 4}));
}

}  // TEST_SUITE
