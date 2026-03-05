@echo off
setlocal enabledelayedexpansion

set LDFLAGS=-s -w
set OPENNHP_DIR=third_party\opennhp

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
call :env
call :fmt
call :build
goto :eof

:build
call :frps
call :frpc
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
echo Building nhp-frps...
set CGO_ENABLED=0
go build -trimpath -ldflags "%LDFLAGS%" -tags frps -o bin\nhp-frps.exe .\cmd\frps
if errorlevel 1 (
    echo ERROR: Failed to build nhp-frps.
    exit /b 1
)
echo nhp-frps built successfully: bin\nhp-frps.exe
goto :eof

:build-sdk
echo [Nhp-frp] Building OpenNHP SDK for Windows (nhp-agent.dll)...

:: CGO requires a working C compiler. On Windows we use MSYS2 MinGW GCC.
:: GCC must be invoked with the MSYS2 mingw64 sysroot so it can find headers.
if "%MSYS2_DIR%"=="" (
    echo ERROR: MSYS2 MinGW-w64 not found. Install MSYS2 and mingw-w64-x86_64-gcc.
    echo        Expected at: C:\Program Files\msys2  or  C:\msys64
    exit /b 1
)

:: Check submodule is initialized
if not exist "%OPENNHP_DIR%\endpoints" (
    echo [Nhp-frp] Initializing OpenNHP submodule...
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
echo [DEBUG] MSYS2_BASH=%MSYS2_BASH%
echo [DEBUG] SDK_SCRIPT=%SDK_SCRIPT%
echo [DEBUG] GO_GOROOT=%GO_GOROOT%
echo [DEBUG] OPENNHP_DIR=%OPENNHP_DIR%
echo [DEBUG] TEMP=%TEMP%
"%MSYS2_BASH%" -l "%SDK_SCRIPT%" "%GO_GOROOT%" "%GO_GOPATH%" "%GO_GOMODCACHE%" "%GO_GOCACHE%" "%CD%" "%OPENNHP_DIR%" "%TEMP%"
echo [DEBUG] MSYS2 bash exit code: %ERRORLEVEL%
if errorlevel 1 (
    echo ERROR: Failed to build NHP SDK. Make sure mingw-w64-x86_64-gcc is installed in MSYS2.
    echo        Also ensure Windows Defender has exclusions for bin\sdk\ and temp build dirs.
    exit /b 1
)

:: Restore submodule changes
pushd %OPENNHP_DIR%\nhp
git checkout go.mod go.sum 2>nul
popd
pushd %OPENNHP_DIR%\endpoints
git checkout go.mod go.sum 2>nul
popd
pushd %OPENNHP_DIR%
git reset --hard HEAD 2>nul
popd

echo [Nhp-frp] Windows SDK built successfully!
goto :eof

:frpc
call :build-sdk
if errorlevel 1 exit /b 1

echo Building nhp-frpc...
go build -trimpath -ldflags "%LDFLAGS%" -o bin\nhp-frpc.exe .\cmd\frpc
if errorlevel 1 (
    echo ERROR: Failed to build nhp-frpc.
    exit /b 1
)
echo nhp-frpc built successfully: bin\nhp-frpc.exe
goto :eof

:clean
echo Cleaning build artifacts...
if exist bin\nhp-frpc.exe del /f bin\nhp-frpc.exe
if exist bin\nhp-frps.exe del /f bin\nhp-frps.exe
if exist bin\sdk rmdir /s /q bin\sdk
goto :eof

:clean-sdk
echo Cleaning SDK binaries...
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
