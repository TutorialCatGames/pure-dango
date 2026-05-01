@echo off
setlocal

REM Help menu
if "%1"=="-help"  goto showhelp
if "%1"=="--help" goto showhelp
if "%1"=="-h"     goto showhelp
if "%1"=="/?"     goto showhelp

REM dev mode - uses node
if "%1"=="-dev"   goto devmode

REM rebuild
if "%1"=="-r"     goto rebuild

REM use executable
"%~dp0..\dist\PureDangoLauncher.exe" run "%~1"
pause
goto :eof

:devmode
cd /d "%~dp0.."

REM check if node_modules exists
if not exist "node_modules\" (
    echo Dependencies not installed. Running npm install...
    call npm install
    if errorlevel 1 (
        echo npm install failed!
        pause
        exit /b 1
    )
)

REM run using tsx (TypeScript executor) or node with the built .cjs
where tsx >nul 2>&1
if %errorlevel% equ 0 (
    tsx src\index.ts "%~2"
) else (
    if exist "dist\PureDango.cjs" (
        node dist\PureDango.cjs "%~2"
    ) else (
        echo Building project first...
        set SKIP_EXE=true
        call npm run build
        if errorlevel 1 (
            echo Build failed!
            pause
            exit /b 1
        )
        node dist\PureDango.cjs "%~2"
    )
)
pause
goto :eof

:rebuild
if "%~2"=="" (
    cd /d "%~dp0.."
    call npm run build
    if errorlevel 1 (
        echo Build failed!
        pause
        exit /b 1
    )
    goto :eof
)
cd /d "%~dp0.."
call npm run build
if errorlevel 1 (
    echo Build failed!
    pause
    exit /b 1
)

set NODE_OPTIONS=--no-warnings
"%~dp0..\dist\PureDangoLauncher.exe" run "%~2"
pause
goto :eof

:showhelp
echo Usage: pure-dango [OPTIONS] [file]
echo.
echo Options:
echo   -help, --help, -h, /? : Show this help message
echo   -dev                  : Run in development mode (uses Node.js directly)
echo   -r [FILE]             : Rebuild the exe then run the file
echo   -r                    : Rebuild the exe only
echo.
echo Examples:
echo   pure-dango hello.pds         # Run using compiled executable
echo   pure-dango -dev hello.pds    # Run using Node.js (for development)
echo   pure-dango -r hello.pds      # Rebuild and run
goto :eof