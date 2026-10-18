// Pruebas de Inventory: casilleros de armas, el arma activa, el limite y lo
// que pasa al juntar con todo lleno, al pasar de nivel y al guardar.

#include "doctest/doctest.h"

#include "game/Inventory.hpp"

namespace {

ItemDef Weapon(const std::string& id) {
    ItemDef item;
    item.id = id;
    item.name = id;
    item.kind = ItemKind::Weapon;
    return item;
}

ItemCatalog Catalog() {
    ItemCatalog catalog;
    for (const char* id : {"espada", "arco", "hacha", "lanza"}) {
        catalog[id] = Weapon(id);
    }
    ItemDef coin;
    coin.id = "moneda";
    coin.kind = ItemKind::Coin;
    catalog["moneda"] = coin;
    return catalog;
}

InventoryConfig Config(int slots, std::vector<std::string> items = {}) {
    InventoryConfig config;
    config.present = true;
    config.slots = slots;
    config.items = std::move(items);
    return config;
}

}  // namespace

TEST_SUITE("inventario") {

TEST_CASE("un inventario nuevo esta vacio y pega con las manos") {
    Inventory inventory;
    CHECK(inventory.ActiveSlot() == nullptr);
    CHECK(inventory.ActiveIndex() == -1);
    CHECK(inventory.Slots() == 3);
    CHECK_FALSE(inventory.IsFull());
    CHECK(inventory.coins == 0);
}

TEST_CASE("configurar toma limite reglas monedas y armas iniciales") {
    Inventory inventory;
    InventoryConfig config = Config(2, {"espada", "no_existe", "moneda", "arco", "hacha"});
    config.locked = true;
    config.onFull = OnFullInventory::Block;
    config.coins = 7;
    inventory.Configure(config, Catalog());
    CHECK(inventory.Slots() == 2);
    CHECK(inventory.Locked());
    CHECK(inventory.OnFull() == OnFullInventory::Block);
    CHECK(inventory.coins == 7);
    // Lo que no es un arma del catalogo se ignora, y lo que no entra tambien.
    CHECK(inventory.WeaponIds() == std::vector<std::string>{"espada", "arco"});
    CHECK(inventory.ActiveIndex() == 0);
    CHECK(inventory.IsFull());
}

TEST_CASE("el limite de casilleros va de uno a nueve") {
    Inventory inventory;
    inventory.Configure(Config(0), Catalog());
    CHECK(inventory.Slots() == 1);
    inventory.Configure(Config(40), Catalog());
    CHECK(inventory.Slots() == 9);
}

TEST_CASE("la primera arma juntada pasa a ser la activa") {
    Inventory inventory;
    ItemDef dropped;
    CHECK(inventory.AddWeapon(Weapon("espada"), false, dropped) == Inventory::AddResult::Added);
    REQUIRE(inventory.ActiveSlot() != nullptr);
    CHECK(inventory.ActiveSlot()->item.id == "espada");
    CHECK(inventory.AddWeapon(Weapon("arco"), false, dropped) == Inventory::AddResult::Added);
    CHECK(inventory.ActiveSlot()->item.id == "espada");
}

TEST_CASE("un arma repetida no se agrega") {
    Inventory inventory;
    ItemDef dropped;
    inventory.AddWeapon(Weapon("espada"), false, dropped);
    CHECK(inventory.AddWeapon(Weapon("espada"), true, dropped) == Inventory::AddResult::AlreadyOwned);
    CHECK(inventory.Weapons().size() == 1);
    CHECK(inventory.HasItem("espada"));
    CHECK_FALSE(inventory.HasItem("arco"));
}

TEST_CASE("con todo lleno solo se cambia la activa si se pide") {
    Inventory inventory;
    inventory.Configure(Config(2, {"espada", "arco"}), Catalog());
    inventory.Select(1);
    ItemDef dropped;
    CHECK(inventory.AddWeapon(Weapon("hacha"), false, dropped) == Inventory::AddResult::Full);
    CHECK(inventory.WeaponIds() == std::vector<std::string>{"espada", "arco"});

    CHECK(inventory.AddWeapon(Weapon("hacha"), true, dropped) == Inventory::AddResult::Replaced);
    CHECK(dropped.id == "arco");
    CHECK(inventory.WeaponIds() == std::vector<std::string>{"espada", "hacha"});
    CHECK(inventory.ActiveSlot()->item.id == "hacha");
}

TEST_CASE("elegir un casillero vacio no cambia la activa") {
    Inventory inventory;
    inventory.Configure(Config(3, {"espada", "arco"}), Catalog());
    inventory.Select(1);
    CHECK(inventory.ActiveIndex() == 1);
    inventory.Select(2);
    inventory.Select(-1);
    CHECK(inventory.ActiveIndex() == 1);
}

TEST_CASE("la rueda da la vuelta en los dos sentidos") {
    Inventory inventory;
    inventory.Configure(Config(3, {"espada", "arco", "hacha"}), Catalog());
    inventory.Cycle(1);
    CHECK(inventory.ActiveIndex() == 1);
    inventory.Cycle(2);
    CHECK(inventory.ActiveIndex() == 0);
    inventory.Cycle(-1);
    CHECK(inventory.ActiveIndex() == 2);

    Inventory empty;
    empty.Cycle(1);
    CHECK(empty.ActiveIndex() == -1);
}

TEST_CASE("el contador de habilidad es de cada arma") {
    Inventory inventory;
    inventory.Configure(Config(3, {"espada", "arco"}), Catalog());
    inventory.SlotFor("espada")->combo.hits = 2;
    inventory.Select(1);
    inventory.Select(0);
    CHECK(inventory.ActiveSlot()->combo.hits == 2);
    CHECK(inventory.SlotFor("arco")->combo.hits == 0);
    CHECK(inventory.SlotFor("lanza") == nullptr);
}

TEST_CASE("achicar el limite devuelve las armas que ya no entran") {
    Inventory inventory;
    inventory.Configure(Config(3, {"espada", "arco", "hacha"}), Catalog());
    inventory.Select(2);
    const std::vector<ItemDef> dropped = inventory.SetSlots(1);
    REQUIRE(dropped.size() == 2);
    CHECK(dropped[0].id == "hacha");
    CHECK(dropped[1].id == "arco");
    CHECK(inventory.WeaponIds() == std::vector<std::string>{"espada"});
    CHECK(inventory.ActiveIndex() == 0);
}

TEST_CASE("con el limite bloqueado no se puede cambiar") {
    Inventory inventory;
    InventoryConfig config = Config(2, {"espada", "arco"});
    config.locked = true;
    inventory.Configure(config, Catalog());
    CHECK(inventory.SetSlots(1).empty());
    CHECK(inventory.Slots() == 2);
    CHECK(inventory.Weapons().size() == 2);
}

TEST_CASE("pasar a un nivel sin inventario conserva todo") {
    Inventory inventory;
    inventory.Configure(Config(3, {"espada", "arco"}), Catalog());
    inventory.coins = 12;
    InventoryConfig none;
    inventory.CarryInto(none, Catalog());
    CHECK(inventory.Slots() == 3);
    CHECK(inventory.WeaponIds() == std::vector<std::string>{"espada", "arco"});
    CHECK(inventory.coins == 12);
}

TEST_CASE("pasar a un nivel con inventario aplica su limite y suma sus armas") {
    Inventory inventory;
    inventory.Configure(Config(3, {"espada", "arco", "hacha"}), Catalog());
    inventory.Select(2);
    inventory.coins = 4;
    InventoryConfig next = Config(2, {"lanza"});
    next.onFull = OnFullInventory::AutoReplace;
    inventory.CarryInto(next, Catalog());
    CHECK(inventory.Slots() == 2);
    CHECK(inventory.OnFull() == OnFullInventory::AutoReplace);
    // No entra la lanza: el limite nuevo ya esta lleno con las que se traian.
    CHECK(inventory.WeaponIds() == std::vector<std::string>{"espada", "arco"});
    CHECK(inventory.ActiveIndex() == 1);
    CHECK(inventory.coins == 4);

    InventoryConfig bigger = Config(4, {"lanza", "espada"});
    inventory.CarryInto(bigger, Catalog());
    CHECK(inventory.WeaponIds() == std::vector<std::string>{"espada", "arco", "lanza"});
}

TEST_CASE("restaurar una partida respeta el orden y descarta lo desconocido") {
    Inventory inventory;
    inventory.Restore(Config(3), Catalog(), {"hacha", "perdida", "moneda", "espada"}, 5, 30);
    CHECK(inventory.WeaponIds() == std::vector<std::string>{"hacha", "espada"});
    CHECK(inventory.ActiveIndex() == 1);
    CHECK(inventory.coins == 30);

    Inventory empty;
    empty.Restore(Config(3), Catalog(), {}, 2, 0);
    CHECK(empty.ActiveIndex() == -1);
}

}  // TEST_SUITE
