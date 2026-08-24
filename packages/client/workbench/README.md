# zdsh-workbench

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
