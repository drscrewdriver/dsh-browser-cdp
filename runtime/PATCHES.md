# runtime/ — vendored 运行时本地改动记录

本目录来自 [CitroLabs/ego-lite](https://github.com/CitroLabs/ego-lite)（MIT，含 Linux 移植 PR #234
与本地代理补丁），在首次 vendoring 提交 `a77dee4` 时整体引入。**只读参照**为主。

> 排查/跟进上游前先看这里：如果一项改动只在下面列出，说明它相对上游是我们或本仓库维护引入的；
> 没列出的文件 = 与 vendored 时一致（它们可能本就是这个 Linux 移植自带的本地化）。

## 明确的本地改动（相对 vendored 基线）

| 文件 | 改动 | 原因 / 提交 |
|---|---|---|
| `runtime/ego-linux/src/cursor.mjs` | 光标覆盖层默认名 `Claude` → `DeepSeek`（4 处：默认值 + 注释） | 品牌统一，`dacbd47` |
| `runtime/ego-linux/src/chrome.mjs` | `resolveBinary()`: `candidate.includes("/")` → `isAbsolute(candidate)`；`which()`: Windows 用 `where` 替代 `which` | Windows 支持：POSIX `includes("/")` 不识别 `C:\\` 路径，`which` 在 Windows 不存在 |
| `runtime/ego-linux/src/chrome.mjs` | `LAUNCH_FLAGS` 加 `--no-startup-window`；`launch()` 删除 `"about:blank"` 位置参数 | 消除单次 `ego_space_open` 开两个窗口：原位置参数在默认 browser context 开残留 tab，space tab 走独立 context 又开一个窗口，Chrome 把不同 context 隔离到不同窗口 → 用户看到两窗。`useSpace+ensureRealTab` 路由下不再需要 launch 残留 tab |
| `runtime/ego-linux/src/chrome.mjs` | `launch()` 的 `args` 末尾 spread `filterChromeArgs(process.env.EGO_LINUX_EXTRA_ARGS ?? "")`；新增模块内 `CHROME_BLOCKED` 集合 + `tokenizeArgs`/`filterChromeArgs` 函数（与 `lib/config.js` 镜像，runtime 不 import lib/） | 用户自定义 Chrome 启动参数（设置字段 `chromeArgs`）：插件 `resolveEgoEnv` 把 `chromeArgs` 桥接到 `EGO_LINUX_EXTRA_ARGS`，runtime 切分 + 拉黑控制面标志（`--user-data-dir`/`--remote-debugging-port`/`--headless`/`--proxy-server` 等）后 spread 进 Chrome argv。仅浏览器下次冷启动生效 |
| `runtime/ego-linux/src/paths.mjs` | Windows 用 `%LOCALAPPDATA%\\ego-lite-linux` 作为 DATA_DIR / STATE_DIR；`CHROME_CONFIG_CANDIDATES` 加 Windows 路径 | Windows 支持：XDG 变量在 Windows 不存在；`ego_doctor` 已预期 `%LOCALAPPDATA%` |
| `runtime/ego-linux/bin/ego-browser.mjs` | headless 判定加 `hasDisplay`：有可用 X display（如 Xvfb）时忽略继承的 `EGO_LINUX_HEADLESS=1`，跑 headed | watch 面板全帧率 + ffmpeg x11grab 后端能抓到画面：headless 走 swiftshader ~1fps 且不渲染到 X display（x11grab 抓黑屏）。PR #10 曾回退此逻辑（只认 env），已重新移植（2026-08-18） |
| `runtime/ego-linux/bin/ego-browser.mjs` | 显式 `EGO_LINUX_HEADLESS=1/true/yes/on` 现在优先于 `hasDisplay` 推断（含 win32）；未设置时维持原 hasDisplay 逻辑 | issue #35：此前 win32 硬编码 `hasDisplay=true` 导致显式设置的环境变量被静默忽略，与 CLI help / README 文档矛盾 |
| `runtime/ego-linux/src/task-spaces.mjs` | `createSeededContext()` 增加 `EGO_ISOLATE_SPACES` 环境变量开关支持；未开启（默认）时返回 `null` 复用磁盘 Profile，开启时保留原作者内存沙盒隔离 | 登录态持久化与沙盒隔离双模可配：用户在设置中选择是否开启空间隔离；默认关闭时所有登录态直接落盘，跨关机重启永久保留，开启时恢复独立内存沙盒 |
| `runtime/ego-browser/screenshot-clip.mjs` + `runtime/ego-browser/dist/out/index.js` `screenshot()` | viewport / locator 截图的 CDP clip 原点改为 `pageInfo().sx/sy`（`scrollX/scrollY`），不再固定 `{x:0,y:0}`；fullPage 仍从文档原点截整页 | CDP clip 是文档坐标且默认 `captureBeyondViewport:false`：滚动后 clip 落在未绘制区域会得到空白 PNG。与 `spaces-server.mjs` followClip 同一约定 |
| `runtime/ego-linux/src/snapshot.mjs` | 密码框的 `inputValue` 不再输出明文：`type=password` 时 `value=********`，否则维持 `squash(...)` | 安全：语义树会进模型上下文与会话日志，浏览器 autofill 会把真凭证填进去 |
| `runtime/ego-linux/src/chrome.mjs` | 新增 `clearSessionRestore(profileDir)`；`stopBrowser()` 在 `stopped \|\| !state` 时删除 `<profile>/Default/Sessions` | issue #67 上半：SIGTERM 被 Chrome 记为 crash，残留 session 文件会让下次冷启动静默恢复全部标签，而那些标签不属于任何 space |
| `runtime/ego-linux/src/task-spaces.mjs` | 新增 `ORPHAN_GRACE_MS` + `selectOrphans()`；`reconcile()` 在两阶段宽限后 `Target.closeTarget` 并记入 `closedSpaces`；`EMPTY` 加 `orphans` | issue #67 下半：孤儿 target 不属于任何 space，`pruneIdle`/`pruneAbandoned`/`--prune-spaces` 三套清理都扫不到，标签只增不减 |
| `runtime/ego-linux/src/chrome.mjs` | 新增 `killWindowsProfileOwners()`（PowerShell 按命令行过滤 chrome.exe，10s 上限）；`clearProfileLock()` 加 win32 分支（清 `lockfile`/`Singleton*`） | issue #70：Windows 不写 `SingletonLock` 只留空 `lockfile`，旧实现 `readlink` 直接 ENOENT 返回，孤儿 Chrome 永久占住 `--user-data-dir`，只能重启机器 |
| `runtime/ego-linux/src/chrome.mjs` | 新增 `X11_LOCK_DIR` / `readXLockPid()` / `isProcessAlive()` / `displaySocketAlive()`；`displayUsable()` 改为查 lock pid；`pickFreeDisplayNumber()` 只把活 display 算占用 | issue #91：Xvfb 退出后 socket 残留，旧逻辑把死 display 当可用，冷启动白等 20s 且 display 号每次重启漂移 |
| `runtime/ego-linux/src/shim.mjs` | `ego` 门面新增 `hideCursor()` / `showCursor()` | issue #96：用户希望在浏览器窗口里保留 agent 光标，但截图 PNG 不要出现它 |
| `runtime/ego-linux/src/cursor.mjs` | `renderOverlay()` 开头加 `document.contentType` 守卫：非 `text/html` / `application/xhtml+xml` 不注入并清掉旧 host | JSON / 纯文本 / XML / PDF 标签页是整片密集字形，磨砂徽标叠上去被用户当“乱码” |
| `runtime/ego-linux/src/cursor.mjs` | `#arrow` 规则去掉 `display:block`，可见性统一交给 `svg.shape{display:none}` / `.on{display:block}` | `#arrow` 是 ID 选择器，其 `display:block` 压过 `svg.shape` 的 `display:none`，切到 hand/beam 后箭头与手形重叠在同一点 |
| `runtime/ego-browser/dist/out/index.js` `networkMatches()` | 字符串 matcher 含 `*` 时走 `globToRegExp`（与 `waitForURL` 同一个 helper），精确 URL 维持 `===` | 文档里的 glob 形式（`**/api/stories`）此前永不匹配：`===` 比字符串，于是 glob 等待全部超时，哪怕事件就在缓冲里 |
| `runtime/ego-browser/dist/out/index.js` `waitForNetworkMatch()` + `enablePageEvents()` + `acquireNetworkEvents()` | 新增 `replayBufferedNetwork()` / `bufferedWindowStart()` / `describeBufferedMiss()`；`includeBuffered` 先在全局缓冲里回放（窗口从产生上次主框架导航的那个请求起算，因为文档自身的 request/response 早于 `Page.frameNavigated`）；attach 时即 `Network.enable`；等待结束后不再 `Network.disable`；超时且匹配请求由缓存提供时列出 URL 并提示 cache-busting | issue #31：`page.goto()` 之后的文档响应永远等不到（Network 域开启晚于请求发出，且 wait 只看未来事件）；缓存命中的超时又完全不可诊断，只能盲等 |
| （其余 runtime 文件）| 与 vendoring 时一致 | 无后续本地改动 |

## 说明
- `chrome.mjs` 里的代理支持（`EGO_LINUX_PROXY`）在首次 vendoring 时已包含（本 Linux 移植特性），
  非后续本地改动；如需调整走它。
- **同步提醒**：`lib/index.js` 与 `bin/ego-cast-worker.mjs` 各有一份 humanCheck 探针（逻辑相似）——
  若改探针特征，两处都要同步。
- **同步提醒**：`lib/config.js` 的 `tokenizeArgs`/`filterArgs`/`CHROME_BLOCKED` 与 `runtime/ego-linux/src/chrome.mjs` 的 `tokenizeArgs`/`filterChromeArgs`/`CHROME_BLOCKED` 是镜像副本（runtime 不 import lib/）——改一处必须同步另一处。
- 若要跟进 ego-lite 上游，重点 diff 上表的 cursor.mjs；其余文件可直接与上游对齐。
