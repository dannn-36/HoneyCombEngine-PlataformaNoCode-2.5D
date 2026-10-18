// Implementacion de ExportedGame. Que es un juego exportado, en el .hpp.

#include "ExportedGame.hpp"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <iostream>
#include <vector>

// Solo la ventana de mensajes: SDL.h entero redefine main().
#include <SDL_messagebox.h>

#include "nlohmann/json.hpp"

#include "game/Progress.hpp"

namespace ExportedGame {

Info Detect(const std::filesystem::path& gameDir) {
    Info info;
    std::error_code error;
    const std::filesystem::path marker = gameDir / kMarkerFile;
    if (!std::filesystem::exists(marker, error)) {
        return info;
    }
    info.exported = true;
    try {
        std::ifstream stream(marker);
        const nlohmann::json source = nlohmann::json::parse(stream);
        if (source.contains("name") && source.at("name").is_string()) {
            info.name = source.at("name").get<std::string>();
        }
        if (source.contains("startLevel") && source.at("startLevel").is_string()) {
            info.startLevel = source.at("startLevel").get<std::string>();
        }
    } catch (const std::exception& problem) {
        std::cerr << "La marca de juego exportado esta rota (" << problem.what() << ")." << std::endl;
    }
    return info;
}

std::string SafeFolderName(const std::string& name) {
    std::string out;
    for (const char c : name) {
        const unsigned char u = static_cast<unsigned char>(c);
        // Los bytes >= 0x80 son UTF-8 (acentos, eñes): se conservan.
        if (u < 0x20 || std::string("<>:\"/\\|?*").find(c) != std::string::npos) {
            continue;
        }
        out += c;
    }
    // Windows no admite un nombre que termine en punto o espacio, ni que empiece con espacio.
    while (!out.empty() && (out.back() == '.' || out.back() == ' ')) out.pop_back();
    while (!out.empty() && out.front() == ' ') out.erase(out.begin());

    std::string upper = out.substr(0, out.find('.'));
    std::transform(upper.begin(), upper.end(), upper.begin(), [](unsigned char c) { return std::toupper(c); });
    static const std::vector<std::string> kReserved = {
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"};
    if (out.empty() || std::find(kReserved.begin(), kReserved.end(), upper) != kReserved.end()) {
        return "HoneyComb";
    }
    return out;
}

std::filesystem::path UserSaveRoot(const std::string& gameName) {
    const std::filesystem::path folder = std::filesystem::u8path(SafeFolderName(gameName));
#ifdef _WIN32
    // _wgetenv y no getenv: con un usuario que tiene acentos ("José"), getenv
    // devuelve la ruta en la pagina de codigos del sistema y se rompe.
    const wchar_t* appData = _wgetenv(L"APPDATA");
    if (appData && *appData) {
        return std::filesystem::path(appData) / folder;
    }
#else
    const char* dataHome = std::getenv("XDG_DATA_HOME");
    if (dataHome && *dataHome) {
        return std::filesystem::path(dataHome) / folder;
    }
    const char* home = std::getenv("HOME");
    if (home && *home) {
        return std::filesystem::path(home) / ".local" / "share" / folder;
    }
#endif
    return {};
}

std::filesystem::path StartLevel(const std::filesystem::path& gameDir, const Info& info) {
    const std::filesystem::path levels = gameDir / "levels";
    std::error_code error;
    if (!info.startLevel.empty() && Progress::IsLevelInsideLevels(info.startLevel)) {
        const std::filesystem::path chosen = levels / std::filesystem::u8path(info.startLevel);
        if (std::filesystem::is_regular_file(chosen, error)) {
            return chosen;
        }
        std::cerr << "El nivel inicial " << info.startLevel << " no esta en levels/." << std::endl;
    }
    std::vector<std::filesystem::path> found;
    for (const auto& entry : std::filesystem::directory_iterator(levels, error)) {
        if (entry.is_regular_file(error) && entry.path().extension() == ".json") {
            found.push_back(entry.path());
        }
    }
    if (found.empty()) {
        return {};
    }
    std::sort(found.begin(), found.end());
    return found.front();
}

void ShowFatalError(const std::string& title, const std::string& message) {
    std::cerr << title << ": " << message << std::endl;
    SDL_ShowSimpleMessageBox(SDL_MESSAGEBOX_ERROR, title.c_str(), message.c_str(), nullptr);
}

}  // namespace ExportedGame
