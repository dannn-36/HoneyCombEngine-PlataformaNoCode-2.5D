@echo off
REM ============================================================================
REM  HoneyComb Engine - Crear el instalador (Windows)
REM ============================================================================
REM
REM  Arma editor\release\HoneyComb-Engine-Setup-<version>.exe: un instalador con
REM  el editor y el motor ya compilados, para quien solo quiere USAR HoneyComb.
REM  Esa persona no necesita Node, CMake ni compilador.
REM
REM  Quien lo arma si: este archivo usa lo que deja HoneyComb-Setup.cmd. Recompila
REM  el motor Debug y Release, compila la interfaz y empaqueta todo. El detalle
REM  esta en editor\scripts\build-installer.js.
REM ============================================================================

setlocal

cd /d "%~dp0editor"

REM VS Code exporta esto en su terminal integrada y hace que Electron arranque
REM como Node puro ("Cannot read properties of undefined (reading 'whenReady')").
set "ELECTRON_RUN_AS_NODE="

if not exist "node_modules\electron-builder" (
  echo [honeycomb] Faltan las dependencias del editor.
  echo [honeycomb] Corre HoneyComb-Setup.cmd una vez antes de crear el instalador.
  echo.
  pause
  exit /b 1
)

call npm.cmd run installer || goto :error

echo.
echo [honeycomb] Listo: el instalador esta en editor\release
start "" "%~dp0editor\release"
echo.
pause
endlocal
exit /b 0

:error
echo.
echo [honeycomb] No se pudo crear el instalador. Revisa el mensaje de arriba.
echo.
pause
endlocal
exit /b 1
