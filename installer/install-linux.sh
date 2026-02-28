#!/usr/bin/env bash
#
# qwen-local installer for Debian/Ubuntu Linux
#
# Usage:
#   curl -fsSL <url>/install-linux.sh | bash
#   # or
#   chmod +x install-linux.sh && ./install-linux.sh
#
# Options:
#   --path <dir>    Install path (default: ~/qwen-local)
#   --mode cpu|gpu  Compute mode (default: interactive prompt)
#   --unattended    Non-interactive mode (use defaults)
#

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
GRAY='\033[0;90m'
WHITE='\033[1;37m'
NC='\033[0m'

header()  { echo -e "\n  ${MAGENTA}============================================${NC}"; echo -e "  ${MAGENTA}  $1${NC}"; echo -e "  ${MAGENTA}============================================${NC}\n"; }
step()    { echo -e "  ${CYAN}[$1]${NC} $2"; }
ok()      { echo -e "  ${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "  ${YELLOW}[!!]${NC} $1"; }
fail()    { echo -e "  ${RED}[FAIL]${NC} $1"; }
info()    { echo -e "  ${GRAY}$1${NC}"; }

# --- Parse arguments ---
INSTALL_PATH=""
MODE=""
UNATTENDED=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --path)    INSTALL_PATH="$2"; shift 2 ;;
        --mode)    MODE="$2"; shift 2 ;;
        --unattended) UNATTENDED=true; shift ;;
        *)         echo "Unknown option: $1"; exit 1 ;;
    esac
done

# --- Banner ---
header "qwen-local Installer"
info "Agentic coding assistant powered by Qwen3-Coder"
echo ""

# --- Detect sudo ---
SUDO=""
if [[ $EUID -ne 0 ]]; then
    if command -v sudo &>/dev/null; then
        SUDO="sudo"
        info "Will use sudo for system-level operations"
    else
        warn "Not running as root and sudo not available. Some steps may fail."
    fi
fi

# =============================================
# Step 1: Choose install location
# =============================================
step 1 "Choose install location"

if [[ -z "$INSTALL_PATH" ]]; then
    DEFAULT_PATH="$HOME/qwen-local"
    info "Default: $DEFAULT_PATH"
    if [[ "$UNATTENDED" == true ]]; then
        INSTALL_PATH="$DEFAULT_PATH"
    else
        read -rp "  Install path (Enter for default): " user_path
        INSTALL_PATH="${user_path:-$DEFAULT_PATH}"
    fi
fi

ok "Install path: $INSTALL_PATH"

# =============================================
# Step 2: Choose CPU or GPU
# =============================================
step 2 "Choose compute mode"

if [[ -z "$MODE" ]]; then
    if [[ "$UNATTENDED" == true ]]; then
        MODE="cpu"
    else
        echo ""
        echo -e "  ${WHITE}1) CPU${NC}  — Works on any machine, slower inference"
        echo -e "  ${WHITE}2) GPU${NC}  — Requires NVIDIA GPU with CUDA, much faster"
        echo ""
        read -rp "  Select mode (1 or 2): " mode_choice
        case "$mode_choice" in
            2) MODE="gpu" ;;
            *) MODE="cpu" ;;
        esac
    fi
fi

if [[ "$MODE" == "gpu" ]]; then
    MODEL_NAME="qwen3-coder"
else
    MODEL_NAME="qwen3-coder-cpu"
fi

ok "Mode: $(echo "$MODE" | tr '[:lower:]' '[:upper:]') — Model: $MODEL_NAME"
echo ""

# =============================================
# Step 3: Check/Install Ollama
# =============================================
step 3 "Checking Ollama"

if command -v ollama &>/dev/null; then
    OLLAMA_VERSION=$(ollama --version 2>/dev/null || echo "unknown")
    ok "Ollama found: $OLLAMA_VERSION"
else
    info "Ollama not found. Installing..."

    if curl -fsSL https://ollama.com/install.sh | sh; then
        ok "Ollama installed"
    else
        fail "Failed to install Ollama"
        info "Install manually: curl -fsSL https://ollama.com/install.sh | sh"
        exit 1
    fi
fi

# =============================================
# Step 4: Check/Install Node.js
# =============================================
step 4 "Checking Node.js"

NODE_OK=false
if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version)
    NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
    ok "Node.js found: $NODE_VERSION"

    if [[ "$NODE_MAJOR" -ge 18 ]]; then
        NODE_OK=true
    else
        warn "Node.js $NODE_VERSION is too old. Need v18+."
    fi
fi

if [[ "$NODE_OK" == false ]]; then
    info "Installing Node.js v20 LTS..."

    # Try NodeSource first (works on Debian/Ubuntu)
    if [[ -f /etc/debian_version ]]; then
        info "Detected Debian/Ubuntu — using NodeSource repository"
        if curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash - 2>/dev/null; then
            $SUDO apt-get install -y nodejs 2>/dev/null
            if command -v node &>/dev/null; then
                ok "Node.js installed: $(node --version)"
                NODE_OK=true
            fi
        fi
    fi

    # Fallback: try nvm
    if [[ "$NODE_OK" == false ]]; then
        info "Trying nvm..."
        export NVM_DIR="$HOME/.nvm"
        if [[ ! -d "$NVM_DIR" ]]; then
            curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
        fi
        # shellcheck source=/dev/null
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        nvm install 20
        nvm use 20

        if command -v node &>/dev/null; then
            ok "Node.js installed via nvm: $(node --version)"
            NODE_OK=true
        fi
    fi

    if [[ "$NODE_OK" == false ]]; then
        fail "Could not install Node.js automatically."
        info "Please install Node.js v18+ manually:"
        info "  https://nodejs.org/en/download"
        info "Then re-run this installer."
        exit 1
    fi
fi

# =============================================
# Step 5: Install qwen-local
# =============================================
step 5 "Installing qwen-local"

mkdir -p "$INSTALL_PATH"

# Copy project files
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"

if [[ -f "$SCRIPT_DIR/package.json" ]]; then
    # Installing from source directory
    cp "$SCRIPT_DIR/package.json" "$INSTALL_PATH/"
    [[ -f "$SCRIPT_DIR/package-lock.json" ]] && cp "$SCRIPT_DIR/package-lock.json" "$INSTALL_PATH/"
    cp -r "$SCRIPT_DIR/bin" "$INSTALL_PATH/"
    cp -r "$SCRIPT_DIR/src" "$INSTALL_PATH/"
    ok "Copied qwen-local files to $INSTALL_PATH"
else
    # Installing standalone — files should be bundled with this script
    fail "Cannot find qwen-local source files."
    info "Run this installer from the qwen-local/installer/ directory."
    exit 1
fi

# Set the model in config
CONFIG_DIR="$HOME/.qwen-local"
mkdir -p "$CONFIG_DIR" "$CONFIG_DIR/conversations" "$CONFIG_DIR/memory"

cat > "$CONFIG_DIR/config.json" <<EOF
{
  "model": "$MODEL_NAME",
  "ollamaUrl": "http://localhost:11434",
  "maxContextTokens": 32768
}
EOF
ok "Configuration saved to $CONFIG_DIR/config.json"

# npm install
info "Running npm install..."
cd "$INSTALL_PATH"
npm install --production --quiet 2>/dev/null
ok "Dependencies installed"

# Make entry point executable
chmod +x "$INSTALL_PATH/bin/qwen-local.js"

# Create symlink in a PATH directory
LINK_PATH=""
if [[ -d "$HOME/.local/bin" ]]; then
    LINK_PATH="$HOME/.local/bin/qwen-local"
elif [[ -d "$HOME/bin" ]]; then
    LINK_PATH="$HOME/bin/qwen-local"
else
    mkdir -p "$HOME/.local/bin"
    LINK_PATH="$HOME/.local/bin/qwen-local"
fi

ln -sf "$INSTALL_PATH/bin/qwen-local.js" "$LINK_PATH"
ok "Linked: $LINK_PATH → $INSTALL_PATH/bin/qwen-local.js"

# Ensure ~/.local/bin is in PATH
LINK_DIR="$(dirname "$LINK_PATH")"
if [[ ":$PATH:" != *":$LINK_DIR:"* ]]; then
    # Add to shell profile
    SHELL_RC=""
    if [[ -f "$HOME/.bashrc" ]]; then
        SHELL_RC="$HOME/.bashrc"
    elif [[ -f "$HOME/.zshrc" ]]; then
        SHELL_RC="$HOME/.zshrc"
    elif [[ -f "$HOME/.profile" ]]; then
        SHELL_RC="$HOME/.profile"
    fi

    if [[ -n "$SHELL_RC" ]]; then
        echo "" >> "$SHELL_RC"
        echo "# qwen-local" >> "$SHELL_RC"
        echo "export PATH=\"\$PATH:$LINK_DIR\"" >> "$SHELL_RC"
        ok "Added $LINK_DIR to PATH in $SHELL_RC"
        info "Run: source $SHELL_RC  (or open a new terminal)"
    else
        warn "Could not find shell profile to update PATH."
        info "Add this to your shell profile: export PATH=\"\$PATH:$LINK_DIR\""
    fi
    export PATH="$PATH:$LINK_DIR"
fi

# Also try npm link as a backup
npm link 2>/dev/null || true

# =============================================
# Step 6: Pull the model
# =============================================
step 6 "Pulling model: $MODEL_NAME"

# Start Ollama if not running
OLLAMA_RUNNING=false
if curl -sf http://localhost:11434/api/version &>/dev/null; then
    OLLAMA_RUNNING=true
    ok "Ollama is running"
else
    info "Starting Ollama..."
    # Try systemd first
    if systemctl is-active --quiet ollama 2>/dev/null; then
        OLLAMA_RUNNING=true
    elif $SUDO systemctl start ollama 2>/dev/null; then
        sleep 2
        OLLAMA_RUNNING=true
        ok "Ollama started via systemd"
    else
        # Try direct start
        ollama serve &>/dev/null &
        sleep 3
        if curl -sf http://localhost:11434/api/version &>/dev/null; then
            OLLAMA_RUNNING=true
            ok "Ollama started"
        fi
    fi
fi

if [[ "$OLLAMA_RUNNING" == true ]]; then
    info "Pulling $MODEL_NAME (this may take a while on first run)..."
    echo ""

    if ollama pull "$MODEL_NAME"; then
        ok "Model $MODEL_NAME is ready"
    else
        warn "Failed to pull model."
        info "You can pull it manually later: ollama pull $MODEL_NAME"
    fi
else
    warn "Ollama is not running. Skipping model pull."
    info "Start Ollama and run: ollama pull $MODEL_NAME"
fi

# =============================================
# Done!
# =============================================
header "Installation Complete!"

info "qwen-local has been installed to: $INSTALL_PATH"
info "Model: $MODEL_NAME ($(echo "$MODE" | tr '[:lower:]' '[:upper:]') mode)"
echo ""
echo -e "  ${WHITE}To get started:${NC}"
echo -e "  ${GRAY}1. Open a new terminal (or run: source ~/.bashrc)${NC}"
echo -e "  ${GRAY}2. cd to any project directory${NC}"
echo -e "  ${GREEN}3. Run: qwen-local${NC}"
echo ""
echo -e "  ${GRAY}If 'qwen-local' is not recognized, run:${NC}"
echo -e "  ${GRAY}   node $INSTALL_PATH/bin/qwen-local.js${NC}"
echo ""
info "Type /help inside qwen-local for available commands."
echo ""
