param(
  [ValidateSet("sync", "save", "resume", "status", "install-task", "uninstall-task", "install-startup", "uninstall-startup")]
  [string]$Mode = "sync",
  [string]$Branch = "codex-handoff",
  [string]$Remote = "origin",
  [int]$IntervalMinutes = 15,
  [string]$TaskName = "RetirementPortfolioCodexAutoSync",
  [string]$Message = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogPath = Join-Path $RepoRoot ".codex-sync.log"

function Write-Log {
  param([string]$Text)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Text
  Write-Host $line
  Add-Content -Path $LogPath -Value $line -Encoding utf8
}

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs)
  Write-Log ("git {0}" -f ($GitArgs -join " "))
  & git @GitArgs
  if ($LASTEXITCODE -ne 0) {
    throw ("git {0} failed with exit code {1}" -f ($GitArgs -join " "), $LASTEXITCODE)
  }
}

function Get-CurrentBranch {
  return ((& git branch --show-current) -join "").Trim()
}

function Test-LocalBranch {
  param([string]$Name)
  $result = ((& git branch --list $Name) -join "").Trim()
  return $result.Length -gt 0
}

function Test-RemoteBranch {
  param([string]$Name)
  & git ls-remote --exit-code --heads $Remote $Name *> $null
  return $LASTEXITCODE -eq 0
}

function Ensure-Repository {
  Set-Location $RepoRoot
  & git rev-parse --is-inside-work-tree *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "This script must run inside a Git repository."
  }
}

function Ensure-HandoffBranch {
  Invoke-Git fetch $Remote --prune
  $remoteExists = Test-RemoteBranch $Branch
  $current = Get-CurrentBranch

  if ($current -ne $Branch) {
    if (Test-LocalBranch $Branch) {
      Invoke-Git checkout $Branch
    }
    elseif ($remoteExists) {
      Invoke-Git checkout -b $Branch "$Remote/$Branch"
    }
    else {
      Invoke-Git checkout -b $Branch
    }
  }

  if ($remoteExists) {
    & git rev-parse --abbrev-ref --symbolic-full-name "@{u}" *> $null
    if ($LASTEXITCODE -ne 0) {
      Invoke-Git branch "--set-upstream-to=$Remote/$Branch" $Branch
    }
  }

  return $remoteExists
}

function Pull-HandoffBranch {
  param([bool]$RemoteExists)
  if ($RemoteExists) {
    Invoke-Git pull --rebase --autostash $Remote $Branch
  }
  else {
    Write-Log "Remote branch '$Branch' does not exist yet; skipping pull."
  }
}

function Push-HandoffBranch {
  if (Test-RemoteBranch $Branch) {
    Invoke-Git push $Remote $Branch
  }
  else {
    Invoke-Git push -u $Remote $Branch
  }
}

function Save-HandoffBranch {
  Invoke-Git add -A
  $pending = (& git status --porcelain)

  if ($pending) {
    if ([string]::IsNullOrWhiteSpace($Message)) {
      $commitMessage = "WIP: codex handoff $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    }
    else {
      $commitMessage = $Message
    }

    Invoke-Git commit -m $commitMessage
  }
  else {
    Write-Log "No local changes to commit."
  }

  try {
    Push-HandoffBranch
  }
  catch {
    Write-Log "Push failed once; rebasing from remote and retrying."
    Invoke-Git pull --rebase --autostash $Remote $Branch
    Push-HandoffBranch
  }
}

function Show-Status {
  Write-Log "Repository: $RepoRoot"
  Write-Log "Branch: $(Get-CurrentBranch)"
  Invoke-Git status --short --branch
}

function Install-SyncTask {
  $scriptPath = Join-Path $PSScriptRoot "codex-sync.ps1"
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Mode sync -Branch `"$Branch`" -Remote `"$Remote`""
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $RepoRoot
  $logonTrigger = New-ScheduledTaskTrigger -AtLogOn
  $repeatTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

  try {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($logonTrigger, $repeatTrigger) -Settings $settings -Description "Auto-sync retirement-portfolio Codex handoff branch." -Force | Out-Null
    Write-Log "Installed scheduled task '$TaskName' every $IntervalMinutes minutes and at logon."
  }
  catch {
    Write-Log ("Scheduled task install failed: {0}" -f $_.Exception.Message)
    Write-Log "Falling back to Startup folder auto-sync."
    Install-StartupSync
  }
}

function Get-StartupScriptPath {
  $startup = [Environment]::GetFolderPath("Startup")
  if ([string]::IsNullOrWhiteSpace($startup)) {
    $startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
  }
  if (-not (Test-Path $startup)) {
    New-Item -ItemType Directory -Path $startup -Force | Out-Null
  }
  return (Join-Path $startup "$TaskName.vbs")
}

function Install-StartupSync {
  $loopPath = Join-Path $PSScriptRoot "codex-sync-loop.ps1"
  $startupScript = Get-StartupScriptPath
  $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$loopPath`" -IntervalMinutes $IntervalMinutes -Branch `"$Branch`" -Remote `"$Remote`""
  $command = "powershell.exe $arguments"
  $vbsCommand = $command.Replace('"', '""')

  Set-Content -Path $startupScript -Encoding ASCII -Value @(
    'Set shell = CreateObject("WScript.Shell")',
    "shell.Run ""$vbsCommand"", 0, False"
  )

  Write-Log "Installed Startup auto-sync launcher: $startupScript"
  Start-StartupLoop
}

function Get-StartupLoopProcesses {
  $loopPath = (Join-Path $PSScriptRoot "codex-sync-loop.ps1")
  try {
    return @(Get-CimInstance Win32_Process | Where-Object {
      $_.CommandLine -and
      $_.CommandLine.Contains("codex-sync-loop.ps1") -and
      $_.CommandLine.Contains($loopPath)
    })
  }
  catch {
    Write-Log ("Could not inspect running processes: {0}" -f $_.Exception.Message)
    return @()
  }
}

function Start-StartupLoop {
  $running = Get-StartupLoopProcesses
  if ($running.Count -gt 0) {
    Write-Log "Background auto-sync loop is already running."
    return
  }

  $loopPath = Join-Path $PSScriptRoot "codex-sync-loop.ps1"
  $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$loopPath`" -IntervalMinutes $IntervalMinutes -Branch `"$Branch`" -Remote `"$Remote`""
  Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WindowStyle Hidden
  Write-Log "Started background auto-sync loop for the current Windows session."
}

function Uninstall-SyncTask {
  try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
      Write-Log "Uninstalled scheduled task '$TaskName'."
    }
    else {
      Write-Log "Scheduled task '$TaskName' was not installed."
    }
  }
  catch {
    Write-Log ("Could not uninstall scheduled task: {0}" -f $_.Exception.Message)
  }

  Uninstall-StartupSync
}

function Uninstall-StartupSync {
  $startupScript = Get-StartupScriptPath
  if (Test-Path $startupScript) {
    Remove-Item -LiteralPath $startupScript -Force
    Write-Log "Removed Startup auto-sync launcher: $startupScript"
  }
  else {
    Write-Log "Startup auto-sync launcher was not installed."
  }

  $running = Get-StartupLoopProcesses
  foreach ($process in $running) {
    Stop-Process -Id $process.ProcessId -Force
    Write-Log "Stopped background auto-sync loop process $($process.ProcessId)."
  }
}

try {
  Ensure-Repository

  switch ($Mode) {
    "install-task" {
      Install-SyncTask
    }
    "uninstall-task" {
      Uninstall-SyncTask
    }
    "install-startup" {
      Install-StartupSync
    }
    "uninstall-startup" {
      Uninstall-StartupSync
    }
    "status" {
      Show-Status
    }
    "resume" {
      $remoteExists = Ensure-HandoffBranch
      Pull-HandoffBranch $remoteExists
      Show-Status
    }
    "save" {
      $remoteExists = Ensure-HandoffBranch
      Pull-HandoffBranch $remoteExists
      Save-HandoffBranch
      Show-Status
    }
    "sync" {
      $remoteExists = Ensure-HandoffBranch
      Pull-HandoffBranch $remoteExists
      Save-HandoffBranch
      Show-Status
    }
  }
}
catch {
  Write-Log ("ERROR: {0}" -f $_.Exception.Message)
  exit 1
}
