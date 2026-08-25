# zdsh-autopilot

[![ci](https://github.com/zsagi1368/zdsh-autopilot/actions/workflows/ci.yml/badge.svg)](https://github.com/zsagi1368/zdsh-autopilot/actions/workflows/ci.yml)

[![release](https://img.shields.io/github/v/tag/zsagi1368/zdsh-autopilot?label=release&sort=semver)](https://github.com/zsagi1368/zdsh-autopilot/releases)

[![license](https://img.shields.io/github/license/zsagi1368/zdsh-autopilot)](LICENSE)

**zDSH AutoPilot（自动领航）** —— [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的统一自动化引擎插件。三个协同能力，共享一个内核与一个控制台：

| | 模块 | 功能 |
|---|---|---|
| ⏵ | **续跑 Continue** | 识别非人为打断（网络错误、截断回合）并自动恢复会话——自适应退避、按上一工具终态附加幂等护栏、区分空转与进展的循环守卫。 |
| 🛡 | **守卫 Guard** | 沙箱优先的权限策略：例行工作在 OS 沙箱内零打扰直行；语义风险经脱敏后的 LLM 分类器严格裁决；越界操作发放五元组一次性授权并在官方审批点代答一次——永远只弹一次窗。 |
| 🔎 | **复核 Review** | 只读第二模型复核子代理在完整认领条件下应答审批请求，默认 fail-closed，带双预算、推导式默认熔断器，并把拒绝理由回喂给错误结果。 |

[English](README.md) | 中文

---

## 为什么是一个引擎

互相看不见彼此的自动化模块会制造最糟的故障：自动续跑撞进刚发生的拒绝风暴、三张设置卡三套审计格式、"暂停"只暂停了其中一环。AutoPilot 从一开始就设计为 **一个内核 + 四条跨模块不变量**：

1. 存在待批审批的会话会 **挂起自动续跑**——延迟重排而非丢弃。
2. 复核熔断开启时 **抑制自动续跑**（`skipped: circuit-open`）——无人值守时不再出现拒绝风暴。
3. 一处 **全局暂停约束全部模块**。
4. 同一审批 callId **只被处置一次**——先认领者赢，双弹窗从构造上不存在。

全部模块共享一套记账模型（副作用发生前先记账；取消永不消耗失败预算）、一套审计词汇（`ap/*` 会话日志事件 + 可重放折叠 + 机械可查的标记校验）、一套失败语言（`timeout | cancelled | unavailable | schema | budget | circuit-open`，穷举映射到安全侧结局）。

## 环境要求

| | |
|---|---|
| DeepSeek Harness | `>= 0.1.0-rc.2`，`< 0.2.0`（上游官方与增强分支均可） |
| Node（宿主） | `>= 22` |
| 平台 | Windows / macOS / Linux（路径判定以 Windows 为一等公民硬化） |

所有宿主能力均特性检测并优雅降级；缺失的服务只会关闭对应接线，绝不阻断启动。

## 安装

```bash
# from GitHub
dsh plugin --profile web add github:zsagi1368/zdsh-autopilot

# or from a local checkout
dsh plugin --profile web add link:/path/to/zdsh-autopilot
```

重启 profile 后，打开 **设置 → 插件 → AutoPilot**，选择一个预设即可使用。

## 使用

所有操作都收敛在一个命令面：

```text
/ap                          status of all modules + today counters
/ap on|off [continue|guard|review]
/ap pause [duration]         /ap resume
/ap approve                  authorize the latest denial (one-shot context)
/ap preset conservative|standard|fullspeed
/ap reset-stats              /ap help
```

预设是应用在用户配置之上的命名配置集：

| 预设 | 续跑 | 守卫 | 复核 |
|---|---|---|---|
| **conservative 保守** | 关 | 严格阶梯、偏人工兜底 | delegate 兜底 |
| **standard 标准**（默认） | 开 | 均衡 | rejected 兜底 |
| **fullspeed 全速** | 快速退避 | 宽松阶梯 | 更宽预算 |

配置位于 DSH 设置文件的 `autopilot:` 命名空间（热重载）；部署级默认值随 bundle 补丁分发。每个旋钮都有内联文档，且全部派生自代码中的单一事实来源。

## 架构

```text
src/
├── kernel/      shared facade: coordinator · ledger · audit(ap/*) · redact · probes · defaults
├── continue/    detector · scheduler · loopguard · resume texts
├── guard/       path hardening · shell lexer (bash/pwsh) · artifacts · classifier · grants
├── review/      answerer · reviewer prompt/verdict · circuit · feedback
├── console/     command parser · status/action bridge (token-or-same-origin auth)
└── client/      browser fiber — official slots only, zero DOM scraping
eval/            offline behavior contracts: YAML cases drive real module factories
corpus/          extensible error-classification corpus
```

模块边界由 CI 强制（`scripts/check-boundaries.mjs`）：能力模块只准依赖内核门面与自身。因此任一模块目录未来都可零重构地抽出为独立插件。

## 开发

```bash
pnpm install
pnpm verify     # lint(boundaries) + typecheck(3 configs) + vitest + build + eval
pnpm eval       # offline behavior-contract suite only (no API key needed)
```

仓库内置的质量门禁：

- **134 项单元/行为测试**覆盖内核与全部模块，含平台感知的路径/shell 样本集；
- **10 条 YAML 行为契约**无头驱动真实模块工厂，以进程退出码作 CI 门禁；
- lint 内置**边界与依赖守卫**；
- 双面构建验证（宿主 ESM `lib/` 与 Web 客户端经典脚本 bundle）;
- 对宿主接缝的每一条假设都在 `kernel/probes` 登记探测与降级路径。

## 安全说明

- 授权来源仅限人类直接消息与预执行事实；仓库内容、工具输出、模型文本一律视为数据而非指令。
- 一切跨越模型边界的内容先经结构化脱敏（secret 键位、大段正文、token 形态、PEM 块、连接串）。
- 动作端点要求令牌或同源鉴权，并对载荷设上限。
- 越权授权绑定 会话/工具/调用/级别/理由 五要素，仅可消费一次。

完整架构记录见 [docs/architecture.zh.md](../../../docs/architecture.zh.md)，版本历史见 [docs/dsh/CHANGELOG.zh.md](../../../docs/dsh/CHANGELOG.zh.md)。

## 许可证

[MIT](LICENSE) © 2026 zsagi1368

## 模型体验

### 控制台输出、续跑文案与审批答复

#### 模型看到什么

`/ap` 命令面渲染模块状态与今日计数，续跑模块把续跑文案写进会话，守卫授权答复与复核拒绝理由以普通对话内容出现在宿主审批点上；`ap/*` 事件以可重放折叠 + 机械可查标记的形式落进会话日志。

#### Token 影响

体量随数据变化但都很小——固定形态的状态/计数行、一次性审批答复、回喂进错误结果的简短拒绝理由。

#### KV 缓存影响

输出词汇不变时前缀稳定；新产生的答复追加在可复用前缀之后，不使既有条目失效。

### 脱敏分类器与复核子代理

#### 模型看到什么

主对话中看不到任何东西：守卫的脱敏 LLM 分类器与只读复核子代理是独立的模型调用，各带严格输出协议与完整认领条件，默认 fail-closed。

#### Token 影响

风险样本逐调用的分类器开销，加上受双预算与推导式默认熔断器约束的复核开销；预算随预设（conservative / standard / fullspeed）变化。

#### KV 缓存影响

对主对话前缀无影响：这些调用与主对话不共享请求前缀。

## 已知限制与暂缓事项

- **自动续跑只覆盖已识别的打断类别** —— 续跑检测器面向网络错误与截断回合构建；未识别的类别会让会话保持暂停，直到人工介入。
- **越界操作依赖宿主审批点** —— 五元组一次性授权在官方审批面应答（永远只弹一次窗）；审批点缺失时守卫 fail-closed，不做越权升级。
- **复核只读且默认 fail-closed** —— 第二模型复核员永远不会代为批准；拒绝理由回喂错误结果，放行与否始终由人工决定。
