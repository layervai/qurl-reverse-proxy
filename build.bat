@echo off
setlocal enabledelayedexpansion

set OPENNHP_DIR=third_party\opennhp
set VERSION_PKG=github.com/OpenNHP/nhp-frp/pkg/version

:: Capture version info from git
for /f "delims=" %%i in ('git describe --tags --abbrev=0 2^>nul') do set "BASE_VERSION=%%i"
if "%BASE_VERSION%"=="" set BASE_VERSION=0.1.0
for /f "delims=" %%i in ('powershell -NoProfile -Command "[DateTime]::UtcNow.ToString('yyMMddHHmmss')"') do set "BUILD_TIMESTAMP=%%i"
set VERSION=%BASE_VERSION%.%BUILD_TIMESTAMP%
for /f "delims=" %%i in ('git rev-parse HEAD 2^>nul') do set "GIT_COMMIT=%%i"
if "%GIT_COMMIT%"=="" set GIT_COMMIT=unknown
for /f "delims=" %%i in ('git log -1 --format^=%%ci 2^>nul') do set "GIT_COMMIT_TIME=%%i"
if "%GIT_COMMIT_TIME%"=="" set GIT_COMMIT_TIME=unknown
for /f "delims=" %%i in ('powershell -NoProfile -Command "[DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss')"') do set "BUILD_DATE=%%i"
if "%BUILD_DATE%"=="" set BUILD_DATE=unknown
pushd %OPENNHP_DIR%
for /f "delims=" %%i in ('git describe --tags --always 2^>nul') do set "NHP_VERSION=%%i"
popd
if "%NHP_VERSION%"=="" set NHP_VERSION=unknown
for /f "delims=" %%i in ('findstr /r "github.com/fatedier/frp " go.mod') do (
    for %%a in (%%i) do set "FRP_VERSION=%%a"
)
if "%FRP_VERSION%"=="" set FRP_VERSION=unknown

set LDFLAGS=-s -w -X '%VERSION_PKG%.Version=%VERSION%' -X '%VERSION_PKG%.GitCommit=%GIT_COMMIT%' -X '%VERSION_PKG%.BuildDate=%BUILD_DATE%' -X '%VERSION_PKG%.NHPVersion=%NHP_VERSION%'

:: Auto-detect MSYS2 for CGO/SDK builds
set MSYS2_DIR=
if exist "C:\Program Files\msys2\mingw64\bin\gcc.exe" set MSYS2_DIR=C:\Program Files\msys2
if exist "C:\msys64\mingw64\bin\gcc.exe" if "%MSYS2_DIR%"=="" set MSYS2_DIR=C:\msys64

:: Parse arguments
set TARGET=%1
if "%TARGET%"=="" set TARGET=all

if "%TARGET%"=="all"    goto :all
if "%TARGET%"=="build"  goto :build
if "%TARGET%"=="frps"   goto :frps
if "%TARGET%"=="frpc"   goto :frpc
if "%TARGET%"=="build-sdk" goto :build-sdk
if "%TARGET%"=="clean"  goto :clean
if "%TARGET%"=="clean-sdk" goto :clean-sdk
if "%TARGET%"=="fmt"    goto :fmt
if "%TARGET%"=="test"   goto :test
if "%TARGET%"=="env"    goto :env
if "%TARGET%"=="help"   goto :help

echo Unknown target: %TARGET%
goto :help

:all
call :print-version
call :env
call :fmt
call :build
goto :eof

:build
call :frps
call :frpc
goto :eof

:print-version
powershell -NoProfile -Command "Write-Host '[nhp-frp] Start building...' -ForegroundColor Blue"
powershell -NoProfile -Command "Write-Host 'Version:     %VERSION% (OpenNHP: %NHP_VERSION%, FRP: %FRP_VERSION%)' -ForegroundColor Blue"
powershell -NoProfile -Command "Write-Host 'Commit id:   %GIT_COMMIT%' -ForegroundColor Blue"
powershell -NoProfile -Command "Write-Host 'Commit time: %GIT_COMMIT_TIME%' -ForegroundColor Blue"
powershell -NoProfile -Command "Write-Host 'Build time:  %BUILD_DATE%' -ForegroundColor Blue"
echo.
goto :eof

:env
go version
if errorlevel 1 (
    echo ERROR: Go is not installed or not in PATH.
    exit /b 1
)
goto :eof

:fmt
echo Formatting code...
go fmt ./...
goto :eof

:frps
call :print-version
powershell -NoProfile -Command "Write-Host '[nhp-frp] Building nhp-frps ...' -ForegroundColor Blue"
set CGO_ENABLED=0
go build -trimpath -ldflags "%LDFLAGS%" -tags frps -o bin\nhp-frps.exe .\cmd\frps
if errorlevel 1 (
    echo ERROR: Failed to build nhp-frps.
    exit /b 1
)
powershell -NoProfile -Command "Write-Host '[nhp-frp] nhp-frps built successfully!' -ForegroundColor Blue"
goto :eof

:build-sdk
powershell -NoProfile -Command "Write-Host '[nhp-frp] Building OpenNHP SDK for Windows (nhp-agent.dll)...' -ForegroundColor Blue"

:: CGO requires a working C compiler. On Windows we use MSYS2 MinGW GCC.
:: GCC must be invoked with the MSYS2 mingw64 sysroot so it can find headers.
if "%MSYS2_DIR%"=="" (
    echo ERROR: MSYS2 MinGW-w64 not found. Install MSYS2 and mingw-w64-x86_64-gcc.
    echo        Expected at: C:\Program Files\msys2  or  C:\msys64
    exit /b 1
)

:: Check submodule is initialized
if not exist "%OPENNHP_DIR%\endpoints" (
    powershell -NoProfile -Command "Write-Host '[nhp-frp] Initializing OpenNHP submodule...' -ForegroundColor Blue"
    git submodule update --init --recursive
    if errorlevel 1 (
        echo ERROR: Failed to initialize submodule.
        exit /b 1
    )
)

:: Create sdk output directory
if not exist bin\sdk mkdir bin\sdk

:: Capture Go env for passing into MSYS2 (login shell starts with a clean environment)
for /f "delims=" %%i in ('go env GOROOT')    do set "GO_GOROOT=%%i"
for /f "delims=" %%i in ('go env GOPATH')    do set "GO_GOPATH=%%i"
for /f "delims=" %%i in ('go env GOMODCACHE') do set "GO_GOMODCACHE=%%i"
for /f "delims=" %%i in ('go env GOCACHE')   do set "GO_GOCACHE=%%i"

:: Build via MSYS2 bash so GCC can resolve its sysroot headers (/mingw64/include).
:: Pass Go env as arguments since MSYS2 login shell doesn't inherit Windows env vars.
set "MSYS2_BASH=%MSYS2_DIR%\usr\bin\bash.exe"
set "SDK_SCRIPT=%CD%\hack\build-sdk-windows.sh"
"%MSYS2_BASH%" -l "%SDK_SCRIPT%" "%GO_GOROOT%" "%GO_GOPATH%" "%GO_GOMODCACHE%" "%GO_GOCACHE%" "%CD%" "%OPENNHP_DIR%" "%TEMP%"
:: MSYS2 login shell may return non-zero even on success, so verify the output file
if not exist bin\sdk\nhp-agent.dll (
    echo ERROR: Failed to build NHP SDK. Make sure mingw-w64-x86_64-gcc is installed in MSYS2.
    echo        Also ensure Windows Defender has exclusions for bin\sdk\ and temp build dirs.
    exit /b 1
)

:: Restore submodule changes (ignore errors from git commands)
pushd %OPENNHP_DIR%\nhp
git checkout go.mod go.sum 2>nul
popd
pushd %OPENNHP_DIR%\endpoints
git checkout go.mod go.sum 2>nul
popd
pushd %OPENNHP_DIR%
git reset --hard HEAD 2>nul
popd

powershell -NoProfile -Command "Write-Host '[nhp-frp] OpenNHP Windows SDK built successfully!' -ForegroundColor Blue"
:: Reset errorlevel so callers don't see stale errors from git/powershell
cmd /c "exit /b 0"
goto :eof

:frpc
call :print-version
call :build-sdk
if errorlevel 1 exit /b 1

powershell -NoProfile -Command "Write-Host '[nhp-frp] Building nhp-frpc ...' -ForegroundColor Blue"
set "PATH=%MSYS2_DIR%\mingw64\bin;%PATH%"
set CGO_ENABLED=1
go build -trimpath -ldflags "%LDFLAGS%" -o bin\nhp-frpc.exe .\cmd\frpc
if errorlevel 1 (
    echo ERROR: Failed to build nhp-frpc.
    exit /b 1
)
powershell -NoProfile -Command "Write-Host '[nhp-frp] nhp-frpc built successfully!' -ForegroundColor Blue"
goto :eof

:clean
powershell -NoProfile -Command "Write-Host '[nhp-frp] Cleaning build artifacts...' -ForegroundColor Blue"
if exist bin\nhp-frpc.exe del /f bin\nhp-frpc.exe
if exist bin\nhp-frps.exe del /f bin\nhp-frps.exe
if exist bin\sdk rmdir /s /q bin\sdk
goto :eof

:clean-sdk
powershell -NoProfile -Command "Write-Host '[nhp-frp] Cleaning OpenNHP SDK binaries...' -ForegroundColor Blue"
if exist bin\sdk\nhp-agent.dll del /f bin\sdk\nhp-agent.dll
if exist bin\sdk\nhp-agent.h del /f bin\sdk\nhp-agent.h
goto :eof

:test
go test -v --cover ./cmd/...
goto :eof

:help
echo Usage: build.bat [target]
echo.
echo Targets:
echo   all        Build everything (default)
echo   build      Build frps and frpc
echo   frps       Build nhp-frps only
echo   frpc       Build nhp-frpc only (includes SDK)
echo   build-sdk  Build OpenNHP SDK (nhp-agent.dll)
echo   fmt        Format Go code
echo   test       Run tests
echo   env        Print Go version
echo   clean      Remove build artifacts
echo   clean-sdk  Remove SDK binaries
echo   help       Show this help
goto :eof
