# zDSH

[English](README.md) | [中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Stage](https://img.shields.io/badge/Stage-Active_Development-blue)](https://github.com/zsagi1368/deepseek-harness-zDSH)
[![Tests](https://img.shields.io/badge/Tests-1029_passing-brightgreen.svg)](https://github.com/zsagi1368/deepseek-harness-zDSH/actions)

**zDSH** (`deepseek-harness-zDSH`) is a production-grade agent harness distribution with first-class plugin governance, multi-provider vision processing, cross-session memory, and a mobile-ready web interface.

## Why zDSH

Agent harnesses promise autonomous workflows but break down in practice: third-party plugins crash the core, context windows bleed tokens on redundant content, sessions die with no way to resume, and there's no way to manage plugin health from a UI — let alone from a phone.

zDSH addresses these systematically:

- **Plugins can't kill the core.** A three-tier sandbox (process / worker / inline) with load-time validation, runtime enforcement, and circuit-breaker health checks contains every failure at the plugin boundary. Admission is fail-closed: unapproved plugins register as disabled until explicitly approved.
- **Context stays lean.** The omnivision vision pipeline converts image attachments into text summaries via a multi-provider chain before they reach the LLM — keeping KV-cache intact and eliminating redundant token spend on re-description. Cross-session memory uses heuristic extraction with keyword-overlap injection (zero embedding vectors, zero extra LLM calls).
- **Sessions survive interruptions.** Headless mode prints structured session IDs and supports `--resume <id>` for CI pipelines and long-running tasks. Atomic writes with fsync-before-rename protect session logs against corruption.
- **It works everywhere you do.** Mobile-responsive web UI, HTTP proxy support for restricted networks, CJK-aware token pricing, and native path handling for Chinese filenames.

## Core capabilities

### Plugin governance system
Three-tier sandboxing (process / worker / inline), load-run-health guards with circuit-breaker semantics, fail-closed admission backed by a durable approvals ledger, Loader-mirror registry population, and local-path install/uninstall through an admission pipeline.

### Omnivision vision pipeline
Multi-provider chain (OpenAI / Anthropic / Gemini / OVH / Zhipu) with automatic failover, SSRF guards (DNS resolution + private-range + IPv4-mapped-IPv6 checks), realpath-based path policy with symlink traversal protection, and KV-safe shadow history.

### Cross-session memory
Heuristic extraction of decisions, facts, and preferences from session events. Day-sharded JSON storage under `.dsh-zdsh/memory/`. Top-K relevance-scored injection at session start via system-prompt sections.

### Host governance gateway
Ten Typert direct Remotes exposed through the API gateway: roster, get, enable/disable, health, approve, preset save/load/delete. Server-side admission enforcement with compensating persistence.

### Web management interface
Governance tab in Web Settings alongside the official inventory tab: roster table with status/version/approval badges, enable/disable actions, health strip, and preset management.

## Additional improvements over stock

| Area | Enhancement |
|---|---|
| Network | web-fetch HTTP proxy support (`proxyUrl` config + `HTTPS_PROXY` env fallback) |
| Sessions | headless `--resume <session-id>` for CI and long-running tasks |
| UI | Session pinning · reveal-in-file-manager · mobile-responsive layout (768px breakpoint) |
| Files | EISDIR atomic-write fix with clear error messages |
| LLM | CJK-aware token pricing (fixes 3–4× underestimation for Chinese text) |
| Governance | LoadGuard semver comparison fix (lexicographic misjudgement eliminated) |
| Security | Sandbox child-process environment whitelist derivation |
| Paths | Windows cross-drive escape guard + ::ffff: IPv6 unwrapping in SSRF checks |

## Getting started

### Prerequisites

- Node.js ≥ 22.19.0 (or ≥ 24.0.0)
- pnpm ≥ 11.x

### Quick start

```sh
git clone https://github.com/zsagi1368/deepseek-harness-zDSH.git
cd deepseek-harness-zDSH
pnpm install
pnpm run build
pnpm dsh web
```

The Web UI starts at `http://127.0.0.1:3080`. Navigate to **Settings → Plugins** for the governance tab.

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DSH_BRANCH_HOME` | zDSH data root (memory / approvals / plugin state) | `~/.dsh-zdsh` |
| `OPENAI_API_KEY` | OpenAI vision provider | — |
| `ANTHROPIC_API_KEY` | Anthropic vision provider | — |
| `GEMINI_API_KEY` | Gemini vision provider | — |

## Architecture

```
packages/
├── plugins/plugin-governance/       # Governance core (spec, registry, guards, sandbox)
├── host/plugin-governance-host/     # Host-plane gateway service (10 Remotes)
├── client/ui-plugin-manager/        # Web Settings governance tab
├── client/workbench/                # IDE dock (terminal, git, file browser)
├── extensions/omnivision/           # Vision pipeline (providers, bridge, security)
├── extensions/webstack/             # Integrated search & fetch kernel
├── memory/zdsh-memory/              # Cross-session memory plugin
├── extensions/file-hub/             # File management
├── extensions/autopilot/            # Automation orchestration
└── ...                              # All platform packages
```

## Remote access

zDSH works out of the box with [Tailscale Serve](docs/dsh/remote-access.md) for secure private-network access from any device. The web UI is responsive down to 375px viewports.

## Upstream sync

```sh
git fetch upstream
git merge upstream/master
```

## License

[MIT](LICENSE)
