$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogDir = Join-Path $ProjectRoot "logs"
$OutLog = Join-Path $LogDir "claw-task-hub.out.log"
$ErrLog = Join-Path $LogDir "claw-task-hub.err.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

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
  Add-Content -Path $OutLog -Value "[$(Get-Date -Format o)] Claw Task Hub already running."
  exit 0
}

Add-Content -Path $OutLog -Value "[$(Get-Date -Format o)] Starting Claw Task Hub from $ProjectRoot"

Start-Process `
  -FilePath "npm.cmd" `
  -ArgumentList @("run", "dev") `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $OutLog `
  -RedirectStandardError $ErrLog
