[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('2020', '2024', '2025')]
  [string]$CorelYear,
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot
)

$ErrorActionPreference = 'Stop'

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-ElevatedSelf {
  param([string]$Year, [string]$Root)
  $arguments = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath),
    '-CorelYear', $Year, '-SourceRoot', ('"{0}"' -f $Root)
  )
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments
}

function Test-WebView2Runtime {
  $key = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  $wowKey = 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  foreach ($path in @("HKLM:\$key", "HKLM:\$wowKey", "HKCU:\$key")) {
    $entry = Get-ItemProperty -Path $path -Name pv -ErrorAction SilentlyContinue
    if ($entry -and $entry.pv -and $entry.pv -ne '0.0.0.0') { return $true }
  }
  return $false
}

function Install-WebView2Runtime {
  if (Test-WebView2Runtime) { return }

  $setup = Join-Path ([IO.Path]::GetTempPath()) 'MicrosoftEdgeWebView2Setup.exe'
  Write-Host 'Baixando o Microsoft Edge WebView2 Runtime oficial...'
  Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $setup
  $signature = Get-AuthenticodeSignature -LiteralPath $setup
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Microsoft Corporation*') {
    throw 'O instalador baixado do WebView2 nao possui assinatura valida da Microsoft.'
  }
  $process = Start-Process -FilePath $setup -ArgumentList '/silent', '/install' -Wait -PassThru
  Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue
  if ($process.ExitCode -ne 0 -and -not (Test-WebView2Runtime)) {
    throw "Falha ao instalar o Microsoft WebView2 Runtime (codigo $($process.ExitCode))."
  }
}

function Install-PrivateNodeRuntime {
  param([string]$Destination)

  $node = Join-Path $Destination 'node.exe'
  if (Test-Path -LiteralPath $node) {
    $version = (& $node --version 2>$null).Trim()
    $signature = Get-AuthenticodeSignature -LiteralPath $node
    if ($version -eq 'v24.18.0' -and $signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -like '*OpenJS Foundation*') {
      return
    }
  }

  $version = 'v24.18.0'
  $archiveName = "node-$version-win-x64.zip"
  $baseUrl = "https://nodejs.org/dist/$version"
  $temp = Join-Path ([IO.Path]::GetTempPath()) ("t-cut-node-" + [Guid]::NewGuid().ToString('N'))
  $archive = Join-Path $temp $archiveName
  $hashList = Join-Path $temp 'SHASUMS256.txt'
  New-Item -ItemType Directory -Path $temp -Force | Out-Null
  try {
    Write-Host 'Baixando o runtime do Node.js oficial...'
    Invoke-WebRequest -Uri "$baseUrl/SHASUMS256.txt" -OutFile $hashList
    Invoke-WebRequest -Uri "$baseUrl/$archiveName" -OutFile $archive
    $expected = ((Get-Content -LiteralPath $hashList | Where-Object { $_ -match ("\s{0}$" -f [regex]::Escape($archiveName)) } | Select-Object -First 1) -split '\s+')[0]
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if (-not $expected -or $actual -ne $expected.ToLowerInvariant()) { throw 'A verificacao SHA-256 do Node.js falhou.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $temp -Force
    $extracted = Join-Path $temp ("node-$version-win-x64")
    $candidate = Join-Path $extracted 'node.exe'
    $signature = Get-AuthenticodeSignature -LiteralPath $candidate
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*OpenJS Foundation*') {
      throw 'O node.exe baixado nao possui assinatura valida da OpenJS Foundation.'
    }
    Remove-Item -LiteralPath $Destination -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Copy-Item -Path (Join-Path $extracted '*') -Destination $Destination -Recurse -Force
  } finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Administrator)) {
  Write-Host 'Solicitando permissao de administrador para instalar o painel...'
  Invoke-ElevatedSelf -Year $CorelYear -Root $SourceRoot
  exit 0
}

$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot 'app.js'))) { throw 'Pasta do pacote T-Cut invalida.' }

$targets = @{ '2020' = '22'; '2024' = '25'; '2025' = '26' }
$major = $targets[$CorelYear]
$programs = Join-Path $env:ProgramFiles "Corel\CorelDRAW Graphics Suite\$major\Programs64"
$addons = Join-Path $programs 'Addons'
$interop = Join-Path $programs 'Assemblies\Corel.Interop.VGCore.dll'
$corelExe = Join-Path $programs 'CorelDRW.exe'

if (-not (Test-Path -LiteralPath $addons) -or -not (Test-Path -LiteralPath $interop) -or -not (Test-Path -LiteralPath $corelExe)) {
  throw "CorelDRAW $CorelYear de 64 bits nao foi encontrado no caminho esperado: $programs"
}
$corelVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($corelExe).FileMajorPart
if ($corelVersion -ne [int]$major) { throw "O instalador para CorelDRAW $CorelYear encontrou uma versao incompativel ($corelVersion)." }
if (Get-Process -Name 'CorelDRW' -ErrorAction SilentlyContinue) { throw 'Feche o CorelDRAW antes de instalar ou atualizar o T-Cut.' }

$appPath = Join-Path $env:ProgramFiles "T-Cut\CorelDRAW-$CorelYear"
$runtimePath = Join-Path $appPath 'runtime'
$dockerPath = Join-Path $addons 'TCutDocker'

Write-Host "Instalando T-Cut para CorelDRAW $CorelYear..."
New-Item -ItemType Directory -Path $appPath, $dockerPath -Force | Out-Null
$appFiles = @('app.js', 'corel-bridge.js', 'index.html', 'irregular.js', 'letterbox.js', 'letterbox-geometry.js', 'server.js', 'style.css', 'README.md', 'pvc 15mm 2.svg')
foreach ($name in $appFiles) {
  Copy-Item -LiteralPath (Join-Path $SourceRoot $name) -Destination (Join-Path $appPath $name) -Force
}

Install-PrivateNodeRuntime -Destination $runtimePath
Install-WebView2Runtime

$webviewSource = Join-Path $SourceRoot 'corel\webview2'
$dockerSource = Join-Path $SourceRoot 'corel\docker'
foreach ($name in @('AppUI.xslt', 'UserUI.xslt', 'Coreldrw.addon')) {
  Copy-Item -LiteralPath (Join-Path $dockerSource $name) -Destination (Join-Path $dockerPath $name) -Force
}
foreach ($name in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.Wpf.dll', 'WebView2Loader.dll', 'WEBVIEW2-LICENSE.txt')) {
  Copy-Item -LiteralPath (Join-Path $webviewSource $name) -Destination (Join-Path $dockerPath $name) -Force
}

& (Join-Path $webviewSource 'build.ps1') -CorelInteropPath $interop -OutputPath (Join-Path $dockerPath 'TCutPanel.dll')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o painel T-Cut.' }

$registryPath = "HKLM:\SOFTWARE\T-Cut\$major"
New-Item -Path $registryPath -Force | Out-Null
New-ItemProperty -Path $registryPath -Name InstallPath -Value $appPath -PropertyType String -Force | Out-Null
New-ItemProperty -Path $registryPath -Name CorelAddonsPath -Value $addons -PropertyType String -Force | Out-Null

Write-Host ''
Write-Host 'Instalacao concluida. Abra o CorelDRAW e use Janela > Janelas de encaixe > T-Cut.' -ForegroundColor Green
