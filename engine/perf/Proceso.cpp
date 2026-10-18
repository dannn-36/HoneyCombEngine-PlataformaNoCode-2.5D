// Implementacion de Proceso (ver Proceso.hpp). Solo Windows: es la maquina
// donde se mide; en otro sistema todo devuelve 0.

#include "Proceso.hpp"

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <psapi.h>
#endif

namespace Proceso {

#ifdef _WIN32

Memoria LeerMemoria()
{
    Memoria memoria;
    PROCESS_MEMORY_COUNTERS_EX contadores{};
    contadores.cb = sizeof(contadores);
    if (GetProcessMemoryInfo(GetCurrentProcess(), reinterpret_cast<PROCESS_MEMORY_COUNTERS *>(&contadores),
                             sizeof(contadores)))
    {
        memoria.residenteBytes = contadores.WorkingSetSize;
        memoria.picoResidenteBytes = contadores.PeakWorkingSetSize;
        memoria.privadaBytes = contadores.PrivateUsage;
        memoria.picoPrivadaBytes = contadores.PeakPagefileUsage;
    }
    return memoria;
}

double MsDesdeCreacion()
{
    FILETIME creacion, salida, kernel, usuario;
    if (!GetProcessTimes(GetCurrentProcess(), &creacion, &salida, &kernel, &usuario))
    {
        return 0.0;
    }
    FILETIME ahora;
    GetSystemTimePreciseAsFileTime(&ahora);
    const auto aEntero = [](const FILETIME &tiempo) {
        return (static_cast<std::uint64_t>(tiempo.dwHighDateTime) << 32) | tiempo.dwLowDateTime;
    };
    // FILETIME cuenta de a 100 ns.
    return static_cast<double>(aEntero(ahora) - aEntero(creacion)) / 10000.0;
}

bool LimitarMemoria(std::uint64_t bytes)
{
    HANDLE trabajo = CreateJobObjectW(nullptr, nullptr);
    if (!trabajo)
    {
        return false;
    }
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limite{};
    limite.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY;
    limite.ProcessMemoryLimit = static_cast<SIZE_T>(bytes);
    if (!SetInformationJobObject(trabajo, JobObjectExtendedLimitInformation, &limite, sizeof(limite)))
    {
        CloseHandle(trabajo);
        return false;
    }
    // El handle queda abierto a proposito: el Job vive mientras viva el proceso.
    return AssignProcessToJobObject(trabajo, GetCurrentProcess()) != 0;
}

#else

Memoria LeerMemoria() { return Memoria{}; }
double MsDesdeCreacion() { return 0.0; }
bool LimitarMemoria(std::uint64_t) { return false; }

#endif

}  // namespace Proceso
