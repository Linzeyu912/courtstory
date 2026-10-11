[CmdletBinding()]
param([switch]$ReplaceHooksPath)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$policyFile = Join-Path $repoRoot 'config/commit-identity.config'

function Invoke-RepoGit {
    $gitOutput = & git -C $repoRoot @args
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: $($args -join ' ')"
    }
    return $gitOutput
}

$null = Invoke-RepoGit rev-parse --show-toplevel
$identityName = Invoke-RepoGit config --file $policyFile --get identity.name
$identityEmail = Invoke-RepoGit config --file $policyFile --get identity.email
$expectedIdentity = "$identityName <$identityEmail>"
$configuredHooks = & git -C $repoRoot config --get core.hooksPath
if ($LASTEXITCODE -notin @(0, 1)) { throw 'Cannot read core.hooksPath.' }
$activeHooks = Invoke-RepoGit rev-parse --path-format=absolute --git-path hooks

if ($configuredHooks -ne '.githooks' -and -not $ReplaceHooksPath) {
    $existingHooks = @(Get-ChildItem -LiteralPath $activeHooks -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notlike '*.sample' })
    if ($existingHooks.Count -gt 0) {
        throw "Existing hooks found: $activeHooks. Integrate them first, or explicitly use -ReplaceHooksPath. Existing files will be preserved."
    }
}

foreach ($identitySection in @('user', 'author', 'committer')) {
    $null = Invoke-RepoGit config --local "$identitySection.name" $identityName
    $null = Invoke-RepoGit config --local "$identitySection.email" $identityEmail
}
$null = Invoke-RepoGit config --local user.useConfigOnly true
$null = Invoke-RepoGit config --local core.hooksPath .githooks
if ($env:OS -ne 'Windows_NT') {
    & chmod +x (Join-Path $repoRoot '.githooks/pre-commit') (Join-Path $repoRoot '.githooks/pre-push')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot mark hooks executable.' }
}

foreach ($identityRole in @('AUTHOR', 'COMMITTER')) {
    $actualIdentity = (Invoke-RepoGit var "GIT_${identityRole}_IDENT") -replace ' [0-9]+ [+-][0-9]{4}$', ''
    if ($actualIdentity -cne $expectedIdentity) {
        throw "Identity check rejected ${identityRole}. Required: $expectedIdentity. Actual: $actualIdentity. Check environment overrides."
    }
}
Write-Output "Author:    $expectedIdentity"
Write-Output "Committer: $expectedIdentity"
Write-Output 'Repository hooks: .githooks'
Write-Output 'GitHub authentication has not been changed.'
