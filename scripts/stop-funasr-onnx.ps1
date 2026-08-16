$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $workspace '.runtime\funasr-onnx.pid'
$listener = Get-NetTCPConnection -LocalPort 10095 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $listener) {
  Write-Output 'FunASR ONNX is not running.'
  exit 0
}

Stop-Process -Id $listener.OwningProcess -Force
if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
Write-Output "FunASR ONNX stopped. PID: $($listener.OwningProcess)"
