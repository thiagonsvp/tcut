param(
  [string]$CorelInteropPath,
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$wpf = Join-Path $framework 'WPF'
$compiler = Join-Path $framework 'csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Compilador .NET Framework não encontrado.' }
if (-not $CorelInteropPath) {
  $CorelInteropPath = Join-Path $env:ProgramFiles 'Corel\CorelDRAW Graphics Suite\26\Programs64\Assemblies\Corel.Interop.VGCore.dll'
}
if (-not (Test-Path -LiteralPath $CorelInteropPath)) { throw "API do CorelDRAW não encontrada: $CorelInteropPath" }
if (-not $OutputPath) { $OutputPath = Join-Path $folder 'TCutPanel.dll' }
$args = @(
  '/nologo', '/target:library', '/platform:x64',
  ('/out:' + $OutputPath),
  ('/reference:' + (Join-Path $wpf 'PresentationFramework.dll')),
  ('/reference:' + (Join-Path $wpf 'PresentationCore.dll')),
  ('/reference:' + (Join-Path $wpf 'WindowsBase.dll')),
  ('/reference:' + (Join-Path $framework 'System.Xaml.dll')),
  ('/reference:' + (Join-Path $framework 'Microsoft.CSharp.dll')),
  ('/reference:' + (Join-Path $folder 'Microsoft.Web.WebView2.Core.dll')),
  ('/reference:' + (Join-Path $folder 'Microsoft.Web.WebView2.Wpf.dll')),
  ('/reference:' + $CorelInteropPath),
  (Join-Path $folder 'TCutPanel.cs')
)
& $compiler @args
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar TCutPanel.dll.' }
Write-Host 'TCutPanel.dll compilado.'
