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

## 覆盖层：页面上一直有块「DSH · 正在…」的角标

在 ego / CDP 通道上，**每次真正碰页面的调用都会先在页面右上角挂一块角标**
（`DSH · 正在读取页面 / 点击 / 输入 / 截图 …`，4 秒后自动淡出）。同一句话也会
同步出现在侧栏面板的标题旁（活动药丸）。两处都由本插件在运行时产生，
**不需要你调用任何工具去画**，也不会污染你的读取面：

- 它挂在 closed shadow DOM 里且 `aria-hidden` → `bcdp_snapshot` / 正文抽取
  **看不到**它的文字，语义树也不会把它编号成一个可点元素；
- `pointer-events:none` → 永远不挡真实点击；
- 注入失败被吞掉 → 角标坏了也不影响工具本身。

### 你要学的行为：查看前后都要「说出来」

角标说明**机器在做什么**，你的说明负责**为什么**——两件事都要有，缺一半用户就懵。
用户可能正盯着那块屏幕，他看到画面自己动了却不知道是谁、为什么，那是最坏的体验。

**操作前**（一次动作一批，不是每一步都念）：

> 我去 `example.com` 找登录入口，先读一下页面结构。

**操作后**（结果 + 下一步，别只报"成功"）：

> 页面里有个「Sign in」按钮，我点了，现在跳到了 `/login`——需要你在那个窗口里登录，登录完告诉我继续。

**纯查看也要说**（这是最容易被跳过的，也是最需要的）：

> 我读一下当前页面，确认表单填对了没有。

### 三条硬规矩

1. **不要静默连发**：连续 3 个以上 `bcdp_*` 调用之间没有任何一句人话 = 用户在看着
   一个自己动的屏幕。每批动作前后各一句。
2. **覆盖层的话不要背**：不要说"系统正在显示覆盖层"这种元描述，说你在干什么。
3. **需要人接手的动作必须先说再做**：登录、人机验证、付款、删除、提交表单——
   这些不能说"我点了，需要你…"，要**先说**再点。

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
