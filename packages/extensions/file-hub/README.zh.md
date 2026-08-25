<div align="center">

# zDSH FileHub

**DeepSeek Harness 的统一文件中心。**

随处上传、`@` 引用万物、让模型读懂文档、为图片生成讲解——并在一个控制台里管理所有会话的文件。

[![ci](https://github.com/zsagi1368/zdsh-filehub/actions/workflows/ci.yml/badge.svg)](https://github.com/zsagi1368/zdsh-filehub/actions/workflows/ci.yml)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[![Node](https://img.shields.io/badge/node-%E2%89%A522-blue.svg)](./package.json)

[English](README.md) | 中文

</div>

---

## 为什么需要 FileHub

DeepSeek Harness 提供了出色的多模态对话体验，但图像之外的一切都停留在边缘：没有点击上传按钮、没有通用（非图像）文件上传通道、模型打不开 PDF 或表格、也没有地方查看会话产出的文件。

FileHub 用一个开箱即用的插件补齐这些缺口：

- **四个上传入口汇入同一条队列**——按钮、整页拖拽、粘贴、整个文件夹（保留层级）。
- **把 `@` 文件提及做对**——候选来自有界工作区索引与已上传文件的即时合并排序；每条提及在发送时做存在性校验，然后以结构化引用注入。模型精确知道你指的是哪个文件——除非它主动去读，否则内容从不过线。
- **给模型的文档阅读能力**——`read_document` 打开 text/PDF/DOCX/XLSX，支持分页、按格式的输出预算与显式截断标记，长文档按需翻页而不是灌爆上下文。
- **图片讲解瀑布**——当前路由是多模态时图片原样直通、零干预；否则默认走本地 Ollama 生成讲解。除非你明确允许，没有任何字节离开你的机器。
- **一个真正的文件中心**——所有会话的文件可搜索、可过滤，附存储统计与两步确认的清理。

## 功能

### 上传通道

| 入口 | 行为 |
|---|---|
| 输入框按钮 | 多选文件选择器 |
| 拖拽 | 整页遮罩、目录递归遍历、保留相对路径 |
| 粘贴 | 剪贴板内任意文件，不限于图片 |
| 队列条 | 逐项进度、重试、取消、移除（同步删除服务端文件） |

传输全程流式并双重强制大小上限，配并发闸与会话配额。内容寻址去重保证同一文件重复上传只落一份。文件落在隔离的会话工作区 `.filehub/<sessionId>/`——agent 可用常规文件工具直达，沙箱策略天然覆盖。

### @ 文件提及

在输入框键入 `@` 即可同时搜索工作区索引与本会话已上传文件。候选项带类型图标、消歧父路径与完整键盘导航。发送时每个提及 token 都经过文件系统校验（路径穿越直接拒绝），再展开为结构化 `<workspace-reference>` 消息——无效路径显式提示，绝不静默丢弃。输入框上方的 chip 引用条跟踪全部引用，可精确移除某一条。

### AI 文档阅读

| 工具 | 用途 |
|---|---|
| `read_document` | 分页读 text/PDF/DOCX/XLSX（`offset`/`limit`），可选 `sheet` 定位表；`probe` 模式只返回结构概览（页数、表清单、体量）而不倾倒正文 |
| `list_workspace_files` | 列出会话工作区（有界，带截断标志） |

按格式差异化字符预算让输出体量可预期；截断必带显式续读标记，教模型自行取下一段。解析结果按内容寻址缓存，同一文件重复读取零开销。

### 图片讲解

当活跃路由声明了 `image` 输入模态时，FileHub 完全让位——原生多模态行为不受任何影响。否则讲解走严格瀑布：显式端点（仅公网 HTTPS）→ 本地 Ollama 探测（仅环回，默认开启）→ 优雅关闭。结果按图片哈希缓存；同一张图并发上传只会触发一次讲解调用。

### 文件中心

对话视图新增**文件** tab，聚合所有会话：搜索与类型过滤、按会话分组、存储占用分解，以及由"试运行预览 + 二次确认"双保险的清理动作。助手消息菜单亦提供基于同一存储的快捷操作。

## 安装

```sh
dsh plugin --profile <your-profile> add https://github.com/zsagi1368/zdsh-filehub
```

完成——随包清单自动装配两端，无需手工配置，所有选项都有合理默认值。

## 配置

日常选项在 Web UI 的 **设置 → FileHub** 中调整（语言、粘贴行为、候选上限、隐私开关等）。服务端调优接受 profile 配置对象：

```ts
{
  storageDirName: '.filehub',            // session-workspace subdirectory
  upload: {
    maxBytes: 50 * 1024 * 1024,          // single-file cap (streaming-enforced)
    maxConcurrent: 4,                    // parallel transfer gate
    perSessionQuotaBytes: 512 * 1024 * 1024,
    // dangerousExtensions: [...],       // optional deny-list override
  },
  lifecycle: {
    ttlMs: 7 * 24 * 60 * 60 * 1000,      // retention window
    sweepIntervalMs: 60 * 60 * 1000,     // sweeper cadence (all sessions)
  },
  mention: {
    indexMaxFiles: 5000,                 // bounded index hard stop
    indexTtlMs: 30_000,                  // staleness fallback
    searchLimit: 50,
  },
  reading: {
    budgets: { /* per-format char budgets */ },
    cacheEntries: 64,
    cacheBytes: 256 * 1024 * 1024,
  },
  vision: {
    mode: 'off' | 'caption' | 'analyze',
    endpoint: undefined,                 // public http(s) captioning endpoint
    ollamaProbe: true,                   // loopback-only local fallback
    timeoutMs: 20_000,
  },
  console: { maxEntries: 2000 },
}
```

## 安全

FileHub 处理用户文件，因此这里的安全声明全部由具名测试背书（`tests/adversarial/`），而非文字承诺：

- **路径沙箱**——先 resolve 后包含断言，每次操作的路径两端都做 `realpath` 复检；对 symlink/junction 逃逸、兄弟前缀欺骗、ADS 载荷与 Windows 盘符相对路径陷阱免疫。
- **SSRF 栅栏**——本地探针锁定环回地址；远端端点必须是公网主机且 DNS 解析后复检；重定向一律拒绝而非跟随。
- **同源加固**——Origin 主机名比对加远端地址环回复核。
- **资源限额**——流式大小上限、并发闸、会话配额、可证明遍历*全部*会话的 TTL 清扫。

逐条证据映射见 `SECURITY.md`（随独立插件包分发，不在本 monorepo 内）。

## 开发

```sh
pnpm install   # host types resolve via link:../Fork/* (needs a sibling DeepSeek Harness checkout)
pnpm run check # typecheck + test + build
```

构建产物为 ESM 宿主半与单文件客户端 bundle（由 harness web server 直接服务）。`docs/integration-playbook.md` 记录了将 FileHub 作为分发分支第一方扩展嵌入时的接缝清单。

## 许可证

[MIT](./LICENSE)

## 模型体验

### `@` 工作区引用

#### 模型看到什么

每条确认的提及都会以结构化 `<workspace-reference>` 消息注入对话，指明确切文件（路径、类型、会话工作区 `.filehub/<sessionId>/`）；候选在发送时做存在性校验，无效或穿越路径显式报错，绝不静默丢弃。

#### Token 影响

每个提及文件一个紧凑引用 token；候选清单本身（工作区索引 + 已上传文件，受 `mention.searchLimit` 50 条上限约束）从不进入上下文。

#### KV 缓存影响

引用集合不变时前缀稳定；增删一条提及会自首个变更的引用 token 起移动前缀。

### 文档阅读工具

#### 模型看到什么

`read_document` 分页读 text/PDF/DOCX/XLSX（`offset`/`limit`），可选 `sheet` 定位表；`probe` 模式只返回结构概览（页数、表清单、体量）而不倾倒正文；`list_workspace_files` 列出有界会话工作区（带截断标志）。

#### Token 影响

读取按需进行且按格式设预算上限（`reading.budgets`）；截断必带显式续读标记，模型取下一片而不是整段重发。

#### KV 缓存影响

解析结果按内容寻址缓存——同一文件的重复读取零解析开销重发同一批切片；新读切片追加在可复用前缀之后。

## 已知限制与暂缓事项

- **图片讲解依赖用户自备端点** —— `vision.endpoint` 未设置且本地 Ollama 探测（仅环回，默认开启）不存在时，图片以无讲解状态上呈；原生多模态路由不受影响。
- **清理按设计为破坏性操作** —— 移除经「试运行预览 + 二次确认」后同步删除服务端文件，无回收站或还原通道。
- **保留期受限** —— TTL 清扫器（默认 `lifecycle.ttlMs` 7 天）可证明遍历*全部*会话，且没有逐文件豁免界面。
