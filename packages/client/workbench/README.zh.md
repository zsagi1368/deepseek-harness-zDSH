# zdsh-workbench（中文）

[English](README.md) | 中文

zDSH 工作台 —— 为 DSH（deepseek-harness）打造的 IDE 级停靠工作区插件。

**净室独立开发**：功能思想参考了社区的侧边栏/全家桶实践，但全部代码、API 形状与资源均为原创，未复制任何社区代码。

## 规划状态（v0.1.0-alpha.0 脚手架）

按里程碑推进中：

- M1 外壳骨架：host 路由 + 客户端面板注册表 + 停靠框架
- M2 文件工作台（资源管理器 / 编辑器 / 预览器 / watcher）
- M3 终端（node-pty + xterm.js + 模型工具）
- M4 Git 中心 · M5 任务中心 · M6 浏览 + 侧聊 · M7 打磨 · M8 发布

完整设计见仓库内 `docs/PLAN.md`（同步自研发规划 P01）。

## 安装（开发阶段）

```sh
git clone https://github.com/zsagi1368/zdsh-workbench.git
cd zdsh-workbench && pnpm install && pnpm build
# 在 ~/.dsh/profiles/web/package.json 的 dependencies 加：
#   "zdsh-workbench": "link:<本仓库绝对路径>"
# 并在 ~/.dsh/profiles/web/cordis.patch.yml 追加挂载行后 pnpm install
```

## License

MIT

## Model Experience

### IDE dock

#### What the model sees

`ctx.workbench` 服务键与宿主 `reveal` 通道路由：模型经工具入口触发文件系统操作，布局状态可跨会话保持。

##### Reveal routing

```markdown
ctx.workbench.reveal(path) -> host reveal/open
```

#### Token effect

仅按需装配文件实体视图；不注入固定 prompt 文本。

#### KV Cache effect

无：布局与标签状态保存在客户端会话内。

## 版本适配（compat 守卫）

工作台通过 `@deepseek-ai/dsh-compat` 的 `guardFeature` 对自己的注册做闸门控制（`src/compat.ts` 中的 `guardWorkbench`），在注册前探测它所依赖的对等符号：

- `cordis:Service` —— `@deepseek-ai/cordis` 必须导出可调用的 `Service`。

探测失败时，守卫记录一条警告并返回 `false`，工作台随之跳过注册而不是抛错。它永不抛错、永不破坏宿主树：部分加载或上游漂移的宿主只是不带工作台完成启动。

## Known Limitations and Deferred Work

- 以独立 dock 形态 vendor，尚未与 Fork 主树做侧聊/会话作用域深度集成。
- 依赖宿主面 seam；未挂载时将优雅降级为空面板。