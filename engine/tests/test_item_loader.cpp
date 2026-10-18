// Pruebas de ItemLoader: objetos, ataques, zonas y los bloques de combate de
// una entidad. Misma convencion que LevelLoader: lo que falta toma su valor
// por defecto y lo que esta fuera de rango se lleva al rango.

#include "doctest/doctest.h"

#include "nlohmann/json.hpp"

#include "core/ResourceManager.hpp"
#include "loader/AssetResolver.hpp"
#include "loader/ItemLoader.hpp"
#include "support/TestSupport.hpp"
#include "world/Level.hpp"

using nlohmann::json;
using TestSupport::MakeEntity;
using TestSupport::TempDir;

TEST_SUITE("cargador de objetos") {

// --- Ataques -------------------------------------------------------------------

TEST_CASE("un ataque que no es un objeto queda con los valores por defecto") {
    const AttackDef defaults;
    const AttackDef attack = ItemLoader::ParseAttack(json("golpe"));
    CHECK(attack.pattern == AttackPattern::Area);
    CHECK(attack.damage == doctest::Approx(defaults.damage));
    CHECK(attack.range == doctest::Approx(defaults.range));
}

TEST_CASE("cada nombre de forma de ataque se traduce a su patron") {
    const std::pair<const char*, AttackPattern> cases[] = {
        {"line", AttackPattern::Line},
        {"area", AttackPattern::Area},
        {"cone", AttackPattern::Cone},
        {"projectile", AttackPattern::Projectile},
        {"remote_area", AttackPattern::RemoteArea},
        {"explosive", AttackPattern::Explosive},
        {"desconocido", AttackPattern::Area},
    };
    for (const auto& [name, pattern] : cases) {
        CAPTURE(name);
        CHECK(ItemLoader::ParseAttack(json{{"pattern", name}}).pattern == pattern);
    }
}

TEST_CASE("un ataque lee todos sus campos") {
    const AttackDef attack = ItemLoader::ParseAttack(json{
        {"pattern", "cone"}, {"damage", 25}, {"cooldown", 1.2}, {"range", 3}, {"width", 0.5},
        {"angle", 45}, {"radius", 2}, {"speed", 12}, {"delay", 0.8}, {"pierce", true}, {"heal", 5},
    });
    CHECK(attack.pattern == AttackPattern::Cone);
    CHECK(attack.damage == doctest::Approx(25.0f));
    CHECK(attack.cooldown == doctest::Approx(1.2f));
    CHECK(attack.range == doctest::Approx(3.0f));
    CHECK(attack.width == doctest::Approx(0.5f));
    CHECK(attack.angle == doctest::Approx(45.0f));
    CHECK(attack.radius == doctest::Approx(2.0f));
    CHECK(attack.speed == doctest::Approx(12.0f));
    CHECK(attack.delay == doctest::Approx(0.8f));
    CHECK(attack.pierce);
    CHECK(attack.heal == doctest::Approx(5.0f));
}

TEST_CASE("los valores imposibles de un ataque se corrigen") {
    const AttackDef defaults;
    const AttackDef attack = ItemLoader::ParseAttack(json{
        {"damage", -5}, {"cooldown", -1}, {"range", 0}, {"width", -2}, {"radius", 0},
        {"speed", -3}, {"delay", -1}, {"heal", -4}, {"angle", 720},
    });
    CHECK(attack.damage == doctest::Approx(0.0f));
    CHECK(attack.cooldown == doctest::Approx(0.0f));
    CHECK(attack.range == doctest::Approx(defaults.range));
    CHECK(attack.width == doctest::Approx(defaults.width));
    CHECK(attack.radius == doctest::Approx(defaults.radius));
    CHECK(attack.speed == doctest::Approx(defaults.speed));
    CHECK(attack.delay == doctest::Approx(0.0f));
    CHECK(attack.heal == doctest::Approx(0.0f));
    CHECK(attack.angle == doctest::Approx(360.0f));
    CHECK(ItemLoader::ParseAttack(json{{"angle", 0.2}}).angle == doctest::Approx(1.0f));
}

// --- Objetos -------------------------------------------------------------------

TEST_CASE("unos objetos que no son una lista dan un catalogo vacio") {
    ResourceManager resources;
    AssetResolver assets;
    CHECK(ItemLoader::ParseItems(json::object(), resources, assets).empty());
}

TEST_CASE("un objeto sin id se descarta") {
    ResourceManager resources;
    AssetResolver assets;
    const ItemCatalog catalog =
        ItemLoader::ParseItems(json::array({{{"name", "Sin id"}}, {{"id", ""}}, {{"id", "ok"}}}), resources, assets);
    CHECK(catalog.size() == 1);
    CHECK(catalog.count("ok") == 1);
}

TEST_CASE("un objeto minimo es una moneda que vale uno") {
    ResourceManager resources;
    AssetResolver assets;
    const ItemCatalog catalog = ItemLoader::ParseItems(json::array({{{"id", "moneda"}}}), resources, assets);
    const ItemDef& item = catalog.at("moneda");
    CHECK(item.name == "moneda");
    CHECK(item.kind == ItemKind::Coin);
    CHECK(item.value == 1);
    CHECK(item.texture == nullptr);
    CHECK(item.scale == doctest::Approx(1.0f));
    CHECK(item.sourceRect.width == doctest::Approx(16.0f));
}

TEST_CASE("un arma lee su categoria su ataque y su habilidad") {
    ResourceManager resources;
    AssetResolver assets;
    const json items = json::array({{
        {"id", "arco"}, {"name", "Arco"}, {"kind", "weapon"},
        {"weapon", {
            {"category", "ranged"},
            {"attack", {{"pattern", "projectile"}, {"damage", 8}}},
            {"ability", {{"name", "Lluvia"}, {"hitsRequired", 0}, {"activation", "manual"},
                         {"resetAfter", -2}, {"attack", {{"pattern", "remote_area"}}}}},
        }},
    }});
    const ItemDef& bow = ItemLoader::ParseItems(items, resources, assets).at("arco");
    CHECK(bow.kind == ItemKind::Weapon);
    CHECK(bow.weapon.category == WeaponCategory::Ranged);
    CHECK(bow.weapon.attack.pattern == AttackPattern::Projectile);
    CHECK(bow.weapon.attack.damage == doctest::Approx(8.0f));
    REQUIRE(bow.weapon.hasAbility);
    CHECK(bow.weapon.ability.name == "Lluvia");
    CHECK(bow.weapon.ability.hitsRequired == 1);
    CHECK(bow.weapon.ability.manual);
    CHECK(bow.weapon.ability.resetAfter == doctest::Approx(0.0f));
    CHECK(bow.weapon.ability.attack.pattern == AttackPattern::RemoteArea);
}

TEST_CASE("una curacion y una moneda leen su efecto") {
    ResourceManager resources;
    AssetResolver assets;
    const ItemCatalog catalog = ItemLoader::ParseItems(json::array({
        {{"id", "pocion"}, {"kind", "healing"}, {"heal", 25}},
        {{"id", "oro"}, {"kind", "coin"}, {"value", 0}, {"scale", -1}},
    }), resources, assets);
    CHECK(catalog.at("pocion").kind == ItemKind::Healing);
    CHECK(catalog.at("pocion").heal == doctest::Approx(25.0f));
    CHECK(catalog.at("oro").value == 1);
    CHECK(catalog.at("oro").scale == doctest::Approx(1.0f));
}

TEST_CASE("la textura y el recorte de un objeto se cargan") {
    TempDir dir;
    dir.WritePng("textures/espada.png", 8, 8, BLUE);
    ResourceManager resources;
    AssetResolver assets(dir.Path().string());
    const ItemCatalog catalog = ItemLoader::ParseItems(json::array({{
        {"id", "espada"}, {"texture", "textures/espada.png"},
        {"sourceRect", {{"x", 2}, {"width", 0}, {"height", 4}}},
    }}), resources, assets);
    const ItemDef& item = catalog.at("espada");
    REQUIRE(item.texture != nullptr);
    CHECK(item.texture->width == 8);
    CHECK(item.sourceRect.x == doctest::Approx(2.0f));
    CHECK(item.sourceRect.width == doctest::Approx(16.0f));  // cero no es un ancho
    CHECK(item.sourceRect.height == doctest::Approx(4.0f));
}

// --- Zonas ---------------------------------------------------------------------

TEST_CASE("una zona lee su rectangulo y nunca mide menos de una celda") {
    const Zone zone = ItemLoader::ParseZone(json{{"id", "sala"}, {"col", 2}, {"row", 3}, {"width", 4}, {"height", 5}});
    CHECK(zone.id == "sala");
    CHECK(zone.col == 2);
    CHECK(zone.row == 3);
    CHECK(zone.width == 4);
    CHECK(zone.height == 5);

    const Zone empty = ItemLoader::ParseZone(json{{"width", 0}, {"height", -3}});
    CHECK(empty.id.empty());
    CHECK(empty.width == 1);
    CHECK(empty.height == 1);
}

// --- Bloques de combate de una entidad -------------------------------------------

TEST_CASE("una entidad sin bloques de combate queda como siempre") {
    LevelEntity entity = MakeEntity("x", "npc", 0, 0);
    ItemLoader::ParseEntityCombat(json::object(), entity);
    CHECK_FALSE(entity.hidden);
    CHECK_FALSE(entity.boss);
    CHECK(entity.itemId.empty());
    CHECK(entity.drops.empty());
    CHECK_FALSE(entity.inventory.present);
    CHECK_FALSE(entity.dash.enabled);
    CHECK_FALSE(entity.defense.enabled);
    CHECK(entity.shop.empty());
}

TEST_CASE("los objetos que suelta una entidad llevan su probabilidad al rango") {
    LevelEntity entity = MakeEntity("x", "enemy", 0, 0);
    ItemLoader::ParseEntityCombat(json{{"drops", json::array({
        {{"item", "moneda"}, {"chance", 1.5}},
        {{"item", "pocion"}, {"chance", -1}},
        {{"chance", 0.5}},
    })}}, entity);
    REQUIRE(entity.drops.size() == 2);
    CHECK(entity.drops[0].chance == doctest::Approx(1.0f));
    CHECK(entity.drops[1].chance == doctest::Approx(0.0f));
}

TEST_CASE("el inventario de una entidad se lee y se lleva al rango") {
    LevelEntity entity = MakeEntity("jugador", "player", 0, 0);
    ItemLoader::ParseEntityCombat(json{{"inventory", {
        {"slots", 20}, {"locked", true}, {"onFull", "block"},
        {"items", json::array({"espada", 3, "arco"})}, {"coins", -10},
    }}}, entity);
    CHECK(entity.inventory.present);
    CHECK(entity.inventory.slots == 9);
    CHECK(entity.inventory.locked);
    CHECK(entity.inventory.onFull == OnFullInventory::Block);
    CHECK(entity.inventory.items == std::vector<std::string>{"espada", "arco"});
    CHECK(entity.inventory.coins == 0);

    LevelEntity other = MakeEntity("otro", "player", 0, 0);
    ItemLoader::ParseEntityCombat(json{{"inventory", {{"slots", 0}, {"onFull", "auto_replace"}}}}, other);
    CHECK(other.inventory.slots == 1);
    CHECK(other.inventory.onFull == OnFullInventory::AutoReplace);

    LevelEntity third = MakeEntity("tercero", "player", 0, 0);
    ItemLoader::ParseEntityCombat(json{{"inventory", {{"onFull", "otra"}}}}, third);
    CHECK(third.inventory.slots == 3);
    CHECK(third.inventory.onFull == OnFullInventory::ManualReplace);
}

TEST_CASE("el esquive y la defensa se activan con su bloque") {
    LevelEntity entity = MakeEntity("jugador", "player", 0, 0);
    ItemLoader::ParseEntityCombat(json{{"mobility", {
        {"dash", {{"distance", 4}, {"duration", 0}, {"cooldown", -1}, {"iframes", 0.5}}},
        {"defense", {{"reduction", 2}, {"speedMultiplier", 0.25}}},
    }}}, entity);
    const DashConfig defaults;
    CHECK(entity.dash.enabled);
    CHECK(entity.dash.distance == doctest::Approx(4.0f));
    CHECK(entity.dash.duration == doctest::Approx(defaults.duration));
    CHECK(entity.dash.cooldown == doctest::Approx(0.0f));
    CHECK(entity.dash.iframes == doctest::Approx(0.5f));
    CHECK(entity.defense.enabled);
    CHECK(entity.defense.reduction == doctest::Approx(1.0f));
    CHECK(entity.defense.speedMultiplier == doctest::Approx(0.25f));
}

TEST_CASE("la tienda descarta entradas sin objeto y precios negativos") {
    LevelEntity entity = MakeEntity("tendero", "npc", 0, 0);
    ItemLoader::ParseEntityCombat(json{
        {"hidden", true}, {"boss", true}, {"item", "llave"}, {"weapon", "hacha"},
        {"shop", {{"items", json::array({
            {{"item", "pocion"}, {"price", 5}},
            {{"item", "espada"}, {"price", -3}},
            {{"price", 1}},
        })}}},
    }, entity);
    CHECK(entity.hidden);
    CHECK(entity.boss);
    CHECK(entity.itemId == "llave");
    CHECK(entity.weaponId == "hacha");
    REQUIRE(entity.shop.size() == 2);
    CHECK(entity.shop[0].price == 5);
    CHECK(entity.shop[1].price == 0);
}

}  // TEST_SUITE
