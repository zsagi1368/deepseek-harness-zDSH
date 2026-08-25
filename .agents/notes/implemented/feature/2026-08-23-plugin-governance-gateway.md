# Agent Note: Expose plugin governance through a host gateway service

Status: implemented

English | [中文](2026-08-23-plugin-governance-gateway.zh.md)

## Problem

The governance system (spec, registry, guards, sandboxes, Cordis adapter, persistence) shipped as source without a host-plane surface: nothing instantiated its registry in a live profile, so roster, lifecycle, health, admission, and preset operations were unreachable for clients, and the package itself was invisible to the workspace build graph (`packages/plugins/*` had no conforming directory name or build wiring).

## Decision

A new host package, `@deepseek-ai/dsh-host-plugin-governance` at `packages/host/plugin-governance-host/`, registers a `pluginGovernance` Cordis service (`PluginGovernanceGateway extends TypertRemoteService`) and publishes direct Remotes: `list`, `get`, `enable`, `disable`, `health`, `approve`, `presetSave`, `presetLoad`, `presetDelete`. It is mounted as the `plugin-governance` entry in the `web-app` bundle patch, beside `plugin-inventory`.

Admission is fail-closed: manifests without an explicit permission level require an operator decision recorded in a durable approvals ledger; `autoApprove` manifests bypass it. Status mutations snapshot the registry through the governance persistence before the receipt returns and are compensated on IO failure, so memory and disk never disagree behind an acknowledged call. Presets capture only active/disabled operator decisions; runtime statuses stay out.

`install`/`uninstall` return `not-implemented`: admitting third-party code requires the guarded download-and-admit pipeline and is deliberately out of scope until that pipeline exists.

Directory placement follows the repository's source-mapping convention: both new packages live at `packages/<group>/<package-name>/src` matching their `@deepseek-ai/dsh-<name>` names, and the `plugins` group was registered in the base `paths` mapping. Bare directories under `packages/*/*` crash the tsdown workspace batch and are rejected.

## Scope

Directory placement follows the repository's source-mapping convention: both new packages live at `packages/<group>/<package-name>/src` matching their `@deepseek-ai/dsh-<name>` names, and the `plugins` group was registered in the base `paths` mapping. Bare directories under `packages/*/*` crash the tsdown workspace batch and are rejected.

The gateway drives the governance registry only. Loader-level install/uninstall flows, a client settings surface consuming these Remotes, and OS-keychain credential storage remain future work.

## Alternatives considered

- **Extend the governance package in place with host-facing methods** — rejected: the repo splits model/spec packages from host/user-facing seams (`packages/plugins/*` vs `packages/host/*`), and the governance package owns no Cordis face; a host package keeps the seam boundary and the remote surface local to the host.
- **Plain Cordis RPC instead of Typert-generated Remotes** — rejected: the rest of the host surface publishes typed Remotes (plugin-inventory pattern), and the client runtime consumes the same double-envelope decode path.
- **Namespace mirroring only (no native install/uninstall)** — accepted as the shipping constraint: Loader mirroring covers mounted entries, while `install`/`uninstall` stay `not-implemented` until the guarded download-and-admit pipeline exists.

## Consequences

The gateway mounts a seventh host service and adds durable approvals/preset state to the governance persistence, snapshot-compensated like every other acknowledged mutation. `install`/`uninstall` remain explicit gaps rather than half-built downloaders, and the settings surface consuming these Remotes is still future work — the remote contract ships ahead of its only UI.
