# qwen-local → Mantis

**This project has been renamed and moved to [Mantis](https://github.com/sp00nznet/mantis).**

qwen-local has grown beyond its original scope. It now supports cloud GPU providers, autonomous mode, GPU-tiered installs, and more — so it got a new name to match.

## What changed

- **Renamed** from `qwen-local` to `mantis-code` (CLI command: `mantis`)
- **Cloud providers** — Together AI, Fireworks, Groq, OpenRouter, DeepInfra
- **Autonomous mode** — `/auto "build a REST API"` and it plans, writes, builds, tests, delivers
- **GPU-tiered installs** — detects your GPU and pulls the right model size
- **Config migration** — your `~/.qwen-local/` config auto-migrates to `~/.mantis/`

## Migrate

```bash
# Clone the new repo
git clone https://github.com/sp00nznet/mantis.git
cd mantis
npm install
npm link

# Your old config migrates automatically on first run
mantis
```

## Links

- **New repo**: [github.com/sp00nznet/mantis](https://github.com/sp00nznet/mantis)
- This repo is archived and will not receive updates.
