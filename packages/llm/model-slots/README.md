---
description: "Cordis service giving every auxiliary side-task model call one shared routing vocabulary: pinned slots, a deployment fallback, and durable dispatch attribution."
kind: "package-reference"
---

# `@deepseek-ai/dsh-model-slots`

English | [中文](README.zh.md)

## Summary

Cordis service (`ctx.modelSlots`) that gives every auxiliary side-task model call one shared routing vocabulary. A deployment names an exact `provider`/`model` route per built-in slot — today `title` (conversation-title generation) and `compaction.summarize` (context-compaction summarization) — instead of each consumer inventing its own configuration keys and fallback dialect.

```yaml
- id: model-slots
  name: '@deepseek-ai/dsh-model-slots'
  config:
    slots:
      title:
        provider: deepseek-official
        model: deepseek-v4-flash
    fallback:
      provider: deepseek-official
      model: deepseek-v4-flash
```

`slots.<id>` pins one slot; `fallback` is the deployment default applied to any slot without its own entry. Every value must be a complete non-empty pair, so a half-configured slot cannot resolve to an accidental target. Slot ids are validated against the built-in vocabulary at load time, which turns a typo such as `tittel:` into a boot failure instead of silently ignored configuration.

Consumers call `resolve(slot, input)` immediately before dispatching an auxiliary request. The precedence is fixed:

1. the slot's own explicit statement (`source: 'slot'`),
2. the deployment default (`source: 'deployment-default'`),
3. the conversation's main-model route supplied by the caller as `mainRoute` (`source: 'main-route'`),

and `resolve()` returns `null` when no tier can supply a route. Each successful resolution with a `session` sink appends the durable log-only event `slots/dispatch` carrying `{ slot, provider, model, source }` before the caller dispatches, so every auxiliary call is attributable to the exact route it actually used — including the case where the configured cheap slot was unavailable and the main model served the request.

The separately published `./invariant` companion validates every durable `slots/dispatch` record against the closed slot vocabulary and resolution tiers, both for sessions loaded at registration time and for records appended afterwards.

Programmatic registration through `register(slot, route)` serves tests and future in-process wiring. It may not override a configuration-pinned slot, rejects duplicate live registrations, and returns a disposer whose removal respects later re-registrations.

## Table of Contents

- [Version adaptation (compat guard)](#version-adaptation-compat-guard)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="version-adaptation-compat-guard"></a>
## Version adaptation (compat guard)

The feature gates its own registration through `@deepseek-ai/dsh-compat`'s `guardFeature` (`guardModelSlots` in `src/compat.ts`), probing the peer symbols it depends on before registering:

- `cordis:Service` — `@deepseek-ai/cordis` must export a callable `Service`.
- `settings:SettingsProvider` — `@deepseek-ai/dsh-settings` must export `SettingsProvider` whose prototype provides `register` (as of alpha.4 `installSettingsSection` is removed; settings sections register through `settings.register()` via `ctx.inject(['settings'])`).

When any probe fails, the guard logs a warning and returns `false`, so the feature skips registration instead of throwing. It never throws and never breaks the host tree: a partially-loaded or upstream-drifted host simply boots without the feature.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the consumers that resolve their auxiliary dispatch route here: this service only selects the provider/model pair a side-task request uses, while request assembly and the provider adapters own everything the model sees.

#### KV Cache effect

The resolution itself sends no request and changes no context. The selected route decides which provider cache an auxiliary call lands in: a stable per-slot statement keeps successive auxiliary requests on one warm route, while an absent statement follows the conversation's main-model route and shares its cache behavior. A configuration change re-points later auxiliary calls and invalidates whatever prefix reuse the previous route held; the `slots/dispatch` record is log-only and never enters model context.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Slot ids are a closed built-in set** — deployments cannot name custom slots yet because the vocabulary grows only with reviewed consumers; adding `vision` or `plan` slots is deferred until their routing integration lands.
- **No settings-mirror tier** — slot routes live in composition (cordis patch rows); a user-facing settings layer with higher priority than composition is deferred pending the S-45 UI milestone, and project-level overrides remain out of scope pending security review.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open design questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Note.

#### Future: a settings-mirror resolution tier

Slot routes live in composition only. A user-facing settings tier (S-45) would insert between the slot statement and the deployment default; whenever it lands, `resolve()`'s documented precedence and the closed `slots/dispatch` payload must both be extended in the same change so sessions stay replayable.

</details>
