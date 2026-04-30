param(
  [string]$Repo = "jhonkim91/retirement-portfolio",
  [string]$BaseUrl = "https://retirement-portfolio-omega.vercel.app",
  [string]$Username = $env:E2E_PROD_USERNAME,
  [string]$Password = $env:E2E_PROD_PASSWORD,
  [switch]$RunWorkflow
)

$ErrorActionPreference = "Stop"

function Get-GhExecutable {
  $ghCmd = Get-Command gh -ErrorAction SilentlyContinue
  if ($ghCmd) {
    return $ghCmd.Source
  }

  $fallback = "C:\Users\JKKIM\tools\gh-cli\bin\gh.exe"
  if (Test-Path $fallback) {
    return $fallback
  }

  throw "GitHub CLI not found. Install gh or place it at $fallback"
}

if ([string]::IsNullOrWhiteSpace($env:GH_TOKEN)) {
  throw "GH_TOKEN is not set. Export GH_TOKEN with repo/admin rights first."
}

if ([string]::IsNullOrWhiteSpace($Username) -or [string]::IsNullOrWhiteSpace($Password)) {
  throw "E2E credentials are missing. Set E2E_PROD_USERNAME and E2E_PROD_PASSWORD (or pass -Username/-Password)."
}

$ghExe = Get-GhExecutable

Write-Host "[prod-smoke] using gh: $ghExe"
Write-Host "[prod-smoke] repo: $Repo"

& $ghExe secret set E2E_PROD_BASE_URL --repo $Repo --body $BaseUrl
if ($LASTEXITCODE -ne 0) { throw "Failed to set E2E_PROD_BASE_URL" }

& $ghExe secret set E2E_PROD_USERNAME --repo $Repo --body $Username
if ($LASTEXITCODE -ne 0) { throw "Failed to set E2E_PROD_USERNAME" }

& $ghExe secret set E2E_PROD_PASSWORD --repo $Repo --body $Password
if ($LASTEXITCODE -ne 0) { throw "Failed to set E2E_PROD_PASSWORD" }

Write-Host "[prod-smoke] secrets updated:"
& $ghExe secret list --repo $Repo
if ($LASTEXITCODE -ne 0) { throw "Failed to list secrets" }

if ($RunWorkflow) {
  Write-Host "[prod-smoke] triggering workflow: Prod Smoke"
  & $ghExe workflow run "Prod Smoke" --repo $Repo
  if ($LASTEXITCODE -ne 0) { throw "Failed to trigger workflow" }
}

Write-Host "[prod-smoke] done."
