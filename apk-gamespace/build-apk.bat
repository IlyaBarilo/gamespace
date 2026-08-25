@echo off
setlocal

set "ROOT=%~dp0"
for %%I in ("%ROOT%..") do set "WORKSPACE=%%~fI"
set "SCRIPT=%ROOT%build-apk.ps1"
set "MODE=%~1"
set "RELEASE_VERSION=%~2"
set "HAS_ARG=0"
if not "%MODE%"=="" set "HAS_ARG=1"

if not exist "%SCRIPT%" (
    echo build-apk.ps1 was not found next to this BAT file.
    pause
    exit /b 1
)

if /I "%MODE%"=="build" goto build
if /I "%MODE%"=="apk" goto build
if /I "%MODE%"=="clean" goto clean
if /I "%MODE%"=="cleanup" goto clean
if /I "%MODE%"=="help" goto help
if /I "%MODE%"=="-h" goto help
if /I "%MODE%"=="/?" goto help

echo.
echo GameSpace loader APK builder
echo This APK does not include the site files.
echo.
echo 1 - Build APK
echo 2 - Clean generated files
echo.
choice /C 12 /N /M "Choose mode [1/2]: "
if errorlevel 2 goto clean
if errorlevel 1 goto build

:build
set "BUILD_ARGS="
goto run

:clean
set "MODE=clean"
set "BUILD_ARGS=-Clean"
goto run

:run
echo.
echo Running APK builder...

if "%RELEASE_VERSION%"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %BUILD_ARGS%
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %BUILD_ARGS% -VersionName "%RELEASE_VERSION%"
)
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
    echo Done.
    if /I not "%MODE%"=="clean" (
        if /I not "%MODE%"=="cleanup" (
            echo APK should be here:
            echo %ROOT%release\GameSpace.apk
        )
    )
) else (
    echo Build did not finish. Exit code: %EXITCODE%
    echo.
    echo If Android SDK was not found:
    echo 1. Run install-android-sdk.bat.
    echo 2. Run build-apk.bat again.
)

if "%HAS_ARG%"=="0" pause
exit /b %EXITCODE%

:help
echo.
echo Usage:
echo   build-apk.bat       - show menu
echo   build-apk.bat build - build loader APK
echo   build-apk.bat build 0.5 - build APK with a release version
echo   build-apk.bat clean - remove build output and release APK
echo.
echo Ready APK path:
echo   release\GameSpace.apk
echo.
exit /b 0
