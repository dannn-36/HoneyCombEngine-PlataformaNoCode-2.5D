#pragma once

// =============================================================================
// La partida guardada
// =============================================================================
//
// La partida del juego vive en <raiz>/saves/partida.json. La escribe un punto
// de control (una entidad "checkpoint" que el jugador toca) o la accion de
// evento "Guardar partida", y la lee "Continuar" en la portada, o "Volver al
// punto de control" despues de perder.
//
// Probar un nivel desde el editor (Ejecutar en modo Nivel, F5) usa OTRA
// partida, saves/prueba.json: probar no tiene que pisar la partida del juego
// de verdad. Cada una es un "slot".
//
// Que se guarda. Lo del JUGADOR y de la PARTIDA: vida, armas, monedas, marcas
// y variables. Del nivel, solo lo que evita repetir recompensas: los objetos
// colocados que ya se juntaron (siguen juntados) y cuantos se juntaron, y que
// eventos ya se dispararon (ver EventSystem::SetNonRepeatable). Lo demas
// arranca como en el editor: los enemigos reaparecen.
//
// Como se escribe. Primero a <slot>.json.tmp y despues se renombra encima del
// anterior, que queda en <slot>.json.bak: un guardado que se corta a la mitad
// no rompe la partida, y si la partida igual esta rota se recupera la copia.
// =============================================================================

#include <filesystem>
#include <string>
#include <unordered_map>
#include <vector>

#include "raylib.h"

struct SaveData {
    std::string level;  // archivo dentro de levels/ (puede estar en una subcarpeta)
    bool hasPosition = false;
    Vector2 position{0, 0};  // celda continua del jugador
    float health = -1.0f;    // -1 = la que trae el nivel
    int coins = 0;
    std::vector<std::string> weapons;  // ids de las armas, en orden
    int activeWeapon = -1;
    std::vector<std::string> levelFlags;
    std::vector<std::string> gameFlags;
    std::unordered_map<std::string, float> variables;

    // El punto de control donde se guardo ("" si fue la accion "Guardar
    // partida"). Si la posicion guardada ya no se puede pisar -- el nivel se
    // edito despues --, el jugador aparece ahi.
    std::string checkpoint;
    // Del nivel en curso: los objetos colocados que ya se juntaron (ids de
    // entidad), cuantos se juntaron de cada objeto y en total ("Al juntar
    // objetos"), y las claves de los eventos que ya se dispararon.
    std::vector<std::string> collectedItems;
    std::unordered_map<std::string, int> collectedCounts;
    int collectedTotal = 0;
    std::vector<std::string> firedEvents;
};

namespace Progress {

// El formato de la partida. Una partida sin "version" es de antes de que
// existiera el campo, y se lee igual (le faltan los campos nuevos). Una con
// una version MAYOR la escribio un motor mas nuevo: no se toca.
constexpr int kVersion = 1;

constexpr const char* kGameSlot = "partida";  // la del juego: portada y "Continuar"
constexpr const char* kTestSlot = "prueba";   // la de probar desde el editor

// Que paso al leer la partida.
enum class LoadStatus {
    Missing,    // no hay partida
    Loaded,     // se leyo bien
    Recovered,  // la partida estaba rota: se leyo la copia anterior (.bak)
    Broken,     // la partida esta rota y no hay copia que sirva
    TooNew,     // la escribio un motor mas nuevo: no se puede leer
};

std::filesystem::path SavePath(const std::filesystem::path& projectRoot, const std::string& slot = kGameSlot);

bool Exists(const std::filesystem::path& projectRoot, const std::string& slot = kGameSlot);

// true si se pudo leer una partida (la de ese slot o su copia). "status", si
// no es nullptr, dice que paso. Sin partida, rota o ilegible, false sin tocar
// "out" (y lo avisa por consola).
bool Load(const std::filesystem::path& projectRoot, SaveData& out, const std::string& slot = kGameSlot,
          LoadStatus* status = nullptr);

// Crea saves/ si falta. false si no se pudo escribir: en ese caso la partida
// anterior queda como estaba.
bool Write(const std::filesystem::path& projectRoot, const SaveData& data, const std::string& slot = kGameSlot);

// true si "level" es una ruta relativa que no sale de levels/: ni absoluta, ni
// de red, ni con "..". Una partida con otro nivel se trata como rota.
bool IsLevelInsideLevels(const std::string& level);

}  // namespace Progress
