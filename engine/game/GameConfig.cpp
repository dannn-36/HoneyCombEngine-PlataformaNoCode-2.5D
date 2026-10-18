// Implementacion de GameConfig. Que es y donde vive esta en el .hpp.
//
// Como el resto de los loaders: lo que falta toma su valor por defecto y lo
// que esta fuera de rango se lleva al rango, en vez de romper. El editor ya
// valida, pero el JSON se puede editar a mano.

#include "GameConfig.hpp"

#include <algorithm>
#include <exception>
#include <fstream>
#include <iostream>

#include "nlohmann/json.hpp"

namespace {

using nlohmann::json;

Color ReadColor(const json& parent, const char* key, Color fallback) {
    if (!parent.contains(key) || !parent.at(key).is_object()) {
        return fallback;
    }
    const json& color = parent.at(key);
    const auto channel = [&color](const char* name, unsigned char value) {
        return static_cast<unsigned char>(std::clamp(color.value(name, static_cast<int>(value)), 0, 255));
    };
    return Color{channel("r", fallback.r), channel("g", fallback.g), channel("b", fallback.b),
                 channel("a", fallback.a == 0 ? 255 : fallback.a)};
}

std::string ReadString(const json& parent, const char* key) {
    return parent.contains(key) && parent.at(key).is_string() ? parent.at(key).get<std::string>() : std::string();
}

BackgroundFit ReadFit(const std::string& mode) {
    return mode == "stretch" ? BackgroundFit::Stretch : mode == "tile" ? BackgroundFit::Tile : BackgroundFit::Cover;
}

void ReadTitle(const json& source, TitleScreenConfig& title) {
    const std::string style = source.value("style", std::string("centered"));
    title.style = style == "side" ? TitleStyle::Side : style == "minimal" ? TitleStyle::Minimal : TitleStyle::Centered;
    title.title = ReadString(source, "title");
    title.subtitle = ReadString(source, "subtitle");
    title.titleColor = ReadColor(source, "titleColor", title.titleColor);
    title.subtitleColor = ReadColor(source, "subtitleColor", title.subtitleColor);
    title.titleSize = std::clamp(source.value("titleSize", title.titleSize), 10.0f, 200.0f);
    title.subtitleSize = std::clamp(source.value("subtitleSize", title.subtitleSize), 8.0f, 120.0f);
    title.backgroundColor = ReadColor(source, "backgroundColor", title.backgroundColor);
    title.backgroundImage = ReadString(source, "backgroundImage");
    title.backgroundFit = ReadFit(source.value("backgroundMode", std::string("cover")));
    title.buttonColor = ReadColor(source, "buttonColor", title.buttonColor);
    title.buttonHighlight = ReadColor(source, "buttonHighlight", title.buttonHighlight);
    title.music = ReadString(source, "music");
}

void ReadHud(const json& source, HudConfig& hud) {
    const std::string style = source.value("healthStyle", std::string("bar"));
    hud.healthStyle = style == "hearts"     ? HealthStyle::Hearts
                      : style == "segments" ? HealthStyle::Segments
                      : style == "number"   ? HealthStyle::Number
                                            : HealthStyle::Bar;
    const std::string corner = source.value("healthPosition", std::string("top-left"));
    hud.healthCorner = corner == "top-right"     ? HudCorner::TopRight
                       : corner == "bottom-left"  ? HudCorner::BottomLeft
                       : corner == "bottom-right" ? HudCorner::BottomRight
                                                  : HudCorner::TopLeft;
    hud.healthScale = std::clamp(source.value("healthScale", hud.healthScale), 0.5f, 3.0f);
    hud.healthFill = ReadColor(source, "healthFill", hud.healthFill);
    hud.healthEmpty = ReadColor(source, "healthEmpty", hud.healthEmpty);
    // El borde existe solo si el JSON lo trae: por defecto no hay.
    if (source.contains("healthBorder")) {
        hud.healthBorder = ReadColor(source, "healthBorder", Color{255, 255, 255, 255});
    }
    hud.showHealthLabel = source.value("showHealthLabel", hud.showHealthLabel);
    hud.showHealthNumber = source.value("showHealthNumber", hud.showHealthNumber);
    hud.healthPerHeart = std::max(1.0f, source.value("healthPerHeart", hud.healthPerHeart));
    hud.segments = std::clamp(source.value("segments", hud.segments), 2, 40);
    hud.heartFull = ReadString(source, "heartFull");
    hud.heartEmpty = ReadString(source, "heartEmpty");
    hud.barFill = ReadString(source, "barFill");
    hud.barFrame = ReadString(source, "barFrame");
    hud.showCoins = source.value("showCoins", hud.showCoins);
    hud.showInventory = source.value("showInventory", hud.showInventory);
    hud.showControls = source.value("showControls", hud.showControls);
    hud.showBossBar = source.value("showBossBar", hud.showBossBar);
    hud.showOverheadBars = source.value("showOverheadBars", hud.showOverheadBars);
}

void ReadScreens(const json& source, ScreensConfig& screens) {
    const std::string pause = ReadString(source, "pauseTitle");
    if (!pause.empty()) {
        screens.pauseTitle = pause;
    }
    const std::string gameOver = ReadString(source, "gameOverTitle");
    if (!gameOver.empty()) {
        screens.gameOverTitle = gameOver;
    }
    screens.gameOverColor = ReadColor(source, "gameOverColor", screens.gameOverColor);
    if (source.contains("credits") && source.at("credits").is_array()) {
        for (const auto& line : source.at("credits")) {
            if (line.is_string()) {
                screens.credits.push_back(line.get<std::string>());
            }
        }
    }
}

}  // namespace

GameConfig LoadGameConfig(const std::filesystem::path& projectRoot) {
    GameConfig config;
    const std::filesystem::path file = projectRoot / "game.json";
    std::ifstream stream(file);
    if (!stream) {
        return config;
    }
    try {
        const json source = json::parse(stream);
        config.present = true;
        config.name = ReadString(source, "name");
        config.icon = ReadString(source, "icon");
        if (source.contains("window") && source.at("window").is_object()) {
            const json& window = source.at("window");
            config.width = std::clamp(window.value("width", config.width), 320, 7680);
            config.height = std::clamp(window.value("height", config.height), 240, 4320);
            config.fullscreen = window.value("fullscreen", config.fullscreen);
        }
        config.startLevel = ReadString(source, "startLevel");
        if (source.contains("titleScreen") && source.at("titleScreen").is_object()) {
            ReadTitle(source.at("titleScreen"), config.titleScreen);
        }
        if (source.contains("hud") && source.at("hud").is_object()) {
            ReadHud(source.at("hud"), config.hud);
        }
        if (source.contains("screens") && source.at("screens").is_object()) {
            ReadScreens(source.at("screens"), config.screens);
        }
        if (source.contains("variables") && source.at("variables").is_object()) {
            for (const auto& [name, value] : source.at("variables").items()) {
                if (value.is_number()) {
                    config.variables[name] = value.get<float>();
                }
            }
        }
    } catch (const std::exception& error) {
        std::cerr << "game.json no se pudo leer (" << error.what() << "): se usan los valores de siempre."
                  << std::endl;
        return GameConfig{};
    }
    return config;
}

std::string WindowTitle(const GameConfig& config, bool debugBuild) {
    const std::string base = config.present && !config.name.empty() ? config.name : "HoneyComb Engine - Runtime";
    return debugBuild ? base + " (Debug)" : base;
}
