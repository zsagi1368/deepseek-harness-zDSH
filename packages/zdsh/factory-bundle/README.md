---
description: "Private factory artifact bundle: pins the git URL + commit for every zDSH factory-seeded plugin so one pnpm install lands each artifact in the workspace closure for the governance preinstall executor."
kind: "package-reference"
---

# @deepseek-ai/zdsh-factory-bundle

English | [中文](README.zh.md)

## Summary

Declare, as git URL + full commit pins, every plugin the zDSH factory seeds at first boot. The governance `SeedPreinstaller` admits each pinned artifact in place through the existing `install({ source: 'local:<dir>' })` channel; this package never moves, copies, or deletes the artifacts. Its only consumer is the factory preinstall pass, and its smallest entry point is one `dependencies` row. The factory set now pins seven artifacts: `dsh-webstack-verticals` (the factory-off pilot), `dsh-omnivision` (boot-enabled), `dsh-webstack-bridge` (boot-enabled webstack data-plane link), `dsh-filehub` and `dsh-plugin-center` (both boot-enabled since TC-B4-RA-2: the R-A loader-side harness proved their mount, including the RA1c optional-llm guard and the RA1d disposal wiring at pin aab73d7, so the factory boots them ready-to-use), plus `dsh-autopilot` — `enabledAtBoot: false` as a product-design default-off (ADJ-3: the whole engine ships disabled and is turned on explicitly by the user), which does not flip with the R-A harness. TC-B4-W3 adds `dsh-webstack` — the aggregation-kernel package of the WebStack monorepo, boot-enabled per the W-DEC ruling: its three tools (`web_backend_status`, `web_batch_search`, `web_history`) register at first boot, while the coexist data plane stays dormant behind the host's pinned web selectors (`deepseek-official`/`http`), so shipping it changes no search/fetch routing until an explicit takeover.

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
- A git dependency clones the repository root, so `dsh-webstack-verticals`, `dsh-webstack-bridge` and `dsh-webstack` all resolve to the WebStack monorepo and the seed's `local:` sources point at its `packages/verticals`, `packages/bridge` and `packages/webstack` subdirectories respectively; `dsh-omnivision`, `dsh-filehub`, `dsh-plugin-center` and `dsh-autopilot` are single-package repositories, so their sources point straight at `node_modules/<pkg>`.
- Seven artifacts are pinned (verticals + omnivision + bridge + filehub + plugin-center + autopilot + webstack); the boot posture spectrum is five mounted (omnivision + bridge + filehub + plugin-center + webstack — filehub/plugin-center flipped `enabledAtBoot: true` by TC-B4-RA-2 after the full R-A preconditions went green; webstack was seeded boot-enabled by TC-B4-W3 per the W-DEC ruling, only after the W1/W1b/W1c source-fix chain went green — never seed a boot-enabled row ahead of its source fixes) and two skipped (verticals, opt-in per its own package docs; autopilot, product-design default-off per ADJ-3); the remaining intake plugins are added in later batches.
- SSRF duty split (dual track): requests flowing through the webstack fetch/render path are guarded by the plugin's own `checkTarget` gate (`safety/ssrf.ts`, fail-closed on the resolved IP); requests flowing through the host's built-in http fetch path are guarded by the platform's four-gate chain (policy/network/provider per-hop + bounded body). The bridge's JS-render fallback reuses the plugin gate through its `dsh-webstack` peer import (fail-closed when the peer is absent).

### Dev Note

Adding a dependency here is a supply-chain change: it must carry a 40-hex commit pin (never a branch or floating range), and every new entry needs a matching `zdsh-factory/seed.json` row and a Gate-P probe.
