#Requires -Version 5.1
<#
.SYNOPSIS
    Uninstaller for qwen-local
.DESCRIPTION
    Removes qwen-local CLI. Optionally removes Ollama and models.
#>

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  qwen-local Uninstaller" -ForegroundColor Magenta
Write-Host ""

# Unlink global command
Write-Host "  Removing global link..." -ForegroundColor Cyan
try {
    & npm unlink -g qwen-local 2>$null
    Write-Host "  [OK] Global link removed" -ForegroundColor Green
} catch {
    Write-Host "  [--] No global link found" -ForegroundColor Gray
}

# Remove config directory
$configDir = Join-Path $env:USERPROFILE ".qwen-local"
if (Test-Path $configDir) {
    $removeConfig = Read-Host "  Remove config and saved conversations at $configDir? (y/N)"
    if ($removeConfig -eq "y") {
        Remove-Item $configDir -Recurse -Force
        Write-Host "  [OK] Config removed" -ForegroundColor Green
    } else {
        Write-Host "  [--] Config kept" -ForegroundColor Gray
    }
}

# Remove install directory
$defaultPath = Join-Path $env:USERPROFILE "qwen-local"
$removePath = Read-Host "  Remove install directory? Enter path or press Enter for $defaultPath (or 'n' to skip)"
if ($removePath -ne "n" -and $removePath -ne "N") {
    $targetPath = if ([string]::IsNullOrWhiteSpace($removePath)) { $defaultPath } else { $removePath }
    if (Test-Path $targetPath) {
        Remove-Item $targetPath -Recurse -Force
        Write-Host "  [OK] Removed $targetPath" -ForegroundColor Green
    } else {
        Write-Host "  [--] Path not found: $targetPath" -ForegroundColor Gray
    }
}

# Clean PATH
$userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$binPath = Join-Path $defaultPath "bin"
if ($userPath -like "*$binPath*") {
    $newPath = ($userPath -split ";" | Where-Object { $_ -ne $binPath }) -join ";"
    [System.Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "  [OK] Cleaned PATH" -ForegroundColor Green
}

Write-Host ""
Write-Host "  qwen-local has been uninstalled." -ForegroundColor Green
Write-Host "  Note: Ollama and models were NOT removed." -ForegroundColor Gray
Write-Host "  To remove Ollama: uninstall from Add/Remove Programs" -ForegroundColor Gray
Write-Host "  To remove models: ollama rm <model-name>" -ForegroundColor Gray
Write-Host ""
