#pragma once

#include <string>

#include "core/ResourceManager.hpp"
#include "loader/AssetResolver.hpp"
#include "systems/event_system/EventSystem.hpp"
#include "world/Level.hpp"

// Orquestador de la Capa 3: lee un archivo de nivel (ver
// schema/level.schema.json), construye IsoGridSystem con los valores reales
// del nivel, resuelve y carga las texturas de cada entidad via
// AssetResolver/ResourceManager, y parsea+carga los eventos en el
// EventSystem que se le pase.
class LevelLoader {
public:
    LevelLoader(ResourceManager& resources, AssetResolver& assets);

    LoadedLevel Load(const std::string& levelPath, EventSystem& eventSystem);

private:
    ResourceManager& resources_;
    AssetResolver& assets_;
};
