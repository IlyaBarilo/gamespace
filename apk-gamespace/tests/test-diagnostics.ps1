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
& (Join-Path $JdkBin "javac.exe") -encoding UTF-8 -source 8 -target 8 -classpath $testClasspath -d $outputDirectory (Join-Path $sourceDirectory "CompatibilityReport.java") (Join-Path $sourceDirectory "UpdateJson.java") (Join-Path $PSScriptRoot "CompatibilityReportTest.java")
if ($LASTEXITCODE -ne 0) { throw "GS1 compatibility report compilation failed." }
$gs1Fixtures = Join-Path (Split-Path -Parent $apkRoot) "docs\fixtures\compatibility-report-gs1.json"
& (Join-Path $JdkBin "java.exe") -cp $testClasspath ru.local.gamespace.loader.CompatibilityReportTest $gs1Fixtures
if ($LASTEXITCODE -ne 0) { throw "GS1 compatibility report tests failed." }
& (Join-Path $JdkBin "javac.exe") -encoding UTF-8 -source 8 -target 8 -classpath $testClasspath -d $outputDirectory (Join-Path $sourceDirectory "CompatibilityCheck.java") (Join-Path $PSScriptRoot "CompatibilityCheckTest.java")
if ($LASTEXITCODE -ne 0) { throw "Compatibility observations compilation failed." }
& (Join-Path $JdkBin "java.exe") -cp $testClasspath ru.local.gamespace.loader.CompatibilityCheckTest
if ($LASTEXITCODE -ne 0) { throw "Compatibility observation tests failed." }
& (Join-Path $JdkBin "javac.exe") -encoding UTF-8 -source 8 -target 8 -classpath $testClasspath -d $outputDirectory (Join-Path $sourceDirectory "DemoImportFile.java") (Join-Path $PSScriptRoot "DemoImportFileTest.java")
if ($LASTEXITCODE -ne 0) { throw "Demo import work file compilation failed." }
& (Join-Path $JdkBin "java.exe") -cp $testClasspath ru.local.gamespace.loader.DemoImportFileTest $outputDirectory
if ($LASTEXITCODE -ne 0) { throw "Demo import work file tests failed." }
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

# Wiring checks supplement JVM tests; they do not replace Android device tests.
$activity = Get-Content -LiteralPath (Join-Path $sourceDirectory "MainActivity.java") -Raw -Encoding UTF8
$checks = @{
    "demo available with an installed site" = '\? new String\[\] \{"Быстро обновить из архива", "Полное обновление из архива", "Загрузить встроенный демо-сайт"'
    "demo menu asks before replacing site" = 'else if \("Загрузить встроенный демо-сайт"\.equals\(item\)\)\s*\{\s*confirmInstallBuiltinDemoSite\(\);'
    "demo replacement has cancel and explicit install" = 'private void confirmInstallBuiltinDemoSite\(\)[\s\S]*?\.setNegativeButton\("Отмена", null\)[\s\S]*?\.setPositiveButton\("Установить демо"'
    "demo copy outside cache" = 'DemoImportFile\.prepare\(getNoBackupFilesDir\(\)\)'
    "interrupted demo copy cleanup" = 'DemoImportFile\.cleanupInterrupted\(getNoBackupFilesDir\(\)\)'
    "demo lease acquired before copying" = 'demoImportFile = DemoImportFile\.prepare[\s\S]*?copyAssetToFile\(BUILTIN_DEMO_ASSET_NAME, demoArchive\)'
    "demo copy released after failure or success" = 'finally\s*\{\s*if \(demoImportFile != null\)[\s\S]*?demoImportFile\.close\(\)'
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
    "manual report menu during operations" = 'items = busy \? new String\[\] \{"Создать отчёт о проблеме", "Последняя ошибка", "Отчёт о совместимости"\}'
    "process-scoped journal" = 'private static DiagnosticJournal diagnosticJournal;'
    "previous process marker" = 'diagnosticJournal\.takePending\(\)'
    "WebView errors" = 'class DiagnosticSiteClient extends WebViewClient'
    "virtual HTTPS content origin" = 'LocalSiteRequestHandler localSiteRequestHandler = new LocalSiteRequestHandler\(\)'
    "direct file access disabled" = 'settings\.setAllowFileAccess\(false\)'
    "WebView network restrictions installed" = 'WebViewIsolation\.configure\(settings\)'
    "native update menu" = '"Обновление приложения"\.equals\(item\)'
    "menu tab disabled by default" = 'getBoolean\(PREF_SHOW_MENU_TAB, false\)'
    "menu tab opens app menu directly" = 'createMenuTabButton\(\)[\s\S]*?showAppMenu\(\);'
    "menu tab appears only after toolbar hides" = 'hideTopBar\(\)[\s\S]*?updateMenuTabVisibility\(\);'
    "menu tab setting is persisted" = 'putBoolean\(PREF_SHOW_MENU_TAB, enabled\)\.apply\(\)'
    "temporary toolbar has a back button before settings" = 'backButton = createToolbarIconButton\("←", "Назад"\)[\s\S]*?toolbar\.addView\(backButton[\s\S]*?menuButton = createToolbarIconButton'
    "toolbar back button uses site navigation" = 'backButton\.setOnClickListener[\s\S]*?navigateBackWithinSite\(\);'
    "toolbar back button follows navigation state" = 'backButton\.setEnabled\(canNavigateBackWithinSite\(\)\)'
    "game UI mode is passed in URL" = 'withGameUiMode\(String url\)[\s\S]*?appendQueryParameter\("ui", mode\)'
    "site viewport is centered in the app shell" = 'siteViewportFrame[\s\S]*?new FrameLayout\.LayoutParams\([\s\S]*?Gravity\.CENTER'
    "site viewport is limited to 10 by 16 in landscape" = 'availableWidth > availableHeight[\s\S]*?availableHeight \* 10f / 16f'
    "site WebViews belong to the limited viewport" = 'siteViewportFrame\.addView\(homeWebView[\s\S]*?siteViewportFrame\.addView\(webView'
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
if ($activity -match 'copyAssetToCache|getCacheDir\(') {
    throw "The bundled demo import must not depend on Android's disposable cache."
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
Write-Host "Diagnostic wiring: $($checks.Count + 6) checks passed. Android UI still requires a device test."

# Update UI must remain informational and delegate APK handling to the browser.
$dialogSource = Get-Content -LiteralPath (Join-Path $sourceDirectory 'AppUpdateDialog.java') -Raw -Encoding UTF8
if ($manifest -match 'android.permission.REQUEST_INSTALL_PACKAGES|android.intent.action.INSTALL_PACKAGE|AppUpdateFileProvider') { throw 'APK must not request or expose an in-app installer.' }
if ($dialogSource -match 'ApkUpdateInstaller|ApkUpdateTransfer|ApkUpdateFiles|AndroidApkVerifier') { throw 'Update dialog must not download, verify or install APK files.' }
if ($dialogSource -notmatch 'Intent\.ACTION_VIEW' -or $dialogSource -notmatch 'release\.releaseUrl') { throw 'Update dialog must open the official release page in a browser.' }
$descriptionPosition = $dialogSource.IndexOf('text(latest.description.length()')
$releasePosition = $dialogSource.IndexOf('button("Открыть официальный выпуск"')
if ($descriptionPosition -lt 0 -or $releasePosition -le $descriptionPosition) { throw 'Release description must precede the release-page button.' }
Write-Host 'APK update UI: 4 checks passed. Browser opening still requires a device test.'
