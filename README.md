# qwen-local

**Your own AI coding assistant, running entirely on your machine. No API keys. No cloud. No limits.**

qwen-local is an agentic coding CLI — like having a senior dev pair-programming with you in your terminal. It reads your files, writes code, runs commands, searches your codebase, and plans out complex tasks. All powered by [Qwen3-Coder](https://ollama.com/library/qwen3-coder) running locally through [Ollama](https://ollama.com).

![qwen-local in action](images/qwen-local-demo.png)

---

## Quick Start

### One-line install

**Windows** (PowerShell):
```powershell
powershell -ExecutionPolicy Bypass -File installer\install-windows.ps1
```
Or just double-click `installer\install.bat`.

**Linux** (Debian/Ubuntu):
```bash
chmod +x installer/install-linux.sh && ./installer/install-linux.sh
```

The installer handles everything — Ollama, Node.js, the model, PATH setup.

### Manual install

```bash
cd qwen-local
npm install
npm link

# Pull the model (pick one)
ollama pull qwen3-coder-cpu   # CPU — works on any machine
ollama pull qwen3-coder       # GPU — needs NVIDIA + CUDA
```

### Run it

```bash
cd ~/my-project
qwen-local
```

---

## Features

**10 built-in tools** — reads files, writes code, runs commands, searches your codebase, does surgical edits. It reads before it writes and chains tools together to accomplish complex tasks.

**Plan mode** — Toggle with `/plan` to explore your codebase and design a plan without touching anything. Toggle off to execute.

**Context management** — Long conversations don't crash. Token usage is tracked and older messages are automatically compacted when the context window fills up.

**Persistent memory** — Tell the model to "save state to memory" and it persists notes for future sessions. Project-scoped (`.qwen-local/MEMORY.md`) or global (`~/.qwen-local/memory/MEMORY.md`).

**Skills** — 8 built-in slash commands (`/commit`, `/review`, `/test`, `/explain`, `/fix`, `/refactor`, `/deps`, `/init`) plus create your own with `/skill create`.

**Save/load conversations** — `/save` and `/load` to pick up where you left off.

**Model hot-swap** — `/model deepseek-coder-v2` to switch models without restarting.

---

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/exit` | Quit |
| `/clear` | Wipe conversation history |
| `/plan` | Toggle plan mode (read-only exploration) |
| `/status` | Show token usage, model info, stats |
| `/cd <dir>` | Change working directory |
| `/save [name]` | Save conversation |
| `/load [name]` | List or load saved conversations |
| `/compact` | Manually compress history |
| `/model <name>` | Switch Ollama model |
| `/config` | Show configuration |
| `/memory` | Show saved memory |
| `/skills` | List all skills |
| `/<skillname>` | Run a skill (e.g. `/commit`, `/test`) |

---

## Configuration

Settings live at `~/.qwen-local/config.json`:

```json
{
  "model": "qwen3-coder-cpu",
  "ollamaUrl": "http://localhost:11434",
  "maxContextTokens": 32768,
  "compactThreshold": 0.75,
  "commandTimeout": 60000,
  "maxToolResultSize": 8000,
  "confirmDestructive": true
}
```

---

## Requirements

- **Ollama** — [ollama.com](https://ollama.com)
- **Node.js** v18+
- **RAM** — 8GB minimum, 16GB recommended
- **Disk** — ~5GB for the model

---

## Docs

| | |
|---|---|
| [Getting Started](docs/getting-started.md) | Installation and first steps |
| [Tools Reference](docs/tools.md) | All 10 tools explained |
| [Skills](docs/skills.md) | Built-in skills, creating your own |
| [Memory](docs/memory.md) | Persistent state across sessions |
| [Plan Mode](docs/plan-mode.md) | Read-only exploration |
| [Context Management](docs/context-management.md) | Token tracking and compaction |
| [Configuration](docs/configuration.md) | All settings |
| [Architecture](docs/architecture.md) | How the agent loop works |

---

## License

MIT
