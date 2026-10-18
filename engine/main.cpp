// =============================================================================
// HoneyComb Engine - Runtime (punto de entrada)
// =============================================================================
//
// Punto de entrada. Resuelve donde esta el nivel que hay que abrir y arranca
// una GameSession con el; el juego propiamente dicho -- las capas, el nivel
// cargado y el bucle -- vive en game/GameSession.{hpp,cpp}.
//
//   Capa 1 (core/)     GraphicsDevice, ResourceManager -> unicos que hablan
//                      con raylib para ventana/dibujo y recursos.
//   Capa 2 (systems/)  IsoGrid, ZSort, Collision, Event, Animation, Audio,
//                      Input -> logica reutilizable, sin saber de niveles.
//   Capa 3 (loader/)   AssetResolver, LevelLoader, EventLoader, ItemLoader ->
//                      leen el JSON y arman con el el modelo de world/.
//   Capa 4 (game/)     Movement, Mobility, Combat, Inventory, Loot, Zones ->
//                      las reglas del juego sobre el nivel ya cargado: por
//                      donde se camina, quien le pega a quien, que se junta.
//                      CombatView dibuja lo que esas reglas dejaron.
//
//   world/             Level, ItemDefs -> el modelo: QUE hay en un nivel y en
//                      que estado esta. No es una capa mas arriba ni mas
//                      abajo: es el lenguaje comun que la Capa 3 llena y la
//                      Capa 4 usa, y no depende de ninguna de las dos.
//
// Nada de lo que hay aca esta atado a un nivel concreto: el tamano de la
// grilla, las texturas, las entidades y los eventos salen todos del archivo de
// nivel (ver schema/level.schema.json). Cambiar el juego = cambiar el JSON, sin
// recompilar. Eso es lo que hace que el editor NoCode tenga sentido.
//
// Uso:  engine.exe [ruta/al/nivel.json]     (por defecto: levels/test_level.json)
//       engine.exe <nivel> --bench <segundos>   mide los FPS sin tope y sale
//       ... --sin-recorte                       dibuja todo, aunque no se vea
//       ... --captura <archivo.png>             guarda el ultimo cuadro (junto al .exe)
// Teclas: flechas o WASD = mover | clic izquierdo, Espacio o J = atacar hacia
//         el mouse | Q = habilidad | Shift = esquivar | clic derecho o K =
//         defender | 1-9 o rueda = elegir arma | E = cambiar arma / tienda |
//         F11 = pantalla completa
//         Solo en Debug: F3 = herramientas de administrador (F1 grilla, F2
//         hitboxes y las demas: ver game/DevTools.hpp)
// =============================================================================

#include <algorithm>
#include <exception>
#include <filesystem>
#include <iostream>
#include <string>

#include "game/GameSession.hpp"

int main(int argc, char *argv[])
{
    // --- Resolucion de rutas ------------------------------------------------
    // Hay dos directorios en juego y casi nunca son el mismo:
    //   launchDirectory     - desde donde el usuario ejecuto el .exe
    //   executableDirectory - donde vive el .exe (ahi CMake copia assets/ y levels/)
    // Se guarda el primero ANTES de movernos, porque una ruta de nivel relativa
    // escrita en la terminal es relativa a el, no al binario.
    const std::filesystem::path launchDirectory = std::filesystem::current_path();
    const std::filesystem::path executableDirectory =
        std::filesystem::absolute(argv[0]).parent_path();

    // Nos paramos junto al .exe: AssetResolver busca "assets/" relativo al
    // directorio de trabajo, asi que abrirlo con doble clic desde el explorador
    // tiene que funcionar igual que lanzarlo desde una terminal.
    if (argc > 0)
    {
        std::filesystem::current_path(executableDirectory);
    }

    std::filesystem::path levelPath = "levels/test_level.json";
    if (argc >= 2)
    {
        levelPath = std::filesystem::path(argv[1]);
        if (levelPath.is_relative())
        {
            // Una ruta relativa puede apuntar a cualquiera de los dos lugares.
            // Gana el directorio de lanzamiento si el archivo existe ahi (es lo
            // que el usuario quiso decir); si no, se prueba junto al binario.
            const std::filesystem::path launchRelativePath = launchDirectory / levelPath;
            const std::filesystem::path executableRelativePath = executableDirectory / levelPath;
            if (std::filesystem::exists(launchRelativePath))
            {
                levelPath = launchRelativePath;
            }
            else
            {
                levelPath = executableRelativePath;
            }
        }
    }

    // "--bench <segundos>" despues del nivel: medir en vez de jugar (ver
    // GameSession::Benchmark). "--sin-recorte" dibuja todo el nivel, aunque
    // no se vea: es para medir cuanto ahorra el recorte por camara.
    float benchSeconds = 0.0f;
    bool culling = true;
    std::string screenshot;
    for (int i = 2; i < argc; ++i)
    {
        const std::string option = argv[i];
        if (option == "--bench" && i + 1 < argc)
        {
            benchSeconds = std::max(1.0f, std::stof(argv[i + 1]));
        }
        else if (option == "--sin-recorte")
        {
            culling = false;
        }
        else if (option == "--captura" && i + 1 < argc)
        {
            screenshot = argv[i + 1];
        }
    }

    try
    {
        GameSession session(levelPath);
        session.SetCulling(culling);
        if (benchSeconds > 0.0f)
        {
            session.Benchmark(benchSeconds, screenshot);
        }
        else
        {
            session.Run();
        }
    }
    catch (const std::exception &error)
    {
        // Un nivel inicial roto o inexistente: se avisa por consola en vez de
        // morir con un "terminate called after throwing...".
        std::cerr << "No se pudo arrancar: " << error.what() << std::endl;
        return 1;
    }
    return 0;
}
