param(
    [string]$AppName = "GameSpace",
    [string]$VersionName = "0.3.0",
    [Nullable[int]]$VersionCode = $null,
    [string]$KeystorePath = "",
    [string]$KeystorePassword = "",
    [string]$KeyAlias = "",
    [string]$KeyPassword = "",
    [switch]$AllowTestSigning,
    [switch]$RequireExistingKeystore,
    [switch]$Clean
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkspaceDir = Split-Path -Parent $RootDir
$ReleaseDir = Join-Path $RootDir "release"
$ProjectDir = Join-Path $RootDir "android-webview-loader"
$StringsPath = Join-Path $ProjectDir "app\src\main\res\values\strings.xml"
$DemoSourceDirectory = Join-Path $WorkspaceDir "demo"
$DemoBuilderScript = Join-Path $WorkspaceDir "tools\build-demo.ps1"
$AssetsDemoArchivePath = Join-Path $ProjectDir "app\src\main\assets\demo.7z"
$LicenseAssetsDirectory = Join-Path $ProjectDir "app\src\main\assets\licenses"
$MinSdkVersion = 23
$TargetSdkVersion = 36

function Write-Step($Text) {
    Write-Host ""
    Write-Host "== $Text" -ForegroundColor Cyan
}

function Normalize-VersionName($Name) {
    $match = [regex]::Match($Name, '^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?$')
    if (-not $match.Success) {
        throw "VersionName must use MAJOR, MAJOR.MINOR, or MAJOR.MINOR.PATCH format: $Name"
    }

    $major = $match.Groups[1].Value
    $minor = if ($match.Groups[2].Success) { $match.Groups[2].Value } else { "0" }
    $patch = if ($match.Groups[3].Success) { $match.Groups[3].Value } else { "0" }
    return "$major.$minor.$patch"
}

function Get-AndroidVersionCode($Name) {
    if ($Name -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
        throw "VersionName must use semantic version format MAJOR.MINOR.PATCH: $Name"
    }

    $major = [int64]$Matches[1]
    $minor = [int64]$Matches[2]
    $patch = [int64]$Matches[3]
    if ($minor -gt 99 -or $patch -gt 99) {
        throw "Android version mapping supports MINOR and PATCH values from 0 to 99: $Name"
    }

    $code = ($major * 10000) + ($minor * 100) + $patch
    if ($code -le 0 -or $code -gt [int]::MaxValue) {
        throw "Calculated Android versionCode is outside the supported range: $code"
    }
    return [int]$code
}

function Get-JavaMajorVersion {
    $java = Get-Command java -ErrorAction SilentlyContinue
    if (-not $java) {
        return $null
    }

    $output = & cmd /c "java -version 2>&1"
    $versionLine = ($output | Select-String -Pattern 'version "([^"]+)"' | Select-Object -First 1)
    if (-not $versionLine) {
        return $null
    }

    $version = $versionLine.Matches[0].Groups[1].Value
    if ($version -match '^1\.(\d+)') {
        return [int]$Matches[1]
    }
    if ($version -match '^(\d+)') {
        return [int]$Matches[1]
    }
    return $null
}

function Find-AndroidSdk {
    $candidates = @()
    if ($env:ANDROID_SDK_ROOT) { $candidates += $env:ANDROID_SDK_ROOT }
    if ($env:ANDROID_HOME) { $candidates += $env:ANDROID_HOME }
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA "Android\Sdk") }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    return $null
}

function Get-VersionSortKey($Name) {
    try {
        return [version]$Name
    } catch {
        return [version]"0.0"
    }
}

function Find-LatestAndroidPlatform($SdkDir) {
    $platformsDir = Join-Path $SdkDir "platforms"
    if (-not (Test-Path -LiteralPath $platformsDir)) {
        return $null
    }

    return Get-ChildItem -LiteralPath $platformsDir -Directory |
        Where-Object { $_.Name -match '^android-\d+$' -and (Test-Path -LiteralPath (Join-Path $_.FullName "android.jar")) } |
        Sort-Object { [int]($_.Name -replace '^android-', '') } -Descending |
        Select-Object -First 1
}

function Find-LatestBuildTools($SdkDir) {
    $buildToolsDir = Join-Path $SdkDir "build-tools"
    if (-not (Test-Path -LiteralPath $buildToolsDir)) {
        return $null
    }

    return Get-ChildItem -LiteralPath $buildToolsDir -Directory |
        Sort-Object { Get-VersionSortKey $_.Name } -Descending |
        Select-Object -First 1
}

function Find-ExeCandidate($Names, $ExtraPaths) {
    foreach ($path in $ExtraPaths) {
        foreach ($name in $Names) {
            $candidate = Join-Path $path $name
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                return $candidate
            }
        }
    }

    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) {
            return $command.Source
        }
    }

    return $null
}

function Find-JdkBinDir {
    $candidates = @()
    if ($env:JAVA_HOME) {
        $candidates += (Join-Path $env:JAVA_HOME "bin")
    }

    $candidates += @(
        "C:\Program Files\Android\Android Studio\jbr\bin",
        "C:\Program Files\Android\Android Studio\jre\bin",
        "C:\Program Files\Java\jdk-22\bin",
        "C:\Program Files\Java\jdk-21\bin",
        "C:\Program Files\Java\jdk-17\bin",
        "C:\Program Files\Eclipse Adoptium\jdk-22*\bin",
        "C:\Program Files\Eclipse Adoptium\jdk-21*\bin",
        "C:\Program Files\Eclipse Adoptium\jdk-17*\bin"
    )

    foreach ($candidate in $candidates) {
        $matches = Get-Item -Path $candidate -ErrorAction SilentlyContinue
        foreach ($match in $matches) {
            if (Test-Path -LiteralPath (Join-Path $match.FullName "javac.exe")) {
                return $match.FullName
            }
        }
    }

    $javac = Get-Command javac -ErrorAction SilentlyContinue
    if ($javac) {
        return Split-Path -Parent $javac.Source
    }

    return $null
}

function Get-PathSizeBytes($Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return 0
    }

    $item = Get-Item -LiteralPath $Path -Force
    if (-not $item.PSIsContainer) {
        return $item.Length
    }

    $sum = (Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    if ($sum) { return $sum }
    return 0
}

function Remove-GeneratedPath($Path, $Boundary) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return 0
    }

    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
    $resolvedBoundary = (Resolve-Path -LiteralPath $Boundary).Path
    if ($resolvedPath.Equals($resolvedBoundary, [StringComparison]::OrdinalIgnoreCase) -or
        -not $resolvedPath.StartsWith($resolvedBoundary, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove unexpected path: $resolvedPath"
    }

    $size = Get-PathSizeBytes $resolvedPath
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Removed: $resolvedPath"
    return $size
}

function Clear-GeneratedBuildFiles($ProjectDir, $ReleaseDir) {
    Write-Step "Cleaning generated APK files"

    $appDir = Join-Path $ProjectDir "app"
    $rootDir = Split-Path -Parent $ProjectDir
    $targets = @(
        @{ Path = (Join-Path $appDir "build"); Boundary = $ProjectDir },
        @{ Path = (Join-Path $ProjectDir "build"); Boundary = $ProjectDir },
        @{ Path = $ReleaseDir; Boundary = $rootDir }
    )

    $freed = 0
    foreach ($target in $targets) {
        $freed += Remove-GeneratedPath $target.Path $target.Boundary
    }

    $freedMb = [math]::Round($freed / 1MB, 2)
    Write-Host ""
    Write-Host "Clean finished. Freed about $freedMb MB." -ForegroundColor Green
    New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null
}

function Copy-ApkToRelease($ApkPath, $ReleaseDir, $AppName) {
    New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null

    Get-ChildItem -LiteralPath $ReleaseDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*.apk" -or $_.Name -like "*.idsig" -or $_.Name -like "*.sha256.txt" } |
        Remove-Item -Force -ErrorAction SilentlyContinue

    $safeName = ($AppName -replace '[\\/:*?"<>|]', '_').Trim()
    if ([string]::IsNullOrWhiteSpace($safeName)) {
        $safeName = "app"
    }

    $releaseApkPath = Join-Path $ReleaseDir "$safeName.apk"
    Copy-Item -LiteralPath $ApkPath -Destination $releaseApkPath -Force

    return $releaseApkPath
}

function Test-RequiredProjectFiles($ProjectDir) {
    $required = @(
        "app\src\main\AndroidManifest.xml",
        "app\src\main\java\ru\local\gamespace\loader\MainActivity.java",
        "app\src\main\res\values\strings.xml",
        "app\src\main\res\values\styles.xml"
    )

    foreach ($relative in $required) {
        $path = Join-Path $ProjectDir $relative
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Required project file is missing: $relative"
        }
    }
}

function Get-FileSha256($Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "")
    } finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}

function Test-MatchingLicenseFile($SourcePath, $AssetPath, $Label) {
    if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
        throw "License source file is missing: $SourcePath"
    }
    if (-not (Test-Path -LiteralPath $AssetPath -PathType Leaf)) {
        throw "APK license asset is missing: $Label"
    }

    $sourceHash = Get-FileSha256 $SourcePath
    $assetHash = Get-FileSha256 $AssetPath
    if ($sourceHash -ne $assetHash) {
        throw "APK license asset does not match its source: $Label"
    }
}

function Test-ApkLicenseAssets($WorkspaceDir, $LicenseAssetsDirectory) {
    $rootFiles = @(
        @{ Source = (Join-Path $WorkspaceDir "LICENSE"); Asset = "LICENSE.txt" },
        @{ Source = (Join-Path $WorkspaceDir "BRAND_ASSETS_LICENSE.md"); Asset = "BRAND_ASSETS_LICENSE.md" },
        @{ Source = (Join-Path $WorkspaceDir "demo\DEMO_CONTENT_LICENSE.md"); Asset = "DEMO_CONTENT_LICENSE.md" },
        @{ Source = (Join-Path $WorkspaceDir "THIRD_PARTY_NOTICES.md"); Asset = "THIRD_PARTY_NOTICES.md" }
    )

    foreach ($file in $rootFiles) {
        Test-MatchingLicenseFile $file.Source (Join-Path $LicenseAssetsDirectory $file.Asset) $file.Asset
    }

    $sourceDirectory = Join-Path $WorkspaceDir "third_party\licenses"
    $assetDirectory = Join-Path $LicenseAssetsDirectory "third_party"
    if (-not (Test-Path -LiteralPath $sourceDirectory -PathType Container)) {
        throw "Third-party license source directory is missing: $sourceDirectory"
    }
    if (-not (Test-Path -LiteralPath $assetDirectory -PathType Container)) {
        throw "APK third-party license asset directory is missing: $assetDirectory"
    }

    $sourceFiles = @(Get-ChildItem -LiteralPath $sourceDirectory -File | Sort-Object Name)
    $assetFiles = @(Get-ChildItem -LiteralPath $assetDirectory -File | Sort-Object Name)
    if ($sourceFiles.Count -eq 0 -or $sourceFiles.Count -ne $assetFiles.Count) {
        throw "APK third-party license asset set does not match third_party/licenses/."
    }

    for ($index = 0; $index -lt $sourceFiles.Count; $index++) {
        if ($sourceFiles[$index].Name -ne $assetFiles[$index].Name) {
            throw "APK third-party license asset set does not match third_party/licenses/."
        }
        Test-MatchingLicenseFile $sourceFiles[$index].FullName $assetFiles[$index].FullName ("third_party/" + $sourceFiles[$index].Name)
    }
}

function Set-StringResource($Xml, $Name, $Value) {
    $node = $Xml.resources.string | Where-Object { $_.name -eq $Name } | Select-Object -First 1
    if (-not $node) {
        $node = $Xml.CreateElement("string")
        $nameAttribute = $Xml.CreateAttribute("name")
        $nameAttribute.Value = $Name
        $node.Attributes.Append($nameAttribute) | Out-Null
        $Xml.resources.AppendChild($node) | Out-Null
    }

    $node.InnerText = $Value
}

function Get-AndroidVersionLabel($ApiLevel) {
    switch ($ApiLevel) {
        19 { return "Android 4.4 (API 19, 2013)" }
        21 { return "Android 5.0 (API 21, 2014)" }
        22 { return "Android 5.1 (API 22, 2015)" }
        23 { return "Android 6.0 (API 23, 2015)" }
        24 { return "Android 7.0 (API 24, 2016)" }
        25 { return "Android 7.1 (API 25, 2016)" }
        26 { return "Android 8.0 (API 26, 2017)" }
        27 { return "Android 8.1 (API 27, 2017)" }
        28 { return "Android 9 (API 28, 2018)" }
        29 { return "Android 10 (API 29, 2019)" }
        30 { return "Android 11 (API 30, 2020)" }
        31 { return "Android 12 (API 31, 2021)" }
        32 { return "Android 12L (API 32, 2022)" }
        33 { return "Android 13 (API 33, 2022)" }
        34 { return "Android 14 (API 34, 2023)" }
        35 { return "Android 15 (API 35, 2024)" }
        36 { return "Android 16 (API 36, 2025)" }
        37 { return "Android 17 (API 37, 2026)" }
        default { return "API $ApiLevel" }
    }
}

function Update-BuiltinDemoArchive($SourceDirectory, $BuilderScript, $DestinationPath) {
    Write-Step "Updating builtin demo"

    if (-not (Test-Path -LiteralPath $SourceDirectory -PathType Container)) {
        throw "Builtin demo source directory was not found: $SourceDirectory"
    }
    if (-not (Test-Path -LiteralPath $BuilderScript -PathType Leaf)) {
        throw "Builtin demo builder was not found: $BuilderScript"
    }

    $destinationDir = Split-Path -Parent $DestinationPath
    New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
    & $BuilderScript -SourceDirectory $SourceDirectory -OutputArchive $DestinationPath
    if ($LASTEXITCODE -ne 0) {
        throw "Builtin demo builder failed with exit code $LASTEXITCODE."
    }

    $archiveItem = Get-Item -LiteralPath $DestinationPath
    $sizeMb = [math]::Round($archiveItem.Length / 1MB, 2)
    Write-Host "Built demo.7z from demo directory: $SourceDirectory"
    Write-Host "Size: $sizeMb MB"
}

function Invoke-DirectSdkBuild($ProjectDir, $SdkDir) {
    Write-Step "Building APK with Android SDK tools"

    $platform = Find-LatestAndroidPlatform $SdkDir
    if (-not $platform) {
        throw "No Android platform with android.jar was found in SDK: $SdkDir"
    }
    $platformApiLevel = [int]($platform.Name -replace '^android-', '')
    if ($platformApiLevel -lt $TargetSdkVersion) {
        throw "Installed Android platform is $($platform.Name), but target SDK $TargetSdkVersion requires platforms\android-$TargetSdkVersion. Install it with sdkmanager `"platforms;android-$TargetSdkVersion`"."
    }

    $buildTools = Find-LatestBuildTools $SdkDir
    if (-not $buildTools) {
        throw "No Android build-tools folder was found in SDK: $SdkDir"
    }

    $platformAndroidJar = Join-Path $platform.FullName "android.jar"
    $aapt2 = Join-Path $buildTools.FullName "aapt2.exe"
    $d8 = Join-Path $buildTools.FullName "d8.bat"
    $zipalign = Join-Path $buildTools.FullName "zipalign.exe"
    $apksigner = Join-Path $buildTools.FullName "apksigner.bat"

    foreach ($tool in @($aapt2, $d8, $zipalign, $apksigner)) {
        if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
            throw "Required Android SDK tool was not found: $tool"
        }
    }

    $jdkBin = Find-JdkBinDir
    if (-not $jdkBin) {
        throw "javac was not found. Install Android Studio or a JDK."
    }

    $jdkHome = Split-Path -Parent $jdkBin
    $env:JAVA_HOME = $jdkHome
    $env:PATH = "$jdkBin;$env:PATH"

    $javac = Join-Path $jdkBin "javac.exe"
    $keytool = Join-Path $jdkBin "keytool.exe"
    if (-not (Test-Path -LiteralPath $keytool -PathType Leaf)) {
        $keytool = Find-ExeCandidate @("keytool.exe", "keytool.bat", "keytool") @($jdkBin)
    }
    if (-not $keytool) {
        throw "keytool was not found. Install Android Studio or a JDK."
    }

    $appDir = Join-Path $ProjectDir "app"
    $manifest = Join-Path $appDir "src\main\AndroidManifest.xml"
    $resDir = Join-Path $appDir "src\main\res"
    $assetsDir = Join-Path $appDir "src\main\assets"
    $javaSrcDir = Join-Path $appDir "src\main\java"
    $libsDir = Join-Path $appDir "libs"
    $buildDir = Join-Path $appDir "build\direct"
    $genDir = Join-Path $buildDir "gen"
    $classesDir = Join-Path $buildDir "classes"
    $dexDir = Join-Path $buildDir "dex"
    $outputsDir = Join-Path $appDir "build\outputs\apk\debug"

    if (Test-Path -LiteralPath $buildDir) {
        $resolvedBuildDir = (Resolve-Path -LiteralPath $buildDir).Path
        $resolvedAppDir = (Resolve-Path -LiteralPath $appDir).Path
        if (-not $resolvedBuildDir.StartsWith($resolvedAppDir, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to clear unexpected build path: $resolvedBuildDir"
        }
        Remove-Item -LiteralPath $resolvedBuildDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $genDir, $classesDir, $dexDir, $outputsDir -Force | Out-Null

    $androidJar = Join-Path $buildDir "android.jar"
    Copy-Item -LiteralPath $platformAndroidJar -Destination $androidJar -Force

    $compiledRes = Join-Path $buildDir "compiled-res.zip"
    $unsignedApk = Join-Path $buildDir "app-unsigned.apk"
    $dexedApk = Join-Path $buildDir "app-dexed.apk"
    $alignedApk = Join-Path $buildDir "app-aligned.apk"
    $finalApk = Join-Path $outputsDir "app-debug.apk"

    & $aapt2 compile --dir $resDir -o $compiledRes
    if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed with exit code $LASTEXITCODE" }

    & $aapt2 link `
        -o $unsignedApk `
        -I $androidJar `
        --manifest $manifest `
        -R $compiledRes `
        --java $genDir `
        --min-sdk-version $MinSdkVersion `
        --target-sdk-version $TargetSdkVersion `
        --version-code $VersionCode `
        --version-name $VersionName `
        --auto-add-overlay
    if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed with exit code $LASTEXITCODE" }

    $javaFiles = @()
    $javaFiles += Get-ChildItem -LiteralPath $genDir -Recurse -Filter "*.java" | ForEach-Object { $_.FullName }
    $javaFiles += Get-ChildItem -LiteralPath $javaSrcDir -Recurse -Filter "*.java" | ForEach-Object { $_.FullName }
    if ($javaFiles.Count -eq 0) {
        throw "No Java source files were found."
    }

    $libraryJars = @()
    if (Test-Path -LiteralPath $libsDir) {
        $libraryJars = Get-ChildItem -LiteralPath $libsDir -Filter "*.jar" -File | ForEach-Object { $_.FullName }
    }

    $compileClasspath = @($androidJar) + $libraryJars
    $compileClasspathText = $compileClasspath -join [IO.Path]::PathSeparator

    & $javac -encoding UTF-8 -source 1.8 -target 1.8 -bootclasspath $androidJar -classpath $compileClasspathText -d $classesDir $javaFiles
    if ($LASTEXITCODE -ne 0) { throw "javac failed with exit code $LASTEXITCODE" }

    $classFiles = Get-ChildItem -LiteralPath $classesDir -Recurse -Filter "*.class" | ForEach-Object { $_.FullName }
    if ($classFiles.Count -eq 0) {
        throw "No compiled .class files were found."
    }

    # Passing every nested class to d8.bat can exceed cmd.exe's command-line limit.
    # A single intermediate JAR keeps the direct SDK build independent of class count.
    $jarTool = Join-Path $jdkBin "jar.exe"
    $compiledClassesJar = Join-Path $buildDir "compiled-classes.jar"
    & $jarTool cf $compiledClassesJar -C $classesDir "."
    if ($LASTEXITCODE -ne 0) { throw "Packing compiled classes failed with exit code $LASTEXITCODE" }
    $d8Inputs = @($compiledClassesJar) + $libraryJars
    & $d8 --lib $androidJar --output $dexDir $d8Inputs
    if ($LASTEXITCODE -ne 0) { throw "d8 failed with exit code $LASTEXITCODE" }

    $classesDex = Join-Path $dexDir "classes.dex"
    if (-not (Test-Path -LiteralPath $classesDex -PathType Leaf)) {
        throw "classes.dex was not produced by d8."
    }

    Move-Item -LiteralPath $unsignedApk -Destination $dexedApk -Force
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::Open($dexedApk, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        $existing = $zip.GetEntry("classes.dex")
        if ($existing) {
            $existing.Delete()
        }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $classesDex, "classes.dex") | Out-Null
        if (Test-Path -LiteralPath $assetsDir) {
            $assetFiles = Get-ChildItem -LiteralPath $assetsDir -Recurse -File
            foreach ($asset in $assetFiles) {
                $relative = $asset.FullName.Substring((Resolve-Path -LiteralPath $assetsDir).Path.Length).TrimStart('\', '/')
                $entryName = "assets/" + ($relative -replace '\\', '/')
                $existingAsset = $zip.GetEntry($entryName)
                if ($existingAsset) {
                    $existingAsset.Delete()
                }
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $asset.FullName, $entryName, [System.IO.Compression.CompressionLevel]::NoCompression) | Out-Null
            }
        }
    } finally {
        $zip.Dispose()
    }
    Remove-Item -LiteralPath $unsignedApk -Force -ErrorAction SilentlyContinue

    Remove-Item -LiteralPath $alignedApk -Force -ErrorAction SilentlyContinue
    & $zipalign -f 4 $dexedApk $alignedApk
    if ($LASTEXITCODE -ne 0) { throw "zipalign failed with exit code $LASTEXITCODE" }
    Remove-Item -LiteralPath $dexedApk -Force -ErrorAction SilentlyContinue

    $keystore = if ($AllowTestSigning) {
        Join-Path $ProjectDir "debug.keystore"
    } else {
        [IO.Path]::GetFullPath($KeystorePath)
    }
    if (-not (Test-Path -LiteralPath $keystore -PathType Leaf)) {
        if (-not $AllowTestSigning -or $RequireExistingKeystore) {
            throw "The required APK signing keystore was not found: $keystore"
        }
        $keystoreDirectory = Split-Path -Parent $keystore
        if ($keystoreDirectory) {
            New-Item -ItemType Directory -Path $keystoreDirectory -Force | Out-Null
        }
        & $keytool -genkeypair -v `
            -keystore $keystore `
            -storepass $KeystorePassword `
            -alias $KeyAlias `
            -keypass $KeyPassword `
            -keyalg RSA `
            -keysize 2048 `
            -validity 10000 `
            -dname "CN=Android Debug,O=Android,C=US"
        if ($LASTEXITCODE -ne 0) { throw "keytool failed with exit code $LASTEXITCODE" }
    }

    Remove-Item -LiteralPath $finalApk -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "$finalApk.idsig" -Force -ErrorAction SilentlyContinue
    & $apksigner sign `
        --ks $keystore `
        --ks-key-alias $KeyAlias `
        --ks-pass "pass:$KeystorePassword" `
        --key-pass "pass:$KeyPassword" `
        --out $finalApk `
        $alignedApk
    if ($LASTEXITCODE -ne 0) { throw "apksigner failed with exit code $LASTEXITCODE" }
    & $apksigner verify --verbose $finalApk | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "apksigner verification failed with exit code $LASTEXITCODE" }
    Remove-Item -LiteralPath $alignedApk -Force -ErrorAction SilentlyContinue

    return $finalApk
}

if ($Clean) {
    Clear-GeneratedBuildFiles $ProjectDir $ReleaseDir
    exit 0
}

$hasExplicitKeystore = -not [string]::IsNullOrWhiteSpace($KeystorePath)
if ($AllowTestSigning -and $hasExplicitKeystore) {
    throw "AllowTestSigning cannot be combined with KeystorePath. Remove AllowTestSigning when using a release signing key."
}
if ($AllowTestSigning -and $RequireExistingKeystore) {
    throw "AllowTestSigning cannot be combined with RequireExistingKeystore."
}

if ($AllowTestSigning) {
    $KeystorePassword = "android"
    $KeyAlias = "androiddebugkey"
    $KeyPassword = "android"
    Write-Host "LOCAL TEST SIGNING: this APK cannot update an official release." -ForegroundColor Yellow
} else {
    if (-not $hasExplicitKeystore) {
        throw "A release signing keystore is required. Pass KeystorePath, KeystorePassword, KeyAlias, and KeyPassword. For a local test APK, use AllowTestSigning explicitly."
    }
    $resolvedKeystorePath = [IO.Path]::GetFullPath($KeystorePath)
    if (-not (Test-Path -LiteralPath $resolvedKeystorePath -PathType Leaf)) {
        throw "The required APK signing keystore was not found: $resolvedKeystorePath"
    }
    $KeystorePath = $resolvedKeystorePath
    foreach ($signingParameter in @{
        KeystorePassword = $KeystorePassword
        KeyAlias = $KeyAlias
        KeyPassword = $KeyPassword
    }.GetEnumerator()) {
        if ([string]::IsNullOrWhiteSpace([string]$signingParameter.Value)) {
            throw "The release signing parameter $($signingParameter.Key) is required."
        }
    }
}

$VersionName = Normalize-VersionName $VersionName
$calculatedVersionCode = Get-AndroidVersionCode $VersionName
if ($null -eq $VersionCode) {
    $VersionCode = $calculatedVersionCode
} elseif ($VersionCode -le 0) {
    throw "VersionCode must be a positive integer."
}

Write-Host "GameSpace release version: $VersionName (Android versionCode $VersionCode)" -ForegroundColor DarkGray

Write-Step "Checking Android project"
Test-RequiredProjectFiles $ProjectDir
Test-ApkLicenseAssets $WorkspaceDir $LicenseAssetsDirectory

$originalStringsBytes = [IO.File]::ReadAllBytes($StringsPath)
try {
    Write-Step "Updating app metadata"
    [xml]$stringsXml = Get-Content -LiteralPath $StringsPath -Raw
    Set-StringResource $stringsXml "app_name" $AppName
    Set-StringResource $stringsXml "app_version_name" $VersionName
    Set-StringResource $stringsXml "app_build_date" (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
    Set-StringResource $stringsXml "app_min_android" (Get-AndroidVersionLabel $MinSdkVersion)
    $stringsXml.Save($StringsPath)

    Update-BuiltinDemoArchive $DemoSourceDirectory $DemoBuilderScript $AssetsDemoArchivePath

    $sdkDir = Find-AndroidSdk
    if ($sdkDir) {
        $localProperties = Join-Path $ProjectDir "local.properties"
        $normalizedSdkDir = $sdkDir.Replace("\", "/")
        Set-Content -LiteralPath $localProperties -Value "sdk.dir=$normalizedSdkDir" -Encoding ASCII
    }

    Write-Step "Checking build tools"
    $javaMajor = Get-JavaMajorVersion
    if ($javaMajor -and $javaMajor -lt 17) {
        Write-Host "PATH Java is version $javaMajor." -ForegroundColor Yellow
        Write-Host "Direct SDK build will try Android Studio's bundled JDK." -ForegroundColor Yellow
    }

    if (-not $sdkDir) {
        throw "Android SDK was not found. Run install-android-sdk.bat or open Android Studio once, then run build-apk.bat again."
    }

    $builtApkPath = Invoke-DirectSdkBuild $ProjectDir $sdkDir
    if (Test-Path -LiteralPath $builtApkPath) {
        $releaseApkPath = Copy-ApkToRelease $builtApkPath $ReleaseDir $AppName
        Write-Host ""
        Write-Host "APK is ready:" -ForegroundColor Green
        Write-Host $releaseApkPath
        Write-Host ""
        Write-Host "Internal build copy:" -ForegroundColor DarkGray
        Write-Host $builtApkPath -ForegroundColor DarkGray
    } else {
        throw "Build finished, but APK was not found at the expected path: $builtApkPath"
    }
} finally {
    [IO.File]::WriteAllBytes($StringsPath, $originalStringsBytes)
}
