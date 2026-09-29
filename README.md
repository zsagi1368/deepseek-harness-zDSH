# zDSH

English | [中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

zDSH is an enhanced fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the open-source agent harness developed by [DeepSeek AI](https://deepseek.com). It tracks the official upstream releases while adding version-adaptive enhancements that automatically disable themselves when they would conflict with the core environment.

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

This repository (`zsagi1368/deepseek-harness-zDSH`) is the zDSH fork. The active development branch is `zdsh-latest`, kept in sync with the latest official release.

## Versions

| Component | Version |
| --- | --- |
| Official base ([DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)) | `0.1.7-rc.2` |
| zDSH release | `v0.1.7-rc.2-zDSH20260929a` |

zDSH tracks the official `dsh-v0.1.7-rc.2` baseline and re-syncs on every official release. zDSH version rule: `<official-version>-zDSH<date><revision-letter>`, where the date is the zDSH campaign close date (`20260929`) and the letter counts same-day revisions (`a`). The root `package.json` keeps the official base version untouched; the zDSH version is declared on this README surface and on the matching release tag.

## Upgrade notes

Upgrading from a `v0.1.5-rc.2-zDSH*` release moves the official base from `0.1.5-rc.2` to `0.1.7-rc.2`. Read this section before upgrading — it covers the user-data surface.

- **Session persistence does not migrate across versions.** The 0.1.5 and 0.1.7 persistence layers are mutually incompatible (community evidence [#7921](https://github.com/deepseek-ai/deepseek-harness/discussions/7921) and [#7983](https://github.com/deepseek-ai/deepseek-harness/discussions/7983)). Upgrade direction (#7921): a 0.1.7-rc.1 → rc.2 upgrade re-initialized the data directory on Windows, losing sessions, history, and plugin state — back up the whole `data/` directory before upgrading, and never share one data home between a 0.1.5 and a 0.1.7 install. Rollback direction (#7983): 0.1.7 removed the `sessionUpdatedAtByAccount` field under the shared browser persistence key `dsh.workspace.view.v5` (the key itself was never version-bumped — both releases use the same one), so after rolling back to 0.1.5-rc.2 the session list renders empty; the session data itself is not lost — clear that localStorage key and reload to recover (grouping/sorting preferences reset). This field-level schema change has no official migration or compatibility handling. Official 0.1.7 introduces session log V4 and ships a one-time batch migration command, `pnpm run migrate:sessions-to-v4` (it defaults to `~/.dsh/sessions`; the zDSH data home lives in the repository's `data/` directory, so pass `--sessions-dir` explicitly).
- **Model-slot user overrides degrade fail-soft.** The official 0.1.7 settings rewrite removed the `SettingsProvider` namespace registration surface, so the `dsh-model-slots` compatibility guard skips only its settings-section registration and the roster audit reports the plugin disabled. This is the dsh-compat design working as intended — an official API change degrades the feature instead of breaking the core: the `ModelSlotRegistry` service itself stays live on raw config (resolve/dispatch/audit all functional). The debt is registered as DEBT-MODEL-SLOTS with a restore plan gated on a real production consumer appearing.
- **The governance console UI is reachable for the first time.** The zDSH governance tab had been an orphaned package on this branch (its mount line was lost in a historical migration, leaving the browser half unreachable). It now lives at `packages/zdsh/plugin-governance-ui` (renamed to `@deepseek-ai/dsh-client-ui-plugin-governance` to avoid the official `ui-plugin-manager` name collision) and is wired into the web app, so the governance tab in the Web Plugins settings area — roster badges, lifecycle/admission actions, health — is reachable for the first time. The official sidebar Plugins panel ships alongside it; the two surfaces complement each other.
- **The eight factory plugins are re-pinned for the 0.1.7-rc.2 base.** Every factory artifact carries a new supply-chain pin; the roster posture is unchanged (6 mounted / 2 skipped):

| Plugin (id) | Package | Version | Pin (40-hex git commit) |
| --- | --- | --- | --- |
| `core/webstack` | `dsh-webstack` | `0.2.0` | `289dab1b17a757bae3f170eb46b772c220471cd8` |
| `core/webstack-bridge` | `dsh-webstack-bridge` | `0.2.0` | `289dab1b17a757bae3f170eb46b772c220471cd8` |
| `core/omnivision` | `dsh-omnivision` | `0.1.0-alpha` | `d2decb2c23d527f660c1a0b97fe637e82939c966` |
| `core/filehub` | `dsh-filehub` | `0.1.0` | `b93894cf941566d0bbff6c445fa16bf083b53611` |
| `core/plugin-center` | `dsh-plugin-center` | `0.2.0` | `b9e205c7e13c49ed6580d76e79f10304d7c71f40` |
| `core/workbench` | `zdsh-workbench` | `0.1.0-beta.1` | `aab54ea646552e35ae790ec907e9a475b55afc94` |
| `core/webstack-verticals` | `dsh-webstack-verticals` | `0.2.0` | `289dab1b17a757bae3f170eb46b772c220471cd8` |
| `core/autopilot` | `dsh-autopilot` | `0.1.0` | `c5c1c040f199ab0b6b84092d1853509d915c67c5` |

## Developer preview

zDSH tracks a harness that is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Installation

zDSH is distributed as source. Clone this repository and run the installer for your platform — it keeps all data inside the repository directory:

```sh
git clone https://github.com/zsagi1368/deepseek-harness-zDSH.git
cd deepseek-harness-zDSH
git checkout zdsh-latest

# Windows (PowerShell 5.1+)
.\install.cmd
# macOS / Linux / WSL / Git Bash
./scripts/install.sh
```

The installer checks the prerequisites (`Node.js ^22.19.0 || >=24.0.0` and `pnpm`), runs `pnpm install --frozen-lockfile` and `pnpm run build`, and generates:

- `data/` — the data home (`DSH_HOME`). Official module data and zDSH governance data (plugin registry, approval ledger, and installed plugins under `data/zdsh/`) are both kept here.
- `env.ps1` / `env.sh` — environment loaders that define `DSH_HOME`, `DSH_AGENTS_HOME`, and a `dsh` command pointing at the built CLI.

On the first boot, the governance preinstall hook automatically installs the factory plugin roster (see below).

## Run

Load the environment, then start the Web UI:

```sh
# PowerShell
. .\env.ps1
# bash
source ./env.sh

dsh web
```

`dsh web` starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser.

Alternatively, run straight from a checkout without the installer:

<a id="run-from-source"></a>

```sh
pnpm install
pnpm run build
pnpm dsh web
```

## Uninstall

Run the uninstaller for your platform from a repository checkout:

```sh
# Windows (PowerShell 5.1+)
.\uninstall.cmd
# macOS / Linux / WSL / Git Bash
./scripts/uninstall.sh
```

By default it removes every gitignored artifact inside the checkout (`node_modules`, build output, `data/`, `env.ps1` / `env.sh`), restoring a pristine checkout state — it never touches anything outside the repository directory. Additional options: `--purge` (PowerShell: `-Purge`) also deletes the whole repository directory afterwards; `--clean-legacy` (PowerShell: `-CleanLegacy`) also removes the legacy zDSH home directories (`~/.dsh-zdsh`, `~/.zdsh-workbench`, `~/.zdsh-plugin-center`). `~/.dsh` belongs to the official release and is only touched after explicit confirmation; the script never deletes `~/.agents` and only reports its presence.

## Factory plugin roster

zDSH ships in an **installed state**: the eight plugins below come pre-installed from the factory seed manifest ([`zdsh-factory/seed.json`](zdsh-factory/seed.json)) — the governance preinstall hook (`SeedPreinstaller`) installs and registers them automatically on the first boot. The governance surface can query, manage, and uninstall them, and an uninstalled factory plugin never resurrects on later boots (durable `userUninstalled` tombstone). Roster final state: **6 mounted / 2 skipped**.

| Plugin (id) | Package | Version | Enabled at boot | Role |
| --- | --- | --- | --- | --- |
| `core/webstack` | `dsh-webstack` | `0.2.0` | `true` | Three search tools (`web_backend_status` / `web_batch_search` / `web_history`) registered and callable out of the box; the coexist data plane sleeps on the host selector |
| `core/webstack-bridge` | `dsh-webstack-bridge` | `0.2.0` | `true` | Data-plane bridge of the webstack family |
| `core/omnivision` | `dsh-omnivision` | `0.1.0-alpha` | `true` | Vision capabilities |
| `core/filehub` | `dsh-filehub` | `0.1.0` | `true` | File hub |
| `core/plugin-center` | `dsh-plugin-center` | `0.2.0` | `true` | Plugin management center |
| `core/workbench` | `zdsh-workbench` | `0.1.0-beta.1` | `true` | IDE-grade dock workspace (files / editor / terminal / git / tasks / browse); the dock UI injects into the browser roster through its dsh.client face |
| `core/webstack-verticals` | `dsh-webstack-verticals` | `0.2.0` | `false` | Vertical-domain pack, opt-in by its own package description |
| `core/autopilot` | `dsh-autopilot` | `0.1.0` | `false` | Off by product design — the user opts in explicitly; a final factory posture, not pending wiring |

## zDSH enhancements

zDSH adds version-adaptive features on top of the official harness; each one probes the installed core and disables itself cleanly when the environment does not match, so an upstream drift never breaks the base product. Highlights:

- Model-slot routing system (`ctx.modelSlots`).
- Project-level plugin roots with host-clamped sandboxes (`ctx.projectPluginLayer`).
- Plugin governance (`ctx.pluginGovernance`).
- Self-contained install layout — all data stays inside the repository checkout.
- Factory preinstall: the seed manifest plus the governance preinstall hook install the eight-plugin roster on the first boot, fail-open per entry.
- Hardened plugin governance: `SymbolIsolationCheck` blocks governed-path plugin loads that resolve to duplicate physical copies (symbol-isolation breakage), preinstalls reuse the gateway admission channel, and the chaos matrix upholds the fail-open guarantee — a single crashing or malformed plugin never takes the others down.
- Security-audit remediation in one line: outbound fetches pass a four-gate SSRF defense (static validation, DNS resolution verification, per-hop redirect re-verification, bounded response body) with per-hop DNS address classification, and command carriers are absolutized (no bare-name spawns).

See the [zDSH subsystems guide](docs/subsystems/zdsh.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE). Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## About the upstream: DeepSeek Harness (official)

zDSH is a fork; the original project is [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) by [DeepSeek AI](https://deepseek.com). For the official release:

- **Official repository:** [github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- **Official documentation:** [deepseek-harness.github.io/deepseek-harness](https://deepseek-harness.github.io/deepseek-harness/)
- **Run from npm (official package):**

```sh
npx @deepseek-ai/dsh web
```

- **Official community and support:** submit feedback through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions), add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability, or join the [DeepSeek Harness Discord community](https://discord.gg/Ycq5dCaS4).
