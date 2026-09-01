# zDSH (Not finished, to be online soon)

English | [中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[![Stage](https://img.shields.io/badge/Stage-Production-blue)](https://github.com/zsagi1368/deepseek-harness-zDSH)

[![Tests](https://img.shields.io/badge/Tests-passing-brightgreen.svg)](https://github.com/zsagi1368/deepseek-harness-zDSH/actions)

**zDSH** (`deepseek-harness-zDSH`) is a production-grade agent harness distribution with first-class plugin governance, multi-provider vision processing, cross-session memory, and a mobile-ready web interface. Works out of the box; every enhancement is a first-party core plugin designed to survive upstream upgrades — and a version-adaptive compat layer (`@deepseek-ai/dsh-compat`) gates each feature's registration against the official core API shape, so upgrades adapt automatically, detected conflicts auto-disable the affected feature, and the core is never dragged down.

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
| Official upgrade silently breaks fork features | Version-adaptive compat layer: features auto-adapt, auto-disable on conflict, never drag the core down |

## What's included

### Version-adaptive compat layer
`@deepseek-ai/dsh-compat` gates every zDSH feature registration against the official core's real API shape: dynamic symbol probing (`probeSymbol`/`memberOf`/`versionOf`) plus a feature guard (`guardFeature`) with a process-level audit roster. All seven headline features — plugin governance, project plugin root, model slots, ACP, boot hardening, workbench binary, UI slots — ship compat guards: they adapt automatically when the official core upgrades, auto-disable when a conflict is detected, and never take the core down.

### Plugin governance system
Three-tier sandboxing (process / worker / inline) · load-run-health guards with circuit-breaker semantics · fail-closed admission backed by durable approvals ledger · Loader-mirror registry population · local-path install/uninstall through admission pipeline.

### Project plugin root
`.dsh/plugins/` per-project plugin root: project-root discovery · clamp enforcement · mount isolation · provenance tracking · trust ledger · child-process runtime · session-scoped activation. Project plugins are governed, isolated, and versioned exactly like first-party ones.

### Omnivision vision pipeline
Multi-provider chain (OpenAI / Anthropic / Gemini / OVH / Zhipu) · automatic failover · SSRF guards (DNS resolution + private-range + IPv4-mapped-IPv6 checks) · realpath-based path policy with symlink traversal protection · KV-safe shadow history.

### Cross-session memory
Heuristic extraction of decisions, facts, and preferences · day-sharded JSON storage under `.dsh-zdsh/memory/` · Top-K relevance-scored injection at session start · zero LLM calls, zero embedding vectors.

### Model slot system
Unified registry (`ctx.modelSlots`) for auxiliary model calls: four built-in slots (`title` / `compaction.summarize` / `vision` / `plan`) share one closed vocabulary. Deployment config pins exact provider/model per slot, with a fallback default and the conversation's main-model route as the final tier. Every successful resolution appends a durable `slots/dispatch` audit record. A UI settings namespace (`llm-model-slots`) lets users edit slot policy without touching deployment files.

### Host governance gateway
Ten Typert direct Remotes through the API gateway: roster, get, enable/disable, health, approve, preset save/load/delete · server-side fail-closed admission enforcement · compensating persistence.

### Web management interface
Governance tab in Web Settings alongside the official inventory tab: roster table with status/version/approval badges · enable/disable actions · health strip · preset management · mobile-responsive layout.

### ACP automation entry
`dsh acp` — a stable automation-only Agent Client Protocol server over JSON-RPC stdio · session resume · full-range permission options (one-shot allow/reject) for headless and CI workflows.

### Additional improvements

| Area | Enhancement |
|---|---|
| Network | web-fetch HTTP proxy support (`proxyUrl` config + `HTTPS_PROXY` env fallback) |
| Sessions | headless `--resume <session-id>` for CI and long-running tasks |
| UI | Session pinning · reveal-in-file-manager · mobile-responsive layout (768px breakpoint) |
| Files | EISDIR atomic-write fix with clear error messages |
| LLM | CJK-aware token pricing (fixes 3–4× underestimation for Chinese text) |
| LLM | D-005: fail explicitly when a max-tokens cut-off reaches a tool call |
| Boot | D-006: Windows boot realpath + system-path env blacklist |
| Workbench | bare-name process spawn fail-closed (no degraded spawn) |
| Governance | sandbox realpath hardening (symlink/junction escape prevention) |
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

### Custom data directory

The installer keeps all data inside the repository's `data/` directory: place the repository wherever you like and move or delete it as a whole — nothing spills outside. To redirect data, set `DSH_HOME` (common root for official and zDSH data; zDSH data lands under `<DSH_HOME>/zdsh` automatically). The legacy `DSH_BRANCH_HOME` variable remains supported and takes highest precedence as an explicit override.

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DSH_HOME` | Data home (official modules + zDSH governance data under `<DSH_HOME>/zdsh`) | `~/.dsh` |
| `DSH_BRANCH_HOME` | Legacy override: zDSH governance data root (wins over the `DSH_HOME` derivation) | `~/.dsh-zdsh` |
| `OPENAI_API_KEY` | OpenAI vision provider | — |
| `ANTHROPIC_API_KEY` | Anthropic vision provider | — |
| `GEMINI_API_KEY` | Gemini vision provider | — |

See the [remote access guide](docs/dsh/remote-access.md) and the [CHANGELOG](docs/dsh/CHANGELOG.md) for advanced configuration and release notes.

## Architecture

```
packages/
├── compat/dsh-compat/              # Version-adaptive shim framework (probe + guard + roster)
├── plugins/plugin-governance/       # Governance core (spec, registry, guards, sandbox)
├── plugins/plugin-project-root/     # Project plugin root (.dsh/plugins) layer
├── llm/model-slots/                 # Unified model slot registry (title / compaction.summarize / vision / plan)
├── acp/acp/                         # Automation-only ACP server over JSON-RPC stdio
├── host/plugin-governance-host/     # Host-plane gateway service (10 Remotes)
├── client/ui-plugin-manager/        # Web Settings governance tab
├── client/ui-settings-models/       # Model slot UI configuration
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

## Installation

For a self-contained setup that keeps all data inside the repository directory, run the installer for your platform from a repository checkout:

```sh
# Windows (PowerShell 5.1+)
.\install.cmd
# macOS / Linux / WSL
./scripts/install.sh
```

The installer checks the prerequisites (`Node.js ^22.19.0 || >=24` and `pnpm`), runs `pnpm install --frozen-lockfile` and `pnpm run build`, and generates:

- `data/` — the data home (`DSH_HOME`). Official module data and zDSH governance data (plugin registry, approval ledger, and installed plugins under `data/zdsh/`) are both kept here.
- `env.ps1` / `env.sh` — environment loaders that define `DSH_HOME`, `DSH_AGENTS_HOME`, and a `dsh` command pointing at the built CLI.

Load the environment before use:

```sh
# PowerShell
. .\env.ps1
# bash
source ./env.sh
```

Then run `dsh web` as usual.

## Uninstall

Run the uninstaller for your platform from a repository checkout:

```sh
# Windows (PowerShell 5.1+)
.\uninstall.cmd
# macOS / Linux / WSL
./scripts/uninstall.sh
```

By default it removes every gitignored artifact inside the checkout (`node_modules`, build output, `data/`, `env.ps1` / `env.sh`), restoring a pristine checkout state. Additional options: `--purge` (PowerShell: `-Purge`) also deletes the whole repository directory afterwards; `--clean-legacy` (PowerShell: `-CleanLegacy`) also removes the legacy zDSH home directories (`~/.dsh-zdsh`, `~/.zdsh-workbench`, `~/.zdsh-plugin-center`). `~/.dsh` belongs to the official release and is only touched after explicit confirmation; the script never deletes `~/.agents` and only reports its presence.

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
