# dsh-omnivision（中文）

[English](README.md) | 中文

zDSH 视觉管线：像素保真图像处理，多提供商 failover、路径策略、SSRF 防护与 KV 安全影史。

## Model Experience

### Vision pipeline

#### What the model sees

解读经 `vision_query` 工具入口消费本地或引用图像：提供商链自动故障转移，SSRF 守卫与路径策略在读写两侧生效。

##### Routing contract

```markdown
mode: auto | interactive | manual
routing: pre-step | tool-call | hybrid
```

#### Token effect

仅被调用时输出图像分析结果；不常驻 prompt。

#### KV Cache effect

影史以 KV 白名单路径承载，读写均过路径策略；无额外缓存。

## Known Limitations and Deferred Work

- 仅消费 inputModalities 路由门控契约，运行时不直接驱动图像附加入口。
- 自定义提供商需按 vendored 规范注册，不支持热插拔。
