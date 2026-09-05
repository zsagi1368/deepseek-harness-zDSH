---
description: "面向 DSH Web 面的 IDE 级停靠工作区：文件、编辑器、终端、Git、任务与浏览面板，统一由一个注册表服务承载。"
kind: "package-reference"
---

# zdsh-workbench（中文）

[English](README.md) | 中文

## 概述

工作台是为 DSH Web 面打造的 IDE 级停靠工作区。一个注册表服务（`ctx.workbench`）承载文件工作台、终端、Git 中心、任务中心与浏览面板，供其他插件扩展。当 Web 客户端需要持久、可停靠的开发者工作区而非一次性工具调用时选择本包。

## 目录

- [规划状态](#planning-status)
- [安装](#install)
- [版本适配（compat 守卫）](#version-adaptation-compat-guard)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="planning-status"></a>
## 规划状态

按里程碑推进中的脚手架：

- M1 外壳骨架：host 路由 + 客户端面板注册表 + 停靠框架
- M2 文件工作台（资源管理器 / 编辑器 / 预览器 / watcher）
- M3 终端（node-pty + xterm.js + 模型工具）
- M4 Git 中心 · M5 任务中心 · M6 浏览 + 侧聊 · M7 打磨 · M8 发布

完整设计见仓库内 `docs/PLAN.md`（同步自研发规划 P01）。

<a id="install"></a>
## 安装

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
## 版本适配（compat 守卫）

工作台通过 `@deepseek-ai/dsh-compat` 的 `guardFeature` 对自己的注册做闸门控制（`src/compat.ts` 中的 `guardWorkbench`），在注册前探测它所依赖的对等符号：

- `cordis:Service` —— `@deepseek-ai/cordis` 必须导出可调用的 `Service`。

探测失败时，守卫记录一条警告并返回 `false`，工作台随之跳过注册而不是抛错。它永不抛错、永不破坏宿主树：部分加载或上游漂移的宿主只是不带工作台完成启动。

<a id="model-experience"></a>
## 模型体验

### IDE 停靠区

#### 模型所见

`ctx.workbench` 服务键路由到宿主 `reveal`：模型经工具入口触发文件系统操作，布局状态可跨会话保持。

##### Reveal 路由

```markdown
ctx.workbench.reveal(path) -> host reveal/open
```

#### Token 效果

文件实体视图按需装配；不注入固定 prompt 文本。

#### KV 缓存效果

无：布局与标签状态保存在客户端会话内。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 以独立 dock 形态 vendor，尚未与 Fork 主树的侧聊/会话作用域深度集成。
- 依赖宿主面 seam；未挂载时将优雅降级为空面板。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本开发备注是维护者的工作上下文：未决的设计问题与方向。它明确非权威——已交付的行为、限制与既定理由见上文各节、包代码及关联 Agent Note。

#### 未来：侧聊与会话作用域

停靠区目前独立交付。未来里程碑将浏览与侧聊面板接入 Fork 主树的会话作用域，在停靠区与主面板间共享同一会话模型。

</details>
