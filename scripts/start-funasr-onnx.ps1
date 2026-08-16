$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $workspace '.runtime'
$pidFile = Join-Path $runtime 'funasr-onnx.pid'
$outLog = Join-Path $runtime 'funasr-onnx.out.log'
$errorLog = Join-Path $runtime 'funasr-onnx.error.log'

$uvCommand = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvCommand) {
  $wingetUv = Join-Path $env:LocalAppData 'Microsoft\WinGet\Links\uv.exe'
  if (Test-Path -LiteralPath $wingetUv) { $uvCommand = Get-Item -LiteralPath $wingetUv }
}
if (-not $uvCommand) { throw 'uv is missing. Install it with: winget install --id astral-sh.uv -e' }
$uv = if ($uvCommand.Source) { $uvCommand.Source } else { $uvCommand.FullName }
New-Item -ItemType Directory -Path $runtime -Force | Out-Null

$listener = Get-NetTCPConnection -LocalPort 10095 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  Set-Content -LiteralPath $pidFile -Value $listener.OwningProcess
  Write-Output "FunASR ONNX is already running. PID: $($listener.OwningProcess)"
  exit 0
}

if (Test-Path -LiteralPath $pidFile) {
  $runningPid = [int](Get-Content -LiteralPath $pidFile)
  if (Get-Process -Id $runningPid -ErrorAction SilentlyContinue) {
    Write-Output "FunASR ONNX is already running. PID: $runningPid"
    exit 0
  }
}

$process = Start-Process -FilePath $uv -ArgumentList @('run','--project','tools','--locked','uvicorn','tools.funasr_onnx_server:app','--host','127.0.0.1','--port','10095') -WorkingDirectory $workspace -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errorLog -PassThru
Start-Sleep -Milliseconds 800
$child = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)" -ErrorAction SilentlyContinue | Select-Object -First 1
$servicePid = if ($child) { $child.ProcessId } else { $process.Id }
Set-Content -LiteralPath $pidFile -Value $servicePid
Write-Output "FunASR ONNX started. PID: $servicePid"
