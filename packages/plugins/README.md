---
description: "The plugins group map: the host-side governance kernel and the project-level plugin root that mount third-party extensions under guard."
kind: "package-group"
---

# packages/plugins

English | [中文](README.zh.md)

## Summary

The plugins group owns the two host-side surfaces third-party extensions flow through: the governance kernel (`LoadGuard`/`RunGuard`/`HealthGuard` over the registry mirror) and the project-level plugin root, which discovers plugins from `<projectRoot>/.dsh/plugins`, host-clamps their sandboxes, gates them through a durable trust ledger, and mounts them post-boot as an isolated Cordis layer.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`plugin-governance/`](plugin-governance/README.md) | Governance spec and kernel: spec, registry, guards, sandbox, Cordis adapter, and persistence | `ctx.pluginGovernance` (host remote via `plugin-governance-host`) |
| [`plugin-project-root/`](plugin-project-root/README.md) | Project-level plugin discovery, host clamping, gating, trust ledger, and post-boot layer mounting | `ctx.projectPluginLayer` |

-----

<a id="related-documentation"></a>
## Related documentation

- [zDSH enhanced services subsystem](../../docs/subsystems/zdsh.md) — the plugin governance gateway and project plugin layer these packages provide, with the guard and sandbox semantics.

-----
