# zDSH

[English](README.md) | [中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Stage](https://img.shields.io/badge/Stage-Active_Development-blue)](https://github.com/zsagi1368/deepseek-harness-zDSH)

**zDSH** (`deepseek-harness-zDSH`) is a production-grade agent harness distribution built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — an open-source agent runtime where everything is a plugin, powered by [Cordis](https://github.com/cordiverse/cordis).

## Why zDSH exists

DeepSeek Harness provides an excellent plugin-first foundation — but production use exposed gaps that upstream couldn't address quickly enough:

| Problem | Impact | zDSH solution |
|---|---|---|
| Third-party plugins can crash the core agent or leak host data through unrestricted file access and environment inheritance | Data loss, security breaches | **Plugin governance**: three-tier sandboxing, load-time validation, runtime enforcement, circuit-breaker health checks, fail-closed admission |
| No persistent knowledge across sessions — every conversation starts from zero | Repeated explanations, lost decisions | **Cross-session memory**: heuristic extraction of decisions/facts/preferences, day-sharded storage, Top-K injection at session start |
| Images sent to LLM break KV-cache and waste tokens on repeated description | Slow responses, high cost | **Omnivision vision pipeline**: pixel-faithful provider chain converts images to text before LLM sees them |
| `web-fetch` unusable behind corporate proxies | Tool completely unavailable | HTTP proxy support via undici ProxyAgent + env variable fallback |
| Headless mode can't resume sessions in CI pipelines | Manual prompt reconstruction | `--resume <session-id>` loads persisted session history |
| Chinese file paths silently corrupted by PowerShell-based directory picker | Wrong workspace selected | koffi COM dialog with UTF-16 native path handling |

zDSH tracks upstream closely while maintaining these enhancements as first-party core plugins — designed so future upstream merges don't break independent functionality.

## Features

### Plugin governance system
Three-tier sandboxing (process / worker / inline), load-run-health guards with circuit-breaker semantics, fail-closed admission backed by a durable approvals ledger, Loader-mirror registry population, and local-path install/uninstall.

### Omnivision vision pipeline
Multi-provider chain (OpenAI / Anthropic / Gemini / OVH / Zhipu) with automatic failover, SSRF guards (DNS resolution + private-range + IPv4-mapped-IPv6 checks), realpath-based path policy with symlink traversal protection, and KV-safe shadow history.

### Cross-session memory
Heuristic extraction of decisions, facts, and preferences from session events. Day-sharded JSON storage under `.dsh-zdsh/memory/`. Top-K relevance-scored injection at session start.

### Web management interface
Governance tab in Settings → Plugins: roster table with status/version/approval badges, enable/disable actions, health strip, preset save/load/delete.

### Quality-of-life improvements
See the full list in the [feature matrix](#additional-improvements) below.

## Getting started

### Prerequisites

- Node.js ≥ 22.19.0 (or ≥ 24.0.0)
- pnpm ≥ 11.x
- Git ≥ 2.40

### Install and run

```sh
git clone https://github.com/zsagi1368/deepseek-harness-zDSH.git
cd deepseek-harness-zDSH
pnpm install
pnpm run build
pnpm dsh web
```

The Web UI opens at `http://127.0.0.1:3080`. Navigate to **Settings → Plugins** for the governance management tab.

> **Windows users**: Enable Developer Mode (Settings → Privacy & Security → For developers) for symlink support required by some packages.

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DSH_BRANCH_HOME` | zDSH data root (memory / approvals / plugin state) | `~/.dsh-zdsh` |
| `OPENAI_API_KEY` | OpenAI API access | — |
| `ANTHROPIC_API_KEY` | Anthropic API access | — |
| `GEMINI_API_KEY` | Gemini API access | — |

### Installing to a specific directory

zDSH stores all data under `DSH_BRANCH_HOME`. To install to a custom location:

```sh
export DSH_BRANCH_HOME="/path/to/your/data/dir"
pnpm dsh web
```

All governance data, memory shards, approval ledgers, and plugin state are stored under that root — fully isolated from the official `~/.dsh/` directory.

### Uninstalling

```sh
rm -rf ~/.dsh-zdsh        # Remove zDSH data
rm -rf deepseek-harness-zDSH   # Remove the repository
```

No global packages are installed; everything runs from the project directory.

## Architecture

```
packages/
├── plugins/plugin-governance/       # Governance core (spec, registry, guards, sandbox)
├── host/plugin-governance-host/     # Host-plane gateway service (10 Remotes)
├── client/ui-plugin-manager/        # Web Settings governance tab
├── client/workbench/                # IDE dock (terminal, git, file browser)
├── extensions/omnivision/           # Vision pipeline (providers, bridge, security)
├── extensions/webstack/             # Integrated search & fetch kernel
├── extensions/file-hub/             # File management
├── extensions/autopilot/            # Automation orchestration
├── memory/zdsh-memory/              # Cross-session memory plugin
└── ...                              # All official platform packages unchanged
```

## Additional improvements over stock DeepSeek Harness

| Area | Enhancement |
|---|---|
| Network | web-fetch HTTP proxy support (`proxyUrl` config + `HTTPS_PROXY` env fallback) |
| Sessions | headless `--resume <session-id>` for CI and long-running tasks |
| UI | Session pinning · reveal-in-file-manager · mobile-responsive layout (768px breakpoint) |
| Files | EISDIR atomic-write fix with clear error messages · koffi COM dialog replaces PowerShell for Chinese path safety |
| LLM | CJK-aware token pricing (fixes 3–4× underestimation for Chinese text) · LoadGuard semver comparison fix |
| Security | Sandbox child-process environment whitelist derivation · ::ffff: IPv6 unwrapping in SSRF checks · Windows cross-drive escape guard |

## Upstream sync

```sh
git fetch upstream
git merge upstream/master
```

zDSH maintains real ancestry with upstream — merges are normal Git operations. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

[MIT](LICENSE)
