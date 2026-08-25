param(
    [string]$SourceDirectory = "",
    [Parameter(Mandatory = $true)]
    [string]$OutputArchive
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if (-not $SourceDirectory) {
    $SourceDirectory = Join-Path $PSScriptRoot "..\demo"
}

$sourcePath = (Resolve-Path -LiteralPath $SourceDirectory).Path
if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
    throw "Demo source directory was not found: $SourceDirectory"
}

$outputPath = [IO.Path]::GetFullPath($OutputArchive)
$sourceBoundary = $sourcePath.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
if ($outputPath.StartsWith($sourceBoundary, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The generated demo archive must be outside the demo source directory: $outputPath"
}

$sevenZip = $null
if ($env:GAMESPACE_7Z -and (Test-Path -LiteralPath $env:GAMESPACE_7Z -PathType Leaf)) {
    $sevenZip = (Resolve-Path -LiteralPath $env:GAMESPACE_7Z).Path
}
if (-not $sevenZip) {
    foreach ($name in @("7zz", "7z", "7za")) {
        $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue
        if ($command) {
            $sevenZip = $command.Source
            break
        }
    }
}
if (-not $sevenZip -and $env:ProgramFiles) {
    $candidate = Join-Path $env:ProgramFiles "7-Zip\7z.exe"
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        $sevenZip = $candidate
    }
}
if (-not $sevenZip) {
    throw "7-Zip was not found. Install 7-Zip or set GAMESPACE_7Z to its executable."
}

$names = @(Get-ChildItem -LiteralPath $sourcePath -Force | ForEach-Object { $_.Name })
if ($names.Count -eq 0) {
    throw "Demo source directory is empty: $sourcePath"
}
[Array]::Sort($names, [StringComparer]::Ordinal)

$outputDirectory = Split-Path -Parent $outputPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
if (Test-Path -LiteralPath $outputPath) {
    Remove-Item -LiteralPath $outputPath -Force
}

$arguments = @(
    "a",
    "-t7z",
    "-mx=9",
    "-m0=lzma2",
    "-mmt=off",
    "-mtm=off",
    "-mta=off",
    "-mtc=off",
    "-sccUTF-8",
    "-bb1",
    $outputPath
)
$arguments += @($names | ForEach-Object { "./$_" })

Push-Location $sourcePath
try {
    & $sevenZip @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "7-Zip failed to create demo archive (exit code $LASTEXITCODE)."
    }
    & $sevenZip "t" "-sccUTF-8" $outputPath
    if ($LASTEXITCODE -ne 0) {
        throw "Generated demo archive failed integrity test (exit code $LASTEXITCODE)."
    }
} finally {
    Pop-Location
}

$archive = Get-Item -LiteralPath $outputPath
Write-Host "Created demo archive: $($archive.FullName)"
Write-Host "Files and directories at archive root: $($names.Count)"
Write-Host "Size: $($archive.Length) bytes"
