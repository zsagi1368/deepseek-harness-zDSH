---
description: "The compat group map: the version-adaptive probing shim that lets fork feature packages gate their own registration against the official core."
kind: "package-group"
---

# packages/compat

English | [中文](README.zh.md)

## Summary

The compat group owns the version-adaptive machinery for fork/upstream drift: `dsh-compat` is the single layer allowed to dynamically probe the official core API shape, and every zDSH feature package gates its own registration through it instead of throwing during a partially-loaded or upstream-drifted boot. The shim carries zero runtime dependencies and records every guarded feature verdict in a process-level audit roster.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`dsh-compat/`](dsh-compat/README.md) | Dynamic API-shape probing (`probeSymbol`), feature guards (`guardFeature`), and the process-level compat roster |

-----

<a id="related-documentation"></a>
## Related documentation

- [zDSH enhanced services subsystem](../../docs/subsystems/zdsh.md) — the guarded feature seams these packages enable and the guard semantics they share.

-----
