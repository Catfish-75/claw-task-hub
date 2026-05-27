$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogDir = Join-Path $ProjectRoot "logs"
$SupervisorLog = Join-Path $LogDir "claw-task-hub-supervisor.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Get-ChildItem -Path $LogDir -Filter "claw-task-hub-*.log" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
  Remove-Item -Force -ErrorAction SilentlyContinue

function Test-HttpOk {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Test-ClawTaskHubApi {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:4781/api/health" -TimeoutSec 3
    return $health.ok -eq $true -and $health.mode -eq "local"
  } catch {
    return $false
  }
}

function Test-ClawTaskHubUi {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:5173/" -TimeoutSec 3
    $statusOk = [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300
    return $statusOk -and ($response.Content -match "Claw Task Hub|clawtaskhub|/src/main\.tsx|/assets/")
  } catch {
    return $false
  }
}

$uiReady = Test-ClawTaskHubUi
$apiReady = Test-ClawTaskHubApi

if ($uiReady -and $apiReady) {
  exit 0
}

$RunStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$OutLog = Join-Path $LogDir "claw-task-hub-$RunStamp.out.log"
$ErrLog = Join-Path $LogDir "claw-task-hub-$RunStamp.err.log"

Add-Content -Path $SupervisorLog -Value "[$(Get-Date -Format o)] Starting Claw Task Hub from $ProjectRoot; uiReady=$uiReady apiReady=$apiReady"

$process = Start-Process `
  -FilePath "npm.cmd" `
  -ArgumentList @("run", "dev") `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $OutLog `
  -RedirectStandardError $ErrLog `
  -PassThru

$deadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Seconds 3
  $uiReady = Test-ClawTaskHubUi
  $apiReady = Test-ClawTaskHubApi
  if ($uiReady -and $apiReady) {
    Add-Content -Path $SupervisorLog -Value "[$(Get-Date -Format o)] Claw Task Hub started; pid=$($process.Id); out=$OutLog; err=$ErrLog"
    exit 0
  }
} while ((Get-Date) -lt $deadline -and -not $process.HasExited)

if ($process.HasExited) {
  Add-Content -Path $SupervisorLog -Value "[$(Get-Date -Format o)] Claw Task Hub process exited early; pid=$($process.Id); exit=$($process.ExitCode); out=$OutLog; err=$ErrLog"
  exit 1
}

Add-Content -Path $SupervisorLog -Value "[$(Get-Date -Format o)] Claw Task Hub process started but readiness timed out; pid=$($process.Id); uiReady=$uiReady apiReady=$apiReady; out=$OutLog; err=$ErrLog"
exit 1
