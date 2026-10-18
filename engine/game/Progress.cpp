// Implementacion de Progress. Que se guarda y por que, en el .hpp.

#include "Progress.hpp"

#include <algorithm>
#include <exception>
#include <fstream>
#include <iostream>

#include "nlohmann/json.hpp"

namespace Progress {

namespace {

std::filesystem::path WithSuffix(const std::filesystem::path& path, const char* suffix) {
    std::filesystem::path out = path;
    out += suffix;
    return out;
}

// Como termino de leer UN archivo (la partida o su copia).
enum class ParseResult { Missing, Ok, Broken, TooNew };

ParseResult ParseFile(const std::filesystem::path& path, SaveData& out) {
    std::ifstream stream(path);
    if (!stream) {
        return ParseResult::Missing;
    }
    try {
        const nlohmann::json source = nlohmann::json::parse(stream);
        if (source.value("version", 0) > kVersion) {
            std::cerr << "La partida " << path.string() << " es de un motor mas nuevo: no se lee." << std::endl;
            return ParseResult::TooNew;
        }
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
        data.checkpoint = source.value("checkpoint", std::string());
        data.collectedItems = source.value("collectedItems", std::vector<std::string>{});
        data.collectedCounts = source.value("collectedCounts", std::unordered_map<std::string, int>{});
        data.collectedTotal = source.value("collectedTotal", 0);
        data.firedEvents = source.value("firedEvents", std::vector<std::string>{});
        if (data.level.empty() || !IsLevelInsideLevels(data.level)) {
            std::cerr << "La partida " << path.string() << " no dice un nivel de levels/: se ignora." << std::endl;
            return ParseResult::Broken;
        }
        out = data;
        return ParseResult::Ok;
    } catch (const std::exception& error) {
        std::cerr << "La partida " << path.string() << " esta rota (" << error.what() << ")." << std::endl;
        return ParseResult::Broken;
    }
}

}  // namespace

std::filesystem::path SavePath(const std::filesystem::path& projectRoot, const std::string& slot) {
    return projectRoot / "saves" / (slot + ".json");
}

bool Exists(const std::filesystem::path& projectRoot, const std::string& slot) {
    std::error_code error;
    return std::filesystem::exists(SavePath(projectRoot, slot), error);
}

bool IsLevelInsideLevels(const std::string& level) {
    // Las barras invertidas se miran como separadores en cualquier sistema:
    // "..\\..\\x.json" tiene que salir rechazado tambien fuera de Windows.
    std::string normalized = level;
    std::replace(normalized.begin(), normalized.end(), '\\', '/');
    const std::filesystem::path path = std::filesystem::u8path(normalized);
    if (path.empty() || path.is_absolute() || path.has_root_name() || path.has_root_directory()) {
        return false;
    }
    for (const auto& part : path) {
        if (part == "..") {
            return false;
        }
    }
    return true;
}

bool Load(const std::filesystem::path& projectRoot, SaveData& out, const std::string& slot, LoadStatus* status) {
    const auto report = [status](LoadStatus value) {
        if (status) {
            *status = value;
        }
        return value == LoadStatus::Loaded || value == LoadStatus::Recovered;
    };

    const std::filesystem::path path = SavePath(projectRoot, slot);
    switch (ParseFile(path, out)) {
    case ParseResult::Ok:
        return report(LoadStatus::Loaded);
    case ParseResult::Missing:
        // Sin partida no se busca la copia: si alguien la borro (Borrar
        // partida, en el editor), es para empezar de cero.
        return report(LoadStatus::Missing);
    case ParseResult::TooNew:
        // Esta bien escrita, pero para otro motor: la copia seria vieja.
        return report(LoadStatus::TooNew);
    case ParseResult::Broken:
        break;
    }

    if (ParseFile(WithSuffix(path, ".bak"), out) == ParseResult::Ok) {
        std::cerr << "Se recupero la partida anterior (" << WithSuffix(path, ".bak").string() << ")." << std::endl;
        return report(LoadStatus::Recovered);
    }
    return report(LoadStatus::Broken);
}

bool Write(const std::filesystem::path& projectRoot, const SaveData& data, const std::string& slot) {
    nlohmann::json out;
    out["version"] = kVersion;
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
    if (!data.checkpoint.empty()) {
        out["checkpoint"] = data.checkpoint;
    }
    out["collectedItems"] = data.collectedItems;
    out["collectedCounts"] = nlohmann::json::object();
    for (const auto& [id, count] : data.collectedCounts) {
        out["collectedCounts"][id] = count;
    }
    out["collectedTotal"] = data.collectedTotal;
    out["firedEvents"] = data.firedEvents;

    const std::filesystem::path path = SavePath(projectRoot, slot);
    const std::filesystem::path temp = WithSuffix(path, ".tmp");
    std::error_code error;
    std::filesystem::create_directories(path.parent_path(), error);

    // 1. Todo al temporal. Si esto falla, la partida anterior ni se toco.
    {
        std::ofstream stream(temp, std::ios::binary | std::ios::trunc);
        if (!stream) {
            std::cerr << "No se pudo guardar la partida en " << path.string() << std::endl;
            return false;
        }
        stream << out.dump(2);
        stream.flush();
        if (!stream) {
            std::cerr << "No se pudo terminar de escribir la partida en " << temp.string() << std::endl;
            stream.close();
            std::filesystem::remove(temp, error);
            return false;
        }
    }

    // 2. La anterior, a .bak, solo si se puede leer: si estaba rota (y se
    //    continuo desde la copia), copiarla pisaria la unica copia buena. Si
    //    no se puede copiar se guarda igual: perder la copia es menos grave
    //    que perder el guardado.
    SaveData previous;
    if (ParseFile(path, previous) == ParseResult::Ok) {
        std::filesystem::copy_file(path, WithSuffix(path, ".bak"),
                                   std::filesystem::copy_options::overwrite_existing, error);
        if (error) {
            std::cerr << "No se pudo copiar la partida anterior a .bak: " << error.message() << std::endl;
        }
    }

    // 3. El temporal encima de la partida. Renombrar es atomico: quien la lea
    //    ve la vieja entera o la nueva entera.
    error.clear();
    std::filesystem::rename(temp, path, error);
    if (error) {
        std::cerr << "No se pudo reemplazar la partida (" << error.message() << ")." << std::endl;
        std::filesystem::remove(temp, error);
        return false;
    }
    return true;
}

}  // namespace Progress
