// Pruebas de Combat: el ataque del jugador con y sin arma, las seis formas de
// ataque, las habilidades, la defensa y lo que hacen los enemigos.
//
// Todas las medidas van en celdas. Los enemigos de prueba no se mueven
// (speed 0) ni pegan (damage 0) salvo que la prueba lo pida, para que cada
// caso mire una sola regla.

#include "doctest/doctest.h"

#include <algorithm>

#include "game/Combat.hpp"
#include "game/Inventory.hpp"
#include "support/TestSupport.hpp"

using TestSupport::MakeEntity;
using TestSupport::OpenLevel;

namespace {

// Un nivel de 12x12 con el jugador en (5,5) y los enemigos que se agreguen.
// player apunta dentro de level.entities: se rearma despues de cada Add.
struct CombatFixture {
    LoadedLevel level = OpenLevel(12, 12);
    Combat::State state;
    Inventory inventory;
    std::size_t playerIndex = 0;

    CombatFixture() {
        LevelEntity player = MakeEntity("jugador", "player", 5, 5);
        player.damage = 10.0f;
        level.entities.push_back(player);
    }

    LevelEntity& Player() { return level.entities[playerIndex]; }

    std::size_t AddEnemy(float col, float row, float health = 30.0f) {
        LevelEntity enemy = MakeEntity("enemigo" + std::to_string(level.entities.size()), "enemy", col, row);
        enemy.health = health;
        enemy.maxHealth = health;
        enemy.speed = 0.0f;
        enemy.damage = 0.0f;
        level.entities.push_back(enemy);
        return level.entities.size() - 1;
    }

    LevelEntity& At(std::size_t index) { return level.entities[index]; }

    Combat::FrameResult Step(const Combat::PlayerIntent& intent, float deltaTime = 0.1f) {
        return Combat::Update(level, state, &Player(), inventory, intent, deltaTime);
    }

    Combat::FrameResult Idle(float deltaTime = 0.1f) { return Step(Combat::PlayerIntent{}, deltaTime); }

    Combat::FrameResult Attack(Vector2 aim, float deltaTime = 0.1f) {
        Combat::PlayerIntent intent;
        intent.aim = aim;
        intent.attack = true;
        return Step(intent, deltaTime);
    }

    // Corre frames sin atacar hasta que no queden proyectiles ni areas en curso.
    void Settle() {
        for (int frame = 0; frame < 100 && (!state.projectiles.empty() || !state.pendingAreas.empty()); ++frame) {
            Idle();
        }
    }

    void Equip(const ItemDef& weapon) {
        ItemDef dropped;
        inventory.AddWeapon(weapon, false, dropped);
    }
};

ItemDef Weapon(const std::string& id, AttackDef attack) {
    ItemDef item;
    item.id = id;
    item.name = id;
    item.kind = ItemKind::Weapon;
    item.weapon.attack = attack;
    return item;
}

AttackDef Attack(AttackPattern pattern, float damage = 10.0f) {
    AttackDef attack;
    attack.pattern = pattern;
    attack.damage = damage;
    attack.cooldown = 0.0f;
    return attack;
}

}  // namespace

TEST_SUITE("combate") {

TEST_CASE("solo el type enemy es enemigo y lo oculto no pelea") {
    LevelEntity entity = MakeEntity("a", "enemy", 0, 0);
    CHECK(Combat::IsEnemy(entity));
    CHECK(Combat::IsActive(entity));
    entity.hidden = true;
    CHECK_FALSE(Combat::IsActive(entity));
    entity.hidden = false;
    entity.destroyed = true;
    CHECK_FALSE(Combat::IsActive(entity));
    CHECK_FALSE(Combat::IsEnemy(MakeEntity("b", "npc", 0, 0)));
}

TEST_CASE("el golpe sin arma es un area con el dano propio") {
    LevelEntity entity = MakeEntity("a", "player", 0, 0);
    entity.damage = 12.0f;
    const AttackDef attack = Combat::UnarmedAttack(entity);
    CHECK(attack.pattern == AttackPattern::Area);
    CHECK(attack.damage == doctest::Approx(12.0f));
    CHECK(attack.range == doctest::Approx(1.5f));
}

TEST_CASE("un golpe sin arma dana a los enemigos cercanos y no a los lejanos") {
    CombatFixture fx;
    const auto near = fx.AddEnemy(6, 5);
    const auto far = fx.AddEnemy(8, 5);
    fx.Attack(Vector2{6, 5});
    CHECK(fx.At(near).health == doctest::Approx(20.0f));
    CHECK(fx.At(near).hurtTimer > 0.0f);
    CHECK(fx.At(far).health == doctest::Approx(30.0f));
    CHECK(fx.Player().attackTimer == doctest::Approx(0.4f));
    CHECK(fx.state.effects.size() == 1);
}

TEST_CASE("despues de pegar hay que esperar la pausa del ataque") {
    CombatFixture fx;
    const auto enemy = fx.AddEnemy(6, 5, 100.0f);
    fx.Attack(Vector2{6, 5});
    fx.Attack(Vector2{6, 5}, 0.1f);
    CHECK(fx.At(enemy).health == doctest::Approx(90.0f));
    fx.Attack(Vector2{6, 5}, 0.35f);
    CHECK(fx.At(enemy).health == doctest::Approx(80.0f));
}

TEST_CASE("un enemigo sin vida queda destruido y se informa") {
    CombatFixture fx;
    const auto enemy = fx.AddEnemy(6, 5, 5.0f);
    const Combat::FrameResult result = fx.Attack(Vector2{6, 5});
    CHECK(fx.At(enemy).destroyed);
    CHECK(fx.At(enemy).health == doctest::Approx(0.0f));
    REQUIRE(result.defeated.size() == 1);
    CHECK(result.defeated[0] == &fx.At(enemy));
}

TEST_CASE("un enemigo oculto no recibe golpes") {
    CombatFixture fx;
    const auto enemy = fx.AddEnemy(6, 5);
    fx.At(enemy).hidden = true;
    fx.Attack(Vector2{6, 5});
    CHECK(fx.At(enemy).health == doctest::Approx(30.0f));
}

TEST_CASE("defendiendo no se ataca") {
    CombatFixture fx;
    const auto enemy = fx.AddEnemy(6, 5);
    Combat::PlayerIntent intent;
    intent.aim = Vector2{6, 5};
    intent.attack = true;
    intent.defending = true;
    fx.Step(intent);
    CHECK(fx.At(enemy).health == doctest::Approx(30.0f));
}

TEST_CASE("un enemigo sin arma pega por contacto con pausa entre golpes") {
    CombatFixture fx;
    const auto enemy = fx.AddEnemy(5.5f, 5);
    fx.At(enemy).damage = 10.0f;
    fx.Idle(0.016f);
    CHECK(fx.Player().health == doctest::Approx(90.0f));
    fx.Idle(0.016f);
    CHECK(fx.Player().health == doctest::Approx(90.0f));
    fx.Idle(1.0f);
    CHECK(fx.Player().health == doctest::Approx(80.0f));
}

TEST_CASE("defender reduce el dano y el esquive lo anula") {
    CombatFixture fx;
    const auto enemy = fx.AddEnemy(5.5f, 5);
    fx.At(enemy).damage = 10.0f;
    Combat::PlayerIntent defending;
    defending.defending = true;
    defending.defenseReduction = 0.5f;
    fx.Step(defending);
    CHECK(fx.Player().health == doctest::Approx(95.0f));

    fx.At(enemy).attackTimer = 0.0f;
    Combat::PlayerIntent dodging;
    dodging.invulnerable = true;
    fx.Step(dodging, 0.0f);
    CHECK(fx.Player().health == doctest::Approx(95.0f));
}

TEST_CASE("el jugador sin vida pierde el nivel") {
    CombatFixture fx;
    fx.Player().health = 5.0f;
    const auto enemy = fx.AddEnemy(5.5f, 5);
    fx.At(enemy).damage = 10.0f;
    const Combat::FrameResult result = fx.Idle();
    CHECK(result.playerDefeated);
    CHECK(fx.Player().health == doctest::Approx(0.0f));
    CHECK_FALSE(fx.Player().destroyed);
}

TEST_CASE("un enemigo persigue al jugador solo si lo tiene a la vista") {
    LoadedLevel level = OpenLevel(20, 20);
    Combat::State state;
    Inventory inventory;
    level.entities.push_back(MakeEntity("jugador", "player", 5, 5));
    LevelEntity nearEnemy = MakeEntity("cerca", "enemy", 9, 5);
    nearEnemy.speed = 2.0f;
    level.entities.push_back(nearEnemy);
    LevelEntity farEnemy = MakeEntity("lejos", "enemy", 5, 15);
    farEnemy.speed = 2.0f;
    level.entities.push_back(farEnemy);
    Combat::Update(level, state, &level.entities[0], inventory, Combat::PlayerIntent{}, 0.5f);
    CHECK(level.entities[1].precisePosition.x == doctest::Approx(8.0f));
    CHECK(level.entities[2].precisePosition.y == doctest::Approx(15.0f));
}

TEST_CASE("sin jugador el combate avanza sin romperse") {
    LoadedLevel level = OpenLevel(6, 6);
    Combat::State state;
    Inventory inventory;
    level.entities.push_back(MakeEntity("orco", "enemy", 2, 2));
    Combat::FrameResult result;
    CHECK_NOTHROW(result = Combat::Update(level, state, nullptr, inventory, Combat::PlayerIntent{}, 0.1f));
    CHECK_FALSE(result.playerDefeated);
}

TEST_CASE("el golpe en linea alcanza hacia donde se apunta") {
    CombatFixture fx;
    AttackDef line = Attack(AttackPattern::Line);
    line.range = 3.0f;
    line.width = 0.8f;
    fx.Equip(Weapon("lanza", line));
    const auto ahead = fx.AddEnemy(7.5f, 5);
    const auto side = fx.AddEnemy(5, 7);
    fx.Attack(Vector2{9, 5});
    CHECK(fx.At(ahead).health == doctest::Approx(20.0f));
    CHECK(fx.At(side).health == doctest::Approx(30.0f));
}

TEST_CASE("el sector golpea solo dentro de su angulo") {
    CombatFixture fx;
    AttackDef cone = Attack(AttackPattern::Cone);
    cone.range = 2.0f;
    cone.angle = 90.0f;
    fx.Equip(Weapon("hacha", cone));
    const auto front = fx.AddEnemy(6.5f, 5);
    const auto side = fx.AddEnemy(5, 6.5f);
    const auto back = fx.AddEnemy(3.5f, 5);
    fx.Attack(Vector2{7, 5});
    CHECK(fx.At(front).health == doctest::Approx(20.0f));
    CHECK(fx.At(side).health == doctest::Approx(30.0f));
    CHECK(fx.At(back).health == doctest::Approx(30.0f));
}

TEST_CASE("el proyectil viaja y golpea solo al primero") {
    CombatFixture fx;
    AttackDef shot = Attack(AttackPattern::Projectile);
    shot.speed = 10.0f;
    shot.range = 6.0f;
    shot.width = 0.5f;
    fx.Equip(Weapon("arco", shot));
    const auto first = fx.AddEnemy(7, 5);
    const auto second = fx.AddEnemy(8, 5);
    fx.Attack(Vector2{10, 5});
    CHECK(fx.state.projectiles.size() == 1);
    fx.Settle();
    CHECK(fx.state.projectiles.empty());
    CHECK(fx.At(first).health == doctest::Approx(20.0f));
    CHECK(fx.At(second).health == doctest::Approx(30.0f));
}

TEST_CASE("el proyectil que atraviesa golpea una vez a cada uno") {
    CombatFixture fx;
    AttackDef shot = Attack(AttackPattern::Projectile);
    shot.speed = 10.0f;
    shot.range = 6.0f;
    shot.pierce = true;
    fx.Equip(Weapon("ballesta", shot));
    const auto first = fx.AddEnemy(7, 5);
    const auto second = fx.AddEnemy(8, 5);
    fx.Attack(Vector2{10, 5});
    fx.Settle();
    CHECK(fx.At(first).health == doctest::Approx(20.0f));
    CHECK(fx.At(second).health == doctest::Approx(20.0f));
}

TEST_CASE("el proyectil se frena contra una pared") {
    CombatFixture fx;
    fx.level.wallTexture = TestSupport::WallTextureFlag();
    fx.level.wallTiles = {GridCoord{7, 5}};
    AttackDef shot = Attack(AttackPattern::Projectile);
    shot.range = 6.0f;
    fx.Equip(Weapon("arco", shot));
    const auto behind = fx.AddEnemy(9, 5);
    fx.Attack(Vector2{10, 5});
    fx.Settle();
    CHECK(fx.state.projectiles.empty());
    CHECK(fx.At(behind).health == doctest::Approx(30.0f));
}

TEST_CASE("el explosivo dana a todos los de su radio") {
    CombatFixture fx;
    AttackDef bomb = Attack(AttackPattern::Explosive);
    bomb.speed = 10.0f;
    bomb.range = 6.0f;
    bomb.radius = 1.5f;
    fx.Equip(Weapon("bomba", bomb));
    const auto hit = fx.AddEnemy(7, 5);
    const auto neighbor = fx.AddEnemy(7.5f, 6);
    const auto far = fx.AddEnemy(10, 5);
    fx.Attack(Vector2{10, 5});
    fx.Settle();
    CHECK(fx.At(hit).health == doctest::Approx(20.0f));
    CHECK(fx.At(neighbor).health == doctest::Approx(20.0f));
    CHECK(fx.At(far).health == doctest::Approx(30.0f));
}

TEST_CASE("el area remota cae tras su demora y no mas lejos que su alcance") {
    CombatFixture fx;
    AttackDef area = Attack(AttackPattern::RemoteArea);
    area.range = 3.0f;
    area.radius = 1.0f;
    area.delay = 0.4f;
    fx.Equip(Weapon("baculo", area));
    const auto target = fx.AddEnemy(8, 5);
    fx.Attack(Vector2{15, 5});
    REQUIRE(fx.state.pendingAreas.size() == 1);
    CHECK(fx.state.pendingAreas[0].center.x == doctest::Approx(8.0f));
    fx.Idle();
    CHECK(fx.At(target).health == doctest::Approx(30.0f));
    fx.Settle();
    CHECK(fx.At(target).health == doctest::Approx(20.0f));
}

TEST_CASE("la habilidad se carga acertando y sale sola en el ataque siguiente") {
    CombatFixture fx;
    ItemDef axe = Weapon("hacha", Attack(AttackPattern::Area, 1.0f));
    axe.weapon.hasAbility = true;
    axe.weapon.ability.hitsRequired = 2;
    axe.weapon.ability.attack = Attack(AttackPattern::Area, 50.0f);
    fx.Equip(axe);
    const auto enemy = fx.AddEnemy(6, 5, 1000.0f);

    fx.Attack(Vector2{6, 5});
    fx.Attack(Vector2{6, 5});
    CHECK(fx.inventory.ActiveSlot()->combo.hits == 2);
    const Combat::FrameResult result = fx.Attack(Vector2{6, 5});
    CHECK(result.abilitiesUsed == std::vector<std::string>{"hacha"});
    CHECK(fx.At(enemy).health == doctest::Approx(948.0f));
    CHECK(fx.inventory.ActiveSlot()->combo.hits == 0);
}

TEST_CASE("una habilidad manual espera su tecla") {
    CombatFixture fx;
    ItemDef axe = Weapon("hacha", Attack(AttackPattern::Area, 1.0f));
    axe.weapon.hasAbility = true;
    axe.weapon.ability.hitsRequired = 1;
    axe.weapon.ability.manual = true;
    axe.weapon.ability.attack = Attack(AttackPattern::Area, 50.0f);
    fx.Equip(axe);
    const auto enemy = fx.AddEnemy(6, 5, 1000.0f);
    fx.Attack(Vector2{6, 5});
    fx.Attack(Vector2{6, 5});
    CHECK(fx.At(enemy).health == doctest::Approx(998.0f));

    Combat::PlayerIntent ability;
    ability.aim = Vector2{6, 5};
    ability.ability = true;
    const Combat::FrameResult result = fx.Step(ability);
    CHECK(result.abilitiesUsed.size() == 1);
    CHECK(fx.At(enemy).health == doctest::Approx(948.0f));
}

TEST_CASE("un ataque de curacion cura a quien lo lanza") {
    CombatFixture fx;
    AttackDef heal = Attack(AttackPattern::Area, 0.0f);
    heal.heal = 20.0f;
    fx.Equip(Weapon("baculo", heal));
    fx.Player().health = 50.0f;
    fx.Attack(Vector2{6, 5});
    CHECK(fx.Player().health == doctest::Approx(70.0f));
    fx.Player().health = 95.0f;
    fx.Attack(Vector2{6, 5});
    CHECK(fx.Player().health == doctest::Approx(100.0f));
}

TEST_CASE("un enemigo armado dispara al jugador cuando esta a su alcance") {
    CombatFixture fx;
    AttackDef shot = Attack(AttackPattern::Projectile, 7.0f);
    shot.range = 5.0f;
    shot.cooldown = 1.0f;
    ItemDef bow = Weapon("arco", shot);
    bow.weapon.category = WeaponCategory::Ranged;
    fx.level.items["arco"] = bow;
    const auto archer = fx.AddEnemy(8, 5);
    fx.At(archer).weaponId = "arco";
    fx.Idle();
    CHECK(fx.state.projectiles.size() == 1);
    CHECK(fx.At(archer).attackTimer == doctest::Approx(1.0f));
    for (int frame = 0; frame < 5; ++frame) {
        fx.Idle();
    }
    CHECK(fx.Player().health == doctest::Approx(93.0f));
    // A distancia no se acerca mas de lo necesario.
    CHECK(fx.At(archer).precisePosition.x == doctest::Approx(8.0f));
}

TEST_CASE("los efectos de un golpe se vencen solos") {
    CombatFixture fx;
    fx.Attack(Vector2{6, 5});
    REQUIRE(fx.state.effects.size() == 1);
    fx.Idle(0.2f);
    CHECK(fx.state.effects.empty());
}

TEST_CASE("limpiar el estado vacia proyectiles areas y efectos") {
    Combat::State state;
    state.projectiles.emplace_back();
    state.pendingAreas.emplace_back();
    state.effects.emplace_back();
    state.playerFacing = Vector2{0, 1};
    state.Clear();
    CHECK(state.projectiles.empty());
    CHECK(state.pendingAreas.empty());
    CHECK(state.effects.empty());
    CHECK(state.playerFacing.x == doctest::Approx(1.0f));
}

}  // TEST_SUITE
