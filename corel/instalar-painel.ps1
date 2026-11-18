$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Abra o PowerShell como administrador para instalar o painel em Program Files.'
}
if (Get-Process -Name 'CorelDRW' -ErrorAction SilentlyContinue) {
  throw 'Feche o CorelDRAW antes de atualizar o painel T-Cut.'
}
$corelSource = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $corelSource 'docker'
$webviewSource = Join-Path $corelSource 'webview2'
$project = Split-Path -Parent $corelSource
$layoutFiles = @('AppUI.xslt', 'UserUI.xslt', 'Coreldrw.addon')
$runtimeFiles = @('TCutPanel.dll', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.Wpf.dll', 'WebView2Loader.dll', 'WEBVIEW2-LICENSE.txt')
foreach ($name in $layoutFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $source $name))) { throw "Arquivo do painel ausente: $name" }
}
foreach ($name in $runtimeFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $webviewSource $name))) { throw "Arquivo WebView2 ausente: $name" }
}
$addons = Join-Path $env:ProgramFiles 'Corel\CorelDRAW Graphics Suite\26\Programs64\Addons'
if (-not (Test-Path -LiteralPath $addons)) {
  throw "Pasta de add-ons do CorelDRAW 2025 não encontrada: $addons"
}
$target = Join-Path $addons 'TCutDocker'
New-Item -ItemType Directory -Path $target -Force | Out-Null
foreach ($name in $layoutFiles) {
  Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $target $name) -Force
}
foreach ($name in $runtimeFiles) {
  Copy-Item -LiteralPath (Join-Path $webviewSource $name) -Destination (Join-Path $target $name) -Force
}
[IO.File]::WriteAllText((Join-Path $target 'project-path.txt'), $project)
foreach ($name in ($layoutFiles + $runtimeFiles)) {
  $folder = if ($layoutFiles -contains $name) { $source } else { $webviewSource }
  $expected = (Get-FileHash -LiteralPath (Join-Path $folder $name) -Algorithm SHA256).Hash
  $actual = (Get-FileHash -LiteralPath (Join-Path $target $name) -Algorithm SHA256).Hash
  if ($expected -ne $actual) { throw "Cópia incompleta: $name" }
}
Write-Host "Painel T-Cut instalado em $target"
Write-Host 'Reinicie o CorelDRAW e abra Janela > Janelas de encaixe > T-Cut.'
