[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('2020', '2024', '2025')]
  [string]$CorelYear
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath), '-CorelYear', $CorelYear)
  exit 0
}

if (Get-Process -Name 'CorelDRW' -ErrorAction SilentlyContinue) { throw 'Feche o CorelDRAW antes de desinstalar o T-Cut.' }
$targets = @{ '2020' = '22'; '2024' = '25'; '2025' = '26' }
$major = $targets[$CorelYear]
$registryPath = "HKLM:\SOFTWARE\T-Cut\$major"
$entry = Get-ItemProperty -Path $registryPath -ErrorAction SilentlyContinue
$appPath = if ($entry.InstallPath) { $entry.InstallPath } else { Join-Path $env:ProgramFiles "T-Cut\CorelDRAW-$CorelYear" }
$addons = if ($entry.CorelAddonsPath) { $entry.CorelAddonsPath } else { Join-Path $env:ProgramFiles "Corel\CorelDRAW Graphics Suite\$major\Programs64\Addons" }
Remove-Item -LiteralPath (Join-Path $addons 'TCutDocker') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $appPath -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path $registryPath -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "T-Cut removido do CorelDRAW $CorelYear." -ForegroundColor Green
