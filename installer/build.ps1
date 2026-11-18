param(
  [string]$NodePath,
  [string]$InnoCompiler
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
$version = [string]$manifest.version

if (-not $NodePath) {
  $candidate = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path -LiteralPath $candidate) { $NodePath = $candidate }
  else {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) { $NodePath = $command.Source }
  }
}
if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath)) {
  throw 'node.exe não encontrado. Informe -NodePath com o caminho do Node.js v24.18.0 x64.'
}
$nodeVersion = (& $NodePath --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne 'v24.18.0') {
  throw "O pacote inclui a licença do Node.js v24.18.0; encontrado: $nodeVersion."
}

if (-not $InnoCompiler) {
  $candidate = Join-Path $PSScriptRoot 'tools\inno\ISCC.exe'
  if (Test-Path -LiteralPath $candidate) { $InnoCompiler = $candidate }
  else {
    $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($command) { $InnoCompiler = $command.Source }
  }
}
if (-not $InnoCompiler -or -not (Test-Path -LiteralPath $InnoCompiler)) {
  throw 'ISCC.exe não encontrado. Instale o Inno Setup 7 ou informe -InnoCompiler.'
}

$bootstrapper = Join-Path $PSScriptRoot 'third-party\MicrosoftEdgeWebview2Setup.exe'
if (-not (Test-Path -LiteralPath $bootstrapper)) {
  Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrapper
}
$signature = Get-AuthenticodeSignature -LiteralPath $bootstrapper
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Microsoft Corporation*') {
  throw 'O instalador do WebView2 não tem assinatura válida da Microsoft.'
}

& (Join-Path $project 'corel\webview2\build.ps1')
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Falha ao compilar o painel.' }

foreach ($test in @('test-nesting.js', 'test-irregular.js', 'test-export.js', 'test-dxf.js', 'test-letterbox.js', 'test-corel-bridge.js', 'test-corel-panel.js')) {
  & $NodePath (Join-Path $project $test)
  if ($LASTEXITCODE -ne 0) { throw "Teste falhou: $test" }
}

$script = Join-Path $PSScriptRoot 'TCut.iss'
& $InnoCompiler ("--define=NodeBinary=$NodePath") ("--define=AppVersion=$version") $script
if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar o instalador.' }

$output = Join-Path $PSScriptRoot ("output\T-Cut-Setup-$version.exe")
if (-not (Test-Path -LiteralPath $output)) { throw "Instalador não encontrado: $output" }
$file = Get-Item -LiteralPath $output
$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash
$distribution = Join-Path $PSScriptRoot ("T-Cut-Setup-$version.exe")
Copy-Item -LiteralPath $output -Destination $distribution -Force
if ((Get-FileHash -LiteralPath $distribution -Algorithm SHA256).Hash -ne $hash) {
  throw 'A cópia do instalador para distribuição não confere com o build.'
}
Write-Host "Instalador pronto: $distribution"
Write-Host "Tamanho: $([Math]::Round($file.Length / 1MB, 1)) MB"
Write-Host "SHA256: $hash"
