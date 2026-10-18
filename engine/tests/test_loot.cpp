// Pruebas de Loot: darle objetos al jugador, juntarlos del piso, lo que
// sueltan los enemigos y la tienda de los NPC.

#include "doctest/doctest.h"

#include <cmath>

#include "game/Inventory.hpp"
#include "game/Loot.hpp"
#include "support/TestSupport.hpp"

using TestSupport::MakeEntity;
using TestSupport::OpenLevel;

namespace {

ItemDef Weapon(const std::string& id) {
    ItemDef item;
    item.id = id;
    item.name = id;
    item.kind = ItemKind::Weapon;
    return item;
}

ItemDef Potion(float heal) {
    ItemDef item;
    item.id = "pocion";
    item.name = "Pocion";
    item.kind = ItemKind::Healing;
    item.heal = heal;
    return item;
}

ItemDef Coin(int value) {
    ItemDef item;
    item.id = "moneda";
    item.name = "Moneda";
    item.kind = ItemKind::Coin;
    item.value = value;
    return item;
}

// Un inventario de un casillero, ya lleno con la espada.
Inventory FullInventory(OnFullInventory rule) {
    InventoryConfig config;
    config.present = true;
    config.slots = 1;
    config.onFull = rule;
    config.items = {"espada"};
    Inventory inventory;
    inventory.Configure(config, ItemCatalog{{"espada", Weapon("espada")}});
    return inventory;
}

}  // namespace

TEST_SUITE("objetos y tienda") {

// --- Dar un objeto -------------------------------------------------------------

TEST_CASE("un arma nueva entra al inventario") {
    LevelEntity player = MakeEntity("jugador", "player", 1, 1);
    Inventory inventory;
    std::vector<GroundItem> drops;
    std::string message;
    CHECK(Loot::Give(Weapon("espada"), player, inventory, drops, false, message) == Loot::GiveResult::Taken);
    CHECK(message == "Nueva arma: espada");
    CHECK(inventory.HasItem("espada"));
    CHECK(Loot::Give(Weapon("espada"), player, inventory, drops, false, message) == Loot::GiveResult::Rejected);
    CHECK(message == "Ya tenes espada");
}

TEST_CASE("con el inventario lleno y cambio manual hay que confirmar") {
    LevelEntity player = MakeEntity("jugador", "player", 2, 3);
    Inventory inventory = FullInventory(OnFullInventory::ManualReplace);
    std::vector<GroundItem> drops;
    std::string message;
    CHECK(Loot::Give(Weapon("arco"), player, inventory, drops, false, message) == Loot::GiveResult::NeedsConfirm);
    CHECK(message.find("E: cambiar espada por arco") != std::string::npos);
    CHECK(drops.empty());

    CHECK(Loot::Give(Weapon("arco"), player, inventory, drops, true, message) == Loot::GiveResult::Taken);
    CHECK(message == "Cambiaste espada por arco");
    REQUIRE(drops.size() == 1);
    CHECK(drops[0].item.id == "espada");
    CHECK(drops[0].waitForExit);
    CHECK(drops[0].position.x == doctest::Approx(2.0f));
}

TEST_CASE("con cambio automatico no hace falta confirmar") {
    LevelEntity player = MakeEntity("jugador", "player", 1, 1);
    Inventory inventory = FullInventory(OnFullInventory::AutoReplace);
    std::vector<GroundItem> drops;
    std::string message;
    CHECK(Loot::Give(Weapon("arco"), player, inventory, drops, false, message) == Loot::GiveResult::Taken);
    CHECK(inventory.HasItem("arco"));
    CHECK(drops.size() == 1);
}

TEST_CASE("con el inventario bloqueado no se cambia ni confirmando") {
    LevelEntity player = MakeEntity("jugador", "player", 1, 1);
    Inventory inventory = FullInventory(OnFullInventory::Block);
    std::vector<GroundItem> drops;
    std::string message;
    CHECK(Loot::Give(Weapon("arco"), player, inventory, drops, true, message) == Loot::GiveResult::Rejected);
    CHECK(message == "Inventario lleno");
    CHECK(inventory.HasItem("espada"));
}

TEST_CASE("una curacion no pasa de la vida maxima y con vida llena se rechaza") {
    LevelEntity player = MakeEntity("jugador", "player", 1, 1);
    player.health = 100.0f;
    player.maxHealth = 100.0f;
    Inventory inventory;
    std::vector<GroundItem> drops;
    std::string message;
    CHECK(Loot::Give(Potion(30), player, inventory, drops, false, message) == Loot::GiveResult::Rejected);
    CHECK(message == "Vida llena");
    player.health = 80.0f;
    CHECK(Loot::Give(Potion(30), player, inventory, drops, false, message) == Loot::GiveResult::Taken);
    CHECK(player.health == doctest::Approx(100.0f));
    CHECK(message == "Pocion: +30 vida");
}

TEST_CASE("las monedas se suman con su valor") {
    LevelEntity player = MakeEntity("jugador", "player", 1, 1);
    Inventory inventory;
    std::vector<GroundItem> drops;
    std::string message;
    Loot::Give(Coin(1), player, inventory, drops, false, message);
    CHECK(message == "+1 moneda");
    Loot::Give(Coin(5), player, inventory, drops, false, message);
    CHECK(message == "+5 monedas");
    CHECK(inventory.coins == 6);
}

// --- Juntar --------------------------------------------------------------------

TEST_CASE("un objeto colocado se junta al tocarlo y queda destruido") {
    LoadedLevel level = OpenLevel(6, 6);
    level.items["moneda"] = Coin(2);
    LevelEntity coin = MakeEntity("m1", "item", 2.5f, 2);
    coin.itemId = "moneda";
    level.entities.push_back(coin);
    LevelEntity far = MakeEntity("m2", "item", 5, 5);
    far.itemId = "moneda";
    level.entities.push_back(far);
    LevelEntity player = MakeEntity("jugador", "player", 2, 2);
    Inventory inventory;
    Loot::State state;

    const Loot::PickupFrame frame = Loot::UpdatePickups(level, player, inventory, state, false, 0.016f);
    CHECK(frame.collectedEntities == std::vector<std::string>{"m1"});
    CHECK(level.entities[0].destroyed);
    CHECK_FALSE(level.entities[1].destroyed);
    CHECK(inventory.coins == 2);
    CHECK(state.collected.at("moneda") == 1);
    CHECK(state.collectedTotal == 1);
    CHECK(frame.message == "+2 monedas");
}

TEST_CASE("un objeto oculto o sin definir no se junta") {
    LoadedLevel level = OpenLevel(6, 6);
    level.items["moneda"] = Coin(1);
    LevelEntity hidden = MakeEntity("m1", "item", 2, 2);
    hidden.itemId = "moneda";
    hidden.hidden = true;
    level.entities.push_back(hidden);
    LevelEntity undefined = MakeEntity("m2", "item", 2, 2);
    undefined.itemId = "fantasma";
    level.entities.push_back(undefined);
    LevelEntity player = MakeEntity("jugador", "player", 2, 2);
    Inventory inventory;
    Loot::State state;
    const Loot::PickupFrame frame = Loot::UpdatePickups(level, player, inventory, state, false, 0.016f);
    CHECK(frame.collectedEntities.empty());
    CHECK(inventory.coins == 0);
}

TEST_CASE("parado sobre un arma que no entra se avisa y con E se cambia") {
    LoadedLevel level = OpenLevel(6, 6);
    level.items["arco"] = Weapon("arco");
    LevelEntity bow = MakeEntity("a1", "item", 2, 2);
    bow.itemId = "arco";
    level.entities.push_back(bow);
    LevelEntity player = MakeEntity("jugador", "player", 2, 2);
    Inventory inventory = FullInventory(OnFullInventory::ManualReplace);
    Loot::State state;

    Loot::PickupFrame frame = Loot::UpdatePickups(level, player, inventory, state, false, 0.016f);
    CHECK(frame.collectedEntities.empty());
    CHECK(frame.prompt.find("Inventario lleno") != std::string::npos);

    frame = Loot::UpdatePickups(level, player, inventory, state, true, 0.016f);
    CHECK(frame.collectedEntities == std::vector<std::string>{"a1"});
    CHECK(inventory.HasItem("arco"));
    // La espada que sale queda a los pies, esperando que el jugador se aleje.
    REQUIRE(state.ground.size() == 1);
    CHECK(state.ground[0].item.id == "espada");
    CHECK(state.ground[0].waitForExit);
}

TEST_CASE("un objeto soltado a los pies espera a que el jugador se aleje") {
    LoadedLevel level = OpenLevel(6, 6);
    LevelEntity player = MakeEntity("jugador", "player", 2, 2);
    Inventory inventory;
    Loot::State state;
    Loot::DropItems(state, {Weapon("espada")}, Vector2{2, 2});
    REQUIRE(state.ground.size() == 1);
    CHECK(state.ground[0].waitForExit);

    Loot::UpdatePickups(level, player, inventory, state, false, 0.5f);
    CHECK(state.ground.size() == 1);
    CHECK(state.ground[0].age == doctest::Approx(0.5f));

    player.precisePosition = Vector2{4, 4};
    Loot::UpdatePickups(level, player, inventory, state, false, 0.016f);
    CHECK_FALSE(state.ground[0].waitForExit);

    player.precisePosition = Vector2{2.2f, 2.0f};
    Loot::UpdatePickups(level, player, inventory, state, false, 0.016f);
    CHECK(state.ground.empty());
    CHECK(inventory.HasItem("espada"));
}

TEST_CASE("lo que suelta un enemigo depende de su probabilidad") {
    LoadedLevel level = OpenLevel(6, 6);
    level.items["moneda"] = Coin(1);
    LevelEntity enemy = MakeEntity("orco", "enemy", 3, 3);
    enemy.drops = {DropEntry{"moneda", 1.0f}, DropEntry{"moneda", 0.0f}, DropEntry{"no_definido", 1.0f}};
    Loot::State state;
    state.rng.seed(42);
    Loot::RollDrops(level, enemy, state);
    REQUIRE(state.ground.size() == 1);
    CHECK(std::fabs(state.ground[0].position.x - 3.0f) <= 0.3f);
    CHECK(std::fabs(state.ground[0].position.y - 3.0f) <= 0.3f);
    CHECK_FALSE(state.ground[0].waitForExit);
}

TEST_CASE("limpiar el nivel vacia el piso y lo juntado") {
    Loot::State state;
    state.ground.push_back(GroundItem{});
    state.collected["moneda"] = 3;
    state.collectedTotal = 3;
    state.ClearLevel();
    CHECK(state.ground.empty());
    CHECK(state.collected.empty());
    CHECK(state.collectedTotal == 0);
}

// --- Tienda --------------------------------------------------------------------

TEST_CASE("la tienda mas cercana al alcance es la que se abre") {
    LoadedLevel level = OpenLevel(10, 10);
    LevelEntity nearShop = MakeEntity("cerca", "npc", 3, 2);
    nearShop.shop = {ShopEntry{"pocion", 1}};
    LevelEntity farShop = MakeEntity("lejos", "npc", 3.5f, 2);
    farShop.shop = {ShopEntry{"pocion", 1}};
    LevelEntity noShop = MakeEntity("vecino", "npc", 2, 2);
    level.entities = {farShop, nearShop, noShop};
    const LevelEntity player = MakeEntity("jugador", "player", 2, 2);
    LevelEntity* shop = Loot::NearbyShop(level, player);
    REQUIRE(shop != nullptr);
    CHECK(shop->id == "cerca");

    level.entities[1].hidden = true;
    level.entities[0].precisePosition = Vector2{9, 9};
    CHECK(Loot::NearbyShop(level, player) == nullptr);
}

TEST_CASE("comprar cobra el precio y entrega el objeto") {
    LoadedLevel level = OpenLevel(6, 6);
    level.items["espada"] = Weapon("espada");
    LevelEntity npc = MakeEntity("tendero", "npc", 2, 2);
    npc.shop = {ShopEntry{"espada", 5}, ShopEntry{"no_definido", 1}};
    LevelEntity player = MakeEntity("jugador", "player", 2, 2);
    Inventory inventory;
    Loot::State state;

    CHECK(Loot::Buy(level, npc, 9, player, inventory, state).empty());
    CHECK(Loot::Buy(level, npc, 1, player, inventory, state) == "Ese objeto no esta definido en el nivel");
    inventory.coins = 3;
    CHECK(Loot::Buy(level, npc, 0, player, inventory, state) == "Te faltan 2 monedas");
    inventory.coins = 8;
    CHECK(Loot::Buy(level, npc, 0, player, inventory, state) == "Compraste espada");
    CHECK(inventory.coins == 3);
    CHECK(inventory.HasItem("espada"));
    // Una compra que no se puede entregar no cobra.
    inventory.coins = 10;
    CHECK(Loot::Buy(level, npc, 0, player, inventory, state) == "Ya tenes espada");
    CHECK(inventory.coins == 10);
}

}  // TEST_SUITE
