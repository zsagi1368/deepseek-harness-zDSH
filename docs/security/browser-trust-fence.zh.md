# 浏览器信任栅栏安全基线

[English](browser-trust-fence.md) | 中文

本页是到达 Web GUI `/api` 的每个请求的常设威胁模型。它记录信任设计为何是现在的形状、每个机制不做什么、以及如何解读一次拒绝。任何对 `trustedHosts`、绑定旗标或 [api-request-trust.ts](../../packages/client/connection/src/api-request-trust.ts) 的改动，落地前都要对照本页检查。

## 常设论断

1. **Host 栅栏不是认证层。** 栅栏判断的是请求的 authority 是否指向本部署对外服务的名字；它从不识别调用者。网络可达性属于 webserver 配置，凭据完全在浏览器传输层之外，任何功能都不得把通过栅栏当作身份或授权。
2. **全接口绑定在命令行即被拒绝。** `dsh --profile web --host 0.0.0.0` 在启动时失败：绑定所有接口会把 `/api` 桥的远程代码执行面暴露给网络，而栅栏没有可依赖的认证层（[startup.ts](../../packages/bundle/web-app/src/startup.ts)）。局域网服务改用声明 authority 的方式——调用自行推导本机 IP 字面量，操作者用 `--trusted-host` 追加更多。
3. **`trustedHosts` 是抗 DNS 重绑定的栅栏，不是授权。** 一条条目只说明"以该 authority 命名的请求不是重绑定"。被声明的 authority 可以触达普通目录读取；它在配置面上不授予任何东西，下一节会单独钉死这一点。

## 为什么配置面保持仅回环

本设计所打断的攻击链，来自 S-19 安全分析：攻击者页面在操作者的浏览器中加载，DNS 重绑定把它的请求落到 `127.0.0.1:<port>` 而 Host 头仍携带攻击者域名；若该请求抵达 RPC 桥，`settings.update` 可以把某个 provider 的 base URL 改指到攻击者控制的服务器——此后 harness 在下一次调用时把对话内容、API 密钥和凭据材料转发给该服务器。

两道相互独立的钉死打断了这条链的每一环：

1. Host 栅栏直接拒绝重绑定的请求（`forbidden (untrusted-host)`）：攻击者能伪造 URL，却伪造不了落在本服务器 socket 上的 Host 头。
2. 即使操作者为局域网服务刻意声明了 `trustedHosts`，`PRIVILEGED_METHODS` 中的每个方法都会在桥运行之前用**空**信任列表重跑同一栅栏（[index.ts](../../packages/client/connection/src/index.ts)）。局域网调用者请求 `settings.update`、`credentials.set` 或任何其他配置面方法都会得到 `403 forbidden (untrusted-host)`；只有回环放行。

配置面上的读取与写入钉得同样死：`settings.describe` 返回全部暴露命名空间的配置，`credentials.describe` 报告任意环境变量名是否已配置，`llm.discoverModels` 让主机去抓取调用者选择的 URL。模型目录（`llm.providers`、`llm.models`）刻意不被钉死：局域网客户端的模型选择器需要它，而它只携带 provider id 与模型列表，不含端点或密钥状态。

对演化的结论：把任何特权方法放宽到回环之外，前提是真认证层先行到位。栅栏例外、origin 放宽和头部白名单都不是替代品。

## 解读诊断性 403

被拒绝的 `/api` 请求以状态码 403 应答，响应体为 `forbidden (<reason>)`，并附带携带同一原因的 `x-dsh-api-trust` 头。启动时 Web 应用会用它打印的确切地址对自己的 `/api` 探活一次，被拒绝时渲染指引（[api-selfcheck.ts](../../packages/bundle/web-app/src/api-selfcheck.ts)），让下面的锁定形态在启动时浮出，而不是表现为无声的页面故障。

| 原因 | 含义 | 典型成因 |
|---|---|---|
| `missing-host` | 请求未携带 Host 头。 | 裸 socket 客户端或剥离头部的代理。 |
| `bad-host` | Host 头无法解析为 authority。 | 代理或安全软件的错误改写。 |
| `untrusted-host` | Host 既非回环也非声明的 authority。 | 经未声明的局域网名字或 IP 打开；DNS 重绑定；Host 被改写。 |
| `cross-site` | 浏览器把请求标注为 `sec-fetch-site: cross-site`。 | 从另一站点发起的请求。 |
| `opaque-origin` | Origin 为字面 `null` 或非 http(s)。 | 沙箱 iframe、`file:` 页面、扩展页面。 |
| `origin-mismatch` | 附带的 Origin 指向另一台服务器。 | 浏览器与服务器之间的头部改写。 |

锁定的应对就是启动指引打印的两条：用服务器打印的确切地址打开，或用 `--trusted-host <host[:port]>` 声明你实际到达它的 authority。

## 回归覆盖

- 每种请求形状的栅栏判定：[api-request-trust.host.spec.ts](../../packages/client/connection/tests/api-request-trust.host.spec.ts)。
- 特权方法对声明局域网 authority 必答 403，fake 与真实 HTTP 双路：[node-half.host.spec.ts](../../packages/client/connection/tests/node-half.host.spec.ts)。
- 启动自探的分类与指引：[api-selfcheck.spec.ts](../../packages/bundle/web-app/tests/api-selfcheck.spec.ts)。
