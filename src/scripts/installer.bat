@echo off
echo registering .pds
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator permission...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)
for %%I in ("%~dp0..\..\bin") do set "BIN_DIR=%%~fI"

reg add "HKCR\.pds" /ve /d "PureDangoFile" /f
reg add "HKCR\PureDangoFile" /ve /d "Pure Dango Script" /f
reg add "HKCR\PureDangoFile\DefaultIcon" /ve /d "\"%~dp0..\..\assets\pure-dango.ico\",0" /f
reg add "HKCR\PureDangoFile\shell\open\command" /ve /d "\"%BIN_DIR%\pure-dango.bat\" \"%%1\"" /f
echo registering PATH

powershell -Command "$p=[Environment]::GetEnvironmentVariable('Path','Machine'); if($p -notlike '*C:\Users\WIN_11\Downloads\pure-dango\bin*'){[Environment]::SetEnvironmentVariable('Path',$p+';%BIN_DIR%','Machine'); Write-Host 'PATH updated.'} else {Write-Host 'Already in PATH.'}"

echo refreshing explorer.exe
taskkill /f /im explorer.exe >nul 2>&1
timeout /t 2 >nul
start explorer.exe
echo .pds has been registered and PATH updated.
pause