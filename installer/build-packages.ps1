[CmdletBinding()]
param(
  [ValidateSet('2020', '2024', '2025')]
  [string[]]$CorelYear = @('2020', '2024', '2025')
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
$version = [string]$manifest.version
$output = Join-Path $PSScriptRoot 'packages'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$appFiles = @('app.js', 'corel-bridge.js', 'index.html', 'irregular.js', 'letterbox.js', 'letterbox-geometry.js', 'server.js', 'style.css', 'README.md', 'pvc 15mm 2.svg')
$installerFiles = @('instalar-tcut.ps1', 'desinstalar-tcut.ps1')
$webviewFiles = @('build.ps1', 'TCutPanel.cs', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.Wpf.dll', 'WebView2Loader.dll', 'WEBVIEW2-LICENSE.txt')
$dockerFiles = @('AppUI.xslt', 'UserUI.xslt', 'Coreldrw.addon')
$hashes = New-Object System.Collections.Generic.List[string]

foreach ($year in $CorelYear) {
  $temp = Join-Path ([IO.Path]::GetTempPath()) ("t-cut-package-" + [Guid]::NewGuid().ToString('N'))
  $rootName = "T-Cut-CorelDRAW-$year"
  $root = Join-Path $temp $rootName
  try {
    New-Item -ItemType Directory -Path (Join-Path $root 'installer'), (Join-Path $root 'corel\docker'), (Join-Path $root 'corel\webview2') -Force | Out-Null
    foreach ($file in $appFiles) { Copy-Item -LiteralPath (Join-Path $project $file) -Destination (Join-Path $root $file) -Force }
    foreach ($file in $installerFiles) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $root "installer\$file") -Force }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "Instalar-T-Cut-CorelDRAW-$year.ps1") -Destination (Join-Path $root "installer\Instalar-T-Cut-CorelDRAW-$year.ps1") -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "Desinstalar-T-Cut-CorelDRAW-$year.ps1") -Destination (Join-Path $root "installer\Desinstalar-T-Cut-CorelDRAW-$year.ps1") -Force
    foreach ($file in $dockerFiles) { Copy-Item -LiteralPath (Join-Path $project "corel\docker\$file") -Destination (Join-Path $root "corel\docker\$file") -Force }
    foreach ($file in $webviewFiles) { Copy-Item -LiteralPath (Join-Path $project "corel\webview2\$file") -Destination (Join-Path $root "corel\webview2\$file") -Force }
    @(
      'T-CUT - INSTALACAO',
      '',
      "1. Extraia esta pasta em um local permanente.",
      "2. Feche o CorelDRAW $year.",
      '3. Abra o PowerShell como administrador nesta pasta.',
      "4. Execute: Set-ExecutionPolicy Bypass -Scope Process -Force; & '.\installer\Instalar-T-Cut-CorelDRAW-$year.ps1'",
      '',
      'O instalador valida a versao do CorelDRAW e baixa, somente se necessario,',
      'o runtime Node.js oficial e o Microsoft WebView2 oficial. Nenhum executavel',
      'de terceiros esta embutido neste ZIP.',
      '',
      "Para remover: & '.\installer\Desinstalar-T-Cut-CorelDRAW-$year.ps1'"
    ) | Set-Content -LiteralPath (Join-Path $root 'INSTALAR.txt') -Encoding UTF8
    $archive = Join-Path $output "T-Cut-CorelDRAW-$year-Instalador-$version.zip"
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    Compress-Archive -LiteralPath $root -DestinationPath $archive -CompressionLevel Optimal
    $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
    $hashes.Add("$hash *$(Split-Path -Leaf $archive)")
    Write-Host "Pacote CorelDRAW ${year}: $archive"
    Write-Host "SHA256: $hash"
  } finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$hashes | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding ASCII
