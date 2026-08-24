# zDSH — deepseek-harness-zDSH

English | [中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/zsagi1368/deepseek-harness-zDSH)
[![Stage](https://img.shields.io/badge/Stage-Active_Development-blue)](https://github.com/zsagi1368/deepseek-harness-zDSH)

**zDSH** is an independent enhancement distribution built on top of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) — an open-source agent harness developed by [DeepSeek AI](https://deepseek.com) where everything is a plugin, powered by [Cordis](https://github.com/cordiverse/cordis).

## Why zDSH exists

DeepSeek Harness is an excellent foundation, but production use surfaced gaps that upstream's release cadence couldn't address quickly enough:

| Problem | zDSH Solution |
|---|---|
| Third-party plugins could crash the core agent or leak host data | **Plugin governance system**: three-tier sandboxing, load/run/health guards, fail-closed admission, durable approval ledger |
| No persistent knowledge across sessions | **Cross-session memory plugin**: heuristic extraction, day-sharded storage, Top-K injection (zero LLM calls = zero extra tokens) |
| Images sent to LLM broke KV-cache and wasted tokens on re-description | **omnivision vision pipeline**: pixel-faithful provider chain, circuit breaker, path policy, SSRF guards, KV-safe shadow history |
| web-fetch unusable behind corporate proxies | **HTTP proxy support**: `proxyUrl` config + `HTTPS_PROXY` env fallback via undici ProxyAgent |
| headless mode had no way to resume sessions | **`--resume <session-id>`**: persisted sessions are loaded and continued |
| No visibility into plugin health or control from the UI | **Governance tab** in Web Settings: roster table, enable/disable, approve, health strip, presets |

zDSH tracks upstream closely (currently based on `0.1.1-rc.2`) while maintaining these enhancements as first-party core plugins — designed so future upstream merges don't break independent functionality.

## Key features

### Plugin governance system
Three-layer sandboxing (process / worker / inline), load-run-health guards with circuit-breaker semantics, fail-closed admission with a durable approvals ledger, and Loader-mirror registry population.

### omnivision vision pipeline
Multi-provider chain (OpenAI / Anthropic / Gemini / OVH / Zhipu) with automatic failover, SSRF guards (DNS resolution + private-range checks), realpath-based path policy, and KV-safe shadow history that keeps DeepSeek receiving pure text.

### Cross-session memory
Heuristic extraction of decisions, facts, and preferences from session events. Day-sharded JSON storage under `.dsh-zdsh/memory/`. Top-K relevance-scored injection at session start. Zero LLM calls, zero embedding vectors — just token-efficient keyword overlap.

### Host governance gateway
Ten Typert direct Remotes exposed through the API gateway: roster, get, enable/disable, health, approve, preset save/load/delete. Fail-closed admission enforced server-side. Install/uninstall accept local directory paths.

### Quality-of-life improvements
web-fetch HTTP proxy support · headless `--resume <id>` · session pinning · reveal-in-explorer · Chinese path safety (koffi COM dialog replaces PowerShell) · mobile-responsive Web UI · EISDIR atomic-write fix · CJK-aware token pricing · LoadGuard semver comparison fix

## Getting started

### Prerequisites

- Node.js ≥ 22.19.0 (or ≥ 24.0.0)
- pnpm ≥ 11.x

### Run from source

```sh
git clone https://github.com/zsagi1368/deepseek-harness-zDSH.git
cd deepseek-harness-zDSH
pnpm install
pnpm run build
pnpm dsh web
```

The Web UI starts at `http://127.0.0.1:3080`. Navigate to **Settings → Plugins** to see the governance tab alongside the official inventory tab.

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DSH_BRANCH_HOME` | zDSH data root (memory, approvals, plugin state) | `~/.dsh-zdsh` |
| `OPENAI_API_KEY` | OpenAI vision provider | — |
| `ANTHROPIC_API_KEY` | Anthropic vision provider | — |
| `GEMINI_API_KEY` | Gemini vision provider | — |

## Architecture

zDSH follows the official "everything is a plugin" architecture. All enhancements are implemented as first-party Cordis plugins:

```
packages/
├── plugins/plugin-governance/     # Governance core (spec, registry, guards, sandbox)
├── host/plugin-governance-host/   # Host-plane gateway service (10 Typert Remotes)
├── client/ui-plugin-manager/      # Web Settings governance tab
├── extensions/omnivision/         # Vision pipeline (providers, bridge, security)
├── memory/zdsh-memory/            # Cross-session memory plugin
└── ...                            # All official packages unchanged
```

## Quality assurance

- Red-team adversarial review: two rounds (R1 FAIL → remediated → R2 PASS-with-notes)
- Build, typecheck, lint, knip: all green across 2679+ source files
- 317+ tests passing across touched packages
- Net delta vs upstream: 46 added / 21 modified / 0 deleted files

## Syncing with upstream

```sh
git fetch upstream
git merge upstream/master
```

zDSH maintains real ancestry with upstream — merges are normal Git operations.

## Community

- Report issues or suggest features: [Issues](https://github.com/zsagi1368/deepseek-harness-zDSH/issues) or [Discussions](https://github.com/zsagi1368/deepseek-harness-zDSH/discussions)
- For upstream project feedback: [official Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)

## License

[MIT](LICENSE)

---

## About the upstream project

<details>
<summary>DeepSeek Harness (upstream) — click to expand</summary>

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com). It uses an architecture where **everything is a plugin**, powered by [Cordis](https://github.com/cordiverse/cordis).

Currently in _developer preview_. See the [official repository](https://github.com/deepseek-ai/deepseek-harness) for documentation, architecture guides, and community resources.

</details>
