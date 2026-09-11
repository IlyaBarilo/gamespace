param([string]$JdkBin = "")

$ErrorActionPreference = "Stop"
$apkRoot = Split-Path -Parent $PSScriptRoot
if (-not $JdkBin) {
    if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME "bin\javac.exe"))) {
        $JdkBin = Join-Path $env:JAVA_HOME "bin"
    } elseif (Test-Path -LiteralPath "C:\Program Files\Android\Android Studio\jbr\bin\javac.exe") {
        $JdkBin = "C:\Program Files\Android\Android Studio\jbr\bin"
    } else {
        $JdkBin = Split-Path -Parent (Get-Command javac -ErrorAction Stop).Source
    }
}
$sourceDirectory = Join-Path $apkRoot "android-webview-loader\app\src\main\java\ru\local\gamespace\loader"
$outputDirectory = Join-Path $apkRoot "android-webview-loader\app\build\diagnostics-tests"
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$testClasspath = "$outputDirectory;$(Join-Path $apkRoot 'android-webview-loader\app\libs\*')"
& (Join-Path $JdkBin "javac.exe") -encoding UTF-8 -source 8 -target 8 -classpath $testClasspath -d $outputDirectory (Join-Path $sourceDirectory "ProgressEstimator.java") (Join-Path $PSScriptRoot "ProgressEstimatorTest.java")
if ($LASTEXITCODE -ne 0) { throw "Progress estimator compilation failed." }
& (Join-Path $JdkBin "java.exe") -cp $testClasspath ru.local.gamespace.loader.ProgressEstimatorTest
if ($LASTEXITCODE -ne 0) { throw "Progress estimator tests failed." }
& (Join-Path $JdkBin "javac.exe") -encoding UTF-8 -source 8 -target 8 -classpath $testClasspath -d $outputDirectory (Join-Path $sourceDirectory "ArchiveStatistics.java") (Join-Path $sourceDirectory "ReadAheadSeekableByteChannel.java") (Join-Path $PSScriptRoot "ArchiveStatisticsTest.java")
if ($LASTEXITCODE -ne 0) { throw "Archive statistics compilation failed." }
& (Join-Path $JdkBin "java.exe") -cp $testClasspath ru.local.gamespace.loader.ArchiveStatisticsTest $outputDirectory
if ($LASTEXITCODE -ne 0) { throw "Archive statistics tests failed." }
& (Join-Path $JdkBin "javac.exe") -encoding UTF-8 -source 8 -target 8 -classpath $testClasspath -d $outputDirectory (Join-Path $sourceDirectory "DiagnosticReport.java") (Join-Path $PSScriptRoot "DiagnosticReportTest.java") (Join-Path $PSScriptRoot "ZipFailureTest.java")
if ($LASTEXITCODE -ne 0) { throw "Diagnostic report compilation failed." }
& (Join-Path $JdkBin "java.exe") -cp $testClasspath ru.local.gamespace.loader.DiagnosticReportTest
if ($LASTEXITCODE -ne 0) { throw "Diagnostic report tests failed." }
& (Join-Path $JdkBin "javac.exe") -encoding UTF-8 -source 8 -target 8 -classpath $testClasspath -d $outputDirectory (Join-Path $sourceDirectory "RuntimeEnvironmentHistory.java") (Join-Path $PSScriptRoot "RuntimeEnvironmentHistoryTest.java")
if ($LASTEXITCODE -ne 0) { throw "Runtime environment history compilation failed." }
& (Join-Path $JdkBin "java.exe") -cp $testClasspath ru.local.gamespace.loader.RuntimeEnvironmentHistoryTest
if ($LASTEXITCODE -ne 0) { throw "Runtime environment history tests failed." }
& (Join-Path $JdkBin "javac.exe") -encoding UTF-8 -source 8 -target 8 -classpath $testClasspath -d $outputDirectory (Join-Path $sourceDirectory "DiagnosticJournal.java") (Join-Path $PSScriptRoot "DiagnosticJournalTest.java")
if ($LASTEXITCODE -ne 0) { throw "Diagnostic journal compilation failed." }
& (Join-Path $JdkBin "java.exe") -cp $testClasspath ru.local.gamespace.loader.DiagnosticJournalTest
if ($LASTEXITCODE -ne 0) { throw "Diagnostic journal tests failed." }
& (Join-Path $JdkBin "javac.exe") -encoding UTF-8 -source 8 -target 8 -classpath $testClasspath -d $outputDirectory (Join-Path $sourceDirectory "SiteTransactionManager.java") (Join-Path $PSScriptRoot "SiteTransactionManagerTest.java")
if ($LASTEXITCODE -ne 0) { throw "Site transaction manager compilation failed." }
& (Join-Path $JdkBin "java.exe") -cp $testClasspath ru.local.gamespace.loader.SiteTransactionManagerTest $outputDirectory
if ($LASTEXITCODE -ne 0) { throw "Site transaction manager tests failed." }
& (Join-Path $JdkBin "java.exe") -cp $testClasspath ru.local.gamespace.loader.ZipFailureTest (Join-Path $sourceDirectory "MainActivity.java") $outputDirectory
if ($LASTEXITCODE -ne 0) { throw "ZIP extraction diagnostic tests failed." }

$updateSources = @("UpdateJson.java", "AppUpdateCatalog.java", "AppUpdateClient.java", "AppUpdateRepository.java", "LocalWebPolicy.java") | ForEach-Object { Join-Path $sourceDirectory $_ }
& (Join-Path $JdkBin "javac.exe") -encoding UTF-8 -source 8 -target 8 -classpath $testClasspath -d $outputDirectory $updateSources (Join-Path $PSScriptRoot "AppUpdateTest.java")
if ($LASTEXITCODE -ne 0) { throw "APK update client compilation failed." }
$updateFixture = Join-Path $outputDirectory "producer-updates.json"
& node (Join-Path $PSScriptRoot "write-update-client-fixture.mjs") $updateFixture
if ($LASTEXITCODE -ne 0) { throw "APK update producer fixture failed." }
& (Join-Path $JdkBin "java.exe") -cp $testClasspath ru.local.gamespace.loader.AppUpdateTest $updateFixture
if ($LASTEXITCODE -ne 0) { throw "APK update client tests failed." }

$downloadSources = @("ApkUpdateTransfer.java", "ApkUpdateFiles.java", "ApkUpdateIdentity.java") | ForEach-Object { Join-Path $sourceDirectory $_ }
& (Join-Path $JdkBin "javac.exe") -encoding UTF-8 -source 8 -target 8 -classpath $testClasspath -d $outputDirectory $downloadSources (Join-Path $PSScriptRoot "ApkUpdateDownloadTest.java")
if ($LASTEXITCODE -ne 0) { throw "APK download tests compilation failed." }
& (Join-Path $JdkBin "java.exe") -cp $testClasspath ru.local.gamespace.loader.ApkUpdateDownloadTest $outputDirectory
if ($LASTEXITCODE -ne 0) { throw "APK download tests failed." }

# Wiring checks supplement JVM tests; they do not replace Android device tests.
$activity = Get-Content -LiteralPath (Join-Path $sourceDirectory "MainActivity.java") -Raw -Encoding UTF8
$checks = @{
    "ZIP uses try-with-resources" = 'try \(ZipInputStream zip ='
    "7z uses try-with-resources" = 'try \(SevenZFile sevenZ ='
    "separate saved report" = 'getSharedPreferences\(DIAGNOSTIC_PREFS, MODE_PRIVATE\)\.edit\(\)\.putString\(PREF_LAST_ERROR_REPORT, report\)\.commit\(\)'
    "copy report" = 'ClipData\.newPlainText\("Диагностика GameSpace APK", report\)'
    "share text only" = 'send\.putExtra\(Intent\.EXTRA_TEXT, report\)'
    "latest error menu" = '"Последняя ошибка"\.equals\(item\)'
    "runtime environment menu" = 'runtimeEnvironmentItem = "Среда запуска: " \+ getWebViewEnvironmentText\(false\)'
    "runtime environment report" = 'appendDiagnosticLine\(details, "Среда запуска", getWebViewEnvironmentText\(true\)\)'
    "runtime environment error history" = 'История среды запуска \(новые версии сверху\)'
    "archive opening stage" = 'context\.setStage\("ARCHIVE-OPEN"'
    "metadata stage" = 'context\.setStage\("ARCHIVE-METADATA"'
    "missing index stage" = 'context\.setStage\("INDEX-CHECK"'
    "cleanup exception retained" = 'DiagnosticReport\.technicalDetails\(cleanupError\)'
    "manual report menu during operations" = 'items = busy \? new String\[\] \{"Создать отчёт о проблеме", "Последняя ошибка"\}'
    "process-scoped journal" = 'private static DiagnosticJournal diagnosticJournal;'
    "previous process marker" = 'diagnosticJournal\.takePending\(\)'
    "WebView errors" = 'class DiagnosticSiteClient extends WebViewClient'
    "virtual HTTPS content origin" = 'LocalSiteRequestHandler localSiteRequestHandler = new LocalSiteRequestHandler\(\)'
    "direct file access disabled" = 'settings\.setAllowFileAccess\(false\)'
    "WebView network restrictions installed" = 'WebViewIsolation\.configure\(settings\)'
    "native update menu" = '"Обновление приложения"\.equals\(item\)'
    "operation cancellation" = 'ensureOperationNotCancelled\(\)'
    "WebView termination" = 'boolean onRenderProcessGone\(WebView view, RenderProcessGoneDetail detail\)'
    "manual report without exception" = 'buildRuntimeReport\("MANUAL", null'
    "API 33 back callback" = 'new android\.window\.OnBackInvokedCallback\(\)'
    "API 33 guarded registration" = 'Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.TIRAMISU'
    "legacy back fallback" = 'public void onBackPressed\(\)'
}
foreach ($entry in $checks.GetEnumerator()) {
    if ($activity -notmatch $entry.Value) { throw "Missing diagnostic wiring: $($entry.Key)" }
}
if ($activity -match 'finally\s*\{\s*context\.stage\s*=') {
    throw "Resource cleanup must not overwrite the original failure stage."
}
if ($activity -match 'Build\.SERIAL|Build\.getSerial|ANDROID_ID') {
    throw "Diagnostic reports must not collect unique device identifiers."
}
if ($activity -match 'addJavascriptInterface\(') {
    throw "Imported pages must not receive a native JavaScript bridge."
}
$manifest = Get-Content -LiteralPath (Join-Path $apkRoot "android-webview-loader\app\src\main\AndroidManifest.xml") -Raw -Encoding UTF8
if ($manifest -notmatch 'android:enableOnBackInvokedCallback="true"') {
    throw "Predictive back must be enabled in AndroidManifest.xml."
}
$appGradle = Get-Content -LiteralPath (Join-Path $apkRoot "android-webview-loader\app\build.gradle") -Raw -Encoding UTF8
if ($appGradle -notmatch 'minSdk\s+23') {
    throw "Back navigation changes must preserve Android 6 / minSdk 23."
}
Write-Host "Diagnostic wiring: $($checks.Count + 5) checks passed. Android UI still requires a device test."

# Packaging/UI guards supplement the executable transfer tests, not device installation tests.
[xml]$updateManifest = $manifest
$androidNamespace = 'http://schemas.android.com/apk/res/android'
$updateProviders = @($updateManifest.manifest.application.provider | Where-Object { $_.GetAttribute('name', $androidNamespace) -eq '.AppUpdateFileProvider' })
if ($updateProviders.Count -ne 1 -or $updateProviders[0].GetAttribute('exported', $androidNamespace) -ne 'false' -or $updateProviders[0].GetAttribute('grantUriPermissions', $androidNamespace) -ne 'true') {
    throw 'APK provider must be unique, private and use temporary URI grants.'
}
$installSource = Get-Content -LiteralPath (Join-Path $sourceDirectory 'ApkUpdateInstaller.java') -Raw -Encoding UTF8
$providerSource = Get-Content -LiteralPath (Join-Path $sourceDirectory 'AppUpdateFileProvider.java') -Raw -Encoding UTF8
$dialogSource = Get-Content -LiteralPath (Join-Path $sourceDirectory 'AppUpdateDialog.java') -Raw -Encoding UTF8
if ($manifest -notmatch 'android.permission.REQUEST_INSTALL_PACKAGES') { throw 'Missing installer permission.' }
if ($installSource -notmatch 'FLAG_GRANT_READ_URI_PERMISSION' -or $installSource -match 'FLAG_GRANT_WRITE_URI_PERMISSION|Uri\.fromFile') { throw 'Installer must receive only a content URI read grant.' }
if ($installSource -notmatch 'FLAG_SYSTEM' -or $installSource -notmatch 'setComponent\(') { throw 'Only an explicit system installer may receive the APK.' }
if ($providerSource -notmatch 'MODE_READ_ONLY' -or $providerSource -notmatch '!"r"\.equals\(mode\)') { throw 'APK provider must reject write access.' }
if ($dialogSource -notmatch 'resumed && dialog != null && dialog\.isShowing\(\) && !site\.isBusy\(\)') { throw 'Installing in background or during site operations is forbidden.' }
if ($dialogSource -notmatch 'files\.verifyReady\(release, token\)' -or $dialogSource -notmatch 'installed\.code >= target') { throw 'APK must be reverified and installation observed from actual installed version.' }
if ($activity -notmatch 'requestCode == ApkUpdateInstaller.REQUEST_SETTINGS' -or $activity -notmatch 'busy \|\| appUpdateBlocksSite\(\)') { throw 'Installer results and site-operation guards must be wired.' }
$descriptionPosition = $dialogSource.IndexOf('text(latest.description.length()')
$installPosition = $dialogSource.IndexOf('button("Установить"')
if ($descriptionPosition -lt 0 -or $installPosition -le $descriptionPosition) { throw 'Release description must precede the installation button.' }
Write-Host 'APK updater wiring: 9 checks passed. Actual Android permission and installer UI are not emulated.'
