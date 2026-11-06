<#
.SYNOPSIS
    One-shot developer setup for Windows PowerShell / PowerShell 7.
.EXAMPLE
    ./.github/scripts/setup.ps1
#>

$ErrorActionPreference = 'Stop'

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) {
    Write-Error 'Run this script from inside the repository.'
    exit 1
}
Set-Location $repoRoot

if (-not (Test-Path '.githooks')) {
    Write-Error ".githooks/ directory not found in $repoRoot"
    exit 1
}

& git config core.hooksPath .githooks
Write-Host '[OK]  git config core.hooksPath = .githooks' -ForegroundColor Green

foreach ($hook in @('.githooks/pre-commit', '.githooks/pre-push', '.githooks/commit-msg', '.github/scripts/doctor.sh')) {
    if (Test-Path $hook) {
        # Only set the exec bit for tracked files (silent no-op otherwise).
        $tracked = & git ls-files -- $hook
        if ($tracked) {
            & git update-index --chmod=+x $hook | Out-Null
        }
    }
}
Write-Host '[OK]  hooks marked executable in Git index' -ForegroundColor Green

# Sanity check: Git >= 2.9 is required for core.hooksPath.
$verString = ((& git --version) -split ' ')[2]
$verParts  = $verString.Split('.')
$major = [int]$verParts[0]
$minor = [int]$verParts[1]
if ($major -lt 2 -or ($major -eq 2 -and $minor -lt 9)) {
    Write-Error "Git $verString detected -- core.hooksPath requires Git >= 2.9."
    exit 1
}

Write-Host ''
Write-Host 'Done. Git hooks are now active.'
Write-Host 'Run ./.github/scripts/doctor.ps1 to verify your environment.'
