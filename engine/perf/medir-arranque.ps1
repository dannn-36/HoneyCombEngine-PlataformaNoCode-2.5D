# =============================================================================
# M-04: cuanto tarda engine.exe en mostrar su ventana y en tener el nivel listo
# =============================================================================
#
# Mide desde AFUERA el motor de verdad (engine.exe, sin la sonda): lanza el
# proceso con un nivel, como hace el editor con F5 (editor/ipc/run.js), y toma
#   ventana_ms  hasta que el proceso tiene ventana (MainWindowHandle != 0)
#   nivel_ms    hasta que el motor imprime "Nivel cargado" (fin de PrepareLevel,
#               justo antes del primer cuadro)
# y lo cierra. Repite y da la mediana. La primera corrida despues de compilar
# suele tardar mas: el antivirus revisa el .exe nuevo. Se informa aparte.
#
# El F5 del editor suma, antes de esto, guardar el nivel y el salto por IPC
# (renderer -> proceso principal de Electron -> spawn): no se mide aca.
#
# Uso (PowerShell, desde la raiz del repositorio):
#   powershell -File engine/perf/medir-arranque.ps1 [-Motor engine/build-perf/engine.exe]
#       [-Nivel engine/build-perf/escenas/levels/rend_e0500.json] [-Repeticiones 10] [-Csv salida.csv]
# =============================================================================

param(
    [string]$Motor = "engine/build-perf/engine.exe",
    [string]$Nivel = "engine/build-perf/escenas/levels/rend_e0500.json",
    [int]$Repeticiones = 10,
    [int]$TopeMs = 15000,
    [string]$Csv = ""
)

$motor = (Resolve-Path $Motor).Path
$nivel = (Resolve-Path $Nivel).Path
$salida = Join-Path $env:TEMP "honeycomb_arranque_$PID.txt"
$filas = @()

for ($i = 1; $i -le $Repeticiones; $i++) {
    Remove-Item $salida -ErrorAction SilentlyContinue
    $reloj = [Diagnostics.Stopwatch]::StartNew()
    $proceso = Start-Process -FilePath $motor -ArgumentList "`"$nivel`"" -WorkingDirectory (Split-Path $motor) `
        -RedirectStandardOutput $salida -PassThru
    $ventana = $null
    $listo = $null
    while ($reloj.ElapsedMilliseconds -lt $TopeMs -and ($null -eq $ventana -or $null -eq $listo)) {
        $proceso.Refresh()
        if ($null -eq $ventana -and $proceso.MainWindowHandle -ne 0) { $ventana = $reloj.Elapsed.TotalMilliseconds }
        if ($null -eq $listo -and (Test-Path $salida)) {
            $texto = Get-Content $salida -Raw -ErrorAction SilentlyContinue
            if ($texto -and $texto.Contains("Nivel cargado")) { $listo = $reloj.Elapsed.TotalMilliseconds }
        }
        if ($proceso.HasExited) { break }
        Start-Sleep -Milliseconds 2
    }
    if (-not $proceso.HasExited) { Stop-Process -Id $proceso.Id -Force }
    $proceso.WaitForExit()
    $fila = [pscustomobject]@{ repeticion = $i; ventana_ms = $ventana; nivel_ms = $listo }
    $filas += $fila
    Write-Host ("#{0}: ventana {1:N0} ms | nivel listo {2:N0} ms" -f $i, $ventana, $listo)
    Start-Sleep -Milliseconds 500
}
Remove-Item $salida -ErrorAction SilentlyContinue

function Mediana($valores) {
    $lista = @($valores | Where-Object { $_ -ne $null } | Sort-Object)
    if ($lista.Count -eq 0) { return $null }
    $medio = [math]::Floor($lista.Count / 2)
    if ($lista.Count % 2) { return $lista[$medio] }
    return ($lista[$medio - 1] + $lista[$medio]) / 2
}

# La primera, aparte (antivirus); la mediana, de las demas.
$resto = $filas | Select-Object -Skip 1
"PRIMERA ventana {0:N0} ms | nivel {1:N0} ms" -f $filas[0].ventana_ms, $filas[0].nivel_ms
"MEDIANA ventana {0:N0} ms | nivel {1:N0} ms  (de {2} corridas)" -f (Mediana ($resto.ventana_ms)), (Mediana ($resto.nivel_ms)), @($resto).Count
if ($Csv) { $filas | Export-Csv -NoTypeInformation -Encoding UTF8 $Csv }
