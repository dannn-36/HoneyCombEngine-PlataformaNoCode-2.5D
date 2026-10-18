// Pruebas de CollisionSystem: los pares de cajas (AABB) que se solapan en un
// frame, con el patron Submit/Flush.

#include "doctest/doctest.h"

#include <vector>

#include "systems/collision/CollisionSystem.hpp"

namespace {

bool HasPair(const std::vector<CollisionPair>& pairs, void* a, void* b) {
    for (const auto& pair : pairs) {
        if ((pair.a == a && pair.b == b) || (pair.a == b && pair.b == a)) {
            return true;
        }
    }
    return false;
}

}  // namespace

TEST_SUITE("colisiones") {

TEST_CASE("sin colliders no hay pares") {
    CollisionSystem collisions;
    CHECK(collisions.Flush().empty());
}

TEST_CASE("un collider solo no choca consigo mismo") {
    CollisionSystem collisions;
    int a = 0;
    collisions.Submit(ColliderInstance{&a, Rectangle{0, 0, 10, 10}});
    CHECK(collisions.Flush().empty());
}

TEST_CASE("dos cajas que se solapan dan un par con sus duenos") {
    CollisionSystem collisions;
    int a = 0;
    int b = 0;
    collisions.Submit(ColliderInstance{&a, Rectangle{0, 0, 10, 10}});
    collisions.Submit(ColliderInstance{&b, Rectangle{5, 5, 10, 10}});
    const auto pairs = collisions.Flush();
    REQUIRE(pairs.size() == 1);
    CHECK(pairs[0].a == &a);
    CHECK(pairs[0].b == &b);
}

TEST_CASE("dos cajas separadas no chocan") {
    CollisionSystem collisions;
    int a = 0;
    int b = 0;
    collisions.Submit(ColliderInstance{&a, Rectangle{0, 0, 10, 10}});
    collisions.Submit(ColliderInstance{&b, Rectangle{20, 0, 10, 10}});
    CHECK(collisions.Flush().empty());
}

TEST_CASE("dos cajas que solo se tocan en el borde no chocan") {
    CollisionSystem collisions;
    int a = 0;
    int b = 0;
    collisions.Submit(ColliderInstance{&a, Rectangle{0, 0, 10, 10}});
    collisions.Submit(ColliderInstance{&b, Rectangle{10, 0, 10, 10}});
    CHECK(collisions.Flush().empty());
}

TEST_CASE("solaparse en un solo eje no es chocar") {
    CollisionSystem collisions;
    int a = 0;
    int b = 0;
    collisions.Submit(ColliderInstance{&a, Rectangle{0, 0, 10, 10}});
    collisions.Submit(ColliderInstance{&b, Rectangle{2, 30, 4, 4}});
    CHECK(collisions.Flush().empty());
}

TEST_CASE("una caja dentro de otra choca") {
    CollisionSystem collisions;
    int a = 0;
    int b = 0;
    collisions.Submit(ColliderInstance{&a, Rectangle{0, 0, 100, 100}});
    collisions.Submit(ColliderInstance{&b, Rectangle{40, 40, 5, 5}});
    CHECK(collisions.Flush().size() == 1);
}

TEST_CASE("cada par aparece una sola vez") {
    CollisionSystem collisions;
    int a = 0;
    int b = 0;
    int c = 0;
    int far = 0;
    collisions.Submit(ColliderInstance{&a, Rectangle{0, 0, 10, 10}});
    collisions.Submit(ColliderInstance{&b, Rectangle{2, 2, 10, 10}});
    collisions.Submit(ColliderInstance{&c, Rectangle{4, 4, 10, 10}});
    collisions.Submit(ColliderInstance{&far, Rectangle{500, 500, 1, 1}});
    const auto pairs = collisions.Flush();
    CHECK(pairs.size() == 3);
    CHECK(HasPair(pairs, &a, &b));
    CHECK(HasPair(pairs, &a, &c));
    CHECK(HasPair(pairs, &b, &c));
    CHECK_FALSE(HasPair(pairs, &a, &far));
}

TEST_CASE("flush vacia la cola para el frame siguiente") {
    CollisionSystem collisions;
    int a = 0;
    int b = 0;
    collisions.Submit(ColliderInstance{&a, Rectangle{0, 0, 10, 10}});
    collisions.Submit(ColliderInstance{&b, Rectangle{1, 1, 10, 10}});
    CHECK(collisions.Flush().size() == 1);
    CHECK(collisions.Flush().empty());
}

TEST_CASE("las coordenadas negativas chocan igual") {
    CollisionSystem collisions;
    int a = 0;
    int b = 0;
    collisions.Submit(ColliderInstance{&a, Rectangle{-20, -20, 15, 15}});
    collisions.Submit(ColliderInstance{&b, Rectangle{-10, -10, 15, 15}});
    CHECK(collisions.Flush().size() == 1);
}

}  // TEST_SUITE
