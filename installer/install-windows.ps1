#Requires -Version 5.1
<#
.SYNOPSIS
    qwen-local installer for Windows
.DESCRIPTION
    Installs qwen-local and all dependencies:
    - Ollama (if not installed)
    - Node.js (if not installed)
    - The selected Qwen3-Coder model (CPU or GPU)
    - qwen-local CLI tool
.NOTES
    Run as: powershell -ExecutionPolicy Bypass -File install-windows.ps1
#>

param(
    [string]$InstallPath,
    [string]$Mode,
    [switch]$Unattended
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# --- Colors and formatting ---
function Write-Header($text) {
    Write-Host ""
    Write-Host "  ============================================" -ForegroundColor Magenta
    Write-Host "    $text" -ForegroundColor Magenta
    Write-Host "  ============================================" -ForegroundColor Magenta
    Write-Host ""
}

function Write-Step($num, $text) {
    Write-Host "  [$num] $text" -ForegroundColor Cyan
}

function Write-Ok($text) {
    Write-Host "  [OK] $text" -ForegroundColor Green
}

function Write-Warn($text) {
    Write-Host "  [!!] $text" -ForegroundColor Yellow
}

function Write-Fail($text) {
    Write-Host "  [FAIL] $text" -ForegroundColor Red
}

function Write-Info($text) {
    Write-Host "  $text" -ForegroundColor Gray
}

# --- Banner ---
Write-Header "qwen-local Installer"
Write-Info "Agentic coding assistant powered by Qwen3-Coder"
Write-Info "https://github.com/your-repo/qwen-local"
Write-Host ""

# --- Detect admin ---
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warn "Not running as Administrator. Some operations may require elevation."
    Write-Host ""
}

# =============================================
# Step 1: Choose install location
# =============================================
Write-Step 1 "Choose install location"

if (-not $InstallPath) {
    $defaultPath = Join-Path $env:USERPROFILE "qwen-local"
    Write-Info "Default install path: $defaultPath"
    $userPath = Read-Host "  Install path (press Enter for default)"
    if ([string]::IsNullOrWhiteSpace($userPath)) {
        $InstallPath = $defaultPath
    } else {
        $InstallPath = $userPath.Trim()
    }
}

Write-Ok "Install path: $InstallPath"

# =============================================
# Step 2: Choose CPU or GPU
# =============================================
Write-Step 2 "Choose compute mode"

if (-not $Mode) {
    Write-Host ""
    Write-Host "  1) CPU  — Works on any machine, slower inference" -ForegroundColor White
    Write-Host "  2) GPU  — Requires NVIDIA GPU with CUDA, much faster" -ForegroundColor White
    Write-Host ""
    $modeChoice = Read-Host "  Select mode (1 or 2)"
    switch ($modeChoice) {
        "2" { $Mode = "gpu" }
        default { $Mode = "cpu" }
    }
}

$modelName = if ($Mode -eq "gpu") { "qwen3-coder" } else { "qwen3-coder-cpu" }
Write-Ok "Mode: $($Mode.ToUpper()) — Model: $modelName"
Write-Host ""

# =============================================
# Step 3: Check/Install Ollama
# =============================================
Write-Step 3 "Checking Ollama"

$ollamaPath = Get-Command "ollama" -ErrorAction SilentlyContinue
if ($ollamaPath) {
    Write-Ok "Ollama found at: $($ollamaPath.Source)"
} else {
    Write-Info "Ollama not found. Downloading installer..."

    $ollamaInstaller = Join-Path $env:TEMP "OllamaSetup.exe"
    $ollamaUrl = "https://ollama.com/download/OllamaSetup.exe"

    try {
        Invoke-WebRequest -Uri $ollamaUrl -OutFile $ollamaInstaller -UseBasicParsing
        Write-Ok "Downloaded Ollama installer"

        Write-Info "Launching Ollama installer..."
        Write-Info "(Follow the installer prompts, then come back here)"
        Start-Process -FilePath $ollamaInstaller -Wait

        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

        $ollamaPath = Get-Command "ollama" -ErrorAction SilentlyContinue
        if ($ollamaPath) {
            Write-Ok "Ollama installed successfully"
        } else {
            Write-Warn "Ollama installed but not found in PATH. You may need to restart your terminal."
            Write-Info "Continuing anyway — the installer will set it up."
        }
    } catch {
        Write-Fail "Failed to download Ollama: $_"
        Write-Info "Please install Ollama manually from https://ollama.com/download"
        Write-Info "Then re-run this installer."
        exit 1
    }
}

# =============================================
# Step 4: Check/Install Node.js
# =============================================
Write-Step 4 "Checking Node.js"

$nodePath = Get-Command "node" -ErrorAction SilentlyContinue
$nodeOk = $false

if ($nodePath) {
    $nodeVersion = & node --version 2>$null
    Write-Ok "Node.js found: $nodeVersion at $($nodePath.Source)"
    # Check minimum version (v18+)
    $major = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($major -ge 18) {
        $nodeOk = $true
    } else {
        Write-Warn "Node.js $nodeVersion is too old. Need v18+."
    }
}

if (-not $nodeOk) {
    Write-Info "Installing Node.js v20 LTS..."

    $nodeInstaller = Join-Path $env:TEMP "node-v20-setup.msi"
    $nodeUrl = "https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi"

    try {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeInstaller -UseBasicParsing
        Write-Ok "Downloaded Node.js installer"

        Write-Info "Installing Node.js (this may take a minute)..."
        $installArgs = "/i `"$nodeInstaller`" /qn /norestart"
        Start-Process msiexec.exe -ArgumentList $installArgs -Wait

        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

        $nodePath = Get-Command "node" -ErrorAction SilentlyContinue
        if ($nodePath) {
            Write-Ok "Node.js installed: $(& node --version)"
        } else {
            Write-Fail "Node.js install completed but 'node' not in PATH."
            Write-Info "Try restarting your terminal and re-running this installer."
            exit 1
        }
    } catch {
        Write-Fail "Failed to install Node.js: $_"
        Write-Info "Please install Node.js v18+ from https://nodejs.org"
        Write-Info "Then re-run this installer."
        exit 1
    }
}

# =============================================
# Step 5: Install qwen-local
# =============================================
Write-Step 5 "Installing qwen-local"

# Create install directory
if (-not (Test-Path $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
    Write-Ok "Created directory: $InstallPath"
}

# Check if this is an existing install (update) or fresh install
$pkgJson = Join-Path $InstallPath "package.json"
$isUpdate = Test-Path $pkgJson

# Copy the project files
$scriptDir = Split-Path -Parent $PSScriptRoot
$srcFiles = @("package.json", "package-lock.json")
$srcDirs = @("bin", "src")

foreach ($f in $srcFiles) {
    $source = Join-Path $scriptDir $f
    if (Test-Path $source) {
        Copy-Item $source -Destination $InstallPath -Force
    }
}
foreach ($d in $srcDirs) {
    $source = Join-Path $scriptDir $d
    if (Test-Path $source) {
        Copy-Item $source -Destination $InstallPath -Recurse -Force
    }
}

Write-Ok "Copied qwen-local files to $InstallPath"

# Set the model in config
$configDir = Join-Path $env:USERPROFILE ".qwen-local"
if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}
$configFile = Join-Path $configDir "config.json"
$configData = @{
    model = $modelName
    ollamaUrl = "http://localhost:11434"
    maxContextTokens = 32768
} | ConvertTo-Json
Set-Content -Path $configFile -Value $configData -Encoding UTF8
Write-Ok "Configuration saved to $configFile"

# npm install
Write-Info "Running npm install..."
Push-Location $InstallPath
try {
    & npm install --production 2>&1 | Out-Null
    Write-Ok "Dependencies installed"
} catch {
    Write-Fail "npm install failed: $_"
    Pop-Location
    exit 1
}

# npm link (global)
Write-Info "Linking qwen-local globally..."
try {
    & npm link 2>&1 | Out-Null
    Write-Ok "qwen-local linked globally"
} catch {
    Write-Warn "npm link failed (may need admin). Trying alternative..."
    # Fallback: add to user PATH
    $binPath = Join-Path $InstallPath "bin"
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$binPath*") {
        [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$binPath", "User")
        $env:Path = "$env:Path;$binPath"
        Write-Ok "Added $binPath to user PATH"
    }
}
Pop-Location

# =============================================
# Step 6: Pull the model
# =============================================
Write-Step 6 "Pulling model: $modelName"

# Make sure Ollama is running
Write-Info "Ensuring Ollama is running..."
$ollamaRunning = $false
try {
    $response = Invoke-WebRequest -Uri "http://localhost:11434/api/version" -UseBasicParsing -TimeoutSec 3
    $ollamaRunning = $true
    Write-Ok "Ollama is running"
} catch {
    Write-Info "Starting Ollama..."
    Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:11434/api/version" -UseBasicParsing -TimeoutSec 5
        $ollamaRunning = $true
        Write-Ok "Ollama started"
    } catch {
        Write-Warn "Could not start Ollama automatically."
    }
}

if ($ollamaRunning) {
    Write-Info "Pulling $modelName (this may take a while on first run)..."
    Write-Info "The model will be downloaded from the Ollama registry."
    Write-Host ""

    try {
        & ollama pull $modelName
        Write-Ok "Model $modelName is ready"
    } catch {
        Write-Warn "Failed to pull model: $_"
        Write-Info "You can pull it manually later: ollama pull $modelName"
    }
} else {
    Write-Warn "Ollama is not running. Skipping model pull."
    Write-Info "Start Ollama and run: ollama pull $modelName"
}

# =============================================
# Done!
# =============================================
Write-Host ""
Write-Header "Installation Complete!"
Write-Host ""
Write-Info "qwen-local has been installed to: $InstallPath"
Write-Info "Model: $modelName ($($Mode.ToUpper()) mode)"
Write-Host ""
Write-Host "  To get started:" -ForegroundColor White
Write-Host "    1. Open a new terminal" -ForegroundColor Gray
Write-Host "    2. cd to any project directory" -ForegroundColor Gray
Write-Host "    3. Run: qwen-local" -ForegroundColor Green
Write-Host ""
Write-Host "  If 'qwen-local' is not recognized, restart your terminal" -ForegroundColor Gray
Write-Host "  or run: node `"$InstallPath\bin\qwen-local.js`"" -ForegroundColor Gray
Write-Host ""
Write-Info "Type /help inside qwen-local for available commands."
Write-Host ""
