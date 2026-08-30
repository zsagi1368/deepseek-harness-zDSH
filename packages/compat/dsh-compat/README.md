# @deepseek-ai/dsh-compat

English | [中文](README.zh.md)

Version-adaptive shim framework for fork/upstream drift in the DeepSeek Harness. It is the single layer allowed to dynamically probe the official core API shape; every other zDSH feature package gates its own registration against the symbols it depends on and auto-disables when a conflict is detected, instead of throwing during a partially-loaded or upstream-drifted boot. `dsh-compat` carries zero runtime dependencies and is used by seven feature packages today (`dsh-acp`, `ui-settings-models`, `workbench`, `dsh-llm`, `dsh-model-slots`, `dsh-plugin-governance`, `dsh-plugin-project-root`).

## API

### probeSymbol

`probeSymbol<T>(specifier, symbol, shape?)` dynamically imports `specifier` and reports whether `symbol` is exported and passes the optional `shape` validator. It never throws; every failure is classified into one of four `ProbeReason` values:

- `module-not-found` — the specifier cannot be resolved (not installed / not exported).
- `symbol-missing` — the module imports, but the named export is absent.
- `shape-mismatch` — the symbol exists but fails the shape check.
- `import-threw` — the dynamic import itself threw (module evaluation error, etc.).

```ts
const result = await probeSymbol('node:fs', 'readFile', (v: unknown) => typeof v === 'function')
// present === true, value is the readFile function
```

### memberOf

`memberOf<T>(namespace, symbol)` reads an already-loaded module namespace synchronously (no dynamic import), for static-alias scenarios. Returns the symbol value or `undefined`.

```ts
const value = memberOf({ answer: 42 }, 'answer')
// value === 42
```

### versionOf

`versionOf(packageName)` reads the `version` field of an installed package from the host side; returns `undefined` instead of throwing on any failure. Used to distinguish version tiers (e.g. official `0.1.2-alpha.1` vs zDSH `0.1.1-rc.2`).

```ts
const version = await versionOf('@deepseek-ai/dsh-llm')
// version === '0.1.1-rc.2'
```

### guardFeature

`guardFeature(featureId, options)` runs before a fork feature registers itself. `deps` (dependency probes) run first, then `check` (conflict checks); the first failure disables the feature and short-circuits the remaining checks. A warning is logged as `[compat] <logPrefix> disabled: <failures>` and the verdict is recorded in the process-level roster. It never throws — a throwing `run` counts as a failure with reason `threw:<message>`.

```ts
import { consoleCompatLogger, guardFeature } from '@deepseek-ai/dsh-compat'

const verdict = await guardFeature('dsh-project-root', {
  deps: [
    {
      name: 'cordis:Service',
      run: async () => {
        const { Service } = await import('@deepseek-ai/cordis')
        return typeof Service === 'function' ? null : 'Service not a function'
      },
    },
  ],
  logger: consoleCompatLogger(),
})
if (!verdict.enabled) {
  // skip registration; verdict.reason / verdict.failures explain why
}
```

### getCompatRoster

`getCompatRoster()` returns a read-only snapshot of the process-level audit roster: for every guarded feature id, `{ enabled, reason, checkedAt }`. Mutating the snapshot does not affect future checks.

```ts
const roster = getCompatRoster()
const entry = roster.get('dsh-model-slots')
// entry?.enabled, entry?.reason, entry?.checkedAt
```

## Design constraints

- Zero runtime dependencies: `package.json` declares an empty `dependencies` field.
- `dsh-compat` is the only layer allowed to perform dynamic probing of the official core API; consumers register through `guardFeature` and never probe on their own.