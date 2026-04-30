param(
  [string]$ProjectId = "",
  [string]$Service = "",
  [string]$Environment = "",
  [string]$BackendApiBase = "https://backend-production-2516.up.railway.app",
  [switch]$SkipDeploy
)

$ErrorActionPreference = "Stop"

function Test-TokenAvailable {
  return -not [string]::IsNullOrWhiteSpace($env:RAILWAY_TOKEN) -or -not [string]::IsNullOrWhiteSpace($env:RAILWAY_API_TOKEN)
}

function Invoke-RouteProbe {
  param(
    [string]$Name,
    [string]$Url
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -Method GET -TimeoutSec 30
    Write-Host "[probe] $Name => $($response.StatusCode)"
    return $response.StatusCode
  }
  catch {
    $statusCode = 0
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }
    Write-Host "[probe] $Name => $statusCode"
    return $statusCode
  }
}

if (-not (Test-TokenAvailable)) {
  throw "RAILWAY_TOKEN or RAILWAY_API_TOKEN is not set."
}

if (-not $SkipDeploy) {
  $upArgs = @("up", "-d", "-c")
  if (-not [string]::IsNullOrWhiteSpace($ProjectId)) { $upArgs += @("--project", $ProjectId) }
  if (-not [string]::IsNullOrWhiteSpace($Service)) { $upArgs += @("--service", $Service) }
  if (-not [string]::IsNullOrWhiteSpace($Environment)) { $upArgs += @("--environment", $Environment) }

  Push-Location (Join-Path $PSScriptRoot "..\backend")
  try {
    Write-Host "[railway] deploy command: railway $($upArgs -join ' ')"
    & railway @upArgs
    if ($LASTEXITCODE -ne 0) { throw "Railway deploy failed." }
  }
  finally {
    Pop-Location
  }
}

$versionCode = Invoke-RouteProbe -Name "version" -Url "$BackendApiBase/api/version"
$watchItemsCode = Invoke-RouteProbe -Name "screener-watch-items" -Url "$BackendApiBase/api/screener/watch-items"

Write-Host "[summary] /api/version status: $versionCode"
Write-Host "[summary] /api/screener/watch-items status: $watchItemsCode"
if ($watchItemsCode -eq 404) {
  Write-Host "[summary] watch-items is still missing in deployed backend."
}
