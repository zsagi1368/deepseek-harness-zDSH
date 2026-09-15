---
description: "Private factory artifact bundle: pins the git URL + commit for every zDSH factory-seeded plugin so one pnpm install lands each artifact in the workspace closure for the governance preinstall executor."
kind: "package-library"
---

# @deepseek-ai/zdsh-factory-bundle

English | [中文](README.zh.md)

## Summary

Declare, as git URL + full commit pins, every plugin the zDSH factory seeds at first boot. The governance `SeedPreinstaller` admits each pinned artifact in place through the existing `install({ source: 'local:<dir>' })` channel; this package never moves, copies, or deletes the artifacts. Its only consumer is the factory preinstall pass, and its smallest entry point is one `dependencies` row. Batch 1.3 pilots a single artifact, `dsh-webstack-verticals`.

## Use this package

Add a `<package-name>: git+https://…#<40-hex commit>` row under `dependencies`, then run `pnpm install`; the artifact lands under this package's `node_modules` closure. Point a matching `zdsh-factory/seed.json` entry's `source` at the resolved directory. The pilot probe lives in `tests/gate-p.spec.ts`.

## Model Experience

None, as this is a private dependency manifest that registers nothing model-facing.

#### KV Cache effect

Nothing here enters a request prefix, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- No runtime invariant companion is published; this package is a private dependency manifest with no executable source and no mutable runtime state to assert invariants over.
- A git dependency clones the repository root, so `dsh-webstack-verticals` resolves to the WebStack monorepo and the seed's `local:` source points at its `packages/verticals` subdirectory.
- Only the batch-1.3 pilot artifact is pinned; the remaining intake plugins are added in later batches.

### Dev Note

Adding a dependency here is a supply-chain change: it must carry a 40-hex commit pin (never a branch or floating range), and every new entry needs a matching `zdsh-factory/seed.json` row and a Gate-P probe.
