## 1.9.8 (2026-11-10)

**登录/验证横幅：说明文字按比例收缩，不截断、不隐藏。**

- 撤回 1.9.7 的“超长省略 + 窄宽度隐藏 note”做法；`loginSelfPersist` 恢复完整文案（中/英）。
- 比例：主文案 `flex: 2 1 11~12em`，说明 `flex: 1 1 9~10em`，两边都 `min-width: 0` + `white-space: normal` + `overflow-wrap: anywhere` → 两者按 2:1 分享行宽，放不下就各自换行，绝不出 1 字一列、也不省略。
- `@container (max-width: 260px)` 只保留“隐藏 captcha kind 胶囊”这一项装饰降级。
- **测试**：1021 passed / 13 skipped（纯样式）。

## 1.9.7 (2026-11-10)

**窄宽度下登录/验证横幅不再被挤成一列字。**

- **根因**：横幅是单行 flex，右侧 `note`（“登录态由该浏览器自身保存”）写了 `flex: none; white-space: nowrap`，不收缩；窄侧栏下它把主文案的可用宽压到 ~1 字，就变成竖排一列。
- **修法（两处横幅同步）**：
  - 容器 `flex-wrap: wrap; row-gap` → 放不下时按钮/note 换行，而不是挤压正文；
  - 正文 `flex: 1 1 11~12em; min-width: 0; overflow-wrap: anywhere`；
  - `note` 改 `flex: 0 1 auto; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis`（超长就省略）；
  - 横幅设为 `container-type: inline-size`，`@container (max-width: 260px)` 时直接隐藏 `note` 与 captcha 的 kind 胶囊。
- **文案缩短**：`loginSelfPersist` 改为“登录态由该浏览器自身保存” / “Saved by the browser profile itself.”｡
- **测试**：1021 passed / 13 skipped（纯样式改动）。

## 1.9.6 (2026-11-10)

**修掉两次捕获之间的画面缺口（1s 缓冲重播导致的重渲染回退）。**

- **根因**：1s hold 定时器把 `spaces` 也一起重播，面板每秒重建一次视图；重建时 `currentSpace.thumbnail` 还是上一轮缓存，React 把 `<img src>` 打回旧帧，而 SSE 的 `frame` 已经把新帧画上——于是新→旧→新地闪一下（3s 捕获间隔里就看着像缺口）。
- **host**：hold 定时器改为 **只重播帧**（`writeCliImages(..., false)`），不再每秒重发 `spaces`；tab 清单只由真实捕获轮次更新。
- **client**：`_recompute` 不再“仅在 thumbnail 缺失时才取缓存”，而是**始终以 frameCache 里的最新一帧覆盖** snapshot，这样任何重渲染都不会把旧图盖回新图。
- **测试**：全量 1021 passed / 13 skipped（逻辑在 host/client 事件链，未新增用例）。

## 1.9.5 (2026-11-10)

**「tab 跟踪模式」接进设置卡（截图与推流组），与面板快捷开关双轨。**

- **Config 字段**：`tabTracking: 'active' | 'all'`（`z.union` + `.volatile()`），`resolveConfig` 默认 `active`；`ResolvedConfig` / `EgoRuntimeConfig` 同步，`cfg.tabTracking` 是实时 getter（改设置即生效，不用重启）。
- **设置卡选项**：放在「截图与推流」组内（`ego-cli 降级帧` 之后），下拉 `仅激活 / 全模式`，带中英文说明。
- **优先级**：保存的设置是默认值；面板上的「全模式/仅激活」按钮是本次会话的 override（`/api/bcdp/tracking` POST），一旦在设置卡保存任何字段，override 自动清除、回到设置值（两边不会对不上）。
- **测试**：`config.test.ts` canonical defaults 补 `tabTracking: 'active'`；全量 1021 passed / 13 skipped。

## 1.9.4 (2026-11-10)

**全模式（space 内所有 tab 都抓）+ 点 tab 真切换 + 激活 tab 绿框。**

- **两种跟踪模式（host 开关）**：`GET/POST /api/bcdp/tracking`。
  - `全模式`：一轮 heredoc 里逐 tab `attach → Runtime.evaluate → captureScreenshot`，回 `frames[]`（每 tab 一张 JPEG，上限 6 张），面板每个 tab 都有自己的画面，绿框标激活。
  - `仅激活`（默认）：只抓/只渲染激活那一个 tab。
- **点 tab 真切换**：`POST /api/bcdp/switch-tab`（worker 走 `Target.activateTarget`，ego-cli 走 heredoc `browser.switchTab`）。面板点 tab = 让浏览器真切到它，轮询下一轮就拍到新图；已选中的再点一次回到“跟随实时”。
- **绿框指示**：侧栏 stage / 浮窗图片在“当前展示的就是浏览器激活 tab”时上 `#30d158` 外框；tab 条上激活那一项的绿点加亮 + 加粗。
- **帧协议升级**：`@@BCDP_FRAME@@` 新增 `frames[]`（`targetId + png + fmt + url + title`）；`broadcastCliFrames()` 一轮发多张 `frame` 事件（客户端按 `targetId` 分缓存），hold 定时器重播整轮。
- **测试**：`cli-frame-poller` 新增多 tab/两模式用例，`panel-actions` 新增 switch-tab 4 条；全量 1021 passed / 13 skipped。

## 1.9.3 (2026-11-10)

**多 tab 与 @ 对象同频：面板跟真实 tab 清单/当前激活 tab 走，tab 报告进同一个桶。**

- **多 tab（ego-cli 路线）**：`buildFrameScript` 改为「`browser.listTabs()` 拿全量 tab → 选浏览器激活的那个（`active===true`）→ `Target.attachToTarget` 自开 sessionId → `Runtime.evaluate` 取 url/title + `Page.captureScreenshot`（JPEG，无临时文件）」。不再用会话语义页，所以不再「永远只跟踪第 1 个 tab」，也不 `switchTab` 抢会话目标；`cdp(sessionId)` 不可用时仍回退到旧的 `page.screenshot` 路径。
- **帧带清单**：`@@BCDP_FRAME@@` 携带 `targetId` + `tabs[]` + `fmt`；`broadcastCliFrame(frame, spaces)` 把真实 tab 行随帧推给面板，帧绑定到活动 tab 的 `targetId`；`/api/bcdp/spaces` 的 cliFrame 分支同样返回全部 tab（另带 `cliFrameTargetId`），客户端按它绑图（不再用 `__cli_frame__`）。
- **@ 卡片元信息同频**：dock 卡新增 `targetId` 解析 + 每 3s 拉一次 `/api/bcdp/spaces`，卡片标题/URL/● 实时标记跟随真实页面；元素列表明标「点击时快照」，另加 `⟳ 重抓快照`（同名覆盖，token 不变）。
- **ego-cli 路线 tab 报告降级（`src/cast/fallback-tab-report.ts` 新）**：heredoc 内 `page.evaluate` 跑与 Tabbit 共用的 DOM 收集器（交互标签+ARIA role，上限 400），交回 CDP 路径的 `reportScope` + `numberReportNodes` 编锚点；失败也给 URL+title 的 degraded 报告，不再 409。
- **Tabbit tab 进同一个桶**：`/api/bcdp/spaces` 新增 Tabbit 分支（3s 库存缓存，>20s 不服务），tab 条/历史/@ 都能用；帧轮播时带真实 tab 行，活动 tab 绑图。
- **gateway**：`tab-anchor-report` 在无 CDP ws 时走注入的 `fallbackTabReport`（ego heredoc / Tabbit Playwright 自动分流），文件名用报告里的真实 targetId。
- **测试**：新增 `tests/fallback-tab-report.test.ts`（14 条）+ `cli-frame-poller` 多 tab 用例（17 条）；全量 1012 passed / 13 skipped。

## 1.9.2 (2026-11-10)

**登录/人机验证提示按实际后端命名（CDP 端点 / ego 浏览器 / Tabbit / Lightpanda）。**

- **host**：`GET /api/bcdp/spaces` 新增 `link: { kind, label, engine }`（来自 `resolveEffectiveLink` + 附加引擎），三种分支（worker 代理 / cliFrame 降级 / 无浏览器）都带。
- **文案模板化**：`loginTitle`/`captchaHint` 改用 `{where}` 占位符，新增 `whereCdp`(「{label}」浏览器窗口) / `whereEgo` / `whereTabbit` / `whereLocal` / `whereGeneric` / `loginHeadless`。不再硬编码「CDP 浏览器代理」。
- **按后端降级提示**：ego-cli 与 Tabbit 自身持有 profile，不再显示「已登录，保存」（原先在 ego 路线点它只会得到「未连接浏览器」）；Lightpanda（无头）改为提示切换有头目标并隐藏保存按钮。
- **两处 UI 同步**：侧栏 Tab（`state.link` 进快照）与浮窗（`panelLink` 随 spaces 刷新）均使用同一套 `linkLoginLine` / `linkCaptchaLine` / `linkFlushable`。
- 全量 995 passed / 13 skipped。

## 1.9.1 (2026-11-10)

**尺寸同步/预设/最大化/刷新/URL 两条路线打通 + 客户端 UI 落地（task 13/19/20/21）。**

- **ego-cli 路线补 heredoc 版后端（`src/cast/panel-actions.ts` 新）**：`buildEgoWindowSizeScript` / `buildEgoNavigateScript` 生成短 heredoc，在 CLI 同通道内用 `cdp('Browser.getWindowForTarget'/'Browser.setWindowBounds')` 改真实窗口、`page.reload`/`page.goto` 导航；请求/响应形状与 worker 路由逐字段一致，客户端只认一套协议。
- **host 路由降级**：`POST /api/bcdp/window-size`、`POST /api/bcdp/navigate` 在 worker 不可用时（ego-cli 无 CDP ws）改走注入的 `PanelActionRunner`（`makePanelActions`），不再返回 409；脚本串在 `withEgoLock` 里排队，不与工具调用竞争。
- **空间解析统一**：抽出 `resolveCliPanelSpace`，帧轮询与面板动作共用同一会话空间规则（含 `dsh-agent-<sid8>` 兜底）。
- **客户端（侧栏 Tab）**：🔒/🔓 尺寸同步 toggle（localStorage 持久化 + ResizeObserver + 指针拖拽判定，防自喂循环）、5 个比例预设、最大化、刷新页面、打开网址（prompt + 自动补 https）、右/下/角三个拖拽热区、结果提示与“接口未就绪”提示。
- **客户端（浮窗）**：同样接入刷新页面 / 打开网址 / 最大化 / 比例预设（浮窗宽度固定，故不做面板宽度同步）。
- **测试**：新增 `tests/panel-actions.test.ts`（19 条：sentinel 解析、脚本文本断言、字段白名单、U+2028 转义、URL 截断），全量 995 passed / 13 skipped。

## 1.9.0 (2026-11-10)

**观察窗尺寸同步/预设/最大化 — 后端能力落地（纯函数 + worker/host 路由）。**

- **`src/worker/window-size.ts`（新）**：`clampViewportSize` / `widthWithDelta` / `computeWindowBounds` / `aspectHeight` + `ASPECT_RATIOS`（16:9/4:3/21:9/1:1/9:16）；纯函数、14 单测覆盖。
- **worker `POST /api/window-size`**：支持 `{width,height,delta,dy,aspect,maximize}`；经 `Browser.getWindowForTarget` + `setWindowBounds` 改真实 Chrome 窗口；缓存 windowId(10s)/chrome-frame(2s) 使每次拖动仅 1 次往返；返回 `{viewport}` 供客户端坐标映射。
- **worker `POST /api/navigate`**：面板刷新（`Page.reload`）/手动 URL（`Page.navigate`）。
- **host 路由**：`POST /api/bcdp/window-size`、`POST /api/bcdp/navigate` 代理到 worker（ego-cli 无 CDP ws → 409）。
- **边界**：尺寸同步/最大化/面板刷新仅 CDP worker 路线生效；ego-cli 降级路线无 CDP，返回 409 明确提示。
- **待续**：客户端 UI（工具栏 URL/最大化/🖁 尺寸同步 toggle/预设/拖拽热区）已在 1.9.1 落地，且 ego-cli 路线不再 409。

## 1.8.3 (2026-11-10)

**侧栏帧缓冲：每秒重播最后一帧（≥1s 不落空）。**

- 问题：ego-cli 路线靠 3s 一次的 CLI 截图推帧，**截图时页面渲染停摆**，两次截图之间无帧可推；若途中到一条空 `spaces` 导致面板回占位，下一帧要等 3s、视觉上就是“闪一下就消失”。
- 修复（host 侧，`cast-server`）：`broadcastCliFrame` 记住最新帧；新增 1s `cliFrameHoldTimer`，当「有 SSE 客户端 + 无 screencast ws + 距上帧 ≥1s」时重播最后一帧（含合成 spaces，以便面板被空 spaces 清空时也能 ≤1s 内重回画面）。仅缺帧才补，不紧贴真帧重复推大图。

## 1.8.2 (2026-11-10)

**ego-cli 帧捕获诊断 + 放宽 exitCode 门槛（追 seq=0 根因）。**

- **放宽**：`spawnCliFrameCapture` 不再因 `exitCode !== 0` 整帧丢弃——只要 merged 输出里含帧哨兵且 base64 合法就用（ego CLI 可能打印哨兵后因尾部清理/断言非 0 退出）。无哨兵/空=不产帧（poller 保留上帧）。
- **诊断**：新增 `lastCliFrameDiag`（exitCode / stdoutLen / hasSentinel / stderr 尾 300B），`bcdp_doctor` 新增 `last frame try:` 行，直接告诉 seq=0 是截图失败、还是脚本抛错（附 stderr）。

## 1.8.1 (2026-11-10)

**修 ego-cli 路线侧栏 3s 帧同步不启动（poller 不自愈）。**

- **根因**：降级帧源 `CliFramePoller` 只在 `triggerCdpRefresh()` 里启动，而它只在两个时机跑：挂载探（`cliProbeColdStart=false`，不会拉起 ego 浏览器）与工具失败命中 CDP 连接错误时的重探。于是**冷启动**场景（Desktop 启时浏览器未跑）下：挂载探拿不到 `ready` → poller 不启动；后续 `bcdp_*` 把浏览器拉起了，但成功路径从不重探 → `attach` 仍非 ready → poller 永不启动 → 侧栏空且不 3s 刷新。
- **修复**：`runWithStaleSpaceRetry` 成功后若「无 screencast ws + poller 未运行 + 属降级 ego-cli 路线」，补一次重探（`maybeKickCliPoller`，5s 冷却、fire-and-forget），使 `attach` 翻 ready 并自动启动 3s poller。不改 client/worker，不引入新依赖。
- **修复（会话播种，直击 `pollerObserves=null`）**：`bcdp_status` / `bcdp_doctor` 的 execute 之前只做 `tiers.pulse()`，**不调用 `setCurrentSession`**。于是“重启后先跑诊断工具”时 spaceTracker 停在 global 槽 → `lastActiveSpace()` 为 null → poller 每 tick 直接跳过，`seq` 恒 0、侧栏无帧。现在两者都补上 `setCurrentSession(callingSessionId, link)`；并给 `spawnCliFrameCapture` 加兑底：`space` 为空时从已持久化的 `currentSession()` 派生 `dsh-agent-<sid8>`。修后只跑一次 `bcdp_status`/`bcdp_doctor` 即可让 poller 立刻对上会话命名空间。

## 1.8.0 (2026-11-10)

**macOS 开箱可用 + bcdp_wait_for_human + hideCursor + 固定视口 + flush 真实计数（对齐 dsh-ego-browser 优势）。**

### macOS 开箱（P0，移植自 dsh-ego-browser #65/#68/#95）
- **runtime `chrome.mjs`**：新增 `installPathCandidates()`，`which` 全部 miss 后扫描 macOS `/Applications` + `~/Applications` 的 Chrome/Chromium/Edge/Brave/Tungsten Edge `.app/Contents/MacOS/`（Windows 也补 Program Files/LocalAppData）。
- **runtime `ensureXDisplay()`**：豁免 `darwin`（与 win32 同形）——macOS GUI 是 Aqua/Quartz、从不导出 `$DISPLAY`，之前会被误判为无头而尝试起 Xvfb 失败。
- **plugin `findChromeBinary()`**：新增 `darwinChromeCandidates()` + IS_DARWIN 分支（Chrome 不在 PATH，只在 `.app` 内）。
- **plugin `resolveEgoEnv()`**：`EGO_LINUX_CHROME` 注入条件由 `win32` 扩展为 `win32 || darwin`，darwin 首冷启动不再报 "no Chrome/Chromium binary found"。
- **runtime `paths.mjs`**：`CHROME_CONFIG_CANDIDATES` 新增 macOS `~/Library/Application Support/...` 分支（login-import 能定位源 profile）。
- **诊断**：`EGO_LINUX_USE_MOCK_KEYCHAIN=1`（或 `chromeArgs: "--use-mock-keychain"`）在 macOS 上用 mock keychain 启动 Chrome，用于判断 cookie 不落盘是否 Keychain 所致（默认关，降低静态加密强度）；README 补充 `Default/Cookies`（macOS/Linux）与 `Default/Network/Cookies`（Windows Chrome 127+）区别。

### 新增
- **`bcdp_wait_for_human`**：阻塞轮询直到人工完成 CAPTCHA/登录/2FA，可选 `selector` 作为“已完成”信号；返回 `{needed, resolved, waitedMs, polls, detected, kind, url}`。超时不报错（`resolved:false`），属轻量等待，区别于 `bcdp_space(op:handoff)` 的显式让权。
- **`bcdp_screenshot({hideCursor})`**：截图前临时隐藏 agent 虚拟光标（默认 true），`finally` 恢复，PNG 不再截到光标。
- **固定视口**：新增 `viewportWidth/viewportHeight/deviceScaleFactor` 设置（volatile），经 `ensureRealTab()` 尾部 `Emulation.setDeviceMetricsOverride` 每次调用生效，HiDPI 宿主避免站点降级移动布局。
- **`bcdp_auth_flush` 真实计数**：worker `/api/flush` 先 `Storage.getCookies` 统计 jar，再 `Storage.flushCookies`，返回 `{total, flushed}`（不再固定 total:0）。

### 说明
- 工具数 34 → 35（新增 `bcdp_wait_for_human`，归 session 分级）。
- macOS 运行时/路径分支仅影响 darwin；Linux/Windows 行为不变（条件隔离）。

## 1.7.12 (2026-11-08)

**新增：整页 Tab 锚点报告 @引用（tab-anchor-report）。**

- **功能**：侧栏 / 浮窗历史列表的每个 tab 项新增 `@` 按钮——一次点击 = 一份整页锚点报告（页面 role+name+快照作用域 anchor），归档到会话工作区 `picks/` 目录，composer 只留 `@"picks/<file>.json"` 短引用，与点选 picks 共用同一归档/dock/badge 体系。参考 dsh-doyourweb 的整页 @引用能力，但落到 CDP 后端。
- **粒度边界**：搜索框 @候选只做到 **tab 级**（整页打包为一条 token），元素级仍走既有逐元素点选 picks 路径，不把元素打散进列表。
- **实现**：
  - host 半 `src/tab-report.ts`（新）：开一条**短时 browser-level `CdpSession`**（不碰常驻 cast worker），`Target.attachToTarget` → `Accessibility.getFullAXTree` → `flattenAxTree` + `isInteractiveRole` 过滤 → `anchorFor(scope, backendNodeId)`，`scope = sha256(pageUrl \0 capturedAt)[:32]` 保证同页二次抓取锚点必变。上限 200 元素、超出 `truncated` 标注；Lightpanda 引擎降级为仅 URL+标题。role+name 取 AX 树而非 `DOMSnapshot.computedStyles`（后者不答 `role`/`aria-label`）。
  - `src/gateway.ts`：新增 `POST /bcdp/api/tab-anchor-report` 分支，attach 未 ready 返 409 `attach-not-ready`，写档复用 picks 目录，返回 `{file, token, count, truncated, degraded}`。
  - client 半 `src/client/index.ts`：`deliverTabReport(ctx, space)`（同 targetId 二次点击扫草稿比对复用原文件名覆盖）；浮窗 `renderHistory` + React `EgoBrowserTab` 历史行加 `@` 按钮与 busy/done/err 态样式；dock card 按 `obj.type === 'tab-anchor-report'` 分支渲染（role+anchor 片段 / URL / 元素数+truncated），badge 因匹配同一 `picks/` 正则自动计入。
- 测试：新增 `tests/tab-report.test.ts` 9 例（scope 确定性 / 跨快照必变 / 文档序编号与锚点 / 去重忽略零值 / 200 截断 / 完整报告形状 / lightpanda 降级 / 二次抓取锚点变化）；typecheck 双配置无错、三产物 build 通过、全量 949 passed。

## 1.7.10 (2026-11-04)

**修 tabbit 通道观察窗永远空白：帧回执被降级成 `resource` 后静默丢弃；顺带修 `bcdp_screenshot` 返回 `[object Object]`。**

- **根因（同一类两处）**：`tabbit-cli` 对 `nodejs` 返回值有内联阈值，超过即降级为 `resource`（`{type, resourceId, byteLength}`，**没有 `value` 字段**）。而帧轮询器把整张截图 base64 塞进回执（视口 PNG 约 1.3 MB、JPEG q45 仍有 0.42 MB），于是 `receipt.data.base64 === undefined` → 不推送任何帧；又因为 `status` 仍是 `succeeded`，旧代码只在 `!receipt.ok` 时告警 → **面板空白且零日志**。`bcdp_screenshot` 则是把降级后的整个对象当成 base64 回给模型，表现为 `base64: "[object Object]"`。
- **修法**：截图字节不再走回执。新增 `buildFrameCaptureSnippet(outPath)`、改写 `buildScreenshotSnippet(outPath)`：snippet 内 `fs.writeFileSync` 落盘，回执只带路径（几十字节，稳定内联）；host 侧 `readFileSync` 取字节后 `broadcastCliFrame`。`bcdp_screenshot` 现在返回 `{path, base64, bytes, url, title}`，`path` 与工具描述一致。
- **绕开 `page.screenshot()` 的字体等待**：该 API 在 Tabbit 运行时卡在 `waiting for fonts to load` 直到 30s 超时（百度首页实测重复复现）；改用 page 作用域 `context.newCDPSession(page)` + `Page.captureScreenshot`（同页实测 132ms–2.6s）。`about:blank` 直接跳过——空页会把 CLI 拖到 60s 硬截止（实测 `EVALUATION_TIMEOUT`），且空白帧对面板无意义。
- **轮询必须带 `--tab`**：不带时 CLI 跑的是任务的**默认页**（全新 `about:blank`），截图永远是空页。原来赋值却从未被读取的 `_tabbitLastActiveTabId` 现在真正生效：`TabbitReceipt` 新增 `tabIds`（从 `result.acquisition.tabIds` 提升——它和 `result.value` 平级，旧解析把它丢了），每个 tabbit 工具调用后记录，轮询优先用它，回落到库存里 `active: true` 的 tab。
- **`--timeout-ms` 硬契约（第二处根因，实测才发现）**：CLI 只接受 60000–180000，超出直接 `REQUEST_FAILED` 整请求拒绝、snippet 根本不执行。而轮询器传的是 10000/15000 —— 也就是说**即使截图逻辑修好，轮询也从未真正跑过一次**；更隐蔽的是这个拒绝以普通 failed 回执出现，不像异常。现在在 `runTabbitSnippet` 一处夹紧（超范围自动夹到最近合法值、未传则省略走 CLI 默认 60s），短截止改由 snippet 内的 `Promise.race` 表达。
- **截图本身不可靠，需在 snippet 内设截止**：同一个 tab 可以 132ms 返回，也可以永不返回；不设截止时会把整个 evaluation 拖到 CLI 硬截止（60s），**连带杀掉该 task 的执行器**、影响后续所有调用。新增 `TABBIT_CAPTURE_DEADLINE_MS`（默认 8000ms），超时返回 `{skipped: "capture-timeout"}` 而非挂死；`bcdp_screenshot` 对此给出明确失败文案而不是空等。
- **并发与可观测**：一轮截图未返回时跳过下一 tick（重页面 2.6s 对 3s 间隔会堆叠 spawn）；`receipt.ok` 但无路径时明确告警（不再静默）；持续的 `skipped` 原因只打一次 `info`，避免每 3s 刷屏；`broadcastCliFrame` 新增可选 `fmt`（JPEG 帧必须标 `jpeg`，否则客户端按 `data:image/png` 装 JPEG 字节）；`TabbitTab` 类型补上 CLI 实际字段 `tabId`/`active`（原类型写的是 `id`、丢了 `active`）。
- **顺带**：`findLink`/`resolveEffectiveLink` 对缺失的 links 列表返回 null 而非抛错（两者现在跑在每个工具调用与轮询 tick 上，部分配置不应从工具路径抛出）。
- 测试：新增 `tests/tabbit-cli-link.test.ts` 19 例（回执只带路径不带字节 / 走 CDP 而非 `page.screenshot` / JPEG 质量 / 空白页跳过早于抓图 / detach / 路径转义 / race 截止与 `capture-timeout` 标记 / `tabIds` 提升 / `resource` 降级形状 / `--timeout-ms` 四种夹紧情形）；全量 945 passed / 13 skipped，typecheck 双配置无错。
- **实测边界（交接必读）**：修后的 snippet 在真实百度 SERP tab 上跑通——`status=succeeded`、`elapsedMs=8228`、落盘 302972 字节、JPEG 魔数 `FF D8 FF E0` 与结束标记 `FF D9` 均正确。但注意 **8228ms 已贴着 8s 截止线**：在 tab 争用/重页面下抓一帧接近 8 秒，远超 3s 轮询间隔，所以观察窗当前实际刷新率约「8 秒一帧」而非「3 秒一帧」。若要真做到 3 秒一帧，需要降视口/降质量或改用 screencast 通道，属后续优化项，不在本次范围。

## 1.7.9 (2026-11-04)

**降级帧刷新 5s → 3s；`bcdp_doctor` 新增会话作用域诊断行。**

- `CliFramePoller` 间隔由 5000ms 改为 **3000ms**（`/spaces` 的 `cliFrameIntervalMs` 同步为 3000）。
- `bcdp_doctor` 在 `frame source:` 行后新增 `session scope:` 行，同时打印 `callingSessionId(exec)`、本次调用空间 `cfg.activeSpace`、poller 实际观察的 `spaceTracker.lastActiveSpace()`、`defaultSpace` 与 `isolateSpaces`。用于定位“空间名仍为 default”的真正成因：若 `id=(none → global slot)` 且 `thisCallSpace=default`，则是宿主未给工具执行携带 `exec.agent.session.id`（会话作位于 harness 层失效），而非 poller 本身——poller 已不再主动注册 default。

## 1.7.8 (2026-11-04)

**修 1.7.7 实测两 bug：降级帧源错用 `default` 空间 + 观察窗无画面反馈。**

- **空间选错（session 隔离未生效）**：poller 跑在任何工具执行之外，旧版读 `cfg.activeSpace ?? cfg.defaultSpace` 会落到 `__global__` 槽→字面 `default` 空间，于是它 `useOrCreate('default')` 注册了一个多余的 default 空间，且截的是那个空 default（agent 的百度实际开在 `dsh-agent-<sid8>`）→ 观察窗永远空白。改为追踪**最近一次真实（非 global）会话空间**（`spaceTracker.lastActiveSpace()`，setCurrentSession/opened/selected 三处记录）；无真实活动时 poller 直接跳过（不 spawn、不注册 default）。
- **无画面反馈（SSE 断链）**：降级模式无 screencast worker，而 worker 为 null 时 `/api/bcdp/stream` 是静默流，既无 `spaces` 也无 `frame` 事件；客户端旧版只在 `refresh()` 已看到 cliFrameMode 后才起轮询定时器（鸡生蛋）。改为 **poller 每采到一帧就经既有 SSE 通道广播** `spaces`（合成单空间）+ `frame`（PNG）两个事件（`broadcastCliFrame`，复用 markEgoToolCall 同一 `sseClients`），客户端现有 `spaces`/`frame` handler 直接渲染；删掉两路径的客户端轮询定时器，仅保留 mount 时一次 URL 种子作即时首帧。
- 测试：新增 poller `onFrame` 成功推/失败不推 1 例、`lastActiveSpace` 隔离语义 1 例；`cast-server-cli-frame.test.ts` 补 hermeticity（`EGO_LINUX_STATE_DIR` 指向空临时目录，避免真实活 worker 污染 ensureWorker）。全量 926 passed / 13 skipped，typecheck 双配置无错。

## 1.7.7 (2026-11-04)

**ego-cli 观察窗降级帧源：无 CDP screencast 时每 5s 走一次 CLI 截图填充画面区。**

- 激活 link 为本机 `ego-cli` 时没有可注入的 CDP ws，screencast worker 附着不上、观察窗此前是黑盒空态。新增 `CliFramePoller`（`src/cast/cli-frame-poller.ts`）复用真实工具同一条 `ego-browser nodejs` 通道，每 5s 跑一段被动截图 heredoc（`taskSpaces.useOrCreate` + `page.screenshot` 读回 base64，**不 switchTab**，纯观察不改活动标签），只缓存最新一帧 PNG。
- 新路由 `GET /api/bcdp/cli-frame` 返回最新帧（`image/png` / 无帧 204，走既有 trust-fence）；`/api/bcdp/spaces` 在无 worker 但 poller 有帧时合成单条 `__cli_frame__` 空间并置 `cliFrameMode`，前端（悬浮窗 + 侧栏两路径）向 `frameCache` 种一个带 `?t=` 的 URL 复用既有 cached 分支渲染，按 interval 轮询刷新——非 SSE 推流、本地无带宽压力。
- 自限三处：`egoLockBusy()`（新增锁深度计数）在工具调用占用时跳帧、link 切回 CDP endpoint 时 poller 自动 stop、面板隐藏/idle 随既有 worker lease 停。
- 新增 volatile 开关 `cliFramePollEnabled`（默认开，热生效）：关 = 不拉截图子进程、面板回占位。`bcdp_doctor` 增 `frame source:` 行（screencast / cli-poll / none）。
- 测试：新增 `tests/cli-frame-poller.test.ts` 11 例 + `tests/cast-server-cli-frame.test.ts` 集成 6 例（路由 200/204/204未运行/401 + spaces 合成/回落）；全量 924 passed / 13 skipped，typecheck 双配置无错。

## 1.7.4 (2026-10-28)

**issue #4 根治：悬浮球/面板位置持久化改视口比例制（百分位）+ resize 实时重摆。**

- 位置以 `{fx, fy}` 视口归一化比例（左上角，4 位小数）存储；重启/最大化/换分辨率-缩放后球按**存的角落跟随视口**，不再出现“贴边角跑到屏幕中间/对话区边缘”的漂移。
- 补 `resize` 监听：视口变化即按比例重推导落位并夹回屏内；面板开着时同步重锚到球旁，关着则下次打开重锚（既有 `snapPanelToFab`）。
- 旧像素存档零迁移：读入时形状判别、按当前视口自动换算（`normalizeStored/toRatio/fromRatio` 纯函数由 `tests/fab-pos.test.ts` 6 例钉桩；与 dsh-context-compression-improved monitor-fab 同构双侧同步）。
- 门禁顺带修复：`publishConfig.tag` 从 `latest` 恢复为 `dsh-0.2.1` 形状（本仓纪律=发布显式 `--tag`，`latest` 值使 manifest 形状测试自 1.7.2 起常红）。

## 1.7.3 (2026-10-28)

1.7.3: host enumeration addendum for DSH 0.2.1-rc.4 (declaration-only bump; contract plane zero diff). `engines.dsh`/`dsh-plugin.json`/README 同串补 `0.2.1-rc.4` 枚举行。

## 1.7.2 (2026-10-26)

**两件事：修掉「禁用 ego 后所有调用仍走 ego 方式、唯一激活的 CDP 端点无法操作」的通道路由 P0；并移除 useSdkPath 开关（OFF 只会必炸）。**

### 修复（通道重确认）
- **attach 缓存不再跨目标残留路由字段**。`refreshAttach` 旧实现把 `previous` 整体 spread 进新基底，ego-cli 只要激活探测成功过一次，`linkKind`/`cliPath`/`cliShape`/`endpointSource` 就永久粘在进程级缓存里——此后无论禁用 ego、切换激活、调序还是增删链接，`decideCdpAttach` 仍判 `kind:'cli'`（不注入 `EGO_LINUX_CDP_URL`）、`egoArgvPrefix` 仍 spawn 本机 `ego-browser.exe`，直到重载插件才解毒。现改为**每轮干净基底**（路由字段显式置 undefined 清除，patch 合并语义下缺键会让旧值存活）。
- **links 事件后重新确认最优先通道**（新增 `resolveEffectiveLink`）：激活项可用则激活项赢；激活悬挂（指向禁用/已删行）时**序内首个 enabled 链接接管**（priority-fallback，日志 + doctor 的 `channel:` 行明示，绝不静默）；空激活保持显式未激活。开关切换、激活切换、调序、增删全部经 volatile 链路触发重确认。
- **spawn 决策与缓存交叉验证**（新增 `effectiveChannel`/`attachMatchesLink`）：`decideCdpAttach`/`egoArgvPrefix`/`runEgoScript`/`bcdp_status`/idle reaper/teardown 一律从当前配置推导归属，缓存行必须描述同一链接（cdp 还要求 endpoint 一致）才算数；重探测在途窗口内陈旧缓存一律作废（等待 `endpoint-unresolved`），不会拿上一任的路由继续跑。
- `remoteDisabled` 改为配置直读（缓存副本可能滞后一个刷新周期）；CDP 探测成功路径补记 `endpointSource: 'remote'`；`no-active` 文案区分「空激活」与「激活悬挂且无可接管者」。

### Breaking（useSdkPath 开关移除）
- **设置卡的「使用内置 harness」开关删除**。原生 ego CLI 没有 `taskSpaces` facade，不带插件 harness 的每个 `bcdp_*` 调用都死在第一行（`taskSpaces is not defined`）——OFF 是没有合法结局的状态。面板旧版还会给新建 CLI 行烤死 `useSdkPath: false`（本次用户实锤踩中：面板重加的行必然全炸）。
- 宿主读取侧**强制 `useSdkPath: true`**：存量配置里已写入的 `false` 读取时自愈，无需手改 YAML；字段保留仅为旧配置可校验（schema 描述已标 deprecated）。probe 对不支持 `--sdk-path` 的 CLI 仍自动撤注入（R-1 守卫不变），故无条件 ON 安全。

### 测试
- 新增 14 例：`resolveEffectiveLink` 归属表（5）、缓存按链接交叉验证（1）、`refreshAttach` 切换/禁用/删除/全禁用重推导（4）、`decideCdpAttach` 作用域与 in-flight 陈旧缓存不泄漏（5，新文件 `tests/channel-reconfirm.test.ts`）；`buildCliRow` 默认值与 coerce 自愈锚点同步。
- 全量 899 passed / 13 skipped；typecheck 双配置无错；装机产物与仓内 lib 哈希逐字节一致（desktop 实测，含用存量坏行原样复跑完整切换场景）。

1.6.1: host enumeration addendum for DSH 0.2.1-rc.3 (declaration-only bump; contract plane zero diff).

## 1.7.0 (2026-10-25)

**两件事：吸收外部 fork 的三项修复，并把常驻注入面收窄到单一解锁入口。**

### Breaking（常驻面收窄，代码计划见 `.agents/plans/bcdp-core-narrowing/`）
- **`bcdp_status` 成为唯一常驻工具**。`core` 批从 6 个收窄到 1 个：`space` / `navigate` / `help` / `doctor` 移入 `act` 批（现 13 个），`snapshot` 移入 `observe` 批（现 5 个）。不碰浏览器的会话每轮常驻 schema 从 **4,978 → 401 字符**（≈1,430 → ≈115 token，**−91.9%**，均为挂载级实测）。
- **`bcdp_script` 不再冷启动可用**。“escape 批不吃活动闸”的豁免已移除（`tierAllowed` 里的 `if (tier === 'escape') return true`），它现与其它非 core 批一样等首次浏览器活动。要拿到它：先调一次 `bcdp_status`。
- **闲置回收后模型手里只剩 `bcdp_status`**（旧行为是 core 6 + escape）。继续操作需重新调一次 `status` 解锁。
- 回退方式：设置页把 `toolInjection` 改为 `always`（volatile 热更，不需重启），即回到「挂载即全量」的历史行为。

### 修复
- **浏览器重启后的 CDP 陈旧 ws 自愈**：浏览器以同一端点重启会换新 browser id，缓存的 attach ws 失效，此后每个 `bcdp_*` 都报 `failed to connect to CDP endpoint` 直到重启 DSH。现在 `runWithStaleSpaceRetry` 在命中该签名时重探活动链路一次，确有新端点则重试（硬上限 1 次，`refreshAttach` 返回 false 不空转）。该签名不在 `COLD_START_SIGNS` 也不在 `TAB_STUCK_RE` 里，所以旧有三层自愈都救不了它。
- **脚本只打纯文本不再误判失败**：`ego-browser` 退出码 0 即权威，`@@DSH_RESULT@@` 哨兵只用于丰富结果；工具侧新增 `toolPayload` 兜底（无 JSON 时回传截断 4000 字符的原文 + `note`），不会返回空结果。

### 可发现性
- 分级封印的自救指引上了两个承载面：常驻的 `bcdp_status` 描述写明「工具不在列表 = 被分级封印而非损坏，本调用会重新打开它」，`bcdp_help` 的 `topic=injection` 补英文 `SEALED TOOLS` 头部（该索引不常驻，零每轮成本）。
- 工具描述互斥引导（只加指针、不加 HOW）：`bcdp_js` / `bcdp_cdp` / `bcdp_http` / `bcdp_script` / `bcdp_help` 五条各增 ≤80 字符交叉指路（全量面 +330 字符，常驻面仅 `help` 一条 +65）。
- 四处同源文案同步（`config.ts` / `dsh-plugin.json` hints / `help.ts` / 自绘设置卡 `src/client/index.ts`），并清掉 `dsh-plugin.json` 与设置卡里残留的旧计数（常驻 7 / 逃生舱 2 / 16 个 / 共 38 个）。

### 测试与度量
- 新增 6 例：CDP 重探重试与不空转（2）、退出码语义（2，含非零退出仍失败直证）、常驻面预算 ≤600 字符门禁（1）、三档注入面单调性与分批度量打印（1）。
- 分级测试按新契约重写（含用例名）：`tool-tiers` 26 例、`tier-mount` 12 例全绿；批次上限从 ≤9 放宽到 ≤13（act 吸收 core 成员后为 13）。
- 全量 882 passed / 13 skipped；`npm run typecheck` 双配置无错。
- 三档实测注入面：默认 1 个 / 401 → 首次活动 23 个 / 16,203 → 三波后 29 个 / 21,288 → 全量 34 个 / 24,631（八批求和逐字对齐）。

## 1.6.2 (2026-10-25)

**修复：插件挂载不再拉起 ego 浏览器（`allowProbeColdStart` 探测冷启动闸门，默认关）。**

### 根因
- 挂载时的初始 CDP 探测对激活的 `ego-cli` 链接跑一次权威 heredoc 探测（`<cli> nodejs` + 哨兵脚本）。该通道在脚本运行**之前**初始化 CLI 的 agent 运行时，副作用就是把背后的浏览器冷启动（vendored CLI：`createEgoShim → ensureBrowser → launch`；原生 ego lite 运行时同行为）。于是 DSH 宿主每次启动、每次设置变更（`bridge.onChange`）都会弹出一个 ego 浏览器窗口——与探测自身的"只读"语义（`cli-launch` 标记、`--status` 快路径、`bcdp_status` 的"不启动浏览器"承诺）直接矛盾。

### 修复
- 新增全局开关 `allowProbeColdStart`（Config schema `.volatile()`，自动进设置面板与自绘设置卡「基础」分组；**默认禁用**）。禁用时：`probeCliLink` 只跑只读的 `--status`/形状探测；仅当 `--status` 证明浏览器已在运行才执行 heredoc 验证，否则跳过（`heredocSkipped`），浏览器推迟到首个真实 `bcdp_*` 调用才冷启动。`sdkPath` 注入在跳过场景保持不变。
- 求值极性只认显式 `true`（布尔或字符串）：手改 YAML 的 `'false'`/`0` 不会被宽 `Boolean()` 误开。
- 自绘设置卡（`FAM_FIELD_GROUPS`）补渲染该字段。
- 新增真机探针 `tests/cdp-probe/cli-coldstart.probe.test.ts`：对真实原生 CLI 断言"只跑一次 `--status`、`nodejs` 通道从未运行、`ego.exe` 进程数零增量"（默认自跳过）。
- 单测 +11（闸门极性/跳过行为/向后兼容/透传），全量 876 绿。

## 1.6.0 (2026-10-21)

**默认行为变更：会话隔离成为默认。** 一个 `bcdp_*` 调用**省略 `space`** 时，不再落到跨会话共享的 `default`，而是落到**本会话自己的**任务空间 `dsh-agent-<会话id前8位>`；只有**显式**写 `space: 'default'`（或 `op=open name='default'`）才使用共享具名槽。

### 变更：默认任务空间改为按会话派生
- `resolveConfig` 中 `defaultSpace` 的**空值折叠目标**由 `'default'` 改为 `':auto'`：不配置即为会话隔离，无需额外开关。
- `deriveSlotDefaultName` **取消 `isolateSpaces` 门**：`:auto` 在持久模式与沙箱模式下**都**派生 `dsh-agent-<sid8>`。空间**命名**与 `isolateSpaces`（只管 Profile 落盘 vs 内存沙箱）是两条独立的轴，此前把两者绑死，导致「持久模式下配 `:auto` 也永远得到 `default`」。
- 显式 `space: 'default'` / `op=open name='default'` 仍完全可用：该会话随后固定用这个共享槽。把 `defaultSpace` 设成具名值（如 `default`）可全局退回旧行为。
- 无 session 的调用（`__global__` 槽）仍回落 `default`，向后兼容。

### 修复：真实 DSH 会话 id 会塌缩成同一个空间
- 旧派生用 `sessionKey.slice(0, 8)`。真实 DSH id 形如 `session-52adc205-3251-…`，前 8 位恒为字面量 **`session-`**，于是**所有会话撞进同一个 `dsh-agent-session-` 空间**，隔离在无声中完全失效（不报错，只是共用上下文）。
- 新增 `sessionSpaceToken()`：先剥掉 `session-` 前缀、去掉非 `[A-Za-z0-9-]` 字符，再取 8 位；短 id 原样使用（仍唯一）；退化/空 id 用 FNV-1a 哈希兜底保证非空。
- 补 5 条回归测试：真实 id 正确分离（`session-52adc205-…` → `52adc205`）、两会话 token 不同、永不返回裸前缀 `session-`、短 id 原样、token 合法且 ≤8 位。

### 文档与描述
- `bcdp_space` 描述改为教新默认语义：省略 `space` = 本会话空间；要共享才显式传 `default`。
- `Config.defaultSpace` 的 schema 描述同步；`README` 的「任务空间命名与并发隔离」小节重写为 1.6.0 口径，附「你怎么写 → 落到哪个空间」对照表，并记录 `session-` 塌缩这个坑。

### 迁移指引
- **无需任何操作**：默认即隔离。
- 想维持「所有会话共用一个空间」的旧行为：把 `defaultSpace` 设为 `default`，或在调用里显式 `space: 'default'`。
- 注意：会话空间是**按会话命名**的命名空间，不是「每个会话独立 Cookie」。是否把登录态落盘仍由 `isolateSpaces` 决定；Profile 持久模式下登录态依然跨重启保留。

### 验证
- `npm run typecheck` EXIT 0；`npm run test` **866 passed / 12 skipped（878）**（较 1.5.0 的 861 增 5 项 token 回归）；`npm run build` 三 bundle complete。
- 确认 profile / 设置存储中无持久化的 `defaultSpace` 残留，新默认会生效（`~/.dsh` 全量扫过，命中均在记忆库与会话缓存，非插件配置）。

## 1.5.0 (2026-10-21)

**破坏性变更**：工具面三族合并（计划组 `bcdp-tool-consolidation`）。`wait` / `space` / `escape` 三族按 `op` 收口，工具数 **41 → 34**，全量 schema **24,093 → 22,224 字符**（净省 1,869，天花板 24,094 未上调）。旧工具名**直接移除**，不保留薄别名——别名同样占 schema 预算，保留等于没省。迁移表见 README「1.5.0 迁移表」。

### 移除（破坏性）：8 个旧工具名
- `bcdp_wait_for_selector` / `bcdp_wait_for_url` / `bcdp_wait_for_response` / `bcdp_wait_page` → 并入 `bcdp_wait` 的 `op=selector|url|response|load|function|request|event`。
- `bcdp_space_open` / `bcdp_space_close` → 并入 `bcdp_space` 的 `op=open|close`（原有 `op=list|handoff|takeover` 不变）。
- `bcdp_cli` → 并入 `bcdp_script` 的 `verbatim:true`（裸 heredoc、无 preamble、返回含 `output` 合并文本）。

### 变更：三族为何可合（同源证据）
- **wait（5 → 1）**：五个工具共用同一 `useSpace(...)` + `ensureRealTab()` preamble、同一 `timeout` 语义、同一 `space` 参数；`bcdp_wait_page` 本身已是 `op` 多动作形态，合并是把既有范式用完，不是新范式。
- **space（3 → 1）**：`bcdp_space` 本就是 op 工具（list/handoff/takeover），open/close 只是没并进去。
- **escape（2 → 1）**：`bcdp_cli` 与 `bcdp_script` 是同一 heredoc 运行时，唯一差异是 preamble（script 先选空间 + 激活真实 tab）。

### 修复：空间追踪的分派基准随合并调整
- 共享 `t()` 包装器的 `afterExecute` 原按**工具名**分派 tracker（`bcdp_space_open` → `spaceTracker.opened`、`bcdp_space_close` → `spaceTracker.closed`）。三族合并后工具名不再携带动作信息，改为按 `args.op` 分派。若不改，活动空间追踪会**静默失效**（不报错、只是状态不对）。已补三条单测直接观察该唯一用户可见效应（后续调用解析到的默认空间）。

### 保留的守卫（逐字未动）
- `op=function` 仍用 `safeEvalWrap(expr, true)`（preserveFalsy）——否则 DOM/window 返回值会撞 SDK 的 `Object reference chain is too long`。
- `timeout` 默认值分档不变：普通 op 10,000ms、页面级 op（load/function/request/event）30,000ms。
- 各 op 的失败均可归因：`reason` 带 op 名（如 `bcdp_wait: selector is required for op=selector`），不退化为裸 `ok:false`。
- `handoff` 后同脚本不碰 `page.*` 的硬停（P0-5）、`ensureRealTab`、`attachSessionHint` 全部保留。

### 变更：默认注入面更窄
- `lazy` 默认档下不碰浏览器的会话在场工具 **10 → 7**（core 6 + escape 1 = 4,978 字符 ≈ 1,430 token）；`always` 全量 34 件 = 22,224 字符。
- `core` 批次 **8 → 6**、`wait` 批次 **5 → 1**、`escape` 批次 **2 → 1**。

### 文档
- 6 个 README（`README.md` + de/es/fr/it/ru）工具表、分级表、注入面实测值、core 计数全部同步；主 README 新增「1.5.0 迁移表」。
- `help.ts` 工具清单与 `navigate` / `wait` / `network` / `script` 四个 topic 改为合并后口径。

### 验证
- `npm run typecheck` EXIT 0；`npm run test` **861 passed / 12 skipped（873）**（三族合并新增 11 项断言）；`npm run build` 三 bundle complete。
- 全量 schema 门：**34 工具 / 22,224 字符 ≤ 24,094**（实测落值，非估算）。
- `npm pack --ignore-scripts` 出 `dsh-browser-cdp-1.5.0.tgz`，解包 `lib/index.js` SHA256 与本地构建逐字节一致。

## 1.4.1 (2026-10-21)

空间命名与并发隔离加固（计划组 `bcdp-space-ns-hardening`，A/B/C/D1/E/F/G）。按风险分级落地，SDK 快照编号生成逻辑（D3）不在本轮改，以 D1 插件层解法替代。

### 新增（A）：可配置默认空间
- `Config.defaultSpace`（zod `.volatile()` 标量）：空值折叠为 `DEFAULT_SPACE='default'`，热更新无需重注册。`resolveConfig` 出的字段与运行时活值分离——`cfg.activeSpace` 是**当前会话槽**的实时值，`cfg.defaultSpace` 是**配置/schema** 值，避免二者撞名引发的 `EgoRuntimeConfig ↔ ResolvedConfig` 结构镜像类型断裂。

### 新增（B）：会话级空间隔离
- `createSessionSpaceTracker` + `GLOBAL_SESSION_KEY='__global__'`：把单一 `ActiveSpaceTracker` 升级为按 sessionId 键控的 `Map<string,Slot>`，`SessionSpaceTracker extends ActiveSpaceTracker` 增 `setCurrentSession` / `currentSession`。每个 `bcdp_*` execute 顶部先 `cfg.spaceTracker.setCurrentSession(callingSessionId(exec))`，并发多会话各开各空间互不漂移；无 session 调用落 `__global__` 槽保持向后兼容。

### 新增（C）：`:auto` 派生名
- `AUTO_SPACE_SENTINEL=':auto'`：沙箱模式（`isolateSpaces:true`）下默认名派生为 `dsh-agent-${sessionId.slice(0,8)}`（`AUTO_SPACE_PREFIX='dsh-agent-'`，沿用历史前缀）；持久模式折叠为具名单槽。

### 变更（D1）：跨调用稳定定位
- `bcdp_snapshot` 三处 `snapshotRaw` 统一带 `includeStableLocator: true`，输出含 `loc=css:/loc=role:/loc:href:` token；subtree 解析优先 `loc=`（跨子进程稳定）而非 `@N`（每次快照重编）。零 SDK 改动，活体验证：`bcdp_click` 吃 `loc=...` 命中。schema 预算门（≤+15%）以压缩描述守住，未放宽天花板。

### 修复（E）：页内返回值防御序列化
- `safeEvalWrap(expr, preserveFalsy)`：根因是 SDK 自身 `handleMessage` 序列化在 `page.evaluate` 返回 DOM/window 时抛 `Object reference chain is too long`（硬拒在 SDK 内层，早于任何外层 `safe()`），故修复必须在页内完成。`bcdp_wait_page op=function` 与 `bcdp_js` 套同款返回值降级包裹，返回 window/DOM 时 `ok:true` 且 value 为描述串。

### 修复（G）：heredoc 错误引导
- `attachSessionHint` / `ATTACH_SESSION_HINT`：`bcdp_cli` / `bcdp_script` 错误含 `no active tab to attach session` 时追加一行「先 `await taskSpaces.useOrCreate(name)`」引导，把裸 heredoc 缺 preamble 的坑点名给出，不留模型重新踩。

### 新增（F）：navigate 卡死自愈 watchdog
- `runWithTabRevive` + `isTabStuckFailure`（`TAB_STUCK_RE`）：复刻 `runWithStaleSpaceRetry` 骨架但换触发条件为 eval 超时 / `no active tab` / 主线程挂死特征，复位动作为先开新空白 tab 再关挂死 tab（顺序关键：先关会触发末-tab 守卫留下死 tab），重试**硬上限一次**，二次仍卡如实返回不循环（拒绝假绿）。`bcdp_navigate` 经 `tabRevive:true` opt-in，结果附 `recoveredFrom`（正常路径为 `null`）。

### 测试
- 新增 `runWithTabRevive` 5 条（tab-stuck 特征识别、恢复一次打标记、正常路径单次 spawn 不复活、非 tab 失败不复活、硬上限一次不循环）。全量 **832 passed / 12 skipped**，两套 `tsc` 通过，`tsdown` build 过，schema 预算门绿。

## 1.2.4 (2026-10-21)

### 修复（P0）
- **`--sdk-path` 贯通到工具执行**：此前只有探测路径带 `--sdk-path`，`runEgoScript` 拼 argv 时不带，`ego-cli` + `useSdkPath: true` 下每个脚本首行都崩 `ReferenceError: taskSpaces is not defined`。现在 `AttachState.sdkPath` 记录探测实际用过的 harness，`buildEgoToolArgv()` 统一为探测与执行构造 argv。写入条件带 R-1 守卫（`useSdkPath && probe.warning === undefined`）：CLI 不认该旗标并回退时，执行侧不会强塞一个它不认的参数。

### 修复（P1）
- **`bcdp_status` 改 facade 探针**：不再 spawn 官方 CLI 不存在的 `--status`，改为与干活同通道的 `nodejs` 探针，检查 `taskSpaces`/`browser`/`page` 三个 facade；输出新增 `facades` 字段，超时 25s → 15s（实测约 300ms）。
- **就绪探针不再假阳性**：`useSdkPath` 打开时，除 sentinel 外还要求 `taskSpaces`/`browser` 均为 `object`；未打开时保持原判据，vendored runtime 不受影响。
- **`--open` / `--stop` 按 link kind 门控**：`ego-cli` 下浏览器本就可见，`--open` 直接返回成功；空闲回收与卸载清理**绝不**对用户自己的 ego lite 发 `--stop`（三处均带明确日志）。

### 变更（P2）
- `bcdp_space_close` 从 browse 归入 core，与 `bcdp_space_open` 配对。
- **Schema 压缩**：按 AST 实测成本压缩 Top 工具（`login_import` / `jev_ask` / `http` / `download` / `click` / `jev_run` / `jev_attempt` / `wait_for_selector` / `key` / `read_element` / `wait_for_response`），全量 22,836 → 18,834 字符（-17.5%）。测量口径见 `ego-browser-cdp-issues.md` §9.0。
- **browse 注入批次**：内部按 `act → observe → wait` 顺序放行，对外仍是 4 个开关；`always` 模式不受影响。

### 文档
- `runtime/skills/ego-browser/SKILL.md` 更新为官方 `ego-browser skill` v2.1.0（550 行，ego lite 0.6.0.16）。
- README 补 `useSdkPath` / `--sdk-path` 语义与「双 API 面共存风险」（插件 `taskSpaces.*` vs 官方 `taskSpace()`）。

### 验证
- 全测 **779 passed / 12 skipped**；两套 `tsc` 通过；`tsdown` build 过。

## 1.2.2 (2026-10-18)

- hosts: 追加 0.2.1-rc.2 声明面枚举（34/34 @deepseek-ai/* 宿主 peer 逐包 npm 实测 rc.2 在版；本插件不触 ctx.web provider 与 conversation.input.model.label 槽，代码零改动，纯元数据发版；农场 rc.2 格挂账待命）

> ⚠️ **0.18.10 已被 registry 烧号**：npmjs 受理后长期停留在 staged 状态从未提交（读路径 404、重发 `EPUBLISHCONFLICT: previously staged`），版本号永久不可安装——**安装请用 0.18.11**（内容 = 0.18.10 全部 + dock 注册诊断 `__dshBrowserCdpDeco` + locale 补齐 + 点选卡片正则放宽）。0.18.5 同前例。

## [1.2.0] - 2026-10-15 — 工具分级注入（默认 lazy）+ 设置开关胶囊化与乐观锁写入

> **升级影响（从 1.1.5）**：默认档从「挂载即注册 38 个」变为 **`lazy`**——不碰浏览器的会话只常驻 6 个核心工具，首次 `bcdp_*` 调用后按开关注入。工具**名字与签名零改动**，只改出现时机；若你有脚本期望任一 `bcdp_*` 无条件在场，把设置页 `toolInjection` 改回 `always` 即可（volatile 热更，不需重启）。另外评审级（`bcdp_jev_*` 5 件）现在额外要求配了 JEV/Laya Key 才注入——没 Key 它们本来也只能回答「未配置」。

### 新增：工具分级注入
- **`src/toolTiers.ts`**：把「哪个工具在什么条件下允许注册」收成一处纯函数策略，附 `createTierInjector` 控制器（`offer`/`reapply`/`surface`），只接一个 `register` 回调、不依赖 Cordis，可脱离宿主单测。四级：**core**（6：`status`/`doctor`/`help`/`space_open`/`navigate`/`snapshot`，常驻不可封印——否则 lazy 连解锁入口都没有）/ **browse**（14）/ **extended**（13）/ **judge**（5）。
- **一级一个封印开关**（学 prime-memory 的「工具封印」同形同极性）：`toolInjection`（`lazy` 默认 / `always`）、`toolBrowse`、`toolExtended`、`toolJudge`，全部 volatile + schema `.default()`；ON = 开放注册、OFF = 封印（反注册，从模型工具列表消失，不是执行期拒绝）。封一级不波及别级。
- **活动驱动注入**：解锁信号挂在 `markEgoToolCall()` 的模块级 fan-out（新 `onEgoActivity()`）上，九个工具体零改动；`bcdp_status`/`bcdp_help`/`bcdp_doctor` 走独立 `pulse`（不借 `markEgoToolCall`，那会顺带弹开侧栏观察面板）。`bridge.onChange(() => tiers.reapply())` 让设置页翻开关当场重算注入面。
- **闲置自动收回**：`lazy` + `idleTimeoutMin > 0` 时，reaper 停掉后台浏览器的同一刻收回扩展面，下次活动重新铺开。
- **`bcdp_doctor` 首行报注入面**：`tool injection: mode=lazy browse=open extended=open judge=open judgeKey=none active=no → live 6 / sealed 32`；`bcdp_help` 新增 `topic=injection`（含「工具不在列表里就先跑 status/doctor，别猜不存在的工具名」）。
- 设置面：GUI 卡片新增首位分块「工具封印」（原在「基础」背后），TUI `SettingsSection` 四字段同样排到 `fields` 最前。

### 新增：设置卡开关形态与写路径
- **胶囊开关 `FamSwitch`**：布尔项不再用原生 `type='checkbox'`，改为 38×22 主题令牌胶囊（`--dsw-alias-bg-brand` / `--dsw-alias-bg-module-platform`，带 fallback），旋钮 `translateX(16px)` + 0.16s 过渡；用原生 `<button role="switch" aria-checked>` 自带聚焦与回车/空格。卡内三处裸 checkbox（links 行启用 / CLI sdk 路径 / auto 回落许可）一并换形。
- **`FamBoolRow` 乐观态**：点下去先本地翻转（pending 半透、锁重复点击），宿主快照追上来才清 pending；重试预算用尽则**弹回宿主真值 + 亮一行提示**（中英双语）——开关停在「看起来改了其实没改」是最坑的状态。
- **乐观锁写入 `src/client/fam-write.ts`**：`commitField(scope, field, value)` 默认 3 次尝试、间隔 300ms；`set` 同步抛 / reject / 返回 false 三条失败路径同等处理，异常不漏进 React 事件回调。卡内 14 个写入点全部收口，`scope.set(` 裸调用清零。

### 修复
- **`src/settings.ts` 崩溃**：`installSettingsAuto` 对 `createRequire('@deepseek-ai/dsh-settings')` 的返回值直接解引用（`typeof legacyModule.installSettingsSection`）——该包不在宿主 `node_modules` 时（TUI/headless/测试）`legacyModule` 为 `undefined`，整个 `apply()` 抛 `TypeError`。改为可选链。由新挂载测试暴露。
- **桥轨拒写先重读再报失败**：`makeBridgeScope().set` 以前在 `settings-conflict` 时 `void refresh()` 后立即 `return false`，手里 `revision` 还是陈的，上层重试等于白重。现在把 `describe` 等到底再交回失败（网络异常同路）。

### 不变量
- 38 个工具的名字、`description`、`parameters` 签名**零改动**——只改出现时机，不改手感。窄工具（一个动作一个工具）是模型写对参数、少重试的护栏，合并成脚本逃生舱不划算。
- `runtime/` 零改动；`Browser.close` 不发目标端点等既有守卫不变。
- 重试不会丢更新：宿主 `settings.mutate(ns, ops, expectedRevision)` 在 revision 不匹配时**拒写而不是覆盖**，所以重放的是自己这一次改动。

### 测试
- 新增 39 条：`tests/tool-tiers.test.ts`（17：分级表与源码 38 个 `name: 'bcdp_*'` 双向对齐的漂移守卫、四道闸矩阵、控制器幂等与单级封印）、`tests/tier-mount.test.ts`（9：最小宿主替身真走一遍 `apply()`，验默认 6 / `always` 33 / `always`+Key 38 / 活动后 33 / 单封 extended 后 20 / 配 Key 当场出现 / `ego_*` 别名跟随本体 / 卸载归零）、`tests/fam-write.test.ts`（6）、`tests/client-switch.test.ts`（4 条源码契约）。
- `tests/fam-links.contract.test.ts` 三处钉住旧 `scope.set(...)` 形态的契约断言同步换为 `commitField(scope, …)`。

### 验证
- 全测 **749 passed / 12 skipped**；两套 `tsc` 通过；`tsdown` build 过；`npm pack` 走 `prepack` 重建，包内 `lib` 与仓库逐字节一致（V6a）。

> 本机验证迭代 1.1.6-local.1 / 1.1.7-local.1 / 1.1.8-local.1 已折叠进上面的 1.2.0，未单独发布（那三个号只存在于本地 tgz 与 desktop profile 的 `file:` 指针）。

## [0.18.21] - 2026-10-04 — Lightpanda 受管行类型：按系统拉起 serve，有头/无头分型，顺序即优先级（同 0.17.25 同源）

### 新增
- **新连接类型 `lightpanda`（本机单例，同 ego-cli 规则）**：设置面板「添加 Lightpanda（受管）」入列，可排序/激活；插件负责 serve 的拉起/复用/停止。win32 经 WSL2（`wsl.exe -- lightpanda serve …`，遥测 env 经 WSLENV 带入），linux/mac 本机直装（显式路径 → `~/.local/bin` 等安装根 → PATH）。
- **有头/无头分型与顺序语义**（面板徽标 `LP·无头` + 行内提示）：CDP 端点/本机 Chrome/ego CLI 是有头类型——可人工兜底（手动输账号、过验证码）；Lightpanda 是无头类型——无法人工介入，只适合快速试验。顺序即优先级：LP 排前 = 快速场景优先用；排有头类型后 = 兜底优先，LP 实际不会被启用。
- **引擎互斥单例**：登记表带 engine 字段；受管 Chrome 与 Lightpanda 抢同一受管槽。win32 停止对 WSL 内进程做定向 pkill 兜底。
- **doctor/help**：links 计数含 lightpanda + 行状态；help topic=lightpanda 更新。

### 变更
- `cdpMode=remote` 下激活 LP 行显式报 `mode-kind-mismatch`；probe 回写 `probeEngine`；`lightpandaArgs` 设置键（受管旗标过滤）。

### 验证
- 全测 714 passed / 12 skipped；两套 `tsc` 通过；build 过；`runtime/` 零改动。

## [0.18.20] - 2026-10-04 — Lightpanda 作为可选后端（P0）：识别投影 + 全链降级（同 0.17.24 同源）

### 新增
- **引擎识别与能力投影**：`src/cdp/capabilities.ts` 单点权威（`engineOf` 认 `/json/version` 的 `Browser: Lightpanda/…` 前缀，`capabilitiesFor` 出投影；unknown/chrome 恒=全能力）。probe/attach 双时机识别：link 新增 `probeEngine` 探针字段 + `AttachState.engine`，面板 badge / `cdp-status` / `cdp-probe` / `bcdp_doctor` 可见，旧行收敛 `'unknown'`。
- **engine 跨进程传递**：spawn env `BCDP_CDP_ENGINE`（循 `EGO_LINUX_CDP_URL` 先例）——host 侧投影一次，worker/render 子进程只读不重算。
- **真机探针** `tests/cdp-probe/lightpanda.probe.test.ts`（`LP_PROBE_URL` 自跳过；8 断言：识别 / navigate+lifecycleEvent / evaluate+AXTree / png 出图 + jpeg 结构化 -32000 / cookies 往返 / Overlay UnknownMethod 且 session 不受污染 / Input 注入 / Network 事件五件套）。

### 变更（识别 lightpanda 后自动降级，无需配置）
- **format 四处收口**：worker screencast + backstop、**jev capture（不修则 LP 上 jev 视觉链 -32000 全链硬失败）**、worker `/api/marks`——LP 下 wire 全 `format:'png'` 且无 `quality`；`bcdp_captcha`/jev 输出带 `engine`/`rendering:'text'` 元数据。
- **观察窗**：无 screencast 时拒绝启动采集循环，status/SSE 带 `engineUnsupported`，两面板降级提示条；SSE 帧按 `fmt` 选用 png/jpeg data URL。
- **pick**：`/api/pick` engine-gate 返回 `engine-unsupported`（i18n）；坐标回退 `/api/pick/click` 经依赖验证**保留可用**。
- **`bcdp_download`**：注册处 gate，结构化报错不挂起；**`bcdp_auth_flush`** LP 下返回 `degraded: true`。
- **doctor/help**：engine + 降级清单 + 分系统安装指引（win32→WSL2 内置方案，linux/mac→一键脚本 + `~/.local/bin` PATH）；`bcdp_help` 新增 `topic=lightpanda`；工具清单补漏的 `bcdp_jev_attempt`（38 个）。
- **README/HANDOVER/THIRD_PARTY_NOTICES**：Lightpanda 小节 + AGPL 客户端使用声明。
- **0.2.0 线适配**：client i18n 已内联（locales.ts 本线已删），`engineUnsupportedBanner`/`engineUnsupportedPick` 并入 `watchEn`/`watchZh` 内联字典。

### 不变量
- **`Browser.close` 永不发目标端点**：唯一合法调用点 = login-import 本地临时 Chrome；`tests/browser-close-invariant.test.ts` 源码扫描钉死。`runtime/` 零改动；unknown/chrome 行为逐位不变。

### 验证
- 全测 706 passed / 12 skipped；两套 `tsc` 通过；`tsdown` build 过。

## [0.18.19] - 2026-10-03 — 真机反馈⑩：点选特征采集换轨——纯文本链接读元素自身可见文本（同 0.17.23 反向同源）

### 修复（真机：News 这类链接全采成 `a name="" focusable`）
- **根因**：`describeNode` 的 name 只从属性取，`<a>News</a>` 的可见文本在 textContent 里，深度 0 不可见——纯文本链接全部 `name=""`。
- **修复**：新增 `readNodeText`（resolveNode + callFunctionOn 读元素自身文本，压空白截 60 字符）；pick 链路 name 为空时回退——描述/slug/归档 name 三处同步可辨。
- best-effort：读失败不推翻 pick；有属性名的元素不多读。

### 验证
- 全测 693 passed / 11 skipped（含 2 条新测试）；两套 `tsc` 通过。

## [0.18.18] - 2026-10-03 — 真机反馈⑨：归档文件名带元素特征 slug（同 0.17.21 反向同源）

### 变更
- **归档文件名换轨**：`picks-<时间戳>.json` → `picks-<首元素特征slug>-<5位base36>.json`——slug 取 describe → name → tag 开头 ~12 字符，清成网关白名单 `[A-Za-z0-9._-]`；中文等清空时回退时间戳。后缀保留短时间戳：不同页面的同特征元素各归各档，防同名归档互相覆盖。
- **引用片 label 同步可读**：片显示 `🌐 <slug>`（不再是完整路径），composer 里的片一眼可辨。

### 验证
- 全测 691 passed / 11 skipped；两套 `tsc` 通过；bundle 实测含 slug 逻辑。

## [0.18.17] - 2026-10-03 — 真机反馈⑧：原子引用片插入（宿主附件同款）+ 归档加载失败显码（同 0.17.20 反向同源）

### 修复（真机：计数 0 + 无片替换）
- **显示替换换轨**：纯文本 `@"picks/…"` 只会被宿主 `FOLDER_REF_RE` 染色（宿主从不做文本→片的自动替换，paste-dock 的文档片是它主动插入的原子节点）——deliver 首次投递改为**优先插原子引用片**（`ReferenceChipNode`：`inputActions.captureInsertion()` 取 TokenSpan + `inputTriggers.serializeReference` 能力证明 + `insertReference` CAS；边界空格同 paste-dock），插不进回退文本 token。
- **计数 0 根治**：卡片加载失败原来被吞成"已选 0 个元素"——改三态：加载中 `…`、失败亮错误码（`⚠ no-workspace / not-found / load-failed`）、成功显真实元素数；错误码同时进 `__dshBrowserCdpDeco`。
- **会话来源加固**：卡片 picks-load 的 session 以 inject 下发字符串优先、宿主标准 props（`sessionId`）兜底。

### 验证
- 全测 691 passed / 11 skipped；两套 `tsc` 通过；bundle 实测含 `tryInsertPickChip`/`captureInsertion`/`serializeReference`。

## [0.18.16] - 2026-10-03 — @mention 引用模型：token 以 @ 开头（`@"picks/<file>.json"`）+ 归档会话级解析（同 0.17.19 反向同源）

### 变更
- **投递/引用格式换轨（0.18.13 模型的修正）**：composer 里的引用从 `[🌐 CDP-PICKS → … | … | … | elements:N]` 长行改为 **`@"picks/<file>.json"` 短 token**——被替换字段以 @ 开头（dsh-paste-dock 文件引用同精髓），显示层把它替换成文件片；dock 卡/🌐 徽标同步按 @ 引用解析，✕ 摘除整个 token。
- **同页合并简化**：扫草稿各 @ 引用 → 逐个读归档比对 `cdpEndpoint` → 命中者原文件重写；token 不含元素数，合并时草稿零改动（引用卡每 5s 重读归档自动刷新元素数）。
- **归档目录会话级解析**：`picks-save`/`picks-load` 请求携带 `session`，网关经 `workspaceRegistry` 把会话解析到其注册工作区的 `picks/` 目录（无注册工作区或多个候选 → 409 `no-workspace`，不猜）；同 dsh-paste-dock 的 `resolveWorkspaceDir` 语义。

### 修复
- **引用卡居中**：样式补 `margin-left/right: auto`——卡在 dock 带内居中（限宽公式不变），不再偏一侧。

### 验证
- 全测 691 passed / 11 skipped；两套 `tsc` 通过；`lib/client.js` 161.93 kB（构建含 `@"picks/` token 写入与 session 参数）。

## [0.18.14] - 2026-10-03 — 包装卡样式重写：不透明实底 + input-traffic 同款限宽（同 0.17.17 反向同源）

### 修复
- **透明度太高无底面**：卡片样式改幂等 `<style>` 类样式表——不透明实底（亮 `#f7f7f9` / 暗 `#1c1c1e` 自适应），文字对比度不再受宿主皮肤透明变量影响。
- **太长顶满整窗**：采纳 input-traffic 同款限宽公式 `min(100% - 侧间隙×2 - dock 内距×2, 内容列宽 - 内距×2)`——卡宽限制在内容列（拖动范围）内。

### 验证
- `typecheck` 过；690 passed / 11 skipped。

## [0.18.15] - 2026-10-03 — 🌐 引用徽标：composer 卡内浮动标识（同 0.17.18 反向同源）

### 新增
- **引用徽标**：草稿含我们的引用行时，`conversation.input.overlay` 席位（order 110）浮出 🌐 徽标——悬停显示页面标题/连接/元素数；与 paste-dock 的 📄 文档徽标同位共存。
- 组件按会话探测（`props.sessionId` + 工厂下发的 `getDraft` 闭包），解析不了渲染 null。

### 验证
- `typecheck` 过；690 passed / 11 skipped。

## [0.18.13] - 2026-10-03 — 包装卡挂官方 dock 缝（todo 同级 order 0）+ 投递模型变更：块体归档为文件（同 0.17.15/0.17.16 反向同源）

### 新增/变更
- **包装卡挂官方 dock 缝**：注册为 `conversation.input.dock` 贡献者（`id: 'dsh-browser-cdp.picks'`，**order 0 与 todo 同级**——带区上沿、浮在对话区一侧；无 priority 字段）。✕ 从草稿移除对应引用（空输入框不留原文）。0.18.9 的 body-fixed/rect/重定位逻辑全部删除。
- **投递模型变更（dsh-paste-dock 同款）**：点选块体经网关新路由 `picks-save` 归档为 `<stateDir>/picks/<file>.json`，composer 只留一行短引用——原文展开不再挤占输入；模型按引用内路径用文件工具读取（backendNodeId 可直接喂 `bcdp_cdp`）。同页合并 = 读回归档追加、原文件重写、引用行原位更新（序号续号）。
- **草稿读取修复**：草稿活值在 `input.draft` 门面字段；`input.state.getSnapshot()`（InputState 组合快照）没有 draft 键——0.18.4 起的读取恒得空串（投递"输入框无变化"的根因之一）。`readDraftText(input)` 兼容读三处接线。
- **strict resolver**：客户端 inject 声明补 `'sessions'`/`'conversation'`（0.18.8，本条随同源移植一并保留）。

### 验证
- `typecheck` 过；691 passed / 11 skipped（+1 dock 注册契约：order 0、无 priority）。

## [0.18.11] - 2026-10-03 — 包装卡定位诊断补丁（同 0.17.14 反向同源）

### 变更
- dock 注册补 `locale: 'dsh-browser-cdp'` + 注册即写 `__dshBrowserCdpDeco.stage='registered'`、inject 工厂失败记录 `inject-failed` + sessionId；
- 点选卡片正则放宽：头行属性间允许任意空白/换行（composer 折行形态不漏配）。

### 验证
- `typecheck` 过；691 passed / 11 skipped。

## [0.18.10] - 2026-10-03 — 包装卡改挂官方 dock 缝：与 todo 同级（order 0）、浮在对话区一侧（同 0.17.13 反向同源）

### 变更
- **包装卡不再是 body 悬浮件**：改注册为 `conversation.input.dock` 列表槽贡献者（`id: 'dsh-browser-cdp.picks'`）——宿主原生渲染，随文档流滚动，fixed/rect/重定位/可见过滤逻辑全部删除。
- **与 `todo` 同级（`order: 0`）**：带区上沿、todo 面板同位，浮在对话区一侧；**无 `priority` 字段**（独立 cell id，不虚设）。
- **✕ 撤销**：✕ 从草稿移除对应 CDP-PICKS 块（空输入框不留原文）。

### 验证
- `typecheck` 过（client `noImplicitAny`）；690 passed / 11 skipped（+1 dock 注册契约）。

## [0.18.9] - 2026-10-03 — 真机反馈⑦：包装卡定位修正（同 0.17.12 反向同源）

### 修复
- **包装卡位置歪**：宿主 DOM 的不可见 composer 模板被选择器首中（矩形 0,0），卡片钉在左上角叠在消息区。修复：枚举全部候选 → 过滤可见矩形（≥120×32、在屏内）→ 取最靠下者（活 composer）。

### 验证
- `typecheck` 过；690 passed / 11 skipped。

## [0.18.8] - 2026-10-03 — 真机反馈⑥：`sessions` 未声明 inject（用户诊断实锤；同 0.17.11 反向同源）

### 修复（根因）
- 用户控制台回报 `window.__dshBrowserCdpDeco = { stage:'error', error:'cannot get property "sessions" without inject' }`——strict resolver 拒绝裸访问未声明服务。装饰卡与投递同源依赖 `ctx.sessions` / `ctx.get('conversation')`。
- **修复**：客户端静态 inject 补入 `'sessions'` 与 `'conversation'`（宿主 web UI 核心服务，必然已加载）。

### 验证
- `typecheck` 过（client `noImplicitAny`）；690 passed / 11 skipped。

## [0.18.7] - 2026-10-03 — 真机反馈⑤：包装卡渲染重写（同 0.17.10 反向同源）

### 修复
- **0.18.4 起的包装卡真机上未出现**：卡片原插进 composer 的宿主 React 容器（会被协调回收）+ 失败静默吞掉。重写：卡片挂 `document.body` + `position:fixed`（按 composer 矩形定位，三级回退取矩形）；`window.__dshBrowserCdpDeco`（`stage`/`error`/`anchor`/`cards`/`draftLen`）控制台可诊断；补齐遗漏的 `pickCardTitle`/`pickCardElements` 键（内联 zh/en）。

### 验证
- `typecheck` 过（client `noImplicitAny`）；690 passed / 11 skipped。

## [0.18.6] - 2026-10-03 — 0.18.5 同内容重发（npmjs 暂存位卡住）

- 0.18.5 被 npm registry 受理后长时间停留在 staged 状态（`EPUBLISHCONFLICT: previously staged "0.18.5"`，读路径 404），重发被拒——换号 0.18.6 绕开。内容与 0.18.5 完全一致：composer 包装卡 + 同页合并正则修复（详见 0.18.5 条）。
- 若 0.18.5 日后由 registry 侧落地，两者内容相同，`dsh-0.2.0`/`latest` 均指向 0.18.6。

## [0.18.5] - 2026-10-03 — 真机反馈④：点选内容包装卡（composer 装饰）+ 同页合并正则修复（同 0.17.9 反向同源）

### 新增
- **composer 包装卡**：草稿含 CDP-PICKS 块时，输入框上方渲染主题化装饰卡——🌐 + CDP 连接 + 标签页标题 + 点选元素 chip（≤6 折叠）；锚点 `[data-composer-input]`（0.1.7-rc.2 ↔ 0.2.0-rc.2 验证稳定）；1s 跟随草稿、全程守卫。宿主无第三方 chip 公开缝（`ui-attachment` 闭合系统），此为插件侧包装形态。
- 文案键 `pickCardTitle` / `pickCardElements` 进内联 zh/en。

### 修复
- **同页合并正则失配（0.18.4 引入）**：🌐 头行导致同页第二次点选另起块——正则容忍可选 🌐 前缀，新旧头行均可合并。

### 验证
- `typecheck` 过（client `noImplicitAny`）；690 passed / 11 skipped。

## [0.18.4] - 2026-10-03 — 真机反馈③：点选投递到输入框修复（同 0.17.8 反向同源）

### 修复（根因）
- **「引用到对话后输入框无变化」**：投递函数读 `sessions.list.getSnapshot().current`——宿主 0.1.6-alpha.2 起删除该字段，0.1.7/0.2.0 上恒 `undefined` → 静默 `no-active-session` → 草稿未写入（与 `dsh-arrowkey-nav` 同款破坏点；0.16.x 线不受影响，故只在 0.1.7/0.2.0 宿主上显现）。
- **修复**：按宿主现行推导取当前会话（`byId` 扫 `retainedBy.mainView > 0`，与宿主侧边栏同款）；`sessions.scope(id)` 与 `conversation.input.setDraft` 在 0.2.0 宿主源码逐环验证健在。
- **投递块头行加 🌐 标识**（`[🌐 CDP-PICKS …]`）：一眼可辨浏览器来源；块体保持纯 JSON。composer 的文件 chip 是 `ui-attachment` 闭合系统、无第三方注册缝——chip 化留作宿主侧 feature 请求。

### 验证
- `typecheck` 过（client `noImplicitAny`）；690 passed / 11 skipped（+1 契约）。

## [0.18.3] - 2026-10-03 — 真机反馈②：点选失败根因修复（与上游插件的状态文件互踩；同 0.17.7 反向同源）

### 修复（根因）
- **「切换选择元素 → 点选失败」的真凶**：与上游 `dsh-ego-browser` 同机同 profile 安装时，两家 cast worker **共写 `ego-cast.json`**——本插件面板按文件桥接，桥到了上游 worker（无本插件扩展的 `pick`/`marks`/`raise` 路由）→ 404 → 点选失败；流媒体不受影响（上游 worker 也有 watch/stream），故仅点选坏。
- **修复**：本插件状态文件更名 **`dsh-browser-cdp.cast.json`**（worker 写入端 / cast-server 读取端 / `bcdp_auth_flush` 读取端三处同步），绝不回读共享名——两家各自桥接各自的 worker，真共存。升级即生效：下一次请求自动拉起本插件自己的 worker，上游插件不受影响。
- **点选失败详情可见**：worker 真实 code/message 挂到工具栏按钮 hover title（悬浮窗 + 侧栏 tab）。

### 验证
- 复现实证：对远程目标（Linux 有头 Chrome 153）独立起 worker，pick arm 与坐标点选均成功——点选管线健康，问题全在桥接错 worker；
- `typecheck` 过（client `noImplicitAny`）；689 passed / 11 skipped（+1 状态文件命名空间契约）。

## [0.18.2] - 2026-10-03 — 真机反馈：本机 Chrome 固定行 + 激活模式同步 + 首行自动激活（同 0.17.6 反向同源）

### 修复
- **激活按钮裸键名**：`linksActivate` 未进本线内联双语字典（v1 时代该按钮是内联三元，0.18.1 移植时按字典键调用却没补键）——补齐。
- **远程目标可达却被本地 Chrome 抢占**：`cdpMode` / `allowLocalFallback` 的生效对用户不可见；本版把受管本机浏览器显性化为固定行（见下）。

### 新增
- **本机 Chrome（受管启动）固定行**：序列末尾常驻 LOCAL 行——激活 = `cdpMode=local`，勾选 = `allowLocalFallback`（本版转为 volatile）；在 `cdpMode=local` 下激活任意真实目标自动切回 `auto`。
- **首个目标入列即激活**（空序列无歧义；后续行保持不自动激活）。

### 验证
- `typecheck` 过（client `noImplicitAny`）；688 passed / 11 skipped（基线 686/11，+2 源码契约）；`lib/client.js` 见构建输出。

## [0.18.1] - 2026-10-03 — FamLinks v2：连接目标编辑器 + 双设置挂载（自 0.17.5 反向同源移植）

### 新增
- **连接目标直接在设置里增删改**：family 设置卡的 links 区升级为完整编辑器——每行启用开关、激活、标签/端点/CLI 路径就位编辑（草稿 + onBlur/Enter 提交，绝不每键写盘）、逐行**探测**（`POST /bcdp/api/cdp-probe`，结果写回该行 probe 字段）、上移/下移、删除；底部内联表单添加 CDP 端点 / 本机 ego CLI。
- **插件详情页设置卡**：同一张 `FamilySettingsCard` 以 keyed 席位注册到 `plugins.bundle.config`（thinking-levels b660785 模式）——不装 thinking-levels 时这是唯一设置入口。
- **ego CLI 行**：`useSdkPath` 行内开关；`cdpMode=remote` 时行内预警 `mode-kind-mismatch`。
- 文案：25 个 `links*` 键进内联 zh/en 双语（跟随本线惯例，不引入 9 语字典机制）。

### 行为
- 与 0.17.5 完全同源：删激活行 = 清空激活不顺延；写前守卫（ego-cli 单例 / `MAX_LINKS=32` / endpoint 轻校验，见 `src/client/fam-links.ts`）与宿主读路径同构；编辑全行展开保 probe 字段；`scope.set` 返回 false 时界面报错。

### 验证
- `typecheck` 过（本线 client `noImplicitAny`）；
- 686 passed / 11 skipped（基线 656/11 附近，新增 fam-links 纯函数 + 源码契约测试；9 语 parity 块随 locales 机制留在 0.17.x 线）；
- `lib/client.js` 133,325 → 149,686 B；
- 待真机目验：family tab / 插件详情页两处卡片可见可写；增删改激活探测全链路；重启后 `cordis.patch.yml` 落盘存活。

## [0.18.0] - 2026-09-29 — DSH 0.2.0-rc.1 线（compat/0.2.0：纯元数据适配，零代码改动）

### 新增
- **render worker `captureWithinBudget` 实现**（0.2.0 线修复真机阻断）：`bin/cdp-render-worker.mjs` 的 `capture` 此前调用一个从未定义的函数（真机链路 capture 必挂，且被门控探针掩盖）。现实现 JPEG 质量阶梯（72 起步、步长 12、下限 24，超预算如实上报 `overBudget`）+ `scale.maxWidth` 几何降采样 + PNG/无预算单发路径；`data` 以 base64 回传供 JEV 判定链消费。真机实测：Chrome/153 实连，预算一次达标（attempt 1, q=72）。
- **client 半 `noImplicitAny` 开启**：`tsconfig.client.json` 升 `noImplicitAny: true`，401 处 implicit-any 全部显式化（`scripts/fix-implicit-any.mjs` 位置精确 codemod + 手工收尾）；类型注解零运行时影响，`client-input.test.ts` 源码正则同步。
- **门控探针真机启用**：remote CDP 探针（4/4）与 render 探针（1/1）对本机真实 Chrome/153 实跑通过——discovery→attach→inspect→input→binding 回环 + 截图预算链路。cli-probe 与 login-import e2e 绑 vendored Linux 运行时，维持门控（本机 N/A）。

### 变更
- **peerDependencies 换代（替换式）**：六项 `@deepseek-ai/dsh-client-locale` / `dsh-client-store` / `dsh-client-ui-settings-plugins` / `dsh-client-ui-slots` / `dsh-settings` / `dsh-tools` 由 `>=0.1.7-rc.1 <0.1.8-0` → `>=0.2.0-rc.1 <0.2.1-0`；0.1.7 线由 0.17.x 冻结续服，DSH 0.1.2-rc.1 ~ 0.1.7 请用 0.17.x。
- **engines.dsh 两处同步**：顶层 `engines.dsh` 与嵌套 `dsh.engines.dsh` 均换代至 `>=0.2.0-rc.1 <0.2.1-0`（运行时门只读 peer，元数据保持一致）。
- **devDependencies 换代**：`@deepseek-ai/dsh-tools` 与 `@deepseek-ai/dsh-sandbox` 由 0.1.7 线 → `>=0.2.0-rc.1 <0.2.1-0`，typecheck 据此解析 0.2.0 宿主类型——「全绿」证明的是 0.2.0 兼容而非 0.1.7 残留。
- **零代码依据**：0.2.0 的 composer/`forkSession` 为向后兼容签名扩展，本插件经 `ctx.get('conversation').input` 门面投递选区（不调 `submit()`、不 override 契约），不在影响面内。
- README 徽章/版本兼容矩阵/适配说明改写为 0.2.0 口径。

### 验证
- 双 tsconfig typecheck + build + vitest（656 passed / 11 skipped）针对 `dsh-tools@0.2.0-rc.1` 全绿；`npm ls` 无 invalid / peer 冲突。

### 其他
- `dsh-plugin.json` 版本 0.17.0 → 0.18.0（该字段此前落后于 package.json，本版一并拉齐）。
- 依赖树由 npmmirror 全量重建，`package-lock.json` 重新生成提交。

## [Unreleased] — JEV 风格管道：DOM+截图+意图 → Laya/JEV 判定（阶段 10 / R5-R6，分支 stage9-ego-cli）

### 新增
- **JEV 风格管道（T10.1–T10.19）**：帧契约（截图 + 编号 DOM + 意图 + 操作进度）+ 判定接缝（只回编号，绝不给选择器）。
  - 渲染 worker `bin/cdp-render-worker.mjs`：单连接 CDP 客户端、`attachPage()`（按 M0.3 次序 enable `Page/Runtime/DOM/Accessibility`）、`gatherInteractive(limit)`、`captureWithinBudget()`（JPEG 质量阶梯 + 降采样 + `overBudget` 如实上报）。
  - 三原语 `noul`/`choice`/`score`（`src/jev/wire.ts`）+ 协议限值（`choice.criteria` 非空且 ≤255、空表必抛，因空 `criteria` 是 422 且会被误读成模型失败）+ `validateQuestions()` 一次报全 + `THRESHOLD_BUCKETS`/`bucketFor`。
  - 判定接缝 `JudgeProvider` + 降级链 `jev → laya → rule → refuse`（**不可用者跳过不调用**，每跳失败进 trace；`refuse` 是结果不是异常）。
  - 四工具面 `bcdp_jev_status` / `bcdp_jev_frame` / `bcdp_jev_ask`（`dryRun` 默认 true，可逐级 `round=control|chapter|pick`）/ `bcdp_jev_run`（逐步 trace）。`attachGate()` 统一拦"没有活动浏览器"；`bcdp_doctor` 增判定链五行。
  - 循环 `src/jev/loop.ts`：六件效果全注入、`BudgetLedger` 先查后花、六态终止（含 `exhaustedKind`）、排除集结构性生效、重采集门槛、`#PROGRESS` 机械生成。
- **laya 优先（2026-09-24 修订）**：默认 `judgePrefer='laya,rule'`（不写 jev，因 JEV 无法注册）；`jevUrl` 空即不参与。`bcdp_jev_status` 缺 key 时打印本地起法（`ENGINE=laya … uvicorn laya_api.main:app`，端口 8000，`ALLOW_DEV_LOGIN=true`）。
- **动作分章节化（三级缩小）**：worker 从 AX `childIds` 父链推最近结构化祖先作章节（`CHAPTER_ROLES` 白名单，同 role 按文档序编号 `form#1`/`form#2`）；`control → chapter → pick`，单章节不问章节轮；阈值按候选数分桶（20→「几×几」两轮都进严桶）。
- **判定上下文隔离**：四段白名单 `INTENT/PROGRESS/FRAME/HISTORY` + `assertJudgeIsolation()` 组装后断言（裸大写标题即拒）；`IntentStateInput` 结构上无 session 字段——**把控浏览器 UI 的不带完整会话 session 前缀**。
- **评估开关 `jevEvaluate`（默认开，提交 `208ae38`）**：每步后判定 `inprogress/done/fail`；`fail` 或「未验真的 done」→ `escalate`，带有序 `RecoveryOption[]`（`reload` 优先，陈旧渲染会藏住已写入的确认），由 `recoveryFor(reason, lastAction)` 派生。
- **被操作元素保留 class（提交 `f79a272`）**：`act` 命中那一个元素时懒取 `DOM.getOuterHTML`，经 `bin/record-normalize.mjs` 归一化——改写规则允许，但 `class`/`id`/`role`/`aria-*`/`data-testid` 等定位特征**保留**，只剪检视器外壳 token（如 `trae-browser-inspect-draggable`）与 `style`；完整 outerHTML 进 `Escalation.actedOn` 供 LLM 恢复，紧凑引用进 HISTORY。

### 验证
- 全测 630 passed / 11 skipped（gated 探针）；两套 `tsc` 通过；`lib/index.js` 由 206,613 → 316,544 → 317,402 B（字节证模块已接线）。
- 护栏：`tests/worker-dispatch.test.ts`（断言 `act/reload/scroll/fill` 全落到已声明函数，正是 `ed6eccf` 静默漏掉的 bug 类）、`tests/record-normalize.test.ts`（钉死 class 保留 / chrome token 剪 / 定位属性留）。

### 已知边界（诚实不粉饰）
- **尚未真机端到端**（T10.22 待做）：单测覆盖协议/阈值/终止/分章节/组装，不覆盖真机链路。
- **判定准确率未实测**：阈值分桶是标定用的，非选得对的证明。
- **章节白名单未真站标定**：`CHAPTER_ROLES` 从 AX 角色表挑；若站点把控件都放无名 `div`，会全落单章节 `page`，退化回二级（已知退化，非错误）。
- **`render.ts` 每次调用重新 attach**：会话式长连接需宿主提供可续写 spawn 契约，当前无，代价已记录。

## [Unreleased] — 连接类型多态化：本机 ego CLI 连接对象（阶段 9 / R7，分支 stage9-ego-cli）

### 新增
- **连接序列类型化**：`BrowserLink = CdpLink | EgoCliLink`（判别字段 `kind: 'cdp' | 'ego-cli'`）。数组顺序**仍是优先级**，`activeTargetId` 可指向任一类型。
- **本机 ego CLI 连接**（`kind='ego-cli'`，**仅限本机，全局至多一条**）：
  - CLI 解析四级链：显式 `cliPath` → PATH 的 `ego-browser` → macOS app 包内 helper（`/Applications/ego lite.app/…/Helpers/ego-browser`）→ 内置运行时；
  - **spawn 形态探测**：先**直接执行**，遇 `EACCES`/`ENOEXEC`/`ENOENT` 则回退 `node <path>`（真 CLI 是 app 包里的可执行文件，`ego-browser-v2`/内置版是 JS——两种形态都真实存在，猜后缀会全线不可用）；
  - **不注入 `EGO_LINUX_CDP_URL`**：该 env 只属于内置 Linux 移植版，macOS 原生 CLI 不读；这正是本类型存在的理由；
  - **就绪探测以最小 heredoc 为准**（与干活同一条 `nodejs` 通道）；`--status` 仅作 2s 短超时的**机会性**快速路径（CLI 报 `unknown option` 或非 JSON 时静默降级、**不判败**）；
  - 失败码五类且**不静默回落**：`cli-not-found` / `cli-not-executable` / `cli-probe-timeout` / `cli-probe-failed` / `cli-sdk-path-unsupported`。
- **`--sdk-path` 为可选能力**：默认不传（用 CLI 自带的官方配对 harness）；显式开启时若被拒（`unknown option`）→ 记 `cli-sdk-path-unsupported` 并**自动重试一次不带该旗标**。
- `bcdp_doctor` 新增：`links: n (cdp x, ego-cli y)`、`cli: <path> (<origin>, shape <shape>)`、`naming: … legacy ego_* aliases OFF/ON`、上游插件同机安装时 `conflict:` 警告。

### 变更（Breaking）
- 设置键 `cdpTargets` → **`links`**（旧键**一版兜底读取**，其行等价于 `kind='cdp'`，**零丢失**）。
- `cdpMode='remote'` 与激活项为本机 CLI 组合 → 显式 `mode-kind-mismatch`（不再静默改用其它项）。
- `remoteEnabled` 语义收窄为**只管远端 CDP**：本机 CLI 连接不受其影响。

### 修复
- `makeWhich` 的路径分隔符与 PATH 分隔符改为跟随**被模拟的平台**（原用 `node:path` 的宿主值，darwin/linux 查找在 Windows 上会拼成 `dir\file` 而永远找不到）。

## [0.16.0] - 2026-09-23 — 阶段 2b 收尾 + 远端 CDP 软禁用开关

### 新增
- **`remoteEnabled` 总开关（T2.18）**：不删除目标序列即可临时禁用远端 CDP——关闭后序列原样保留，但停止一切远端探测与连接；`bcdp_*` 调用得到显式 `remote-disabled` 错误；设置卡开关 + `bcdp_doctor` 可见；随时重新打开。与 `allowLocalFallback` 正交（关远端后 auto 可回落本地启动器）。
- **`cdpMode=local` 接入自建启动器（2b 收尾）**：本地模式现在由 M0.9 启动受管浏览器并注入其端点，内置运行时附着其上，不再自行冷启动；缓存标 `endpointSource: local`。
- **`bcdp_doctor` 新增两行**：`remote CDP: enabled/DISABLED` 与 `attach: <status> (source: …) @ <endpoint>`（T2.16 三处可见性补齐）。

## [0.15.0] - 2026-09-23 — 本地浏览器启动器（阶段 2b / M0.9）

### 新增
- **本地受管启动**：`allowLocalFallback` 开启且激活端点不可达时，自动启动本机 Chrome/Chromium/Edge（显式发现 → 平台候选表）、注入 `http://127.0.0.1:<port>` 继续工作，attach 徽章标明 `endpointSource: local-fallback`；**禁止反向回落**。
- **单例复用**（T2.13）：`launcher.json` 记录 pid/端口/profile；只复用自己启动且仍应答的实例。
- **停止与回收**（T2.14）：win32 `taskkill /T /F` 杀整树（实测 0 孤儿）；闲置 reaper 顺带回收本地实例。
- **设置**：`localHeadless`、`localUserDataDir`（默认 `~/.dsh/cache/dsh-browser-cdp/chrome-profile`，绝不指向日常 profile）。
- **端口策略**（T2.11）：预分配空闲端口显式传入，不依赖未验证的 DevToolsActivePort/端口 0 机制。
- **文案冲突消解**：观察窗 Tab/悬浮球标题「Agent 浏览器」→「CDP 浏览器」（分析见 findings A.5）。

## [0.14.0] - 2026-09-23 — 点选引用按页聚合为字典块，附来源 CDP 连接

### 变更
- **按页聚合**：一次引用只承载一个网页的内容——同页多元素合并进**同一个块**，异页点选产生新块。
- **字典包裹**（类比图片附件的前置成块）：草稿中的块形如
  `[CDP-PICKS page="…" targetId="…" endpoint="…"]` + JSON（`cdpEndpoint`/`targetId`/`pageUrl`/`pageTitle`/`elements[]`）+ `[/CDP-PICKS]`。
- **来源可追溯**：块内 `cdpEndpoint`（worker 由 `active.wsUrl` 去掉 `/devtools/*` 得到）+ `targetId`；`elements[]` 每项含 `backendNodeId`——`bcdp_cdp` 用 `DOM.describeNode({backendNodeId})` 可直接回查元素所在 DOM 结构；另附 `pageUrl`/`pageTitle`。
- worker：`PickElement.source` 新增（`Target.getTargets` 抓页面元数据 + `getEndpoint` 注入连接源）。
- 语义延续：无自动发送（v0.13.0），同页 `n` 续号。

## [0.13.0] - 2026-09-23 — 点选投递改为编号引用，取消自动发送

### 变更（Breaking）
- **不再自动发送**：「添加到对话」的 submit() 路径整体移除——任何点选动作都只把内容写进输入框草稿，**发送永远由用户在输入框回车或点击发送**。
- **编号引用**：每次点选以 `[pick N] <元素描述>` 追加进草稿，N 按输入框中已有的 `[pick N]` 序列自动续号——多次点选形成有序列表。
- **浮条改单动作**：「引用到对话（Ctrl+J 或 ↵）」——两快捷键等价，确认态显示「✓ 已引用到输入框」。

## [0.12.0] - 2026-09-23 — 去 ego 化：CDP 浏览器代理身份（阶段 8）

### 变更（Breaking）
- **33 个工具 `ego_*` → `bcdp_*`**：`bcdp_status` / `bcdp_navigate` / `bcdp_doctor` …（前缀派生自插件 id，生态无占用）。引用旧工具名的脚本可用新设置 `legacyEgoToolNames: true` 过渡（额外注册 `ego_*` 别名；与上游 ego-browser 插件互斥）。
- **HTTP 路由 `/api/ego/*` → `/api/bcdp/*`**，设置网关 `/ego/api/*` → `/bcdp/api/*`（面板同步）。
- **资源改名**：`bin/ego-cast-worker.mjs` → `bin/cdp-cast-worker.mjs`、`bin/ego-chrome-wrapper.sh` → `bin/cdp-chrome-wrapper.sh`（worker 进程匹配/清理逻辑同步）。
- **配置键** `egoCliArgs` → `runtimeArgs`（旧键一个版本内自动读取，设置不丢）。
- **文案**：面板 EN/ZH 自称统一为「CDP 浏览器代理 / CDP browser bridge」，不再以 ego 开头；README 同步。
- 内部 wire（`EGO_LINUX_*` 环境变量）与 vendored runtime 目录名**刻意不改**（升级安全）。
- 副产物：与上游 `Fisfzy/ego-browser` **可以共存**（工具名/路由全部错开）。

## [0.11.1] - 2026-09-23 — 修复：面板点选状态两处误判

### 修复
- worker 的中间态 `picked`（已捕获、等动作）被面板误判为失败显示「点选失败」——现在正确显示元素描述。
- 面板武装时投递基线对齐到 `picks`，会吞掉「武装前已点选」那一次的投递——基线下移一格，待动作的点选必然投递。

# Changelog

所有对用户可见的变更集中在各版本号下。格式遵循 [Keep a Changelog](https://keepachangelog.com/)，版本语义遵循 [SemVer](http://semver.org/)。

## [0.11.0] - 2026-09-23 — M1.6 投递到对话 + 坐标点选降级路径

### 新增
- **点选结果投递到对话（M1.6 / T5.6–T5.7）**：页面浮条两动作现在真正写进对话——「评论到对话」把元素描述写入输入框草稿（用户补充评论后自行发送）；「添加到对话」写入草稿并**自动提交**（与发送按钮同一条 adjudication 路径）。提交前校验 `phase === 'plain'`；每次点选只投递一次；投递结果（✓ 已发送到对话 / ✓ 已写入输入框 / 投递失败+原因）回显在观察窗状态行。
- **坐标点选降级路径（T5.1b）**：点选模式下，点击观察窗里的实时截图 = 点选——坐标换算后发给 worker，用 `DOM.getNodeForLocation` 命中解析（不依赖 Overlay 事件通道），走同一条描述/测量/注入 UI 流水线。侧栏与悬浮窗都支持。
- worker 新增 `POST /api/pick/click {targetId, x, y}`；host 同步 `/api/ego/pick/click` 转发。

### 说明
- 点空白等命中失败会显式报「点选失败 (no-node-at-point)」，不静默回 idle（T5.8 空白类夹具）。

## [0.10.0] - 2026-09-23 — CDP P0 底座 + 元素点选（R6 主体）+ Set-of-Marks（R4）

### 新增
- **元素点选（R6 主体）**：观察窗工具条新增「选择元素」开关（侧栏与悬浮窗各一处，均位于「打开真实页」左侧）。开启后在被选中的真实页面里点选元素：天蓝 2px 选中框 + 贴元素浮条，浮条两动作「评论到对话 Ctrl+J」/「添加到对话 ↵」，完成后原地显示「✓ 已传输到对话」并 2.5s 收起；动作完成后点选模式自动重新武装，连续点选无需回面板。切换标签 / 关闭面板会退出点选并清理注入 UI。
- **Set-of-Marks 截图（R4 机制 + 网关）**：`POST /api/ego/marks` 一次调用返回截图 + 按文档顺序编号的交互元素映射（AX 树过滤，`n = 1..N`，含 viewport rect 与单行语义描述），可选单元素高亮。纯 CDP 实现，零页面注入；编号映射是 Overlay 一次只能高亮一个节点的替代（实测约束）。
- **CDP 常驻会话底座（P0）**：`src/cdp/` 下 endpoint（端点规范化/发现，8 个结构化错误码）、session（命令 id 配对/单命令超时/退避重连/**重连后重放 enable 序列**）、events（域分发/有状态域亲和/`DOM.enable → Overlay.enable` 顺序）、dom、input（**无直填 `.value` 路径**、点击命中复核）、page（截图 clip 文档坐标语义、`highlightConfig` 进程内强制、`Runtime.addBinding`）。
- **真机探针**（`CDP_PROBE_URL` 触发，默认跳过）：发现 19ms → 连接 7ms → 命令 1–5ms → binding 回传 42ms，全链路证据化。

### 说明
- **投递边界**：页面浮条的「已传输到对话」目前是 UI 状态；写入对话输入框（`conversation.input.for(actx).setDraft/submit`）的宿主侧接线尚未完成，点选结果当前经 `GET /api/ego/pick` 的 `lastPick`/`lastAction` 可观测。

## [0.9.1] - 2026-09-23 — 修复：保存后 CDP 目标从面板消失

### 修复
- **设置面板保存成功后，CDP 目标序列整段从界面上消失（数据其实已落盘）**：保存成功回调里用服务端返回的 config 重建设置草稿时，漏掉了 `cdpTargets` / `activeTargetId` / `cdpMode` 三个字段（`load()` 里有、这条路径没有）。于是「添加目标 → 填端点 → 保存」后目标立刻退回「还没有目标」，但 `~/.dsh/settings.yaml` 里其实写入了正确的目标与 `activeTargetId`。已在保存成功路径补齐三个字段，与 `load()` 对齐。
  > 排查记录：`/ego/api/set` 侧的 `ALLOWED_KEYS` 与 `sanitizeJsonArray` 均正常，问题只在客户端草稿重建，不是网关或 schema 丢字段。

## [0.9.0] - 2026-09-23 — CDP 目标序列 + 激活 (R1) + 包名统一为 dsh-browser-cdp

### 新增
- **CDP 目标序列与激活 (R1)**：新增配置 `cdpTargets`(有序序列) / `activeTargetId`(单点激活) / `cdpMode`(`auto`/`local`/`remote`) / `cdpProbeTimeoutMs`。每个 `ego_*` 工具驱动的是**被激活**的那一个端点，而非本地浏览器。
- **设置面板序列编辑器**：目标增删改 + 上下排序、激活单选、逐项「探测」按钮与可达性徽章（从 `/ego/api/cdp-status` 轮询实时状态）。端点验证只允许 `http(s)://host:port` 或 `ws(s)://…`，非法 scheme 显式报错而非静默猜解。
- **显式激活链路**：`resolveEgoEnv` 按 `cdpMode` 注入 `EGO_LINUX_CDP_URL`；设置变更（及首次启动）触发 `refreshAttach` 重新探测被激活端点，端点变化时通过 `setAttachEndpoint` 重启 cast worker 让其重新挂接到同一浏览器。`decideAttach` 决策表保证失败**绝不静默回落**到本地浏览器——`auto`/`remote` 下无激活或不可达一律返回结构化错误。
- **网关新增端点**：`POST /ego/api/cdp-status`(读实时激活态)、`cdp-refresh`(手动重新探测并刷新 worker 挂载)、`cdp-probe`(对任意端点一次性探测，结果写回目标 `probe*` 字段)。
- **包名统一为 `dsh-browser-cdp`**：`cordis.patch.yml`、`dsh-plugin.json`(`id`/`name`/Scene·SettingsSection id/namespace)、设置 namespace、client 侧边栏 Tab id(`dsh-browser-cdp:watch`)、locale 文案与日志前缀全部对齐。
- **仓库发布到 `github.com/drscrewdriver/dsh-browser-cdp`**：`package.json#repository` 与 `dsh-plugin.json#source` 已从上游 `Fisfzy/dsh-ego-browser`（MIT，署名保留）改指本仓库。支持 GitHub 直装：`dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp`（pnpm 经 `codeload.github.com` 拉 tarball，无需 registry 发包），亦可 `#v0.9.0` / `#<sha>` 锁定版本。

### 测试
- 新增 `tests/cdp-targets.test.ts`（26 用例）：`normalizeEndpoint` / `sanitizeTargets` / 序列助手 / `probeEndpoint`(注入式 fetch，不读真实时钟) / `decideAttach` / `refreshAttach`+缓存。全覆盖 `cdp-targets.ts` 的解析、探测与决策路径。

## [0.8.5] - 2026-09-18 — 登录态导入 + 空闲回收 + 观察窗修复群

### 新增
- **从系统浏览器导入登录态（#46）**：新工具 `ego_login_import` + 设置卡「从系统浏览器导入登录态」区块 + `POST /api/ego/login-import` 路由。把日常 Chrome/Edge/Brave 的登录 cookie 按域名复制进 agent 浏览器：真实二进制无头启动真实 Profile（junction 别名绕过 Chromium ≥136 默认目录 CDP 限制，同时满足 App-Bound Encryption 的路径绑定），CDP `Storage.getCookies` 读取、过滤、`Storage.setCookies` 写入持久 Profile。支持 `source/domains/profile/closeSource/dryRun`；源浏览器运行中可优雅关闭后导入（窗口下次启动恢复）；**导入前自动备份源 cookie 库，检测到清空自动还原**；cookie 值不进日志与输出。
- **空闲自动回收（#47，opt-in）**：新设置 `idleTimeoutMin`（默认 0 关）。N 分钟无 ego_* 调用后优雅 `--stop` 后台浏览器（实测空闲 ~425MB），下次调用 2-4s 冷启动。观看观察窗不算活动（设置文案已注明）。
- **观察窗「弹出窗口」按钮（#51）**：浮动面板与侧边栏 Tab 新增按钮，调用运行时 `ego-browser --open`——无头实例原地替换为同 Profile 有头窗口（标签页保留），有头则置前。无头模式的 CDP 预览本就可用的结论也已实测确认。

### 修复
- **滚动后 viewport 截图全白**（PR #50）：`Page.captureScreenshot` 的 clip 原点是文档坐标，viewport 截图原先固定 `{x:0,y:0}`，滚动后 clip 落在未绘制区域（`captureBeyondViewport: false`）得到空白图。现用 `pageInfo().sx/sy`（`scrollX/scrollY`）作为 clip 原点；locator 的 viewport boundingBox 同样加上滚动偏移，与 `spaces-server` followClip 一致。
- **聊天外链被观察窗抢走且无法渲染（#48）**：侧边栏 Tab 的 `urlTarget` 声明过宽（认领所有 http(s)），但该 Tab 只是推流画面。已移除声明，外链回归内置 browser 标签。
- **浏览器重启后 ego_* 全部报 task space not found**：插件侧记住的数字空间 id 在重启后悬空。新增 `runWithStaleSpaceRetry`：识别该错误后自动用空间名重建并重试一次（动作工具 + ego_cli/ego_captcha/ego_script 全覆盖）。
- **多会话时观察窗弹到错误会话（#53，PR #54）**：`markEgoToolCall` 携带调用会话 id，自动打开按会话作用域定位侧边栏；一次性守卫改为按会话，探测流常驻。

### 社区
- 合并 PR #50（截图修复，hpqc032）、#52（观察窗英文 i18n，M4cd1r；我们补了 `wt()` 默认值修复恢复 typecheck）、#54（会话作用域，xiaochaZ）。

## [0.8.4] - 2026-09-15 — 观察窗 worker 启动链修复 + 社区 PR 合并

### 修复
- **观察窗在 DSH ≥ 0.1.5 永不启动（#34 / #38 / #43）**：worker spawn 缺少 0.1.5 subprocess provider 必填的 `cwd`，异常被裸 `catch` 吞掉导致 `ensureWorker()` 永远返回 null。已补 `cwd`。
- **worker 启动即自杀（#34 缺陷2 / #40）**：`stopSiblingWorkers()` 的松散子串匹配把 DSH subprocess runner 误判为同侪 worker，`taskkill /T` 连带杀掉自己的进程树，worker 在写 `ego-cast.json` 前死亡。匹配收紧为「node 的直接脚本参数是 ego-cast-worker.mjs」并排除自身祖先进程链。
- **Electron 宿主（DSH Desktop）全部 ego_* 报 no @@DSH_RESULT@@（#42）**：spawn 传显式 env 时缺 `ELECTRON_RUN_AS_NODE`，子进程被当成第二个 Electron 应用启动。`resolveEgoEnv` 与 worker spawn 在 `process.versions.electron` 存在时自动补 `ELECTRON_RUN_AS_NODE=1`。
- **worker 宕机时 /api/ego/stream 空响应（#39，PR #44）**：`proxyWorkerStream(-1)` 短路为 quiet SSE（写 `text/event-stream` 头后保持安静长连接），不再触发 `ERR_SOCKET_BAD_PORT` 把连接撕掉；含 42 行新测试。
- **Windows 下 EGO_LINUX_HEADLESS 被静默忽略（#35）**：显式 `EGO_LINUX_HEADLESS=1` 现在优先于 win32 的 `hasDisplay=true` 默认推断，与 CLI help / README 文档一致。
- **无 dsh-better-sidebar 宿主 web boot 整体阻断**：client 静态 inject 列表移除 `betterSidebar`（loader 会永远等待缺失服务），改为 `ctx.get` 探测 + 浮动观察球立即挂载 + 服务后出现时经 `ctx.inject` 升级为侧边栏 Tab（致谢 PR #45 的方案）。

### 新增
- **`isolateSpaces` 任务空间沙盒隔离开关（PR #31）**：默认关闭，任务空间复用磁盘持久化 Profile，登录态跨重启永久保留（覆盖 #1 诉求）；开启后恢复内存沙盒隔离。`ego_space_open`/`ego_space_close` 工具描述随模式动态注入；修复 gateway 布尔设置无法持久化的问题。

### 其他
- 修复 `pnpm-workspace.yaml` 未填的 `allowBuilds` 模板占位符导致 pnpm 11 无法 install；补 `isolateSpaces` 的 config 测试夹具。
- 合并 PR #36（README 版本兼容矩阵）、#31、#44；关闭被覆盖的 #45。

## [0.8.3] - 2026-09-07 — DSH 0.1.2-rc.1 兼容 + 安全/稳定性修复

### 安全
- **修复无认证 `/api/ego/*` 路由**：exact 路由先于宿主 `/api` prefix 信任栅栏命中，导致 `GET /api/ego/stream` 无凭据流出实时画面帧、`POST /api/ego/input` 无凭据即可提交输入（跨站驱动）。统一包装 webServer.register，所有 ego 路由要求 SameSite=Strict 的 `dsh-auth-*` cookie，恶意网页天然不携带；守卫仅作用于本插件自身路由，不污染宿主单例上其他插件的注册。

### 修复
- **无 dsh-better-sidebar 宿主 client 启动失败（#29）**：hard-declared `inject` 与裸 `ctx.betterSidebar` 属性访问在 strict resolver 下抛 "without inject"。保留声明（它是解析条件）+ 将访问包进 try/catch 并显式传参，无 sidebar 宿主落到浮动观察球而非整包挂死。
- **Windows 冷启动回归**：#22 的 Xvfb 支持将无 `DISPLAY` 时默认由 headless 改为起 Xvfb，而 Windows 有桌面会话、无 Xvfb → "no X display / no Xvfb binary" 冷启动失败。`ensureXDisplay` 与入口 `hasDisplay` 增加 win32 分支（桌面会话视为 display，headed 直开窗口，恢复 v0.4.0 适配行为）。
- **gateway 设置白名单缺 `egoCliArgs`/`chromeArgs`**：`/ego/api/set` 把这俩配置字段静默丢弃，设置无法持久化——已补入 `ALLOWED_KEYS`。

### 合并(社区 PR + 本地)
- 合并 6 个社区 PR：`#20` root 运行支持、`#22` xvfb、`#16` macOS headless 检测、`#24` schemastery `link:` 修复、`#28` DSH 0.1.2-rc.1/v0.1.3-alpha.1 兼容（peer/engines 收紧）、`#13` Windows 稳定性。
- 修复 dsh-plugin.json 缺逗号导致的 manifest JSON 语法错误（目录收录阻断源）。
- 新增 MIT LICENSE；补充供应链/权限说明；源码不追踪 `*.map`。
- 通过 build-dsh-plugin 官方审计：`status: READY_FOR_PINNED_SOURCE_VERIFICATION`，`route: direct`，`blockers: 0`。

### 兼容
- `engines.dsh: >=0.1.2-rc.1`；peer 依赖全部锁定 `>=0.1.2-rc.1`。
- 已在 DSH 0.1.2-rc.1(Windows/web profile) 完成安装、启动、`ego_navigate` 真实调用、实时观察面板验收；`0.1.2-alpha.x` 声明可装但未实测；`<0.1.2-rc.1` 请用 v0.8.0 及更早。

## [0.8.1] - 2026-08-28 — DSH 0.1.2-alpha.1 兼容

### 变更
- **client 半体迁移到 `@deepseek-ai/dsh-client-store`**：0.1.2-alpha.1 把 `@deepseek-ai/dsh-client-runtime`（含 `/client` 子路径）重命名为 `@deepseek-ai/dsh-client-store`（客户端模块图以裸包名作为静态模块 id）。`createSnapshotStore` 签名不变。
- **client 模块注册 id = 声明包名 `dsh-ego-browser`**：0.1.2 的 boot manifest 行 id 按 package.json `name` 生成、且要求 loader 行规格名与之一致（`nearestPackage` 名相等校验）；以别名（`@dsh-external/ego-browser` junction 装载键）挂载会被扫描器判为 "not a client row" → 观察面板静默消失。tsdown 的 banner ID 与 `cordis.patch.yml` 行名统一为声明包名；`dsh-plugin.json` 中的 `dsh-ego-browser` 保持不变。
- **`dsh.client.inject` 只声明真实图行包**：0.1.2 下 `@deepseek-ai/dsh-client-store` / `@deepseek-ai/dsh-client-ui-slots` 是静态模块（不在模块图），声明为注入边会导致条目组合静默 pending（模块不物化、面板不挂载、无任何报错）。仅保留 locale / ui-settings-plugins 两个真实图行。
- **webServer 可选服务改用嵌套注入交付**：0.1.2 严格服务解析器对未声明注入的 `ctx.get('webServer')` 返回 undefined → 宿主 `/api/ego/*` 观察路由静默未注册 → 面板数据层 401/空态。改为 `ctx.inject(['webServer'], cb)`（服务到位才注册路由；无 web 服务器的 TUI/headless 宿主保持 tools-only 不阻塞）。
- **peer 依赖对齐 0.1.x 家族**（client-locale / client-ui-slots / client-ui-settings-plugins / dsh-settings / dsh-tools 声明 `>=0.1.1-rc.2`），`engines.dsh: >=0.1.2-alpha.1`。
- 修复后实测：client 模块正常物化、侧边栏「Agent 浏览器」Tab 与接管观看流程可用、`/api/ego/*` 路由 200、实时推流 `streaming`、画面点击/输入链路可达（pointerdown → `/api/ego/input` → CDP 派发）。

## [Unreleased]

观察窗落地双画面管线：修复 CDP 协议根因，并加入可选 FFmpeg H.264/fMP4 后端。

### 新增 / 优化
- **用户自定义启动参数**：设置卡新增 `ego-browser CLI 附加参数` 与 `Chrome 启动附加参数` 两个字段。前者追加到 `ego-browser nodejs` argv，下一次 `ego_*` 工具调用即生效；后者经 `EGO_LINUX_EXTRA_ARGS` 桥接到 vendored runtime 的 `launch()`，仅浏览器下次冷启动生效（浏览器是单例常驻——需 `ego-browser --stop` 或重启 DSH 才会重新启动）。两边都拉黑会破坏插件自管控制面的标志（`--status`/`--stop`/`--help`/`--user-data-dir`/`--remote-debugging-port`/`--headless`/`--proxy-server` 等）；`--proxy-server` 请走 `EGO_LINUX_PROXY`。`ego_doctor` 报告当前生效参数。
- FFmpeg 改为显式按需安装：CDP 不再依赖或安装 `ffmpeg-static`。设置页优先检测自定义路径、系统 PATH 和托管缓存，兼容性检查完成前禁用 FFmpeg 选项，并提供固定版本、SHA-256 校验的一键下载。
- 新增 `githubMirror`，用用户填写的 HTTPS 基址替换 `https://github.com`；Windows/Linux 固定 BtbN release tag，macOS 固定平台资产。下载进入 `~/.dsh/cache/ego-browser/ffmpeg/` 临时目录，校验、解压和能力探测全部成功后才原子发布。
- 观察画面新增局部键盘输入代理：普通文本和粘贴走 `Input.insertText`，中文 IME 在 composition 完成后一次发送，控制键和快捷键走 `Input.dispatchKeyEvent`。只在点击观察画面后聚焦，不抢 DSH 自身输入。
- 新增 `ffmpegBitrateKbps` 设置（500-20000 kbps）；低/平衡/高档默认 2000/4000/8000 kbps。编码器使用目标码率、峰值码率与 VBV buffer，替代 `h264_mf` 的约 200 kbps 默认值和 `libx264 crf=28`。
- DSH 窗口进入后台时保持 watch/SSE/video 连续；lease TTL 提高到 120 秒，并对 start/switch/renew 请求做单飞去重，避免后台定时器节流造成 capture 过期和反复 `starting`。
- `CaptureManager` + watcher lease：同时只有一个活动后端和一个观看 target；面板隐藏后停止 capture。
- CDP 后端正确区分 frame ACK ID 与 flattened target session，协议错误可见；默认 20 FPS、latest-frame 限流、单 target backstop，删除透明动画强制重绘。
- FFmpeg 后端：Windows 使用 `gfxcapture(hwnd)` 直接采集 Chrome 的 D3D11 窗口 surface，其他平台保留显示来源 crop；编码为 H.264 fragmented MP4，经二进制 HTTP 与 MediaSource 播放，generation 隔离旧进程数据。
- 新设置：`captureBackend`、画质档位、CDP/FFmpeg FPS、最大宽度和编码器；旧字段集中迁移。
- 新增 MP4 parser、CDP ACK、CaptureManager、配置迁移和平台 argv 单元测试。

### 平台限制
- Windows 要求 FFmpeg 包含 `gfxcapture`；按 browser PID、target title 和 CDP window bounds 匹配 HWND，窗口被遮挡或移动时仍采集目标页面，且禁止回退到 `gdigrab desktop`。最小化行为仍由 Windows Graphics Capture 决定。
- Linux X11 使用 `x11grab`、macOS 使用 `avfoundation` display crop；遮挡和系统权限仍会影响这两个平台。
- Wayland 随包 FFmpeg 无可用 Portal/PipeWire 输入时明确报 `unsupported-ffmpeg-pipewire`，不使用 root `kmsgrab`，不静默切换整个桌面或伪装成功。

### 修复
- **偶发鼠标完全无请求 / 键盘始终不可用**：控制面不再依赖 `streamState` 或 spaces 同步，只按当前画面 target 发送；worker 继续做最终 stale-target 校验。此前前端没有任何键盘监听或协议支持，本次补齐 text/keyDown/keyUp 全链路。
- **FFmpeg 实际运行但 Tab 显示 CDP**：capture 状态统一从 SSE、watch 响应、spaces capture 和 watch/status 收敛；缺少 backend 时保留当前值，禁止默认覆盖为 CDP。
- **`space_open` 后遗留 about:blank 窗口**：成功打开的 task space 成为最近活动空间；后续省略 `space` 的 navigate/click/fill 等工具复用该空间，不再回退到固定 `dsh-agent` 创建第二个窗口。关闭活动空间后恢复配置默认值。
- **watch/start 502 与 input 500**：FFmpeg 二进制和 `gfxcapture` 能力探针改为异步子进程，启动期间 worker health 不再被阻塞；watch start/switch 的 worker 代理超时提高到 30 秒，覆盖窗口、编码器和 MP4 init 的完整上限。host 原样透传 worker HTTP 状态和 JSON 错误，仅在 worker 真不可达时返回 502。输入在客户端和 worker 双侧校验 target，失效 target 返回 409 `capture-target-stale`，不再包装成 500。
- **设置已选 FFmpeg 但 Tab 仍显示 CDP**：多 fiber 同时加载插件时，后注册的 settings bridge 遇到 namespace 重复后错误地退回空 composition config，cast worker 因而收到 `captureBackend:auto`。现在同一 settings 服务共享唯一 scope；设置卡、gateway 和 cast-server 始终读取同一持久化配置。空闲 worker 收到配置更新时也会立即发布新的 backend 状态，不再保留旧 CDP 标签。
- **Windows FFmpeg 不再录到用户前台窗口**：此前参数固定为 `gdigrab ... -i desktop`，只在启动时按页面坐标裁剪，Chrome 进入后台后会把覆盖区域中的 DSH 或其他应用串流出去。现在 target 先经 `Browser.getWindowForTarget` 和 Win32 顶层窗口枚举解析到 HWND，再用 `gfxcapture` 捕获独立窗口 surface；多任务空间的不同 Chrome 窗口分别绑定不同 HWND。同一窗口中的后台 tab 会报 `ffmpeg-target-not-visible`，不会展示错误 tab 或主动抢焦点。
- Windows 编码优先 `h264_mf` D3D11 硬件路径；编码器探针使用真实 HWND 管线，避免软件测试帧误判硬件编码不可用。显式 `fps/setpts` 固定 30 FPS，fMP4 分片降为 100ms，并用 `skip_trailer` 避免优雅停止时的 `mfra` parser 错误。
- **登录态跨 DSH 重启保持（复刻原版 ego-lite 哲学）**：此前手动重启 / 强杀 DSH 后需重新登录——worker 收到 SIGTERM/SIGINT 时只 detach 不落盘，且插件卸载的 `--stop` 宽限 4s 不够、常落到 SIGTERM crash 兜底。现在 worker 退场前先对浏览器发 CDP `Browser.close`（优雅关闭，Cookie journal 合并进磁盘 profile），插件 teardown 宽限提到 8s 足够优雅关完。**实测**：优雅重启登录完全保留；强杀（SIGKILL）长期登录态也已落盘、重启能读回。

### 工程重构
- **纯 JS → TypeScript 迁移**（PR #14）：源码从 `lib/` 移至 `src/`（`src/index.ts` 工具层、`src/client/index.ts` 前端、`src/worker/ego-cast-worker.ts` worker），`lib/` 与 `bin/ego-cast-worker.mjs` 改为构建产物（预构建入库）。构建链路改 `pnpm typecheck`（tsc 类型门禁，tsconfig.json + tsconfig.client.json）+ `pnpm test`（vitest）+ `pnpm run build`（tsdown 三 bundle）。测试同步迁移 `tests/*.test.mjs` → `.test.ts` 并补 `vitest.config.ts`。`lib/` 不再手改。

## [v0.8.0] - 2026-08

sidebar Tab 集成：当 `dsh-better-sidebar` 可用时，实时查看窗注册为 sidebar 原生 Tab 而非浮动浮窗。

### 新增
- **dsh-better-sidebar Tab 集成**：`apply()` 用 `ctx.get('betterSidebar')` 机会性探测 sidebar 服务（不用 `ctx.betterSidebar`——那要求 `inject` 声明，会把 sidebar 变成硬依赖，没装时整个插件含设置卡都不加载），可用时通过 `registerTab()` 注册一个 `ego-browser:watch` Tab（`single: true`，常驻），不可用时退回原有浮动浮窗。这是 DSH 文档化的可选服务消费模式（见 approval-seam 笔记、postmortem 0001）。
- **首次 ego_* 工具调用自动打开 Tab**：`defineEgoTool` / `ego_cli` / `ego_captcha` / `ego_script` 的 execute 路径调 `markEgoToolCall()` 递增 host 端计数器，该计数器随 `/api/ego/spaces` 响应下发。`LivePreviewController` 检测计数器 0 → >0 跳变时调 `ctx.get('betterSidebar').openTab({ type: 'ego-browser:watch' })`，Tab 自动展开。`autoOpened` 标志保证每会话只开一次。
- **React Tab 组件 `EgoBrowserTab`**：用 `React.createElement` + `bindSnapshotSelector` 渲染 sidebar Tab 内容（头部 / 标签栏 / 实时主视图 / 历史覆盖层 / 登录与验证码提示条）。历史浏览轨迹从原侧抽改为覆盖式（点历史按钮接管整个 Tab 内容区，点条目进入预览或返回实时），适配 sidebar 窄宽度。
- **`LivePreviewController` vanilla 类**：从浮动浮窗的命令式 DOM 代码中提取出轮询 / SSE / 帧缓存 / 缩放 / 输入坐标逆映射 / 自动跟随逻辑，供 React 组件通过 `subscribe`+`getSnapshot` 订阅、通过方法调用转发 pointer/wheel 事件。控制器直接持有 `<img>` ref 以 rAF 合帧频率原地替换 `src`，不触发 React 逐帧重渲染。
- **`dsh-better-sidebar` 不列为 peer 依赖**：用 `ctx.get()` 机会性消费，不需要声明 `inject`，因此也不需要把它列为 peer。装了 sidebar 就用 Tab，没装就退回浮动浮窗，两种部署都干净。

### 设计取舍（诚实说明）
- **混合而非完全重写**：React 负责 UI 结构（头部 / 标签 / 提示条 / 历史覆盖层），vanilla 控制器负责实时帧管道（SSE / rAF 合帧 / 坐标逆映射 / 输入转发）。~1000 行脆弱的实时流逻辑未用 React hooks 重写，降低回归风险。
- **历史轨迹覆盖式**：原浮动浮窗的侧抽设计在 sidebar 窄宽度（~300-400px）下两列都很窄，改为覆盖式后空间利用最好。
- **竞态条件（已知，可接受）**：若 `dsh-better-sidebar` 在 ego-browser 之后加载，`apply()` 运行时 `ctx.betterSidebar` 可能仍为 `undefined`，此时退回浮动浮窗。DSH 模块加载器通常按依赖顺序加载，sidebar 作为基础 UI 插件一般先加载；若不然，刷新页面即可。
- **浮动浮窗代码原样保留**：`mountFloatingWatch()` 是原 effect body 的机械移动，未做逻辑改动，确保无 sidebar 时的体验与 0.7.x 完全一致。

## [v0.7.1] - 2026-08

修复版本：单次 `ego_space_open` 不再开两个浏览器窗口。

### 修复
- **`ego_space_open` 不再开两个浏览器窗口**：此前 launch 时把 `"about:blank"` 作为位置参数传入，会在默认 browser context 开一个残留 tab；而 `ego_space_open` 走 `useSpace+ensureRealTab`，在自己的 browser context 里再开一个 tab——Chrome 把不同 context 隔离到独立窗口，用户就看到了两窗。现在 `LAUNCH_FLAGS` 加 `--no-startup-window`、`launch()` 不再传位置 URL，启动即零 tab；第一个 tab 由 `ego_space_open`（或任何走 `useSpace+ensureRealTab` 的结构化 `ego_*` 工具）在自己的 context 中创建，这是用户唯一看到的窗口。旧注释称 `--no-startup-window` 会破坏所有 `page.*` 操作——那是引入 `useSpace+ensureRealTab` 路由之前的结论，对结构化工具不再成立。**已知回归（可接受）**：`ego_cli` / `ego_script` 中如果 heredoc 直接调 `page.*` 而不先 `taskSpaces.useOrCreate`，现在会抛 `"no active tab to attach session"`，错误信息明确，且推荐用法不受影响。

## [v0.7.0] - 2026-08

小版本更新：观察窗状态灯呼吸效果 + 前端内存治理 + 工具超时/跨平台修正。

### 新增
- **观察窗状态灯呼吸效果**：FAB 角标绿点在 agent 实际驱动浏览器（`busy`）时常绿，空闲（浏览器开着、无操作）时呼吸（2.4s 周期性绿光晕）；面板「正在实时浏览」状态点同步 busy/呼吸逻辑。原「busy=黄、idle=绿」语义翻转为「干活常绿、不干活呼吸」。

### 修复
- **`ego_script` 的 `timeoutMs` 参数此前被忽略**：schema 声明的每次运行超时覆盖从未生效，所有运行一律采用插件默认 15s 宽限。现已贯穿 `runEgoScript`，传 `timeoutMs` 真正起作用，缺省/非法时回落默认。
- **前端内存治理**：观察窗 `frameCache`（各标签最新一帧 JPEG dataURL）与 `pageMeta` 按 `targetId` 无限累积，长会话/多标签会缓慢泄漏。现在按当前存活标签表剪除已关闭标签的缓存，并给 `frameCache` 加 `MAX_CACHED_FRAMES=12` 最旧优先上限兜底。
- **硬编码 `/root` 家目录回退改为 `os.homedir()`**：状态路径探测中 POSIX 默认家目录由环境相关的 `/root` 改为跨平台正确的 `os.homedir()`，消除非 root 用户/容器环境的隐患。

### 工程
- 新增 `.gitattributes`：统一 LF 换行（`* text=auto eol=lf`），消除 Windows 侧 `core.autocrlf` 造成的工作树 CRLF 抖动与 diff/cp 误判。

## [v0.6.1] - 2026-04

修复版本：自愈链路 + 观察窗 worker 稳定性、面板引导条可用性。

### 修复
- **插件卸载不再阻塞宿主退出 / 破坏自愈**：`ctx.effect` teardown 由 `await ego-browser --stop`（15s 宽限，拖住宿主退出）改为 fire-and-forget，宿主可被 `dsh-web-guard` 在 10s 内干净拉起、被中断 turn 自动续接。
- **观察窗 worker 单实例守卫 + stale 状态清理**：同一份 `ego-cast-worker.mjs` 可能同时从安装目录与 dev 克隆被拉起、且 `ensureWorker` 在已知 pid 失效时会再拉起一个，导致 `ego-cast.json` 恒指向已死/滞后的 worker、面板失去推流。现在 worker 启动即枚举并停止其他同名进程（Windows 经 `powershell -EncodedCommand`，POSIX 走 `ps`），并删除 stale 的 `ego-cast.json`，让本进程 `{port,pid}` 成为唯一权威。
- **登录 / 人机验证引导条支持手动关闭**：新增 × 按钮；两条引导条互斥显示（人机验证优先），不再"关不掉"或"双条叠加压缩画面"。
- **观察窗主动跟随 agent 正在操作的页面**：此前面板用"最后一次重绘"(lastActive) 当作当前页，后台动画/视频页重绘会抢占视图，agent 切页时主画面不跳转。现 worker 经 DevTools `/json/list` 取浏览器 MRU 激活 tab（与 ego runtime `tabs.mjs` 同源判定），在 `/api/spaces` 与 SSE 中都标记 `active: true` 并排第一；前端 auto-follow 仅跟随激活页、忽略后台重绘帧。

## [v0.6.0] - 2026-04

代码健康治理（工程收敛）。

- 消除构建覆盖炸弹：删除过时的 `src/`（561 行旧版）与 `tsconfig.json`，确立 **`lib/` 为唯一权威源**。`npm run build` 由「tsc 编译 src→lib（会导致旧版覆盖、工具全丢）」改为「对 `lib/` 做语法校验（`node --check`）」。
- 统一工具注册：`ego_captcha` / `ego_help` / `ego_doctor` / `ego_script` 改为与其他工具一致的 `withEgoLock` + 冷启动重试路径（并发安全）。
- 不再分叉：新增能力（下载捕获、人机验证检测、30+ 工具）以 `lib/` 为准。

## [v0.5.0] - 2026-04

实时推流 + 监控窗直接操作浏览器。

- 修复实时推流关键 bug：`screencastFrame` 匹配错误字段，实时帧从未真正经 SSE 推送。已修正，动态页面接近 10~30fps 推帧。
- cast-server 流式转发改用 `node:http`（fetch 对 chunked 响应缓冲导致首帧延迟）。
- 监控窗鼠标直接操作 agent 浏览器：滚轮滚动、点按/拖动点击真实浏览器（`/api/ego/input` → CDP `Input.dispatchMouseEvent`），Ctrl+滚轮缩放、Ctrl+拖动平移、双击复位，坐标按真实视口逆映射含 letterbox 校正。
- 新增 `/api/ego/stream`（SSE）实时帧 + 页面列表。
- 登录引导条 +「已登录，保存」（触发 `/api/ego/flush` 落盘）；修复 `ego_auth_flush` Windows 状态目录路径。

## [v0.4.0] - 2026-04

跨平台（Windows 适配落地）。

- Windows 原生支持：`IS_WIN` + `windowsChromeCandidates()` 自动探测 Chrome/Edge/Brave 安装目录与 `PATH`/`%PATHEXT%`。
- 注入服务改为 `webServer`/`httpServer` 二选一，Windows 也能挂载观察窗。
- 状态路径跨平台：Windows 用 `%LOCALAPPDATA%\ego-lite-linux`，POSIX 用 `$XDG_STATE_HOME/ego-lite-linux`。

## [v0.3.0] - 2026-04

修复与增强。

- 冷启动自动重试：每个 `ego_*` 动作新起 `ego-browser` 子进程，会话预热期偶发 `CDP channel is not open` / DevTools 超时。内置最多 3 次逐步退避重试，仅对瞬时冷启动错误重试，真错误立即透传。

## [v0.2.0] - 2026-04

亮点：实时观察前端口。

- `lib/client.js`：深色毛玻璃 UI，右下角 🌐 小球常驻，点开见 agent 实时画面。
- 标签管理：横排标签条 + 每标签 `×` 关闭（真正关浏览器标签）。
- 缩放/拖拽/复位、动态轮询（活跃 2s / 静止 8s）、导航复用 tab。
- `bin/ego-cast-worker.mjs`：attach 到 agent 正在用的浏览器，CDP 实时推帧，崩溃自动重启。
- 开箱即用：`bin/ego-chrome-wrapper.sh` 随包自带，root/无头自动 `--no-sandbox`。
