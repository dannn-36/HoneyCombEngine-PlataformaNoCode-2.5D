#pragma once

#include "raylib.h"

// Envoltorio de reproduccion de audio en tiempo de juego: toma los recursos
// Sound/Music que carga ResourceManager (Capa 1) y controla su reproduccion.
// Ningun System de la Capa 2 debe llamar PlaySound/PlayMusicStream
// directamente -- todo pasa por aca, igual que GraphicsDevice para dibujo.
class AudioSystem {
public:
    // volume va de 0 (mudo) a 1 (el volumen del archivo): el "Volumen %" que
    // el editor guarda en cada uso de un sonido, ya dividido por 100.
    void PlaySoundEffect(const Sound& sound, float volume = 1.0f);

    // Solo una pista de musica activa a la vez (reemplaza la anterior si habia).
    // OJO: hoy loop=false no corta la repeticion -- ver el detalle en el
    // Update() de AudioSystem.cpp.
    void PlayMusic(Music& music, bool loop = true, float volume = 1.0f);
    void StopMusic();

    // Llamar una vez por frame: raylib necesita UpdateMusicStream() continuo
    // mientras suena musica en streaming.
    void Update();

    void SetMusicVolume(float volume);

private:
    Music* currentMusic_ = nullptr;
    bool loopCurrentMusic_ = true;
};
