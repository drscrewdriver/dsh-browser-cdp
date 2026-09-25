# dsh-browser-cdp — 看得见的 Agent 浏览器（CDP 接入）

<p align="center">
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.1.7--rc.1-blue" alt="DSH >= 0.1.7-rc.1">
  <img src="https://img.shields.io/badge/DSH--better--sidebar-%3E%3D0.12.2(optional)-red" alt="dsh-better-sidebar >= 0.12.2 (optional)">
  <img src="https://img.shields.io/badge/Node-%3E%3D22-brightgreen?logo=node.js&logoColor=white" alt="Node >= 22">
</p>

> **仓库**：`github.com/drscrewdriver/dsh-browser-cdp`（原名 `dsh-ego-browser`，源自上游 [Fisfzy/dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser)）｜版本历史见 [CHANGELOG.md](CHANGELOG.md)

### 版本兼容矩阵

| 依赖 | 最低版本 | 推荐版本 | 说明 |
|---|---|---|---|
| **DSH** (DeepSeek Harness) | `0.1.7-rc.1` | `≥ 0.1.7-rc.1` | 0.1.7 起设置面为声明式（Config `.volatile()` 字段自动生成设置表单），`.volatile()` 在更早的宿主上不存在。peer 依赖同步锁定 `>=0.1.7-rc.1 <0.2.0-0`。DSH `0.1.2-rc.1` ~ `0.1.6` 请使用 0.16.x 版本线（含旧的 `settings.plugin.item` 设置卡），0.1.0-rc.x / 0.1.1-rc.x 请使用 v0.8.0 及更早版本 |
| **dsh-better-sidebar** | `0.12.2`（可选） | `≥ 0.17.1` | 未安装时自动回退浮动观察球；`< 0.12.2` 可运行但外部链接拦截（`urlTarget`）静默降级 |
| **Node.js** | `22` | — | harness 环境自带 |

**DSH 全版本适配说明**：本版本（v0.17.0 起）面向 DSH `0.1.7-rc.1+` 的声明式设置面：插件不再注册任何设置节（`ctx.settings` 注册类 API 已被宿主删除），改为在 Config schema 上以 `.volatile()` 标记可配置字段，由宿主设置页自动生成表单；volatile 字段变更通过 `loader/volatile-update` 事件热生效，无需重载插件。核心宿主 API（`defineTool`、`ctx.tools.register`、`ctx.subprocess.spawn`、`ctx.webServer.register`、`ctx.inject`、`ModuleLoader` CJS factory、`cordis.patch.yml`）沿用 0.1.2 以来形态。DSH `0.1.2-rc.1` ~ `0.1.6` 请使用 0.16.x 版本线。

**dsh-better-sidebar 适配说明**：本插件通过 `ctx.betterSidebar` 服务（try-catch 防御性获取）注册侧边栏 Tab 并监听外部链接。关键 API 引入版本：

| API | 本插件用法 | better-sidebar 引入版本 |
|---|---|---|
| `registerTab()` / `openTab()` / `ctx.betterSidebar` | Tab 注册 + 打开 | v0.9.0+ |
| `TabDescriptor.single` | 单实例 Tab | v0.9.0+ |
| `TabDescriptor.urlTarget` | 外部链接拦截 | **v0.12.2+**（低于此版本链接拦截静默失效） |

---

**DSH 版本支持详情**：v0.8.2 → v0.8.3 主要变更：合并 6 个社区 PR（root/xvfb/macOS headless 适配、rc.1 兼容、Windows 稳定性），修复无认证 `/api/bcdp/*` 路由安全漏洞、无 dsh-better-sidebar 宿主 client 启动失败（#29）、Windows 冷启动回归（#22 引入的 Xvfb 误判），并修复 gateway 设置白名单缺 `runtimeArgs`/`chromeArgs`。适配点：client 运行时改名（`@deepseek-ai/dsh-client-store`）、client 模块注册 id 与装载行名按声明包名、`dsh.client.inject` 仅声明真实模块图行、`webServer` 以嵌套注入交付（可选服务），并同步侧边栏 Tab（dsh-better-sidebar）模式。

**侧边栏支持（[dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar)）**：当宿主安装了 `dsh-better-sidebar`（推荐 ≥ v0.12.2）时，实时观察窗注册为**侧边栏原生 Tab**——「Agent 浏览器」出现在侧边栏「+」菜单中，点击即打开并随侧边栏抽屉固定展示；agent 首次调用 `bcdp_*` 工具时会自动打开该 Tab（v0.8.5 起按调用会话作用域打开，多会话不再弹错位置）。未安装 `dsh-better-sidebar` 时自动回退为右下角**浮动观察球**（`#dsh-ego-fab`）模式。两种形态共用同一套 SSE 实时推流 / 点击 / 输入 / 下载捕获能力。观察窗还提供一个「弹出窗口」按钮：无头（headless）运行的 agent 浏览器可一键替换为同 Profile 的有头窗口（标签页保留），方便手动接管。

**登录态导入（v0.8.5 新增）**：工具 `bcdp_login_import`，把你日常 Chrome/Edge/Brave 里的登录 cookie **按域名**复制进 agent 浏览器（真实二进制无头启动 + CDP 透传读取，兼容 Chrome 127+ 的 App-Bound Encryption，不做离线解密；源浏览器运行中可选择优雅关闭后导入，窗口下次启动自动恢复）。cookie 值不出现在任何日志与输出中；导入前自动备份源 cookie 库，异常清空自动还原。配合默认的磁盘持久化 Profile，导入的登录态跨重启永久保留。

一款 **CDP 浏览器代理**：把 [CitroLabs/ego-lite](https://github.com/CitroLabs/ego-lite)（给 AI Agent 用的 Chromium）作为内置运行时接入 DeepSeek Harness，以 **33 个结构化 `bcdp_*` 工具**驱动浏览器，并配一套**实时观察前端口**——agent 后台操作网页时，你能像看直播一样看到它正在浏览的每个页面，还能直接操作它。

**一点私藏的独特之处（self-observation）**：agent 用的就是这一个 Chromium——连它操作 **DSH 自身**（管理会话、任务看板、调设置）时，观察窗也实时显示、你能随时接手。不只是"看得见 agent 在网页上干活"，连 agent 操作 DSH 界面本身都是全程可见、可掌控的。

**开箱即用**：插件包内置 ego 运行时（`runtime/`，MIT，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）——无需克隆官方仓库、无需手动构建，`--no-sandbox` wrapper 随包自带，root / Docker / 无显示器一键跑。

---

## 我们的真正优势（不是口号，是能对照代码和竞品核实的能力）

同样把 ego-lite 接进 DSH，市面上已有同类插件用它**只做了 3 个工具**——一个 `run` 脚本、一个 `help` 指南、一个 `status` 体检，浏览器仍是**后台黑盒**。本插件走的是另一条路：**把黑盒打开，并且一上来就把"看"和"控"的能力做到位**。

| 能力 | 本插件（本仓库） | 同类插件（Da1dr1em/dsh-ego-browser） |
|---|---|---|
| 结构化工具数 | **32 个**，职责单一、可确定性调用 | **3 个**（`run`/`help`/`status`） |
| 实时观察窗（CDP JPEG / FFmpeg H.264 双后端 + 标签条 + 历史抽屉） | ✅ 有 | ❌ 无 |
| 监控窗鼠标**直接操作**真实浏览器（点击/拖拽/滚动回传 CDP） | ✅ 有 | ❌ 无 |
| worker 单实例守卫 + 崩溃/重复自愈 | ✅ 有 | ❌ 无 |
| 下载捕获 `ego_download` / 人机验证检测 `ego_captcha`/`ego_page_info` | ✅ 有 | ❌ 无 |
| 平台自适应（Linux/macOS/Windows 自动探测 + root/无头/`--no-sandbox` 兜底） | ✅ 全平台 | 仅 Windows 预览宿主，需手动配 |
| 登录态落盘持久化 `ego_auth_flush` | ✅ 有 | ⚠️ 仅文档级说明 |

**关键差异两条：**
- **看得到**：别家是"跑完告诉你结果"的黑盒；我们实时推流，你**看着 agent 操作**，卡在验证码/走岔立刻发现。
- **控得住**：别家只读；我们监控窗**直接驱动**同一个 agent 浏览器，需要时你亲手接管（缩放/拖拽/点击），不必打断 agent 重来。

> 以上对比基于公开可见的可核实事实：本仓库代码（`bin/cdp-cast-worker.mjs` 实时推流 + CDP 输入回传、`lib/index.js` 32 个注册工具、`lib/cast-server.js` host 桥接）与同类插件的源码/README。此文档不含对任何他人的贬低——我们只陈述自己多实现并验证了哪些能力。

**相对 [ego-lite](https://github.com/CitroLabs/ego-lite) 本体，我们多做了这些（都可对照本仓库代码核实）：**

| 能力 | 说明（对应代码） |
|---|---|
| **观察窗前端口** | ego-lite 本体是无头 CLI（只有 heredoc 脚本 + 文本输出）；我们在其上加了 **SSE 实时推流 + 标签条 + 历史抽屉 + 监控窗鼠标直操**（`bin/cdp-cast-worker.mjs`、`lib/cast-server.js`、`lib/client.js`），让"看"和"控"成为一等能力 |
| **开箱即用 + 跨平台自足** | `resolveEgoEnv` 自动探测 Chrome/Edge/Brave，内置 `--no-sandbox` wrapper，root / Docker / 无显示器免配置（`lib/index.js`）；不必像官方那样先装一个 GUI 宿主 |
| **健壮性层** | 冷启动自动重试（只重试 CDP 瞬态，不吞真错）、worker 单实例守卫 + 崩溃自动重启、插件卸载 fire-and-forget 不阻塞宿主退出、前端帧缓存上限（`withWarmupRetry` / `makeEnsureWorker` / `frameCache`） |
| **运维型工具** | `ego_doctor`（环境体检）、`ego_captcha`（人机验证探测）、`ego_auth_flush`（登录落盘）、`bcdp_login_import`（系统浏览器登录态导入）、`ego_http`（浏览器上下文请求）等，是原生 CLI helper 没有的一层 |
| **self-observation** | agent 操作 DSH 自身界面时同样实时可见、可接手 |

> 我们不声称媲美官方 macOS App 的内核级快照或原生多窗口体验；本仓库解决的是"把同一套浏览器能力带进 DSH + Linux/WSL + 看得见"这件事。

---

## 它解决什么问题

通用浏览器不是为 agent 设计的，而 Web 上大量交互（登录态、验证码、动态渲染、表单、需真人会话的站点）只有真浏览器能面对——这正是本插件继承自上游 ego 系的 **"让 agent 用你已登录的浏览器，而不打扰你"**（[官网](https://github.com/CitroLabs/ego-lite)）的由来。

本插件把它接进 DSH，并把最痛的一点——**你看不见 agent 在干什么、也插不上手**——用一套观察窗解决：

> 🌐 小球一点看直播；🟦 标签条切换/关闭；🕘 历史抽屉回看；🔍 缩放拖拽；🖱️ 监控窗直接接管真实浏览器。**一句话：让 agent 在浏览器里干活，你在旁边既看得见、又随时能接手。**

### 几个常见的上手场景

- **文献 / 数据抓取**：让 agent 登录知网 / 谷歌学术翻页收集，你在观察窗看着它滚动、点下一页、下载 PDF，中途卡住立刻能发现。
- **表单与登录**：agent 填表到一半，观察窗弹出验证码——你直接接管把验证码点了，再交还给 agent 继续。
- **QA / 冒烟测试**：让 agent 在自己产品上点一圈，观察窗等于一台"会说话的录屏"，顺手还能回看历史轨迹。
- **看 agent 操作 DSH 自身**（self-observation）：agent 在管理会话 / 调设置时，观察窗同样全程可见、可接手。

---


---

## 前置条件

| 要求 | 说明 |
|---|---|
| Node ≥ 22 | harness 环境自带 |
| **任意 Chrome / Chromium / Brave / Edge** | 自动发现，或 `EGO_LINUX_CHROME` 指定；root 下用自带 wrapper |
| DSH + dshx | 插件装载机制 |
| 带图形界面的 DSH Web（观察窗） | headless 会话仍可用 `bcdp_*` 工具，仅无观察窗 |

## 安装

**方式一：GitHub 直装（推荐）**

```sh
dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp
# 也可锁定到某个 commit / tag：
dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp#v0.9.0
```

> `github:` 安装由 pnpm 经 `codeload.github.com` 拉取仓库 tarball，**无需向 npm registry 发包**；直接使用仓库中**预构建入库的 `lib/`**（`files` 仅含 `lib/`、`bin/`、`runtime/`、`cordis.patch.yml`、`dsh-plugin.json`），因此**不触发任何构建脚本**，也不需要 devDependencies。host 入口 `lib/index.js`、客户端 `lib/client.js`、worker `bin/cdp-cast-worker.mjs` 均随仓库分发。

**方式二：本地 tarball / git URL**

```sh
dshx install dsh-browser-cdp <dsh-browser-cdp.tgz>      # tarball 或 git URL 均可
dshx list                                                # 应显示：[on] dsh-browser-cdp
```

> **包名迁移说明**：本插件包名是 **`dsh-browser-cdp`**（曾用名 `dsh-ego-browser`、别名 `@dsh-external/ego-browser`）。DSH Desktop 2.0.5 起增加了「profile 依赖名 == 包实际 name」的一致性校验，若 profile 仍用旧名引用，启动会挂进恢复模式。升级后请把 profile 的 `package.json` 依赖键 **和** `dsh.profile.bundles` 条目**两处**都改为 `dsh-browser-cdp`：

   ```diff
   - "dsh-ego-browser": "github:Fisfzy/ego-browser",
   + "dsh-browser-cdp": "github:drscrewdriver/dsh-browser-cdp",
   ```

   ```diff
   - "dsh-ego-browser",
   + "dsh-browser-cdp",
   ```

观察窗设置中可选 `captureBackend=auto|cdp|ffmpeg`（默认 `auto`，当前解析为 CDP）、画质档位、CDP FPS/JPEG 质量/最大宽度，以及 FFmpeg FPS/最大宽度/码率/编码器/自定义路径。插件先检测自定义路径、系统 PATH 和托管缓存；GitHub 下载可用 `githubMirror` 替换 `https://github.com`，例如 `https://gh-proxy.com/github.com`。FFmpeg 码率范围为 500-20000 kbps，低/平衡/高档默认 2000/4000/8000 kbps。

无需宿主侧任何配置：`resolveEgoEnv` 自动探测 root / 无显示器并兜底。观察窗 host 路由（`/api/bcdp/spaces` 等）仅在有 HTTP server 时注册，headless 是安全 no-op。

## 连接方式：CDP 端点 / 本机 ego CLI

设置面板里的连接列表是**有序**的——**顺序即优先级**，被激活的那一项驱动每一次 `bcdp_*` 调用。列表元素有两种类型：

| 类型 | 它做什么 | 约束 |
|---|---|---|
| **CDP 端点** | 把一个已开调试端口的浏览器地址交给内置运行时（注入 `EGO_LINUX_CDP_URL`），运行时**附着**上去 | 可多条 |
| **本机 ego CLI** | 由本机 ego CLI **自己**驱动它本机的 ego-lite 浏览器——**不注入任何端点** | **仅限本机，全局至多一条** |

**为什么需要第二种**：注入用的 `EGO_LINUX_CDP_URL` 是**内置 Linux 移植版**的私有契约，macOS 上用 `ego lite` app 附带的那个原生 `ego-browser` **根本不读它**。所以在只有"CDP 端点"这一种类型时，macOS 用户无法用上自己那个已登录的 ego-lite——只能连远端端口，或让移植版另起一个 stock Chromium。本机 CLI 类型补的就是这条路。

解析顺序（`cliPath` 留空时）：显式路径 → PATH 上的 `ego-browser` → macOS app 包内 helper（`/Applications/ego lite.app/…/Helpers/ego-browser`）→ 插件内置运行时。

两个默认值值得知道：

- **`--sdk-path` 默认关闭**：默认用 CLI 自带的 harness（官方配对的那套）；打开后才注入本插件的 harness 包。若 CLI 不认这个旗标，插件会记一条提示并**自动重试一次不带它**——不会因此废掉整条链路。
- **就绪探测会走一次真实的 heredoc**（与我们干活用的是同一条通道），所以它**不是免费的**：探测可能冷启动后端浏览器（实测内置移植版约 1.3 s）。

与其它开关的关系：

- `cdpMode`：`auto` 按激活项（两种类型都行）；`remote` **只接受 CDP 端点**，激活项是本机 CLI 时会显式报 `mode-kind-mismatch`；`local` 走受管本地启动器。
- `remoteEnabled`（远端总开关）**只管远端 CDP**，不影响本机 CLI 连接。
- `allowLocalFallback` / `localHeadless` / `localUserDataDir` 只作用于 CDP 端点的回落与受管启动。

`bcdp_doctor` 会报告当前序列类型计数、CLI 实际解析到的路径与形态，以及（若同机装了上游 `dsh-ego-browser`）一条共存提示。

## 工具清单（33 个，前缀 `bcdp_`，完整索引见 `bcdp_help`）

| 类别 | 工具 |
|---|---|
| 任务空间 | `ego_space_open` `ego_space_close` `ego_status` |
| 页面读取 | `ego_snapshot`（语义树） `ego_page_info` `ego_read_element` |
| 导航/等待 | `ego_navigate`（复用 tab） `ego_wait` `ego_wait_for_selector` `ego_wait_for_url` `ego_wait_for_response` |
| 交互 | `ego_click` `ego_fill` `ego_hover` `ego_drag` `ego_select` `ego_check` `ego_key` `ego_scroll` |
| 执行/调试 | `ego_js`（页面求值） `ego_cdp`（原始 CDP） `ego_cli`（任意 heredoc） `ego_script`（多步脚本） |
| 输出 | `ego_screenshot` `ego_download` `ego_upload` |
| 会话/安全 | `ego_auth_flush`（登录落盘） `ego_captcha` `ego_dialog` |
| 元工具 | `ego_help` `ego_doctor` `ego_http` |

## 观察窗怎么用

右下角 **🌐 常驻小球** → 点开：

- **主画面**：agent 当前页面实况；点击/拖动/滚轮直接操作页面，Ctrl+滚轮缩放视图、Ctrl+拖动平移，双击复位。点击画面后可直接键盘输入，支持中文 IME、粘贴、Tab/Enter/方向键及 Ctrl/Cmd 快捷键。
- **标签页条**：顶部横排，点选切换，`×` 关闭。
- **历史抽屉**（🕘）：按时间回看访问轨迹。
- 操作时下方网址行就地显示提示，2 秒后恢复。
- 面板关闭、sidebar Tab 隐藏或组件卸载后，1.5 秒宽限结束即停止画面生产。仅把 DSH 窗口切到后台不会停止串流，避免回前台时反复重建 WGC/FFmpeg；异常关闭由 120 秒 worker lease 超时兜底。

### 画面后端

- `cdp`：`Page.startScreencast` JPEG，默认 20 FPS。每个源帧立即按 Chrome 提供的帧 ID ACK，只保留最新待发帧；仅捕获当前观看标签，静态页恢复截图默认 3 秒一次。
- `ffmpeg`：Windows 以 `gfxcapture(hwnd)` 直接采集目标 Chrome 窗口的 D3D11 surface；其他平台使用显示来源 crop。随后编码 H.264 fragmented MP4 → HTTP 二进制 chunk → MediaSource `<video>`，不经过 Base64/SSE。
- `auto`：默认选择 CDP，不检测成功也不会自动下载 FFmpeg。FFmpeg 安装并通过能力检查后才可选择；已保存的 FFmpeg 后端若后来失效，本次观察会回退 CDP 并展示原因。
- Windows FFmpeg 必须包含 `gfxcapture`。插件按 browser PID、target title 和 CDP window bounds 匹配 HWND；窗口移动或被遮挡时仍捕获目标页面，并且不允许回退到桌面录制。若 target 是同一 Chrome 窗口里的后台 tab，会明确报错而不是展示当前可见 tab 或抢用户焦点。macOS 首次使用需要“屏幕录制”权限；X11 需要 Chromium 与 FFmpeg 共享 `DISPLAY`；Wayland 缺少 Portal/PipeWire 输入时会提示切回 CDP。

托管 FFmpeg 安装到 `~/.dsh/cache/ego-browser/ffmpeg/`，不会写入插件目录。Windows/Linux 使用固定 BtbN release tag；macOS 使用固定的 `ffmpeg-static` GitHub release 资产（其 Intel/Apple Silicon 二进制分别来源于 Evermeet/OSXExperts）。所有下载均固定资源 SHA-256，只提取 FFmpeg 主程序，不安装 `ffprobe` 或 `ffplay`。Windows/Linux 解包使用系统 `tar`；缺少时会在下载前明确报错。

> 登录态说明：多任务空间 Cookie 相互隔离，请在对应空间内登录。重启 DSH 后运行期登录态被清空（Chrome 运行期 Cookie 仅优雅关闭时落盘），需重登——扫码很快。

## 工作原理

- **工具层**：每个工具把参数拼成 JS 脚本，经 `ctx.subprocess` 用 `ego-browser nodejs` 喂给 stdin 运行，宿主经 CDP 驱动共享 Chromium。结果以 `@@DSH_RESULT@@` 哨兵行解析。所有 `bcdp_*` 经进程内互斥锁串行化，错误统一归一。
- **观察窗**：`lib/client.js` 管理 watcher lease、JPEG `<img>` 与 MSE `<video>`；`lib/cast-server.js` 代理元数据 SSE、watch API 和带背压的二进制视频；worker 中 `CaptureManager` 保证同时只有一个活动后端和一个当前 target。CDP 控制面（标签、viewport、输入、验证码）独立于画面后端。

## JEV 风格管道：让 LLM 把控浏览器循环（阶段 10）

把"一帧 ≡ 截图 + 编号 DOM + 意图 + 操作进度"这个**帧契约**，连同"判定只回编号、绝不给选择器"的**判定接缝**，落地成一套可跑、可测、可归档的管道。判定由外部的 **Laya / JEV** 判定服务承担（见下），循环由本插件驱动。

**四个工具**（宿主侧 `defineTool`，判定请求从插件进程发 HTTP，不经过 agent 会话）：

| 工具 | 干什么 | 何时用 |
|---|---|---|
| `bcdp_jev_status` | **先跑这个**：判定链可用性 + 配置体检，**不发任何请求** | 怀疑配置/链路问题时第一步 |
| `bcdp_jev_frame` | 采一帧（截图 + 编号候选 + 意图），看判定器会看到什么 | 调试帧内容、核对候选编号 |
| `bcdp_jev_ask` | 组装请求体；`dryRun` 默认 true，可指定 `round=control\|chapter\|pick\|evaluate` 逐级看，确认无误再发 | 想先看清楚判定请求再发 |
| `bcdp_jev_run` | 跑整条循环，返回逐步 trace（每步的候选数 / top / 预算 / 命中） | 真要让它动手 |

**默认链路是 `laya → rule`**。JEV 目前无法注册，所以默认不写它；将来可用时把 `jev` 加回 `judgePrefer` 跳序并填 `jevUrl` 即可。`bcdp_jev_status` 在缺 key 时会主动打印本地起法（`ENGINE=laya … uvicorn laya_api.main:app`，端口 **8000** 而非 7789，`ALLOW_DEV_LOGIN=true` 建 key）。不可用的跳**跳过不调用**（laya 强制鉴权无匿名分支，缺 key 必然 401），每一跳的跳过与失败都进 trace，绝不静默回落；`refuse` 是结果不是异常。

**三级缩小（让 LLM 把控进程，而不是一次猜全部）**：
1. `control` —— 要不要动手（固定 5 项：`pick_button` / `sleep` / `next` / `prev` / `done`）；
2. `chapter` —— 哪个章节（按 AX 容器聚簇，从 `childIds` 父链挑最近的结构化祖先，如 `form#1` / `form#2`；单章节时此轮跳过）；
3. `pick` —— 章节内选哪个编号 + 一个风险度 `score`。

分章节不是装饰：阈值按候选数分桶，**把 20 选 1 拆成「几选 1 × 几选 1」会让两轮都落进更严的桶**（`top≥0.5` 且 `top−second≥0.15`），比一次性 20 选 1（`top≥0.6`）更可控。判定器**只回编号**，坐标/选择器由执行层每次重新量（`DOM.getBoxModel` + 点击前 `DOM.getNodeForLocation` 命中复核），帧里的矩形绝不作为点击依据。

**判定上下文是隔离的**：只允许 `INTENT` / `PROGRESS` / `FRAME` / `HISTORY` 四段，**绝不带 agent 会话 session 前缀**；多出任何一段都在组装时直接抛错（不靠约定，靠断言）。`PROGRESS`（步数 / 各章节尝试与结果 / 真正成功过的动作 / 剩余预算）由循环自己**机械生成**，不让模型写——模型写的进度是第二难发现的幻觉通道。

**评估开关 `jevEvaluate`（默认开，设置面板可关）**：每一步执行后，判定器再判一遍进度是 `inprogress` / `done` / `fail`。`fail` 或「未验真的 done」不猜下一步，而是**升级为 `escalate`**——带一组有序的 `RecoveryOption`（如先 `reload` 刷新，因为陈旧渲染会藏住已写入的确认），交回 LLM 决定恢复还是停手。

**循环终止态**：`done`（对照 `successCriteria` 自验）/ `blocked`（预算拦）/ `exhausted`（预算耗尽，带 `exhaustedKind`）/ `stuck`（同锚同动作连续 3 次无变化）/ `unavailable`（无判定器）/ `error` / `escalate`。

> 现状诚实记录：本阶段已证明**协议、阈值、终止、分章节、组装、隔离**正确（`bcdp_jev_*` 单测覆盖），但**尚未在真实浏览器上端到端跑过**（T10.22 待做）；判定**准确率**未经实测（阈值分桶是标定用的，不是选得对的证明）。存档的被操作元素会保留 `class` 等定位特征（只剥离检视器外壳 token），供 escalate 时回传给 LLM 恢复。

## 开发

源码在 `src/`（TypeScript），构建产物在 `lib/`（host + client bundle）与 `bin/cdp-cast-worker.mjs`（worker bundle）。

```sh
pnpm typecheck   # tsc 类型门禁（tsconfig.json 主 + tsconfig.client.json 客户端）
pnpm test        # vitest 单元测试
pnpm run build   # tsdown 三 bundle：lib/index.js + lib/client.js + bin/cdp-cast-worker.mjs
```

> 直接改 `src/`（`src/index.ts` 工具层、`src/client/index.ts` 前端、`src/worker/cdp-cast-worker.ts` worker）。新工具在 `registerActionTools` 里按 `t({...})` 加，并在 `ego_help` 索引（`src/help.ts`）补一条，跑 `pnpm typecheck && pnpm test && pnpm run build`。`lib/` 与 `bin/cdp-cast-worker.mjs` 是构建产物（预构建入库），不要手改。

`node_modules/` 仅含指向 DSH checkout 的符号链接（编译期类型解析）；运行时由 harness 解析 `@deepseek-ai/dsh-tools`。

## 已知限制（诚实说明）

- **Windows**：插件层已做 v0.4.0 适配；底层 ego-lite 宿主仍是非 Windows 官方支持的社区移植，复杂多步流程稳定性可能弱于 macOS。
- **FFmpeg 平台捕获**：Windows 已使用 `gfxcapture(HWND)`，需要包含该 filter 的新构建；PATH 中的旧 FFmpeg 会被跳过并提示下载兼容版本。Linux 使用 `x11grab`、macOS 使用 `avfoundation` display crop；macOS ScreenCaptureKit、Wayland Portal helper 属后续增强。
- **安装环境**：本仓库的 DSH peer 包不全在公共 npm registry。普通 `pnpm install` 可能在解析 `@deepseek-ai/*` peer 时失败；DSH profile 安装应提供这些 peer。CDP 不依赖 FFmpeg，也不会在插件安装阶段下载二进制。
- **快照质量**：Linux 用 CDP `DOMSnapshot` 重建语义树，非 macOS 内核级，复杂 iframe/画布场景可能降级。
- **宿主可靠性（Linux）**：未合并的社区 PR，跨 CLI 调用间可能丢 tab/空间状态；插件已内置防御，简单流程稳定，复杂流程可能需重试。
- **登录态持久化**：Chrome 运行期 Cookie 仅优雅关闭时落盘，强杀重启需重登。
- 输出 schema 为宽松 `additionalProperties: true`，客户端以实际返回值为准。

## 许可与署名

插件本体 MIT。内置运行时嵌入 ego-lite 的 MIT 代码；可选下载的 FFmpeg 构建涉及 GPL-3.0-or-later 义务。使用或再分发前请阅读构建来源的许可证与源码获取信息，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 供应链与权限说明

为目录收录与审查提供的确定性事实：

- **运行文件**：`lib/`（构建产物，由 `npm run build` 从 `src/` TypeScript 以 tsdown 确定性生成）、`bin/`（worker 与 ffmpeg-probe 的可执行入口脚本）、`cordis.patch.yml`（装配层）、`dsh-plugin.json`（manifest）。`*.map` 仅为调试用 sourcemap，不参与运行，已声明排除。
- **原生/可执行工件**：`runtime/` 内置 ego-lite 运行时（MIT，来源与逐文件清单见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）——它是本插件的核心功能（自带受管 Chrome/CDP 宿主），属有意携带的可执行工件，非构建副产物。`runtime/PATCHES.md` 记录对上游的全部本地补丁。
- **依赖**：运行时依赖仅 `@deepseek-ai/schemastery`（由 DSH 宿主提供对等实现）；peer 依赖全部为 `@deepseek-ai/dsh-*` 宿主服务。客户端 bundle 的外部模块由宿主模块表解析，不携带 npm 运行时依赖。
- **外部服务**：无遥测、无外部 API 调用。唯一的网络行为是**可选的** FFmpeg 安装器按用户指令从 GitHub（或用户配置的镜像）下载构建件，来源校验与许可义务见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- **失败边界**：宿主无 webServer（TUI/headless）时 watch 路由安全跳过；worker 启动失败时 watch 路由返回 `ok:false` 的 JSON 而非挂起；浏览器进程随宿主 teardown 一并终止（`--stop` fire-and-forget，不阻塞宿主退出）。
- **权限**：manifest `permissions` 为空——工具集的文件读写被限定在 ego 自管的空间目录与用户工作区，网络访问经由受管的 agent 浏览器而非宿主进程。

---

## 友链

同为 DeepSeek Harness 插件生态的作品，互相安利：


