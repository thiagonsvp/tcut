$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $env:APPDATA 'Corel\CorelDRAW Graphics Suite 2025\Draw\Scripts\T-Cut'
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'T-Cut - Enviar selecao.js') -Destination $target -Force
Copy-Item -LiteralPath (Join-Path $source 'T-Cut - Importar resultado.js') -Destination $target -Force
Write-Host "Scripts instalados em $target"
Write-Host 'Reabra a janela Scripts no CorelDRAW e execute os comandos em T-Cut.'
