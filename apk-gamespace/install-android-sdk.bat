@echo off
setlocal

set "ROOT=%~dp0"
set "SDK_ROOT=%LOCALAPPDATA%\Android\Sdk"
set "TOOLS_DIR=%SDK_ROOT%\cmdline-tools\latest"
set "SDKMANAGER=%TOOLS_DIR%\bin\sdkmanager.bat"
set "STUDIO_JBR=%ProgramFiles%\Android\Android Studio\jbr"
set "ZIP_URL=https://dl.google.com/android/repository/commandlinetools-win-14742923_latest.zip"
set "ZIP_FILE=%TEMP%\android-commandlinetools-latest.zip"
set "TMP_DIR=%TEMP%\android-commandlinetools-extract"
set "YES_FILE=%TEMP%\android-sdk-yes.txt"

echo.
echo Android SDK installer
echo SDK path:
echo %SDK_ROOT%
echo.

if exist "%STUDIO_JBR%\bin\java.exe" (
    set "JAVA_HOME=%STUDIO_JBR%"
    set "PATH=%STUDIO_JBR%\bin;%PATH%"
)

if exist "%SDKMANAGER%" goto install_packages

echo Creating SDK folders...
if not exist "%SDK_ROOT%" mkdir "%SDK_ROOT%"
if not exist "%SDK_ROOT%\cmdline-tools" mkdir "%SDK_ROOT%\cmdline-tools"

where curl.exe >nul 2>nul
if errorlevel 1 (
    echo curl.exe was not found. Install SDK from Android Studio SDK Manager instead.
    pause
    exit /b 1
)

echo Downloading official Android command-line tools...
curl.exe -L -o "%ZIP_FILE%" "%ZIP_URL%"
if errorlevel 1 (
    echo Download failed.
    pause
    exit /b 1
)

if exist "%TMP_DIR%" rmdir /s /q "%TMP_DIR%"
mkdir "%TMP_DIR%"

echo Extracting command-line tools...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%ZIP_FILE%' -DestinationPath '%TMP_DIR%' -Force"
if errorlevel 1 (
    echo Extract failed.
    pause
    exit /b 1
)

if exist "%TOOLS_DIR%" rmdir /s /q "%TOOLS_DIR%"
mkdir "%TOOLS_DIR%"

xcopy "%TMP_DIR%\cmdline-tools\*" "%TOOLS_DIR%\" /E /I /Y >nul
if errorlevel 1 (
    echo Copying command-line tools failed.
    pause
    exit /b 1
)

:install_packages
if not exist "%SDKMANAGER%" (
    echo sdkmanager was not found:
    echo %SDKMANAGER%
    pause
    exit /b 1
)

echo.
echo Preparing license answers...
(for /L %%i in (1,1,200) do @echo y) > "%YES_FILE%"

echo.
echo Accepting SDK licenses...
call "%SDKMANAGER%" --sdk_root="%SDK_ROOT%" --licenses < "%YES_FILE%"

echo.
echo Installing required SDK packages...
echo This can take several minutes.
echo.

call "%SDKMANAGER%" --sdk_root="%SDK_ROOT%" "platform-tools" "platforms;android-35" "build-tools;35.0.0" < "%YES_FILE%"
if errorlevel 1 (
    echo SDK package installation failed.
    pause
    exit /b 1
)

if not exist "%SDK_ROOT%\platforms\android-35\android.jar" (
    echo android.jar was not installed.
    pause
    exit /b 1
)

if not exist "%SDK_ROOT%\build-tools\35.0.0\aapt2.exe" (
    echo aapt2.exe was not installed.
    pause
    exit /b 1
)

setx ANDROID_SDK_ROOT "%SDK_ROOT%" >nul
setx ANDROID_HOME "%SDK_ROOT%" >nul

set "LOCAL_PROPERTIES=%ROOT%android-webview-app\local.properties"
if exist "%ROOT%android-webview-app" (
    echo sdk.dir=%SDK_ROOT:\=/%>"%LOCAL_PROPERTIES%"
)

echo.
echo Android SDK is ready.
echo Now run:
echo build-apk.bat test
echo.
pause
exit /b 0
