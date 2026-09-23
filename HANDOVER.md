# 交接说明（HANDOVER）— dsh-browser-cdp

> 面向：接管本插件的下一任维护者 / 从旧 `dsh-ego-browser` 迁移的用户。
> 当前版本：**v0.10.0**（仓库 `drscrewdriver/dsh-browser-cdp`，MIT，血缘上游 `Fisfzy/ego-browser`）。

## 1. 新 namespace 与身份

| 项 | 值 |
|---|---|
| 包名 / 插件 id | `dsh-browser-cdp` |
| 设置 namespace（`SETTINGS_NAMESPACE`） | `dsh-browser-cdp` |
| 侧栏 Tab id | `dsh-browser-cdp:watch` |
| 工具命名 | **保留 `ego_*` 前缀**（32 个），有意不改（T1.7–T1.10 是"血统隐藏第二阶段"，另立任务） |
| 环境变量 | `EGO_LINUX_CDP_URL`（激活端点注入）、`EGO_LINUX_CURSOR`/`EGO_LINUX_CURSOR_NAME`（光标 HUD） |

## 2. 回退到旧插件（dsh-ego-browser）

1. profile 的 `package.json`：依赖键改回 `"dsh-ego-browser": "github:Fisfzy/ego-browser"`（或原 tag），并同步改 `dsh.profile.bundles` 条目——**两处都要改**，否则 boot 校验挂恢复模式。
2. `dsh plugin --profile <p> add github:Fisfzy/ego-browser` 装回旧包。
3. **两个名字不能同时装**：旧新注册完全同名的 `ego_*` 工具，第二个会撞 `already registered` 打挂整个 profile boot（v0.9.0 发布当天实测）。
4. 设置数据在 `~/.dsh/settings.yaml` 的 `dsh-browser-cdp:` 块，回退后旧插件读不到它（namespace 不同），需手动迁移或重配。

## 3. 远端 Chrome 侧要求

- Chrome/Edge 以 `--remote-debugging-port=<port>` 启动；**`--remote-debugging-address` 需绑定到非 loopback 地址**才能被局域网内主机访问（本机开发验证用的是 `192.168.100.25:9223`）。
- ⚠️ **风险提示**：该调试端口**无鉴权 = 整台浏览器连同全部登录态对局域网开放**。只在可信网络使用，用完关闭。
- 面板端点只允许 `http(s)://host:port` 或 `ws(s)://…`；探测走 `/json/version` → `webSocketDebuggerUrl`。

## 4. 关键架构地图（v0.10.0）

- `src/cdp/`：endpoint（解析/发现，8 错误码）· session（常驻长连接：id 配对/超时/退避重连/**重连后重放 enable 序列**）· events（域亲和 + `DOM.enable→Overlay.enable` 顺序）· dom / input / page · marks（Set-of-Marks）。
- `src/worker/`：`ego-cast-worker`（常驻 worker：观察窗流 + per-target 会话）· `pick-channel`（点选模式，跑在 worker 常驻连接上）· `pick-ui`（注入式选中框 + 浮条，`Runtime.addBinding('__dshPickAction')` 回传）。
- host：`cast-server.ts`（worker 生命周期 + `/api/ego/*` 路由族）；`gateway.ts`（`/ego/api/*` 设置网关 + cdp-status/refresh/probe）。
- 真机探针：`CDP_PROBE_URL=http://host:port node node_modules/vitest/vitest.mjs run tests/cdp-probe/remote.probe.test.ts`（默认自跳过）。

## 5. 已知边界

- **M1.6 投递未接**：页面浮条「✓ 已传输到对话」是 UI 状态；写入对话输入框（`conversation.input.for(actx).setDraft/submit`，接缝见计划 findings A.3）未完成。点选结果可经 `GET /api/ego/pick` 的 `lastPick`/`lastAction` 观测。
- `ego_screenshot` 的 `marks` 参数未接（工具是 buildScript 模型，marks 是 worker HTTP 模型，需非脚本工具路径）。
- 本地启动器（M0.9 / `allowLocalFallback`）声明了配置但未接线。
