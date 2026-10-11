# zDSH

English | [中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

zDSH is an enhanced fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the open-source agent harness developed by [DeepSeek AI](https://deepseek.com). It tracks the official upstream releases while adding version-adaptive enhancements that automatically disable themselves when they would conflict with the core environment.

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

This repository (`zsagi1368/deepseek-harness-zDSH`) is the zDSH fork. The active development branch is `zdsh-latest`, kept in sync with the latest official release.

## Versions

| Component | Version |
| --- | --- |
| Official base ([DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)) | `0.2.1-alpha.2` |
| zDSH release | `v0.2.1-alpha.2-zDSH20261011c` |

zDSH tracks the official `dsh-v0.2.1-alpha.2` baseline and re-syncs on every official release. zDSH version rule: `<official-version>-zDSH<date><revision-letter>`, where the date is the zDSH campaign close date (`20261011`) and the letter counts same-day revisions (`c`). The root `package.json` keeps the official base version untouched; the zDSH version is declared on this README surface and on the matching release tag.

## Upgrade notes

Upgrade notes are grouped by target base — read the subsection matching the release you are upgrading to. Each base-change item links its official migration guide under `docs/upgrade-guide/`.

### Upgrading to the 0.2.1-alpha.2 base

Upgrading from a `v0.2.0-rc.2-zDSH*` release moves the official base from `0.2.0-rc.2` to `0.2.1-alpha.2`, crossing both the `v0.2.0-rc.2` and `v0.2.1-alpha.1` official guide sets. The user-data and user-visible changes are collected below.

- **The runtime-invariant plugin architecture is removed.** The official base no longer publishes `@deepseek-ai/dsh-invariants`, `InvariantRegistry`, `InvariantInstaller`, `InvariantFailure`, `InvariantError`, or any `<package>/invariant` subpath, and the five `sdk-minimal` invariant rows are gone. A `cordis.yml`, profile patch, or `--patch` overlay that names a removed module fails to load it, a patch targeting one of the five ids logs `patch: entry <id> not found`, and TypeScript code importing the package or subpaths no longer compiles — delete those rows, patch entries, and imports. Source: [`remove-runtime-invariants`](docs/upgrade-guide/v0.2.0-rc.2/remove-runtime-invariants/guide.md).
- **Subagent delegation is now activation-based.** `run_in_background`, `backgroundMode`, and `enableRunInBackground` are removed; every delegation returns `{ kind: 'activation', subagentId }` and the final answer arrives as a parent completion notice. Foreground results and `{ kind: 'background', jobId }` returns are gone, and `job_output` / `job_kill` no longer collect or stop subagents — use `interrupt_agent` to stop the current execution, and `send_message` only for local children. Source: [`subagent-activations`](docs/upgrade-guide/v0.2.1-alpha.1/subagent-activations/guide.md).
- **Agent Teams messages go straight to the target inbox.** The pending-message limit (`maxPendingMessagesPerMember`) is removed, and `send_message` returns only `{ "sent": true }` — no message id, accepted, or queued status. Team messages queued before the upgrade are never dispatched, so explicitly resend anything still needed (check the target's history first to avoid duplicates). Roster and task state remain durable. Source: [`team-direct-inbox`](docs/upgrade-guide/v0.2.1-alpha.1/team-direct-inbox/guide.md).
- **Session working directories replace the built-in cwd configuration.** The loop's `{{cwd}}` prompt variable and the `cwd` config key on `dsh-subagent-acp` / `dsh-subagent-dsh-sdk` are removed; a prompt template that keeps an unresolved `{{cwd}}` fails before the model request. Change the execution directory with the `working_directory` tool and place a child with its start-request `cwd`; `Session.header.cwd` remains the original project identity, not the current directory. Source: [`working-directory`](docs/upgrade-guide/v0.2.1-alpha.1/working-directory/guide.md).
- **Claude Code and Codex bundles add a global delegation tool.** Selecting `dsh-subagent-claude-code` or `dsh-subagent-codex` now also registers `tool-subagent-claude-code` / `tool-subagent-codex` as host global tools, visible to every preset including `minimal`. Existing provider-only installs need **Update** in Plugins → Official to receive the tool-contributing bundle, and obsolete `backgroundMode` settings should be removed. Source: [`native-subagent-bundle-tools`](docs/upgrade-guide/v0.2.1-alpha.1/native-subagent-bundle-tools/guide.md).
- **The Web listener is fenced to a concrete local address.** `dsh web` rejects wildcard listener hosts (`0.0.0.0`, `::`) at load, because binding every interface exposes the port to the network — use one concrete IPv4/IPv6 address of a local interface (the default `127.0.0.1` is unaffected). Invocation trust moves from the `webRuntime` service to `webStartup`: overlays that `inject: [webRuntime]` or read `ctx.webRuntime.trustedHosts` must migrate, and `--trusted-host` authorities are read from `ctx.webStartup.trustedHosts`. Source: [`web-listener-trust-config`](docs/upgrade-guide/v0.2.1-alpha.1/web-listener-trust-config/guide.md).
- **Tool presentation accepts only `native` or `ptc`.** The `both` mode is rejected, including `DSH_TOOLS_MODE=both`; use `mode: native` for direct function calls or `mode: ptc` for `run_code` programs, and update `ctx.tools.presentAs('both')` callers. Different presets may keep different modes in one application. Source: [`tool-presentation-mode`](docs/upgrade-guide/v0.2.1-alpha.1/tool-presentation-mode/guide.md).
- **The Automation tasks bundle is retired and Schedule joins the Web composition.** Stored tasks and delivery records stay on disk and remain in use; `@deepseek-ai/dsh-web-app` mounts `schedule` / `ui-schedule` in every Web profile, and loading a profile rewrites its `package.json` to drop `@deepseek-ai/dsh-experimental-schedule-bundle` automatically (start `dsh` once per affected profile). A top-level `time-context` override no longer matches a row — delete it. Source: [`schedule-bundle-retired`](docs/upgrade-guide/v0.2.0-rc.2/schedule-bundle-retired/guide.md).
- **DeepSeek API-key models stay hidden until a credential exists.** The `deepseek-official` route returns an empty catalog without its key, so Desktop and Web hide the DeepSeek group; configure the key in Settings → Models or set the reference named by `apiKeyEnv` (default `DEEPSEEK_API_KEY`) in the launch environment. The account-login route is unchanged. Source: [`deepseek-model-discovery`](docs/upgrade-guide/v0.2.1-alpha.1/deepseek-model-discovery/guide.md).
- **New Session starts a fresh Agent.** In Web and Desktop, New Session no longer reuses an existing empty Session, which could retain an earlier preset definition; workspace reconnection (`openWorkspace` / `connectWorkspace`) still reuses an eligible blank. Existing Agents retain their preset composition. Source: [`new-session-generations`](docs/upgrade-guide/v0.2.1-alpha.1/new-session-generations/guide.md).
- **Custom SSH compositions migrate to explicit launch modes.** `dsh-ssh` replaces top-level `node`, `bootstrapPath`, and `bootstrapHash` with `launch`, and requires SSH protocol 2; update the installed helper, its hash, and the configuration together. Source: [`ssh-helper-launch`](docs/upgrade-guide/v0.2.1-alpha.1/ssh-helper-launch/guide.md).
- **Python PTC runs are sandboxed, and optional runtime resources download explicitly.** It applies the shared `sandbox` / `sandboxPolicy` to every program (a restricted run fails with `sandbox-unavailable` when confinement cannot be established); Python runtime wheels no longer bundle the Office sidecar or the authoring environment, so call `deepseek_harness_runtime.download_office()` / `download_primary_runtime()` before use; and bundled NumPy and pandas omit their upstream test suites — run those imports in a separate environment. Sources: [`python-ptc-sandbox`](docs/upgrade-guide/v0.2.1-alpha.1/python-ptc-sandbox/guide.md), [`python-optional-resources`](docs/upgrade-guide/v0.2.1-alpha.1/python-optional-resources/guide.md), [`bundled-python-tests`](docs/upgrade-guide/v0.2.0-rc.2/bundled-python-tests/guide.md).
- **Optional capability packages require explicit installation.** Hook bridges, webhook packages, Ralph rows, and the skill badge are no longer installed or composed by default: add the packages with their required peers (for example `dsh plugin --profile web add @deepseek-ai/dsh-hooks-claude-code @deepseek-ai/dsh-hook-protocol`) and select a bundle before overriding its rows. Source: [`experimental-package-composition`](docs/upgrade-guide/v0.2.1-alpha.1/experimental-package-composition/guide.md).
- **Smaller config and CLI changes.** `agent-instructions` no longer accepts `dshHome` — set `DSH_HOME` instead; `dsh plugin` reads `--profile` only before the forwarded pnpm arguments (`dsh plugin --profile web add <package>`); account sign-in transport failures now report `no-response` instead of `network`; and Desktop test builds keep update-policy authentication dialogs disabled unless `updates.allowTestAuthPopupWindow` is set in `desktop/settings.json`. Sources: [`instruction-home-override`](docs/upgrade-guide/v0.2.1-alpha.1/instruction-home-override/guide.md), [`plugin-option-placement`](docs/upgrade-guide/v0.2.1-alpha.1/plugin-option-placement/guide.md), [`account-sign-in-errors`](docs/upgrade-guide/v0.2.0-rc.2/account-sign-in-errors/guide.md), [`desktop-test-auth-popup`](docs/upgrade-guide/v0.2.1-alpha.1/desktop-test-auth-popup/guide.md).
- **zDSH keeps the invariant type chain but does not mount the runtime registry.** The `dsh-invariants` package and the four self-authored `./invariant` companions (`dsh-model-slots`, `dsh-plugin-governance`, `dsh-plugin-project-root`, `dsh-compat`) remain in the tree and keep compiling; no shipped bundle mounts `ctx.invariants`, so the runtime diagnostics surface stays unwired — the official retire is accepted as-is. Source: [`packages/runtime-diagnostics/invariants/README.md`](packages/runtime-diagnostics/invariants/README.md).
- **zDSH session-title slot routing keeps working.** The `title` model slot (`ctx.modelSlots`) still routes auxiliary title calls; `dsh-session-title-llm` was migrated to the official `executeSessionTitleLlm` provider API in this sync, and its suite passes (21 tests). Custom title providers built on `registerSessionTitleLlmProvider` must move to a direct `ctx.sessionTitle.register()` plus `executeSessionTitleLlm`. Sources: [`dsh-model-slots`](packages/llm/model-slots/README.md), [`dsh-session-title-llm`](packages/session/session-title-llm/README.md), [`session-title-provider-strategy`](docs/upgrade-guide/v0.2.1-alpha.1/session-title-provider-strategy/guide.md).
- **The factory pins are not yet rotated to the alpha.2 base.** [`zdsh-factory/seed.json`](zdsh-factory/seed.json) still carries the value-rotated anchors from the previous sync campaign (the `0.2.0-rc.2`-base pins); the pin rotation to alpha.2-adapted anchors is in progress and lands as a separate change. The eight-plugin roster and its 6 mounted / 2 skipped posture are unchanged.

### Upgrading to the 0.1.7-rc.2 base

Upgrading from a `v0.1.5-rc.2-zDSH*` release moves the official base from `0.1.5-rc.2` to `0.1.7-rc.2`. Read this subsection before upgrading — it covers the user-data surface.

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

- **Official community and support:** submit feedback through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions), add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability, or join the [DeepSeek Harness Discord community](https://discord.gg/4MrtZUhpxg).
