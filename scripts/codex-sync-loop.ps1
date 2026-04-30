param(
  [int]$IntervalMinutes = 15,
  [string]$Branch = "codex-handoff",
  [string]$Remote = "origin"
)

$ErrorActionPreference = "Continue"

$syncScript = Join-Path $PSScriptRoot "codex-sync.ps1"
$sleepSeconds = [Math]::Max(60, $IntervalMinutes * 60)

while ($true) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Mode sync -Branch $Branch -Remote $Remote
  Start-Sleep -Seconds $sleepSeconds
}
