// =============================================================================
// HoneyComb Engine - Sonda de rendimiento (engine_perf)
// =============================================================================
//
// Un ejecutable APARTE del motor para medir lo que pide el protocolo de
// rendimiento del plan de calidad (seccion 6.5): tiempo por cuadro con el
// jugador moviendose (M-01), tiempo de carga (M-02), pico de memoria (M-03) y
// el arranque hasta el primer cuadro (M-04).
//
// No es otro motor: compila los MISMOS archivos que engine.exe
// (HONEYCOMB_ENGINE_SOURCES) y corre la misma GameSession, cuadro por cuadro,
// con el mismo Frame() que usa Run(). Lo unico que agrega es lo que "--bench"
// no tiene: el tiempo de CADA cuadro (para percentiles y el 1% mas lento), la
// carga cronometrada aparte de abrir la ventana, la memoria y teclas
// simuladas para que el jugador camine.
//
// Las teclas se simulan empujando eventos de teclado de SDL, que es el backend
// de ventanas del motor: raylib las lee en PollInputEvents igual que si
// vinieran del teclado, asi que el jugador se mueve por el mismo camino que en
// una partida (InputSystem -> Mobility -> Movement). Recorre un cuadrado de
// "--tramo" segundos por lado; el generador de escenas
// (tools/gen-escenas-rendimiento.mjs) deja ese recorrido libre de obstaculos.
//
// Uso:  engine_perf <nivel.json> [opciones]
//   --segundos S        duracion de la medicion (60)
//   --calentamiento S   segundos iniciales que no cuentan (0.5, como --bench)
//   --sin-recorte       dibuja todo el nivel, aunque no se vea
//   --quieto            el jugador no se mueve
//   --tramo S           segundos por lado del cuadrado que camina (4)
//   --atacar            el jugador ataca cada 0.25 s (Espacio)
//   --directo           abre la sesion directo con el nivel, como engine.exe;
//                       sin esto se abre con levels/_arranque.json (un nivel
//                       vacio) y el nivel se carga despues, cronometrado, por
//                       el mismo camino que pasar de nivel
//   --recargar <nivel>  (se puede repetir) al final carga estos niveles uno
//                       tras otro y mide la memoria despues de cada uno
//   --limite-mb M       tope duro de memoria del proceso (4096)
//   --json <archivo>    escribe tambien el resultado en ese archivo
//   --etiqueta <texto>  nombre de la corrida en el resultado
//   --presupuesto       compara con los objetivos y sale con 2 si falla alguno:
//     --min-fps 60  --min-1pct 45  --max-carga-ms 2000  --max-memoria-mb 256
//
// Imprime una linea "PERF {json}" con todo lo medido, facil de juntar desde un
// script (tools/medir-rendimiento.mjs).
// =============================================================================

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <new>
#include <numeric>
#include <set>
#include <string>
#include <vector>

// Solo eventos y sugerencias de SDL: sin SDL.h, que redefine main.
#include <SDL_events.h>
#include <SDL_hints.h>
#include <SDL_keyboard.h>

#include "nlohmann/json.hpp"

#include "game/GameSession.hpp"
#include "game/Movement.hpp"
#include "perf/Proceso.hpp"

namespace {

using Reloj = std::chrono::steady_clock;

double MsEntre(Reloj::time_point desde, Reloj::time_point hasta)
{
    return std::chrono::duration<double, std::milli>(hasta - desde).count();
}

double Mb(std::uint64_t bytes)
{
    return static_cast<double>(bytes) / (1024.0 * 1024.0);
}

// El valor en la posicion "fraccion" (0..1) de una lista ya ordenada.
double Percentil(const std::vector<double> &ordenados, double fraccion)
{
    if (ordenados.empty())
    {
        return 0.0;
    }
    const double posicion = fraccion * static_cast<double>(ordenados.size() - 1);
    const std::size_t abajo = static_cast<std::size_t>(posicion);
    const std::size_t arriba = std::min(abajo + 1, ordenados.size() - 1);
    const double resto = posicion - static_cast<double>(abajo);
    return ordenados[abajo] * (1.0 - resto) + ordenados[arriba] * resto;
}

struct Opciones
{
    std::filesystem::path nivel;
    double segundos = 60.0;
    double calentamiento = 0.5;
    bool recorte = true;
    bool mover = true;
    double tramo = 4.0;
    bool atacar = false;
    bool directo = false;
    std::vector<std::filesystem::path> recargas;
    double limiteMb = 4096.0;
    std::string archivoJson;
    std::string etiqueta;
    bool presupuesto = false;
    double minFps = 60.0;
    double min1pct = 45.0;
    double maxCargaMs = 2000.0;
    double maxMemoriaMb = 256.0;
};

void EnviarTecla(SDL_Scancode tecla, bool abajo)
{
    SDL_Event evento{};
    evento.type = abajo ? SDL_KEYDOWN : SDL_KEYUP;
    evento.key.state = abajo ? SDL_PRESSED : SDL_RELEASED;
    evento.key.repeat = 0;
    evento.key.keysym.scancode = tecla;
    evento.key.keysym.sym = SDL_GetKeyFromScancode(tecla);
    SDL_PushEvent(&evento);
}

// Las flechas que hay que tener apretadas en cada lado del cuadrado. En
// isometrico "arriba" en pantalla no es un eje de la grilla: dos flechas a la
// vez si lo son (derecha+abajo = +columna, ver Mobility::UpdatePlayer).
struct Lado
{
    SDL_Scancode a;
    SDL_Scancode b;
};
constexpr Lado kLados[4] = {
    {SDL_SCANCODE_RIGHT, SDL_SCANCODE_DOWN},  // +columna
    {SDL_SCANCODE_DOWN, SDL_SCANCODE_LEFT},   // +fila
    {SDL_SCANCODE_LEFT, SDL_SCANCODE_UP},     // -columna
    {SDL_SCANCODE_UP, SDL_SCANCODE_RIGHT},    // -fila
};

}  // namespace

// Amiga de GameSession (ver GameSession.hpp): usa el mismo Frame() que Run().
class SondaRendimiento
{
public:
    explicit SondaRendimiento(const Opciones &opciones) : op(opciones) {}

    int Correr();

private:
    // El nivel ya cargado en la sesion: cuantas cosas tiene.
    void DescribirNivel(nlohmann::json &salida) const;
    // Un cuadro, con las teclas simuladas que tocan en el instante "t".
    void Cuadro(double t);
    void SoltarTeclas();

    const Opciones &op;
    GameSession *sesion = nullptr;
    int ladoActual = -1;
    bool ataqueApretado = false;
    double proximoAtaque = 0.0;
};

void SondaRendimiento::DescribirNivel(nlohmann::json &salida) const
{
    const LoadedLevel &nivel = sesion->level;
    int activas = 0;
    int enemigos = 0;
    int conCollider = 0;
    std::set<unsigned int> texturas;
    for (const auto &entidad : nivel.entities)
    {
        if (!entidad.destroyed && !entidad.hidden)
        {
            ++activas;
        }
        if (Combat::IsEnemy(entidad))
        {
            ++enemigos;
        }
        if (entidad.colliderSize.x > 0 && entidad.colliderSize.y > 0)
        {
            ++conCollider;
        }
        if (entidad.texture)
        {
            texturas.insert(entidad.texture->id);
        }
    }
    for (const auto &variante : nivel.floorVariants)
    {
        if (variante.texture)
        {
            texturas.insert(variante.texture->id);
        }
    }
    salida["nivel"] = nivel.name;
    salida["grilla"] = std::to_string(nivel.grid.GetGridWidth()) + "x" + std::to_string(nivel.grid.GetGridHeight());
    salida["entidades"] = nivel.entities.size();
    salida["entidades_activas"] = activas;
    salida["enemigos"] = enemigos;
    salida["con_collider"] = conCollider;
    salida["celdas_piso"] = nivel.floorTiles.size();
    salida["celdas_pared"] = nivel.wallTiles.size();
    salida["zonas"] = nivel.zones.size();
    salida["texturas_nivel"] = texturas.size();
}

void SondaRendimiento::SoltarTeclas()
{
    if (ladoActual >= 0)
    {
        EnviarTecla(kLados[ladoActual].a, false);
        EnviarTecla(kLados[ladoActual].b, false);
        ladoActual = -1;
    }
    if (ataqueApretado)
    {
        EnviarTecla(SDL_SCANCODE_SPACE, false);
        ataqueApretado = false;
    }
}

void SondaRendimiento::Cuadro(double t)
{
    if (op.mover)
    {
        const int lado = static_cast<int>(t / op.tramo) % 4;
        if (lado != ladoActual)
        {
            if (ladoActual >= 0)
            {
                EnviarTecla(kLados[ladoActual].a, false);
                EnviarTecla(kLados[ladoActual].b, false);
            }
            EnviarTecla(kLados[lado].a, true);
            EnviarTecla(kLados[lado].b, true);
            ladoActual = lado;
        }
    }
    if (op.atacar)
    {
        // Atacar mira el FLANCO de la tecla (IsKeyPressed): se aprieta un
        // cuadro y se suelta el siguiente.
        if (ataqueApretado)
        {
            EnviarTecla(SDL_SCANCODE_SPACE, false);
            ataqueApretado = false;
        }
        else if (t >= proximoAtaque)
        {
            EnviarTecla(SDL_SCANCODE_SPACE, true);
            ataqueApretado = true;
            proximoAtaque = t + 0.25;
        }
    }
    sesion->Frame(sesion->gfx.GetDeltaTime());
}

int SondaRendimiento::Correr()
{
    nlohmann::json r;
    r["etiqueta"] = op.etiqueta.empty() ? op.nivel.stem().string() : op.etiqueta;
    r["archivo"] = op.nivel.filename().string();
    r["compilacion"] = DevTools::kEnabled ? "Debug" : "Release";
    r["recorte"] = op.recorte;
    r["jugador_mueve"] = op.mover;
    r["atacar"] = op.atacar;
    r["ms_proceso_al_iniciar"] = Proceso::MsDesdeCreacion();
    r["limite_mb"] = op.limiteMb;
    r["limite_aplicado"] = Proceso::LimitarMemoria(static_cast<std::uint64_t>(op.limiteMb * 1024.0 * 1024.0));

    // Que la ventana no le robe el foco a lo que este usando la persona: la
    // medicion no necesita teclado real (las teclas se simulan).
    SDL_SetHint(SDL_HINT_WINDOW_NO_ACTIVATION_WHEN_SHOWN, "1");

    // --- Arranque y carga ------------------------------------------------
    const std::filesystem::path arranque = op.nivel.parent_path() / "_arranque.json";
    const bool conArranque = !op.directo && std::filesystem::exists(arranque);
    const std::filesystem::path primerNivel = conArranque ? arranque : op.nivel;

    const auto t0 = Reloj::now();
    const GameConfig config = LoadGameConfig(primerNivel.parent_path().parent_path());
    GameSession laSesion(primerNivel, config, GameSession::StartMode::Level);
    sesion = &laSesion;
    const auto t1 = Reloj::now();
    r["arranque_ms"] = MsEntre(t0, t1);
    r["modo_carga"] = conArranque ? "arranque+carga" : "directo";

    if (conArranque)
    {
        // El mismo camino que pasar de nivel (ver el final de GameSession::
        // Update): Load lee el JSON, arma la grilla y sube las texturas;
        // PrepareLevel ordena el piso y arma lo que depende del nivel. Las
        // texturas no estan en la cache: el nivel de arranque no usa ninguna.
        const auto c0 = Reloj::now();
        laSesion.level = laSesion.loader.Load(op.nivel.string(), laSesion.events);
        const auto c1 = Reloj::now();
        laSesion.currentLevelPath = op.nivel;
        laSesion.PrepareLevel(LevelStart::Fresh);
        laSesion.currentCollisions.clear();
        const auto c2 = Reloj::now();
        r["carga_ms"] = MsEntre(c0, c1);
        r["preparar_ms"] = MsEntre(c1, c2);
        r["carga_total_ms"] = MsEntre(c0, c2);
    }
    else
    {
        // Abierto directo: la carga esta adentro del arranque, junto con abrir
        // la ventana y el audio, y no se puede separar.
        r["carga_ms"] = nullptr;
        r["preparar_ms"] = nullptr;
        r["carga_total_ms"] = nullptr;
    }
    laSesion.SetCulling(op.recorte);
    DescribirNivel(r);

    // El primer cuadro: hasta aca es lo que espera quien aprieta F5.
    laSesion.Frame(laSesion.gfx.GetDeltaTime());
    r["ms_proceso_primer_cuadro"] = Proceso::MsDesdeCreacion();
    r["ms_desde_main_primer_cuadro"] = MsEntre(t0, Reloj::now());

    // --- Cuadros -------------------------------------------------------------
    // Sin tope de FPS, como --bench: se mide lo que el motor PUEDE dar. Cada
    // muestra es el tiempo entre el final de un cuadro y el del siguiente, que
    // es lo que dura un cuadro de verdad (incluye presentarlo en pantalla).
    laSesion.gfx.SetTargetFPS(0);
    std::vector<double> tiempos;
    tiempos.reserve(static_cast<std::size_t>(op.segundos * 2000.0));
    double dibujados = 0.0;
    double recortados = 0.0;
    double colisiones = 0.0;
    std::size_t maxProyectiles = 0;
    double recorrido = 0.0;
    Vector2 posicionAnterior = laSesion.player ? laSesion.player->precisePosition : Vector2{0, 0};

    const auto inicio = Reloj::now();
    auto finAnterior = inicio;
    bool midiendo = false;
    auto inicioMedicion = inicio;
    while (!laSesion.gfx.ShouldClose() && !laSesion.quitRequested)
    {
        const double t = MsEntre(inicio, Reloj::now()) / 1000.0;
        if (t >= op.calentamiento + op.segundos)
        {
            break;
        }
        Cuadro(t);
        const auto fin = Reloj::now();
        if (midiendo)
        {
            tiempos.push_back(MsEntre(finAnterior, fin));
            const ZSortSystem::Stats &stats = laSesion.zsort.LastStats();
            dibujados += stats.ground + stats.sorted;
            recortados += stats.culled;
            colisiones += static_cast<double>(laSesion.currentCollisions.size());
            maxProyectiles = std::max(maxProyectiles, laSesion.combatState.projectiles.size());
            if (laSesion.player)
            {
                const Vector2 ahora = laSesion.player->precisePosition;
                recorrido += std::hypot(ahora.x - posicionAnterior.x, ahora.y - posicionAnterior.y);
                posicionAnterior = ahora;
            }
        }
        else if (t >= op.calentamiento)
        {
            midiendo = true;
            inicioMedicion = fin;
            posicionAnterior = laSesion.player ? laSesion.player->precisePosition : Vector2{0, 0};
        }
        finAnterior = fin;
    }
    SoltarTeclas();
    const double medidoS = MsEntre(inicioMedicion, finAnterior) / 1000.0;
    const Proceso::Memoria memoriaJuego = Proceso::LeerMemoria();

    const std::size_t n = tiempos.size();
    std::vector<double> ordenados = tiempos;
    std::sort(ordenados.begin(), ordenados.end());
    // El 1% mas lento: el promedio de los cuadros que caen en el peor 1%,
    // pasado a FPS. Es la definicion habitual de "1% low".
    const std::size_t peores = std::max<std::size_t>(1, n / 100);
    const double sumaPeores = n ? std::accumulate(ordenados.end() - static_cast<std::ptrdiff_t>(std::min(peores, n)),
                                                  ordenados.end(), 0.0)
                                : 0.0;
    const double mediaPeoresMs = n ? sumaPeores / static_cast<double>(std::min(peores, n)) : 0.0;

    r["cuadros"] = n;
    r["segundos_medidos"] = medidoS;
    r["fps_promedio"] = medidoS > 0.0 ? static_cast<double>(n) / medidoS : 0.0;
    r["fps_1pct_bajo"] = mediaPeoresMs > 0.0 ? 1000.0 / mediaPeoresMs : 0.0;
    r["ms_promedio"] = n ? std::accumulate(tiempos.begin(), tiempos.end(), 0.0) / static_cast<double>(n) : 0.0;
    r["ms_p50"] = Percentil(ordenados, 0.50);
    r["ms_p90"] = Percentil(ordenados, 0.90);
    r["ms_p99"] = Percentil(ordenados, 0.99);
    r["ms_max"] = n ? ordenados.back() : 0.0;
    r["fps_p99"] = Percentil(ordenados, 0.99) > 0.0 ? 1000.0 / Percentil(ordenados, 0.99) : 0.0;
    r["sprites_dibujados"] = n ? dibujados / static_cast<double>(n) : 0.0;
    r["sprites_recortados"] = n ? recortados / static_cast<double>(n) : 0.0;
    r["colisiones_prom"] = n ? colisiones / static_cast<double>(n) : 0.0;
    r["proyectiles_max"] = maxProyectiles;
    r["recorrido_celdas"] = recorrido;
    r["entidades_activas_final"] = std::count_if(laSesion.level.entities.begin(), laSesion.level.entities.end(),
                                                 [](const LevelEntity &e) { return !e.destroyed && !e.hidden; });
    r["pico_residente_mb"] = Mb(memoriaJuego.picoResidenteBytes);
    r["pico_privada_mb"] = Mb(memoriaJuego.picoPrivadaBytes);
    r["residente_final_mb"] = Mb(memoriaJuego.residenteBytes);
    r["privada_final_mb"] = Mb(memoriaJuego.privadaBytes);

    // --- Niveles uno tras otro (cache de texturas, EN-11) ---------------------
    // Cada nivel se carga como al pasar de nivel y se juega un segundo; la
    // memoria se lee despues. La cache del ResourceManager no suelta nada al
    // cambiar de nivel: si cada nivel trae texturas propias, la memoria sube.
    nlohmann::json recargas = nlohmann::json::array();
    for (const auto &otro : op.recargas)
    {
        const auto c0 = Reloj::now();
        laSesion.level = laSesion.loader.Load(otro.string(), laSesion.events);
        laSesion.currentLevelPath = otro;
        laSesion.PrepareLevel(LevelStart::Carry);
        laSesion.currentCollisions.clear();
        const double cargaMs = MsEntre(c0, Reloj::now());
        const auto j0 = Reloj::now();
        while (MsEntre(j0, Reloj::now()) < 1000.0 && !laSesion.gfx.ShouldClose())
        {
            laSesion.Frame(laSesion.gfx.GetDeltaTime());
        }
        const Proceso::Memoria memoria = Proceso::LeerMemoria();
        nlohmann::json paso;
        DescribirNivel(paso);
        paso["carga_total_ms"] = cargaMs;
        paso["residente_mb"] = Mb(memoria.residenteBytes);
        paso["privada_mb"] = Mb(memoria.privadaBytes);
        paso["pico_residente_mb"] = Mb(memoria.picoResidenteBytes);
        recargas.push_back(paso);
    }
    r["recargas"] = recargas;

    // --- Cuanto de la carga es leer el JSON -----------------------------------
    // Aparte y al final, para no tocar el pico de memoria medido arriba.
    {
        const auto p0 = Reloj::now();
        std::ifstream archivo(op.nivel);
        const nlohmann::json documento = nlohmann::json::parse(archivo);
        r["json_ms"] = MsEntre(p0, Reloj::now());
        r["json_mb_archivo"] = Mb(std::filesystem::file_size(op.nivel));
        r["eventos"] = documento.contains("events") ? documento.at("events").size() : 0;
    }

    int codigo = 0;
    if (op.presupuesto)
    {
        const double fps = r["fps_promedio"].get<double>();
        const double bajo = r["fps_1pct_bajo"].get<double>();
        const double carga = r["carga_total_ms"].is_number() ? r["carga_total_ms"].get<double>()
                                                              : r["arranque_ms"].get<double>();
        const double memoria = r["pico_residente_mb"].get<double>();
        const auto revisar = [&](const char *nombre, bool cumple, double valor, const char *objetivo) {
            std::cout << "PRESUPUESTO " << nombre << ": " << valor << " (objetivo " << objetivo << ") "
                      << (cumple ? "CUMPLE" : "NO CUMPLE") << std::endl;
            if (!cumple)
            {
                codigo = 2;
            }
        };
        revisar("M-01 FPS promedio", fps >= op.minFps, fps, (">= " + std::to_string(op.minFps)).c_str());
        revisar("M-01 FPS del 1% mas lento", bajo >= op.min1pct, bajo, (">= " + std::to_string(op.min1pct)).c_str());
        revisar("M-02 carga (ms)", carga <= op.maxCargaMs, carga, ("<= " + std::to_string(op.maxCargaMs)).c_str());
        revisar("M-03 pico de memoria (MB)", memoria <= op.maxMemoriaMb, memoria,
                ("<= " + std::to_string(op.maxMemoriaMb)).c_str());
        r["presupuesto_cumple"] = codigo == 0;
    }

    std::cout << "PERF " << r.dump() << std::endl;
    std::cout << "RESUMEN " << r["compilacion"].get<std::string>() << (op.recorte ? "" : " sin recorte") << " | "
              << r["etiqueta"].get<std::string>() << " | " << r["entidades"] << " entidades | carga "
              << r["carga_total_ms"] << " ms | " << r["fps_promedio"].get<double>() << " FPS | 1% bajo "
              << r["fps_1pct_bajo"].get<double>() << " FPS | p99 " << r["ms_p99"].get<double>() << " ms | pico "
              << r["pico_residente_mb"].get<double>() << " MB" << std::endl;
    if (!op.archivoJson.empty())
    {
        // Con el "acceso controlado a carpetas" de Windows Defender prendido, un
        // .exe que no esta en la lista no puede escribir en Documentos: falla
        // sin aviso. Se avisa aca para no perder el resultado sin enterarse.
        std::ofstream archivo(op.archivoJson);
        archivo << r.dump(2) << std::endl;
        if (!archivo)
        {
            std::cerr << "No se pudo escribir " << op.archivoJson
                      << " (si esta en Documentos: acceso controlado a carpetas de Windows?)" << std::endl;
        }
    }
    return codigo;
}

int main(int argc, char *argv[])
{
    if (argc < 2)
    {
        std::cerr << "Uso: engine_perf <nivel.json> [--segundos S] [--sin-recorte] [--quieto] [--atacar] "
                     "[--directo] [--recargar <nivel>] [--limite-mb M] [--json <archivo>] [--presupuesto]"
                  << std::endl;
        return 1;
    }
    // Las rutas relativas, contra donde se lanzo; despues, como engine.exe, nos
    // paramos junto al binario (ahi estan sus DLL).
    const std::filesystem::path lanzamiento = std::filesystem::current_path();
    const auto absoluta = [&](const std::string &ruta) {
        const std::filesystem::path camino(ruta);
        return camino.is_absolute() ? camino : lanzamiento / camino;
    };

    Opciones op;
    op.nivel = absoluta(argv[1]);
    for (int i = 2; i < argc; ++i)
    {
        const std::string opcion = argv[i];
        const bool hayValor = i + 1 < argc;
        if (opcion == "--segundos" && hayValor)
            op.segundos = std::max(1.0, std::stod(argv[++i]));
        else if (opcion == "--calentamiento" && hayValor)
            op.calentamiento = std::max(0.0, std::stod(argv[++i]));
        else if (opcion == "--sin-recorte")
            op.recorte = false;
        else if (opcion == "--quieto")
            op.mover = false;
        else if (opcion == "--tramo" && hayValor)
            op.tramo = std::max(0.1, std::stod(argv[++i]));
        else if (opcion == "--atacar")
            op.atacar = true;
        else if (opcion == "--directo")
            op.directo = true;
        else if (opcion == "--recargar" && hayValor)
            op.recargas.push_back(absoluta(argv[++i]));
        else if (opcion == "--limite-mb" && hayValor)
            op.limiteMb = std::stod(argv[++i]);
        else if (opcion == "--json" && hayValor)
            op.archivoJson = absoluta(argv[++i]).string();
        else if (opcion == "--etiqueta" && hayValor)
            op.etiqueta = argv[++i];
        else if (opcion == "--presupuesto")
            op.presupuesto = true;
        else if (opcion == "--min-fps" && hayValor)
            op.minFps = std::stod(argv[++i]);
        else if (opcion == "--min-1pct" && hayValor)
            op.min1pct = std::stod(argv[++i]);
        else if (opcion == "--max-carga-ms" && hayValor)
            op.maxCargaMs = std::stod(argv[++i]);
        else if (opcion == "--max-memoria-mb" && hayValor)
            op.maxMemoriaMb = std::stod(argv[++i]);
        else
        {
            std::cerr << "Opcion desconocida: " << opcion << std::endl;
            return 1;
        }
    }
    std::filesystem::current_path(std::filesystem::absolute(argv[0]).parent_path());

    try
    {
        SondaRendimiento sonda(op);
        return sonda.Correr();
    }
    catch (const std::bad_alloc &)
    {
        // Lo esperable al pasar el tope de --limite-mb: se informa como dato.
        const Proceso::Memoria memoria = Proceso::LeerMemoria();
        std::cout << "PERF {\"error\":\"sin memoria (bad_alloc)\",\"archivo\":\"" << op.nivel.filename().string()
                  << "\",\"pico_privada_mb\":" << Mb(memoria.picoPrivadaBytes) << "}" << std::endl;
        return 3;
    }
    catch (const std::exception &error)
    {
        std::cout << "PERF {\"error\":" << nlohmann::json(error.what()).dump() << ",\"archivo\":\""
                  << op.nivel.filename().string() << "\"}" << std::endl;
        return 1;
    }
}
