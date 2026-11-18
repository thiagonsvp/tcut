$ErrorActionPreference = 'Stop'
$addons = Join-Path $env:ProgramFiles 'Corel\CorelDRAW Graphics Suite\26\Programs64\Addons'
$target = Join-Path $addons 'TCutDocker'
if (-not (Test-Path -LiteralPath $target)) {
  Write-Host 'Painel T-Cut não está instalado.'
  exit 0
}
foreach ($name in @('AppUI.xslt', 'UserUI.xslt', 'Coreldrw.addon', 'TCut.html', 'TCutPanel.dll', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.Wpf.dll', 'WebView2Loader.dll', 'WEBVIEW2-LICENSE.txt', 'project-path.txt')) {
  $file = Join-Path $target $name
  if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
}
if (-not (Get-ChildItem -LiteralPath $target -Force)) { Remove-Item -LiteralPath $target }
Write-Host 'Painel T-Cut removido. Reinicie o CorelDRAW.'
