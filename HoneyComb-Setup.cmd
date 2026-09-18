@echo off
REM ============================================================================
REM  HoneyComb Engine - Instalador (Windows)
REM ============================================================================
REM
REM  Doble clic en este archivo y listo: abre el asistente de instalacion, que
REM  revisa los requisitos, instala lo que falte, compila el motor y el editor,
REM  y al terminar abre el editor.
REM
REM  Es un .cmd y no un .ps1 a proposito: Windows viene con la ExecutionPolicy
REM  en Restricted, asi que hacer doble clic en un .ps1 no lo ejecuta. Este .cmd
REM  no pasa por esa politica y llama a PowerShell con -ExecutionPolicy Bypass,
REM  que aplica solo a este proceso y no cambia la configuracion de la maquina.
REM
REM  Uso:  doble clic                 -> asistente con ventanas
REM        HoneyComb-Setup.cmd /texto -> el mismo instalador, en la consola
REM ============================================================================

setlocal

REM %~dp0 es la carpeta de este archivo (con barra final): el instalador
REM funciona igual desde cualquier directorio o haciendo doble clic.
set "HC_ROOT=%~dp0"
set "HC_WIZARD=%HC_ROOT%tools\setup\wizard.ps1"

if not exist "%HC_WIZARD%" (
  echo.
  echo  [honeycomb] No se encontro tools\setup\wizard.ps1
  echo  [honeycomb] Copia el repositorio completo antes de instalar.
  echo.
  pause
  exit /b 1
)

REM VS Code exporta esto en su terminal integrada y hace que Electron arranque
REM como Node puro ("Cannot read properties of undefined (reading 'whenReady')").
set "ELECTRON_RUN_AS_NODE="

set "HC_MODE=gui"
if /i "%~1"=="/texto" set "HC_MODE=consola"
if /i "%~1"=="/text"  set "HC_MODE=consola"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%HC_WIZARD%" -Mode %HC_MODE%
if errorlevel 1 goto :error

endlocal
exit /b 0

:error
echo.
echo  [honeycomb] La instalacion no termino. Revisa el mensaje de arriba.
echo.
pause
endlocal
exit /b 1
