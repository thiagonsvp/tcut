param(
  [Parameter(Mandatory = $true)][string]$CorelInteropPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $folder 'build.ps1') -CorelInteropPath $CorelInteropPath -OutputPath $OutputPath
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o painel para esta versão do CorelDRAW.' }
