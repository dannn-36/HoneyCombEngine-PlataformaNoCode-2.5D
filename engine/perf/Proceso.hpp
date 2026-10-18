#pragma once

// =============================================================================
// Lo que la sonda de rendimiento le pregunta al sistema operativo
// =============================================================================
//
// Va aparte de SondaRendimiento.cpp a proposito: windows.h y raylib.h no
// pueden estar en el mismo archivo (los dos declaran Rectangle, CloseWindow,
// DrawText...). Este encabezado no incluye ninguno de los dos.
//
// Fuera de Windows las funciones devuelven 0 y el limite no hace nada: la
// sonda sigue midiendo los cuadros y la carga, solo sin la memoria.
// =============================================================================

#include <cstdint>

namespace Proceso {

struct Memoria
{
    // Lo que el proceso tiene en RAM ahora y lo maximo que llego a tener.
    std::uint64_t residenteBytes = 0;
    std::uint64_t picoResidenteBytes = 0;
    // Memoria privada comprometida (lo que pidio el proceso, este o no en RAM).
    std::uint64_t privadaBytes = 0;
    std::uint64_t picoPrivadaBytes = 0;
};

Memoria LeerMemoria();

// Milisegundos desde que el sistema creo este proceso. Es la base del tiempo
// de arranque (M-04): incluye cargar el .exe y sus DLL, que el reloj del
// programa no ve.
double MsDesdeCreacion();

// Pone un tope DURO a la memoria del proceso (un Job Object de Windows): pasado
// el tope, las reservas fallan y el motor se cae con bad_alloc en vez de llevar
// la maquina a usar el disco como memoria. false si no se pudo poner.
bool LimitarMemoria(std::uint64_t bytes);

}  // namespace Proceso
