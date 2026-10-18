// Implementacion de las ayudas de las pruebas. El contrato esta en el .hpp.

#include "support/TestSupport.hpp"

#include <atomic>
#include <chrono>
#include <fstream>
#include <stdexcept>

namespace TestSupport {

namespace {

GraphicsDevice* g_graphics = nullptr;

}  // namespace

std::filesystem::path RepoPath(const std::string& relative) {
    const std::filesystem::path root(HONEYCOMB_REPO_DIR);
    return relative.empty() ? root : root / std::filesystem::u8path(relative);
}

TempDir::TempDir() {
    // Un nombre por proceso y por carpeta: ctest corre cada suite en su propio
    // proceso, y dos pruebas no pueden compartir carpeta.
    static std::atomic<int> counter{0};
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    path_ = std::filesystem::temp_directory_path() / "honeycomb-tests" /
            (std::to_string(stamp) + "-" + std::to_string(counter++));
    std::filesystem::create_directories(path_);
}

TempDir::~TempDir() {
    std::error_code error;
    std::filesystem::remove_all(path_, error);
}

std::filesystem::path TempDir::WriteText(const std::string& name, const std::string& text) const {
    const std::filesystem::path file = path_ / std::filesystem::u8path(name);
    std::filesystem::create_directories(file.parent_path());
    std::ofstream stream(file, std::ios::binary);
    stream << text;
    if (!stream) {
        throw std::runtime_error("TempDir: no se pudo escribir " + file.string());
    }
    return file;
}

std::filesystem::path TempDir::WriteJson(const std::string& name, const nlohmann::json& value) const {
    return WriteText(name, value.dump(2));
}

std::filesystem::path TempDir::WritePng(const std::string& name, int width, int height, Color color) const {
    const std::filesystem::path file = path_ / std::filesystem::u8path(name);
    std::filesystem::create_directories(file.parent_path());
    Image image = GenImageColor(width, height, color);
    const bool ok = ExportImage(image, file.string().c_str());
    UnloadImage(image);
    if (!ok) {
        throw std::runtime_error("TempDir: no se pudo escribir " + file.string());
    }
    return file;
}

nlohmann::json MinimalLevel(int width, int height) {
    return nlohmann::json{
        {"name", "prueba"},
        {"grid", {{"width", width}, {"height", height}, {"tileWidth", 64}, {"tileHeight", 32}}},
        {"entities", nlohmann::json::array()},
        {"events", nlohmann::json::array()},
    };
}

nlohmann::json EntityJson(const std::string& id, const std::string& type, int col, int row,
                          const std::string& texture) {
    return nlohmann::json{
        {"id", id},
        {"type", type},
        {"position", {{"col", col}, {"row", row}}},
        {"texture", texture},
        {"sourceRect", {{"x", 0}, {"y", 0}, {"width", 16}, {"height", 16}}},
    };
}

LoadedLevel OpenLevel(int width, int height) {
    LoadedLevel level{
        "prueba",
        IsoGridSystem(width, height, 64, 32),
        {},
        nullptr,
        Rectangle{0, 0, 0, 0},
        nullptr,
        Rectangle{0, 0, 0, 0},
        {},
        {}
    };
    for (int row = 0; row < height; ++row) {
        for (int col = 0; col < width; ++col) {
            level.floorTiles.push_back(GridCoord{col, row});
            level.floorTileVariants.push_back(-1);
        }
    }
    return level;
}

LevelEntity MakeEntity(const std::string& id, const std::string& type, float col, float row) {
    LevelEntity entity{};
    entity.id = id;
    entity.type = type;
    entity.position = GridCoord{static_cast<int>(col), static_cast<int>(row)};
    entity.precisePosition = Vector2{col, row};
    entity.startPosition = entity.precisePosition;
    entity.texture = nullptr;
    entity.sourceRect = Rectangle{0, 0, 16, 16};
    entity.colliderSize = Vector2{0, 0};
    return entity;
}

const Texture2D* WallTextureFlag() {
    static const Texture2D flag{};
    return &flag;
}

GraphicsDevice& Graphics() {
    if (!g_graphics) {
        throw std::logic_error("TestSupport: no hay ventana abierta");
    }
    return *g_graphics;
}

void SetGraphics(GraphicsDevice* graphics) {
    g_graphics = graphics;
}

}  // namespace TestSupport
