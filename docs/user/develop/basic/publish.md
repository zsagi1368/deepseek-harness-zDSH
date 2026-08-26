# Package and install a plugin

English | [中文](publish.zh.md)

The previous tutorials loaded a local plugin through a `--patch` overlay. This tutorial packages it as an installable **bundle**, installs it into a **profile** with `dsh plugin add`, and explains the layer order that determines the composed configuration. It assumes the `dsh` CLI is installed. Complete [plugin configuration](./config.md) first.

To use a fresh source checkout instead, complete the [run-from-source section](../../../../README.md#run-from-source), keep this tutorial's `hello-plugin` directory at the repository root, and run the remaining `dsh ...` commands from there as `pnpm dsh ...`. See [source execution](../../../../apps/cli/reference/README.md#source-execution) for build and launcher behavior.

## Two concepts, two manifests

Installation is built on two concepts. Both are described by a `package.json`, but they carry different kinds of manifest under the `dsh` key, and they answer different questions:

- A **bundle** is an npm package that ships a configuration layer. Its manifest declares `dsh.bundle`, answering "what does this package contribute?": a patch file that inserts or overrides plugin rows.
- A **profile** is a directory under `$DSH_HOME/profiles/<name>` describing one runnable composition. Its manifest declares `dsh.profile`, answering "which bundles compose this setup, in what order?".

A bundle is what you author and distribute; a profile is what a user boots with `dsh --profile <name>`. Nothing is both.

### The bundle manifest

Create the package directory:

```sh
mkdir -p hello-plugin
```

```
hello-plugin/
├── package.json       # declares dsh.bundle
├── cordis.patch.yml   # the layer applied when a profile lists this bundle
└── index.js           # plugin modules the patch rows reference
```

Create `hello-plugin/package.json`:

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

Create `hello-plugin/index.js` with the plugin entry point:

```js
export const name = 'hello-plugin'

export function apply() {
  console.log('[hello-plugin] plugin loaded!')
}
```

Create `hello-plugin/cordis.patch.yml`. The patch is a YAML array like the `--patch` overlays you have been writing, except plugin rows reference the package by name instead of a relative source path so Node resolution finds the installed code:

```yaml
- insert:
    - id: hello
      name: dsh-hello-plugin
```

A package without the `dsh.bundle` declaration still installs, but only as a plain dependency: `dsh plugin` prints a warning and activates no layer. Use that package format for a library that plugin packages import rather than a plugin users enable.

### The profile manifest

A profile directory holds two files:

- `package.json` — the profile's out-of-tree plugin dependencies (managed by pnpm) plus the `dsh.profile` manifest with its ordered `bundles` list.
- `cordis.patch.yml` — the user's own patch layer, applied after every bundle layer.

You never write a profile manifest by hand: `dsh plugin` creates and maintains it. The next section shows the result.

## Install into a profile

`dsh plugin --profile <name> <args...>` forwards to pnpm in the profile directory, so every pnpm verb works. From the directory that contains `hello-plugin`, install the package checkout:

```sh
dsh plugin --profile demo add ./hello-plugin
```

The first use initializes the profile (with `@deepseek-ai/dsh-base` as its first bundle), pnpm links the checkout, and `dsh` appends the bundle to `dsh.profile.bundles` because the package declares `dsh.bundle`:

```json
{
  "name": "dsh-profile-demo",
  "private": true,
  "dependencies": {
    "dsh-hello-plugin": "link:/path/to/hello-plugin"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "dsh-hello-plugin"
      ]
    }
  }
}
```

Verify the layer without booting, then boot:

```sh
dsh --profile demo --dump-config   # shows a "# == dsh-hello-plugin" layer
dsh --profile demo
```

`dsh plugin --profile demo remove dsh-hello-plugin` removes both the dependency and the layer.

## The loading order

The effective configuration composes over an empty root by applying, in order:

1. Each bundle patch named in the profile's `dsh.profile.bundles` list, in list order — `@deepseek-ai/dsh-base` first, then each installed bundle in the order it was added.
2. The profile's own `cordis.patch.yml`.
3. The home-level `$DSH_HOME/cordis.patch.yml` — machine-local preferences shared by every profile.
4. Each `--patch <path>` overlay, in argv order.

App arguments are not another patch layer. A surface bundle can resolve them through an ordinary app-owned service, described below.

Later layers win per row, and a patch replaces a row's entire `config` value rather than deep-merging keys. Two consequences for bundle authors:

- Your patch can override rows from earlier layers by `id` — the same way [the `dsh-web-app` bundle](../../../../packages/bundle/web-app/cordis.patch.yml) overrides `dsh-base` rows — but must restate every key the row needs, not just the changed one.
- Users can override your rows in their profile's `cordis.patch.yml` without touching your package, so prefer configuration defaults users are likely to keep and let the schema carry the rest.

In-box bundle names always resolve from the dsh installation itself; pnpm manages only out-of-tree packages, so your bundle can rely on `@deepseek-ai/dsh-base` being present and current.

## Give a surface bundle its own command line

A bundle that defines a runnable app mounts an ordinary provider plugin:

```yaml
- id: hello-startup
  name: 'dsh-hello-plugin/startup'
```

The plugin exports `inject = ['cmdlineArgs']`, calls `parseCmdline` from [`@deepseek-ai/dsh-cmdline`](../../../../packages/boot/cmdline/README.md) with its own commander program, and provides its app-owned service from the program's action. The launcher hands every plugin the same immutable arguments after launcher flags, so app-specific flags need no launcher change and multiple plugins may parse the snapshot. The Loader row needs no launcher marker or special kind.

Rows configured by those arguments inject the provider's service and read it from their own `!!js` options, with the deployment value beside it as the fallback:

```yaml
- id: my-app
  name: '@example/my-app'
  inject: [myAppStartup]
  config:
    port: !!js ctx.myAppStartup.port ?? 8080
```

On `--help`, the provider publishes no service, so those rows never activate. Loader mounts the composition once, waits for each row's ordinary injections, and only then evaluates that row's `!!js` config against its injected context.

## Installing from GitHub: the build-script catch

Publishing to a registry is not required — users can install straight from a git host:

```sh
dsh plugin --profile demo add github:you/hello-plugin
```

But a git install fetches **sources, not built artifacts**: nothing runs your `build` script, so a TypeScript package arrives without its `lib/` output and fails to load. Two things must happen, one on each side:

- **The author** ships a `prepare` script — pnpm runs it after a git install — that builds the published entry points from source, self-contained: it must not assume dev-only context such as a sibling monorepo checkout. [turtle-ui](https://github.com/deepseek-harness/turtle-ui) is a working example: its `prepare` runs a dedicated tsdown config that transpiles `src/` without project references or type checking.
- **The user** allowlists the build. pnpm ≥10 refuses to run a git dependency's `prepare` script until it is explicitly allowed, so the first `add` fails; `dsh` points at the fix — copy the exact package key pnpm printed into the profile's `pnpm-workspace.yaml`:

  ```yaml
  allowBuilds:
    dsh-hello-plugin: true
  ```

  and re-run the `add`.

Treat that allowance as what it is: **permission to execute the package's code on your machine at install time**, outside any sandbox the agent runs under. Only allow packages whose source you trust, and pin a commit (`github:you/hello-plugin#<sha>`) so a later push cannot silently change what runs.

If you would rather not ask users for the allowance, distribute built artifacts instead — neither form needs any build permission:

- **Publish to npm** with `lib/` built at `pnpm publish` time; `dsh plugin add your-package` then installs prebuilt code.
- **Ship a tarball** from `pnpm pack`; users run `dsh plugin add ./hello-plugin-0.1.0.tgz`.

## Publish a build-free skill bundle

Everything above distributes plugin code — tools and host capabilities. A bundle can just as well distribute a **skill**: instructions the model loads on demand instead of a tool it calls. This form needs no build step anywhere: the skill body is Markdown, and the only code is a small plain-JavaScript provider that hands it to `ctx.skills`. [`@deepseek-ai/dsh-skill-badge`](../../../../packages/skill/skill-badge/README.md) is the shipped precedent for exactly this shape.

Create the package directory:

```sh
mkdir -p hello-skill/skills/team-style
```

```
hello-skill/
├── package.json       # declares dsh.bundle
├── cordis.patch.yml   # the layer applied when a profile lists this bundle
├── index.js           # provider plugin: lists and loads the shipped skill
└── skills/
    └── team-style/
        └── SKILL.md   # the instruction body
```

Create `hello-skill/package.json` — the manifest shape from the first section, with `skills/` added to the published files:

```json
{
  "name": "dsh-hello-skill",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml", "skills"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

Create `hello-skill/cordis.patch.yml`:

```yaml
- insert:
    - id: hello-skill
      name: dsh-hello-skill
```

Create `hello-skill/index.js`. It follows the badge provider's contract: `list()` returns the catalog candidate, `get()` rereads the current body on every load, and `apply()` registers the provider. Plain ESM JavaScript runs as-is — nothing to transpile:

```js
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const bodyUrl = new URL('./skills/team-style/SKILL.md', import.meta.url)
const resourceBase = { kind: 'directory', path: fileURLToPath(new URL('./skills/team-style/', import.meta.url)) }

const provider = {
  name: 'hello-skill',
  list: () => Promise.resolve([{
    name: 'team-style',
    description: 'House style for commit messages, branch names, and pull request titles.',
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'hello-skill',
    source: 'bundled',
    rank: 600,
    locator: bodyUrl,
    resourceBase,
  }]),
  async get(candidate) {
    return {
      name: candidate.name,
      description: candidate.description,
      invocation: candidate.invocation,
      provider: candidate.provider,
      source: candidate.source,
      resourceBase,
      content: await readFile(bodyUrl, 'utf8'),
    }
  },
}

export const name = 'hello-skill'
export const inject = ['skills']

export function apply(ctx) {
  ctx.skills.registerProvider(() => provider)
}
```

The bundled rank means a project's own skills still win a name conflict. Name and description live in the candidate rather than in frontmatter, so the body file stays plain Markdown. Create `hello-skill/skills/team-style/SKILL.md`:

```markdown
# Team style

Apply these conventions whenever you write or review version-control text.

## Commit messages

- Subject line in imperative mood, at most 72 characters, no trailing period.
- Body lines wrapped at 80 characters; explain why, not what.

## Branches and pull requests

- Branch names follow `<type>/<short-topic>`, for example `fix/session-flush`.
- Pull request titles follow the commit subject rules; the description lists the behavior changes and the tests covering them.
```

Install and boot — the same flow as any bundle:

```sh
dsh plugin --profile demo add ./hello-skill
dsh --profile demo --dump-config   # shows a "# == dsh-hello-skill" layer
dsh --profile demo
```

In a session, send `/team-style` as the first line of a message — a user-invocable skill loads deterministically through that gesture — or ask the model to load the skill through its own `skill` tool.

Distribution skips the previous section entirely: no build products means no `prepare` script, so a git install needs no `allowBuilds` entry, and a tarball carries everything — `pnpm pack`, then `dsh plugin add ./dsh-hello-skill-0.1.0.tgz`.

Choose the channel by scope: a profile-installed bundle makes the skill available in every workspace that profile boots, while a skill belonging to one repository ships inside it — drop the directory under `<projectRoot>/.dsh/skills/` and [filesystem discovery](../../../../docs/subsystems/skills.md) picks it up without any package.

## Next steps

- [Plugins and lifecycle](../framework/index.md) — the full plugin lifecycle
- [CLI behavior reference](../../../../apps/cli/reference/README.md) — exact layer precedence, flags, and profile mechanics
