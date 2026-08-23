# @deepseek-ai/dsh-agent-memory

Cross-session heuristic memory for the DeepSeek Harness: zero-LLM extraction from the session event stream, daily-shard branch-local persistence, and keyword-overlap Top-K injection through the existing system-prompt section mechanism.

## Service API

The plugin (function form: `name` / `inject` / `Config` / `apply`) provides the `agentMemory` Cordis service:

- `list(): Promise<MemoryEntry[]>` — every stored entry, oldest first.
- `forget(id): Promise<boolean>` — drop one entry by id; `false` when the id does not exist.
- `observe(session, event)` — extraction intake over `session/event`; the plugin wires this itself.
- `renderSection(assemble)` — prompt-time Top-K scorer behind the registered `agent:memory` section.

### Config

| Key | Default | Meaning |
| --- | --- | --- |
| `storageRoot` | `<branch-home>/memory` | Explicit shard root override. |
| `capacity` | `500` | Global entry cap across shards; FIFO eviction of the oldest entries past the cap. |
| `topK` | `8` | Maximum entries injected into one prompt assembly. |

## Storage

Entries live in `<branch-home>/memory/YYYY-MM-DD.json`, one JSON shard per UTC day of `createdAt`. The branch home resolves exactly like `@deepseek-ai/dsh-plugin-governance`'s persistence: explicit config root, then `DSH_BRANCH_HOME`, then `~/.dsh-zdsh`. Every write is atomic (`writeFileAtomic`: exclusive-create temp plus rename, mode 0o600 in a 0o700 directory). A repeated extraction with the same kind and normalized text increments the existing entry's `hits` instead of duplicating it. Malformed shard files degrade to zero entries instead of failing loads.

Each entry is `{ id, kind, text, sessionId, createdAt, hits }` with `text` whitespace-normalized and truncated to 200 characters.

## Extraction rules (no LLM calls)

Reading only human prompts (`source.kind === 'user'`) and completed turns' final assistant replies:

- **decision** — a user sentence containing a decision cue (`决定` / `就用` / `选定了` / `以后都`), captured together with its successor sentence.
- **preference** — user corrective-feedback sentences (`不要` / `不许` / `改成`, or a bare `别` that is not part of a compound word like 特别/分别), at most three per message.
- **fact** — the first prose sentence of the final assistant reply, suffixed with fenced code-block statistics (`含N个<lang>代码块`) when the reply carries code.

## Injection

At each system-prompt assembly the `agent:memory` section (order 20, after the persona) tokenizes the assembling session's recent human prompts into keywords — lowercased Latin words plus CJK character bigrams — scores every stored entry by keyword overlap, and renders at most `topK` matches as a bulleted memory block. Zero-overlap days render an empty string, which the prompt drops entirely.

## Extension points

Compose the plugin directly (`ctx.plugin(AgentMemory)` or a bundle patch row) and call the `agentMemory` service from any surface; future UI or Remote layers read `list()` and mutate through `forget(id)`. This package ships no Remote endpoints itself.

## Model Experience

### Request context and condition

#### What the model sees

When at least one stored entry overlaps the current task's keywords, sessions receive one bulleted memory section after the persona. Each line is `[decision]` / `[conclusion]` / `[preference]` followed by the stored text, with a `(recalled xN)` suffix once an entry has been re-extracted more than once:

##### Verbatim text for this field, when needed

```markdown
Memories from earlier sessions that look relevant to the current task:
- [decision] 就用 pnpm 作为包管理器；后续安装都走 pnpm
```

#### Token effect

Conditional and capped: nothing when no entry overlaps; otherwise a fixed header line plus at most `topK` bullets of at most ~200 characters each.

#### KV Cache effect

Prefix-stable within a turn and effectively append-only across a session's life: the section is evaluated per assembly, so newly extracted entries can change this segment between turns and invalidate prefix reuse from the point of the change onward; forgetting an entry likewise rewrites the block.

## Known Limitations and Deferred Work

- **Extraction is lexical, not semantic** — decision/preference/fact cues are fixed Chinese patterns; paraphrases without the cue words are never remembered. An embedding-based scorer is deliberately deferred to keep V1 free of model calls and vector storage.
- **Single-process writer** — mutations serialize inside one process via a promise chain; two processes writing the same shard root interleave whole-file replacements last-writer-wins rather than merging.
- **No Remote/UI surface yet** — `agentMemory.forget/list` exist as service seams; no generated Remote ships until a consumer needs one.
