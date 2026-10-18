#pragma once

#include "raylib.h"

// Como encuadra la camara.
//   Fixed   el encuadre de siempre: el nivel entero centrado en la ventana.
//   Follow  sigue un punto (en el juego, el jugador) con zona muerta,
//           suavizado y, si se pide, sin salirse de los limites del nivel.
enum class CameraFraming { Fixed, Follow };

// Configuracion de la camara de un nivel ("camera" en
// schema/level.schema.json). Los valores por defecto reproducen EXACTAMENTE el
// encuadre de un nivel que no declara camara: Fixed y zoom 1.
struct CameraSettings {
    CameraFraming mode = CameraFraming::Fixed;
    // Pixeles de pantalla por pixel del mundo. 2 = todo se ve al doble.
    float zoom = 1.0f;
    // Segundos que tarda la camara en recorrer ~63% de la distancia que le
    // falta hasta su objetivo. 0 = rigida, pegada al jugador.
    float smoothing = 0.15f;
    // Rectangulo centrado en la pantalla, en pixeles de pantalla, dentro del
    // cual el jugador se mueve sin arrastrar la camara. 0x0 = siempre centrado.
    Vector2 deadzone{0, 0};
    // No mostrar el vacio mas alla del mapa: la camara se frena antes de que
    // el borde del nivel entre en pantalla. Un nivel mas chico que la vista
    // queda centrado en ese eje.
    bool clampToBounds = true;
};

// La camara 2D del juego. Decide QUE parte del mundo se ve; no dibuja nada.
//
// Trabaja con el "mundo" como lo deja IsoGridSystem::GridToScreen: pixeles
// isometricos sin ningun encuadre. Quien dibuja envuelve la pasada del mundo
// en GraphicsDevice::BeginWorld(GetCamera()) / EndWorld(); el HUD va despues,
// en pantalla.
//
// No sabe de niveles ni de jugadores (es Capa 2): recibe el punto a seguir, el
// centro del encuadre fijo y el rectangulo del que no salirse, y los calcula
// quien la usa (ver GameSession).
class CameraSystem {
public:
    static constexpr float kMinZoom = 0.25f;
    static constexpr float kMaxZoom = 8.0f;
    static constexpr float kMaxSmoothing = 2.0f;

    // Toma la configuracion, llevando a rango lo que este afuera.
    void Configure(const CameraSettings& settings);
    const CameraSettings& Settings() const { return settings_; }

    // Tamano actual de la ventana. Se llama al principio de cada frame: la
    // ventana se puede redimensionar en cualquier momento, y apuntar con el
    // mouse tiene que usar el mismo encuadre que se va a dibujar.
    void SetScreenSize(Vector2 screenSize);

    // Pone la camara en su lugar sin transicion. Al cargar un nivel: sin esto
    // el primer frame barreria la pantalla desde donde estaba la del anterior.
    void SnapTo(Vector2 focus, Vector2 fixedCenter, Rectangle bounds);

    // Avanza un frame. "focus" es lo que sigue el modo Follow; "fixedCenter",
    // el punto que el modo Fixed pone en el centro de la pantalla; "bounds",
    // el rectangulo del mundo del que no salirse.
    void Update(Vector2 focus, Vector2 fixedCenter, Rectangle bounds, float deltaTime);

    // Lista para GraphicsDevice::BeginWorld. Con una sacudida en curso (ver
    // Shake), el encuadre tiembla; ScreenToWorld y WorldToScreen no: apuntar
    // con el mouse no tiene que temblar con la pantalla.
    Camera2D GetCamera() const;

    // "Sacudir la camara": la imagen tiembla "intensity" pixeles de pantalla y
    // se va calmando hasta quedar quieta en "seconds". Una sacudida nueva
    // reemplaza a la que hubiera. Avanza con Update.
    void Shake(float intensity, float seconds);
    bool IsShaking() const { return shakeRemaining_ > 0.0f; }
    // Lo que se corre la imagen en este momento, en pixeles de pantalla.
    Vector2 ShakeOffset() const;
    static constexpr float kMaxShakeIntensity = 64.0f;
    static constexpr float kMaxShakeSeconds = 10.0f;

    // Las dos direcciones de la transformacion. ScreenToWorld es la que usa
    // apuntar con el mouse; WorldToScreen, lo que se dibuja en pantalla
    // sobre algo del mundo (las barras de vida).
    Vector2 ScreenToWorld(Vector2 screenPoint) const;
    Vector2 WorldToScreen(Vector2 worldPoint) const;

private:
    Vector2 Clamp(Vector2 center, Rectangle bounds) const;
    void Recompute();

    CameraSettings settings_;
    Vector2 screenSize_{0, 0};
    // El punto del mundo que queda en el centro de la pantalla.
    Vector2 center_{0, 0};
    // Ya calculado a partir de center_ (ver Recompute).
    Vector2 offset_{0, 0};
    // La sacudida en curso: cuanto falta, cuanto duraba, que tan fuerte, y el
    // reloj que mueve la oscilacion.
    float shakeRemaining_ = 0.0f;
    float shakeDuration_ = 0.0f;
    float shakeIntensity_ = 0.0f;
    float shakeClock_ = 0.0f;
};
