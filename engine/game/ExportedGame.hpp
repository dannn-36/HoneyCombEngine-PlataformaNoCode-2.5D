#pragma once

// =============================================================================
// Un juego exportado desde el editor
// =============================================================================
//
// "Archivo > Exportar juego" del editor (editor/ipc/export.js) arma una carpeta
// que se juega sin el editor:
//
//   <Juego>/
//     <Juego>.exe            este motor (Release), renombrado
//     game.json levels/ assets/
//     honeycomb-export.json  la marca: que juego es y en que nivel empieza
//
// La marca es lo que distingue al juego exportado del motor que usa el editor
// (engine/build), que no la tiene y se comporta como siempre. Con la marca:
//
//   - Sin argumentos (doble clic) arranca en la portada, con el nivel inicial
//     de la marca para "Nueva partida".
//   - Las partidas no van junto al juego sino a la carpeta del usuario
//     (%APPDATA%\<Juego>\saves en Windows): un juego instalado en "Archivos de
//     programa" no puede escribir en su carpeta, y Documentos puede estar
//     protegida por el antivirus.
//   - Si no puede arrancar, lo dice en una ventana: el jugador no ve la consola.
// =============================================================================

#include <filesystem>
#include <string>

namespace ExportedGame {

constexpr const char* kMarkerFile = "honeycomb-export.json";

struct Info {
    bool exported = false;   // habia marca junto al ejecutable
    std::string name;        // el nombre del juego ("" si la marca no lo dice)
    std::string startLevel;  // archivo dentro de levels/ ("" si no lo dice)
};

// Mira si "gameDir" (la carpeta del ejecutable) es un juego exportado. Una
// marca rota cuenta igual como exportado, sin nombre ni nivel inicial: es un
// juego exportado al que le falta algo, no el motor del editor.
Info Detect(const std::filesystem::path& gameDir);

// "name" convertido en un nombre de carpeta valido en Windows: sin <>:"/\|?*
// ni caracteres de control, sin puntos o espacios al final y sin los nombres
// reservados (CON, NUL, COM1...). Vacio o inservible -> "HoneyComb".
std::string SafeFolderName(const std::string& name);

// Donde guarda las partidas un juego exportado: %APPDATA%\<nombre> en Windows;
// $XDG_DATA_HOME/<nombre> o ~/.local/share/<nombre> en los demas. Vacio si el
// sistema no lo dice (entonces se guarda junto al juego, como el editor).
std::filesystem::path UserSaveRoot(const std::string& gameName);

// El nivel con que arranca un juego exportado: levels/<startLevel> si existe
// y no sale de levels/; si no, el primero de levels/ por orden alfabetico.
// Vacio si levels/ no tiene ningun nivel.
std::filesystem::path StartLevel(const std::filesystem::path& gameDir, const Info& info);

// Una ventana de error del sistema. Es como se entera el jugador de que el
// juego no pudo arrancar: el exportado no tiene consola.
void ShowFatalError(const std::string& title, const std::string& message);

}  // namespace ExportedGame
