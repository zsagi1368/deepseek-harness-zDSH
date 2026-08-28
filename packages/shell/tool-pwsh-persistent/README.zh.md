# @deepseek-ai/dsh-tool-pwsh-persistent

[English](README.md) | 中文

模型侧 `pwsh(command)`，由一个 owner 作用域的 `ctx.terminals` shell 支撑。本包拥有工具契约与 shell 复用；部署方选择 terminal backend（配置 `shellDialect: pwsh` 的 `terminal-bash` 实例）与沙箱策略。它是 `tool-bash-persistent` 的 Windows 对应物：相同的持久状态契约，PowerShell 方言。

## 配置

| 键 | 默认值 | 含义 |
|---|---:|---|
| `backendType` | `shell` | 每个 Agent shell 使用的已注册 terminal backend。 |
| `timeoutMs` | `300000` | 单条命令的墙钟上限；超时关闭 shell。 |
| `maxOutputChars` | `16000` | 保留的命令输出字符上限；固定诊断文本在其后追加。 |
| `description` | 持久 shell 描述 | 模型可见的环境契约。 |

## 模型体验

### 工具 schema

#### 模型看到什么

生成的 [`pwsh` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-pwsh-persistent)，含配置的 `description`。本插件不贡献独立的 system-prompt 段落；persona 与环境指引由部署方负责。

#### Token 影响

`pwsh` 可见期间每个请求有固定的 schema 成本。

#### KV Cache 影响

配置的 description 与 schema 不变时前缀稳定。

### 工具结果

#### 模型看到什么

命令共享每个 Agent 的一个 shell，因此 cwd、`$env:` 变量、函数和后台任务跨调用保留。结果排除私有完成标记、shell 提示符与回显的输入行（PSReadLine 会把提交的输入渲染回输出流；marker 锚定提取与包装器原文剥离将其移除）。非零包装命令追加 `[exit code: N]` —— 命令运行原生程序时是精确的原生退出码，PowerShell 终止性错误为 `1`。shell 在报告状态前退出的，改为追加 `[shell exited: code N]`、`[shell killed by signal: SIG]` 或 `[shell exited]`（backend 两者都没有时；Windows 强杀按无 signal 的 exit 1 报告），然后重置并告知模型下一次调用从全新 shell 开始。长输出保留最早的前缀并附裁剪提示；若 PTY 已丢弃该前缀，结果会明确说明。超时返回有界的部分输出、关闭不确定的 shell 并报告重置。

#### Token 影响

数据相关。`maxOutputChars` 限制保留的命令输出；固定裁剪、前缀丢失、状态、超时与重置诊断可能扩展结果。

#### KV Cache 影响

追加式工具结果跟随可复用的请求前缀。

## 与 `tool-pwsh` 的参数面差异

姊妹包 `@deepseek-ai/dsh-tool-pwsh` 注册的是**一次性** `pwsh` 工具（每次调用都启动全新的 `pwsh -Command`）。本包（`tool-pwsh-persistent`）为每个 owner 保持一个跨调用存活的 shell。两个工具共享 `command` 参数，其余维度全部不同：

### 插件配置

| 键 | `tool-pwsh` | `tool-pwsh-persistent` |
|---|---|---|
| `backendType` | — | string，默认 `'shell'`；选择持久 PTY shell 使用的 terminal backend。 |
| `timeoutMs` | — *（见下方逐调用参数）* | number，默认 `300_000`；单条命令的墙钟上限。超时会关闭持久 shell。 |
| `maxOutputChars` | — | number，默认 `16_000`；保留的命令输出字符上限。 |
| `description` | — *（见下方逐调用参数）* | string，默认 `'Run commands in a persistent PowerShell shell…'`；模型可见的工具描述。 |
| `enableRunInBackground` | boolean，默认 `true` | — |

### 逐调用模型参数

| 参数 | `tool-pwsh` | `tool-pwsh-persistent` |
|---|---|---|
| `command` | string（必填） | string（必填） |
| `description` | string（必填，5-10 词，仅用于 UI/日志） | — *（在配置层设定）* |
| `timeoutMs` | number（可选，逐调用覆盖） | — *（仅配置层，作用于每条命令）* |
| `workdir` | string（可选；本次调用的 cwd） | — *（shell 在启动时继承会话 cwd）* |
| `run_in_background` | boolean（可选） | — |
| `sandbox_permissions` | string enum（可选） | — *（沙箱在 PTY 层，不在工具层）* |
| `justification` | string（可选） | — |

### 命名不一致

两个工具都把命令截止时间命名为 `timeoutMs`，但在 `tool-pwsh` 里它是逐调用的模型参数，而在 `tool-pwsh-persistent` 里它是作用于每条命令的插件配置键。建议统一模型：要么把 `timeoutMs` 提升为 `tool-pwsh-persistent` 的逐调用参数（允许模型对单条命令覆盖墙钟上限），要么把它降为 `tool-pwsh` 的纯配置键（移除逐调用覆盖）。`description` 存在同样的分裂（`tool-pwsh` 逐调用、`tool-pwsh-persistent` 配置层）。

### 会话生命周期

- **`tool-pwsh`**：一次性——每次调用启动全新的 `pwsh -Command` 进程；调用之间不保留任何状态。
- **`tool-pwsh-persistent`**：持久——每条命令共享每个 Agent 的一个 PWsh shell；cwd、`$env:` 变量、函数与后台任务跨调用保留。超时、shell 退出或显式 `sessionStatus.kind === 'exited'` 时，shell 被重置（关闭并重新创建）。`backendType` 配置选择承载该 shell 的 terminal backend。

## 已知限制与延后工作

- 工具需要拥有 Agent 与一个真实支持 pwsh 方言的 terminal backend（Windows ConPTY 或 POSIX 上的 pwsh）。
- **输入回显不可避免**：PowerShell 的 PSReadLine 会把提交的输入渲染回终端流，且没有 `stty -echo` 的对应物。完整结果中 marker 锚定提取排除回显；包装器原文剥离覆盖回退路径，但跨越终端宽度的包装器折行可能在部分输出结果中残留片段回显，受 `maxOutputChars` 约束。
- 模型命令中的裸 ESC 字符不受支持：PSReadLine 会在执行前吞掉它们。包装器转义它需要的控制字节（`[char]27` 构造的 OSC 标记、body 的反引号转义）。
- 模型重定义 `prompt` 函数会移除就绪标记；shell 随后退化为静默档而非 marker 快路径。
- 命令执行期间没有交互 stdin：读取输入的前台命令会阻塞到就绪超时，随后重置 shell。
- SIGTSTP/SIGHUP 在 Windows 不可用（backend 拒绝）；SIGINT 以控制台级 Ctrl-C 输入写入投递，在提示符处取消当前行而非向进程发信号。
- 在 Windows ACL 沙箱的只读模式下，pwsh 以 ConstrainedLanguage 启动，可能拒绝引导代码通过 `[Console]::` 固定编码并写入 prompt marker。命令仍可通过可打印提示符和静默档结算，但非 ASCII 输出可能沿用宿主代码页。
- BEL 终结的 OSC 标记仍只是就绪信号；面向模型的 BEL 事件通道保持延后，与当前实现对齐。
