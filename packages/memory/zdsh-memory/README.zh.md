# @deepseek-ai/dsh-agent-memory

[English](README.md) | 中文

面向 DeepSeek Harness 的跨会话启发式记忆：从会话事件流做零 LLM 抽取、按日分片的分支本地持久化，以及经既有 system-prompt section 机制的关键词重叠 Top-K 注入。

## 服务 API

插件（函数形式：`name` / `inject` / `Config` / `apply`）提供 `agentMemory` Cordis 服务：

- `list(): Promise<MemoryEntry[]>` — 全部已存条目，最旧在前。
- `forget(id): Promise<boolean>` — 按 id 删除一条；id 不存在时返回 `false`。
- `observe(session, event)` — 面向 `session/event` 的抽取入口；插件自行完成接线。
- `renderSection(assemble)` — 已注册 `agent:memory` section 背后的提示词期 Top-K 评分器。

### Config

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `storageRoot` | `<branch-home>/memory` | 显式覆盖分片根目录。 |
| `capacity` | `500` | 跨分片的全局条目上限；超过上限后按 FIFO 淘汰最旧条目。 |
| `topK` | `8` | 单次提示词组装注入的最大条目数。 |

## 存储

条目落在 `<branch-home>/memory/YYYY-MM-DD.json` 中，按 `createdAt` 所在 UTC 日每天一个 JSON 分片。分支 home 的解析方式与 `@deepseek-ai/dsh-plugin-governance` 的持久化完全一致：显式配置根目录，然后 `DSH_BRANCH_HOME`，最后 `~/.dsh-zdsh`。每次写入都是原子的（`writeFileAtomic`：独占创建临时文件加重命名，0o700 目录下 0o600 权限）。同种类别且规范化文本相同的重复抽取会递增既有条目的 `hits`，而不是产生重复。损坏的分片文件降级为零条目，不会让加载失败。

每条记录形如 `{ id, kind, text, sessionId, createdAt, hits }`，其中 `text` 经空白规范化并截断到 200 字符。

## 抽取规则（无 LLM 调用）

只读取人类提示词（`source.kind === 'user'`）与已完成轮次的最终 assistant 回复：

- **decision** — 含决策线索词（`决定` / `就用` / `选定了` / `以后都`）的用户句子，连同其后继句子一并捕获。
- **preference** — 用户的纠正性反馈句子（`不要` / `不许` / `改成`，或不属于特别/分别等复合词的裸 `别`），每条消息最多三条。
- **fact** — 最终 assistant 回复的首个散文句，回复含代码时追加围栏代码块统计后缀（`含N个<lang>代码块`）。

## 注入

每次 system-prompt 组装时，`agent:memory` section（顺序 20，位于 persona 之后）把正在组装的会话的近期人类提示词切分为关键词——小写拉丁词加 CJK 字符 bigram——按关键词重叠为每条已存条目打分，并将至多 `topK` 条匹配渲染为项目符号记忆块。零重叠的日子渲染空字符串，提示词会将其整体丢弃。

## 扩展点

直接组合插件（`ctx.plugin(AgentMemory)` 或 bundle patch 行）并从任意表面调用 `agentMemory` 服务；未来的 UI 或 Remote 层读取 `list()` 并经 `forget(id)` 变更。本包自身不提供 Remote 端点。

## Model Experience

### 请求上下文与条件

#### 模型看到什么

当至少一条已存条目与当前任务的关键词重叠时，会话会在 persona 之后收到一个项目符号记忆 section。每行是 `[decision]` / `[conclusion]` / `[preference]` 加上所存文本，条目被再次抽取超过一次后会带 `(recalled xN)` 后缀：

##### 本字段的逐字文本（如需要）

```markdown
Memories from earlier sessions that look relevant to the current task:
- [decision] 就用 pnpm 作为包管理器；后续安装都走 pnpm
```

#### Token 影响

有条件且有上限：无条目重叠时不出现；否则为一行固定头部加上至多 `topK` 条、每条约 200 字符的项目符号。

#### KV Cache 影响

轮内前缀稳定，整个会话生命周期内近似仅追加：该 section 在每次组装时求值，因此新抽取的条目可能在轮与轮之间改变这一片段，使变更点之后的前缀复用失效；删除条目同样会重写该块。

## 已知限制与延后工作

- **抽取是词法层面的，不是语义层面的** — decision/preference/fact 线索是固定的中文模式；不含线索词的改述永远不会被记住。基于 embedding 的评分器被刻意延后，以保持 V1 不含模型调用与向量存储。
- **单进程写入者** — 变更经 promise 链在单个进程内串行；两个进程写同一分片根目录时，以整文件替换的方式最后写入者获胜，而非合并。
- **尚无 Remote/UI 表面** — `agentMemory.forget/list` 仅作为服务接缝存在；在没有消费方需要之前不提供生成的 Remote。
