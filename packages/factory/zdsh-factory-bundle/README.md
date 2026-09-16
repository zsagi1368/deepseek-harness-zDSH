---
description: "Private factory artifact bundle: pins the git URL + commit for every zDSH factory-seeded plugin so one pnpm install lands each artifact in the workspace closure for the governance preinstall executor."
kind: "package-reference"
---

# @deepseek-ai/zdsh-factory-bundle

English | [中文](README.zh.md)

## Summary

Declare, as git URL + full commit pins, every plugin the zDSH factory seeds at first boot. The governance `SeedPreinstaller` admits each pinned artifact in place through the existing `install({ source: 'local:<dir>' })` channel; this package never moves, copies, or deletes the artifacts. Its only consumer is the factory preinstall pass, and its smallest entry point is one `dependencies` row. The factory set now pins six artifacts: `dsh-webstack-verticals` (the factory-off pilot), `dsh-omnivision` (boot-enabled), `dsh-webstack-bridge` (boot-enabled webstack data-plane link), `dsh-filehub` and `dsh-plugin-center` (both pinned installed-but-held, `enabledAtBoot: false`, a harness-honest posture: their mount layer awaits the R-A loader-side harness before the seed posture flips), plus `dsh-autopilot` — also `enabledAtBoot: false`, but this one is product-design-off (ADJ-3: the whole engine ships disabled and is turned on explicitly by the user), not a harness wait; its posture does not flip with the R-A harness.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

Add a `<package-name>: git+https://…#<40-hex commit>` row under `dependencies`, then run `pnpm install`; the artifact lands under this package's `node_modules` closure. Point a matching `zdsh-factory/seed.json` entry's `source` at the resolved directory. The pilot probe lives in `tests/gate-p.spec.ts`.

## Model Experience

None, as this is a private dependency manifest that registers nothing model-facing.

#### KV Cache effect

Nothing here enters a request prefix, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- No runtime invariant companion is published; this package is a private dependency manifest with no executable source and no mutable runtime state to assert invariants over.
- A git dependency clones the repository root, so `dsh-webstack-verticals` resolves to the WebStack monorepo and the seed's `local:` source points at its `packages/verticals` subdirectory; `dsh-omnivision`, `dsh-filehub`, `dsh-plugin-center` and `dsh-autopilot` are single-package repositories, so their sources point straight at `node_modules/<pkg>`.
- Six artifacts are pinned (verticals + omnivision + bridge + filehub + plugin-center + autopilot); filehub and plugin-center ride the harness-honest held posture (`enabledAtBoot: false`) until the R-A loader-side harness accepts their mount, while autopilot's `enabledAtBoot: false` is a product-design default-off (ADJ-3) that does not flip with that harness; the remaining intake plugins are added in later batches.

### Dev Note

Adding a dependency here is a supply-chain change: it must carry a 40-hex commit pin (never a branch or floating range), and every new entry needs a matching `zdsh-factory/seed.json` row and a Gate-P probe.
