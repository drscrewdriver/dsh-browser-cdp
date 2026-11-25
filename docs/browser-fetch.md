# browser-fetch — 跨插件服务接口（1.15.0 起）

本插件向同会话的其它 DSH 插件暴露的第一个跨插件能力面。经 cordis 服务总线
（`ctx.provide("browser-fetch", …)`）注册，消费方 `ctx.get("browser-fetch")` 取用；
插件 fiber 卸载（停用/卸载/重载）时自动注销，不会留下 stale 实现。

## 契约

```ts
fetchRenderedHtml(
  req: {
    url: string                  // 仅 http(s)；内网/元数据目标被服务端拒绝
    waitUntil?: 'load' | 'idle'  // 默认 'load'（Page.loadEventFired）；idle 另加 800ms 沉降窗
    maxBytes?: number            // 默认 1MB，服务端 clamp 到 2MB 上限
    timeoutMs?: number           // 导航+等待预算，默认 20s，clamp [1s, 60s]
  },
  signal?: AbortSignal,
): Promise<
  | { ok: true;  finalUrl: string; statusCode: number | null; html: string; truncated: boolean }
  | { ok: false; error: { code: BrowserFetchErrorCode; message: string } }
>
```

`statusCode` 取自主文档 `Network.responseReceived`；事件缺席时为 `null`（消费方不得依赖）。
`html` 是渲染后的 `document.documentElement.outerHTML`——本模块**不做任何格式转换**，
markdown 化归消费方（dsh-union-search 的宿主同款优化器）。

## 错误码

| code | 含义 | 建议动作 |
|---|---|---|
| `bad-request` | url 无法解析 | 修参数 |
| `blocked-target` | 非 http(s) / 回环 / 私网 / 元数据目标 | 不要重试；这类目标应走直连抓取 |
| `no-browser` | 端点状态文件无活体候选（浏览器没开 / lightpanda 无 CDP） | 提示先起 agent 浏览器；降级直连 |
| `nav-failed` | 连接/tab/导航/DOM 提取任一环节失败（含一次端点换代重试后仍失败） | 降级直连结果 |
| `timeout` | 预算内 load 未落地 / signal abort | 视为直连失败形态之一 |

## 实现路线

每次调用现取端点（browser.json / launcher.json 候选 + `/json/version` 活体探测，
复用 1.14.14 的 endpoint-authority 机制）→ 自开一条短生命周期 CDP 连接 →
`Target.createTarget({background:true})` 后台 tab → attach → navigate → load →
`Runtime.evaluate` 取 outerHTML → **finally 必关 tab 与连接**。

- 不走 ego-cli heredoc 通道：不抢工具锁、不与帧轮询串队，一次抓取不会让 bcdp_* 调用排队。
- 后台 tab 永不 activate，用户视角无跳窗。
- tabbit / lightpanda 路线无 CDP 端点时统一以 `no-browser` 回答。

## 安全边界

- 服务端强制地址门（协议 + 字面 IP + DNS 解析复检），**无绕过参数**——本服务不是通用代理。
- 抓取天然携带用户已登录 cookie，属身份敏感操作：门控（默认关 + 域名 allowlist +
  结果标注）在消费方 dsh-union-search 的 `browserFetchTier` / `browserFetchAllowHosts`
  配置上实现，本模块不重复设门。

## 消费方

- dsh-union-search >= 0.13.0：fetch provider 的浏览器升级档（web_fetch 登录墙/JS 空壳页特征命中才升级）。
