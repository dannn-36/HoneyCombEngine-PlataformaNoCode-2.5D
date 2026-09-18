@echo off
REM ============================================================================
REM  HoneyComb Engine - Editor (lanzador)
REM ============================================================================
REM
REM  Abre el editor ya instalado, usando el build de editor\dist: no levanta el
REM  dev server de Angular, asi que arranca rapido y no necesita una terminal
REM  abierta. Es el destino del acceso directo que crea HoneyComb-Setup.cmd.
REM
REM  Para desarrollar (con recarga en vivo) el que sirve es editor.cmd.
REM ============================================================================

setlocal

cd /d "%~dp0editor"

REM VS Code exporta esto en su terminal integrada y hace que Electron arranque
REM como Node puro ("Cannot read properties of undefined (reading 'whenReady')").
set "ELECTRON_RUN_AS_NODE="

if not exist "dist\editor\browser\index.html" (
  echo [honeycomb] El editor no esta compilado todavia.
  echo [honeycomb] Corre HoneyComb-Setup.cmd una vez para instalarlo.
  echo.
  pause
  exit /b 1
)

call npm.cmd run electron || goto :error

endlocal
exit /b 0

:error
echo.
echo [honeycomb] El editor no arranco. Corre HoneyComb-Setup.cmd para repararlo.
echo.
pause
endlocal
exit /b 1
