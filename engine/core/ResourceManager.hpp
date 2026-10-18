#pragma once

#include <cstddef>
#include <string>
#include <unordered_map>
#include <unordered_set>

#include "raylib.h"

// Dueno de texturas/fuentes/sonidos/musica: carga+cachea por ruta y libera
// todo automaticamente (RAII). Tambien es dueno del ciclo de vida del
// dispositivo de audio (raudio), por lo que ningun System de la Capa 2 llama
// InitAudioDevice/CloseAudioDevice directamente.
class ResourceManager {
public:
    ResourceManager();
    ~ResourceManager();

    ResourceManager(const ResourceManager&) = delete;
    ResourceManager& operator=(const ResourceManager&) = delete;

    const Texture2D& GetTexture(const std::string& path);
    const Font& GetFont(const std::string& path);
    const Sound& GetSound(const std::string& path);
    const Music& GetMusic(const std::string& path);

    void UnloadAll();

    // Descarga las texturas que no estan en "inUse" y devuelve cuantas libero.
    // Es para pasar de nivel: sin esto la cache solo crecia (unos 39 MB por
    // nivel con 300 texturas, medido en EN-11). Quien llama tiene que poner en
    // "inUse" TODA textura que alguien siga apuntando: una que falte queda
    // colgada. Las que quedan siguen en la misma direccion (unordered_map no
    // mueve sus elementos al borrar otros).
    std::size_t ReleaseTexturesExcept(const std::unordered_set<const Texture2D*>& inUse);

private:
    std::unordered_map<std::string, Texture2D> textures_;
    std::unordered_map<std::string, Font> fonts_;
    std::unordered_map<std::string, Sound> sounds_;
    std::unordered_map<std::string, Music> music_;
};
