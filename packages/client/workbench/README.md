---
description: "IDE-grade dock workspace for the DSH web face: files, editor, terminal, git, tasks, and browse panels behind one registry service."
kind: "package-reference"
---

# zdsh-workbench

English | [中文](README.zh.md)

## Summary

The workbench is an IDE-grade dock workspace for the DSH web face. One registry service (`ctx.workbench`) hosts the file workspace, terminal, git center, task center, and browse panels that other plugins extend. Choose it when the web client should offer a persistent, dockable developer workspace instead of one-shot tool calls.

## Table of Contents

- [Planning status](#planning-status)
- [Install](#install)
- [Version adaptation (compat guard)](#version-adaptation-compat-guard)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="planning-status"></a>
## Planning status

Scaffold milestones in progress:

- M1 shell skeleton: host routes + client panel registry + dock framework
- M2 file workspace (explorer / editor / previewer / watcher)
- M3 terminal (node-pty + xterm.js + model tool)
- M4 Git center · M5 task center · M6 browse + side chat · M7 polish · M8 release

The full design lives in `docs/PLAN.md` (synced from the R&D plan P01).

<a id="install"></a>
## Install

```sh
git clone https://github.com/zsagi1368/zdsh-workbench.git
cd zdsh-workbench && pnpm install && pnpm build
# add to ~/.dsh/profiles/web/package.json dependencies:
#   "zdsh-workbench": "link:<absolute repo path>"
# append the mount line in ~/.dsh/profiles/web/cordis.patch.yml, then pnpm install
```

## License

MIT

<a id="version-adaptation-compat-guard"></a>
## Version adaptation (compat guard)

The workbench gates its own registration through `@deepseek-ai/dsh-compat`'s `guardFeature` (`guardWorkbench` in `src/compat.ts`), probing the peer symbol it depends on before registering:

- `cordis:Service` — `@deepseek-ai/cordis` must export a callable `Service`.

When the probe fails, the guard logs a warning and returns `false`, so the workbench skips registration instead of throwing. It never throws and never breaks the host tree: a partially-loaded or upstream-drifted host simply boots without the workbench.

<a id="model-experience"></a>
## Model Experience

### IDE dock

#### What the model sees

`ctx.workbench` service key routes to host `reveal`: the model triggers file-system operations through tool entries, and layout state persists across sessions.

##### Reveal routing

```markdown
ctx.workbench.reveal(path) -> host reveal/open
```

#### Token effect

File entity views are assembled on demand; no fixed prompt text is injected.

#### KV Cache effect

None: layout and tab state live in the client session.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Vendored as a standalone dock, not deeply integrated with the Fork main tree's side-chat/session scoping yet.
- Depends on a host-side seam; degrades gracefully to an empty panel when unmounted.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open design questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Note.

#### Future: side-chat and session scoping

The dock currently ships standalone. A future milestone ties the browse and side-chat panels into the Fork main tree's session scope, sharing one conversation model across dock and main panes.

**Runtime invariant:** No companion is published because the dock is a stateless UI host over host-owned seams; layout and filesystem interactions are pinned by the package's own test suites, leaving no background stream or durable state to assert against.

</details>
