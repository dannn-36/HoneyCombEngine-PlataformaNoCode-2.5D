#pragma once

// =============================================================================
// La partida guardada
// =============================================================================
//
// Una sola partida por juego, en <raiz>/saves/partida.json. La escribe un
// punto de control (una entidad "checkpoint" que el jugador toca) o la accion
// de evento "Guardar partida", y la lee "Continuar" en la portada, o
// "Reintentar" despues de perder.
//
// Guarda lo del JUGADOR y de la PARTIDA, no el estado del nivel: al continuar,
// el nivel arranca de nuevo (enemigos, puertas y objetos como en el editor) y
// el jugador aparece en el punto de control con su vida, sus armas, sus
// monedas, las marcas y las variables. Las marcas del nivel tambien vuelven,
// para que un puzzle ya resuelto no haya que resolverlo otra vez.
// =============================================================================

#include <filesystem>
#include <string>
#include <unordered_map>
#include <vector>

#include "raylib.h"

struct SaveData {
    std::string level;  // archivo dentro de levels/
    bool hasPosition = false;
    Vector2 position{0, 0};  // celda continua del jugador
    float health = -1.0f;    // -1 = la que trae el nivel
    int coins = 0;
    std::vector<std::string> weapons;  // ids de las armas, en orden
    int activeWeapon = -1;
    std::vector<std::string> levelFlags;
    std::vector<std::string> gameFlags;
    std::unordered_map<std::string, float> variables;
};

namespace Progress {

std::filesystem::path SavePath(const std::filesystem::path& projectRoot);

bool Exists(const std::filesystem::path& projectRoot);

// false si no hay partida o el archivo esta roto (y avisa por consola).
bool Load(const std::filesystem::path& projectRoot, SaveData& out);

// Crea saves/ si falta. false si no se pudo escribir.
bool Write(const std::filesystem::path& projectRoot, const SaveData& data);

}  // namespace Progress
