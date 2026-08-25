# dsh-client-ui-plugin-manager（中文）

[English](README.md) | 中文

zDSH 治理标签页：Web Plugins 设置区内的评分徽章、生命周期与准入操作、健康计数与预设。

## Model Experience

### Governance roster

#### What the model sees

名单行经 `pluginGovernance.list` 投影：每行携带来源与准入状态；操作走 `approve`/`enable`/`disable` 远程面。

##### Roster view

```markdown
roster row -> { pluginId, source, approvalRequired, approved, status }
```

#### Token effect

仅查询时装配名单行；不注入固定 prompt 文本，不产生会话事件。

#### KV Cache effect

无：本包不读写 KV 缓存。

## Known Limitations and Deferred Work

- 插件远程安装（npm 来源）的 UI 接线尚未实现，服务端已具备。
- 预设编辑器仅支持保存/加载/删除，不支持可视化编排。
