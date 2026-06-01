<#
.SYNOPSIS
PowerShell-safe wrapper for Claw Task Hub CLI tool calls.

.DESCRIPTION
The hub CLI accepts JSON directly, but raw JSON is fragile in PowerShell when
comments contain quotes, backticks, newlines, or Markdown. This wrapper converts
PowerShell objects or JSON files to the CLI's base64:<json> transport so agents
do not need to hand-escape JSON arguments.

.EXAMPLE
$payload = @{
  issue_id = 'CTH-123'
  body = @'
Accepted: quotes like "this" and Markdown `ticks` are safe here.
'@
  author = 'Codex'
  source = 'local'
}
.\tools\cth-call.ps1 -Tool save_comment -InputObject $payload
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Tool,

  [Parameter(Position = 1)]
  [object]$InputObject,

  [string]$Json,

  [string]$JsonFile
)

$ErrorActionPreference = 'Stop'

if ($PSBoundParameters.ContainsKey('JsonFile')) {
  $payloadJson = Get-Content -LiteralPath $JsonFile -Raw -Encoding UTF8
} elseif ($PSBoundParameters.ContainsKey('Json')) {
  $payloadJson = $Json
} elseif ($PSBoundParameters.ContainsKey('InputObject')) {
  if ($InputObject -is [string]) {
    $payloadJson = $InputObject
  } else {
    $payloadJson = $InputObject | ConvertTo-Json -Depth 30 -Compress
  }
} else {
  $payloadJson = '{}'
}

$null = $payloadJson | ConvertFrom-Json
$bytes = [System.Text.Encoding]::UTF8.GetBytes($payloadJson)
$encoded = [Convert]::ToBase64String($bytes)
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$npm = if ($IsWindows -or $env:OS -eq 'Windows_NT') { 'npm.cmd' } else { 'npm' }

Push-Location $repoRoot
try {
  & $npm run hub -- tools/call $Tool "base64:$encoded"
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
