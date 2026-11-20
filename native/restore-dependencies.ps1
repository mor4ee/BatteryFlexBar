[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$nativeRoot = $PSScriptRoot
$lock = Get-Content -Raw -Encoding utf8 (Join-Path $nativeRoot 'dependencies.json') |
    ConvertFrom-Json
$dependency = $lock.hidSharp
$packageRoot = Join-Path $nativeRoot ".packages\HidSharp.$($dependency.version)"
$packageFile = Join-Path $packageRoot "HidSharp.$($dependency.version).nupkg"
$extractRoot = Join-Path $packageRoot 'package'
$assemblyPath = Join-Path $extractRoot ($dependency.assembly -replace '/', '\')

if (Test-Path -LiteralPath $assemblyPath) {
    Write-Output "HidSharp $($dependency.version) is already restored."
    exit 0
}

New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $dependency.url -TimeoutSec 45 -OutFile $packageFile
}

$stream = [System.IO.File]::OpenRead($packageFile)
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
    $actualHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '')
} finally {
    $sha.Dispose()
    $stream.Dispose()
}
if ($actualHash -ne $dependency.sha256) {
    Remove-Item -LiteralPath $packageFile -Force
    throw "HidSharp package hash mismatch. Expected $($dependency.sha256), got $actualHash."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($packageFile, $extractRoot)

if (-not (Test-Path -LiteralPath $assemblyPath)) {
    throw "Restored package does not contain $($dependency.assembly)."
}

Write-Output "Restored HidSharp $($dependency.version)."
