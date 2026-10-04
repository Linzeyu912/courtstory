$ErrorActionPreference = 'Stop'
$reviewRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$reviewUrl = 'http://127.0.0.1:8901/'
$reviewOutput = Join-Path $reviewRoot 'artifacts/material-label-human-review'

function Test-ReviewService {
    try {
        $reviewCatalog = Invoke-RestMethod ($reviewUrl + 'api/catalog') -TimeoutSec 2
        return $reviewCatalog.output_path -eq 'artifacts/material-label-human-review' -and $reviewCatalog.clips.Count -gt 0
    } catch { return $false }
}

if (-not (Test-ReviewService)) {
    New-Item -ItemType Directory -Force -Path $reviewOutput | Out-Null
    $reviewPython = (Get-Command python -ErrorAction Stop).Source
    Start-Process -FilePath $reviewPython -ArgumentList @('-X', 'utf8', 'engineering/scripts/serve_material_label_review.py') -WorkingDirectory $reviewRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $reviewOutput 'stdout.log') -RedirectStandardError (Join-Path $reviewOutput 'stderr.log') | Out-Null
    for ($reviewAttempt = 0; $reviewAttempt -lt 20; $reviewAttempt++) {
        if (Test-ReviewService) { break }
        Start-Sleep -Milliseconds 250
    }
    if (-not (Test-ReviewService)) { throw "审核服务未启动。请查看 $reviewOutput\stderr.log；8901 端口可能被其他程序使用。" }
}
Start-Process $reviewUrl
Write-Host "Review: $reviewUrl"
Write-Host "Saved feedback: $reviewOutput\records"
