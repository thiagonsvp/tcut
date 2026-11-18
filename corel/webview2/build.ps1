$ErrorActionPreference = 'Stop'
$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$wpf = Join-Path $framework 'WPF'
$compiler = Join-Path $framework 'csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Compilador .NET Framework não encontrado.' }
$args = @(
  '/nologo', '/target:library', '/platform:x64',
  ('/out:' + (Join-Path $folder 'TCutPanel.dll')),
  ('/reference:' + (Join-Path $wpf 'PresentationFramework.dll')),
  ('/reference:' + (Join-Path $wpf 'PresentationCore.dll')),
  ('/reference:' + (Join-Path $wpf 'WindowsBase.dll')),
  ('/reference:' + (Join-Path $framework 'System.Xaml.dll')),
  ('/reference:' + (Join-Path $framework 'Microsoft.CSharp.dll')),
  ('/reference:' + (Join-Path $folder 'Microsoft.Web.WebView2.Core.dll')),
  ('/reference:' + (Join-Path $folder 'Microsoft.Web.WebView2.Wpf.dll')),
  (Join-Path $folder 'TCutPanel.cs')
)
& $compiler @args
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar TCutPanel.dll.' }
Write-Host 'TCutPanel.dll compilado.'
