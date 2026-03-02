@echo off
echo registering .pds

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator permission...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

reg add "HKCR\.pds" /ve /d "PureDangoFile" /f
reg add "HKCR\PureDangoFile" /ve /d "Pure Dango Script" /f

reg add "HKCR\PureDangoFile\DefaultIcon" /ve /d "\"%~dp0..\..\assets\pure-dango.ico\",0" /f

reg add "HKCR\PureDangoFile\shell\open\command" /ve /d "\"%~dp0run.bat\" \"%%1\"" /f

echo refreshing explorer.exe
taskkill /f /im explorer.exe >nul 2>&1
timeout /t 2 >nul
start explorer.exe

echo.
echo .pds has been registered.
pause
