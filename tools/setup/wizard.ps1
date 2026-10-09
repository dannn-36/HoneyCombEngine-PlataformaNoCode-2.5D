# =============================================================================
#  HoneyComb Engine - Asistente de instalacion (Windows)
# =============================================================================
#
#  Este archivo no se ejecuta a mano: lo lanza HoneyComb-Setup.cmd, que es el
#  que evita el bloqueo de ExecutionPolicy al hacer doble clic.
#
#  Que hace, en orden:
#    1. Revisa los requisitos (Node, CMake, Ninja, compilador C++17, Git, vcpkg).
#    2. Instala lo que falte, pidiendo confirmacion antes de cada instalacion.
#    3. Instala las dependencias del editor y compila la interfaz (Angular).
#    4. Configura y compila el motor C++ en engine\build.
#    5. Verifica que todo quedo en su lugar y abre el editor.
#
#  La ventana esta hecha con Windows Forms, que viene con Windows: el asistente
#  tiene que poder correr ANTES de que exista Node, asi que no puede depender de
#  Electron ni de npm. Por la misma razon el texto va sin acentos: Windows
#  PowerShell 5.1 lee los .ps1 sin BOM como ANSI y los acentos saldrian rotos.
#
#  Se compila en engine\build (y no en build-mingw, que es lo que dice el preset
#  "default") porque esa es la carpeta donde el editor busca el motor al darle a
#  Ejecutar (ver editor/ipc/run.js).
# =============================================================================

[CmdletBinding()]
param(
    [ValidateSet('gui', 'consola')]
    [string]$Mode = 'gui'
)

$ErrorActionPreference = 'Stop'

# -----------------------------------------------------------------------------
# Rutas y constantes
# -----------------------------------------------------------------------------

$RepoRoot  = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EditorDir = Join-Path $RepoRoot 'editor'
$EngineDir = Join-Path $RepoRoot 'engine'
$BuildDir  = Join-Path $EngineDir 'build'

# MinGW-w64 via MSYS2: es la "Opcion A recomendada" del README y el toolchain
# con el que el motor esta probado. El asistente se queda en ese camino a
# proposito, en vez de intentar adivinar entre MinGW y MSVC.
$MsysRoot = 'C:\msys64'
$MsysBin  = Join-Path $MsysRoot 'ucrt64\bin'
$Triplet  = 'x64-mingw-dynamic'

$AngularIndex = Join-Path $EditorDir 'dist\editor\browser\index.html'
$EngineExe    = Join-Path $BuildDir 'engine.exe'

# La misma paleta que la pantalla de diagnostico de editor/main.js.
$Palette = @{
    Bg     = '#14171d'
    Panel  = '#1e222a'
    Text   = '#c7cdd8'
    Dim    = '#79818f'
    Accent = '#f5a623'
    Ok     = '#5ac27a'
    Error  = '#e05a5a'
}

$script:Cancelled = $false
$script:VcpkgRoot = $null

# -----------------------------------------------------------------------------
# Utilidades de entorno
# -----------------------------------------------------------------------------

# Tras instalar algo (Node, CMake), el PATH nuevo esta en el registro pero no en
# este proceso. Sin releerlo, el paso siguiente seguiria sin encontrar el
# programa recien instalado y habria que cerrar y reabrir el asistente.
function Update-EnvPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts   = @()
    foreach ($chunk in @($machine, $user)) {
        if ($chunk) { $parts += ($chunk -split ';' | Where-Object { $_ -ne '' }) }
    }
    if (Test-Path $MsysBin) { $parts += $MsysBin }
    $env:Path = ($parts | Select-Object -Unique) -join ';'
}

function Test-Tool([string]$name) {
    return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

# Primera linea de "programa --version", o $null si el programa falla.
function Get-VersionLine([string]$exe, [string[]]$arguments) {
    try {
        $out = & $exe @arguments 2>$null
        if ($LASTEXITCODE -ne 0 -and -not $out) { return $null }
        return (@($out) | Where-Object { $_ } | Select-Object -First 1)
    } catch {
        return $null
    }
}

function Add-UserPath([string]$directory) {
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($null -eq $current) { $current = '' }
    $parts = @($current -split ';' | Where-Object { $_ -ne '' })
    if ($parts -notcontains $directory) {
        [Environment]::SetEnvironmentVariable('Path', (($parts + $directory) -join ';'), 'User')
    }
    Update-EnvPath
}

# vcpkg no se instala con winget: se clona. Se acepta el que ya este configurado
# en VCPKG_ROOT o clonado en las dos rutas habituales.
function Find-VcpkgRoot {
    $candidates = @()
    if ($env:VCPKG_ROOT) { $candidates += $env:VCPKG_ROOT }
    $candidates += [Environment]::GetEnvironmentVariable('VCPKG_ROOT', 'User')
    $candidates += (Join-Path $env:USERPROFILE 'vcpkg')
    $candidates += 'C:\vcpkg'
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path (Join-Path $candidate 'scripts\buildsystems\vcpkg.cmake'))) {
            return (Resolve-Path $candidate).Path
        }
    }
    return $null
}

# -----------------------------------------------------------------------------
# Salida: la misma API para la ventana y para la consola
# -----------------------------------------------------------------------------

function Write-Log([string]$message) {
    if ($Mode -eq 'gui' -and $script:LogBox) {
        $script:LogBox.AppendText($message + [Environment]::NewLine)
        [System.Windows.Forms.Application]::DoEvents()
    } else {
        Write-Host $message
    }
}

function Set-StepText([string]$message) {
    if ($Mode -eq 'gui' -and $script:StepLabel) {
        $script:StepLabel.Text = $message
        [System.Windows.Forms.Application]::DoEvents()
    } else {
        Write-Host ''
        Write-Host "[honeycomb] $message" -ForegroundColor Yellow
    }
    if ($Mode -eq 'gui') { Write-Log "== $message" }
}

function Set-Progress([int]$percent) {
    if ($percent -lt 0) { $percent = 0 }
    if ($percent -gt 100) { $percent = 100 }
    if ($Mode -eq 'gui' -and $script:ProgressBar) {
        $script:ProgressBar.Value = $percent
        [System.Windows.Forms.Application]::DoEvents()
    }
}

function Confirm-Action([string]$title, [string]$message) {
    if ($Mode -eq 'gui') {
        $answer = [System.Windows.Forms.MessageBox]::Show(
            $message, $title,
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question)
        return ($answer -eq [System.Windows.Forms.DialogResult]::Yes)
    }
    Write-Host ''
    Write-Host "  $title" -ForegroundColor Yellow
    Write-Host "  $message"
    $reply = Read-Host '  Continuar? [S/n]'
    return ($reply -eq '' -or $reply -match '^[sSyY]')
}

# -----------------------------------------------------------------------------
# Ejecutar comandos mostrando la salida en vivo
# -----------------------------------------------------------------------------

# Se lanza a traves de cmd.exe y con la salida redirigida a un archivo, que se
# va leyendo mientras el proceso corre. Da lo mismo que sea un .exe o un .cmd
# (npm, por ejemplo, es npm.cmd), y permite refrescar la ventana entre lineas:
# leer el stream de forma sincronica congelaria la interfaz.
#
# $ProgressRange, si se pasa, es @(desde, hasta): las lineas de ninja con forma
# "[12/345]" mueven la barra dentro de ese tramo.
function Invoke-Step {
    param(
        [string]$CommandLine,
        [string]$WorkingDirectory = $RepoRoot,
        [int[]]$ProgressRange = $null
    )

    $logFile = Join-Path $env:TEMP ('honeycomb-setup-' + [guid]::NewGuid().ToString('N') + '.log')
    Write-Log "> $CommandLine"

    $process = Start-Process -FilePath $env:ComSpec `
        -ArgumentList "/c $CommandLine > `"$logFile`" 2>&1" `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden -PassThru

    # FileShare::ReadWrite es lo que permite leer el archivo mientras el proceso
    # sigue escribiendo en el; sin eso, el open falla con "en uso".
    $stream = $null
    $reader = $null
    try {
        while ($true) {
            if (-not $stream -and (Test-Path $logFile)) {
                $stream = New-Object System.IO.FileStream(
                    $logFile,
                    [System.IO.FileMode]::Open,
                    [System.IO.FileAccess]::Read,
                    [System.IO.FileShare]::ReadWrite)
                $reader = New-Object System.IO.StreamReader($stream)
            }
            if ($reader) {
                while ($null -ne ($line = $reader.ReadLine())) {
                    Write-Log $line
                    if ($ProgressRange -and $line -match '^\s*\[(\d+)\s*/\s*(\d+)\]') {
                        $done  = [double]$Matches[1]
                        $total = [double]$Matches[2]
                        if ($total -gt 0) {
                            $span = $ProgressRange[1] - $ProgressRange[0]
                            Set-Progress ([int]($ProgressRange[0] + ($done / $total) * $span))
                        }
                    }
                }
            }
            if ($process.HasExited) { break }
            if ($script:Cancelled) {
                Start-Process -FilePath 'taskkill' -ArgumentList "/PID $($process.Id) /T /F" -WindowStyle Hidden -Wait
                break
            }
            if ($Mode -eq 'gui') { [System.Windows.Forms.Application]::DoEvents() }
            Start-Sleep -Milliseconds 120
        }
    } finally {
        if ($reader) { $reader.Dispose() }
        if ($stream) { $stream.Dispose() }
        Remove-Item $logFile -ErrorAction SilentlyContinue
    }

    return $process.ExitCode
}

function Invoke-RequiredStep {
    param(
        [string]$CommandLine,
        [string]$WorkingDirectory = $RepoRoot,
        [int[]]$ProgressRange = $null
    )
    $code = Invoke-Step -CommandLine $CommandLine -WorkingDirectory $WorkingDirectory -ProgressRange $ProgressRange
    if ($code -ne 0) {
        throw "El comando termino con error (codigo $code): $CommandLine"
    }
}

# -----------------------------------------------------------------------------
# Requisitos
# -----------------------------------------------------------------------------

function New-Requirement($id, $name, $ok, $detail, $why) {
    return [pscustomobject]@{
        Id     = $id
        Name   = $name
        Ok     = $ok
        Detail = $detail
        Why    = $why
    }
}

function Get-Requirements {
    Update-EnvPath
    $script:VcpkgRoot = Find-VcpkgRoot
    $list = @()

    # --- Git ---
    $ok = $false; $detail = 'no encontrado'
    if (Test-Tool 'git') {
        $ok = $true
        $detail = Get-VersionLine 'git' @('--version')
    }
    $list += New-Requirement 'git' 'Git' $ok $detail 'Clona vcpkg y descarga raylib al compilar el motor.'

    # --- Node.js 20+ ---
    $ok = $false; $detail = 'no encontrado'
    if (Test-Tool 'node') {
        $raw = Get-VersionLine 'node' @('-v')
        if ($raw -and $raw -match 'v?(\d+)\.') {
            $major = [int]$Matches[1]
            if ($major -ge 20) {
                $ok = $true; $detail = $raw
            } else {
                $detail = "$raw (hace falta la 20 o mayor)"
            }
        }
    }
    $list += New-Requirement 'node' 'Node.js 20 o mayor' $ok $detail 'Runtime del editor (Angular + Electron).'

    # --- CMake 3.20+ ---
    $ok = $false; $detail = 'no encontrado'
    if (Test-Tool 'cmake') {
        $raw = Get-VersionLine 'cmake' @('--version')
        if ($raw -and $raw -match '(\d+)\.(\d+)\.(\d+)') {
            $found = [version]("{0}.{1}.{2}" -f $Matches[1], $Matches[2], $Matches[3])
            if ($found -ge [version]'3.20.0') {
                $ok = $true; $detail = "version $found"
            } else {
                $detail = "version $found (hace falta 3.20 o mayor)"
            }
        }
    }
    $list += New-Requirement 'cmake' 'CMake 3.20 o mayor' $ok $detail 'Sistema de construccion del motor C++.'

    # --- Compilador C++17 (MinGW-w64 / UCRT64) ---
    $ok = $false; $detail = 'no encontrado'
    if (Test-Path (Join-Path $MsysBin 'g++.exe')) {
        $ok = $true; $detail = 'MinGW-w64 UCRT64 en C:\msys64'
    } elseif (Test-Tool 'g++') {
        $ok = $true; $detail = Get-VersionLine 'g++' @('--version')
    } elseif (Test-Path $MsysRoot) {
        $detail = 'MSYS2 esta instalado, falta el toolchain (pacman)'
    }
    $list += New-Requirement 'toolchain' 'Compilador C++17 (MinGW-w64)' $ok $detail 'Compila el motor; es la opcion A del README.'

    # --- Ninja ---
    $ok = $false; $detail = 'no encontrado'
    if (Test-Path (Join-Path $MsysBin 'ninja.exe')) {
        $ok = $true; $detail = 'en C:\msys64\ucrt64\bin'
    } elseif (Test-Tool 'ninja') {
        $ok = $true; $detail = 'version ' + (Get-VersionLine 'ninja' @('--version'))
    }
    $list += New-Requirement 'ninja' 'Ninja' $ok $detail 'Generador de compilacion que usa el motor.'

    # --- vcpkg ---
    $ok = $false; $detail = 'no encontrado'
    if ($script:VcpkgRoot) {
        $ok = $true; $detail = $script:VcpkgRoot
    }
    $list += New-Requirement 'vcpkg' 'vcpkg' $ok $detail 'Trae SDL2 y nlohmann-json para el motor.'

    return $list
}

function Install-ViaWinget([string]$packageId) {
    if (-not (Test-Tool 'winget')) {
        throw "No hay winget en esta maquina, asi que no puedo instalar $packageId automaticamente. Instala el paquete a mano siguiendo la seccion 1 del README."
    }
    $arguments = "winget install --id $packageId --exact --source winget " +
                 '--accept-source-agreements --accept-package-agreements --disable-interactivity'
    $code = Invoke-Step -CommandLine $arguments
    # winget devuelve este codigo cuando el paquete ya estaba instalado: no es
    # un fallo, y tratarlo como tal abortaria una instalacion que esta bien.
    if ($code -ne 0 -and $code -ne -1978335189) {
        throw "winget no pudo instalar $packageId (codigo $code)."
    }
    Update-EnvPath
}

function Install-MsysToolchain {
    if (-not (Test-Path (Join-Path $MsysRoot 'usr\bin\bash.exe'))) {
        Set-StepText 'Instalando MSYS2 (compilador C++)'
        Install-ViaWinget 'MSYS2.MSYS2'
    }
    $bash = Join-Path $MsysRoot 'usr\bin\bash.exe'
    if (-not (Test-Path $bash)) {
        throw "MSYS2 quedo instalado en otra ruta. Instala el toolchain a mano segun la seccion 2 del README."
    }

    Set-StepText 'Instalando el toolchain MinGW-w64 (pacman)'
    # -Sy primero: en una instalacion nueva de MSYS2 la base de datos de
    # paquetes esta vacia y el install fallaria con "target not found".
    $packages = 'base-devel mingw-w64-ucrt-x86_64-toolchain ' +
                'mingw-w64-ucrt-x86_64-cmake mingw-w64-ucrt-x86_64-ninja'
    Invoke-RequiredStep "`"$bash`" -lc `"pacman -Sy --noconfirm`""
    Invoke-RequiredStep "`"$bash`" -lc `"pacman -S --needed --noconfirm $packages`""

    Add-UserPath $MsysBin
}

function Install-Vcpkg {
    $target = Join-Path $env:USERPROFILE 'vcpkg'

    if (-not (Test-Path (Join-Path $target 'bootstrap-vcpkg.bat'))) {
        Set-StepText 'Clonando vcpkg'
        Invoke-RequiredStep "git clone --depth 1 https://github.com/microsoft/vcpkg.git `"$target`""
    }

    Set-StepText 'Preparando vcpkg (bootstrap)'
    Invoke-RequiredStep "`"$target\bootstrap-vcpkg.bat`" -disableMetrics"

    # Persistente, porque CMakePresets.json lo lee de VCPKG_ROOT; y en este
    # proceso, para que el paso de configuracion de mas abajo ya lo tenga.
    [Environment]::SetEnvironmentVariable('VCPKG_ROOT', $target, 'User')
    $env:VCPKG_ROOT = $target
    $script:VcpkgRoot = $target
}

function Install-Requirement($requirement) {
    switch ($requirement.Id) {
        'git'       { Set-StepText 'Instalando Git';      Install-ViaWinget 'Git.Git' }
        'node'      { Set-StepText 'Instalando Node.js';  Install-ViaWinget 'OpenJS.NodeJS.LTS' }
        'cmake'     { Set-StepText 'Instalando CMake';    Install-ViaWinget 'Kitware.CMake' }
        'toolchain' { Install-MsysToolchain }
        'ninja'     { Install-MsysToolchain }
        'vcpkg'     { Install-Vcpkg }
        default     { throw "Requisito desconocido: $($requirement.Id)" }
    }
}

# -----------------------------------------------------------------------------
# Instalacion del proyecto
# -----------------------------------------------------------------------------

function Install-Project {
    $script:VcpkgRoot = Find-VcpkgRoot
    if (-not $script:VcpkgRoot) {
        throw 'No encuentro vcpkg. Vuelve al paso de requisitos e instala vcpkg.'
    }
    $env:VCPKG_ROOT = $script:VcpkgRoot

    # CMake quiere las rutas con barras normales incluso en Windows.
    $toolchain = (Join-Path $script:VcpkgRoot 'scripts\buildsystems\vcpkg.cmake') -replace '\\', '/'

    $configure = "cmake -S `"$EngineDir`" -B `"$BuildDir`" -G Ninja " +
                 "-DCMAKE_BUILD_TYPE=Debug " +
                 "-DCMAKE_TOOLCHAIN_FILE=`"$toolchain`" " +
                 "-DVCPKG_TARGET_TRIPLET=$Triplet -DVCPKG_HOST_TRIPLET=$Triplet"

    # Fijar el compilador evita que CMake elija MSVC si la maquina tiene las dos
    # cosas: el triplet de vcpkg es de MinGW y el enlazado fallaria por ABI.
    if (Test-Path (Join-Path $MsysBin 'c++.exe')) {
        $compiler = (Join-Path $MsysBin 'c++.exe') -replace '\\', '/'
        $configure += " -DCMAKE_CXX_COMPILER=`"$compiler`""
    }

    Set-Progress 2

    Set-StepText 'Instalando las dependencias del editor (npm install)'
    Invoke-RequiredStep 'npm.cmd install' $EditorDir
    Set-Progress 25

    Set-StepText 'Compilando la interfaz del editor (Angular)'
    Invoke-RequiredStep 'npm.cmd run build' $EditorDir
    Set-Progress 40

    Set-StepText 'Configurando el motor (CMake + vcpkg)'
    Invoke-RequiredStep $configure
    Set-Progress 50

    Set-StepText 'Compilando el motor C++ (la primera vez tarda varios minutos)'
    Invoke-RequiredStep "cmake --build `"$BuildDir`"" $RepoRoot @(50, 97)

    Set-StepText 'Verificando la instalacion'
    $problems = @()
    if (-not (Test-Path $EngineExe))    { $problems += 'no se genero engine\build\engine.exe' }
    if (-not (Test-Path $AngularIndex)) { $problems += 'no se genero editor\dist' }
    if (-not (Test-Path (Join-Path $BuildDir 'levels'))) { $problems += 'faltan los niveles junto al motor' }
    if (-not (Test-Path (Join-Path $BuildDir 'assets'))) { $problems += 'faltan los assets junto al motor' }
    if ($problems.Count -gt 0) {
        throw ('La verificacion fallo: ' + ($problems -join '; '))
    }

    Write-Log ''
    Write-Log "Motor:  $EngineExe"
    Write-Log "Editor: $AngularIndex"
    Set-Progress 100
    Set-StepText 'Instalacion terminada'
}

function New-DesktopShortcut {
    try {
        $desktop  = [Environment]::GetFolderPath('Desktop')
        $shell    = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut((Join-Path $desktop 'HoneyComb Engine.lnk'))
        $shortcut.TargetPath       = Join-Path $RepoRoot 'HoneyComb.cmd'
        $shortcut.WorkingDirectory = $RepoRoot
        $shortcut.Description      = 'HoneyComb Engine - Editor de niveles'
        $icon = Join-Path $EditorDir 'public\favicon.ico'
        if (Test-Path $icon) { $shortcut.IconLocation = $icon }
        $shortcut.Save()
        Write-Log "Acceso directo creado en $desktop"
        return $true
    } catch {
        Write-Log "No se pudo crear el acceso directo: $($_.Exception.Message)"
        return $false
    }
}

function Start-Editor {
    # start "" para no dejar el asistente colgado esperando a que el editor
    # cierre; el editor es una aplicacion aparte y vive por su cuenta.
    Start-Process -FilePath $env:ComSpec `
        -ArgumentList "/c start `"`" `"$(Join-Path $RepoRoot 'HoneyComb.cmd')`"" `
        -WorkingDirectory $RepoRoot -WindowStyle Hidden
}

# =============================================================================
#  Modo consola
# =============================================================================

function Start-ConsoleWizard {
    Write-Host ''
    Write-Host '  HoneyComb Engine - Instalacion' -ForegroundColor Yellow
    Write-Host '  ------------------------------'
    Write-Host "  Carpeta del proyecto: $RepoRoot"

    Set-StepText 'Revisando los requisitos'
    $requirements = Get-Requirements
    foreach ($requirement in $requirements) {
        if ($requirement.Ok) {
            Write-Host ("    [ok]    {0} - {1}" -f $requirement.Name, $requirement.Detail) -ForegroundColor Green
        } else {
            Write-Host ("    [falta] {0} - {1}" -f $requirement.Name, $requirement.Detail) -ForegroundColor Red
        }
    }

    $missing = @($requirements | Where-Object { -not $_.Ok })
    foreach ($requirement in $missing) {
        $ask = Confirm-Action "Instalar $($requirement.Name)" $requirement.Why
        if (-not $ask) {
            Write-Host '  Instalacion cancelada: falta un requisito.' -ForegroundColor Red
            return 1
        }
        Install-Requirement $requirement
    }

    if ($missing.Count -gt 0) {
        $stillMissing = @(Get-Requirements | Where-Object { -not $_.Ok })
        if ($stillMissing.Count -gt 0) {
            Write-Host ''
            Write-Host '  Siguen faltando requisitos:' -ForegroundColor Red
            foreach ($requirement in $stillMissing) {
                Write-Host ("    - {0}: {1}" -f $requirement.Name, $requirement.Detail)
            }
            Write-Host '  Cierra y vuelve a abrir el instalador; si ya lo hiciste, sigue la seccion 1 del README.'
            return 1
        }
    }

    Install-Project

    if (Confirm-Action 'Acceso directo' 'Crear un acceso directo del editor en el Escritorio?') {
        [void](New-DesktopShortcut)
    }

    Write-Host ''
    Write-Host '  Listo. El editor esta instalado.' -ForegroundColor Green
    if (Confirm-Action 'Abrir el editor' 'Abrir el editor ahora?') {
        Start-Editor
    }
    return 0
}

# =============================================================================
#  Modo ventana (Windows Forms)
# =============================================================================

function Start-GuiWizard {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $color = @{}
    foreach ($key in $Palette.Keys) {
        $color[$key] = [System.Drawing.ColorTranslator]::FromHtml($Palette[$key])
    }
    $fontBase  = New-Object System.Drawing.Font('Segoe UI', 9)
    $fontTitle = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
    $fontStrong = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
    $fontMono = New-Object System.Drawing.Font('Consolas', 8.5)

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'HoneyComb Engine - Instalacion'
    $form.Size = New-Object System.Drawing.Size(660, 520)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.BackColor = $color.Bg
    $form.ForeColor = $color.Text
    $form.Font = $fontBase
    $icon = Join-Path $EditorDir 'public\favicon.ico'
    if (Test-Path $icon) {
        try { $form.Icon = New-Object System.Drawing.Icon($icon) } catch { }
    }

    # --- Encabezado ---
    $header = New-Object System.Windows.Forms.Panel
    $header.Dock = 'Top'
    $header.Height = 70
    $header.BackColor = $color.Panel
    $form.Controls.Add($header)

    $headerTitle = New-Object System.Windows.Forms.Label
    $headerTitle.Text = 'HoneyComb Engine'
    $headerTitle.Font = $fontTitle
    $headerTitle.ForeColor = $color.Accent
    $headerTitle.Location = New-Object System.Drawing.Point(24, 14)
    $headerTitle.AutoSize = $true
    $header.Controls.Add($headerTitle)

    $headerSub = New-Object System.Windows.Forms.Label
    $headerSub.Text = 'Plataforma NoCode 2.5D isometrica - asistente de instalacion'
    $headerSub.ForeColor = $color.Dim
    $headerSub.Location = New-Object System.Drawing.Point(26, 42)
    $headerSub.AutoSize = $true
    $header.Controls.Add($headerSub)

    # --- Pie con los botones ---
    $footer = New-Object System.Windows.Forms.Panel
    $footer.Dock = 'Bottom'
    $footer.Height = 58
    $footer.BackColor = $color.Panel
    $form.Controls.Add($footer)

    function New-Button($text, $x, $primary) {
        $button = New-Object System.Windows.Forms.Button
        $button.Text = $text
        $button.Size = New-Object System.Drawing.Size(130, 32)
        $button.Location = New-Object System.Drawing.Point($x, 13)
        $button.FlatStyle = 'Flat'
        $button.FlatAppearance.BorderSize = 1
        if ($primary) {
            $button.BackColor = $color.Accent
            $button.ForeColor = $color.Bg
            $button.Font = $fontStrong
        } else {
            $button.BackColor = $color.Panel
            $button.ForeColor = $color.Text
        }
        return $button
    }

    $buttonCancel = New-Button 'Cancelar' 24 $false
    $buttonBack   = New-Button 'Atras' 350 $false
    $buttonNext   = New-Button 'Siguiente' 490 $true
    $footer.Controls.AddRange(@($buttonCancel, $buttonBack, $buttonNext))

    # Enter avanza, como en cualquier instalador. Tambien evita que Enter cierre
    # la ventana por accidente eligiendo otro boton.
    $form.AcceptButton = $buttonNext

    # --- Zona de contenido (una pagina visible a la vez) ---
    $content = New-Object System.Windows.Forms.Panel
    $content.Dock = 'Fill'
    $content.BackColor = $color.Bg
    $content.Padding = New-Object System.Windows.Forms.Padding(24, 18, 24, 12)
    $form.Controls.Add($content)

    # Windows Forms acomoda los controles anclados en orden inverso al z-order,
    # asi que el panel Fill tiene que quedar al frente para recibir el espacio
    # que sobra. Sin esto se dibuja desde arriba de todo y el encabezado le tapa
    # el titulo de cada pagina.
    $content.BringToFront()

    function New-Page {
        $page = New-Object System.Windows.Forms.Panel
        $page.Dock = 'Fill'
        $page.BackColor = $color.Bg
        $page.Visible = $false
        $content.Controls.Add($page)
        return $page
    }

    function New-Heading($parent, $text, $y) {
        $label = New-Object System.Windows.Forms.Label
        $label.Text = $text
        $label.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
        $label.ForeColor = $color.Text
        $label.Location = New-Object System.Drawing.Point(24, $y)
        $label.AutoSize = $true
        $parent.Controls.Add($label)
        return $label
    }

    # $height va explicito: una Label no crece sola, y con un alto fijo de menos
    # los parrafos largos se cortan a la mitad sin ningun aviso.
    function New-Text($parent, $text, $y, $width, $height = 100) {
        $label = New-Object System.Windows.Forms.Label
        $label.Text = $text
        $label.ForeColor = $color.Dim
        $label.Location = New-Object System.Drawing.Point(24, $y)
        $label.Size = New-Object System.Drawing.Size($width, $height)
        $parent.Controls.Add($label)
        return $label
    }

    # ---------------- Pagina 0: bienvenida ----------------
    $pageWelcome = New-Page
    New-Heading $pageWelcome 'Bienvenido' 6 | Out-Null
    $welcomeText = @'
Este asistente deja el proyecto listo para usar. Va a:

    1.  Revisar los requisitos del sistema.
    2.  Instalar lo que falte (pidiendote confirmacion antes de cada cosa).
    3.  Instalar las dependencias del editor y compilar su interfaz.
    4.  Configurar y compilar el motor C++ en engine\build.
    5.  Verificar el resultado y abrir el editor.

La primera vez tarda entre 10 y 25 minutos, sobre todo por la compilacion de
raylib y del motor. Necesitas conexion a internet.
'@
    New-Text $pageWelcome $welcomeText 44 580 215 | Out-Null
    $welcomePath = New-Object System.Windows.Forms.Label
    $welcomePath.Text = "Carpeta del proyecto:  $RepoRoot"
    $welcomePath.ForeColor = $color.Accent
    $welcomePath.Font = $fontMono
    $welcomePath.Location = New-Object System.Drawing.Point(24, 262)
    $welcomePath.Size = New-Object System.Drawing.Size(580, 40)
    $pageWelcome.Controls.Add($welcomePath)

    # ---------------- Pagina 1: requisitos ----------------
    $pageChecks = New-Page
    New-Heading $pageChecks 'Requisitos del sistema' 6 | Out-Null
    $checksHint = New-Text $pageChecks 'Revisando...' 34 580
    $checksHint.Size = New-Object System.Drawing.Size(580, 20)

    $checksList = New-Object System.Windows.Forms.Panel
    $checksList.Location = New-Object System.Drawing.Point(24, 62)
    $checksList.Size = New-Object System.Drawing.Size(584, 250)
    $checksList.BackColor = $color.Panel
    $pageChecks.Controls.Add($checksList)

    $buttonRecheck = New-Object System.Windows.Forms.Button
    $buttonRecheck.Text = 'Volver a revisar'
    $buttonRecheck.Size = New-Object System.Drawing.Size(140, 28)
    $buttonRecheck.Location = New-Object System.Drawing.Point(24, 320)
    $buttonRecheck.FlatStyle = 'Flat'
    $buttonRecheck.BackColor = $color.Panel
    $buttonRecheck.ForeColor = $color.Text
    $pageChecks.Controls.Add($buttonRecheck)

    # ---------------- Pagina 2: instalacion ----------------
    $pageInstall = New-Page
    New-Heading $pageInstall 'Instalando' 6 | Out-Null

    $stepLabel = New-Object System.Windows.Forms.Label
    $stepLabel.Text = 'Preparando...'
    $stepLabel.ForeColor = $color.Accent
    $stepLabel.Location = New-Object System.Drawing.Point(24, 36)
    $stepLabel.Size = New-Object System.Drawing.Size(584, 20)
    $pageInstall.Controls.Add($stepLabel)
    $script:StepLabel = $stepLabel

    $progressBar = New-Object System.Windows.Forms.ProgressBar
    $progressBar.Location = New-Object System.Drawing.Point(24, 62)
    $progressBar.Size = New-Object System.Drawing.Size(584, 14)
    $progressBar.Style = 'Continuous'
    $pageInstall.Controls.Add($progressBar)
    $script:ProgressBar = $progressBar

    $logBox = New-Object System.Windows.Forms.TextBox
    $logBox.Multiline = $true
    $logBox.ReadOnly = $true
    $logBox.ScrollBars = 'Vertical'
    $logBox.WordWrap = $false
    $logBox.BackColor = $color.Panel
    $logBox.ForeColor = $color.Dim
    $logBox.BorderStyle = 'None'
    $logBox.Font = $fontMono
    $logBox.Location = New-Object System.Drawing.Point(24, 88)
    $logBox.Size = New-Object System.Drawing.Size(584, 232)
    $pageInstall.Controls.Add($logBox)
    $script:LogBox = $logBox

    # ---------------- Pagina 3: listo ----------------
    $pageDone = New-Page
    $doneTitle = New-Heading $pageDone 'Todo listo' 6
    $doneTitle.ForeColor = $color.Ok
    $doneText = New-Text $pageDone '' 40 580
    $doneText.Size = New-Object System.Drawing.Size(584, 150)

    $checkShortcut = New-Object System.Windows.Forms.CheckBox
    $checkShortcut.Text = 'Crear un acceso directo del editor en el Escritorio'
    $checkShortcut.Checked = $true
    $checkShortcut.ForeColor = $color.Text
    $checkShortcut.Location = New-Object System.Drawing.Point(24, 200)
    $checkShortcut.Size = New-Object System.Drawing.Size(500, 24)
    $pageDone.Controls.Add($checkShortcut)

    $checkLaunch = New-Object System.Windows.Forms.CheckBox
    $checkLaunch.Text = 'Abrir el editor al cerrar este asistente'
    $checkLaunch.Checked = $true
    $checkLaunch.ForeColor = $color.Text
    $checkLaunch.Location = New-Object System.Drawing.Point(24, 228)
    $checkLaunch.Size = New-Object System.Drawing.Size(500, 24)
    $pageDone.Controls.Add($checkLaunch)

    $doneHint = New-Object System.Windows.Forms.Label
    $doneHint.Text = 'Mas adelante: HoneyComb.cmd abre el editor, y editor.cmd lo abre en modo desarrollo con recarga en vivo.'
    $doneHint.ForeColor = $color.Dim
    $doneHint.Font = $fontMono
    $doneHint.Location = New-Object System.Drawing.Point(24, 266)
    $doneHint.Size = New-Object System.Drawing.Size(584, 60)
    $pageDone.Controls.Add($doneHint)

    # ---------------- Navegacion ----------------
    $pages = @($pageWelcome, $pageChecks, $pageInstall, $pageDone)
    $script:PageIndex = 0
    $script:Requirements = @()

    function Show-Requirements {
        $checksList.Controls.Clear()
        $checksHint.Text = 'Revisando...'
        [System.Windows.Forms.Application]::DoEvents()

        $script:Requirements = Get-Requirements
        $y = 12
        foreach ($requirement in $script:Requirements) {
            $status = New-Object System.Windows.Forms.Label
            if ($requirement.Ok) {
                $status.Text = 'OK'
                $status.ForeColor = $color.Ok
            } else {
                $status.Text = 'FALTA'
                $status.ForeColor = $color.Error
            }
            $status.Font = $fontStrong
            $status.Location = New-Object System.Drawing.Point(14, $y)
            $status.Size = New-Object System.Drawing.Size(58, 18)
            $checksList.Controls.Add($status)

            $name = New-Object System.Windows.Forms.Label
            $name.Text = $requirement.Name
            $name.Font = $fontStrong
            $name.ForeColor = $color.Text
            $name.Location = New-Object System.Drawing.Point(78, $y)
            $name.Size = New-Object System.Drawing.Size(210, 18)
            $checksList.Controls.Add($name)

            $detail = New-Object System.Windows.Forms.Label
            $detail.Text = $requirement.Detail
            $detail.ForeColor = $color.Dim
            $detail.Font = $fontMono
            # El +1 va aparte a proposito: dentro de los parentesis de
            # New-Object la coma agrupa antes que la suma, asi que
            # "Point(292, $y + 1)" termina siendo un arreglo de tres numeros y
            # revienta con "no se encuentra ninguna sobrecarga para Point".
            $detailY = $y + 1
            $detail.Location = New-Object System.Drawing.Point(292, $detailY)
            $detail.Size = New-Object System.Drawing.Size(280, 18)
            $checksList.Controls.Add($detail)

            $y += 26
        }

        $missing = @($script:Requirements | Where-Object { -not $_.Ok })
        if ($missing.Count -eq 0) {
            $checksHint.Text = 'Todo en orden. Continua para instalar el proyecto.'
            $checksHint.ForeColor = $color.Ok
            $buttonNext.Text = 'Instalar'
        } else {
            $checksHint.Text = "Faltan $($missing.Count) requisito(s). El asistente puede instalarlos."
            $checksHint.ForeColor = $color.Accent
            $buttonNext.Text = 'Instalar requisitos'
        }
    }

    function Show-Page([int]$index) {
        $script:PageIndex = $index
        for ($i = 0; $i -lt $pages.Count; $i++) {
            $pages[$i].Visible = ($i -eq $index)
        }
        $buttonBack.Enabled = ($index -eq 1)
        switch ($index) {
            0 { $buttonNext.Text = 'Comenzar'; $buttonNext.Enabled = $true; $buttonCancel.Text = 'Cancelar' }
            1 { $buttonNext.Enabled = $true;   $buttonCancel.Text = 'Cancelar' }
            2 { $buttonNext.Enabled = $false; $buttonNext.Text = 'Instalando...'; $buttonCancel.Text = 'Cancelar' }
            3 { $buttonNext.Enabled = $true;  $buttonNext.Text = 'Finalizar'; $buttonCancel.Enabled = $false }
        }
    }

    function Invoke-InstallPhase {
        Show-Page 2
        try {
            Install-Project
            $doneText.Text = @"
El editor y el motor quedaron compilados y verificados.

    Editor:  editor\dist        (interfaz Angular compilada)
    Motor:   engine\build\engine.exe

Desde el editor, el boton Ejecutar abre el nivel en el motor.
"@
            Show-Page 3
        } catch {
            Write-Log ''
            Write-Log "ERROR: $($_.Exception.Message)"
            $stepLabel.Text = 'La instalacion se detuvo por un error'
            $stepLabel.ForeColor = $color.Error
            $buttonNext.Text = 'Reintentar'
            $buttonNext.Enabled = $true
            [void][System.Windows.Forms.MessageBox]::Show(
                "$($_.Exception.Message)`n`nRevisa el detalle en el registro de la ventana.",
                'HoneyComb Engine', 'OK', 'Error')
        }
    }

    $buttonRecheck.Add_Click({ Show-Requirements })

    $buttonNext.Add_Click({
        switch ($script:PageIndex) {
            0 {
                Show-Page 1
                Show-Requirements
            }
            1 {
                $missing = @($script:Requirements | Where-Object { -not $_.Ok })
                if ($missing.Count -eq 0) {
                    Invoke-InstallPhase
                    return
                }
                # Instalar los que faltan, uno por uno y con confirmacion.
                Show-Page 2
                $stepLabel.ForeColor = $color.Accent
                try {
                    foreach ($requirement in $missing) {
                        $ask = Confirm-Action "Instalar $($requirement.Name)" @"
$($requirement.Why)

Detectado: $($requirement.Detail)

Instalarlo ahora? Puede pedir permisos de administrador.
"@
                        if (-not $ask) {
                            throw "Falta $($requirement.Name) y no se instalo. El proyecto no puede compilarse sin eso."
                        }
                        Install-Requirement $requirement
                    }
                    Set-StepText 'Requisitos listos'
                    Show-Page 1
                    Show-Requirements
                } catch {
                    Write-Log ''
                    Write-Log "ERROR: $($_.Exception.Message)"
                    $stepLabel.Text = 'No se pudieron instalar los requisitos'
                    $stepLabel.ForeColor = $color.Error
                    $buttonNext.Text = 'Volver a los requisitos'
                    $buttonNext.Enabled = $true
                    $script:PageIndex = 1
                    [void][System.Windows.Forms.MessageBox]::Show(
                        $_.Exception.Message, 'HoneyComb Engine', 'OK', 'Error')
                }
            }
            2 {
                # Solo se llega aca tras un error: el boton quedo como reintentar.
                Invoke-InstallPhase
            }
            3 {
                if ($checkShortcut.Checked) { [void](New-DesktopShortcut) }
                if ($checkLaunch.Checked)   { Start-Editor }
                $form.Close()
            }
        }
    })

    $buttonBack.Add_Click({
        if ($script:PageIndex -eq 1) { Show-Page 0 }
    })

    $buttonCancel.Add_Click({
        $ask = [System.Windows.Forms.MessageBox]::Show(
            'Cerrar el instalador? Lo que ya se instalo se queda como esta.',
            'HoneyComb Engine',
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question)
        if ($ask -eq [System.Windows.Forms.DialogResult]::Yes) {
            $script:Cancelled = $true
            $form.Close()
        }
    })

    Show-Page 0
    [void]$form.ShowDialog()
    return 0
}

# =============================================================================
#  Arranque
# =============================================================================

try {
    if ($Mode -eq 'consola') {
        exit (Start-ConsoleWizard)
    }
    exit (Start-GuiWizard)
} catch {
    $message = $_.Exception.Message
    if ($Mode -eq 'gui') {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            [void][System.Windows.Forms.MessageBox]::Show(
                $message, 'HoneyComb Engine - error', 'OK', 'Error')
        } catch {
            Write-Host "[honeycomb] $message"
        }
    } else {
        Write-Host ''
        Write-Host "[honeycomb] $message" -ForegroundColor Red
    }
    exit 1
}
