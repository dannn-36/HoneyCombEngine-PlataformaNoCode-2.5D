// Pruebas de Mobility: caminar (con la conversion pantalla -> grilla
// isometrica), esquivar y defender.

#include "doctest/doctest.h"

#include <cmath>

#include "game/Mobility.hpp"
#include "support/TestSupport.hpp"

using TestSupport::MakeEntity;
using TestSupport::OpenLevel;

namespace {

LevelEntity Player() {
    LevelEntity player = MakeEntity("jugador", "player", 5, 5);
    player.speed = 3.0f;
    return player;
}

Mobility::Intent Walk(float x, float y) {
    Mobility::Intent intent;
    intent.screenDirection = Vector2{x, y};
    return intent;
}

float Moved(const LevelEntity& player) {
    return std::hypot(player.precisePosition.x - 5.0f, player.precisePosition.y - 5.0f);
}

}  // namespace

TEST_SUITE("movilidad del jugador") {

TEST_CASE("arriba en pantalla es en diagonal dentro de la grilla") {
    const LoadedLevel level = OpenLevel(10, 10);
    LevelEntity player = Player();
    Mobility::State state;
    Mobility::UpdatePlayer(level, player, state, Walk(0, -1), 0.1f);
    // Arriba visual = -col y -row a la vez.
    CHECK(player.precisePosition.x < 5.0f);
    CHECK(player.precisePosition.y < 5.0f);
    CHECK(player.precisePosition.x == doctest::Approx(player.precisePosition.y));
    CHECK(Moved(player) == doctest::Approx(0.3f));
}

TEST_CASE("derecha en pantalla suma columnas y resta filas") {
    const LoadedLevel level = OpenLevel(10, 10);
    LevelEntity player = Player();
    Mobility::State state;
    Mobility::UpdatePlayer(level, player, state, Walk(1, 0), 0.1f);
    CHECK(player.precisePosition.x > 5.0f);
    CHECK(player.precisePosition.y < 5.0f);
    CHECK(state.facing.x == doctest::Approx(1.0f / std::sqrt(2.0f)));
    CHECK(state.facing.y == doctest::Approx(-1.0f / std::sqrt(2.0f)));
}

TEST_CASE("en diagonal no se va mas rapido") {
    const LoadedLevel level = OpenLevel(10, 10);
    LevelEntity player = Player();
    Mobility::State state;
    Mobility::UpdatePlayer(level, player, state, Walk(1, -1), 0.1f);
    CHECK(Moved(player) == doctest::Approx(0.3f));
}

TEST_CASE("quieto no se mueve ni cambia hacia donde mira") {
    const LoadedLevel level = OpenLevel(10, 10);
    LevelEntity player = Player();
    Mobility::State state;
    Mobility::UpdatePlayer(level, player, state, Walk(0, 0), 0.1f);
    CHECK(Moved(player) == doctest::Approx(0.0f));
    CHECK(state.facing.x == doctest::Approx(1.0f));
    CHECK(state.facing.y == doctest::Approx(0.0f));
}

TEST_CASE("el esquive recorre su distancia en su duracion y da invulnerabilidad") {
    const LoadedLevel level = OpenLevel(10, 10);
    LevelEntity player = Player();
    player.dash.enabled = true;
    // 2.4 y no 3 celdas: con 3, el primer paso cae justo en x = 6.5, el
    // borde entre dos casillas, y una entidad sin collider no "pisa" ninguna
    // de las dos (Movement compara con < estricto).
    player.dash.distance = 2.4f;
    player.dash.duration = 0.2f;
    player.dash.cooldown = 0.8f;
    player.dash.iframes = 0.25f;
    Mobility::State state;
    Mobility::Intent intent;
    intent.dashPressed = true;
    intent.aimDirection = Vector2{1, 0};

    Mobility::UpdatePlayer(level, player, state, intent, 0.1f);
    CHECK(Mobility::IsDashing(state));
    CHECK(Mobility::IsInvulnerable(state));
    // La pausa corre desde que termina: cooldown + duracion.
    CHECK(state.dashCooldown == doctest::Approx(1.0f));
    CHECK(player.precisePosition.x == doctest::Approx(6.2f));

    Mobility::UpdatePlayer(level, player, state, Mobility::Intent{}, 0.1f);
    CHECK_FALSE(Mobility::IsDashing(state));
    CHECK(player.precisePosition.x == doctest::Approx(7.4f));
    CHECK(player.precisePosition.y == doctest::Approx(5.0f));
}

TEST_CASE("no se puede esquivar de nuevo durante la pausa") {
    const LoadedLevel level = OpenLevel(20, 20);
    LevelEntity player = Player();
    player.dash.enabled = true;
    Mobility::State state;
    state.dashCooldown = 0.5f;
    Mobility::Intent intent;
    intent.dashPressed = true;
    Mobility::UpdatePlayer(level, player, state, intent, 0.1f);
    CHECK_FALSE(Mobility::IsDashing(state));
    CHECK(state.dashCooldown == doctest::Approx(0.4f));
}

TEST_CASE("sin esquive configurado la tecla no hace nada") {
    const LoadedLevel level = OpenLevel(10, 10);
    LevelEntity player = Player();
    Mobility::State state;
    Mobility::Intent intent;
    intent.dashPressed = true;
    Mobility::UpdatePlayer(level, player, state, intent, 0.1f);
    CHECK_FALSE(Mobility::IsDashing(state));
    CHECK(Moved(player) == doctest::Approx(0.0f));
}

TEST_CASE("esquivar quieto y sin apuntar va hacia donde mira") {
    const LoadedLevel level = OpenLevel(20, 20);
    LevelEntity player = Player();
    player.dash.enabled = true;
    Mobility::State state;
    state.facing = Vector2{0, 1};
    Mobility::Intent intent;
    intent.dashPressed = true;
    Mobility::UpdatePlayer(level, player, state, intent, 0.01f);
    CHECK(state.dashDirection.x == doctest::Approx(0.0f));
    CHECK(state.dashDirection.y == doctest::Approx(1.0f));
}

TEST_CASE("defender frena al jugador y solo si tiene defensa") {
    const LoadedLevel level = OpenLevel(10, 10);
    LevelEntity player = Player();
    Mobility::State state;
    Mobility::Intent intent = Walk(1, -1);
    intent.defendHeld = true;
    Mobility::UpdatePlayer(level, player, state, intent, 0.1f);
    CHECK_FALSE(state.defending);
    CHECK(Moved(player) == doctest::Approx(0.3f));

    LevelEntity defender = Player();
    defender.defense.enabled = true;
    defender.defense.speedMultiplier = 0.5f;
    Mobility::State defenderState;
    Mobility::UpdatePlayer(level, defender, defenderState, intent, 0.1f);
    CHECK(defenderState.defending);
    CHECK(Moved(defender) == doctest::Approx(0.15f));
}

TEST_CASE("esquivar corta la defensa") {
    const LoadedLevel level = OpenLevel(20, 20);
    LevelEntity player = Player();
    player.dash.enabled = true;
    player.defense.enabled = true;
    Mobility::State state;
    Mobility::Intent intent;
    intent.defendHeld = true;
    intent.dashPressed = true;
    intent.aimDirection = Vector2{1, 0};
    Mobility::UpdatePlayer(level, player, state, intent, 0.05f);
    CHECK(Mobility::IsDashing(state));
    CHECK_FALSE(state.defending);
}

}  // TEST_SUITE
