[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$nativeRoot = $PSScriptRoot
$lock = Get-Content -Raw -Encoding utf8 (Join-Path $nativeRoot 'dependencies.json') |
    ConvertFrom-Json
$dependency = $lock.hidSharp
$packageRoot = Join-Path $nativeRoot ".packages\HidSharp.$($dependency.version)\package"
$hidSharpAssembly = Join-Path $packageRoot ($dependency.assembly -replace '/', '\')
$hidSharpLicense = Join-Path $packageRoot 'LICENSE.txt'
$sourcePaths = @(
    (Join-Path $nativeRoot 'BatteryHidHelper\Program.cs'),
    (Join-Path $nativeRoot 'BatteryHidHelper\DualSense.cs'),
    (Join-Path $nativeRoot 'BatteryHidHelper\LamzuParo.cs'),
    (Join-Path $nativeRoot 'BatteryHidHelper\WindowsBluetooth.cs'),
    (Join-Path $nativeRoot 'BatteryHidHelper\SystemBatteryJson.cs'),
    (Join-Path $nativeRoot 'BatteryHidHelper\StandardHid.cs'),
    (Join-Path $nativeRoot 'BatteryHidHelper\KeychronReceiver.cs'),
    (Join-Path $nativeRoot 'BatteryHidHelper\HidOutputQuery.cs'),
    (Join-Path $nativeRoot 'BatteryHidHelper\CommonHidBattery.cs'),
    (Join-Path $nativeRoot 'BatteryHidHelper\VendorHidBattery.cs'),
    (Join-Path $nativeRoot 'BatteryHidHelper\GamepadBattery.cs')
)
$outputRoot = Join-Path $nativeRoot 'bin'
$outputAssembly = Join-Path $outputRoot 'BatteryHidHelper.exe'

if (-not (Test-Path -LiteralPath $hidSharpAssembly)) {
    throw 'Dependencies are missing. Run native\restore-dependencies.ps1 first.'
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
if (Test-Path -LiteralPath $outputAssembly) {
    Remove-Item -LiteralPath $outputAssembly -Force
}

Add-Type `
    -Path $sourcePaths `
    -ReferencedAssemblies $hidSharpAssembly `
    -OutputAssembly $outputAssembly `
    -OutputType ConsoleApplication

Copy-Item -LiteralPath $hidSharpAssembly -Destination (Join-Path $outputRoot 'HidSharp.dll') -Force
Copy-Item -LiteralPath $hidSharpLicense -Destination (Join-Path $outputRoot 'HidSharp.LICENSE.txt') -Force

Write-Output "Built $outputAssembly"
