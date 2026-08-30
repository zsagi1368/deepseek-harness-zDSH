# dsh-plugin-governance-host

English | [中文](README.zh.md)

宿主面治理服务：注册表镜像、生命周期、健康、准入与预设操作，以类型化 Remote 发布。

## Model Experience

### Governance gateway

#### What the model sees

服务键 `pluginGovernance`：`list`/`get`/`health` 只读投影，`approve` 与 preset 操作，`install`/`uninstall` 准入管线（本地目录与 npm 来源）。

##### Remote surface

```markdown
pluginGovernance.list(): GovernanceRosterSnapshot
pluginGovernance.install({ source }): GovernanceAcknowledgement
```

#### Token effect

仅按调用返回结果；不注入固定 prompt 文本。

#### KV Cache effect

无：注册表镜像与审批账本经耐久快照/台账落盘，不依赖 KV 缓存。

## Known Limitations and Deferred Work

- Loader 镜像仅覆盖已挂载条目；安装目录清理为 best-effort。
- npm 来源仅接受精确版本（无范围解析）。
