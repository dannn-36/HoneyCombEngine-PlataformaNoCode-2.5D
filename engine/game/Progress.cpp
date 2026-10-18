// Implementacion de Progress. Que se guarda y por que, en el .hpp.

#include "Progress.hpp"

#include <exception>
#include <fstream>
#include <iostream>

#include "nlohmann/json.hpp"

namespace Progress {

std::filesystem::path SavePath(const std::filesystem::path& projectRoot) {
    return projectRoot / "saves" / "partida.json";
}

bool Exists(const std::filesystem::path& projectRoot) {
    std::error_code error;
    return std::filesystem::exists(SavePath(projectRoot), error);
}

bool Load(const std::filesystem::path& projectRoot, SaveData& out) {
    std::ifstream stream(SavePath(projectRoot));
    if (!stream) {
        return false;
    }
    try {
        const nlohmann::json source = nlohmann::json::parse(stream);
        SaveData data;
        data.level = source.value("level", std::string());
        if (source.contains("position")) {
            data.hasPosition = true;
            data.position = Vector2{source.at("position").value("col", 0.0f), source.at("position").value("row", 0.0f)};
        }
        data.health = source.value("health", -1.0f);
        data.coins = source.value("coins", 0);
        data.weapons = source.value("weapons", std::vector<std::string>{});
        data.activeWeapon = source.value("activeWeapon", -1);
        data.levelFlags = source.value("levelFlags", std::vector<std::string>{});
        data.gameFlags = source.value("gameFlags", std::vector<std::string>{});
        if (source.contains("variables") && source.at("variables").is_object()) {
            for (const auto& [name, value] : source.at("variables").items()) {
                if (value.is_number()) {
                    data.variables[name] = value.get<float>();
                }
            }
        }
        if (data.level.empty()) {
            return false;
        }
        out = data;
        return true;
    } catch (const std::exception& error) {
        std::cerr << "La partida guardada esta rota (" << error.what() << "): se ignora." << std::endl;
        return false;
    }
}

bool Write(const std::filesystem::path& projectRoot, const SaveData& data) {
    nlohmann::json out;
    out["level"] = data.level;
    if (data.hasPosition) {
        out["position"] = {{"col", data.position.x}, {"row", data.position.y}};
    }
    out["health"] = data.health;
    out["coins"] = data.coins;
    out["weapons"] = data.weapons;
    out["activeWeapon"] = data.activeWeapon;
    out["levelFlags"] = data.levelFlags;
    out["gameFlags"] = data.gameFlags;
    out["variables"] = nlohmann::json::object();
    for (const auto& [name, value] : data.variables) {
        out["variables"][name] = value;
    }

    std::error_code error;
    std::filesystem::create_directories(SavePath(projectRoot).parent_path(), error);
    std::ofstream stream(SavePath(projectRoot));
    if (!stream) {
        std::cerr << "No se pudo guardar la partida en " << SavePath(projectRoot).string() << std::endl;
        return false;
    }
    stream << out.dump(2);
    return static_cast<bool>(stream);
}

}  // namespace Progress
