#!/usr/bin/env bash
#
# qwen-local uninstaller for Linux
#

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
MAGENTA='\033[0;35m'
GRAY='\033[0;90m'
NC='\033[0m'

echo -e "\n  ${MAGENTA}qwen-local Uninstaller${NC}\n"

# Remove global link
echo -e "  Removing global npm link..."
npm unlink -g qwen-local 2>/dev/null && echo -e "  ${GREEN}[OK]${NC} npm link removed" || echo -e "  ${GRAY}[--] No npm link found${NC}"

# Remove symlink
for link_path in "$HOME/.local/bin/qwen-local" "$HOME/bin/qwen-local"; do
    if [[ -L "$link_path" ]]; then
        rm "$link_path"
        echo -e "  ${GREEN}[OK]${NC} Removed symlink: $link_path"
    fi
done

# Remove config
CONFIG_DIR="$HOME/.qwen-local"
if [[ -d "$CONFIG_DIR" ]]; then
    read -rp "  Remove config and saved conversations at $CONFIG_DIR? (y/N): " remove_config
    if [[ "$remove_config" == "y" || "$remove_config" == "Y" ]]; then
        rm -rf "$CONFIG_DIR"
        echo -e "  ${GREEN}[OK]${NC} Config removed"
    else
        echo -e "  ${GRAY}[--] Config kept${NC}"
    fi
fi

# Remove install directory
DEFAULT_PATH="$HOME/qwen-local"
read -rp "  Remove install directory? Enter path (Enter for $DEFAULT_PATH, 'n' to skip): " remove_path
if [[ "$remove_path" != "n" && "$remove_path" != "N" ]]; then
    target="${remove_path:-$DEFAULT_PATH}"
    if [[ -d "$target" ]]; then
        rm -rf "$target"
        echo -e "  ${GREEN}[OK]${NC} Removed $target"
    else
        echo -e "  ${GRAY}[--] Not found: $target${NC}"
    fi
fi

# Clean PATH from shell profiles
for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    if [[ -f "$rc" ]]; then
        if grep -q "# qwen-local" "$rc" 2>/dev/null; then
            sed -i '/# qwen-local/d' "$rc"
            sed -i '/qwen-local/d' "$rc"
            echo -e "  ${GREEN}[OK]${NC} Cleaned $rc"
        fi
    fi
done

echo ""
echo -e "  ${GREEN}qwen-local has been uninstalled.${NC}"
echo -e "  ${GRAY}Note: Ollama and models were NOT removed.${NC}"
echo -e "  ${GRAY}To remove models: ollama rm <model-name>${NC}"
echo -e "  ${GRAY}To remove Ollama: sudo rm /usr/local/bin/ollama${NC}"
echo ""
