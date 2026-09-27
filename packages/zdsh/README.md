---
description: "The zdsh group map: the fork's self-developed base — the version-adaptive compat shim, the host-side governance kernel and its host service face, the project-level plugin root, and the private factory bundle pinning every factory-seeded plugin."
kind: "package-group"
---

# packages/zdsh

English | [中文](README.zh.md)

## Summary

The zdsh group is the namespace of the zDSH self-developed base: every package this fork adds on top of the official core lives here (conservation metric: 100% of the self-developed surface under `packages/zdsh/*`). The group unifies four surfaces. The version-adaptive probing shim (`dsh-compat`) is the single layer allowed to dynamically probe the official core API shape; every zDSH feature package gates its own registration through it instead of throwing during a partially-loaded or upstream-drifted boot, and every verdict is recorded in a process-level audit roster. The governance kernel (`plugin-governance`: `LoadGuard`/`RunGuard`/`HealthGuard` over the registry mirror) and its host service face (`plugin-governance-host`: gateway, remote vocabulary, and the seed preinstaller for factory artifacts) own the surfaces third-party extensions flow through. The project-level plugin root (`plugin-project-root`) discovers plugins from `<projectRoot>/.dsh/plugins`, host-clamps their sandboxes, gates them through a durable trust ledger, and mounts them post-boot as an isolated Cordis layer. The private factory assembly bundle (`factory-bundle`) pins the git URL + full commit of every factory-seeded plugin so one `pnpm install` lands each artifact in the workspace closure for the governance preinstall executor.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`dsh-compat/`](dsh-compat/README.md) | Dynamic API-shape probing (`probeSymbol`), feature guards (`guardFeature`), and the process-level compat roster; zero runtime dependencies | — (process-level roster) |
| [`plugin-governance/`](plugin-governance/README.md) | Governance spec and kernel: spec, registry, guards, sandbox, Cordis adapter, and persistence | `ctx.pluginGovernance` (host remote via `plugin-governance-host`) |
| [`plugin-governance-host/`](plugin-governance-host/README.md) | Host service face: governance gateway (`PluginGovernanceGateway`), remote vocabulary (`/types` `/typert` `/remote`), and the factory seed preinstaller | — (host service) |
| [`plugin-project-root/`](plugin-project-root/README.md) | Project-level plugin discovery, host clamping, gating, trust ledger, and post-boot layer mounting | `ctx.projectPluginLayer` |
| [`factory-bundle/`](factory-bundle/README.md) | Private manifest: git URL + full commit pins for the seven factory-seeded plugins (`@deepseek-ai/zdsh-factory-bundle`); unpublished, no executable source | — (dependency manifest) |

-----

<a id="related-documentation"></a>
## Related documentation

- [zDSH enhanced services subsystem](../../docs/subsystems/zdsh.md) — the plugin governance gateway, project plugin layer, and factory preinstall spectrum these packages provide, with the guard and sandbox semantics.

-----
