# zDSH (Not finished, to be online soon)

English | [中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[![Stage](https://img.shields.io/badge/Stage-Production-blue)](https://github.com/zsagi1368/deepseek-harness-zDSH)

[![Tests](https://img.shields.io/badge/Tests-1029_passing-brightgreen.svg)](https://github.com/zsagi1368/deepseek-harness-zDSH/actions)

**zDSH** (`deepseek-harness-zDSH`) is a production-grade agent harness distribution with first-class plugin governance, multi-provider vision processing, cross-session memory, and a mobile-ready web interface. Works out of the box; every enhancement is a first-party core plugin designed to survive upstream upgrades.

## Why zDSH

Agent harnesses promise autonomous workflows but break down when it matters most: third-party plugins crash the core, context windows bleed tokens on redundant content, sessions die with no way to resume, and there's no way to manage plugin health from a UI — let alone from a phone.

zDSH addresses these systematically:

| Without zDSH | With zDSH |
|---|---|
| Third-party plugin bug crashes the entire agent | Three-tier sandbox contains every failure at the plugin boundary |
| No memory between sessions — repeat yourself constantly | Cross-session memory: heuristic extraction + Top-K injection, zero extra LLM tokens |
| Image attachments waste KV-cache on re-description | Omnivision pipeline: pixel-faithful provider chain, text-only output keeps cache intact |
| Plugin health invisible until something breaks | Real-time governance tab: roster, admission badges, enable/disable, presets |
| web-fetch unusable behind corporate proxies | HTTP proxy support via undici ProxyAgent with env-var fallback |
| Headless runs are one-shot only | Structured session-id output + `--resume <id>` for CI pipelines |

## What's included

### Plugin governance system
Three-tier sandboxing (process / worker / inline) · load-run-health guards with circuit-breaker semantics · fail-closed admission backed by durable approvals ledger · Loader-mirror registry population · local-path install/uninstall through admission pipeline.

### Omnivision vision pipeline
Multi-provider chain (OpenAI / Anthropic / Gemini / OVH / Zhipu) · automatic failover · SSRF guards (DNS resolution + private-range + IPv4-mapped-IPv6 checks) · realpath-based path policy with symlink traversal protection · KV-safe shadow history.

### Cross-session memory
Heuristic extraction of decisions, facts, and preferences · day-sharded JSON storage under `.dsh-zdsh/memory/` · Top-K relevance-scored injection at session start · zero LLM calls, zero embedding vectors.

### Host governance gateway
Ten Typert direct Remotes through the API gateway: roster, get, enable/disable, health, approve, preset save/load/delete · server-side fail-closed admission enforcement · compensating persistence.

### Web management interface
Governance tab in Web Settings alongside the official inventory tab: roster table with status/version/approval badges · enable/disable actions · health strip · preset management · mobile-responsive layout.

### Additional improvements

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

## Run from source

Clone and build the repository yourself when you want the latest `our/v2` changes before they ship: see the Getting started section for prerequisites and the exact commands.

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

The Web UI starts at `http://127.0.0.1:3080`. Navigate to **Settings → Plugins** for the governance tab.

### Install to a custom directory

Set the `DSH_BRANCH_HOME` environment variable before first launch:

```sh
# Linux / macOS
export DSH_BRANCH_HOME="$HOME/my-custom-zdsh"
# Windows PowerShell
$env:DSH_BRANCH_HOME = "D:\my-custom-zdsh"
```

All persistent data (memory, approvals, plugin state, presets) lives under this directory.

### Uninstall

```sh
# 1. Remove the repository
rm -rf deepseek-harness-zDSH

# 2. Remove the data directory
rm -rf ~/.dsh-zdsh        # or your custom DSH_BRANCH_HOME path

# 3. Remove git credentials (optional)
# Settings → SSH keys → remove the deploy key you added for this repo
```

No global npm packages are installed; everything runs from the repository checkout.

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DSH_BRANCH_HOME` | Data root (memory / approvals / plugin state) | `~/.dsh-zdsh` |
| `OPENAI_API_KEY` | OpenAI vision provider | — |
| `ANTHROPIC_API_KEY` | Anthropic vision provider | — |
| `GEMINI_API_KEY` | Gemini vision provider | — |

See the [remote access guide](docs/dsh/remote-access.md) and the [CHANGELOG](docs/dsh/CHANGELOG.md) for advanced configuration and release notes.

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
├── extensions/plugin-center/       # Plugin center UI
├── memory/zdsh-memory/              # Cross-session memory plugin
└── ...                              # All platform packages unchanged from upstream
```

## Remote access

Works out of the box with [Tailscale Serve](docs/dsh/remote-access.md) for secure private-network access from any device. Responsive down to 375px viewports.

## Upstream sync

```sh
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
git fetch upstream
git merge upstream/master
```

zDSH maintains real ancestry with upstream — merges are normal Git operations.

## Community

- Report issues or suggest features: [Issues](https://github.com/zsagi1368/deepseek-harness-zDSH/issues)

## License

[MIT](LICENSE)

---

<details>
<summary>About DeepSeek Harness (upstream project)</summary>

<br>

# DeepSeek Harness

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

```sh
npx @deepseek-ai/dsh web
```

## Community and support

- Submit feedback through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Join the [Discord community](https://discord.gg/Ycq5dCaS4).
- Contribution guidelines: see CONTRIBUTING.md in the upstream repository.

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

</details>
