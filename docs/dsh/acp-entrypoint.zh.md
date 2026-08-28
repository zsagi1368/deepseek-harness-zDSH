# dsh ACP 入口点（`dsh acp`）

[English](acp-entrypoint.md) | 中文

本文档是外部程序通过 [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) 驱动 DeepSeek Harness 智能体的版本化契约。它声明一个 ACP 客户端可以调用哪些方法、各个方法的稳定等级，以及什么构成破坏性变更。外部 GUI 工作台（如 BitFun 桌面工作台）应基于此页面集成，而非基于 [acp-agent 演示程序](../../examples/acp-agent/README.zh.md)。

## 自动化专属契约

`dsh acp` 是一个**自动化专属**的 ACP 服务器，基于 JSON-RPC stdio。ACP 客户端是同一台机器上受信任的程序化客户——它获得所组合运行时的全部 harness 能力。桥接器有意不暴露：

- 交互式渲染、提问面板或推理流（原始块、工具调用、计划和标题不上线）；
- `session/load` 历史回放：已恢复的会话不会向客户端重放过往消息（参见 [session/resume](#sessionresume)）；
- 内嵌上下文或音频提示。

线上传输的内容包括：提示文本/图片、已提交的助手文本/图片、取消信令、一次性权限决策以及会话恢复。其他所有内容属于 harness 的 UI 模块。

## 传输与纯度

入口点通过 stdio 使用换行定界 JSON（NDJSON）：stdout 上每一行恰好是一条协议消息。日志输出不会出现在 stdout 上；诊断信息发送到 stderr。客户端在 `initialize` 之后如果在 stdout 上发现任何非 NDJSON 字节，应视连接已损坏。

## 方法清单与稳定性

稳定性等级：

- **stable（稳定）**——方法及其线上行为已承诺。破坏性变更需要主版本号升级，并在此处公告。
- **experimental（实验性）**——方法为早期集成而存在，由客户端需选择的 capability 门控，可能在次版本中变更或移除。

桥接器是单版本智能体：`initialize` 回复时使用此构建支持的一个协议版本。

### initialize — stable

标准 ACP 初始化。响应中声明的 capabilities：

- `promptCapabilities.image`——仅当配置的 provider/model 路由支持图片提示且已组合附件存储时为 `true`；
- `sessionCapabilities.resume`——仅当已组合持久化会话存储后端时为 `{}`（参见 [session/resume](#sessionresume)）。

### authenticate — stable

接受但无操作。桥接器是本地受信任的程序化通道，无需认证握手。

### session/new — stable

创建新会话。请求必须携带一个绝对路径 `cwd`；`additionalDirectories` 和 `mcpServers` 会以 `invalidParams` 拒绝。会话 ID 由桥接器生成；客户端使用该 ID 进行 `prompt`、`session/cancel` 和 `session/resume`。

### session/prompt — stable

向一个会话发送一条提示。桥接器每个会话仅允许一个正在进行的提示；并发第二个提示会以 `invalidParams` 拒绝。响应的 `stopReason` 在正常完成的轮次中为 `end_turn`，在客户端取消时为 `cancelled`，在其他情况下映射为对应的终止原因。已提交的助手文本和图片按顺序作为 `agent_message_chunk` 更新流回；失败的轮次会拒绝该提示且不发布部分输出。

### session/cancel — stable

取消正在进行的提示（若无提示进行中，则取消自主智能体工作）。空闲时取消操作为无操作。

### session/resume — experimental

跨连接和进程重启恢复现有会话。客户端发送存储的 `sessionId`（来自之前 `session/new` 的应答）；桥接器将会话的持久化 JSONL 日志重放到一个新智能体上，该智能体继承已持久化 header 的 `cwd` 和元数据，然后正常继续响应 `prompt`。下一个提示的模型上下文包含完整的先前对话，但过往消息不会流回客户端（那是 `session/load` 的职责，本桥接器不实现）。

失败语义：

- 未知 ID 和不可读（损坏的）日志均以 `invalidParams` 拒绝——桥接器从不半创建会话记录；
- 该方法仅在已组合持久化后端时被广告；没有后端时，不符合契约的调用会失败为内部错误。

此方法为实验性，因为 ACP 的 load/resume 方法族仍在上游演进中；capability 门控即为选择加入契约。未来若协议重命名或重定义 `session/resume`，将在此处作为破坏性变更公告。

### session/load — 未实现

上游的 `session/load` 方法会将整个对话历史流回客户端。那属于展示层，超出了自动化专属契约的范围；桥接器不广告 `loadSession`，对 `session/load` 的请求以 `method_not_found` 应答。请使用 `session/resume` 在不进行线上回放的情况下继续已存储的会话。

### 权限请求（`session/request_permission`）— stable

工具调用的权限请求通过 `requestPermission` 呈现给客户端，包含恰好两个一次性选项，一对一地衍生自 `@deepseek-ai/dsh-user-approval` 的策略档位：

| 策略档位 | optionId | kind |
| --- | --- | --- |
| `ask` | `allow-once` | `allow_once` |
| `never` | `reject-once` | `reject_once` |

桥接器从不根据客户端响应推断持久授权：选择选项仅适用于本次请求，且从不提供 `allow_always`/`reject_always`。选择取消提示轮次而非选择选项的客户端会产生 `cancelled` 的审批结果；未知选项 ID 会失败关闭为 `rejected`。

## 破坏性变更政策

当发生以下情况时视为破坏性变更：移除或重命名某个 **stable** 方法、以不兼容方式更改 stable 请求/响应格式、缩小 stable 权限选项集，或更改传输纯度保证。破坏性变更需要主版本号升级，并在本文档的变更日志中记录。Experimental 方法可在任何版本中变更；capability 门控让合规客户端能在 `initialize` 时检测到变更，而非猜测。

- **2026-08-28**：引入此契约；`session/resume` 作为首个 experimental 方法添加；权限选项从用户审批策略档位中衍生。