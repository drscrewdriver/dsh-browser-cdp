---
name: bcdp-browser
description: Drive a visible agent browser (ego / Chrome / Edge / Tabbit / Lightpanda) with bcdp_* tools — navigate, click, fill forms, screenshot, read page data, manage tabs, verify results. Use whenever a task needs a real browser, a logged-in page, or visual confirmation.
whenToUse: The user asks to open or inspect a page, fill a form, click through a flow, screenshot or verify a web UI, or read data that only exists behind a login.
---

# bcdp-browser

## 两个入口，别搞混

| 入口 | 给你什么 | 什么时候调 |
|---|---|---|
| `bcdp_help`（常驻工具） | **运行态**：激活的后端、当前 space、已解锁批次、单工具提示（`topic`） | 每个浏览器任务的第一步；拿不准参数时再调一次 |
| 本 skill | **流程**：循环、铁律、配方、降级表 | 已加载就够，不要反复读 |

只看到 `bcdp_help` 一个 `bcdp_*` 工具是正常现象：其余工具按批次解锁，调一次 `bcdp_help` 就会铺开下一批。**不要把"工具不在列表里"当成坏了。**

## 一次循环

1. `bcdp_help` —— 看后端是哪条通道、space 叫什么、有没有坑
2. `bcdp_navigate {url}` —— 等 DOM 就绪
3. `bcdp_snapshot` —— 拿到带 `[ref=N, loc=...]` 的语义树
4. `bcdp_click` / `bcdp_fill` / `bcdp_check` / `bcdp_select` —— 用 `loc=`
5. `bcdp_snapshot` 或 `bcdp_page_info` —— 验证页面真的变了，而不是假设它变了
6. 需要交给人：`bcdp_space {op:'handoff'}`；拿回来：`op:'takeover'`

## 选择器：永远优先 `loc=`

`bcdp_snapshot` 返回两种标记：

- `loc=...` —— **跨调用稳定**，用它
- `@N` / `ref=N` —— 每次快照重新编号，只在本次快照内有效

`bcdp_click` 也接受坐标（`x`、`y`），只在确实拿不到选择器时用。

## 三条铁律

1. **一次调用只做一件事。** 导航和提交不要塞进同一次调用，否则失败后说不清哪一步挂了。
2. **等状态用 `bcdp_wait`**（`op=selector|url|response|load|function`），不要在 `bcdp_js` 里写 sleep。
3. **看到 `actionSent=true` 就停。** 先 `bcdp_snapshot` 核实页面到底变没变，禁止原样重试——盲跑第二遍会把一次提交变成两次。

## 六条禁令

- 不在 `retry=never` 的失败后重试：`BACKEND_UNSUPPORTED` / `INVALID_ARGS` / `CAPTCHA` / `USER_CONTROLLING` 都是终点，换路或交人。
- 不复用上一轮快照的 `ref=` / `@N`——它们只在本次快照内有效，跨调用一律用 `loc=`。
- 不在 lightpanda 后端尝试登录 / CAPTCHA：没有窗口，必须换后端。
- 不对 `ownership=user` 的标签页做破坏性动作（关闭 / 提交 / 删除 / 清空），要动先问。
- 不猜密码、不暴力重试、不绕过登录与人机验证。
- 不把整页截图当默认观察手段——先 `bcdp_snapshot` 拿语义树，只在需要视觉证据时再截图。

## 后端差异（会静默降级，必须看）

`bcdp_help` 会报 `backend:`，各通道能力不同：

| 后端 | 缺口 |
|---|---|
| `tabbit-cli` | 无标签枚举 / 窗口关闭、无 overlay 点选、无下载事件；`bcdp_script` 里没有 `taskSpaces` / `cdp()` / `fetch.*`，`verbatim` 被拒；`snapshot` 上限 20000 字符 |
| `lightpanda` | 无头无窗口：登录、CAPTCHA 没有可操作的地方，必须换后端 |
| `ego-cli` | 无直接 CDP：`bcdp_cdp` 不可用 |
| CDP 端点 / 内置运行时 | 全能力 |

撞到"工具报不支持"时**不要重试**，读 `references/recovery.md` 换路。

## 按需读（不要预加载这三册）

- `references/recipes.md` —— 表单、多 tab、上传下载、iframe、分页取数
- `references/recovery.md` —— 断连、后端切换、CAPTCHA、前台抢占、ref 失效
- `references/eval.md` —— JEV 判定链（实验性，默认别碰）
