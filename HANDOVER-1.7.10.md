# 交接：dsh-browser-cdp 1.7.10 — Tabbit 通道观察窗修复

日期：2026-11-04 06:02
状态：**源码已修、已提交、已打包；尚未安装到宿主、尚未实机验证面板渲染。**
接手方需要做的是「装包 + 重启 + 看面板」这三步，以及决定是否继续优化帧率。

---

## 1. 交付物

| 项 | 值 |
|---|---|
| 仓库 | `E:\test\rewrite-agently\mine-dsh-plugins\dsh-browser-cdp` |
| 分支 / HEAD | `main` @ `336fb13` |
| 版本 | `1.7.10`（`package.json` 与 `dsh-plugin.json` 已同步） |
| 包 | `dsh-browser-cdp-1.7.10.tgz`（539,526 字节） |
| SHA256 | `7FAC58AA9BBB3A4933A45D6A01C3B29E41B884632CEEC3C6D50E14469C921A52` |
| 工作树 | clean（tgz 已被 `.gitignore` 覆盖，不入库） |

两次提交：

- `2a463df` — 落盘原本未提交的 tabbit-cli link 后端（`src/cdp/tabbit-cli-link.ts`、`src/types.ts`、`src/config.ts`、`src/client/*`、`src/cdp-targets.ts`、`src/cdp/capabilities.ts`、`src/cast-server.ts` 等）+ 修帧投递与 `bcdp_screenshot`
- `336fb13` — 修 `--timeout-ms` 契约与截图无截止

---

## 2. 修了什么（四个真缺陷，都是实测发现的）

### ① 帧回执被降级成 `resource`，然后被静默丢掉（面板空白的直接原因）

`tabbit-cli` 对 `nodejs` 返回值有内联阈值，超过就降级为 `resource`：

```json
{"type":"resource","resourceId":"result-...","byteLength":1329226}
```

**没有 `value` 字段**。而帧轮询器把整张截图 base64 塞进回执（视口 PNG 约 1.3 MB、JPEG q45 仍有 0.42 MB），于是 `receipt.data.base64 === undefined` → 什么也不推送。
更糟的是 `status` 仍是 `succeeded`，而旧代码只在 `!receipt.ok` 时告警 → **面板空白且零日志**。

修法：截图字节不再走回执。snippet 内 `fs.writeFileSync` 落盘，回执只带路径（几十字节，稳定内联），host 侧 `readFileSync` 后 `broadcastCliFrame`。

### ② `--timeout-ms` 是硬契约：60000–180000，超出整请求被拒

CLI 原话：

```
--timeout-ms must be from 60000 through 180000; the default is 60000,
so omit it unless the program needs longer
```

而轮询器传的是 `10000` / `15000` → `REQUEST_FAILED`，**snippet 根本没执行**。
也就是说：即使 ① 修好，轮询也从未真正跑过一次。这个拒绝以普通 failed 回执出现，看起来像抓图失败而不是用法错误，所以极易误判。

修法：在 `runTabbitSnippet` 一处夹紧（超范围夹到最近合法值，未传则省略走 CLI 默认 60s）；短截止改由 snippet 内 `Promise.race` 表达。

### ③ 截图本身不可靠，必须在 snippet 内设截止

同一个 tab 可以 132 ms 返回，也可以**永不返回**。不设截止时，未应答的 send 会把整个 evaluation 拖到 CLI 硬截止（60s），**并连带杀掉该 task 的执行器**，污染该 task 后续所有调用（实测见 `EVALUATION_TIMEOUT` + `taskTerminated:true`）。

修法：`TABBIT_CAPTURE_DEADLINE_MS`（默认 8000），超时返回 `{skipped:"capture-timeout"}` 而非挂死；`bcdp_screenshot` 对此给出明确失败文案。

### ④ 轮询必须带 `--tab`

不带 `--tab` 时 CLI 跑的是任务的**默认页**（全新 `about:blank`）：截图永远是空页，且空页会把 CLI 拖到 60s 硬截止。
`_tabbitLastActiveTabId` 原本「赋值但从不读取」（源码注释谎称「frame poller 用它截正确的页」）。现在：
`TabbitReceipt` 新增 `tabIds`，从 `result.acquisition.tabIds` 提升（它和 `result.value` 平级，旧解析把它丢了）；每个 tabbit 工具调用后记录；轮询优先用它，回落到库存里 `active: true` 的 tab。

---

## 3. 附带改动

- `TABBIT_CAPTURE_DEADLINE_MS` 之外，`broadcastCliFrame` 新增可选 `fmt`（JPEG 帧必须标 `jpeg`，否则客户端按 `data:image/png` 装 JPEG 字节，表现为花屏）。
- `TabbitTab` 类型补上 CLI 实际字段 `tabId` / `active`（原类型写的是 `id`、丢了 `active`，调用方只能穿 `any`）。
- 一轮截图未返回时跳过下一 tick（`tabbitFrameInFlight`）。
- `receipt.ok` 但无路径 → 明确 `warn`，不再静默。
- 持续的 `skipped` 原因只打一次 `info`（`tabbitFrameSkipLogged`），避免每 3s 刷屏。
- `findLink` / `resolveEffectiveLink` 对缺失的 links 列表返回 `null` 而非抛错（两者现在跑在每个工具调用与轮询 tick 上）。
- `bcdp_screenshot` 现在返回 `{path, base64, bytes, url, title}`，`path` 与工具描述一致（原来返回 `base64: "[object Object]"`）。

---

## 4. 验证到哪一步了（重要，别当已完成）

**已验证：**

- 单测：`tests/tabbit-cli-link.test.ts` 19 例通过。
- 全量：**945 passed / 13 skipped**（69 个文件，63 通过 / 6 skip）。
- `npm run typecheck` 双配置无错。
- 打包内容核验：两处版本号均为 `1.7.10`、新代码在包内、坏的 `timeoutMs: 15000` 已不存在、`.map` 已排除、无源码路径泄漏。
- **实机 snippet 验证（百度 SERP tab，带截止的成品 snippet）：**
  ```
  status=succeeded  elapsedMs=8228  bytes=302972
  JPEG 魔数 FF D8 FF E0，结束标记 FF D9
  ```

**尚未验证（接手方要做）：**

1. 包没装到宿主，宿主没重启 → 运行中的插件仍是旧的。
2. **面板是否真的出画面没看过**。这是本次修复的最终验收点，不能用「回执 ok」代替。
3. 轮询链路在真实 DSH 会话里跑满若干 tick 的行为没观测过。

---

## 5. 已知限制（交接必读，别当成 bug 报）

**帧率远达不到 3 秒一帧。** 实测一次成功抓取耗时 8228 ms，已经贴着 8 s 截止线——在 tab 争用 / 重页面下，抓一帧接近 8 秒。所以：

- 观察窗实际刷新率约「**8 秒一帧**」，不是 3 秒。
- `tabbitFrameInFlight` 守卫生效时，多数 tick 会被跳过，属预期行为而非卡死。

若要真做到 3 秒一帧，需要：降视口尺寸 / 降 JPEG 质量 / 或改走 screencast 通道。**这是后续优化项，本次刻意不做。**

另一个边界：`Page.captureScreenshot` 在本运行时的速度不可预测（132 ms 到永不返回都有）。8s 截止只是把「挂死」降级为「这一帧没有」，不能保证一定有帧。

---

## 6. 接手方操作步骤

```powershell
# 1) 装包（按本仓既有标准命令，别自创）
cd E:\test\rewrite-agently\mine-dsh-plugins\dsh-browser-cdp
#    → 用 dsh 插件的标准安装/替换流程装载 dsh-browser-cdp-1.7.10.tgz

# 2) 重启宿主，让新 lib 生效
# 3) 触发一次 bcdp_* 操作建立 task 归属（否则 polling 会因 _tabbitLastTaskName 为空而跳过）
# 4) 打开侧栏「CDP 浏览器」面板，确认出画面

# 5) 若仍空白，按这个顺序查（不要跳步）：
#    a. 宿主日志里有无 "tabbit frame skipped"
#    b. 有无 "tabbit frame receipt carried no path"
#    c. 有无 "tabbit frame capture failed"
#    d. 都无 → 说明 tick 根本没进（查 egoLockBusy / 链路是否 tabbit / _tabbitLastTaskName 是否为空）
```

**验收标准**：面板出现真实页面画面（非占位文案），且能随页面变化更新。仅「日志无报错」不算通过。

---

## 7. 排查时踩过的坑（供参考）

- `tabbit-cli` 的 `tabs` 输出里，标识字段是 **`tabId`** 不是 `id`，当前 tab 标记是布尔 **`active`**；`windowId` 全部相同（agent 无法开独立 OS 窗口）。
- tab 归属按 task 隔离；task 空闲 90s 过期释放，`retainedTabIds` 确认 tab 仍在但需重新 `--tab` 接管。会撞 `TAB_OWNERSHIP_CONFLICT: A requested tab is owned by another session`。
- 用 PowerShell 把 `--request-id "xxx"` 塞进 `cmd /c` 时引号会被当字面量传进去，导致 CLI 报 usage 错误；用变量拼接避免。
- `tabbit-cli resource --task <t> --resource <id>` 可把降级后的 `resource` 取回来（用于取证，不要用生产走法）。

---

## 8. 需要你决定的事

1. **是否现在就装包重启验证**（我建议是，否则本次修复等于没交付）。
2. **是否要我把帧率优化做完**（降视口/质量，或评估 screencast 通道）——我倾向先验证面板能出画面，再决定值不值得优化。
3. 是否需要我同步发 npm / 打 tag（本次只打包，未发布）。
