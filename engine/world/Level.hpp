#pragma once

#include <string>
#include <vector>

#include "raylib.h"

#include "systems/iso_grid/IsoGridSystem.hpp"
#include "world/ItemDefs.hpp"

// El MODELO DEL NIVEL: que hay en un nivel cargado y en que estado esta.
//
// Estas estructuras son el lenguaje comun entre las capas, y por eso viven en
// world/ y no en loader/ ni en game/:
//
//   loader/  las ARMA leyendo el JSON  (ver schema/level.schema.json)
//   game/    las LEE y las modifica    (Movement, Combat, Loot, Zones...)
//
// Cuando estaban declaradas dentro de loader/LevelLoader.hpp, todo game/ tenia
// que incluir el loader solo para ver los tipos, y con el arrastraba
// ResourceManager, AssetResolver, EventSystem y nlohmann/json: la Capa 4
// terminaba dependiendo de la Capa 3 por accidente de ubicacion. Con el modelo
// aparte, las dos capas dependen de este archivo y ninguna de la otra.
//
// Aca no hay logica, solo datos. Las reglas que los usan estan en game/, y el
// parseo que los llena, en loader/. Este archivo no incluye nada de esas dos
// capas, y no debe hacerlo: es lo que mantiene la direccion de las dependencias.
//
// Todas las posiciones continuas van en CELDAS de grilla (col, row).
struct LevelEntity {
    std::string id;
    std::string type;
    GridCoord position;
    Vector2 precisePosition;
    const Texture2D* texture;
    Rectangle sourceRect;
    // Animacion: "frames" cuadros uno al lado del otro desde sourceRect, del
    // mismo ancho. 1 = quieto. Reemplaza al clip unico escrito en main.cpp.
    int frames = 1;
    float frameDuration = 0.15f;
    // Pixeles que el sprite baja al dibujarse. 0 = el borde de abajo del
    // sprite va en el punto de la celda (los "pies" de un personaje). Un
    // solido que llena la casilla usa este campo para apoyar el centro del
    // rombo de su base ahi, que es donde se centra el tile de piso.
    float groundOffset = 0.0f;
    // Celdas por lado que ocupa, desde position hacia +col y +row. El sprite
    // se agranda span veces y se apoya en el centro del bloque; el collider
    // ya viene del tamano del bloque entero. 1 = una casilla.
    int span = 1;
    // Tamano de dibujo del sprite (2 = el doble del recorte). Se multiplica
    // con span; el collider no cambia, se declara aparte en pixeles.
    float scale = 1.0f;
    // Caracteristicas ("stats" en el JSON). speed ya mueve al jugador; health y
    // damage quedan cargadas para el sistema de combate.
    float health = 100.0f;
    float damage = 0.0f;
    float speed = 3.0f;  // celdas de grilla por segundo
    // Estado de combate EN EJECUCION: no viene del JSON, lo lleva Combat.
    float maxHealth = 100.0f;  // la vida con la que arranco, para la barra
    float attackTimer = 0.0f;  // segundos hasta poder volver a pegar
    float hurtTimer = 0.0f;    // segundos de destello rojo por un golpe recibido
    Vector2 colliderSize;        // {0,0} si la entidad no colisiona
    bool colliderSolid = false;  // "Colision": el collider bloquea, con su forma y tamano
    bool colliderRound = false;  // base redonda: bloquea con la elipse inscripta en la caja
    // "Pared": bloquea TODAS las celdas de su bloque (span x span), sin
    // importar el tamano ni la forma del collider. Independiente de colliderSolid.
    bool wall = false;
    bool destroyed = false;      // borrado suave: la accion destroy_entity solo marca esto

    // --- Combate, objetos y puzzles (ver world/ItemDefs.hpp) -----------------
    // Oculta pero no destruida: no se dibuja, no bloquea, no colisiona ni
    // pelea. La cambian show_entity / hide_entity (las puertas de un puzzle).
    bool hidden = false;
    bool boss = false;
    std::string itemId;    // objeto para juntar ("item" en el JSON)
    std::string weaponId;  // arma de un enemigo ("weapon")
    std::vector<DropEntry> drops;
    InventoryConfig inventory;
    DashConfig dash;
    DefenseConfig defense;
    std::vector<ShopEntry> shop;
    // En ejecucion: donde arranco, para "Al limpiar una zona" (un enemigo que
    // sale persiguiendo sigue contando para su sala), y el contador de la
    // habilidad de su arma si es un enemigo armado.
    Vector2 startPosition{0, 0};
    ComboState combo;
};

struct LoadedLevel {
    std::string name;
    IsoGridSystem grid;
    std::vector<LevelEntity> entities;
    const Texture2D* floorTexture;
    Rectangle floorSourceRect;
    const Texture2D* wallTexture;
    Rectangle wallSourceRect;
    std::vector<GridCoord> floorTiles;
    std::vector<GridCoord> wallTiles;
    // Fondo de la escena ("backgroundColor" en el JSON). RAYWHITE si falta.
    Color backgroundColor = RAYWHITE;
    // Definiciones de objetos ("items") por id, y las zonas de los puzzles: las
    // de "zones" mas una por cada sala de "rooms".
    ItemCatalog items;
    std::vector<Zone> zones;
};
