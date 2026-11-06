<#
.SYNOPSIS
    Windows PowerShell wrapper for .github/scripts/doctor.sh.
.DESCRIPTION
    Locates Git's bundled sh.exe (or one on PATH) and delegates so the
    check logic lives in one place (POSIX shell).
#>

$ErrorActionPreference = 'Stop'

function Find-Sh {
    $cmd = Get-Command sh.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA    'Programs\Git\usr\bin\sh.exe'),
        (Join-Path $env:LOCALAPPDATA    'Programs\Git\bin\sh.exe'),
        (Join-Path $env:ProgramFiles    'Git\usr\bin\sh.exe'),
        (Join-Path $env:ProgramFiles    'Git\bin\sh.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Git\usr\bin\sh.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Git\bin\sh.exe')
    )
    foreach ($p in $candidates) { if (Test-Path -LiteralPath $p) { return $p } }
    return $null
}

$sh = Find-Sh
if (-not $sh) {
    Write-Error 'Could not find sh.exe. Install Git for Windows or use WSL / Git Bash.'
    exit 1
}

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) {
    Write-Error 'Run this script from inside the repository.'
    exit 1
}
Set-Location $repoRoot

& $sh .github/scripts/doctor.sh @args
