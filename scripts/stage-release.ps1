[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
if ($pkg.version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw 'Invalid version.' }
$packed = Join-Path $repo 'com.mor4ee.battery.flexplugin'
$expected = @(
    'backend/plugin.cjs', 'config.json', 'manifest.json',
    'native/windows/BatteryHidHelper.exe', 'native/windows/HidSharp.dll', 'native/windows/HidSharp.LICENSE.txt',
    'resources/.gitkeep', 'ui/.gitkeep', 'ui/level.vue'
)

function Get-Sha256Hex([System.IO.Stream]$InputStream) {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return [BitConverter]::ToString($sha256.ComputeHash($InputStream)).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
}

function Get-FileSha256([string]$Path) {
    $inputFile = [System.IO.File]::OpenRead($Path)
    try {
        return Get-Sha256Hex $inputFile
    } finally {
        $inputFile.Dispose()
    }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($packed)
try {
    $files = @($zip.Entries | Where-Object { $_.Name })
    if (Compare-Object ($expected | Sort-Object) ($files.FullName | Sort-Object) -CaseSensitive) {
        throw 'Package is missing a required file or contains an unexpected file.'
    }
    foreach ($file in $files) {
        $stream = $file.Open()
        try {
            $packagedHash = Get-Sha256Hex $stream
            $current = Join-Path (Join-Path $repo 'com.mor4ee.battery.plugin') $file.FullName
            if ($packagedHash -ne (Get-FileSha256 $current)) {
                throw "Stale bundle file: $($file.FullName)"
            }
        } finally {
            $stream.Dispose()
        }
    }
} finally {
    $zip.Dispose()
}

$dir = Join-Path $repo "release/v$($pkg.version)"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$name = 'Battery.win32.x64.flexplugin'
$asset = Join-Path $dir $name
Copy-Item -LiteralPath $packed -Destination $asset -Force
$digest = Get-FileSha256 $asset
"$digest  $name" | Set-Content -LiteralPath (Join-Path $dir 'SHA256SUMS.txt') -Encoding ASCII
Write-Output "Prepared $asset"
