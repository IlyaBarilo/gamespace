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
    "operation cancellation" = 'ensureOperationNotCancelled\(\)'
    "WebView termination" = 'boolean onRenderProcessGone\(WebView view, RenderProcessGoneDetail detail\)'
    "manual report without exception" = 'buildRuntimeReport\("MANUAL", null'
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
Write-Host "Diagnostic wiring: $($checks.Count + 2) checks passed. Android UI still requires a device test."
