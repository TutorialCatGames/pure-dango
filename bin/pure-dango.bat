@echo off
setlocal enabledelayedexpansion

REM Update command
if "%1"=="update"    goto update
if "%1"=="--update"  goto update

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

:update
echo Checking for updates...

REM Check if curl is available
where curl >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: curl is required for updates. Please install curl or download manually from:
    echo https://github.com/TutorialCatGames/pure-dango/releases/latest
    pause
    exit /b 1
)

REM Get latest release info from GitHub API
set RELEASE_JSON=%TEMP%\pd-release.json
curl -s https://api.github.com/repos/TutorialCatGames/pure-dango/releases/latest > "%RELEASE_JSON%"
if %errorlevel% neq 0 (
    echo Error: Failed to fetch release information
    pause
    exit /b 1
)

REM Use PowerShell to parse JSON safely (handles colons in URLs)
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "(Get-Content '%RELEASE_JSON%' | ConvertFrom-Json).tag_name"`) do set LATEST_TAG=%%a
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "(Get-Content '%RELEASE_JSON%' | ConvertFrom-Json).zipball_url"`) do set DOWNLOAD_URL=%%a

if "!LATEST_TAG!"=="" (
    echo Error: Could not determine latest version
    del "%RELEASE_JSON%"
    pause
    exit /b 1
)

if "!DOWNLOAD_URL!"=="" (
    echo Error: Could not find download URL
    del "%RELEASE_JSON%"
    pause
    exit /b 1
)

echo Latest version: !LATEST_TAG!
echo Downloading from: !DOWNLOAD_URL!

REM Create temporary directory
set TEMP_DIR=%TEMP%\pure-dango-update-%RANDOM%
mkdir "!TEMP_DIR!"

REM Download the release
curl -L -o "!TEMP_DIR!\source.zip" "!DOWNLOAD_URL!"
if %errorlevel% neq 0 (
    echo Error: Failed to download update
    rmdir /s /q "!TEMP_DIR!"
    del "%RELEASE_JSON%"
    pause
    exit /b 1
)

echo Extracting update...

REM Check if tar is available (Windows 10+)
where tar >nul 2>&1
if %errorlevel% equ 0 (
    tar -xf "!TEMP_DIR!\source.zip" -C "!TEMP_DIR!"
) else (
    REM Fall back to PowerShell
    powershell -NoProfile -Command "Expand-Archive -Path '!TEMP_DIR!\source.zip' -DestinationPath '!TEMP_DIR!' -Force"
)

if %errorlevel% neq 0 (
    echo Error: Failed to extract update
    rmdir /s /q "!TEMP_DIR!"
    del "%RELEASE_JSON%"
    pause
    exit /b 1
)

REM Create backup
set BACKUP_DIR=%~dp0..\pure-dango-backup-%date:~-4%%date:~-7,2%%date:~-10,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set BACKUP_DIR=!BACKUP_DIR: =0!

echo Creating backup at: !BACKUP_DIR!
xcopy /E /I /Y "%~dp0.." "!BACKUP_DIR!" >nul

REM Find extracted content (GitHub zipballs extract to TutorialCatGames-pure-dango-XXXXXXX format)
set EXTRACTED_DIR=
for /d %%d in ("!TEMP_DIR!\TutorialCatGames-pure-dango-*") do (
    set EXTRACTED_DIR=%%d
    goto :found_extracted
)

:found_extracted
if "!EXTRACTED_DIR!"=="" (
    echo Error: Could not find extracted directory
    rmdir /s /q "!TEMP_DIR!"
    del "%RELEASE_JSON%"
    pause
    exit /b 1
)

echo Installing update...

REM Copy new files over (excluding .git directory)
xcopy /E /I /Y /EXCLUDE:%TEMP%\exclude.txt "!EXTRACTED_DIR!\*" "%~dp0..\" >nul 2>nul
if not exist "%TEMP%\exclude.txt" (
    xcopy /E /I /Y "!EXTRACTED_DIR!\*" "%~dp0..\" >nul
)

REM Install dependencies
cd /d "%~dp0.."
echo Installing dependencies...
call npm install >nul
if errorlevel 1 (
    echo Warning: npm install had issues, but continuing...
)

REM Build the project
echo Building project...
call npm run build >nul
if errorlevel 1 (
    echo Error: Build failed!
    rmdir /s /q "!TEMP_DIR!"
    del "%RELEASE_JSON%"
    pause
    exit /b 1
)

REM Cleanup
rmdir /s /q "!TEMP_DIR!"
del "%RELEASE_JSON%"

echo.
echo Update completed successfully!
echo Backup saved at: !BACKUP_DIR!
echo.
echo To rollback, delete the current installation and rename the backup folder.
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
echo   update, --update      : Update to the latest version from GitHub
echo   -dev                  : Run in development mode (uses Node.js directly)
echo   -r [FILE]             : Rebuild the exe then run the file
echo   -r                    : Rebuild the exe only
echo.
echo Examples:
echo   pure-dango hello.pds         # Run using compiled executable
echo   pure-dango -dev hello.pds    # Run using Node.js (for development)
echo   pure-dango -r hello.pds      # Rebuild and run
echo   pure-dango update            # Update to latest version
goto :eof