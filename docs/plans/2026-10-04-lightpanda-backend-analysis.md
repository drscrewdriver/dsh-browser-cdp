# Lightpanda 作为 dsh-browser-cdp backend 的对接分析

> 日期：2026-10-04 · 状态：**分析完成，待排期**（实施规划见同目录 codeplan 产物）
> 事实基准：Lightpanda `main@6fbbeee`（v0.4.x）源码逐域核对 + 本仓库 `src/` 全量 CDP 面盘点
> 关联文档：`docs/ARCH.md` · `HANDOVER.md` · `docs/plans/2026-08-20-custom-cli-args-design.md`

---

## 0. 一句话结论

**可行，且接入成本低。** Lightpanda 的全部卖点就是"暴露一个 CDP server"（`Browser: Lightpanda/<ver>`，
flatten sessionId、`/json/version`、`/json/protocol` 与 Chrome 同形），本插件的远端 attach 机制
（`endpoint.ts` → `discoverWebSocketUrl`）**今天就能连上它**。真正的工作量不在"连"，而在
**识别后的能力降级**：工具主路径（ego runtime）近乎全兼容；worker 的观察窗（screencast）与
pick（Overlay/bindingCalled）两条链路必须显式降级或关闭，否则表现为"挂起/静默坏"。

设计总纲：**开关管启动方式，识别管能力投影**——

- **开关（启动侧）**：新增 `localEngine: 'chrome' | 'lightpanda'` + `lightpandaPath` 设置。
  只影响"本机受管启动"（`cdpMode=local` / `allowLocalFallback`）；远端 attach 到任意端点
  不需要开关——用户自己起 `lightpanda serve`，插件把它当普通 CDP endpoint 连。
- **识别（能力侧）**：probe / attach 时读 `DiscoveryOk.browser`（`endpoint.ts:183` 已捕获），
  `Lightpanda/` 前缀 → 在 link 上记录 `engine`，并投影一份 `BackendCapabilities`，消费方
  （enable 序列 / 截图格式 / worker capture / pick / doctor）按能力裁剪行为。

---

## 1. 价值假设（为什么值得接）

| 维度 | Chrome headless（现状） | Lightpanda（预期） | 对本插件的意义 |
|---|---|---|---|
| 冷启动 | ~2s（launcher 就绪门实测窗口 20s 上限） | 亚秒级 | `idleTimeoutMin` 归零后"即用即启"体验成立 |
| 常驻内存 | ~2GB/100 页（官方基准） | ~123MB/100 页 | `bcdp_space_open` 多开场景成本降一个数量级 |
| 单页抓取耗时 | 基线 | ~9x 快 | 批量读取型任务（snapshot/read_element/http）直接受益 |
| 渲染保真 | 像素级 | **文本级 PNG** | 视觉依赖型功能（captcha/jev_frame/pick）降级 |

定位：Lightpanda 是**读取型任务的低成本 backend**，不是 Chrome 的全量替代。
截图是"可读文本版面"而非像素真实，任何拿截图喂视觉模型的功能都要按此重新评估。

---

## 2. 现状地图（改动落点）

本插件有**两条独立的执行路径**，对接分析必须分开评估：

### 路径 A：工具路径（37 个 `bcdp_*`）
```
bcdp_* 工具 (src/index.ts, buildScript 模型)
  → spawn vendored runtime (`ego-browser nodejs`，SENTINEL 回传)
  → 端点经 EGO_LINUX_CDP_URL 注入 (src/cast-server.ts:462)
  → runtime 自带 CDP client (runtime/ego-linux/src/transport.mjs, chrome.mjs)
```
**CDP 依赖面**（对 `runtime/ego-browser/dist/out/index.js` + `runtime/ego-linux/src/*.mjs` 盘点）：
- Target: getTargets / activateTarget / createTarget / closeTarget / createBrowserContext / disposeBrowserContext / attachToTarget / detachFromTarget
- Page: enable / navigate / reload / getFrameTree / getLayoutMetrics / captureScreenshot / startScreencast×3 / screencastFrame / screencastFrameAck / handleJavaScriptDialog / downloadWillBegin / downloadProgress / setDownloadBehavior(Page) / **loadEventFired（仅 cursor.mjs:112 用于 HUD 跨导航刷新）**
- Runtime: evaluate / callFunctionOn / addBinding / releaseObject
- DOM: resolveNode / getBoxModel / setFileInputFiles
- Input: dispatchMouseEvent / dispatchKeyEvent / insertText
- Network: enable / disable / requestWillBeSent / responseReceived / loadingFinished / loadingFailed / getResponseBody
- Emulation: setDeviceMetricsOverride / clearDeviceMetricsOverride
- Browser: setDownloadBehavior / close / getVersion / grantPermissions / setPermission / getWindowForTarget / setWindowBounds
- Storage: setCookies / getCookies · Accessibility: getFullAXTree

### 路径 B：worker 路径（观察窗 + pick）
```
cast worker (src/worker/cdp-cast-worker.ts)
  → CdpSession 常驻连接 (src/cdp/session.ts: flatten, id 配对, 退避重连, 重放 enable 序列)
  → capture-cdp.ts: Page.enable → getLayoutMetrics → startScreencast(jpeg) → screencastFrameAck
  → backstop: captureScreenshot(jpeg)          (capture-cdp.ts:196,301)
  → pick: Overlay.setInspectMode/inspectNodeRequested + DOM.getNodeForLocation
          + Runtime.addBinding('__dshPickAction') → Runtime.bindingCalled 回传
```

### 已有的接缝（识别与开关的挂点）
| 接缝 | 位置 | 说明 |
|---|---|---|
| `Browser` 字段捕获 | `src/cdp/endpoint.ts:183` | `discoverWebSocketUrl` 已返回 `browser`/`protocolVersion`——**识别的天然挂点，零新协议** |
| probe 链路 | `src/cdp-targets.ts` `probeEndpoint` + `src/gateway.ts:203` (`cdp-probe`) | 面板 badge 的 probe* 字段族，可加 `probeEngine` |
| launcher | `src/cdp/launcher.ts`（M0.9 已实现） | 端口分配 / `/json/version` 就绪门 / `launcher.json` 登记表 / killTree 停止——**可整体复用给 `lightpanda serve`** |
| 开关骨架 | `src/config.ts` | `cdpMode(auto/local/remote)` · `remoteEnabled` · `allowLocalFallback` · `localHeadless` · `chromePath/chromeArgs`（含 BLOCKED 参数表模式） |
| enable 序列 | `src/cdp/events.ts`（`orderEnableMethods`）+ `session.setReplay` | 序列由域集合推导；**按 engine 过滤域集合即可过滤序列** |

---

## 3. Lightpanda 事实卡（main@6fbbeee / v0.4.x）

- **形态**：单二进制（Zig，内嵌真 V8），`lightpanda serve --host 127.0.0.1 --port 9222` 起一个
  纯无头 CDP server。**没有窗口、没有像素渲染**；截图走 `lp.screenshot.preparePng`（文本级版面）。
- **识别特征**：`GET /json/version` → `"Browser": "Lightpanda/<版本>"`、
  `"Protocol-Version": "1.3"`、`"webSocketDebuggerUrl": "ws://host:port/"`（Server.zig 测试断言）。
  **与本插件现有 discovery 完全同形。**
- **协议**：CDP（flatten sessionId 多路复用，未知 session 报 `-32001`）；WebDriver BiDi 同端口可选。
- **平台**：Linux x86_64（glibc/musl）、macOS aarch64、Docker（`lightpanda/browser`）。
  **无 Windows 原生版**——本插件跑在 Windows 时需 WSL2/Docker（`-p 9222:9222`）。
- **许可/遥测**：AGPL-3.0（本插件是纯 CDP 客户端，不聚合其代码，无传染，但文档应注明）；
  遥测默认开（`LIGHTPANDA_DISABLE_TELEMETRY=true` 关闭），受管启动时应显式关闭。
- **成熟度**：beta。错误/崩溃可能；能力矩阵锚定 main@6fbbeee，**发版前需重跑真机探针**。

---

## 4. CDP 能力对照矩阵

图例：✅ 支持 · ⚠️ 支持但语义差异 · ❌ 不实现（对本插件可见的影响）。
"调用点"仅列本插件（含 vendored runtime）实际使用处。

### 4.1 Target 域 — 全绿
| 方法 | 调用点 | 状态 |
|---|---|---|
| getTargets / attachToTarget / detachFromTarget / createTarget / closeTarget / activateTarget | 两路径 | ✅ |
| createBrowserContext / disposeBrowserContext | runtime（space 隔离） | ✅ |
| targetDestroyed / detachedFromTarget 事件 | session | ✅ |

### 4.2 Page 域 — 一处硬差异（screencast）
| 方法/事件 | 调用点 | 状态 | 影响 |
|---|---|---|---|
| enable / navigate / reload / getFrameTree / getLayoutMetrics / handleJavaScriptDialog / close / addScriptToEvaluateOnNewDocument / createIsolatedWorld / setLifecycleEventsEnabled | 两路径 | ✅ | — |
| captureScreenshot | worker backstop、bcdp_screenshot | ⚠️ **PNG-only**：`format != "png"` 直接 `-32000`；`quality` 参数忽略；clip / captureBeyondViewport 支持 | 本插件两处调用都是 `format:'jpeg'`（capture-cdp.ts:196,301）→ **必须按 engine 提升为 png** |
| startScreencast / stopScreencast / screencastFrame / screencastFrameAck | worker 观察窗 | ❌ 整域缺失 | **观察窗 CDP 后端死路** → captureBackend 强制降级（见 §6） |
| `Page.loadEventFired` 事件 | cursor.mjs:112（HUD 跨导航刷新） | ❌ 不发（改发 `Page.lifecycleEvent name="load"`） | 仅 HUD 刷新失效，**不阻塞**（runtime 的 goto 等待不依赖该事件，已核实） |
| downloadWillBegin / downloadProgress 事件 | bcdp_download | ❌ 未实现 | bcdp_download 在 Lightpanda 上不可用（setDownloadBehavior 方法本身 ✅，但无事件驱动） |

### 4.3 Runtime 域 — 一处隐藏断点
| 方法/事件 | 调用点 | 状态 | 影响 |
|---|---|---|---|
| enable / evaluate / callFunctionOn / addBinding / releaseObject / getProperties | 两路径 | ✅ | — |
| `Runtime.bindingCalled` 事件 | pick 浮条回传（pick-ui 注入 `__dshPickAction` binding） | ❌ 不发（runtime 域仅发 `consoleAPICalled`） | **pick 链路断裂** → pick 功能在 Lightpanda 上关闭 |

### 4.4 DOM / Input / Accessibility — 全绿
| 方法 | 调用点 | 状态 |
|---|---|---|
| DOM: enable / getDocument / performSearch + getSearchResults（xpath）/ querySelector(All) / resolveNode / describeNode / getBoxModel / getContentQuads / scrollIntoViewIfNeeded / getOuterHTML / **setFileInputFiles** / focus / requestChildNodes | snapshot/click/fill/upload | ✅（xpath 检索、文件上传都在） |
| Input: dispatchMouseEvent / dispatchKeyEvent / insertText | click/fill/key/hover/scroll | ✅ 三件套齐（无 drag/gesture 域事件；bcdp_drag 走鼠标事件合成，可用性需真机验证 ⚠️） |
| Accessibility: getFullAXTree / getPartialAXTree / queryAXTree | bcdp_snapshot（Set-of-Marks） | ✅ **AX 树支持是 snapshot 在 Lightpanda 上成立的承重墙** |

### 4.5 Overlay — 整域缺失
| 方法 | 调用点 | 状态 | 影响 |
|---|---|---|---|
| Overlay.enable / highlightNode / hideHighlight / setInspectMode / inspectNodeRequested | worker pick 高亮、events.ts 域亲和序列 | ❌ 无 overlay.zig | pick 不可用（同 bindingCalled）；**enable 序列必须过滤**，否则 attach 重放报 UnknownMethod（session 重放失败会"记录并上报"，不静默——见 session.ts:15-18，面板会显示不健康） |

### 4.6 Network / Storage / Emulation / Browser
| 方法 | 调用点 | 状态 | 影响 |
|---|---|---|---|
| Network: enable/disable / setExtraHTTPHeaders / setUserAgentOverride / requestWillBeSent / responseReceived / loadingFinished / loadingFailed / getResponseBody / setCookies / getCookies / setBlockedURLs | bcdp_http / wait_for_response / 请求头定制 | ✅（事件五件套全有） | — |
| Storage: setCookies / getCookies | bcdp_auth_flush / login_import | ✅（另有 clearCookies；**无 flushCookies** → best-effort 调用需吞 -32601） | — |
| Emulation: setDeviceMetricsOverride / clearDeviceMetricsOverride | viewport 控制 | ✅ | — |
| Browser: getVersion / setDownloadBehavior / grantPermissions / setPermission / getWindowForTarget / setWindowBounds | doctor / download / FFmpeg 窗口捕获 | ✅（getWindowBounds ❌ → Windows gfxcapture 路径本就不适用 Lightpanda） | — |
| **Browser.close** | runtime ×4、src ×8（停止路径） | ❌ | 受管启动场景无影响（launcher 本就 killTree 进程）；远端 attach 场景"停止"语义本就是断开而非杀浏览器——调用点需按 engine 跳过 |

---

## 5. 语义差异深挖（会咬人的三处）

1. **JPEG → PNG 是全局穿透改动，不是局部替换。** worker 观察窗的 `<img>` SSE 链路、
   `cdpQuality`（JPEG 质量参数）、jev 的字节预算假设（`jevMaxImageBytes` 注释里"137 KiB full-page JPEG"
   的量级经验在文本渲染 PNG 下不成立）都要重新标注。建议：能力投影带 `imageFormat: 'png'`，
   所有 format 决策点读投影而非硬编码。
2. **"截图能出图"≠"截图可信"。** 文本级渲染对 captcha 检测（`bcdp_captcha`）、jev 视觉评审
   （`jev_frame`/`jev_evaluate`）是系统性偏移。这两类工具在 Lightpanda 下应在输出里显式
   携带 `engine: 'lightpanda', rendering: 'text'` 让上游模型知情，而不是悄悄给图。
3. **enable 序列按 engine 过滤，而不是吞错误。** `session.setReplay` 的约定是"原样重放、失败上报"。
   若靠"重放失败也算成功"来兼容 Lightpanda，会把真实的协议漂移也一起吞掉。正确位置是
   `orderEnableMethods` 的输入（域集合）按 `BackendCapabilities` 裁剪。

---

## 6. 开关设计（启动侧）

### 方案对比
- **方案 A：新增 `kind:'lightpanda'` link 类型** —— 否决。link kind 会乘进 probe/激活/面板/共存
  校验的每一处（`coerceLink`/`sanitizeLinks`/面板渲染/ego-cli 单例约束），而 Lightpanda 在协议层
  就是普通 CDP endpoint，新 kind 表达不了任何额外信息，只增加矩阵面积。
- **方案 B（推荐）：识别驱动 + launcher engine 旋钮** —— Lightpanda 两副面孔：
  - **远端 attach**（用户自起 `lightpanda serve` / docker / WSL2）：什么都不用加，它就是一个
    `kind:'cdp'` link。识别自动生效，能力自动降级。
  - **本机受管启动**：`cdpMode=local` / `allowLocalFallback` 的 launcher 路径加 engine 旋钮，
    复用 M0.9 全套机制（端口分配→spawn→就绪门→登记表→killTree）。

### 新增设置（全部 `.volatile()`，与 0.1.7 声明式设置约定一致）
| 字段 | 类型/默认 | 说明 |
|---|---|---|
| `localEngine` | `union['chrome','lightpanda']`，默认 `chrome` | 受管本地启动用哪个引擎。只影响 launcher 路径，不影响远端 attach |
| `lightpandaPath` | `string`，默认空 | 二进制路径；空 = 依次探 PATH、`~/.dsh/cache/dsh-browser-cdp/bin/`、WSL `lightpanda`（win32 提示 WSL2/docker） |
| `lightpandaArgs` | `string`，默认空 | 追加到 `serve` argv；按 BLOCKED 模式滤掉 `--host/--port/--address` 等受管参数 |

### launcher 改造点（`src/cdp/launcher.ts`）
- `discoverChromeBinary` → 泛化为按 engine 分派的二进制发现；
- `buildLaunchArgs` → engine=lightpanda 时组装 `serve --host 127.0.0.1 --port <port>` + 用户参数
  （无 `--user-data-dir` 概念，profile 相关参数直接不适用）；
- 就绪门不变（`/json/version` 200）——对 Lightpanda 天然成立；
- `LauncherRecord` 加 `engine` 字段（读侧向后兼容，缺省 `'chrome'`）；
- **win32 分派**：`lightpandaPath` 未配置且平台为 win32 → 结构化报错并提示 WSL2/docker（P0 不做自动编排）；
- 环境注入：spawn 时默认 `LIGHTPANDA_DISABLE_TELEMETRY=true`。

---

## 7. 识别与能力投影（能力侧）

```
GET /json/version ──► DiscoveryOk.browser
                         │ startsWith('Lightpanda/')
                         ▼
              BackendCapabilities（进程内只读投影）
                engine: 'lightpanda'
                screencast: false          // §4.2
                overlay: false             // §4.5
                bindingCalled: false       // §4.3
                imageFormat: 'png'         // §5.1
                loadEvent: false           // lifecycleEvent 替代
                downloadEvents: false      // §4.2
                browserClose: false        // §4.6
```

- **识别时机 ×2**：
  1. **probe 时**（`cdp-probe` / `cdp-status`）：`probeEndpoint` 把 `browser` 归入
     `engine: 'chrome' | 'lightpanda' | 'unknown'`，写入 link 的 `probeEngine` 探针字段
     （向后兼容：旧行缺字段 → `'unknown'`），面板 badge 直接可见。
  2. **attach/会话建立时**：worker 与工具路径在拿到连接后各投影一次（不跨进程传递活对象，
     与"不缓存 volatile ref 值"同一纪律）。
- **消费方**（按能力裁剪，而非 try/catch 兜底）：
  | 消费方 | 裁剪 |
  |---|---|
  | `events.ts orderEnableMethods` | 输入域集合剔除 `Overlay` |
  | `page.ts` 截图 + worker backstop | `format` 读投影（jpeg→png），quality 不下发 |
  | worker capture-manager | `screencast:false` → captureBackend 不再选 cdp；FFmpeg 路径依赖真实窗口，同样不适用 → **观察窗整体降级**（见 §8） |
  | pick 工具/浮条注入 | `overlay:false || bindingCalled:false` → `bcdp_pick` 类调用返回结构化错误 `engine-unsupported`（映射 i18n） |
  | `Browser.close` 调用点 | `browserClose:false` → 跳过（受管场景走 killTree，已覆盖） |
  | `bcdp_captcha` / jev 视觉链 | 输出携带 `engine/rendering` 元数据 |
  | `bcdp_doctor` / 帮助索引 | 显示 engine、缺失能力清单、win32 编排提示 |
- **未知端点**（Browser 非 Chrome 系也非 Lightpanda）：默认全能力 = 现状，不做保守裁剪——
  识别失败不应该改变行为，这是本次设计的纪律。

---

## 8. 观察窗降级方案（路径 B 的出路）

Lightpanda 无 screencast、无窗口，观察窗三种处理，按成本递增：

1. **P0（推荐先做）**：capture-backend 探测阶段即判 `screencast:false` → 面板观察窗 Tab 显示
   "当前引擎不支持实时画面"，提供**手动刷新的整页截图**（`captureScreenshot png`）作为降级画面。
   worker 不启动 screencast 循环，避免每隔 N 秒撞一次 UnknownMethod。
2. **P2（可选）**：文本快照流——定时 `Page.captureScreenshot` + `lp` markdown dump 组合成
   "文本观察窗"。价值存疑（agent 本可直接 `bcdp_snapshot`），默认不做。
3. **不做**：FFmpeg 路径在 Lightpanda 上无意义（无窗口、无像素），能力矩阵直接禁用。

---

## 9. 工具级影响面（37 个 bcdp_* 速查）

- **无损**（CDP 面全覆盖）：navigate / js / script / click / fill / key / hover / scroll /
  select / upload / wait / wait_for_selector / wait_for_url / wait_for_response / page_info /
  snapshot（AX 树 ✅）/ http / auth_flush / login_import / dialog / space_open / space_close /
  status / check / help / doctor / cli / cdp
- **降级**（功能在，体验变）：screenshot（PNG 文本渲染）· captcha（视觉检测偏移，携带元数据）·
  jev_frame / jev_evaluate（同上）
- **关闭**（依赖缺失域）：download（无 download 事件）· pick 链路（无 Overlay/bindingCalled）·
  观察窗实时画面（无 screencast）
- **待真机验证**：drag（鼠标事件合成是否还原拖拽语义）

---

## 10. 风险与开放问题

| # | 风险 | 处置 |
|---|---|---|
| R1 | Lightpanda 是 beta，能力矩阵会漂移（本文锚定 main@6fbbeee） | 真机探针常设（§11）；矩阵核对脚本化，发版前重跑 |
| R2 | AGPL-3.0 | 本插件仅作 CDP 客户端，无代码聚合，不传染；README/THIRD_PARTY_NOTICES 注明即可 |
| R3 | Windows 无原生版 | P0 结构化报错 + 提示；P2 再考虑 WSL2/docker 自动编排 |
| R4 | 文本渲染 PNG 对视觉链的系统性偏移 | 元数据知情（§7）；jev 字节预算量级重新标定 |
| R5 | JPEG→PNG 改动穿透 worker/前端/jev | 能力投影单点决策（§5.1），禁止散落 format 字面量 |
| R6 | 识别误判（反代/改包的端点伪装 Browser 字段） | 识别只降级不放宽；全能力是默认值，误判只会"少给"，不会"错给" |

---

## 11. 验收探针（沿用 `CDP_PROBE_URL` 模式，新增 `LP_PROBE_URL`）

自跳过真机测试，跑通即认定矩阵未漂移：

1. `/json/version` → `Browser` 前缀 = `Lightpanda/`（识别生效）
2. `Target.createTarget` + attach（flatten sessionId）→ `Page.navigate` → `lifecycleEvent(load)` 到达
3. `Runtime.evaluate`（读 `document.title`）→ `DOM.performSearch`（xpath）→ `Accessibility.getFullAXTree`
4. `Page.captureScreenshot format:'png'` 出图；`format:'jpeg'` → 结构化 `-32000`
5. `Storage.setCookies/getCookies` 往返
6. `Overlay.enable` → 结构化 UnknownMethod（且 session 健康度不受污染）
7. `Input.insertText` + `dispatchMouseEvent` 注入成功

---

## 12. 分期建议

- **P0 — attach + 识别降级**（远端 attach 全链路可用）：
  能力投影模块 + enable 序列过滤 + 截图 format 提升 +
  probe/probeEngine 字段 + pick/download 的结构化关闭 + doctor 展示。
- **P1 — 受管 serve 启动**：launcher engine 旋钮（`localEngine`/`lightpandaPath`/`lightpandaArgs`）
  + 登记表 engine 字段 + 遥测默认关 + win32 结构化引导。
- **P2 — 体验补全**：观察窗手动截图降级面、WSL2/docker 编排、文本快照流评估、drag 真机验证。
