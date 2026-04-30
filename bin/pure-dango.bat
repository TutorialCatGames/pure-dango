@echo off
setlocal

if "%1"=="-r"     goto raw
if "%1"=="-help"  goto showhelp
if "%1"=="--help" goto showhelp
if "%1"=="-h"     goto showhelp
if "%1"=="/?"     goto showhelp

"%~dp0..\dist\PureDangoLauncher.exe" run "%~1"
pause
goto :eof

:raw
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
echo Usage: pure-dango [file]
echo.
echo Options:
echo   -help, --help, -h, /? : Show this help message
echo   -r [FILE]             : Rebuilds the exe then runs the file
echo   -r                    : Rebuilds the exe
echo.
echo Example:
echo   pure-dango "C:\path\to\file.pds"
goto :eof