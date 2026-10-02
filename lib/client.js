window.__ModuleLoader__.load({ id: "dsh-browser-cdp", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

//#region src/client/locales.ts
/**
* Plugin-owned i18n dictionaries (named-export style).
*
* `zh` is the key-set source of truth: every key carries the CURRENT Chinese
* value shipped in the UI (watch panel strings from the old `watchZh`,
* settings-card field/group strings from the old inline `FAM_FIELD_GROUPS`
* en/zh pairs, and the strings that used to be hardcoded). `en` mirrors the
* former `watchEn` values exactly. Every other language is typed as
* `Record<CdpKey, string>`, so a missing or extra key is a COMPILE error,
* not a runtime fallback to the raw key.
*
* Registered through the DSH `locale` service in ONE `register(NS, dictionaries)`
* call (the untyped overload accepts any BCP-47-style id), so all nine
* languages activate together. Placeholders (`{n}`, `{status}`) are kept
* verbatim in every dictionary.
*/
/** The namespace owned by this plugin. */
const NS = "dsh-browser-cdp";
/** Simplified Chinese dictionary — the key-set source of truth. */
const zh = {
	"title": "CDP 浏览器",
	"titleLive": "CDP 浏览器 · 实时",
	"liveView": "只读观察窗",
	"pinned": "已固定查看",
	"realtime": "正在实时浏览",
	"noScreenshot": "（暂无截图 — about:blank 或浏览器未渲染）",
	"noActivePages": "暂无活跃浏览器页",
	"noActiveHint": "当 agent 开始用 bcdp_* 操作网页时，这里会实时显示",
	"openExternal": "⧉ 打开真实页",
	"raiseWindow": "弹出窗口",
	"raiseWindowHint": "把 agent 浏览器弹出为真实窗口（无头实例会被同 Profile 的有头实例替换，标签页保留）",
	"pickMode": "选择元素",
	"pickModeHint": "在实时页面里点选一个元素，引用到对话",
	"picking": "点选中…请点击页面里的元素",
	"picked": "已捕获元素",
	"pickFailed": "点选失败",
	"pickQuoted": "✓ 已引用到输入框",
	"pickDeliverFailed": "投递失败",
	"noUrl": "无可打开的地址",
	"closeTab": "关闭标签",
	"newTab": "(新标签页)",
	"history": "历史浏览轨迹",
	"historyHide": "收起历史轨迹",
	"historyShow": "历史浏览轨迹",
	"noHistory": "暂无浏览记录",
	"current": "当前",
	"refresh": "刷新",
	"backToLive": "← 返回实时",
	"dragHint": "拖动移动面板",
	"loginTitle": "需要账号登录时，请到桌面上那个 「CDP 浏览器代理」 Chrome 窗口完成登录。",
	"loginBtn": "已登录，保存",
	"loginSaving": "保存中…",
	"loginSaved": "已保存 {n} 条会话",
	"loginNotConnected": "未连接浏览器",
	"loginFailed": "保存失败",
	"loginDismiss": "关闭提示",
	"captchaTitle": "⚠️ 检测到人机验证",
	"captchaHint": "请在桌面那个 「CDP 浏览器代理」 浏览器窗口手动完成验证，agent 会继续。",
	"captchaDismiss": "关闭提示",
	"hintReset": "已复位 · 滚轮滚动页面 · Ctrl+滚轮缩放 · 双击复位",
	"hintPan": "Ctrl+滚轮缩放 · Ctrl+拖动平移 · 双击复位",
	"hintScroll": "Ctrl+拖动平移 · 滚轮滚动页面",
	"hintNotCaptured": "画面未接管 · 本次操作未送达 · 再点一次即可恢复",
	"failed": "失败",
	"stale": "⚠ 未接管",
	"captured": "已接管",
	"fabTitle": "CDP 浏览器实时视图",
	"settingsTitle": "展开设置",
	"settingsHide": "收起设置",
	"famTitle": "CDP 浏览器",
	"famIsolate": "空间隔离",
	"famIsolateDesc": "关 = 持久化配置（重启保留登录态）；开 = 每次隔离沙箱",
	"famIdle": "空闲自动停止（分钟，0 = 不停）",
	"famIdleDesc": "超过 N 分钟没有 bcdp_* 调用即停止后台浏览器，下次调用按需重启",
	"titleIdle": "Agent 浏览器",
	"videoUnsupported": "当前浏览器不支持此 H.264 流",
	"videoDisconnected": "视频流已断开",
	"videoConnectFailed": "视频流连接失败 ({status})",
	"gBasic": "基础",
	"gCapture": "截图与推流",
	"gJudge": "评审（JEV / Laya）",
	"cdpMode": "连接模式",
	"cdpModeDesc": "auto = 只用已激活目标；remote = 绝不静默启动本地浏览器；local = 始终本地控制",
	"remoteEnabled": "远程接管总开关",
	"remoteEnabledDesc": "关 = 目标序列保留但不生效；不影响 local 模式",
	"allowLocalFallback": "auto 模式允许本地回退",
	"allowLocalFallbackDesc": "已激活目标不可达时允许自动拉起本地浏览器",
	"chromePath": "Chrome/Chromium 路径",
	"chromePathDesc": "留空 = 自动探测",
	"localHeadless": "本地浏览器无头启动",
	"localHeadlessDesc": "仅作用于本地拉起的浏览器",
	"localUserDataDir": "本地浏览器 Profile 目录",
	"localUserDataDirDesc": "留空 = 托管目录；不要指向日常使用的 Chrome 配置",
	"legacyEgoToolNames": "同时注册旧版 ego_* 工具名",
	"legacyEgoToolNamesDesc": "给 bcdp_* 更名前的脚本用；与上游 ego-browser 插件互斥",
	"captureBackend": "截取后端",
	"captureBackendDesc": "auto / cdp / ffmpeg",
	"streamProfile": "画质档位",
	"streamProfileDesc": "整体画质预设",
	"cdpFps": "CDP 预览帧率",
	"cdpQuality": "CDP JPEG 质量",
	"cdpMaxWidth": "CDP 帧最大宽度",
	"cdpBackstopIntervalMs": "CDP 恢复截图间隔（ms）",
	"ffmpegFps": "FFmpeg 视频帧率",
	"ffmpegMaxWidth": "FFmpeg 最大宽度",
	"ffmpegBitrateKbps": "FFmpeg 码率（kbps）",
	"ffmpegEncoder": "FFmpeg H.264 编码器",
	"ffmpegPath": "FFmpeg 路径",
	"ffmpegPathDesc": "留空 = 探测 PATH 或托管安装",
	"cursorHud": "截图绘制光标 HUD",
	"cursorName": "光标 HUD 名称",
	"githubMirror": "GitHub 下载镜像",
	"githubMirrorDesc": "托管下载时替换 https://github.com 的 HTTPS 前缀",
	"runtimeArgs": "运行时附加参数",
	"runtimeArgsDesc": "追加到托管运行时 argv；下次 bcdp_* 调用生效",
	"chromeArgs": "Chrome 附加启动参数",
	"chromeArgsDesc": "追加到 Chrome 启动 argv；下次冷启动生效",
	"judgePrefer": "评审跳序",
	"judgePreferDesc": "逗号分隔；默认 \"laya,rule\"",
	"jevUrl": "JEV 基础 URL",
	"jevUrlDesc": "留空 = 跳过 jev 跳",
	"jevKey": "JEV Bearer Key",
	"jevKeyDesc": "留空 = 跳过 jev 跳",
	"jevModel": "JEV 模型名",
	"jevChunkSize": "JEV 每轮候选上限",
	"jevMaxImageBytes": "JEV 单帧字节预算（0 = 不限）",
	"jevHistoryLimit": "JEV 近期步数窗口",
	"jevArchiveImage": "归档包内嵌截图",
	"jevEvaluate": "每步动作都过评审",
	"jevEvaluateDesc": "每步多花一次评审调用",
	"jevStepBudget": "单次 bcdp_jev_run 轮数上限",
	"jevWallMs": "单次运行墙钟上限（ms）",
	"layaUrl": "Laya 基础 URL",
	"layaUrlDesc": "sidecar 服务 8000 端口",
	"layaKey": "Laya Key（必填）",
	"layaKeyDesc": "无 Key 必然 401",
	"layaModel": "Laya 模型名",
	"linksTitle": "连接目标（顺序即优先级）",
	"linksEmpty": "暂无目标——用下方表单添加第一个连接目标",
	"linksEnabled": "启用",
	"linksActive": "已激活",
	"linksAddCdp": "添加 CDP 端点",
	"linksAddCli": "添加本机 ego CLI",
	"linksAddCliExists": "本机 ego CLI 连接已存在——仅限本机，一台机器只允许一条",
	"linksEndpoint": "端点",
	"linksEndpointHint": "http(s)://主机:端口 或 ws(s)://…",
	"linksEndpointInvalid": "端点无效，未保存",
	"linksCliPath": "ego CLI 路径",
	"linksCliPathHint": "留空 = 自动检测（PATH → 应用包 → 内置运行时）",
	"linksLabel": "标签",
	"linksRemove": "删除",
	"linksMoveUp": "上移",
	"linksMoveDown": "下移",
	"linksProbe": "探测",
	"linksProbing": "探测中…",
	"linksProbeOk": "可达",
	"linksProbeFail": "不可达",
	"linksLimitReached": "连接序列最多 {n} 条",
	"linksWriteFailed": "保存失败——设置层拒绝了这次写入",
	"linksCliRemoteWarn": "cdpMode=remote 时激活 ego CLI 会报 mode-kind-mismatch",
	"linksCliSdk": "使用内置 harness",
	"linksDisabledHint": "已停用——先勾选启用才能激活",
	"linksLocalRow": "本机 Chrome（受管启动）",
	"linksLocalEnableHint": "勾选 = 允许 auto 模式在激活目标不可达时回落本机启动",
	"linksActivate": "激活"
};
/** English dictionary, checked complete against the zh key set. */
const en = {
	"title": "Agent Browser",
	"titleLive": "Agent Browser · Live",
	"liveView": "Live view",
	"pinned": "Pinned",
	"realtime": "Live",
	"noScreenshot": "(no screenshot — about:blank or browser not rendering)",
	"noActivePages": "No active browser pages",
	"noActiveHint": "Pages will appear here as the agent browses with bcdp_*",
	"openExternal": "Open real page",
	"raiseWindow": "Pop out window",
	"raiseWindowHint": "Raise the agent browser as a real window (a headless instance is replaced by a visible one on the same profile)",
	"pickMode": "Pick element",
	"pickModeHint": "Click an element in the live page to quote it into the conversation",
	"picking": "Picking… click an element in the page",
	"picked": "Element captured",
	"pickFailed": "Pick failed",
	"pickQuoted": "✓ Quoted to composer",
	"pickDeliverFailed": "Delivery failed",
	"noUrl": "No URL to open",
	"closeTab": "Close tab",
	"newTab": "(new tab)",
	"history": "Browsing history",
	"historyHide": "Hide history",
	"historyShow": "Show history",
	"noHistory": "No browsing history",
	"current": "current",
	"refresh": "Refresh",
	"backToLive": "← Back to live",
	"dragHint": "Drag to move panel",
	"loginTitle": "Log in via the CDP browser bridge window on your desktop",
	"loginBtn": "Logged in, save",
	"loginSaving": "Saving…",
	"loginSaved": "Saved {n} sessions",
	"loginNotConnected": "Browser not connected",
	"loginFailed": "Save failed",
	"loginDismiss": "Dismiss",
	"captchaTitle": "⚠️ CAPTCHA detected",
	"captchaHint": "Complete verification in the CDP browser bridge window; the agent will continue.",
	"captchaDismiss": "Dismiss",
	"hintReset": "Reset · scroll to pan · Ctrl+scroll to zoom · double-click to reset",
	"hintPan": "Ctrl+scroll to zoom · Ctrl+drag to pan · double-click to reset",
	"hintScroll": "Ctrl+drag to pan · scroll to pan",
	"hintNotCaptured": "Not captured · operation not delivered · click again to recover",
	"failed": "failed",
	"stale": "⚠ Not captured",
	"captured": "Captured",
	"fabTitle": "Agent Browser live view",
	"settingsTitle": "Show settings",
	"settingsHide": "Hide settings",
	"famTitle": "CDP Browser",
	"famIsolate": "Space isolation",
	"famIsolateDesc": "Off = persistent profile (logins survive restarts); on = isolated sandbox",
	"famIdle": "Auto-stop idle browser (minutes, 0 = off)",
	"famIdleDesc": "Stops the backing browser after N minutes without a bcdp_* call; relaunches on demand",
	"titleIdle": "Agent Browser",
	"videoUnsupported": "This browser does not support this H.264 stream",
	"videoDisconnected": "Video stream disconnected",
	"videoConnectFailed": "Video stream connection failed ({status})",
	"gBasic": "Basics",
	"gCapture": "Capture & streaming",
	"gJudge": "Judgement (JEV / Laya)",
	"cdpMode": "Connection mode",
	"cdpModeDesc": "auto = activated target only; remote = never start a local browser; local = always local control",
	"remoteEnabled": "Remote attach master switch",
	"remoteEnabledDesc": "Off = the target sequence is preserved but inert; does not affect local mode",
	"allowLocalFallback": "Allow local fallback in auto mode",
	"allowLocalFallbackDesc": "auto may launch a local browser when the activated target is unreachable",
	"chromePath": "Chrome/Chromium path",
	"chromePathDesc": "Empty = auto-detect",
	"localHeadless": "Launch local browser headless",
	"localHeadlessDesc": "Applies to the locally launched browser",
	"localUserDataDir": "Local profile dir",
	"localUserDataDirDesc": "Empty = managed dir; never point at your daily Chrome profile",
	"legacyEgoToolNames": "Also register legacy ego_* tool names",
	"legacyEgoToolNamesDesc": "For scripts written before the bcdp_* rename; conflicts with the upstream ego-browser plugin",
	"captureBackend": "Capture backend",
	"captureBackendDesc": "auto, cdp, or ffmpeg",
	"streamProfile": "Capture quality profile",
	"streamProfileDesc": "Overall quality preset",
	"cdpFps": "CDP preview FPS",
	"cdpQuality": "CDP JPEG quality",
	"cdpMaxWidth": "CDP frame max width",
	"cdpBackstopIntervalMs": "CDP recovery interval (ms)",
	"ffmpegFps": "FFmpeg video FPS",
	"ffmpegMaxWidth": "FFmpeg max width",
	"ffmpegBitrateKbps": "FFmpeg bitrate (kbps)",
	"ffmpegEncoder": "FFmpeg H.264 encoder",
	"ffmpegPath": "FFmpeg path",
	"ffmpegPathDesc": "Empty = detect PATH or managed install",
	"cursorHud": "Draw cursor HUD into screenshots",
	"cursorName": "Cursor HUD label",
	"githubMirror": "GitHub download mirror",
	"githubMirrorDesc": "HTTPS base replacing https://github.com for managed downloads",
	"runtimeArgs": "Extra runtime args",
	"runtimeArgsDesc": "Appended to the vendored runtime argv; next bcdp_* call",
	"chromeArgs": "Extra Chrome args",
	"chromeArgsDesc": "Appended to the Chrome launch argv; next cold start",
	"judgePrefer": "Judge hop order",
	"judgePreferDesc": "Comma separated; defaults to \"laya,rule\"",
	"jevUrl": "JEV base URL",
	"jevUrlDesc": "Leave empty to skip the jev hop",
	"jevKey": "JEV bearer key",
	"jevKeyDesc": "Empty = the jev hop is skipped",
	"jevModel": "JEV model",
	"jevChunkSize": "JEV candidates per round",
	"jevMaxImageBytes": "JEV frame byte budget (0 = unbounded)",
	"jevHistoryLimit": "JEV recent-step window",
	"jevArchiveImage": "Embed screenshot in archived bundle",
	"jevEvaluate": "Evaluate every action with the judge",
	"jevEvaluateDesc": "Costs one judgement call per action",
	"jevStepBudget": "Rounds per bcdp_jev_run",
	"jevWallMs": "Wall-clock ceiling per run (ms)",
	"layaUrl": "Laya base URL",
	"layaUrlDesc": "The sidecar serves 8000",
	"layaKey": "Laya key (required)",
	"layaKeyDesc": "Keyless calls are a guaranteed 401",
	"layaModel": "Laya model",
	"linksTitle": "Connection targets (order = priority)",
	"linksEmpty": "No targets yet — add the first one with the form below",
	"linksEnabled": "Enabled",
	"linksActive": "active",
	"linksAddCdp": "Add CDP endpoint",
	"linksAddCli": "Add local ego CLI",
	"linksAddCliExists": "The local ego CLI link already exists — local-only, one per machine",
	"linksEndpoint": "Endpoint",
	"linksEndpointHint": "http(s)://host:port or ws(s)://…",
	"linksEndpointInvalid": "Invalid endpoint — not saved",
	"linksCliPath": "ego CLI path",
	"linksCliPathHint": "Empty = auto-detect (PATH → app bundle → bundled runtime)",
	"linksLabel": "Label",
	"linksRemove": "Remove",
	"linksMoveUp": "Move up",
	"linksMoveDown": "Move down",
	"linksProbe": "Probe",
	"linksProbing": "Probing…",
	"linksProbeOk": "reachable",
	"linksProbeFail": "unreachable",
	"linksLimitReached": "The sequence is capped at {n} entries",
	"linksWriteFailed": "Save failed — the settings layer rejected this write",
	"linksCliRemoteWarn": "Activating an ego CLI link under cdpMode=remote fails with mode-kind-mismatch",
	"linksCliSdk": "Use bundled harness",
	"linksDisabledHint": "Disabled — enable it before activating",
	"linksLocalRow": "Local Chrome (managed)",
	"linksLocalEnableHint": "Checked = auto mode may fall back to the managed local browser when the activated target is unreachable",
	"linksActivate": "activate"
};
/** Japanese dictionary, checked complete against the zh key set. */
const ja = {
	"title": "CDP ブラウザ",
	"titleLive": "CDP ブラウザ · ライブ",
	"liveView": "読み取り専用の観覧ウィンドウ",
	"pinned": "固定表示中",
	"realtime": "ライブ閲覧中",
	"noScreenshot": "（スクリーンショットなし — about:blank またはブラウザが描画していません）",
	"noActivePages": "アクティブなブラウザページはありません",
	"noActiveHint": "エージェントが bcdp_* でページを操作し始めると、ここにライブ表示されます",
	"openExternal": "実際のページを開く",
	"raiseWindow": "ウィンドウとして表示",
	"raiseWindowHint": "エージェントのブラウザを実際のウィンドウとして前面化（ヘッドレスインスタンスは同一 Profile の可視インスタンスに置き換わり、タブは保持されます）",
	"pickMode": "要素を選択",
	"pickModeHint": "ライブページ内の要素をクリックして会話に引用します",
	"picking": "選択中…ページ内の要素をクリックしてください",
	"picked": "要素をキャプチャしました",
	"pickFailed": "選択に失敗しました",
	"pickQuoted": "✓ 入力欄に引用しました",
	"pickDeliverFailed": "配送に失敗しました",
	"noUrl": "開ける URL がありません",
	"closeTab": "タブを閉じる",
	"newTab": "（新規タブ）",
	"history": "閲覧履歴",
	"historyHide": "履歴を閉じる",
	"historyShow": "閲覧履歴",
	"noHistory": "閲覧履歴はありません",
	"current": "現在",
	"refresh": "更新",
	"backToLive": "← ライブに戻る",
	"dragHint": "ドラッグでパネルを移動",
	"loginTitle": "ログインが必要な場合は、デスクトップ上の「CDP ブラウザブリッジ」Chrome ウィンドウでログインしてください。",
	"loginBtn": "ログイン済み、保存",
	"loginSaving": "保存中…",
	"loginSaved": "{n} 件のセッションを保存しました",
	"loginNotConnected": "ブラウザに接続されていません",
	"loginFailed": "保存に失敗しました",
	"loginDismiss": "通知を閉じる",
	"captchaTitle": "⚠️ 人間認証を検出しました",
	"captchaHint": "デスクトップの「CDP ブラウザブリッジ」ウィンドウで認証を手動で完了してください。エージェントは継続します。",
	"captchaDismiss": "通知を閉じる",
	"hintReset": "リセット済み · ホイールでスクロール · Ctrl+ホイールでズーム · ダブルクリックでリセット",
	"hintPan": "Ctrl+ホイールでズーム · Ctrl+ドラッグで移動 · ダブルクリックでリセット",
	"hintScroll": "Ctrl+ドラッグで移動 · ホイールでスクロール",
	"hintNotCaptured": "画面未キャプチャ · 今回の操作は届いていません · もう一度クリックすると復旧します",
	"failed": "失敗",
	"stale": "⚠ 未キャプチャ",
	"captured": "キャプチャ済み",
	"fabTitle": "CDP ブラウザライブビュー",
	"settingsTitle": "設定を表示",
	"settingsHide": "設定を隠す",
	"famTitle": "CDP ブラウザ",
	"famIsolate": "スペース分離",
	"famIsolateDesc": "オフ = 永続 Profile（ログインは再起動後も保持）；オン = 毎回分離サンドボックス",
	"famIdle": "アイドル時の自動停止（分、0 = 無効）",
	"famIdleDesc": "N 分間 bcdp_* の呼び出しがない場合、バックグラウンドのブラウザを停止し、次の呼び出し時に必要に応じて再起動します",
	"titleIdle": "Agent ブラウザ",
	"videoUnsupported": "このブラウザはこの H.264 ストリームに対応していません",
	"videoDisconnected": "ビデオストリームが切断されました",
	"videoConnectFailed": "ビデオストリームの接続に失敗しました ({status})",
	"gBasic": "基本",
	"gCapture": "キャプチャと配信",
	"gJudge": "評価（JEV / Laya）",
	"cdpMode": "接続モード",
	"cdpModeDesc": "auto = アクティブなターゲットのみ使用；remote = ローカルブラウザを勝手に起動しない；local = 常にローカル制御",
	"remoteEnabled": "リモート接続のマスタースイッチ",
	"remoteEnabledDesc": "オフ = ターゲット列は保持されますが無効；local モードには影響しません",
	"allowLocalFallback": "auto モードでローカルフォールバックを許可",
	"allowLocalFallbackDesc": "アクティブなターゲットに到達できない場合、ローカルブラウザの自動起動を許可します",
	"chromePath": "Chrome/Chromium パス",
	"chromePathDesc": "空 = 自動検出",
	"localHeadless": "ローカルブラウザをヘッドレスで起動",
	"localHeadlessDesc": "ローカルで起動するブラウザのみに適用",
	"localUserDataDir": "ローカルブラウザの Profile ディレクトリ",
	"localUserDataDirDesc": "空 = 管理されたディレクトリ；普段使う Chrome 設定を指定しないでください",
	"legacyEgoToolNames": "旧 ego_* ツール名も登録",
	"legacyEgoToolNamesDesc": "bcdp_* 改称前のスクリプト用；上流の ego-browser プラグインと排他",
	"captureBackend": "キャプチャバックエンド",
	"captureBackendDesc": "auto / cdp / ffmpeg",
	"streamProfile": "画質プロファイル",
	"streamProfileDesc": "全体の画質プリセット",
	"cdpFps": "CDP プレビュー FPS",
	"cdpQuality": "CDP JPEG 品質",
	"cdpMaxWidth": "CDP フレームの最大幅",
	"cdpBackstopIntervalMs": "CDP 復旧スクリーンショットの間隔（ms）",
	"ffmpegFps": "FFmpeg 動画 FPS",
	"ffmpegMaxWidth": "FFmpeg 最大幅",
	"ffmpegBitrateKbps": "FFmpeg ビットレート（kbps）",
	"ffmpegEncoder": "FFmpeg H.264 エンコーダー",
	"ffmpegPath": "FFmpeg パス",
	"ffmpegPathDesc": "空 = PATH または管理されたインストールを検出",
	"cursorHud": "スクリーンショットにカーソル HUD を描画",
	"cursorName": "カーソル HUD のラベル",
	"githubMirror": "GitHub ダウンロードミラー",
	"githubMirrorDesc": "管理されたダウンロードで https://github.com を置き換える HTTPS プレフィックス",
	"runtimeArgs": "ランタイム追加引数",
	"runtimeArgsDesc": "管理されたランタイムの argv に追加；次の bcdp_* 呼び出しで有効",
	"chromeArgs": "Chrome 追加起動引数",
	"chromeArgsDesc": "Chrome 起動の argv に追加；次のコールドスタートで有効",
	"judgePrefer": "評価ホップの順序",
	"judgePreferDesc": "カンマ区切り；デフォルトは \"laya,rule\"",
	"jevUrl": "JEV ベース URL",
	"jevUrlDesc": "空 = jev ホップをスキップ",
	"jevKey": "JEV Bearer Key",
	"jevKeyDesc": "空 = jev ホップをスキップ",
	"jevModel": "JEV モデル名",
	"jevChunkSize": "JEV の 1 ラウンドあたりの候補上限",
	"jevMaxImageBytes": "JEV の 1 フレームのバイト予算（0 = 無制限）",
	"jevHistoryLimit": "JEV の直前ステップのウィンドウ",
	"jevArchiveImage": "アーカイブにスクリーンショットを埋め込み",
	"jevEvaluate": "各アクションを評価器でチェック",
	"jevEvaluateDesc": "1 アクションごとに評価呼び出しが 1 回増加します",
	"jevStepBudget": "bcdp_jev_run 1 回あたりのラウンド上限",
	"jevWallMs": "1 回の実行のウォールクロック上限（ms）",
	"layaUrl": "Laya ベース URL",
	"layaUrlDesc": "sidecar はポート 8000 で提供しています",
	"layaKey": "Laya Key（必須）",
	"layaKeyDesc": "Key なしでは必ず 401 になります",
	"layaModel": "Laya モデル名",
	"linksTitle": "接続ターゲット（順序 = 優先度）",
	"linksEmpty": "ターゲットなし — 下のフォームから最初の接続先を追加してください",
	"linksEnabled": "有効",
	"linksActive": "アクティブ",
	"linksAddCdp": "CDP エンドポイントを追加",
	"linksAddCli": "ローカル ego CLI を追加",
	"linksAddCliExists": "ローカル ego CLI 接続は既に存在します — 1 台につき 1 件のみ",
	"linksEndpoint": "エンドポイント",
	"linksEndpointHint": "http(s)://ホスト:ポート または ws(s)://…",
	"linksEndpointInvalid": "エンドポイントが無効 — 保存していません",
	"linksCliPath": "ego CLI パス",
	"linksCliPathHint": "空欄 = 自動検出（PATH → アプリバンドル → 同梱ランタイム）",
	"linksLabel": "ラベル",
	"linksRemove": "削除",
	"linksMoveUp": "上へ",
	"linksMoveDown": "下へ",
	"linksProbe": "プローブ",
	"linksProbing": "プローブ中…",
	"linksProbeOk": "到達可能",
	"linksProbeFail": "到達不可",
	"linksLimitReached": "接続列は最大 {n} 件です",
	"linksWriteFailed": "保存に失敗 — 設定層に書き込みを拒否されました",
	"linksCliRemoteWarn": "cdpMode=remote で ego CLI をアクティブ化すると mode-kind-mismatch になります",
	"linksCliSdk": "同梱ハーネスを使う",
	"linksDisabledHint": "無効 — アクティブ化する前に有効化してください",
	"linksLocalRow": "ローカル Chrome（管理起動）",
	"linksLocalEnableHint": "チェック = アクティブなターゲットに到達できない場合、auto モードはローカル起動にフォールバックします",
	"linksActivate": "アクティブ化"
};
/** Korean dictionary, checked complete against the zh key set. */
const ko = {
	"title": "CDP 브라우저",
	"titleLive": "CDP 브라우저 · 실시간",
	"liveView": "읽기 전용 관찰 창",
	"pinned": "고정 보기 중",
	"realtime": "실시간 탐색 중",
	"noScreenshot": "(스크린샷 없음 — about:blank 또는 브라우저가 렌더링하지 않음)",
	"noActivePages": "활성 브라우저 페이지 없음",
	"noActiveHint": "agent가 bcdp_*로 웹 페이지를 조작하기 시작하면 여기에 실시간으로 표시됩니다",
	"openExternal": "실제 페이지 열기",
	"raiseWindow": "창으로 띄우기",
	"raiseWindowHint": "agent 브라우저를 실제 창으로 띄우기(헤드리스 인스턴스는 동일한 Profile의 보이는 인스턴스로 교체되며 탭은 유지됩니다)",
	"pickMode": "요소 선택",
	"pickModeHint": "실시간 페이지의 요소를 클릭하여 대화에 인용합니다",
	"picking": "선택 중… 페이지의 요소를 클릭하세요",
	"picked": "요소 캡처됨",
	"pickFailed": "선택 실패",
	"pickQuoted": "✓ 입력창에 인용됨",
	"pickDeliverFailed": "전달 실패",
	"noUrl": "열 수 있는 주소가 없습니다",
	"closeTab": "탭 닫기",
	"newTab": "(새 탭)",
	"history": "탐색 기록",
	"historyHide": "기록 접기",
	"historyShow": "탐색 기록",
	"noHistory": "탐색 기록 없음",
	"current": "현재",
	"refresh": "새로고침",
	"backToLive": "← 실시간으로 복귀",
	"dragHint": "드래그하여 패널 이동",
	"loginTitle": "로그인이 필요하면 데스크톱의 「CDP 브라우저 브리지」 Chrome 창에서 로그인하세요.",
	"loginBtn": "로그인 완료, 저장",
	"loginSaving": "저장 중…",
	"loginSaved": "세션 {n}개 저장됨",
	"loginNotConnected": "브라우저에 연결되지 않음",
	"loginFailed": "저장 실패",
	"loginDismiss": "알림 닫기",
	"captchaTitle": "⚠️ 인간 인증 감지됨",
	"captchaHint": "데스크톱의 「CDP 브라우저 브리지」 브라우저 창에서 인증을 직접 완료하면 agent가 계속 진행합니다.",
	"captchaDismiss": "알림 닫기",
	"hintReset": "복원됨 · 휠로 스크롤 · Ctrl+휠 확대/축소 · 더블클릭 복원",
	"hintPan": "Ctrl+휠 확대/축소 · Ctrl+드래그 이동 · 더블클릭 복원",
	"hintScroll": "Ctrl+드래그 이동 · 휠로 스크롤",
	"hintNotCaptured": "화면 미접수 · 이번 작업이 전달되지 않음 · 한 번 더 클릭하면 복구됩니다",
	"failed": "실패",
	"stale": "⚠ 미접수",
	"captured": "접수됨",
	"fabTitle": "CDP 브라우저 실시간 보기",
	"settingsTitle": "설정 펼치기",
	"settingsHide": "설정 접기",
	"famTitle": "CDP 브라우저",
	"famIsolate": "공간 격리",
	"famIsolateDesc": "끄기 = 영구 프로필(재시작 후에도 로그인 유지); 켜기 = 매번 격리 샌드박스",
	"famIdle": "유휴 자동 중지(분, 0 = 끄기)",
	"famIdleDesc": "N분 동안 bcdp_* 호출이 없으면 백그라운드 브라우저를 중지하고 다음 호출 시 필요에 따라 재시작합니다",
	"titleIdle": "Agent 브라우저",
	"videoUnsupported": "이 브라우저는 해당 H.264 스트림을 지원하지 않습니다",
	"videoDisconnected": "비디오 스트림이 끊어졌습니다",
	"videoConnectFailed": "비디오 스트림 연결 실패 ({status})",
	"gBasic": "기본",
	"gCapture": "캡처 및 스트리밍",
	"gJudge": "심사(JEV / Laya)",
	"cdpMode": "연결 모드",
	"cdpModeDesc": "auto = 활성화된 대상만; remote = 로컬 브라우저를 몰래 시작하지 않음; local = 항상 로컬 제어",
	"remoteEnabled": "원격 인수 마스터 스위치",
	"remoteEnabledDesc": "끄기 = 대상 순서는 보존되나 적용되지 않음; local 모드에는 영향 없음",
	"allowLocalFallback": "auto 모드에서 로컬 폴백 허용",
	"allowLocalFallbackDesc": "활성화된 대상에 연결할 수 없을 때 로컬 브라우저 자동 시작을 허용합니다",
	"chromePath": "Chrome/Chromium 경로",
	"chromePathDesc": "비움 = 자동 탐지",
	"localHeadless": "로컬 브라우저를 헤드리스로 시작",
	"localHeadlessDesc": "로컬에서 시작하는 브라우저에만 적용",
	"localUserDataDir": "로컬 브라우저 Profile 디렉터리",
	"localUserDataDirDesc": "비움 = 관리 디렉터리; 평소 사용하는 Chrome 설정을 지정하지 마세요",
	"legacyEgoToolNames": "구버전 ego_* 도구 이름도 등록",
	"legacyEgoToolNamesDesc": "bcdp_* 개명 전 스크립트용; 상위 ego-browser 플러그인과 상호 배타적",
	"captureBackend": "캡처 백엔드",
	"captureBackendDesc": "auto / cdp / ffmpeg",
	"streamProfile": "화질 프로필",
	"streamProfileDesc": "전체 화질 프리셋",
	"cdpFps": "CDP 미리보기 FPS",
	"cdpQuality": "CDP JPEG 품질",
	"cdpMaxWidth": "CDP 프레임 최대 너비",
	"cdpBackstopIntervalMs": "CDP 복구 스크린샷 간격(ms)",
	"ffmpegFps": "FFmpeg 비디오 FPS",
	"ffmpegMaxWidth": "FFmpeg 최대 너비",
	"ffmpegBitrateKbps": "FFmpeg 비트레이트(kbps)",
	"ffmpegEncoder": "FFmpeg H.264 인코더",
	"ffmpegPath": "FFmpeg 경로",
	"ffmpegPathDesc": "비움 = PATH 또는 관리형 설치 감지",
	"cursorHud": "스크린샷에 커서 HUD 그리기",
	"cursorName": "커서 HUD 레이블",
	"githubMirror": "GitHub 다운로드 미러",
	"githubMirrorDesc": "관리형 다운로드에서 https://github.com을 대체하는 HTTPS 접두사",
	"runtimeArgs": "런타임 추가 인자",
	"runtimeArgsDesc": "관리형 런타임 argv에 추가; 다음 bcdp_* 호출부터 적용",
	"chromeArgs": "Chrome 추가 시작 인자",
	"chromeArgsDesc": "Chrome 시작 argv에 추가; 다음 콜드 스타트부터 적용",
	"judgePrefer": "심사 홉 순서",
	"judgePreferDesc": "쉼표 구분; 기본값 \"laya,rule\"",
	"jevUrl": "JEV 기본 URL",
	"jevUrlDesc": "비움 = jev 홉 건너뛰기",
	"jevKey": "JEV Bearer Key",
	"jevKeyDesc": "비움 = jev 홉 건너뛰기",
	"jevModel": "JEV 모델명",
	"jevChunkSize": "JEV 라운드당 후보 상한",
	"jevMaxImageBytes": "JEV 프레임 바이트 예산(0 = 무제한)",
	"jevHistoryLimit": "JEV 최근 단계 창",
	"jevArchiveImage": "아카이브 번들에 스크린샷 포함",
	"jevEvaluate": "모든 동작을 심사로 평가",
	"jevEvaluateDesc": "동작당 심사 호출이 한 번 더 소모됩니다",
	"jevStepBudget": "bcdp_jev_run 1회 라운드 상한",
	"jevWallMs": "1회 실행 벽시계 상한(ms)",
	"layaUrl": "Laya 기본 URL",
	"layaUrlDesc": "sidecar 서비스가 8000 포트",
	"layaKey": "Laya Key(필수)",
	"layaKeyDesc": "Key 없이는 반드시 401입니다",
	"layaModel": "Laya 모델명",
	"linksTitle": "연결 대상(순서 = 우선순위)",
	"linksEmpty": "대상 없음 — 아래 양식에서 첫 연결 대상을 추가하세요",
	"linksEnabled": "사용",
	"linksActive": "활성화됨",
	"linksAddCdp": "CDP 엔드포인트 추가",
	"linksAddCli": "로컬 ego CLI 추가",
	"linksAddCliExists": "로컬 ego CLI 연결이 이미 있습니다 — 머신당 하나만 허용됩니다",
	"linksEndpoint": "엔드포인트",
	"linksEndpointHint": "http(s)://호스트:포트 또는 ws(s)://…",
	"linksEndpointInvalid": "엔드포인트가 잘못되었습니다 — 저장하지 않았습니다",
	"linksCliPath": "ego CLI 경로",
	"linksCliPathHint": "비어 있음 = 자동 감지(PATH → 앱 번들 → 내장 런타임)",
	"linksLabel": "레이블",
	"linksRemove": "삭제",
	"linksMoveUp": "위로",
	"linksMoveDown": "아래로",
	"linksProbe": "프로브",
	"linksProbing": "프로브 중…",
	"linksProbeOk": "연결됨",
	"linksProbeFail": "연결 안 됨",
	"linksLimitReached": "연결 시퀀스는 최대 {n}개입니다",
	"linksWriteFailed": "저장 실패 — 설정 계층이 이 쓰기를 거부했습니다",
	"linksCliRemoteWarn": "cdpMode=remote에서 ego CLI를 활성화하면 mode-kind-mismatch가 발생합니다",
	"linksCliSdk": "내장 하네스 사용",
	"linksDisabledHint": "비활성 — 활성화하기 전에 사용으로 설정하세요",
	"linksLocalRow": "로컬 Chrome(관리 시작)",
	"linksLocalEnableHint": "체크 = 활성 대상에 도달할 수 없을 때 auto 모드가 로컬 시작으로 대체됩니다",
	"linksActivate": "활성화"
};
/** French dictionary, checked complete against the zh key set. */
const fr = {
	"title": "Navigateur CDP",
	"titleLive": "Navigateur CDP · Direct",
	"liveView": "Fenêtre d'observation (lecture seule)",
	"pinned": "Vue épinglée",
	"realtime": "Navigation en direct",
	"noScreenshot": "(pas de capture — about:blank ou navigateur inactif)",
	"noActivePages": "Aucune page de navigateur active",
	"noActiveHint": "Les pages apparaîtront ici dès que l'agent naviguera avec bcdp_*",
	"openExternal": "Ouvrir la vraie page",
	"raiseWindow": "Fenêtre séparée",
	"raiseWindowHint": "Afficher le navigateur de l'agent comme une vraie fenêtre (une instance sans interface est remplacée par une instance visible sur le même profil, onglets conservés)",
	"pickMode": "Choisir un élément",
	"pickModeHint": "Cliquez un élément de la page en direct pour le citer dans la conversation",
	"picking": "Sélection… cliquez un élément dans la page",
	"picked": "Élément capturé",
	"pickFailed": "Échec de la sélection",
	"pickQuoted": "✓ Cité dans la zone de saisie",
	"pickDeliverFailed": "Échec de l'envoi",
	"noUrl": "Aucune URL à ouvrir",
	"closeTab": "Fermer l'onglet",
	"newTab": "(nouvel onglet)",
	"history": "Historique de navigation",
	"historyHide": "Masquer l'historique",
	"historyShow": "Historique de navigation",
	"noHistory": "Aucun historique de navigation",
	"current": "actuel",
	"refresh": "Actualiser",
	"backToLive": "← Retour au direct",
	"dragHint": "Glisser pour déplacer le panneau",
	"loginTitle": "Si une connexion est requise, connectez-vous dans la fenêtre Chrome « Pont navigateur CDP » sur votre bureau.",
	"loginBtn": "Connecté, enregistrer",
	"loginSaving": "Enregistrement…",
	"loginSaved": "{n} sessions enregistrées",
	"loginNotConnected": "Navigateur non connecté",
	"loginFailed": "Échec de l'enregistrement",
	"loginDismiss": "Fermer l'avis",
	"captchaTitle": "⚠️ Vérification humaine détectée",
	"captchaHint": "Terminez la vérification dans la fenêtre « Pont navigateur CDP » du bureau ; l'agent poursuivra.",
	"captchaDismiss": "Fermer l'avis",
	"hintReset": "Réinitialisé · molette pour défiler · Ctrl+molette pour zoomer · double-clic pour réinitialiser",
	"hintPan": "Ctrl+molette pour zoomer · Ctrl+glisser pour déplacer · double-clic pour réinitialiser",
	"hintScroll": "Ctrl+glisser pour déplacer · molette pour défiler",
	"hintNotCaptured": "Image non captée · action non transmise · recliquez pour récupérer",
	"failed": "échec",
	"stale": "⚠ Non captée",
	"captured": "Captée",
	"fabTitle": "Vue en direct du navigateur CDP",
	"settingsTitle": "Afficher les réglages",
	"settingsHide": "Masquer les réglages",
	"famTitle": "Navigateur CDP",
	"famIsolate": "Isolation des espaces",
	"famIsolateDesc": "Off = profil persistant (connexions conservées au redémarrage) ; on = sandbox isolé à chaque fois",
	"famIdle": "Arrêt auto après inactivité (minutes, 0 = jamais)",
	"famIdleDesc": "Arrête le navigateur après N minutes sans appel bcdp_* ; relance à la demande",
	"titleIdle": "Navigateur Agent",
	"videoUnsupported": "Ce navigateur ne prend pas en charge ce flux H.264",
	"videoDisconnected": "Flux vidéo interrompu",
	"videoConnectFailed": "Échec de connexion au flux vidéo ({status})",
	"gBasic": "Général",
	"gCapture": "Capture et diffusion",
	"gJudge": "Jugement (JEV / Laya)",
	"cdpMode": "Mode de connexion",
	"cdpModeDesc": "auto = cible activée uniquement ; remote = ne jamais lancer de navigateur local ; local = toujours contrôle local",
	"remoteEnabled": "Interrupteur maître de la prise à distance",
	"remoteEnabledDesc": "Off = la séquence de cibles est conservée mais inactive ; sans effet sur le mode local",
	"allowLocalFallback": "Autoriser le repli local en mode auto",
	"allowLocalFallbackDesc": "auto peut lancer un navigateur local quand la cible activée est injoignable",
	"chromePath": "Chemin Chrome/Chromium",
	"chromePathDesc": "Vide = détection automatique",
	"localHeadless": "Lancer le navigateur local sans interface",
	"localHeadlessDesc": "S'applique au navigateur lancé localement",
	"localUserDataDir": "Répertoire de profil du navigateur local",
	"localUserDataDirDesc": "Vide = répertoire géré ; ne jamais pointer vers votre profil Chrome quotidien",
	"legacyEgoToolNames": "Enregistrer aussi les anciens noms ego_*",
	"legacyEgoToolNamesDesc": "Pour les scripts antérieurs au renommage bcdp_* ; exclusif avec le plugin amont ego-browser",
	"captureBackend": "Backend de capture",
	"captureBackendDesc": "auto, cdp ou ffmpeg",
	"streamProfile": "Profil de qualité",
	"streamProfileDesc": "Préréglage de qualité global",
	"cdpFps": "FPS de prévisualisation CDP",
	"cdpQuality": "Qualité JPEG CDP",
	"cdpMaxWidth": "Largeur max de trame CDP",
	"cdpBackstopIntervalMs": "Intervalle de capture de reprise CDP (ms)",
	"ffmpegFps": "FPS vidéo FFmpeg",
	"ffmpegMaxWidth": "Largeur max FFmpeg",
	"ffmpegBitrateKbps": "Débit FFmpeg (kbps)",
	"ffmpegEncoder": "Encodeur H.264 FFmpeg",
	"ffmpegPath": "Chemin FFmpeg",
	"ffmpegPathDesc": "Vide = détecter le PATH ou l'installation gérée",
	"cursorHud": "Dessiner le HUD curseur dans les captures",
	"cursorName": "Libellé du HUD curseur",
	"githubMirror": "Miroir de téléchargement GitHub",
	"githubMirrorDesc": "Préfixe HTTPS remplaçant https://github.com pour les téléchargements gérés",
	"runtimeArgs": "Arguments supplémentaires du runtime",
	"runtimeArgsDesc": "Ajoutés aux argv du runtime géré ; effectifs dès le prochain appel bcdp_*",
	"chromeArgs": "Arguments de lancement Chrome supplémentaires",
	"chromeArgsDesc": "Ajoutés aux argv de lancement Chrome ; effectifs au prochain démarrage à froid",
	"judgePrefer": "Ordre des sauts de jugement",
	"judgePreferDesc": "Séparés par des virgules ; par défaut \"laya,rule\"",
	"jevUrl": "URL de base JEV",
	"jevUrlDesc": "Vide = sauter le saut jev",
	"jevKey": "Clé Bearer JEV",
	"jevKeyDesc": "Vide = le saut jev est ignoré",
	"jevModel": "Modèle JEV",
	"jevChunkSize": "Candidats JEV par tour",
	"jevMaxImageBytes": "Budget d'octets par trame JEV (0 = illimité)",
	"jevHistoryLimit": "Fenêtre de pas récents JEV",
	"jevArchiveImage": "Inclure la capture dans l'archive",
	"jevEvaluate": "Évaluer chaque action par le juge",
	"jevEvaluateDesc": "Coûte un appel de jugement par action",
	"jevStepBudget": "Tours par exécution bcdp_jev_run",
	"jevWallMs": "Plafond de temps réel par exécution (ms)",
	"layaUrl": "URL de base Laya",
	"layaUrlDesc": "Le sidecar sert le port 8000",
	"layaKey": "Clé Laya (requise)",
	"layaKeyDesc": "Un appel sans clé renvoie forcément 401",
	"layaModel": "Modèle Laya",
	"linksTitle": "Cibles de connexion (ordre = priorité)",
	"linksEmpty": "Aucune cible — ajoutez la première avec le formulaire ci-dessous",
	"linksEnabled": "Activé",
	"linksActive": "activé",
	"linksAddCdp": "Ajouter un point de terminaison CDP",
	"linksAddCli": "Ajouter un ego CLI local",
	"linksAddCliExists": "La connexion ego CLI locale existe déjà — une seule par machine",
	"linksEndpoint": "Point de terminaison",
	"linksEndpointHint": "http(s)://hôte:port ou ws(s)://…",
	"linksEndpointInvalid": "Point de terminaison invalide — non enregistré",
	"linksCliPath": "Chemin de l’ego CLI",
	"linksCliPathHint": "Vide = détection auto (PATH → bundle de l’app → runtime intégré)",
	"linksLabel": "Libellé",
	"linksRemove": "Supprimer",
	"linksMoveUp": "Monter",
	"linksMoveDown": "Descendre",
	"linksProbe": "Tester",
	"linksProbing": "Test en cours…",
	"linksProbeOk": "joignable",
	"linksProbeFail": "injoignable",
	"linksLimitReached": "La séquence est limitée à {n} entrées",
	"linksWriteFailed": "Échec de l’enregistrement — la couche de réglages a refusé cette écriture",
	"linksCliRemoteWarn": "Activer un lien ego CLI avec cdpMode=remote échoue avec mode-kind-mismatch",
	"linksCliSdk": "Utiliser le harnais intégré",
	"linksDisabledHint": "Désactivé — activez-le avant de le rendre actif",
	"linksLocalRow": "Chrome local (gestionné)",
	"linksLocalEnableHint": "Coché = le mode auto peut basculer vers le navigateur local si la cible activée est injoignable",
	"linksActivate": "activer"
};
/** German dictionary, checked complete against the zh key set. */
const de = {
	"title": "CDP-Browser",
	"titleLive": "CDP-Browser · Live",
	"liveView": "Live-Ansicht (nur lesend)",
	"pinned": "Angepinnt",
	"realtime": "Live-Browsing",
	"noScreenshot": "(kein Screenshot — about:blank oder Browser rendert nicht)",
	"noActivePages": "Keine aktiven Browser-Seiten",
	"noActiveHint": "Seiten erscheinen hier, sobald der Agent mit bcdp_* surft",
	"openExternal": "Echte Seite öffnen",
	"raiseWindow": "Als Fenster öffnen",
	"raiseWindowHint": "Agent-Browser als echtes Fenster nach vorn holen (eine Headless-Instance wird durch eine sichtbare mit demselben Profil ersetzt, Tabs bleiben erhalten)",
	"pickMode": "Element wählen",
	"pickModeHint": "Klicke ein Element auf der Live-Seite, um es in die Konversation zu zitieren",
	"picking": "Auswahl… klicke ein Element auf der Seite",
	"picked": "Element erfasst",
	"pickFailed": "Auswahl fehlgeschlagen",
	"pickQuoted": "✓ In Eingabefeld zitiert",
	"pickDeliverFailed": "Zustellung fehlgeschlagen",
	"noUrl": "Keine URL zum Öffnen",
	"closeTab": "Tab schließen",
	"newTab": "(neuer Tab)",
	"history": "Verlauf",
	"historyHide": "Verlauf ausblenden",
	"historyShow": "Verlauf anzeigen",
	"noHistory": "Kein Browserverlauf",
	"current": "aktuell",
	"refresh": "Aktualisieren",
	"backToLive": "← Zurück zu Live",
	"dragHint": "Ziehen zum Verschieben des Panels",
	"loginTitle": "Bei Login-Pflicht bitte im Chrome-Fenster »CDP-Browserbrücke« auf dem Desktop anmelden.",
	"loginBtn": "Angemeldet, speichern",
	"loginSaving": "Speichern…",
	"loginSaved": "{n} Sitzungen gespeichert",
	"loginNotConnected": "Browser nicht verbunden",
	"loginFailed": "Speichern fehlgeschlagen",
	"loginDismiss": "Hinweis schließen",
	"captchaTitle": "⚠️ Mensch-Check erkannt",
	"captchaHint": "Bitte Verifikation im Browserfenster »CDP-Browserbrücke« auf dem Desktop abschließen; der Agent macht weiter.",
	"captchaDismiss": "Hinweis schließen",
	"hintReset": "Zurückgesetzt · Scrollen · Strg+Scrollen zoomt · Doppelklick setzt zurück",
	"hintPan": "Strg+Scrollen zoomt · Strg+Ziehen verschiebt · Doppelklick setzt zurück",
	"hintScroll": "Strg+Ziehen verschiebt · Scrollen",
	"hintNotCaptured": "Bild nicht übernommen · Aktion nicht zugestellt · noch einmal klicken zur Wiederherstellung",
	"failed": "fehlgeschlagen",
	"stale": "⚠ Nicht übernommen",
	"captured": "Übernommen",
	"fabTitle": "CDP-Browser Live-Ansicht",
	"settingsTitle": "Einstellungen einblenden",
	"settingsHide": "Einstellungen ausblenden",
	"famTitle": "CDP-Browser",
	"famIsolate": "Raum-Isolation",
	"famIsolateDesc": "Aus = persistentes Profil (Logins überleben Neustarts); Ein = isolierter Sandbox",
	"famIdle": "Automatischer Stopp bei Leerlauf (Minuten, 0 = aus)",
	"famIdleDesc": "Stoppt den Browser nach N Minuten ohne bcdp_*-Aufruf; startet bei Bedarf neu",
	"titleIdle": "Agent-Browser",
	"videoUnsupported": "Dieser Browser unterstützt diesen H.264-Stream nicht",
	"videoDisconnected": "Videostream getrennt",
	"videoConnectFailed": "Videostream-Verbindung fehlgeschlagen ({status})",
	"gBasic": "Grundlagen",
	"gCapture": "Aufnahme & Streaming",
	"gJudge": "Bewertung (JEV / Laya)",
	"cdpMode": "Verbindungsmodus",
	"cdpModeDesc": "auto = nur aktiviertes Ziel; remote = niemals lokalen Browser starten; local = immer lokale Steuerung",
	"remoteEnabled": "Fernübernahme-Hauptschalter",
	"remoteEnabledDesc": "Aus = Zielsequenz bleibt erhalten, ist aber wirkungslos; betrifft den lokalen Modus nicht",
	"allowLocalFallback": "Lokalen Fallback im auto-Modus erlauben",
	"allowLocalFallbackDesc": "auto darf einen lokalen Browser starten, wenn das aktivierte Ziel unerreichbar ist",
	"chromePath": "Chrome/Chromium-Pfad",
	"chromePathDesc": "Leer = automatisch erkennen",
	"localHeadless": "Lokalen Browser headless starten",
	"localHeadlessDesc": "Gilt nur für den lokal gestarteten Browser",
	"localUserDataDir": "Profilverzeichnis des lokalen Browsers",
	"localUserDataDirDesc": "Leer = verwaltetes Verzeichnis; niemals auf dein tägliches Chrome-Profil zeigen lassen",
	"legacyEgoToolNames": "Auch alte ego_*-Namen registrieren",
	"legacyEgoToolNamesDesc": "Für Skripte vor der bcdp_*-Umbenennung; unvereinbar mit dem Upstream-Plugin ego-browser",
	"captureBackend": "Aufnahme-Backend",
	"captureBackendDesc": "auto, cdp oder ffmpeg",
	"streamProfile": "Qualitätsprofil",
	"streamProfileDesc": "Gesamter Qualitäts-Preset",
	"cdpFps": "CDP-Vorschau-FPS",
	"cdpQuality": "CDP-JPEG-Qualität",
	"cdpMaxWidth": "CDP-Bild max. Breite",
	"cdpBackstopIntervalMs": "CDP-Wiederherstellungsintervall (ms)",
	"ffmpegFps": "FFmpeg-Video-FPS",
	"ffmpegMaxWidth": "FFmpeg max. Breite",
	"ffmpegBitrateKbps": "FFmpeg-Bitrate (kbps)",
	"ffmpegEncoder": "FFmpeg-H.264-Encoder",
	"ffmpegPath": "FFmpeg-Pfad",
	"ffmpegPathDesc": "Leer = PATH oder verwaltete Installation erkennen",
	"cursorHud": "Cursor-HUD in Screenshots zeichnen",
	"cursorName": "Cursor-HUD-Beschriftung",
	"githubMirror": "GitHub-Download-Spiegel",
	"githubMirrorDesc": "HTTPS-Präfix ersetzt https://github.com für verwaltete Downloads",
	"runtimeArgs": "Zusätzliche Runtime-Argumente",
	"runtimeArgsDesc": "An argv der verwalteten Runtime angehängt; ab nächstem bcdp_*-Aufruf",
	"chromeArgs": "Zusätzliche Chrome-Startargumente",
	"chromeArgsDesc": "An Chrome-Start-argv angehängt; ab nächstem Kaltstart",
	"judgePrefer": "Reihenfolge der Judge-Hops",
	"judgePreferDesc": "Kommagetrennt; Standard: \"laya,rule\"",
	"jevUrl": "JEV-Basis-URL",
	"jevUrlDesc": "Leer = jev-Hop überspringen",
	"jevKey": "JEV-Bearer-Key",
	"jevKeyDesc": "Leer = jev-Hop wird übersprungen",
	"jevModel": "JEV-Modellname",
	"jevChunkSize": "JEV-Kandidaten pro Runde",
	"jevMaxImageBytes": "JEV-Byte-Budget pro Bild (0 = unbegrenzt)",
	"jevHistoryLimit": "JEV-Fenster letzter Schritte",
	"jevArchiveImage": "Screenshot im Archiv-Bundle einbetten",
	"jevEvaluate": "Jede Aktion vom Judge bewerten lassen",
	"jevEvaluateDesc": "Kostet einen Bewertungsaufruf pro Aktion",
	"jevStepBudget": "Runden pro bcdp_jev_run",
	"jevWallMs": "Wanduhr-Obergrenze pro Lauf (ms)",
	"layaUrl": "Laya-Basis-URL",
	"layaUrlDesc": "Der Sidecar bedient Port 8000",
	"layaKey": "Laya-Key (erforderlich)",
	"layaKeyDesc": "Ohne Key gibt es garantiert 401",
	"layaModel": "Laya-Modellname",
	"linksTitle": "Verbindungsziele (Reihenfolge = Priorität)",
	"linksEmpty": "Keine Ziele — füge das erste mit dem Formular unten hinzu",
	"linksEnabled": "Aktiviert",
	"linksActive": "aktiv",
	"linksAddCdp": "CDP-Endpunkt hinzufügen",
	"linksAddCli": "Lokalen ego CLI hinzufügen",
	"linksAddCliExists": "Die lokale ego-CLI-Verbindung existiert bereits — eine pro Maschine",
	"linksEndpoint": "Endpunkt",
	"linksEndpointHint": "http(s)://Host:Port oder ws(s)://…",
	"linksEndpointInvalid": "Ungültiger Endpunkt — nicht gespeichert",
	"linksCliPath": "ego-CLI-Pfad",
	"linksCliPathHint": "Leer = automatisch erkennen (PATH → App-Bundle → mitgelieferte Runtime)",
	"linksLabel": "Bezeichnung",
	"linksRemove": "Entfernen",
	"linksMoveUp": "Nach oben",
	"linksMoveDown": "Nach unten",
	"linksProbe": "Prüfen",
	"linksProbing": "Prüfe…",
	"linksProbeOk": "erreichbar",
	"linksProbeFail": "nicht erreichbar",
	"linksLimitReached": "Die Sequenz ist auf {n} Einträge begrenzt",
	"linksWriteFailed": "Speichern fehlgeschlagen — die Einstellungsschicht hat den Schreibzugriff abgelehnt",
	"linksCliRemoteWarn": "Aktivieren eines ego-CLI-Links bei cdpMode=remote schlägt mit mode-kind-mismatch fehl",
	"linksCliSdk": "Mitgeliefertes Harness verwenden",
	"linksDisabledHint": "Deaktiviert — erst aktivieren, dann aktiv schalten",
	"linksLocalRow": "Lokales Chrome (verwaltet)",
	"linksLocalEnableHint": "Aktiviert = der Auto-Modus darf auf den verwalteten lokalen Browser ausweichen, wenn das aktivierte Ziel nicht erreichbar ist",
	"linksActivate": "aktivieren"
};
/** Italian dictionary, checked complete against the zh key set. */
const it = {
	"title": "Browser CDP",
	"titleLive": "Browser CDP · Diretta",
	"liveView": "Vista di osservazione (sola lettura)",
	"pinned": "Vista bloccata",
	"realtime": "Navigazione in diretta",
	"noScreenshot": "(nessuno screenshot — about:blank o browser inattivo)",
	"noActivePages": "Nessuna pagina del browser attiva",
	"noActiveHint": "Le pagine appaiono qui quando l'agente naviga con bcdp_*",
	"openExternal": "Apri pagina reale",
	"raiseWindow": "Finestra separata",
	"raiseWindowHint": "Mostra il browser dell'agente come finestra reale (un'istanza headless è sostituita da una visibile sullo stesso profilo, tab conservati)",
	"pickMode": "Scegli elemento",
	"pickModeHint": "Clicca un elemento nella pagina in diretta per citarlo nella conversazione",
	"picking": "Selezione… clicca un elemento nella pagina",
	"picked": "Elemento acquisito",
	"pickFailed": "Selezione fallita",
	"pickQuoted": "✓ Citato nel campo di inserimento",
	"pickDeliverFailed": "Consegna fallita",
	"noUrl": "Nessun URL da aprire",
	"closeTab": "Chiudi scheda",
	"newTab": "(nuova scheda)",
	"history": "Cronologia di navigazione",
	"historyHide": "Nascondi cronologia",
	"historyShow": "Mostra cronologia",
	"noHistory": "Nessuna cronologia di navigazione",
	"current": "attuale",
	"refresh": "Aggiorna",
	"backToLive": "← Torna alla diretta",
	"dragHint": "Trascina per spostare il pannello",
	"loginTitle": "Se serve il login, effettualo nella finestra Chrome «Ponte browser CDP» sul desktop.",
	"loginBtn": "Accesso effettuato, salva",
	"loginSaving": "Salvataggio…",
	"loginSaved": "Salvate {n} sessioni",
	"loginNotConnected": "Browser non connesso",
	"loginFailed": "Salvataggio fallito",
	"loginDismiss": "Chiudi avviso",
	"captchaTitle": "⚠️ Verifica umana rilevata",
	"captchaHint": "Completa la verifica nella finestra «Ponte browser CDP» sul desktop; l'agente continuerà.",
	"captchaDismiss": "Chiudi avviso",
	"hintReset": "Ripristinato · rotellina per scorrere · Ctrl+rotellina per lo zoom · doppio clic per ripristinare",
	"hintPan": "Ctrl+rotellina per lo zoom · Ctrl+trascina per spostare · doppio clic per ripristinare",
	"hintScroll": "Ctrl+trascina per spostare · rotellina per scorrere",
	"hintNotCaptured": "Schermata non acquisita · azione non consegnata · clicca di nuovo per riprendere",
	"failed": "fallito",
	"stale": "⚠ Non acquisita",
	"captured": "Acquisita",
	"fabTitle": "Vista diretta del browser CDP",
	"settingsTitle": "Mostra impostazioni",
	"settingsHide": "Nascondi impostazioni",
	"famTitle": "Browser CDP",
	"famIsolate": "Isolamento degli spazi",
	"famIsolateDesc": "Off = profilo persistente (login sopravvivono ai riavvii); on = sandbox isolato ogni volta",
	"famIdle": "Arresto automatico da inattività (minuti, 0 = mai)",
	"famIdleDesc": "Arresta il browser dopo N minuti senza chiamate bcdp_*; riavvio a richiesta",
	"titleIdle": "Browser Agent",
	"videoUnsupported": "Questo browser non supporta questo flusso H.264",
	"videoDisconnected": "Flusso video interrotto",
	"videoConnectFailed": "Connessione al flusso video fallita ({status})",
	"gBasic": "Base",
	"gCapture": "Cattura e streaming",
	"gJudge": "Giudizio (JEV / Laya)",
	"cdpMode": "Modalità di connessione",
	"cdpModeDesc": "auto = solo destinazione attiva; remote = non avviare mai un browser locale; local = sempre controllo locale",
	"remoteEnabled": "Interruttore principale del controllo remoto",
	"remoteEnabledDesc": "Off = la sequenza di destinazioni è conservata ma inerte; non influisce sulla modalità locale",
	"allowLocalFallback": "Consenti fallback locale in modalità auto",
	"allowLocalFallbackDesc": "auto può avviare un browser locale quando la destinazione attiva è irraggiungibile",
	"chromePath": "Percorso Chrome/Chromium",
	"chromePathDesc": "Vuoto = rilevamento automatico",
	"localHeadless": "Avvia il browser locale in headless",
	"localHeadlessDesc": "Si applica solo al browser avviato localmente",
	"localUserDataDir": "Directory del profilo del browser locale",
	"localUserDataDirDesc": "Vuoto = directory gestita; non puntare mai al profilo Chrome quotidiano",
	"legacyEgoToolNames": "Registra anche i vecchi nomi ego_*",
	"legacyEgoToolNamesDesc": "Per script scritti prima della rinomina bcdp_*; conflittuale con il plugin upstream ego-browser",
	"captureBackend": "Backend di cattura",
	"captureBackendDesc": "auto, cdp o ffmpeg",
	"streamProfile": "Profilo di qualità",
	"streamProfileDesc": "Preset di qualità complessivo",
	"cdpFps": "FPS di anteprima CDP",
	"cdpQuality": "Qualità JPEG CDP",
	"cdpMaxWidth": "Larghezza massima frame CDP",
	"cdpBackstopIntervalMs": "Intervallo di recupero screenshot CDP (ms)",
	"ffmpegFps": "FPS video FFmpeg",
	"ffmpegMaxWidth": "Larghezza massima FFmpeg",
	"ffmpegBitrateKbps": "Bitrate FFmpeg (kbps)",
	"ffmpegEncoder": "Encoder H.264 FFmpeg",
	"ffmpegPath": "Percorso FFmpeg",
	"ffmpegPathDesc": "Vuoto = rileva PATH o installazione gestita",
	"cursorHud": "Disegna l'HUD del cursore negli screenshot",
	"cursorName": "Etichetta HUD cursore",
	"githubMirror": "Mirror di download GitHub",
	"githubMirrorDesc": "Prefisso HTTPS che sostituisce https://github.com per i download gestiti",
	"runtimeArgs": "Argomenti extra del runtime",
	"runtimeArgsDesc": "Aggiunti agli argv del runtime gestito; dal prossimo bcdp_*",
	"chromeArgs": "Argomenti extra di avvio Chrome",
	"chromeArgsDesc": "Aggiunti agli argv di avvio di Chrome; al prossimo avvio a freddo",
	"judgePrefer": "Ordine degli hop del giudice",
	"judgePreferDesc": "Separati da virgola; predefinito: \"laya,rule\"",
	"jevUrl": "URL di base JEV",
	"jevUrlDesc": "Vuoto = salta l'hop jev",
	"jevKey": "Chiave Bearer JEV",
	"jevKeyDesc": "Vuoto = l'hop jev è saltato",
	"jevModel": "Nome modello JEV",
	"jevChunkSize": "Candidati JEV per turno",
	"jevMaxImageBytes": "Budget di byte per frame JEV (0 = illimitato)",
	"jevHistoryLimit": "Finestra di passi recenti JEV",
	"jevArchiveImage": "Incorpora screenshot nell'archivio",
	"jevEvaluate": "Valuta ogni azione con il giudice",
	"jevEvaluateDesc": "Costa una chiamata di giudizio per azione",
	"jevStepBudget": "Turni per esecuzione bcdp_jev_run",
	"jevWallMs": "Limite di tempo reale per esecuzione (ms)",
	"layaUrl": "URL di base Laya",
	"layaUrlDesc": "Il sidecar serve la porta 8000",
	"layaKey": "Chiave Laya (obbligatoria)",
	"layaKeyDesc": "Le chiamate senza chiave ricevono un 401 assicurato",
	"layaModel": "Nome modello Laya",
	"linksTitle": "Destinazioni di connessione (ordine = priorità)",
	"linksEmpty": "Nessuna destinazione — aggiungi la prima con il modulo qui sotto",
	"linksEnabled": "Abilitato",
	"linksActive": "attivata",
	"linksAddCdp": "Aggiungi endpoint CDP",
	"linksAddCli": "Aggiungi ego CLI locale",
	"linksAddCliExists": "La connessione ego CLI locale esiste già — una sola per macchina",
	"linksEndpoint": "Endpoint",
	"linksEndpointHint": "http(s)://host:porta oppure ws(s)://…",
	"linksEndpointInvalid": "Endpoint non valido — non salvato",
	"linksCliPath": "Percorso ego CLI",
	"linksCliPathHint": "Vuoto = rilevamento automatico (PATH → bundle dell’app → runtime integrato)",
	"linksLabel": "Etichetta",
	"linksRemove": "Rimuovi",
	"linksMoveUp": "Sposta su",
	"linksMoveDown": "Sposta giù",
	"linksProbe": "Verifica",
	"linksProbing": "Verifica in corso…",
	"linksProbeOk": "raggiungibile",
	"linksProbeFail": "irraggiungibile",
	"linksLimitReached": "La sequenza è limitata a {n} voci",
	"linksWriteFailed": "Salvataggio non riuscito — il livello impostazioni ha rifiutato la scrittura",
	"linksCliRemoteWarn": "Attivare un link ego CLI con cdpMode=remote fallisce con mode-kind-mismatch",
	"linksCliSdk": "Usa harness integrato",
	"linksDisabledHint": "Disabilitato — abilitalo prima di attivarlo",
	"linksLocalRow": "Chrome locale (gestito)",
	"linksLocalEnableHint": "Selezionato = la modalità auto può ripiegare sul browser locale gestito se la destinazione attiva è irraggiungibile",
	"linksActivate": "attiva"
};
/** Russian dictionary, checked complete against the zh key set. */
const ru = {
	"title": "CDP-браузер",
	"titleLive": "CDP-браузер · В эфире",
	"liveView": "Окно наблюдения (только чтение)",
	"pinned": "Закреплено",
	"realtime": "Смотрит вживую",
	"noScreenshot": "(нет скриншота — about:blank или браузер не рендерит)",
	"noActivePages": "Нет активных страниц браузера",
	"noActiveHint": "Страницы появятся здесь, когда агент начнёт работать через bcdp_*",
	"openExternal": "Открыть реальную страницу",
	"raiseWindow": "В отдельное окно",
	"raiseWindowHint": "Показать браузер агента как реальное окно (headless-экземпляр заменяется видимым с тем же профилем, вкладки сохраняются)",
	"pickMode": "Выбрать элемент",
	"pickModeHint": "Кликните элемент на живой странице, чтобы процитировать его в диалог",
	"picking": "Выбор… кликните элемент на странице",
	"picked": "Элемент захвачен",
	"pickFailed": "Не удалось выбрать",
	"pickQuoted": "✓ Процитировано в поле ввода",
	"pickDeliverFailed": "Не удалось доставить",
	"noUrl": "Нет URL для открытия",
	"closeTab": "Закрыть вкладку",
	"newTab": "(новая вкладка)",
	"history": "История просмотров",
	"historyHide": "Скрыть историю",
	"historyShow": "Показать историю",
	"noHistory": "Истории просмотров нет",
	"current": "текущая",
	"refresh": "Обновить",
	"backToLive": "← Назад к живой трансляции",
	"dragHint": "Перетащите, чтобы переместить панель",
	"loginTitle": "Если нужен вход — выполните его в Chrome-окне «Мост CDP-браузера» на рабочем столе.",
	"loginBtn": "Вошёл, сохранить",
	"loginSaving": "Сохранение…",
	"loginSaved": "Сохранено сессий: {n}",
	"loginNotConnected": "Браузер не подключён",
	"loginFailed": "Не удалось сохранить",
	"loginDismiss": "Закрыть подсказку",
	"captchaTitle": "⚠️ Обнаружена проверка на человека",
	"captchaHint": "Завершите проверку в окне «Мост CDP-браузера» на рабочем столе; агент продолжит.",
	"captchaDismiss": "Закрыть подсказку",
	"hintReset": "Сброшено · колесо прокручивает · Ctrl+колесо масштабирует · двойной клик сбрасывает",
	"hintPan": "Ctrl+колесо масштабирует · Ctrl+перетаскивание сдвигает · двойной клик сбрасывает",
	"hintScroll": "Ctrl+перетаскивание сдвигает · колесо прокручивает",
	"hintNotCaptured": "Кадр не перехвачен · действие не доставлено · кликните ещё раз для восстановления",
	"failed": "сбой",
	"stale": "⚠ Не перехвачено",
	"captured": "Перехвачено",
	"fabTitle": "Живой вид CDP-браузера",
	"settingsTitle": "Показать настройки",
	"settingsHide": "Скрыть настройки",
	"famTitle": "CDP-браузер",
	"famIsolate": "Изоляция пространств",
	"famIsolateDesc": "Выкл = постоянный профиль (логины переживают перезапуск); вкл = изолированная песочница",
	"famIdle": "Автоостановка при простое (минуты, 0 = выкл)",
	"famIdleDesc": "Останавливает браузер через N минут без вызовов bcdp_*; перезапуск по требованию",
	"titleIdle": "Браузер агента",
	"videoUnsupported": "Этот браузер не поддерживает данный H.264-поток",
	"videoDisconnected": "Видеопоток прерван",
	"videoConnectFailed": "Не удалось подключиться к видеопотоку ({status})",
	"gBasic": "Основное",
	"gCapture": "Захват и трансляция",
	"gJudge": "Оценка (JEV / Laya)",
	"cdpMode": "Режим подключения",
	"cdpModeDesc": "auto = только активированная цель; remote = никогда не запускать локальный браузер; local = всегда локальное управление",
	"remoteEnabled": "Главный выключатель удалённого захвата",
	"remoteEnabledDesc": "Выкл = последовательность целей сохраняется, но не действует; на локальный режим не влияет",
	"allowLocalFallback": "Разрешить локальный откат в режиме auto",
	"allowLocalFallbackDesc": "auto может запустить локальный браузер, если активированная цель недоступна",
	"chromePath": "Путь к Chrome/Chromium",
	"chromePathDesc": "Пусто = определить автоматически",
	"localHeadless": "Запускать локальный браузер в headless",
	"localHeadlessDesc": "Относится только к локально запускаемому браузеру",
	"localUserDataDir": "Каталог профиля локального браузера",
	"localUserDataDirDesc": "Пусто = управляемый каталог; не указывайте на ваш повседневный профиль Chrome",
	"legacyEgoToolNames": "Регистрировать также старые имена ego_*",
	"legacyEgoToolNamesDesc": "Для скриптов до переименования в bcdp_*; несовместимо с апстрим-плагином ego-browser",
	"captureBackend": "Бэкенд захвата",
	"captureBackendDesc": "auto, cdp или ffmpeg",
	"streamProfile": "Профиль качества",
	"streamProfileDesc": "Общий пресет качества",
	"cdpFps": "FPS предпросмотра CDP",
	"cdpQuality": "Качество JPEG CDP",
	"cdpMaxWidth": "Макс. ширина кадра CDP",
	"cdpBackstopIntervalMs": "Интервал резервных скриншотов CDP (мс)",
	"ffmpegFps": "FPS видео FFmpeg",
	"ffmpegMaxWidth": "Макс. ширина FFmpeg",
	"ffmpegBitrateKbps": "Битрейт FFmpeg (кбит/с)",
	"ffmpegEncoder": "H.264-энкодер FFmpeg",
	"ffmpegPath": "Путь к FFmpeg",
	"ffmpegPathDesc": "Пусто = искать в PATH или управляемая установка",
	"cursorHud": "Рисовать HUD курсора на скриншотах",
	"cursorName": "Подпись HUD курсора",
	"githubMirror": "Зеркало загрузок GitHub",
	"githubMirrorDesc": "HTTPS-префикс вместо https://github.com для управляемых загрузок",
	"runtimeArgs": "Дополнительные аргументы рантайма",
	"runtimeArgsDesc": "Добавляются в argv управляемого рантайма; со следующего вызова bcdp_*",
	"chromeArgs": "Дополнительные аргументы запуска Chrome",
	"chromeArgsDesc": "Добавляются в argv запуска Chrome; со следующего холодного запуска",
	"judgePrefer": "Порядок шагов судьи",
	"judgePreferDesc": "Через запятую; по умолчанию: \"laya,rule\"",
	"jevUrl": "Базовый URL JEV",
	"jevUrlDesc": "Пусто = пропустить шаг jev",
	"jevKey": "Bearer-ключ JEV",
	"jevKeyDesc": "Пусто = шаг jev пропускается",
	"jevModel": "Имя модели JEV",
	"jevChunkSize": "Кандидатов JEV за тур",
	"jevMaxImageBytes": "Бюджет байтов на кадр JEV (0 = без лимита)",
	"jevHistoryLimit": "Окно последних шагов JEV",
	"jevArchiveImage": "Встраивать скриншот в архив",
	"jevEvaluate": "Оценивать каждое действие судьёй",
	"jevEvaluateDesc": "Стоит одного вызова оценки на действие",
	"jevStepBudget": "Циклов на выполнение bcdp_jev_run",
	"jevWallMs": "Лимит реального времени на выполнение (мс)",
	"layaUrl": "Базовый URL Laya",
	"layaUrlDesc": "Сайдкар обслуживает порт 8000",
	"layaKey": "Ключ Laya (обязателен)",
	"layaKeyDesc": "Без ключа гарантированно 401",
	"layaModel": "Имя модели Laya",
	"linksTitle": "Цели подключения (порядок = приоритет)",
	"linksEmpty": "Целей нет — добавьте первую через форму ниже",
	"linksEnabled": "Включено",
	"linksActive": "активна",
	"linksAddCdp": "Добавить CDP-эндпоинт",
	"linksAddCli": "Добавить локальный ego CLI",
	"linksAddCliExists": "Локальное подключение ego CLI уже существует — не более одного на машину",
	"linksEndpoint": "Эндпоинт",
	"linksEndpointHint": "http(s)://хост:порт или ws(s)://…",
	"linksEndpointInvalid": "Неверный эндпоинт — не сохранено",
	"linksCliPath": "Путь к ego CLI",
	"linksCliPathHint": "Пусто = автоопределение (PATH → пакет приложения → встроенный рантайм)",
	"linksLabel": "Метка",
	"linksRemove": "Удалить",
	"linksMoveUp": "Выше",
	"linksMoveDown": "Ниже",
	"linksProbe": "Проверить",
	"linksProbing": "Проверка…",
	"linksProbeOk": "доступен",
	"linksProbeFail": "недоступен",
	"linksLimitReached": "В последовательности не более {n} записей",
	"linksWriteFailed": "Не сохранено — слой настроек отклонил запись",
	"linksCliRemoteWarn": "Активация ego CLI при cdpMode=remote завершится ошибкой mode-kind-mismatch",
	"linksCliSdk": "Использовать встроенный harness",
	"linksDisabledHint": "Отключено — сначала включите, затем активируйте",
	"linksLocalRow": "Локальный Chrome (управляемый)",
	"linksLocalEnableHint": "Отмечено = режим auto может откатиться на управляемый локальный браузер, если активная цель недоступна",
	"linksActivate": "активировать"
};
/** Spanish dictionary, checked complete against the zh key set. */
const es = {
	"title": "Navegador CDP",
	"titleLive": "Navegador CDP · En vivo",
	"liveView": "Vista de observación (solo lectura)",
	"pinned": "Fijada",
	"realtime": "Navegando en vivo",
	"noScreenshot": "(sin captura — about:blank o el navegador no renderiza)",
	"noActivePages": "No hay páginas activas del navegador",
	"noActiveHint": "Las páginas aparecerán aquí cuando el agente navegue con bcdp_*",
	"openExternal": "Abrir página real",
	"raiseWindow": "Ventana emergente",
	"raiseWindowHint": "Muestra el navegador del agente como ventana real (una instancia headless se sustituye por una visible con el mismo perfil, sin perder pestañas)",
	"pickMode": "Elegir elemento",
	"pickModeHint": "Haz clic en un elemento de la página en vivo para citarlo en la conversación",
	"picking": "Selección… haz clic en un elemento de la página",
	"picked": "Elemento capturado",
	"pickFailed": "Selección fallida",
	"pickQuoted": "✓ Citado en el campo de entrada",
	"pickDeliverFailed": "Error al entregar",
	"noUrl": "No hay URL que abrir",
	"closeTab": "Cerrar pestaña",
	"newTab": "(nueva pestaña)",
	"history": "Historial de navegación",
	"historyHide": "Ocultar historial",
	"historyShow": "Mostrar historial",
	"noHistory": "Sin historial de navegación",
	"current": "actual",
	"refresh": "Actualizar",
	"backToLive": "← Volver a vivo",
	"dragHint": "Arrastra para mover el panel",
	"loginTitle": "Si requiere inicio de sesión, hazlo en la ventana de Chrome «Puente de navegador CDP» del escritorio.",
	"loginBtn": "Sesión iniciada, guardar",
	"loginSaving": "Guardando…",
	"loginSaved": "{n} sesiones guardadas",
	"loginNotConnected": "Navegador no conectado",
	"loginFailed": "Error al guardar",
	"loginDismiss": "Descartar",
	"captchaTitle": "⚠️ Verificación humana detectada",
	"captchaHint": "Completa la verificación en la ventana «Puente de navegador CDP» del escritorio; el agente continuará.",
	"captchaDismiss": "Descartar",
	"hintReset": "Restablecido · rueda para desplazar · Ctrl+rueda para zoom · doble clic para restablecer",
	"hintPan": "Ctrl+rueda para zoom · Ctrl+arrastrar para desplazar · doble clic para restablecer",
	"hintScroll": "Ctrl+arrastrar para desplazar · rueda para desplazar",
	"hintNotCaptured": "Pantalla no capturada · acción no entregada · haz clic de nuevo para recuperarla",
	"failed": "falló",
	"stale": "⚠ No capturada",
	"captured": "Capturada",
	"fabTitle": "Vista en vivo del navegador CDP",
	"settingsTitle": "Mostrar ajustes",
	"settingsHide": "Ocultar ajustes",
	"famTitle": "Navegador CDP",
	"famIsolate": "Aislamiento de espacios",
	"famIsolateDesc": "Off = perfil persistente (los inicios de sesión sobreviven reinicios); on = sandbox aislado cada vez",
	"famIdle": "Parada automática por inactividad (minutos, 0 = nunca)",
	"famIdleDesc": "Detiene el navegador tras N minutos sin llamadas bcdp_*; relanza bajo demanda",
	"titleIdle": "Navegador del agente",
	"videoUnsupported": "Este navegador no admite este flujo H.264",
	"videoDisconnected": "Flujo de vídeo interrumpido",
	"videoConnectFailed": "Error al conectar el flujo de vídeo ({status})",
	"gBasic": "Básico",
	"gCapture": "Captura y transmisión",
	"gJudge": "Enjuiciamiento (JEV / Laya)",
	"cdpMode": "Modo de conexión",
	"cdpModeDesc": "auto = solo destino activado; remote = nunca iniciar navegador local; local = control siempre local",
	"remoteEnabled": "Interruptor general del control remoto",
	"remoteEnabledDesc": "Off = la secuencia de destinos se conserva pero inactiva; no afecta al modo local",
	"allowLocalFallback": "Permitir reserva local en modo auto",
	"allowLocalFallbackDesc": "auto puede iniciar un navegador local si el destino activado es inalcanzable",
	"chromePath": "Ruta de Chrome/Chromium",
	"chromePathDesc": "Vacío = autodetectar",
	"localHeadless": "Iniciar el navegador local en headless",
	"localHeadlessDesc": "Solo se aplica al navegador iniciado localmente",
	"localUserDataDir": "Directorio de perfil del navegador local",
	"localUserDataDirDesc": "Vacío = directorio gestionado; no debe apuntar a tu perfil habitual de Chrome",
	"legacyEgoToolNames": "Registrar también los nombres antiguos ego_*",
	"legacyEgoToolNamesDesc": "Para scripts anteriores a la renomenclatura bcdp_*; incompatible con el plugin upstream ego-browser",
	"captureBackend": "Backend de captura",
	"captureBackendDesc": "auto, cdp o ffmpeg",
	"streamProfile": "Perfil de calidad",
	"streamProfileDesc": "Preajuste de calidad general",
	"cdpFps": "FPS de vista previa CDP",
	"cdpQuality": "Calidad JPEG de CDP",
	"cdpMaxWidth": "Ancho máximo de fotograma CDP",
	"cdpBackstopIntervalMs": "Intervalo de capturas de respaldo CDP (ms)",
	"ffmpegFps": "FPS de vídeo FFmpeg",
	"ffmpegMaxWidth": "Ancho máximo FFmpeg",
	"ffmpegBitrateKbps": "Tasa de bits FFmpeg (kbps)",
	"ffmpegEncoder": "Codificador H.264 de FFmpeg",
	"ffmpegPath": "Ruta de FFmpeg",
	"ffmpegPathDesc": "Vacío = detectar en PATH o instalación gestionada",
	"cursorHud": "Dibujar HUD del cursor en capturas",
	"cursorName": "Etiqueta del HUD del cursor",
	"githubMirror": "Espejo de descargas de GitHub",
	"githubMirrorDesc": "Prefijo HTTPS que sustituye a https://github.com en descargas gestionadas",
	"runtimeArgs": "Argumentos adicionales del runtime",
	"runtimeArgsDesc": "Añadidos a los argv del runtime gestionado; desde la siguiente llamada bcdp_*",
	"chromeArgs": "Argumentos adicionales de arranque de Chrome",
	"chromeArgsDesc": "Añadidos a los argv de arranque de Chrome; desde el próximo arranque en frío",
	"judgePrefer": "Orden de los saltos del juez",
	"judgePreferDesc": "Separados por comas; por defecto: \"laya,rule\"",
	"jevUrl": "URL base de JEV",
	"jevUrlDesc": "Vacío = saltar el paso jev",
	"jevKey": "Clave Bearer de JEV",
	"jevKeyDesc": "Vacío = se omite el paso jev",
	"jevModel": "Nombre del modelo JEV",
	"jevChunkSize": "Candidatos JEV por ronda",
	"jevMaxImageBytes": "Presupuesto de bytes por fotograma JEV (0 = sin límite)",
	"jevHistoryLimit": "Ventana de pasos recientes de JEV",
	"jevArchiveImage": "Incrustar captura en el archivo",
	"jevEvaluate": "Enjuiciar cada acción",
	"jevEvaluateDesc": "Conlleva una llamada de juicio por acción",
	"jevStepBudget": "Rondas por ejecución de bcdp_jev_run",
	"jevWallMs": "Límite de tiempo real por ejecución (ms)",
	"layaUrl": "URL base de Laya",
	"layaUrlDesc": "El sidecar sirve el puerto 8000",
	"layaKey": "Clave de Laya (obligatoria)",
	"layaKeyDesc": "Sin clave, 401 seguro",
	"layaModel": "Nombre del modelo Laya",
	"linksTitle": "Destinos de conexión (orden = prioridad)",
	"linksEmpty": "Sin destinos — añade el primero con el formulario de abajo",
	"linksEnabled": "Habilitado",
	"linksActive": "activado",
	"linksAddCdp": "Añadir endpoint CDP",
	"linksAddCli": "Añadir ego CLI local",
	"linksAddCliExists": "La conexión ego CLI local ya existe — una por máquina",
	"linksEndpoint": "Endpoint",
	"linksEndpointHint": "http(s)://host:puerto o ws(s)://…",
	"linksEndpointInvalid": "Endpoint no válido — no se guardó",
	"linksCliPath": "Ruta del ego CLI",
	"linksCliPathHint": "Vacío = detección automática (PATH → bundle de la app → runtime integrado)",
	"linksLabel": "Etiqueta",
	"linksRemove": "Quitar",
	"linksMoveUp": "Subir",
	"linksMoveDown": "Bajar",
	"linksProbe": "Probar",
	"linksProbing": "Probando…",
	"linksProbeOk": "alcanzable",
	"linksProbeFail": "inalcanzable",
	"linksLimitReached": "La secuencia está limitada a {n} entradas",
	"linksWriteFailed": "Error al guardar — la capa de ajustes rechazó esta escritura",
	"linksCliRemoteWarn": "Activar un enlace ego CLI con cdpMode=remote falla con mode-kind-mismatch",
	"linksCliSdk": "Usar harness integrado",
	"linksDisabledHint": "Desactivado — actívalo antes de activarlo",
	"linksLocalRow": "Chrome local (gestionado)",
	"linksLocalEnableHint": "Marcado = el modo auto puede replegarse al navegador local gestionado si el destino activo no responde",
	"linksActivate": "activar"
};
/** All nine dictionaries, handed to the locale service in ONE register call. */
const dictionaries = {
	zh,
	en,
	ja,
	ko,
	fr,
	de,
	it,
	ru,
	es
};

//#endregion
//#region src/client/fam-links.ts
/**
* Pure link-sequence operations behind the settings card's 连接目标 editor.
*
* The client bundle cannot reach `src/cdp-targets.ts` (its import graph drags
* node-side modules into the browser build), so the small rules the card needs
* live here — deliberately the SAME rules the host enforces on read
* (`sanitizeLinks`/`coerceLink`): ego-cli singleton, MAX cap, unusable-row
* rejection. The card writes the WHOLE `links` array in one `scope.set`
* (row-level volatile writes don't exist), which BYPASSES the host's
* `upsertLink` rejections — these prechecks are therefore the only guard, and
* the tests pin them to the host semantics.
*
* Two hard invariants (see plan `compat-0.2.0-dsh-browser-cdp` / findings
* Agent C §3):
* - a stored row's keys are all optional at runtime; edits must spread the
*   original row (`{...row, ...patch}`) so probe state survives — a rebuilt
*   thin row loses badges, and a bad `probeStatus` enum gets the WHOLE write
*   rejected by the settings layer;
* - a cdp row with an empty/invalid endpoint is silently dropped by the host's
*   `coerceLink` on next resolve — the card must refuse to persist one.
*
* No react import: this module is unit-tested directly under vitest's node
* environment (the client entry's `require('react')` makes index.ts
* un-importable there).
*/
/** Hard ceiling on the sequence length — mirrors host `MAX_TARGETS`. */
const MAX_LINKS = 32;
/** Local ego CLI singleton default label — mirrors host `EGO_CLI_LABEL`. */
const EGO_CLI_LABEL = "本机 ego CLI";
/** Fresh id, same shape as the host `newTargetId()` (uuid, `t-` fallback). */
function newLinkId() {
	const cryptoObj = globalThis.crypto;
	if (cryptoObj && typeof cryptoObj.randomUUID === "function") return cryptoObj.randomUUID();
	return `t-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
/**
* The card-side gate for persisting a cdp endpoint: non-empty and explicitly
* scheme-qualified. Anything else would pass the settings write and then be
* dropped by the host's `coerceLink` on the next resolve — invisible loss.
*/
function isValidEndpoint(value) {
	if (typeof value !== "string") return false;
	const v = value.trim();
	if (v === "") return false;
	return /^(https?|wss?):\/\//i.test(v);
}
function trimmed(value) {
	return typeof value === "string" ? value.trim() : "";
}
/** Full-field cdp row: probe five-piece defaults so the write passes the union. */
function buildCdpRow(input) {
	const endpoint = trimmed(input.endpoint);
	return {
		kind: "cdp",
		id: newLinkId(),
		label: trimmed(input.label) || endpoint,
		endpoint,
		enabled: true,
		note: "",
		probeStatus: "unknown",
		probeLatencyMs: 0,
		probeError: "",
		probeCode: "",
		probeAt: 0
	};
}
/** Full-field ego-cli row (`cliPath` '' = host auto-resolve chain). */
function buildCliRow(input) {
	const cliPath = trimmed(input.cliPath);
	return {
		kind: "ego-cli",
		id: newLinkId(),
		label: trimmed(input.label) || cliPath || EGO_CLI_LABEL,
		cliPath,
		useSdkPath: false,
		enabled: true,
		note: "",
		probeStatus: "unknown",
		probeLatencyMs: 0,
		probeError: "",
		probeCode: "",
		probeAt: 0
	};
}
/** Second ego-cli anywhere in the array would be silently dropped on read. */
function hasCliLink(links) {
	return links.some(function(row) {
		return row.kind === "ego-cli";
	});
}
function isFull(links) {
	return links.length >= MAX_LINKS;
}
/**
* Append a pre-built row behind the host's structured rejections: the card
* bypasses `upsertLink`, so the singleton and cap checks here are the only
* guard before the write.
*/
function addRow(links, row) {
	if (row.kind === "ego-cli" && hasCliLink(links)) return {
		links,
		code: "ego-cli-already-exists"
	};
	if (links.length >= MAX_LINKS) return {
		links,
		code: "link-limit-reached"
	};
	if (row.kind === "cdp" && !isValidEndpoint(row.endpoint)) return {
		links,
		code: "unusable-row"
	};
	return { links: links.concat([row]) };
}
/**
* Patch one row by id, spreading the ORIGINAL row so probe state and any
* field the patch omits survive verbatim. Unknown id → array returned
* unchanged (new reference only if the map ran; callers treat it as no-op).
*/
function updateRow(links, id, patch) {
	return links.map(function(row) {
		return row.id === id ? Object.assign({}, row, patch) : row;
	});
}
/**
* Filter one row out. Returns the removed row so the caller can clear
* `activeTargetId` when it was the activated one (clear, never advance —
* re-pointing every bcdp_* call at another browser is the host's job to
* refuse, not the card's to decide).
*/
function removeRow(links, id) {
	const removed = links.find(function(row) {
		return row.id === id;
	});
	return {
		links: links.filter(function(row) {
			return row.id !== id;
		}),
		removed
	};
}
/** ±1 neighbour swap; out-of-range leaves the order untouched. */
function moveRow(links, id, delta) {
	const index = links.findIndex(function(row) {
		return row.id === id;
	});
	const target = index + delta;
	if (index < 0 || target < 0 || target >= links.length) return links;
	const next = links.slice();
	const tmp = next[index];
	next[index] = next[target];
	next[target] = tmp;
	return next;
}
/** Write one probe outcome back into its row (spread-safe, full fields kept). */
function applyProbe(links, id, outcome, at) {
	return updateRow(links, id, {
		probeStatus: outcome.ok ? "ok" : "error",
		probeLatencyMs: typeof outcome.latencyMs === "number" ? outcome.latencyMs : 0,
		probeError: outcome.ok ? "" : outcome.message || "",
		probeCode: outcome.ok ? "" : outcome.code || "",
		probeAt: at
	});
}

//#endregion
//#region src/client/index.ts
var React = require("react");
var createSnapshotStore = require("@deepseek-ai/dsh-client-store").createSnapshotStore;
var useSyncExternalStore = React.useSyncExternalStore;
var useRef = React.useRef;
function bindSnapshotSelector(source) {
	var subscribe = function(fn) {
		return source.subscribe(fn);
	};
	var getSnapshot = function() {
		return source.getSnapshot();
	};
	return function useSelector(sel, eq) {
		var snapshot = useSyncExternalStore(subscribe, getSnapshot);
		var prevSnapshotRef = useRef();
		var prevSelectedRef = useRef();
		if (prevSnapshotRef.current !== snapshot) {
			prevSnapshotRef.current = snapshot;
			prevSelectedRef.current = sel(snapshot);
		}
		return prevSelectedRef.current;
	};
}
const inject = [
	"slots",
	"locale",
	"connection"
];
var _egoLocale = (function() {
	try {
		return (navigator.language || "").startsWith("zh") ? "zh" : "en";
	} catch {
		return "en";
	}
})();
var watchDict = dictionaries;
var _localeBind = null;
function wt(key, params = void 0) {
	var text = null;
	if (_localeBind) try {
		text = _localeBind(key) || null;
	} catch {
		text = null;
	}
	if (text == null) text = (watchDict[_egoLocale] || watchDict.en)[key] || key;
	if (params) for (var k in params) text = text.replace(new RegExp("{" + k + "}", "g"), String(params[k]));
	return text;
}
const SPACES_ROUTE = "/api/bcdp/spaces";
const EGO_CLOSE_ROUTE = "/api/bcdp/close";
const WATCH_START_ROUTE = "/api/bcdp/watch/start";
const WATCH_SWITCH_ROUTE = "/api/bcdp/watch/switch";
const WATCH_STOP_ROUTE = "/api/bcdp/watch/stop";
const WATCH_STATUS_ROUTE = "/api/bcdp/watch/status";
const VIDEO_ROUTE = "/api/bcdp/video";
function postJson(path, body) {
	return fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body || {})
	}).then(function(res) {
		return res.json().catch(function() {
			return {};
		});
	});
}
function createKeyboardProxy(send) {
	var input = document.createElement("textarea");
	input.className = "dsh-ego-keyboard-proxy";
	input.tabIndex = -1;
	input.setAttribute("autocomplete", "off");
	input.setAttribute("autocapitalize", "off");
	input.setAttribute("spellcheck", "false");
	input.style.cssText = "position:fixed;z-index:2147483647;width:1px;height:1px;opacity:.01;pointer-events:none;resize:none;padding:0;border:0;left:0;top:0;";
	document.body.appendChild(input);
	var composing = false;
	var armed = false;
	var activeTargetId = null;
	var pressed = /* @__PURE__ */ new Map();
	var lastCompositionText = "", lastCompositionAt = 0, lastPasteText = "", lastPasteAt = 0;
	var blurCount = 0, lastBlurAt = 0;
	var modifiers = function(e) {
		return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
	};
	var keyId = function(e) {
		return e.code || e.key;
	};
	var keyPayload = function(e) {
		return {
			key: e.key,
			code: e.code || "",
			modifiers: modifiers(e),
			autoRepeat: !!e.repeat,
			windowsVirtualKeyCode: Number(e.keyCode || e.which || 0)
		};
	};
	var isDshInput = function(target) {
		if (!target || target === input) return false;
		var tag = target.tagName;
		if (tag === "INPUT" || tag === "TEXTAREA") return true;
		if (target.isContentEditable) return true;
		return false;
	};
	var releaseAllKeys = function() {
		for (const record of pressed.values()) send(record.targetId, "keyUp", Object.assign({}, record.payload, { autoRepeat: false }));
		pressed.clear();
	};
	input.addEventListener("compositionstart", function(e) {
		composing = true;
		e.stopPropagation();
	});
	input.addEventListener("compositionend", function(e) {
		composing = false;
		e.stopPropagation();
		if (e.data && activeTargetId) {
			lastCompositionText = e.data;
			lastCompositionAt = Date.now();
			send(activeTargetId, "insertText", { text: e.data });
		}
		window.setTimeout(function() {
			input.value = "";
		}, 0);
	});
	input.addEventListener("beforeinput", function(e) {
		e.stopPropagation();
		if (composing || /Composition/i.test(e.inputType || "")) return;
		if (e.data && e.data === lastCompositionText && Date.now() - lastCompositionAt < 100) {
			e.preventDefault();
			return;
		}
		if (e.data && e.data === lastPasteText && Date.now() - lastPasteAt < 100) {
			e.preventDefault();
			return;
		}
		if (e.data && activeTargetId) {
			e.preventDefault();
			send(activeTargetId, "insertText", { text: e.data });
			input.value = "";
		}
	});
	input.addEventListener("paste", function(e) {
		var text = e.clipboardData && e.clipboardData.getData("text/plain");
		if (!text) return;
		e.preventDefault();
		e.stopPropagation();
		lastPasteText = text;
		lastPasteAt = Date.now();
		if (activeTargetId) send(activeTargetId, "insertText", { text });
		input.value = "";
	});
	input.addEventListener("keydown", function(e) {
		e.stopPropagation();
		if (composing || e.key === "Process" || e.key === "Dead") return;
		if (e.getModifierState && e.getModifierState("AltGraph") && e.key.length === 1) return;
		var isShortcut = e.ctrlKey || e.metaKey || e.altKey;
		var isControl = e.key.length > 1;
		if (!isShortcut && !isControl) return;
		if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "v") return;
		if (!activeTargetId) return;
		e.preventDefault();
		var payload = keyPayload(e);
		pressed.set(keyId(e), {
			targetId: activeTargetId,
			payload
		});
		send(activeTargetId, "keyDown", payload);
	});
	input.addEventListener("keyup", function(e) {
		e.stopPropagation();
		var id = keyId(e);
		var record = pressed.get(id);
		if (!record) return;
		e.preventDefault();
		pressed.delete(id);
		send(record.targetId, "keyUp", keyPayload(e));
	});
	input.addEventListener("blur", function() {
		if (!armed || !activeTargetId) return;
		var now = Date.now();
		if (now - lastBlurAt < 1e3) {
			blurCount++;
			if (blurCount > 3) return;
		} else blurCount = 0;
		lastBlurAt = now;
		window.setTimeout(function() {
			if (armed && activeTargetId) try {
				input.focus({ preventScroll: true });
			} catch (err) {
				input.focus();
			}
		}, 0);
	});
	var onDocKeyDown = function(e) {
		if (!armed || !activeTargetId) return;
		if (e.target === input) return;
		if (composing || e.key === "Process" || e.key === "Dead") return;
		if (e.getModifierState && e.getModifierState("AltGraph") && e.key.length === 1) return;
		if (isDshInput(e.target) && document.activeElement === e.target) return;
		var isShortcut = e.ctrlKey || e.metaKey || e.altKey;
		var isControl = e.key.length > 1;
		if (!isShortcut && !isControl) {
			e.preventDefault();
			e.stopPropagation();
			send(activeTargetId, "insertText", { text: e.key });
			return;
		}
		if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "v") return;
		e.preventDefault();
		e.stopPropagation();
		var payload = keyPayload(e);
		pressed.set(keyId(e), {
			targetId: activeTargetId,
			payload
		});
		send(activeTargetId, "keyDown", payload);
	};
	var onDocKeyUp = function(e) {
		if (!armed || !activeTargetId) return;
		if (e.target === input) return;
		var id = keyId(e);
		var record = pressed.get(id);
		if (!record) return;
		e.preventDefault();
		e.stopPropagation();
		pressed.delete(id);
		send(record.targetId, "keyUp", keyPayload(e));
	};
	var onDocPointerDown = function(e) {
		if (armed && isDshInput(e.target) && e.target !== input) {
			armed = false;
			releaseAllKeys();
		}
	};
	document.addEventListener("keydown", onDocKeyDown, true);
	document.addEventListener("keyup", onDocKeyUp, true);
	document.addEventListener("pointerdown", onDocPointerDown, true);
	return {
		focusAt: function(e, targetId) {
			if (activeTargetId && targetId !== activeTargetId) releaseAllKeys();
			activeTargetId = targetId;
			armed = true;
			blurCount = 0;
			input.style.left = Math.max(0, e.clientX) + "px";
			input.style.top = Math.max(0, e.clientY) + "px";
			try {
				input.focus({ preventScroll: true });
			} catch (err) {
				input.focus();
			}
		},
		dispose: function() {
			armed = false;
			document.removeEventListener("keydown", onDocKeyDown, true);
			document.removeEventListener("keyup", onDocKeyUp, true);
			document.removeEventListener("pointerdown", onDocPointerDown, true);
			releaseAllKeys();
			input.remove();
		}
	};
}
function createMsePlayer(video, generation, mime, onFailure) {
	if (!window.MediaSource || !window.MediaSource.isTypeSupported(mime)) {
		onFailure(wt("videoUnsupported"));
		return function() {};
	}
	var mediaSource = new MediaSource();
	var objectUrl = URL.createObjectURL(mediaSource);
	var abort = new AbortController();
	var sourceBuffer = null, queue = [], queuedBytes = 0, disposed = false, reader = null, reading = false;
	var MAX_QUEUED_VIDEO_BYTES = 4 * 1024 * 1024;
	video.src = objectUrl;
	video.muted = true;
	video.autoplay = true;
	video.playsInline = true;
	function appendNext() {
		if (disposed || !sourceBuffer || sourceBuffer.updating || queue.length === 0) return;
		var chunk = queue.shift();
		queuedBytes -= chunk.byteLength;
		try {
			sourceBuffer.appendBuffer(chunk);
		} catch (error) {
			onFailure(error.message);
		}
	}
	function pump() {
		if (disposed || reading || !reader || queuedBytes >= MAX_QUEUED_VIDEO_BYTES) return;
		reading = true;
		reader.read().then(function(part) {
			reading = false;
			if (disposed) return;
			if (part.done) {
				onFailure(wt("videoDisconnected"));
				return;
			}
			queue.push(part.value);
			queuedBytes += part.value.byteLength;
			appendNext();
			pump();
		}).catch(function(error) {
			reading = false;
			if (!disposed && error.name !== "AbortError") onFailure(error.message);
		});
	}
	mediaSource.addEventListener("sourceopen", function() {
		if (disposed) return;
		try {
			sourceBuffer = mediaSource.addSourceBuffer(mime);
		} catch (error) {
			onFailure(error.message);
			return;
		}
		sourceBuffer.mode = "segments";
		sourceBuffer.addEventListener("updateend", function() {
			if (video.buffered.length) {
				var end = video.buffered.end(video.buffered.length - 1);
				if (end - video.currentTime > .8) video.currentTime = Math.max(0, end - .15);
				if (!sourceBuffer.updating && video.buffered.start(0) < end - 3) try {
					sourceBuffer.remove(video.buffered.start(0), end - 2);
				} catch (e) {}
			}
			appendNext();
			pump();
		});
		fetch(VIDEO_ROUTE + "?generation=" + encodeURIComponent(generation), { signal: abort.signal }).then(function(res) {
			if (!res.ok || !res.body) throw new Error(wt("videoConnectFailed", { status: res.status }));
			reader = res.body.getReader();
			pump();
		}).catch(function(error) {
			if (!disposed && error.name !== "AbortError") onFailure(error.message);
		});
	});
	return function() {
		disposed = true;
		abort.abort();
		queue = [];
		queuedBytes = 0;
		try {
			video.pause();
			video.removeAttribute("src");
			video.load();
		} catch (e) {}
		try {
			URL.revokeObjectURL(objectUrl);
		} catch (e) {}
	};
}
const OPEN_KEY = "dsh.ego.watch.open";
const ACTIVE_WINDOW_MS = 3e3;
const PANEL_CSS = `
/* ---- deep Apple / macOS dark-glass chrome ---- */
:root { --ego-ios-gap: 6px; }

#dsh-ego-fab {
  position: fixed; left: 0; top: 0; z-index: 9999;
  width: 48px; height: 48px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(30,30,32,.72);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  color: #f5f5f7; cursor: grab;
  touch-action: none; user-select: none; -webkit-user-select: none;
  box-shadow: 0 10px 30px rgba(0,0,0,.45);
  display: flex; align-items: center; justify-content: center;
}
#dsh-ego-fab.dsh-ego-dragging { cursor: grabbing; opacity:.85; }
#dsh-ego-fab:hover { transform: scale(1.09); }
#dsh-ego-fab[hidden] { display: none; }
#dsh-ego-fab .dsh-ego-dot {
  position: absolute; top: 1px; right: 1px; width: 11px; height: 11px;
  border-radius: 50%; background: #86868b;
  border: 2px solid rgba(30,30,32,.9);
}
#dsh-ego-fab svg { width: 22px; height: 22px; }
/* FAB status dot: steady green while the agent is driving the browser
   (busy), breathing green when idle (browser open, no recent action). */
#dsh-ego-fab.dsh-ego-live:not(.dsh-ego-busy) .dsh-ego-dot {
  background: #30d158; box-shadow: 0 0 8px #30d158aa;
  animation: dsh-ego-breathe 2.4s ease-in-out infinite;
}
#dsh-ego-fab.dsh-ego-busy .dsh-ego-dot {
  background: #30d158; box-shadow: 0 0 9px #30d158cc; animation: none;
}
@keyframes dsh-ego-breathe {
  0%, 100% { box-shadow: 0 0 2px #30d15822; opacity: .5; }
  50%      { box-shadow: 0 0 11px #30d158ee; opacity: 1; }
}

#dsh-ego-panel {
  position: fixed; left: 0; top: 0; z-index: 9998;
  width: 408px; max-height: 78vh;
  display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 16px;
  background: rgba(28,28,30,.74);
  -webkit-backdrop-filter: blur(26px) saturate(180%);
  backdrop-filter: blur(26px) saturate(180%);
  color: #f5f5f7;
  box-shadow: 0 14px 44px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08);
  /* Pop-out animation: the panel springs up-left out of the ball's spot.
     transform-origin sits near its bottom-right (closest to the FAB). */
  opacity: 0; pointer-events: none;
  transform-origin: 82% 100%;
  transform: translateY(12px) scale(.88);
  transition: opacity .26s cubic-bezier(.16,.8,.3,1.05),
              transform .26s cubic-bezier(.16,.8,.3,1.15),
              visibility .26s;
  will-change: transform, opacity;
}
#dsh-ego-panel.dsh-ego-panel-open { opacity: 1; pointer-events: auto; transform: none; }
#dsh-ego-panel[hidden] { display: none; }
#dsh-ego-panel.open-drawer { width: 640px; }

/* FAB press / open feedback */
#dsh-ego-fab:active { transform: scale(.95); }
#dsh-ego-fab.dsh-ego-on { transform: scale(1.12); box-shadow: 0 0 0 6px rgba(10,132,255,.22), 0 10px 30px rgba(0,0,0,.5); }
#dsh-ego-fab.dsh-ego-on:hover { transform: scale(1.18); }

/* Drag handles for the panel: its header doubles as a title-bar grip. */
#dsh-ego-head { cursor: grab; }
#dsh-ego-head.dsh-ego-grabbing { cursor: grabbing; }
#dsh-ego-head .dsh-ego-grip {
  flex: none; width: 22px; height: 22px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  color:#86868b; opacity:.8;
}
#dsh-ego-head .dsh-ego-grip svg { width: 13px; height: 13px; }

#dsh-ego-head { display:flex; align-items:center; gap:4px; padding:10px 14px;
  border-bottom:1px solid rgba(255,255,255,.08); }
#dsh-ego-title { flex:1; font-size:13px; font-weight:600; letter-spacing:.2px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:6px; }
#dsh-ego-title svg { width:16px; height:16px; color:#0a84ff; flex-shrink:0; }
#dsh-ego-iconbtn {
  background: transparent; border:none; color: #aeaeb2; cursor: pointer;
  width: 28px; height: 28px; border-radius: 8px; padding: 0;
  display:flex; align-items:center; justify-content:center;
  transition: background .15s ease, color .15s ease;
}
#dsh-ego-iconbtn svg { width: 15px; height: 15px; }
#dsh-ego-iconbtn:hover { background: rgba(255,255,255,.12); color: #f5f5f7; }
#dsh-ego-iconbtn.off { opacity:.5; }
#dsh-ego-iconbtn.spinning svg { animation: dsh-ego-spin .7s linear infinite; }
@keyframes dsh-ego-spin { to { transform: rotate(360deg); } }

#dsh-ego-body { flex:1; overflow-y:auto; padding:12px 14px; min-height:60px; }
.dsh-ego-empty { padding:20px 12px; text-align:center; color:#86868b; font-size:12.5px; line-height:1.7; }
.dsh-ego-off { padding:6px 14px 10px; text-align:center; font-size:11px; color:#6e6e73; }
.dsh-ego-off svg { width:11px; height:11px; vertical-align:-1px; color:#6e6e73; }

/* ---- login guide strip (top of the panel body) ---- */
#dsh-ego-login { display:none; align-items:center; gap:8px; margin:0 14px 9px; padding:7px 10px;
  border-radius:9px; border:1px solid rgba(255,214,10,.28); background: rgba(255,214,10,.09); }
#dsh-ego-login.show { display:flex; }
#dsh-ego-login .dsh-ego-login-txt { flex:1; min-width:0; font-size:11px; line-height:1.45; color:#f5f5f7; }
#dsh-ego-login .dsh-ego-login-txt b { color:#ffd60a; }
#dsh-ego-login .dsh-ego-login-btn { flex:none; background:#0a84ff; color:#fff; border:none; border-radius:8px;
  font-size:11px; padding:4px 10px; cursor:pointer; white-space:nowrap; transition: background .15s ease; }
#dsh-ego-login .dsh-ego-login-btn:hover { background:#338cff; }
#dsh-ego-login .dsh-ego-login-btn.saving { opacity:.55; pointer-events:none; }
#dsh-ego-login .dsh-ego-login-note { flex:none; font-size:10.5px; color:#6e6e73; white-space:nowrap; }
/* dismiss (×) on guide strips so the user can close them and reclaim the space */
.dsh-ego-dismiss { flex:none; width:18px; height:18px; line-height:1; border-radius:50%; border:none;
  background: rgba(255,255,255,.12); color:inherit; font-size:13px; cursor:pointer; opacity:.75;
  display:inline-flex; align-items:center; justify-content:center; padding:0; transition: background .15s,opacity .15s; }
.dsh-ego-dismiss:hover { background: rgba(255,69,58,.35); opacity:1; }
#dsh-ego-login .dsh-ego-dismiss { color:#ffd60a; }
#dsh-ego-captcha .dsh-ego-dismiss { color:#ffd8d5; }

/* ---- human-verification (CAPTCHA) reminder strip ---- */
#dsh-ego-captcha { display:none; align-items:center; gap:8px; margin:0 14px 9px; padding:8px 11px;
  border-radius:9px; border:1px solid rgba(255,69,58,.4); background: rgba(255,69,58,.13); color:#ffe1de; }
#dsh-ego-captcha.show { display:flex; }
#dsh-ego-captcha .dsh-ego-captcha-txt { flex:1; min-width:0; font-size:11.5px; line-height:1.5; }
#dsh-ego-captcha .dsh-ego-captcha-txt b { color:#ff6961; }
#dsh-ego-captcha .dsh-ego-captcha-kind { flex:none; font-size:10px; padding:2px 8px; border-radius:999px;
  background: rgba(255,255,255,.12); color:#ffd8d5; text-transform:uppercase; letter-spacing:.4px; }

/* ---- tab bar: frosted pills ---- */
#dsh-ego-tabs { display:flex; gap:6px; padding:9px 12px;
  border-bottom:1px solid rgba(255,255,255,.08); overflow-x:auto; flex-shrink:0; scrollbar-width:thin; }
#dsh-ego-tabs:empty { display:none; }
.dsh-ego-tab {
  display:inline-flex; align-items:center; gap:6px; max-width:176px; white-space:nowrap;
  padding:5px 12px; border-radius: 999px; cursor:pointer; font-size:11.5px; flex-shrink:0;
  border:1px solid rgba(255,255,255,.1);
  background: rgba(72,72,74,.45); color:#aeaeb2;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}
.dsh-ego-tab > .dsh-ego-tabtxt { overflow:hidden; text-overflow:ellipsis; }
.dsh-ego-tab:hover { color:#f5f5f7; background: rgba(72,72,74,.65); }
.dsh-ego-tab.active {
  background: #0a84ff; color:#fff; border-color: transparent;
  box-shadow: 0 2px 10px rgba(10,132,255,.35);
}
.dsh-ego-tab .dsh-ego-tabdot { width:7px; height:7px; border-radius:50%; background:#86868b; flex-shrink:0; }
.dsh-ego-tab.active .dsh-ego-tabdot { background:#fff; }
.dsh-ego-tab .dsh-ego-tabclose { flex-shrink:0; width:14px; height:14px; line-height:13px; text-align:center;
  border-radius:50%; font-size:12px; color:#86868b; margin-left:2px; }
.dsh-ego-tab .dsh-ego-tabclose:hover { background:rgba(255,255,255,.2); color:#ff453a; }
.dsh-ego-tab.active .dsh-ego-tabclose { color:rgba(255,255,255,.85); }
.dsh-ego-tab.active .dsh-ego-tabclose:hover { color:#ff453a; background:rgba(255,255,255,.25); }

/* ---- main live view ---- */
.dsh-ego-liveview { display:flex; flex-direction:column; gap:9px; min-height:60px;
  overflow:hidden; /* clips the zoomed image so it doesn't bleed outside */ }
.dsh-ego-livebadge { font-size:11px; color:#86868b; letter-spacing:.3px;
  display:flex; align-items:center; gap:6px; }
.dsh-ego-state-dot { display:inline-block; width:8px; height:8px; border-radius:50%;
  background:#30d158; box-shadow:0 0 6px #30d15888; flex-shrink:0;
  animation: dsh-ego-breathe 2.4s ease-in-out infinite; }
.dsh-ego-state-dot.busy { background:#30d158; box-shadow:0 0 7px #30d158bb; animation:none; }
.dsh-ego-state-dot.pin { background:#0a84ff; box-shadow:0 0 6px #0a84ff88; animation:none; }
.dsh-ego-back {
  background: rgba(255,255,255,.12); color:#f5f5f7;
  border:1px solid rgba(255,255,255,.12); border-radius:7px;
  cursor:pointer; font-size:11px; padding:3px 9px;
  display:inline-flex; align-items:center; gap:4px;
  transition: background .15s ease;
}
.dsh-ego-back:hover { background: rgba(255,255,255,.2); }
.dsh-ego-back.dsh-ego-pick-on { background: rgba(56,189,248,.3); color: #7dd3fc; }
.dsh-ego-liveimg {
  width:100%; border-radius:11px; display:block;
  max-height:50vh; object-fit:contain;
  border:1px solid rgba(255,255,255,.14);
  background:#000; /* letterbox behind landscape jpeg */
  box-shadow: 0 4px 16px rgba(0,0,0,.35);
  user-select:none; -webkit-user-select:none; touch-action:none;
  will-change:transform; cursor:grab;
}
.dsh-ego-zoomhint { font-size:10.5px; color:#6e6e73; letter-spacing:.2px; margin-top:-3px; }
.dsh-ego-livetitle { font-size:13px; font-weight:600; }
.dsh-ego-liveurl { font-size:11.5px; color:#86868b; word-break:break-all; }
.dsh-ego-liveurl.dsh-ego-hint { color:#75c2ff; font-style:italic; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow:0 0 6px rgba(117,194,255,.4); }
.dsh-ego-hint { animation: dsh-ego-hint-in .2s ease; }
@keyframes dsh-ego-hint-in { from { opacity:.3 } to { opacity:1 } }

/* ---- history drawer ---- */
#dsh-ego-history { display:none; flex-direction:column; width:224px; flex-shrink:0;
  border-left:1px solid rgba(255,255,255,.08); background: rgba(0,0,0,.18); }
#dsh-ego-history.open { display:flex; }
#dsh-ego-historyhead { padding:9px 12px; font-size:12px; font-weight:600; color:#86868b;
  display:flex; align-items:center; gap:6px;
  border-bottom:1px solid rgba(255,255,255,.06); }
#dsh-ego-historyhead svg { width:12px; height:12px; }
#dsh-ego-historylist { overflow-y:auto; padding:7px; }
.dsh-ego-hitem { display:flex; gap:8px; align-items:center; padding:6px; border-radius:9px; cursor:pointer;
  transition: background .15s ease; }
.dsh-ego-hitem:hover { background: rgba(255,255,255,.1); }
.dsh-ego-hthumb { width:58px; height:42px; border-radius:6px; object-fit:cover; background:#000;
  flex-shrink:0; border:1px solid rgba(255,255,255,.14); }
.dsh-ego-hinfo { min-width:0; }
.dsh-ego-hurl { font-size:10.5px; color:#86868b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dsh-ego-htitle { font-size:10.5px; font-weight:500; color:#f5f5f7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dsh-ego-hactive { color:#30d158; font-size:10.5px; }
.dsh-ego-hnone { padding:16px 8px; text-align:center; font-size:11px; color:#6e6e73; }

#dsh-ego-cols { display:flex; flex:1; min-height:0; }
.dsh-ego-maincol { flex:1; min-width:0; display:flex; flex-direction:column; }
`;
const ICON_GLOBE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3c2.5 2.4 3.8 5.4 3.8 9S14.5 18.6 12 21"/><path d="M12 3C9.5 5.4 8.2 8.4 8.2 12s1.3 6.6 3.8 9"/><path d="M3 12h18"/></svg>`;
const ICON_REFRESH = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4.5V9h-4.5"/></svg>`;
const ICON_CLOCK = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>`;
const ICON_CLOSE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const ICON_GRIP = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="1.8"/><circle cx="16" cy="6" r="1.8"/><circle cx="8" cy="12" r="1.8"/><circle cx="16" cy="12" r="1.8"/><circle cx="8" cy="18" r="1.8"/><circle cx="16" cy="18" r="1.8"/></svg>`;
function mountFamilySettingsCard(ctx) {
	var forms = typeof ctx.get === "function" ? ctx.get("configForms") : void 0;
	if (!forms || typeof forms.get !== "function") return;
	var scope = forms.get("dsh-browser-cdp");
	ctx.slots.inject("dsh-family.tab", function() {
		return ctx.slots.register({
			name: "dsh-family.tab",
			id: "dsh-browser-cdp",
			order: 35,
			label: function() {
				return wt("famTitle");
			},
			inject: function() {
				return { scope };
			}
		}, FamilySettingsCard);
	}, "dsh-browser-cdp: family settings tab");
}
function mountPluginsPageCard(ctx) {
	var forms = typeof ctx.get === "function" ? ctx.get("configForms") : void 0;
	if (!forms || typeof forms.get !== "function") return;
	var scope = forms.get("dsh-browser-cdp");
	ctx.slots.inject("plugins.bundle.config", function() {
		return ctx.slots.register({
			name: "plugins.bundle.config",
			key: "dsh-browser-cdp",
			locale: NS,
			inject: function() {
				return { scope };
			}
		}, FamilySettingsCard);
	}, "dsh-browser-cdp: plugins-page config card");
}
var FAM_FIELD_GROUPS = [
	{
		gk: "gBasic",
		fields: [
			{
				k: "isolateSpaces",
				kind: "bool",
				lk: "famIsolate",
				dk: "famIsolateDesc"
			},
			{
				k: "idleTimeoutMin",
				kind: "num",
				min: 0,
				max: 1440,
				step: 1,
				lk: "famIdle",
				dk: "famIdleDesc"
			},
			{
				k: "cdpMode",
				kind: "sel",
				options: [
					"auto",
					"local",
					"remote"
				],
				lk: "cdpMode",
				dk: "cdpModeDesc"
			},
			{
				k: "remoteEnabled",
				kind: "bool",
				lk: "remoteEnabled",
				dk: "remoteEnabledDesc"
			},
			{
				k: "allowLocalFallback",
				kind: "bool",
				lk: "allowLocalFallback",
				dk: "allowLocalFallbackDesc"
			},
			{
				k: "chromePath",
				kind: "str",
				lk: "chromePath",
				dk: "chromePathDesc"
			},
			{
				k: "localHeadless",
				kind: "bool",
				lk: "localHeadless",
				dk: "localHeadlessDesc"
			},
			{
				k: "localUserDataDir",
				kind: "str",
				lk: "localUserDataDir",
				dk: "localUserDataDirDesc"
			},
			{
				k: "legacyEgoToolNames",
				kind: "bool",
				lk: "legacyEgoToolNames",
				dk: "legacyEgoToolNamesDesc"
			}
		]
	},
	{
		gk: "gCapture",
		fields: [
			{
				k: "captureBackend",
				kind: "sel",
				options: [
					"auto",
					"cdp",
					"ffmpeg"
				],
				lk: "captureBackend",
				dk: "captureBackendDesc"
			},
			{
				k: "streamProfile",
				kind: "sel",
				options: [
					"low",
					"balanced",
					"high"
				],
				lk: "streamProfile",
				dk: "streamProfileDesc"
			},
			{
				k: "cdpFps",
				kind: "num",
				min: 5,
				max: 30,
				step: 1,
				lk: "cdpFps"
			},
			{
				k: "cdpQuality",
				kind: "num",
				min: 1,
				max: 100,
				step: 1,
				lk: "cdpQuality"
			},
			{
				k: "cdpMaxWidth",
				kind: "num",
				min: 320,
				max: 1920,
				step: 40,
				lk: "cdpMaxWidth"
			},
			{
				k: "cdpBackstopIntervalMs",
				kind: "num",
				min: 1e3,
				max: 1e4,
				step: 100,
				lk: "cdpBackstopIntervalMs"
			},
			{
				k: "ffmpegFps",
				kind: "num",
				min: 5,
				max: 30,
				step: 1,
				lk: "ffmpegFps"
			},
			{
				k: "ffmpegMaxWidth",
				kind: "num",
				min: 320,
				max: 1920,
				step: 40,
				lk: "ffmpegMaxWidth"
			},
			{
				k: "ffmpegBitrateKbps",
				kind: "num",
				min: 500,
				max: 2e4,
				step: 250,
				lk: "ffmpegBitrateKbps"
			},
			{
				k: "ffmpegEncoder",
				kind: "sel",
				options: [
					"auto",
					"software",
					"h264_mf",
					"h264_nvenc",
					"h264_qsv",
					"h264_amf",
					"h264_videotoolbox",
					"h264_vaapi"
				],
				lk: "ffmpegEncoder"
			},
			{
				k: "ffmpegPath",
				kind: "str",
				lk: "ffmpegPath",
				dk: "ffmpegPathDesc"
			},
			{
				k: "cursorHud",
				kind: "bool",
				lk: "cursorHud"
			},
			{
				k: "cursorName",
				kind: "str",
				lk: "cursorName"
			},
			{
				k: "githubMirror",
				kind: "str",
				lk: "githubMirror",
				dk: "githubMirrorDesc"
			},
			{
				k: "runtimeArgs",
				kind: "str",
				lk: "runtimeArgs",
				dk: "runtimeArgsDesc"
			},
			{
				k: "chromeArgs",
				kind: "str",
				lk: "chromeArgs",
				dk: "chromeArgsDesc"
			}
		]
	},
	{
		gk: "gJudge",
		fields: [
			{
				k: "judgePrefer",
				kind: "str",
				lk: "judgePrefer",
				dk: "judgePreferDesc"
			},
			{
				k: "jevUrl",
				kind: "str",
				lk: "jevUrl",
				dk: "jevUrlDesc"
			},
			{
				k: "jevKey",
				kind: "secret",
				lk: "jevKey",
				dk: "jevKeyDesc"
			},
			{
				k: "jevModel",
				kind: "str",
				lk: "jevModel"
			},
			{
				k: "jevChunkSize",
				kind: "num",
				min: 1,
				max: 255,
				step: 1,
				lk: "jevChunkSize"
			},
			{
				k: "jevMaxImageBytes",
				kind: "num",
				min: 0,
				step: 1024,
				lk: "jevMaxImageBytes"
			},
			{
				k: "jevHistoryLimit",
				kind: "num",
				min: 0,
				max: 20,
				step: 1,
				lk: "jevHistoryLimit"
			},
			{
				k: "jevArchiveImage",
				kind: "bool",
				lk: "jevArchiveImage"
			},
			{
				k: "jevEvaluate",
				kind: "bool",
				lk: "jevEvaluate",
				dk: "jevEvaluateDesc"
			},
			{
				k: "jevStepBudget",
				kind: "num",
				min: 1,
				max: 200,
				step: 1,
				lk: "jevStepBudget"
			},
			{
				k: "jevWallMs",
				kind: "num",
				min: 1e3,
				max: 36e5,
				step: 1e3,
				lk: "jevWallMs"
			},
			{
				k: "layaUrl",
				kind: "str",
				lk: "layaUrl",
				dk: "layaUrlDesc"
			},
			{
				k: "layaKey",
				kind: "secret",
				lk: "layaKey",
				dk: "layaKeyDesc"
			},
			{
				k: "layaModel",
				kind: "str",
				lk: "layaModel"
			}
		]
	}
];
function famText(item, kind) {
	if (kind === "title") return wt(item.lk);
	return item.dk ? wt(item.dk) : "";
}
function FamilySettingsCard(props) {
	var scope = props.scope;
	var snapshot = React.useSyncExternalStore(function(listener) {
		return scope.subscribe(listener);
	}, function() {
		return scope.getSnapshot();
	});
	var value = snapshot.value || {};
	var writable = snapshot.writable === true;
	var h = React.createElement;
	return h("div", { style: {
		display: "grid",
		gap: "8px"
	} }, FAM_FIELD_GROUPS.map(function(group) {
		return h(FamGroup, {
			key: group.gk,
			group,
			value,
			writable,
			scope
		});
	}), h(FamLinks, {
		key: "links",
		value,
		writable,
		scope
	}));
}
function FamGroup(props) {
	var group = props.group;
	var h = React.createElement;
	return h("div", { style: {
		borderTop: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))",
		paddingTop: "6px"
	} }, h("div", { style: {
		fontSize: "12px",
		fontWeight: 600,
		color: "var(--dsw-alias-label-secondary, rgba(127,127,127,.9))",
		padding: "2px 0 4px"
	} }, wt(group.gk)), group.fields.map(function(f) {
		return h(FamField, {
			key: f.k,
			f,
			group,
			...props
		});
	}));
}
function FamField(props) {
	var f = props.f;
	var value = props.value;
	var writable = props.writable;
	var scope = props.scope;
	var h = React.createElement;
	var rowStyle = {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "12px",
		padding: "6px 0"
	};
	var label = h("div", { style: {
		display: "flex",
		flexDirection: "column",
		gap: "2px",
		minWidth: 0
	} }, h("span", { style: {
		fontSize: "13px",
		color: "var(--dsw-alias-label-primary, inherit)"
	} }, famText(f, "title")), f.desc === false || !famText(f, "desc") ? null : h("span", { style: {
		fontSize: "12px",
		color: "var(--dsw-alias-label-tertiary, rgba(127,127,127,.8))",
		lineHeight: 1.5
	} }, famText(f, "desc")));
	if (f.kind === "bool") return h("div", { style: rowStyle }, label, h("input", {
		type: "checkbox",
		checked: value[f.k] === true,
		disabled: !writable,
		onChange: function(e) {
			scope.set(f.k, e.target.checked);
		}
	}));
	if (f.kind === "num") return h("div", { style: rowStyle }, label, h(FamNumInput, {
		f,
		v: value[f.k],
		writable,
		scope
	}));
	if (f.kind === "sel") return h("div", { style: rowStyle }, label, h("select", {
		value: String(value[f.k] ?? f.options[0]),
		disabled: !writable,
		style: {
			font: "inherit",
			color: "inherit",
			background: "var(--dsw-alias-bg-module-platform, rgba(127,127,127,.08))",
			border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))",
			borderRadius: "8px",
			padding: "4px 8px"
		},
		onChange: function(e) {
			scope.set(f.k, e.target.value);
		}
	}, f.options.map(function(o) {
		return h("option", {
			key: o,
			value: o
		}, o);
	})));
	return h("div", { style: {
		display: "grid",
		gap: "2px",
		padding: "6px 0"
	} }, label, h(FamStrInput, {
		f,
		v: value[f.k],
		writable,
		scope
	}));
}
function FamNumInput(props) {
	var f = props.f;
	var h = React.createElement;
	var draft = React.useState(props.v === void 0 || props.v === null ? "" : String(props.v));
	var v = draft[0], setV = draft[1];
	React.useEffect(function() {
		setV(props.v === void 0 || props.v === null ? "" : String(props.v));
	}, [props.v]);
	return h("input", {
		type: "number",
		min: f.min,
		max: f.max,
		step: f.step,
		value: v,
		disabled: !props.writable,
		style: {
			width: "96px",
			font: "inherit",
			color: "inherit",
			background: "var(--dsw-alias-bg-module-platform, rgba(127,127,127,.08))",
			border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))",
			borderRadius: "8px",
			padding: "4px 8px"
		},
		onChange: function(e) {
			setV(e.target.value);
		},
		onBlur: function() {
			if (v === "") return;
			var n = Number(v);
			if (!isFinite(n)) return;
			n = Math.round(n / (f.step || 1)) * (f.step || 1);
			if (f.min !== void 0) n = Math.max(f.min, n);
			if (f.max !== void 0) n = Math.min(f.max, n);
			props.scope.set(f.k, n);
		}
	});
}
function FamStrInput(props) {
	var f = props.f;
	var h = React.createElement;
	var draft = React.useState(props.v === void 0 || props.v === null ? "" : String(props.v));
	var v = draft[0], setV = draft[1];
	React.useEffect(function() {
		setV(props.v === void 0 || props.v === null ? "" : String(props.v));
	}, [props.v]);
	return h("input", {
		type: f.kind === "secret" ? "password" : "text",
		value: v,
		disabled: !props.writable,
		style: {
			width: "100%",
			font: "inherit",
			color: "inherit",
			background: "var(--dsw-alias-bg-module-platform, rgba(127,127,127,.08))",
			border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))",
			borderRadius: "8px",
			padding: "5px 10px",
			boxSizing: "border-box"
		},
		onChange: function(e) {
			setV(e.target.value);
		},
		onBlur: function() {
			props.scope.set(f.k, v);
		},
		onKeyDown: function(e) {
			if (e.key === "Enter") props.scope.set(f.k, v);
		}
	});
}
function FamRowInput(props) {
	var h = React.createElement;
	var empty = props.v === void 0 || props.v === null ? "" : String(props.v);
	var draft = React.useState(empty);
	var v = draft[0], setV = draft[1];
	React.useEffect(function() {
		setV(props.v === void 0 || props.v === null ? "" : String(props.v));
	}, [props.v]);
	function commit() {
		if (v !== empty) props.onCommit(v);
	}
	return h("input", {
		type: "text",
		value: v,
		disabled: !props.writable,
		placeholder: props.placeholder || "",
		style: {
			flex: "1 1 140px",
			minWidth: 0,
			font: "inherit",
			fontSize: "12px",
			color: "inherit",
			background: "var(--dsw-alias-bg-module-platform, rgba(127,127,127,.08))",
			border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))",
			borderRadius: "8px",
			padding: "3px 8px"
		},
		onChange: function(e) {
			setV(e.target.value);
		},
		onBlur: commit,
		onKeyDown: function(e) {
			if (e.key === "Enter") commit();
		}
	});
}
function FamLinks(props) {
	var value = props.value;
	var writable = props.writable;
	var scope = props.scope;
	var h = React.createElement;
	var links = Array.isArray(value.links) ? value.links : [];
	var activeId = typeof value.activeTargetId === "string" ? value.activeTargetId : "";
	var cdpMode = typeof value.cdpMode === "string" ? value.cdpMode : "auto";
	var errState = React.useState("");
	var errText = errState[0], setErrText = errState[1];
	var probeState = React.useState("");
	var probingId = probeState[0], setProbingId = probeState[1];
	var addLabelState = React.useState("");
	var addLabel = addLabelState[0], setAddLabel = addLabelState[1];
	var addEndpointState = React.useState("");
	var addEndpoint = addEndpointState[0], setAddEndpoint = addEndpointState[1];
	var addCliPathState = React.useState("");
	var addCliPath = addCliPathState[0], setAddCliPath = addCliPathState[1];
	var btnStyle = {
		font: "inherit",
		fontSize: "12px",
		cursor: writable ? "pointer" : "not-allowed",
		border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))",
		background: "none",
		color: "var(--dsw-alias-label-primary, inherit)",
		borderRadius: "8px",
		padding: "2px 8px",
		flex: "0 0 auto"
	};
	var badgeStyle = {
		fontSize: "10px",
		fontWeight: 600,
		letterSpacing: ".04em",
		flex: "0 0 auto",
		color: "var(--dsw-alias-label-tertiary, rgba(127,127,127,.7))",
		border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))",
		borderRadius: "6px",
		padding: "0 5px",
		lineHeight: "16px"
	};
	var inputStyle = {
		font: "inherit",
		fontSize: "12px",
		color: "inherit",
		background: "var(--dsw-alias-bg-module-platform, rgba(127,127,127,.08))",
		border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))",
		borderRadius: "8px",
		padding: "3px 8px"
	};
	function writeLinks(next) {
		Promise.resolve(scope.set("links", next)).then(function(ok) {
			if (ok === false) setErrText(wt("linksWriteFailed"));
		}, function() {
			setErrText(wt("linksWriteFailed"));
		});
	}
	function limitText() {
		return wt("linksLimitReached", { n: MAX_LINKS });
	}
	function addCdp() {
		if (!isValidEndpoint(addEndpoint)) {
			setErrText(wt("linksEndpointInvalid"));
			return;
		}
		var res = addRow(links, buildCdpRow({
			label: addLabel,
			endpoint: addEndpoint
		}));
		if (res.code) {
			setErrText(res.code === "link-limit-reached" ? limitText() : wt("linksEndpointInvalid"));
			return;
		}
		writeLinks(res.links);
		if (activeId === "") scope.set("activeTargetId", res.links[res.links.length - 1].id);
		setAddLabel("");
		setAddEndpoint("");
		setErrText("");
	}
	function addCli() {
		var res = addRow(links, buildCliRow({
			label: "",
			cliPath: addCliPath
		}));
		if (res.code) {
			setErrText(res.code === "link-limit-reached" ? limitText() : wt("linksAddCliExists"));
			return;
		}
		writeLinks(res.links);
		if (activeId === "") scope.set("activeTargetId", res.links[res.links.length - 1].id);
		setAddCliPath("");
		setErrText("");
	}
	function removeOne(row) {
		var res = removeRow(links, row.id);
		writeLinks(res.links);
		if (res.removed && res.removed.id !== void 0 && res.removed.id === activeId) scope.set("activeTargetId", "");
	}
	function probeOne(row) {
		if (probingId !== "" || !isValidEndpoint(row.endpoint)) return;
		setProbingId(row.id);
		setErrText("");
		postJson("/bcdp/api/cdp-probe", { endpoint: row.endpoint }).then(function(data) {
			var outcome = data && data.value && data.value.outcome ? data.value.outcome : {
				ok: false,
				code: "probe-failed",
				message: "no outcome"
			};
			writeLinks(applyProbe(links, row.id, outcome, Date.now()));
		}).catch(function(error) {
			writeLinks(applyProbe(links, row.id, {
				ok: false,
				code: "probe-failed",
				message: String(error && error.message || error)
			}, Date.now()));
		}).then(function() {
			setProbingId("");
		});
	}
	var localActive = cdpMode === "local";
	var localRow = h("div", {
		key: "fam-links-local",
		style: {
			borderTop: "1px dashed var(--dsw-alias-border-l2, rgba(127,127,127,.18))",
			padding: "6px 0",
			display: "grid",
			gap: "4px"
		}
	}, h("div", { style: {
		display: "flex",
		alignItems: "center",
		gap: "8px",
		flexWrap: "wrap"
	} }, h("input", {
		type: "checkbox",
		checked: value.allowLocalFallback === true,
		disabled: !writable,
		title: wt("linksLocalEnableHint"),
		onChange: function(e) {
			scope.set("allowLocalFallback", e.target.checked);
		}
	}), h("span", { style: badgeStyle }, "LOCAL"), h("span", { style: {
		fontSize: "13px",
		color: "var(--dsw-alias-label-primary, inherit)",
		flex: "1 1 120px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap"
	} }, wt("linksLocalRow")), localActive ? h("span", { style: {
		fontSize: "11px",
		color: "#30d158",
		flex: "0 0 auto"
	} }, wt("linksActive")) : h("button", {
		type: "button",
		disabled: !writable,
		style: btnStyle,
		onClick: function() {
			scope.set("cdpMode", "local");
		}
	}, wt("linksActivate"))));
	return h("div", { style: {
		borderTop: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))",
		paddingTop: "6px",
		display: "grid",
		gap: "4px"
	} }, h("div", { style: {
		fontSize: "12px",
		fontWeight: 600,
		color: "var(--dsw-alias-label-secondary, rgba(127,127,127,.9))",
		padding: "2px 0 4px"
	} }, wt("linksTitle")), links.length === 0 ? h("div", { style: {
		fontSize: "12px",
		color: "var(--dsw-alias-label-tertiary, rgba(127,127,127,.8))",
		padding: "2px 0"
	} }, wt("linksEmpty")) : links.map(function(row, idx) {
		var isCli = row.kind === "ego-cli";
		var isActive = row.id !== void 0 && row.id === activeId;
		var probeBadge = null;
		if (row.probeStatus === "ok" || row.probeStatus === "error") probeBadge = h("span", {
			title: row.probeError || row.probeCode || "",
			style: {
				fontSize: "11px",
				flex: "0 0 auto",
				color: row.probeStatus === "ok" ? "#30d158" : "#ff453a"
			}
		}, wt(row.probeStatus === "ok" ? "linksProbeOk" : "linksProbeFail") + (row.probeStatus === "ok" && row.probeLatencyMs ? " · " + row.probeLatencyMs + "ms" : ""));
		return h("div", {
			key: row.id || idx,
			style: {
				borderTop: "1px dashed var(--dsw-alias-border-l2, rgba(127,127,127,.18))",
				padding: "6px 0",
				display: "grid",
				gap: "4px"
			}
		}, h("div", { style: {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			flexWrap: "wrap"
		} }, h("input", {
			type: "checkbox",
			checked: row.enabled === true,
			disabled: !writable,
			title: wt("linksEnabled"),
			onChange: function(e) {
				writeLinks(updateRow(links, row.id, { enabled: e.target.checked }));
			}
		}), h("span", { style: badgeStyle }, isCli ? "CLI" : "CDP"), h(FamRowInput, {
			v: row.label || "",
			writable,
			placeholder: wt("linksLabel"),
			onCommit: function(v) {
				writeLinks(updateRow(links, row.id, { label: v }));
			}
		}), probeBadge, isActive ? h("span", { style: {
			fontSize: "11px",
			color: "#30d158",
			flex: "0 0 auto"
		} }, wt("linksActive")) : h("button", {
			type: "button",
			disabled: !writable || row.enabled === false,
			title: row.enabled === false ? wt("linksDisabledHint") : void 0,
			style: btnStyle,
			onClick: function() {
				scope.set("activeTargetId", row.id);
				if (cdpMode === "local") scope.set("cdpMode", "auto");
			}
		}, wt("linksActivate"))), h("div", { style: {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			flexWrap: "wrap"
		} }, h(FamRowInput, {
			v: (isCli ? row.cliPath : row.endpoint) || "",
			writable,
			placeholder: isCli ? wt("linksCliPathHint") : wt("linksEndpointHint"),
			onCommit: function(v) {
				if (isCli) {
					writeLinks(updateRow(links, row.id, { cliPath: v }));
					return;
				}
				if (!isValidEndpoint(v)) {
					setErrText(wt("linksEndpointInvalid"));
					return;
				}
				writeLinks(updateRow(links, row.id, { endpoint: v }));
			}
		}), isCli ? h("label", { style: {
			display: "flex",
			alignItems: "center",
			gap: "4px",
			fontSize: "11px",
			color: "var(--dsw-alias-label-tertiary, rgba(127,127,127,.7))",
			flex: "0 0 auto"
		} }, h("input", {
			type: "checkbox",
			checked: row.useSdkPath === true,
			disabled: !writable,
			title: wt("linksCliSdk"),
			onChange: function(e) {
				writeLinks(updateRow(links, row.id, { useSdkPath: e.target.checked }));
			}
		}), wt("linksCliSdk")) : null, !isCli ? h("button", {
			type: "button",
			disabled: !writable || probingId === row.id,
			style: btnStyle,
			onClick: function() {
				probeOne(row);
			}
		}, probingId === row.id ? wt("linksProbing") : wt("linksProbe")) : null, h("button", {
			type: "button",
			disabled: !writable || idx === 0,
			title: wt("linksMoveUp"),
			style: btnStyle,
			onClick: function() {
				writeLinks(moveRow(links, row.id, -1));
			}
		}, "↑"), h("button", {
			type: "button",
			disabled: !writable || idx === links.length - 1,
			title: wt("linksMoveDown"),
			style: btnStyle,
			onClick: function() {
				writeLinks(moveRow(links, row.id, 1));
			}
		}, "↓"), h("button", {
			type: "button",
			disabled: !writable,
			title: wt("linksRemove"),
			style: btnStyle,
			onClick: function() {
				removeOne(row);
			}
		}, "✕"), isCli && cdpMode === "remote" ? h("span", { style: {
			fontSize: "11px",
			color: "#ff9f0a",
			flex: "1 1 100%"
		} }, wt("linksCliRemoteWarn")) : null));
	}), localRow, h("div", { style: {
		display: "grid",
		gap: "6px",
		paddingTop: "4px"
	} }, h("div", { style: {
		display: "flex",
		gap: "8px",
		alignItems: "center",
		flexWrap: "wrap"
	} }, h("input", {
		type: "text",
		value: addLabel,
		disabled: !writable || isFull(links),
		placeholder: wt("linksLabel"),
		style: Object.assign({ width: "96px" }, inputStyle),
		onChange: function(e) {
			setAddLabel(e.target.value);
		}
	}), h("input", {
		type: "text",
		value: addEndpoint,
		disabled: !writable || isFull(links),
		placeholder: wt("linksEndpointHint"),
		style: Object.assign({
			flex: "1 1 160px",
			minWidth: 0
		}, inputStyle),
		onChange: function(e) {
			setAddEndpoint(e.target.value);
		},
		onKeyDown: function(e) {
			if (e.key === "Enter") addCdp();
		}
	}), h("button", {
		type: "button",
		disabled: !writable || isFull(links),
		title: isFull(links) ? limitText() : void 0,
		style: btnStyle,
		onClick: addCdp
	}, wt("linksAddCdp"))), h("div", { style: {
		display: "flex",
		gap: "8px",
		alignItems: "center",
		flexWrap: "wrap"
	} }, h("input", {
		type: "text",
		value: addCliPath,
		disabled: !writable || isFull(links) || hasCliLink(links),
		placeholder: wt("linksCliPathHint"),
		style: Object.assign({
			flex: "1 1 160px",
			minWidth: 0
		}, inputStyle),
		onChange: function(e) {
			setAddCliPath(e.target.value);
		},
		onKeyDown: function(e) {
			if (e.key === "Enter") addCli();
		}
	}), h("button", {
		type: "button",
		disabled: !writable || isFull(links) || hasCliLink(links),
		title: hasCliLink(links) ? wt("linksAddCliExists") : isFull(links) ? limitText() : void 0,
		style: btnStyle,
		onClick: addCli
	}, wt("linksAddCli"))), errText ? h("div", { style: {
		fontSize: "11px",
		color: "#ff453a"
	} }, errText) : null));
}
function apply(ctx) {
	const localeSvc = typeof ctx.get === "function" ? ctx.get("locale") : void 0;
	if (localeSvc !== void 0) {
		ctx.effect(() => localeSvc.register(NS, dictionaries), "dsh-browser-cdp: dictionaries");
		try {
			_localeBind = localeSvc.bind(NS);
		} catch (e) {
			_localeBind = null;
		}
	}
	mountFamilySettingsCard(ctx);
	mountPluginsPageCard(ctx);
	var betterSidebarService;
	try {
		betterSidebarService = typeof ctx.get === "function" ? ctx.get("betterSidebar") : void 0;
	} catch (e) {
		betterSidebarService = void 0;
	}
	if (betterSidebarService !== void 0) ctx.effect(() => mountSidebarTab(ctx, betterSidebarService), "dsh-browser-cdp sidebar tab");
	else {
		var disposeFloating = null;
		ctx.effect(() => {
			disposeFloating = mountFloatingWatch(ctx);
			return function() {
				if (disposeFloating) {
					var d = disposeFloating;
					disposeFloating = null;
					d();
				}
			};
		}, "dsh-browser-cdp watch panel");
		if (typeof ctx.inject === "function") ctx.inject(["betterSidebar"], function(sidebarCtx) {
			var svc;
			try {
				svc = typeof sidebarCtx.get === "function" ? sidebarCtx.get("betterSidebar") : sidebarCtx.betterSidebar;
			} catch (e) {
				svc = void 0;
			}
			if (!svc) return;
			if (disposeFloating) {
				var d2 = disposeFloating;
				disposeFloating = null;
				d2();
			}
			sidebarCtx.effect(function() {
				return mountSidebarTab(sidebarCtx, svc);
			}, "dsh-browser-cdp sidebar tab");
		});
	}
}
function mountFloatingWatch(ctx) {
	if (document.getElementById("dsh-ego-fab") !== null) return () => {};
	const style = document.createElement("style");
	style.textContent = PANEL_CSS;
	document.head.appendChild(style);
	const panel = document.createElement("div");
	panel.id = "dsh-ego-panel";
	panel.hidden = true;
	panel.innerHTML = `
					<div id="dsh-ego-head">
						<span class="dsh-ego-grip" title="${wt("dragHint")}">${ICON_GRIP}</span>
						<span id="dsh-ego-title">${ICON_GLOBE}<span style="margin-left:6px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${wt("title")}</span></span>
						<button id="dsh-ego-refresh" class="dsh-ego-iconbtn" title="${wt("refresh")}">${ICON_REFRESH}</button>
						<button id="dsh-ego-historybtn" class="dsh-ego-iconbtn off" title="${wt("historyShow")}">${ICON_CLOCK}</button>
						<button id="dsh-ego-close" class="dsh-ego-iconbtn" title="${wt("settingsHide")}">${ICON_CLOSE}</button>
					</div>
					<div id="dsh-ego-tabs"></div>
					<div id="dsh-ego-login">
						<span class="dsh-ego-login-txt">${wt("loginTitle")}</span>
						<button id="dsh-ego-login-btn" class="dsh-ego-login-btn" type="button">${wt("loginBtn")}</button>
						<span class="dsh-ego-login-note" id="dsh-ego-login-note"></span>
						<button class="dsh-ego-dismiss" type="button" title="${wt("loginDismiss")}" data-dismiss="login">×</button>
					</div>
					<div id="dsh-ego-captcha">
						<span class="dsh-ego-captcha-txt"><b>${wt("captchaTitle")}</b> — ${wt("captchaHint")}</span>
						<span class="dsh-ego-captcha-kind" id="dsh-ego-captcha-kind"></span>
						<button class="dsh-ego-dismiss" type="button" title="${wt("captchaDismiss")}" data-dismiss="captcha">×</button>
					</div>
					<div id="dsh-ego-cols">
						<div class="dsh-ego-maincol">
							<div id="dsh-ego-body"></div>
						</div>
						<aside id="dsh-ego-history">
							<div id="dsh-ego-historyhead">${ICON_CLOCK} ${wt("history")}</div>
							<div id="dsh-ego-historylist"></div>
						</aside>
					</div>
					<div class="dsh-ego-off">${wt("liveView")} · ${wt("realtime")} · ${ICON_CLOCK} ${wt("historyShow")}</div>
				`;
	const fab = document.createElement("button");
	fab.id = "dsh-ego-fab";
	fab.type = "button";
	fab.title = wt("fabTitle");
	fab.textContent = "";
	fab.innerHTML = `${ICON_GLOBE}<span class="dsh-ego-dot"></span>`;
	const body = panel.querySelector("#dsh-ego-body");
	const titleEl = panel.querySelector("#dsh-ego-title");
	const refreshBtn = panel.querySelector("#dsh-ego-refresh");
	const closeBtn = panel.querySelector("#dsh-ego-close");
	const historyBtn = panel.querySelector("#dsh-ego-historybtn");
	const historyEl = panel.querySelector("#dsh-ego-history");
	const historyList = panel.querySelector("#dsh-ego-historylist");
	const tabsEl = panel.querySelector("#dsh-ego-tabs");
	const loginEl = panel.querySelector("#dsh-ego-login");
	const loginBtn = panel.querySelector("#dsh-ego-login-btn");
	const loginNote = panel.querySelector("#dsh-ego-login-note");
	const captchaEl = panel.querySelector("#dsh-ego-captcha");
	const captchaKindEl = panel.querySelector("#dsh-ego-captcha-kind");
	const FLUSH_ROUTE$1 = "/api/bcdp/flush";
	const dismissedGuides = {
		login: false,
		captcha: false
	};
	const bindGuideDismiss = (which, el) => {
		const btn = el && el.querySelector("[data-dismiss=\"" + which + "\"]");
		if (!btn) return;
		btn.addEventListener("click", () => {
			dismissedGuides[which] = true;
			el.classList.remove("show");
		});
	};
	bindGuideDismiss("login", loginEl);
	bindGuideDismiss("captcha", captchaEl);
	const setTitle = (text) => {
		const label = titleEl.querySelector("span:last-child");
		if (label) label.textContent = text;
	};
	let disposed = false;
	let historyOpen = false;
	let lastList = [];
	const setHistory = (open) => {
		historyOpen = open;
		historyEl.classList.toggle("open", open);
		panel.classList.toggle("open-drawer", open);
		historyBtn.classList.toggle("off", !open);
		historyBtn.title = open ? wt("historyHide") : wt("historyShow");
		if (open) renderHistory(lastList);
	};
	const renderHistory = (spaces) => {
		historyList.innerHTML = "";
		const list = Array.isArray(spaces) ? [...spaces].sort((a, b) => (a.lastActive ?? 0) - (b.lastActive ?? 0)) : [];
		if (list.length === 0) {
			historyList.innerHTML = `<div class="dsh-ego-hnone">${wt("noHistory")}</div>`;
			return;
		}
		for (const s of list) {
			const item = document.createElement("div");
			item.className = "dsh-ego-hitem";
			const thumbSrc = frameCache.get(s.targetId);
			const thumb = thumbSrc ? `<img class="dsh-ego-hthumb" src="${thumbSrc}" alt="">` : `<div class="dsh-ego-hthumb"></div>`;
			const active = s.targetId === currentActiveId;
			item.innerHTML = `${thumb}
							<div class="dsh-ego-hinfo">
								<div class="dsh-ego-htitle">${escapeHtml(s.title || s.url || wt("newTab"))}</div>
								<div class="dsh-ego-hurl">${escapeHtml(s.url || "(about:blank)")}</div>
								${active ? "<div class=\"dsh-ego-hactive\">● " + wt("current") + "</div>" : ""}
							</div>`;
			item.addEventListener("click", () => openPreview(s));
			historyList.appendChild(item);
		}
	};
	let pinned = null;
	let currentActiveId = null;
	let agentActiveId = null;
	let selectedTabId = null;
	let zoomState = {
		scale: 1,
		tx: 0,
		ty: 0
	};
	const frameCache = /* @__PURE__ */ new Map();
	let liveImg = null;
	let liveImgTargetId = null;
	var pickCtl = createPickControl(function(pick, message) {
		if (pickUrlLine) pickUrlLine.textContent = message || "";
		if (pickBtnEl) {
			pickBtnEl.textContent = pick === "failed" ? wt("pickFailed") : pick === "on" ? wt("picking") : wt("pickMode");
			pickBtnEl.classList.toggle("dsh-ego-pick-on", pick === "on");
		}
	}, function(el, a) {
		return deliverPickToConversation(ctx, el, a);
	});
	var pickBtnEl = null;
	var pickUrlLine = null;
	let pendingLiveFrame = null;
	let liveFlushRaf = null;
	const pageMeta = /* @__PURE__ */ new Map();
	const watchClientId = "floating-" + Math.random().toString(36).slice(2);
	let watchStarted = false, watchTargetId = null, watchRenewTimer = null, watchStopTimer = null, watchRequest = null, captureBackend = "cdp", streamGeneration = 0, streamState = "idle", streamMime = "video/mp4; codecs=\"avc1.42E01E\"", videoCleanup = null;
	const effectiveVisible = () => !panel.hidden;
	const stopVideo = () => {
		if (videoCleanup) try {
			videoCleanup();
		} catch {}
		videoCleanup = null;
	};
	const applyCaptureStatus = (status) => {
		if (!status || typeof status !== "object") return;
		if (Number.isFinite(status.generation) && status.generation < streamGeneration) return;
		if (status.generation === streamGeneration && streamState === "streaming" && status.state === "starting") return;
		const nextBackend = status.backend || captureBackend;
		const nextGeneration = status.generation ?? streamGeneration;
		const nextState = status.state || streamState;
		const nextMime = status.mime || streamMime;
		const changed = captureBackend !== nextBackend || streamGeneration !== nextGeneration || streamState !== nextState || streamMime !== nextMime;
		captureBackend = nextBackend;
		streamGeneration = nextGeneration;
		streamState = nextState;
		status.message || status.code;
		streamMime = nextMime;
		if (changed) {
			stopVideo();
			const current = lastList.find((s) => s.targetId === (selectedTabId || currentActiveId));
			if (current) renderLiveMain(current, selectedTabId !== null);
		}
	};
	const requestWatch = (route, body$1) => {
		if (watchRequest) return null;
		watchRequest = postJson(route, body$1).finally(() => {
			watchRequest = null;
		});
		return watchRequest;
	};
	const syncWatch = (targetId) => {
		if (disposed || !effectiveVisible() || !targetId) return;
		if (watchStopTimer) {
			window.clearTimeout(watchStopTimer);
			watchStopTimer = null;
		}
		if (watchStarted && watchTargetId === targetId) return;
		const request = requestWatch(watchStarted ? WATCH_SWITCH_ROUTE : WATCH_START_ROUTE, {
			clientId: watchClientId,
			targetId
		});
		if (!request) {
			watchRequest.finally(() => syncWatch(targetId));
			return;
		}
		request.then((status) => {
			watchStarted = status && status.ok !== false;
			watchTargetId = status?.targetId || targetId;
			if (watchTargetId !== targetId) {
				selectedTabId = null;
				currentActiveId = watchTargetId;
			}
			applyCaptureStatus(status);
			if (!effectiveVisible()) stopWatch(true);
		}).catch(() => {});
		if (!watchRenewTimer) watchRenewTimer = window.setInterval(() => {
			if (effectiveVisible() && watchTargetId) {
				const renewal = requestWatch(WATCH_START_ROUTE, {
					clientId: watchClientId,
					targetId: watchTargetId
				});
				if (renewal) renewal.then(applyCaptureStatus).catch(() => {});
			}
		}, 5e3);
	};
	const stopWatch = (immediate) => {
		if (watchRenewTimer) {
			window.clearInterval(watchRenewTimer);
			watchRenewTimer = null;
		}
		const stop = () => {
			watchStopTimer = null;
			watchStarted = false;
			watchTargetId = null;
			postJson(WATCH_STOP_ROUTE, { clientId: watchClientId }).catch(() => {});
		};
		if (immediate) stop();
		else {
			if (watchStopTimer) window.clearTimeout(watchStopTimer);
			watchStopTimer = window.setTimeout(stop, 1500);
		}
	};
	const INPUT_ROUTE$1 = "/api/bcdp/input";
	let inputBusy = false;
	/**
	* Send a pointer/wheel intention to the agent browser. Coordinates
	* are already in browser CSS pixels; the worker turns them into CDP
	* Input.dispatchMouseEvent on the page the panel is showing.
	* `type`: mouseMoved | mousePressed | mouseReleased | mouseWheel.
	*/
	const sendInput = (targetId, type, params) => {
		if (!!!targetId || type !== "mouseReleased" && type !== "keyUp" && !effectiveVisible()) return;
		if (inputBusy && type === "mouseMoved") return;
		if (type === "mouseMoved") {
			inputBusy = true;
			window.setTimeout(() => {
				inputBusy = false;
			}, 24);
		}
		fetch(INPUT_ROUTE$1, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				targetId,
				type,
				...params
			})
		}).then((res) => {
			if (res.status === 409) {
				liveImgTargetId = null;
				refresh();
			}
		}).catch(() => {});
	};
	const keyboardProxy = createKeyboardProxy((targetId, type, params) => sendInput(targetId, type, params));
	/**
	* Map an event's client coords to the agent page's CSS pixels.
	*
	* The shown <img> is the screencast frame laid out with
	* object-fit:contain, so the page fills a centered letterboxed box
	* inside the element. We find that box from the image's natural
	* (frame) size vs its rendered box, then scale into the page's CSS
	* viewport (vw/vh), which the worker attaches to each frame.
	*/
	const browserXY = (e) => {
		if (liveImgTargetId == null) return null;
		const m = pageMeta.get(liveImgTargetId);
		const vw = m?.vw, vh = m?.vh;
		if (!Number.isFinite(vw) || !Number.isFinite(vh)) return null;
		const img = liveImg;
		if (!img) return null;
		const rect = img.getBoundingClientRect();
		const natW = img.naturalWidth || img.videoWidth || rect.width;
		const natH = img.naturalHeight || img.videoHeight || rect.height;
		if (!natW || !natH) return null;
		const scale = Math.min(rect.width / natW, rect.height / natH);
		const contentW = natW * scale;
		const contentH = natH * scale;
		const ox = (rect.width - contentW) / 2;
		const oy = (rect.height - contentH) / 2;
		const rx = e.clientX - rect.left - ox;
		const ry = e.clientY - rect.top - oy;
		return {
			x: rx / contentW * vw,
			y: ry / contentH * vh
		};
	};
	const makeZoomImage = (urlEl, tagName = "img") => {
		const img = document.createElement(tagName);
		img.className = "dsh-ego-liveimg";
		if (tagName === "img") img.draggable = false;
		else {
			img.muted = true;
			img.autoplay = true;
			img.playsInline = true;
		}
		img.title = "滚轮缩放 · 按住拖动平移 · 缩小到最小或双击复位";
		const realText = urlEl ? urlEl.textContent : "";
		let hintTimer = null;
		const clearHint = () => {
			if (hintTimer) {
				window.clearTimeout(hintTimer);
				hintTimer = null;
			}
		};
		const showHint = (txt) => {
			if (!urlEl) return;
			urlEl.textContent = txt;
			urlEl.classList.add("dsh-ego-hint");
			clearHint();
			hintTimer = window.setTimeout(() => {
				urlEl.textContent = realText;
				urlEl.classList.remove("dsh-ego-hint");
				hintTimer = null;
			}, 2e3);
		};
		const apply$1 = () => {
			img.style.transformOrigin = "0 0";
			img.style.transform = `translate(${zoomState.tx}px, ${zoomState.ty}px) scale(${zoomState.scale})`;
		};
		let viewPanning = false;
		let browserDrag = false;
		let sx = 0, sy = 0, stx = 0, sty = 0;
		let lastDragPos = null;
		let dragTargetId = null;
		let downButtons = 0;
		const resetView = () => {
			zoomState = {
				scale: 1,
				tx: 0,
				ty: 0
			};
			apply$1();
			showHint(wt("hintReset"));
		};
		img.title = wt("hintReset");
		img.addEventListener("wheel", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.ctrlKey || e.metaKey) {
				const rect = img.getBoundingClientRect();
				const mx = e.clientX - rect.left, my = e.clientY - rect.top;
				const next = Math.min(8, Math.max(1, zoomState.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
				if (next <= 1) {
					resetView();
					return;
				}
				zoomState.tx = mx - (mx - zoomState.tx) * (next / zoomState.scale);
				zoomState.ty = my - (my - zoomState.ty) * (next / zoomState.scale);
				zoomState.scale = next;
				apply$1();
				showHint(wt("hintPan"));
				return;
			}
			const p = browserXY(e);
			if (p && liveImgTargetId) sendInput(liveImgTargetId, "mouseWheel", {
				x: p.x,
				y: p.y,
				deltaX: e.deltaX || 0,
				deltaY: e.deltaY || (e.deltaMode === 1 ? 40 : e.deltaY || 100)
			});
		}, { passive: false });
		img.addEventListener("pointerdown", (e) => {
			if (e.button !== 0) return;
			if (pickCtl.isEnabled()) {
				const pp = browserXY(e);
				if (pp && liveImgTargetId) pickCtl.clickAt(pp.x, pp.y, liveImgTargetId);
				return;
			}
			img.setPointerCapture(e.pointerId);
			sx = e.clientX;
			sy = e.clientY;
			stx = zoomState.tx;
			sty = zoomState.ty;
			if (e.ctrlKey || e.metaKey) {
				viewPanning = true;
				img.style.cursor = "grabbing";
				showHint(wt("hintScroll"));
				return;
			}
			browserDrag = true;
			dragTargetId = liveImgTargetId;
			keyboardProxy.focusAt(e, dragTargetId);
			lastDragPos = null;
			downButtons = 1;
			const p = browserXY(e);
			if (p) {
				lastDragPos = p;
				sendInput(dragTargetId, "mousePressed", {
					x: p.x,
					y: p.y,
					button: "left",
					buttons: 1,
					clickCount: 1
				});
			}
		});
		img.addEventListener("pointermove", (e) => {
			if (viewPanning) {
				zoomState.tx = stx + (e.clientX - sx);
				zoomState.ty = sty + (e.clientY - sy);
				apply$1();
				return;
			}
			if (!browserDrag) {
				const p$1 = browserXY(e);
				if (p$1) sendInput(liveImgTargetId, "mouseMoved", {
					x: p$1.x,
					y: p$1.y,
					buttons: 0
				});
				return;
			}
			const p = browserXY(e);
			if (p) {
				sendInput(dragTargetId, "mouseMoved", {
					x: p.x,
					y: p.y,
					buttons: downButtons
				});
				lastDragPos = p;
			}
		});
		const stopDrag = (e) => {
			if (viewPanning) {
				viewPanning = false;
				img.style.cursor = e.ctrlKey ? "grab" : "grab";
			}
			if (browserDrag) {
				browserDrag = false;
				if (lastDragPos && dragTargetId) sendInput(dragTargetId, "mouseReleased", {
					x: lastDragPos.x,
					y: lastDragPos.y,
					button: "left",
					buttons: 0,
					clickCount: 1
				});
				dragTargetId = null;
			}
			img.style.cursor = "grab";
		};
		img.addEventListener("pointerup", stopDrag);
		img.addEventListener("pointercancel", stopDrag);
		img.addEventListener("pointerleave", (e) => {
			if (browserDrag || viewPanning) stopDrag(e);
		});
		img.addEventListener("dblclick", (e) => {
			e.preventDefault();
			resetView();
		});
		img.style.cursor = "grab";
		apply$1();
		return img;
	};
	const renderTabs = (spaces) => {
		tabsEl.innerHTML = "";
		const list = Array.isArray(spaces) ? spaces : [];
		if (list.length === 0) {
			if (selectedTabId) selectedTabId = null;
			return;
		}
		for (const s of list) {
			const tab = document.createElement("div");
			tab.className = "dsh-ego-tab";
			tab.title = s.url || "";
			tab.__tid = s.targetId;
			const dot = document.createElement("span");
			dot.className = "dsh-ego-tabdot";
			const txt = document.createElement("span");
			txt.className = "dsh-ego-tabtxt";
			txt.textContent = s.title || s.url || wt("newTab");
			tab.appendChild(dot);
			tab.appendChild(txt);
			const closeBtn$1 = document.createElement("span");
			closeBtn$1.className = "dsh-ego-tabclose";
			closeBtn$1.title = wt("closeTab");
			closeBtn$1.textContent = "×";
			closeBtn$1.addEventListener("click", (e) => {
				e.stopPropagation();
				(async () => {
					try {
						await fetch(EGO_CLOSE_ROUTE, {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ targetId: s.targetId })
						});
					} catch {}
					if (selectedTabId === s.targetId) {
						selectedTabId = null;
						pinned = null;
					}
				})().then(() => refresh());
			});
			tab.appendChild(closeBtn$1);
			if (s.targetId === selectedTabId || selectedTabId === null && s.targetId === currentActiveId) tab.classList.add("active");
			tab.addEventListener("click", () => {
				if (selectedTabId === s.targetId) {
					selectedTabId = null;
					pinned = null;
					renderSpaces(lastList);
					return;
				}
				selectedTabId = s.targetId;
				pinned = null;
				renderLiveMain(s, true);
				syncWatch(s.targetId);
				[...tabsEl.querySelectorAll(".dsh-ego-tab")].forEach((t) => t.classList.toggle("active", t.__tid === s.targetId));
			});
			tabsEl.appendChild(tab);
		}
	};
	const renderSingleView = (s) => {
		body.innerHTML = "";
		const view = document.createElement("div");
		view.className = "dsh-ego-liveview";
		const badge = document.createElement("div");
		badge.className = "dsh-ego-livebadge";
		badge.innerHTML = pinned ? `<span class="dsh-ego-state-dot pin"></span> ${wt("pinned")}` : `<span class="dsh-ego-state-dot${fab.classList.contains("dsh-ego-busy") ? " busy" : ""}"></span> ${wt("realtime")}`;
		view.appendChild(badge);
		if (pinned) {
			const back = document.createElement("button");
			back.className = "dsh-ego-back";
			back.type = "button";
			back.textContent = wt("backToLive");
			back.addEventListener("click", () => {
				pinned = null;
				renderSpaces(lastList);
			});
			badge.appendChild(back);
		}
		const t = document.createElement("div");
		t.className = "dsh-ego-livetitle";
		t.textContent = s.title || s.url || wt("newTab");
		const u = document.createElement("div");
		u.className = "dsh-ego-liveurl";
		u.textContent = s.url || "";
		const cached = frameCache.get(s.targetId);
		if (captureBackend === "ffmpeg" || cached) {
			const img = makeZoomImage(u, captureBackend === "ffmpeg" ? "video" : "img");
			if (captureBackend === "ffmpeg" && streamState === "streaming") {
				stopVideo();
				videoCleanup = createMsePlayer(img, streamGeneration, streamMime, (message) => {});
			} else img.src = cached;
			img.alt = "live";
			attachLiveImg(s.targetId, img);
			view.appendChild(img);
		} else {
			const n = document.createElement("div");
			n.className = "dsh-ego-liveurl";
			n.textContent = wt("noScreenshot");
			view.appendChild(n);
		}
		view.appendChild(t);
		view.appendChild(u);
		body.appendChild(view);
	};
	const openPreview = (s) => {
		if (disposed) return;
		pinned = s;
		renderSingleView(s);
	};
	const renderSpaces = (spaces) => {
		if (disposed) return;
		lastList = Array.isArray(spaces) ? spaces : [];
		for (const s of lastList) {
			const prev = pageMeta.get(s.targetId) || { targetId: s.targetId };
			pageMeta.set(s.targetId, {
				url: s.url,
				title: s.title,
				targetId: s.targetId,
				...Number.isFinite(s.viewportW) ? { vw: s.viewportW } : prev.vw !== void 0 ? { vw: prev.vw } : {},
				...Number.isFinite(s.viewportH) ? { vh: s.viewportH } : prev.vh !== void 0 ? { vh: prev.vh } : {}
			});
		}
		const liveIds = new Set(lastList.map((s) => s.targetId));
		for (const id of [...pageMeta.keys()]) if (!liveIds.has(id)) pageMeta.delete(id);
		for (const id of [...frameCache.keys()]) if (!liveIds.has(id)) frameCache.delete(id);
		const sorted = [...lastList].sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
		const activeMarked = lastList.find((s) => s.active === true) || sorted[0] || null;
		if (activeMarked) {
			agentActiveId = activeMarked.targetId;
			currentActiveId = activeMarked.targetId;
		}
		maybeShowLoginGuide();
		maybeShowCaptchaGuide();
		renderTabs(lastList);
		if (historyOpen) renderHistory(lastList);
		if (pinned) return;
		if (lastList.length === 0) {
			setTitle(wt("titleIdle"));
			body.innerHTML = `<div class="dsh-ego-empty">${wt("noActivePages")}<br><span style="font-size:11px;">${wt("noActiveHint")}</span></div>`;
			fab.classList.remove("dsh-ego-live", "dsh-ego-busy");
			return;
		}
		lastList.length;
		fab.classList.add("dsh-ego-live");
		const busy = lastList.some((s) => Date.now() - (s.lastActive || 0) <= ACTIVE_WINDOW_MS);
		if (busy !== lastSawActive) {
			fab.classList.toggle("dsh-ego-busy", busy);
			lastSawActive = busy;
		} else fab.classList.remove("dsh-ego-busy");
		const sel = selectedTabId !== null ? lastList.find((x) => x.targetId === selectedTabId) : null;
		const current = sel || activeMarked;
		currentActiveId = current.targetId;
		syncWatch(current.targetId);
		setTitle(sel ? wt("title") : wt("titleLive"));
		renderLiveMain(current, sel);
	};
	const attachLiveImg = (targetId, img) => {
		liveImg = img;
		liveImgTargetId = targetId;
		const cached = frameCache.get(targetId);
		if (cached) img.src = cached;
	};
	const renderLiveMain = (current, isPinned) => {
		body.innerHTML = "";
		const view = document.createElement("div");
		view.className = "dsh-ego-liveview";
		const badge = document.createElement("div");
		badge.className = "dsh-ego-livebadge";
		badge.innerHTML = isPinned ? `<span class="dsh-ego-state-dot pin"></span> ${wt("pinned")}` : `<span class="dsh-ego-state-dot${fab.classList.contains("dsh-ego-busy") ? " busy" : ""}"></span> ${wt("realtime")}`;
		view.appendChild(badge);
		const t = document.createElement("div");
		t.className = "dsh-ego-livetitle";
		t.textContent = current.title || current.url || wt("newTab");
		const u = document.createElement("div");
		u.className = "dsh-ego-liveurl";
		u.textContent = current.url || "";
		pickUrlLine = u;
		const pickBtn = document.createElement("button");
		pickBtn.type = "button";
		pickBtn.className = "dsh-ego-back";
		pickBtn.title = wt("pickModeHint");
		pickBtn.textContent = wt("pickMode");
		pickBtnEl = pickBtn;
		pickBtn.addEventListener("click", () => {
			pickCtl.toggle(current.targetId);
		});
		badge.appendChild(pickBtn);
		const openHere = document.createElement("button");
		openHere.type = "button";
		openHere.className = "dsh-ego-back";
		openHere.title = wt("openExternal");
		openHere.textContent = wt("openExternal");
		openHere.addEventListener("click", () => {
			const url = current.url;
			if (url && !url.startsWith("about:") && !url.startsWith("chrome://")) window.open(url, "_blank", "noopener");
			else openHere.textContent = wt("noUrl");
		});
		badge.appendChild(openHere);
		const raiseBtn = document.createElement("button");
		raiseBtn.type = "button";
		raiseBtn.className = "dsh-ego-back";
		raiseBtn.title = wt("raiseWindowHint");
		raiseBtn.textContent = wt("raiseWindow");
		raiseBtn.addEventListener("click", () => {
			fetch("/api/bcdp/raise", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}"
			}).then((r) => r.json().catch(() => null)).catch(() => null);
		});
		badge.appendChild(raiseBtn);
		const cached = frameCache.get(current.targetId);
		if (captureBackend === "ffmpeg" || cached) {
			const img = makeZoomImage(u, captureBackend === "ffmpeg" ? "video" : "img");
			if (captureBackend === "ffmpeg" && streamState === "streaming") {
				stopVideo();
				videoCleanup = createMsePlayer(img, streamGeneration, streamMime, (message) => {});
			} else img.src = cached;
			img.alt = "live";
			attachLiveImg(current.targetId, img);
			view.appendChild(img);
		} else {
			const n = document.createElement("div");
			n.className = "dsh-ego-liveurl";
			n.textContent = wt("noScreenshot");
			view.appendChild(n);
		}
		view.appendChild(t);
		view.appendChild(u);
		body.appendChild(view);
	};
	let lastSawActive = false;
	const refresh = () => {
		(async () => {
			try {
				const res = await fetch(SPACES_ROUTE, { cache: "no-store" });
				if (disposed || !res.ok) {
					renderEmpty();
					return;
				}
				const data = await res.json();
				if (!data || data.ok !== true) {
					renderEmpty();
					return;
				}
				applyCaptureStatus(data.capture);
				renderSpaces(data.spaces);
			} catch {
				renderEmpty();
			}
		})();
	};
	const renderEmpty = () => {
		if (body.children.length === 0) renderSpaces([]);
	};
	let sse = null;
	let lastFrameAt = 0;
	const FRAME_FOLLOW_MIN_MS$1 = 350;
	let followTimer = null;
	const applyFrame = (targetId, dataUrl, vw, vh) => {
		if (disposed) return;
		frameCache.set(targetId, dataUrl);
		const MAX_CACHED_FRAMES = 12;
		if (frameCache.size > MAX_CACHED_FRAMES) for (const [id] of frameCache) {
			if (id === targetId || id === liveImgTargetId) continue;
			frameCache.delete(id);
			if (frameCache.size <= MAX_CACHED_FRAMES) break;
		}
		if (Number.isFinite(vw) && Number.isFinite(vh)) {
			const cur = pageMeta.get(targetId) || { targetId };
			pageMeta.set(targetId, {
				...cur,
				vw,
				vh
			});
		}
		if (liveImg && liveImgTargetId === targetId) {
			pendingLiveFrame = dataUrl;
			if (!liveFlushRaf && !disposed) liveFlushRaf = window.requestAnimationFrame(() => {
				liveFlushRaf = null;
				if (disposed || !liveImg || pendingLiveFrame == null) return;
				try {
					liveImg.src = pendingLiveFrame;
				} catch {}
				pendingLiveFrame = null;
			});
			return;
		}
		if (!pinned && selectedTabId === null && targetId === agentActiveId) {
			const now = Date.now();
			if (now - lastFrameAt >= FRAME_FOLLOW_MIN_MS$1) {
				lastFrameAt = now;
				if (followTimer) window.clearTimeout(followTimer);
				followTimer = window.setTimeout(() => {
					if (disposed || pinned || selectedTabId !== null) return;
					if (liveImg && liveImgTargetId === targetId) return;
					const meta = pageMeta.get(targetId);
					if (!meta) return;
					currentActiveId = targetId;
					renderLiveMain({
						...meta,
						targetId
					}, false);
				}, 0);
			}
		}
	};
	let reconnectFallbackTimer = null;
	const openStream = () => {
		if (disposed) return;
		fetch(WATCH_STATUS_ROUTE, { cache: "no-store" }).then((res) => res.ok ? res.json() : null).then(applyCaptureStatus).catch(() => {});
		try {
			if (sse) sse.close();
		} catch {}
		doConnected = false;
		sse = new EventSource("/api/bcdp/stream");
		sse.onopen = () => {
			doConnected = true;
		};
		sse.addEventListener("frame", (ev) => {
			try {
				const m = JSON.parse(ev.data);
				if (!m || !m.targetId || !m.data) return;
				if (Number.isFinite(m.vw) && Number.isFinite(m.vh)) {
					const cur = pageMeta.get(m.targetId) || { targetId: m.targetId };
					pageMeta.set(m.targetId, {
						...cur,
						vw: m.vw,
						vh: m.vh
					});
				}
				applyFrame(m.targetId, `data:image/jpeg;base64,${m.data}`, m.vw, m.vh);
			} catch {}
		});
		sse.addEventListener("spaces", (ev) => {
			if (disposed) return;
			try {
				const list = JSON.parse(ev.data);
				if (Array.isArray(list)) renderSpaces(list);
			} catch {}
		});
		sse.addEventListener("capture-status", (ev) => {
			try {
				applyCaptureStatus(JSON.parse(ev.data));
			} catch {}
		});
		sse.onerror = () => {
			doConnected = false;
			if (reconnectFallbackTimer) return;
			reconnectFallbackTimer = window.setTimeout(() => {
				reconnectFallbackTimer = null;
				if (disposed) return;
				refresh();
			}, 1500);
		};
	};
	let doConnected = false;
	const DRAG_KEY = "dsh.ego.watch.pos";
	const DRAG_PANEL_KEY = "dsh.ego.watch.panelPos";
	const FAB_W = 48, FAB_H = 48;
	const PANEL_W = 408, PANEL_GAP = 8;
	const loadPos = (key) => {
		try {
			const s = JSON.parse(localStorage.getItem(key) || "null");
			if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) return s;
		} catch {}
		return null;
	};
	let pos = loadPos(DRAG_KEY) || {
		x: window.innerWidth - 18 - FAB_W,
		y: window.innerHeight - 104 - FAB_H
	};
	let panelPos = loadPos(DRAG_PANEL_KEY);
	const clampFab = () => {
		const vw = window.innerWidth, vh = window.innerHeight;
		pos.x = Math.max(4, Math.min(vw - FAB_W - 4, pos.x));
		pos.y = Math.max(4, Math.min(vh - FAB_H - 4, pos.y));
	};
	const placeFab = () => {
		clampFab();
		fab.style.left = pos.x + "px";
		fab.style.top = pos.y + "px";
	};
	const placePanel = () => {
		panel.style.left = panelPos.x + "px";
		panel.style.top = panelPos.y + "px";
	};
	/** Position the panel against the ball: just above it (below when near
	*  the top edge), clamped inside the viewport. */
	const snapPanelToFab = () => {
		const vw = window.innerWidth, vh = window.innerHeight;
		const pw = panel.classList.contains("open-drawer") ? 640 : PANEL_W;
		const ph = panel.offsetHeight > 0 ? panel.offsetHeight : Math.min(Math.round(vh * .7), 520);
		let px = pos.x + FAB_W - pw;
		let py = pos.y - ph - PANEL_GAP;
		if (py < 8) py = pos.y + FAB_H + PANEL_GAP;
		px = Math.max(8, Math.min(vw - pw - 8, px));
		py = Math.max(8, Math.min(vh - ph - 8, py));
		panelPos = {
			x: Math.round(px),
			y: Math.round(py)
		};
		placePanel();
	};
	placeFab();
	if (panelPos) placePanel();
	let suppressFabClick = false;
	/**
	* Make `el` drag the FAB or the panel (`which` = 'fab' | 'panel').
	* Movement under ~5px is treated as a click, so the FAB still toggles.
	* Interactive children (buttons/icons) never start a drag.
	*/
	const makeDraggable = (el, which) => {
		const state = () => which === "fab" ? pos : panelPos;
		let sx = 0, sy = 0, bx = 0, by = 0, active = false, dragged = false;
		const down = (e) => {
			if (e.button !== 0) return;
			if (e.target && e.target.closest) {
				const hit = e.target.closest("button, a, input, [role=\"button\"]");
				if (hit && hit !== el) return;
			}
			active = true;
			dragged = false;
			sx = e.clientX;
			sy = e.clientY;
			const s = state();
			bx = s.x;
			by = s.y;
			try {
				el.setPointerCapture(e.pointerId);
			} catch {}
			el.classList.add("dsh-ego-dragging");
			e.preventDefault();
		};
		const move = (e) => {
			if (!active) return;
			const dx = e.clientX - sx, dy = e.clientY - sy;
			if (!dragged && Math.abs(dx) + Math.abs(dy) > 5) dragged = true;
			if (dragged) {
				const s = state();
				s.x = bx + dx;
				s.y = by + dy;
				which === "fab" ? placeFab() : placePanel();
			}
		};
		const up = (e) => {
			if (!active) return;
			active = false;
			el.classList.remove("dsh-ego-dragging");
			try {
				el.releasePointerCapture(e.pointerId);
			} catch {}
			if (dragged) {
				if (which === "fab") suppressFabClick = true;
				try {
					localStorage.setItem(which === "fab" ? DRAG_KEY : DRAG_PANEL_KEY, JSON.stringify(state()));
				} catch {}
			}
		};
		el.addEventListener("pointerdown", down);
		el.addEventListener("pointermove", move);
		el.addEventListener("pointerup", up);
		el.addEventListener("pointercancel", up);
	};
	makeDraggable(fab, "fab");
	makeDraggable(panel.querySelector("#dsh-ego-head"), "panel");
	const setOpen = (open) => {
		if (open) {
			panel.hidden = false;
			panel.classList.remove("dsh-ego-panel-hide");
			snapPanelToFab();
			panel.offsetHeight;
			panel.classList.add("dsh-ego-panel-open");
			fab.classList.add("on");
			refresh();
			openStream();
			if (currentActiveId) syncWatch(selectedTabId || currentActiveId);
		} else {
			panel.classList.remove("dsh-ego-panel-open");
			clearTimeout(panel._dshHideT);
			panel._dshHideT = setTimeout(() => {
				panel.classList.add("dsh-ego-panel-hide");
				panel.hidden = true;
				fab.classList.remove("on");
			}, 280);
			try {
				if (sse) sse.close();
			} catch {}
			sse = null;
			stopWatch(false);
			stopVideo();
		}
		try {
			localStorage.setItem(OPEN_KEY, open ? "1" : "0");
		} catch {}
	};
	fab.addEventListener("click", () => {
		if (suppressFabClick) {
			suppressFabClick = false;
			return;
		}
		setOpen(panel.hidden);
	});
	closeBtn.addEventListener("click", () => setOpen(false));
	refreshBtn.addEventListener("click", () => {
		refreshBtn.classList.add("spinning");
		window.setTimeout(() => refreshBtn.classList.remove("spinning"), 800);
		refresh();
	});
	historyBtn.addEventListener("click", () => setHistory(!historyOpen));
	const maybeShowLoginGuide = () => {
		if (disposed || dismissedGuides.login) return;
		const show = lastList.some((s) => s.url && !s.url.startsWith("about:")) && !captchaEl.classList.contains("show");
		loginEl.classList.toggle("show", show);
		loginNote.textContent = "";
	};
	const maybeShowCaptchaGuide = () => {
		if (disposed || dismissedGuides.captcha) return;
		const hit = lastList.find((s) => s.humanCheck && s.humanCheck.detected);
		const show = !!hit;
		captchaEl.classList.toggle("show", show);
		if (show && captchaKindEl) captchaKindEl.textContent = hit.humanCheck.kind || "captcha";
	};
	loginBtn.addEventListener("click", () => {
		(async () => {
			loginBtn.classList.add("saving");
			loginBtn.textContent = wt("loginSaving");
			try {
				const j = await (await fetch(FLUSH_ROUTE$1, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{}"
				})).json();
				if (j && j.ok) loginNote.textContent = wt("loginSaved", { n: j.total ?? "" });
				else loginNote.textContent = j?.error ? wt("loginNotConnected") : wt("loginFailed");
			} catch {
				loginNote.textContent = wt("loginFailed");
			} finally {
				loginBtn.classList.remove("saving");
				loginBtn.textContent = wt("loginBtn");
			}
		})();
	});
	document.body.appendChild(fab);
	document.body.appendChild(panel);
	try {
		localStorage.removeItem(OPEN_KEY);
	} catch {}
	panel.hidden = true;
	fab.classList.remove("on");
	refresh();
	const onVisibility = () => {
		if (document.visibilityState !== "hidden" && !panel.hidden) {
			if (!sse) openStream();
			syncWatch(selectedTabId || currentActiveId);
		}
	};
	document.addEventListener("visibilitychange", onVisibility);
	return () => {
		disposed = true;
		if (liveFlushRaf != null) try {
			window.cancelAnimationFrame(liveFlushRaf);
		} catch {}
		if (followTimer) window.clearTimeout(followTimer);
		if (reconnectFallbackTimer) window.clearTimeout(reconnectFallbackTimer);
		document.removeEventListener("visibilitychange", onVisibility);
		if (watchRenewTimer) window.clearInterval(watchRenewTimer);
		if (watchStopTimer) window.clearTimeout(watchStopTimer);
		stopWatch(true);
		stopVideo();
		keyboardProxy.dispose();
		try {
			pickCtl.disable();
		} catch {}
		try {
			if (sse) sse.close();
		} catch {}
		fab.remove();
		panel.remove();
		style.remove();
	};
}
var INPUT_ROUTE = "/api/bcdp/input";
var FLUSH_ROUTE = "/api/bcdp/flush";
var FRAME_FOLLOW_MIN_MS = 350;
var TAB_CSS = `
.dsh-ego-side-root {
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  overflow: hidden; color: inherit; background: transparent;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
.dsh-ego-side-root * { box-sizing: border-box; }

.dsh-ego-side-head {
  display: flex; align-items: center; gap: 4px; padding: 8px 10px;
  border-bottom: 1px solid rgba(128,128,128,.18); flex-shrink: 0;
}
.dsh-ego-side-title {
  flex: 1; font-size: 12.5px; font-weight: 600; letter-spacing: .2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  display: flex; align-items: center; gap: 5px; opacity: .85;
}
.dsh-ego-side-title svg { width: 14px; height: 14px; flex-shrink: 0; }
.dsh-ego-side-iconbtn {
  background: transparent; border: none; cursor: pointer;
  width: 26px; height: 26px; border-radius: 7px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  color: inherit; opacity: .6;
  transition: background .15s ease, opacity .15s ease;
}
.dsh-ego-side-iconbtn:hover { background: rgba(128,128,128,.18); opacity: 1; }
.dsh-ego-side-iconbtn.off { opacity: .4; }
.dsh-ego-side-iconbtn.spinning svg { animation: dsh-ego-side-spin .7s linear infinite; }
@keyframes dsh-ego-side-spin { to { transform: rotate(360deg); } }

/* ---- guide strips (login / captcha) ---- */
.dsh-ego-side-login, .dsh-ego-side-captcha {
  display: flex; align-items: center; gap: 7px; margin: 0 10px 7px; padding: 6px 9px;
  border-radius: 8px; font-size: 11px; line-height: 1.4;
}
.dsh-ego-side-login {
  border: 1px solid rgba(255,214,10,.3); background: rgba(255,214,10,.1);
}
.dsh-ego-side-captcha {
  border: 1px solid rgba(255,69,58,.4); background: rgba(255,69,58,.13);
}
.dsh-ego-side-login .dsh-ego-side-login-txt { flex: 1; min-width: 0; }
.dsh-ego-side-login .dsh-ego-side-login-txt b { color: #ffd60a; }
.dsh-ego-side-login-btn {
  flex: none; background: #0a84ff; color: #fff; border: none; border-radius: 7px;
  font-size: 10.5px; padding: 4px 9px; cursor: pointer; white-space: nowrap;
  transition: background .15s ease;
}
.dsh-ego-side-login-btn:hover { background: #338cff; }
.dsh-ego-side-login-btn.saving { opacity: .55; pointer-events: none; }
.dsh-ego-side-login-note { flex: none; font-size: 10px; opacity: .6; white-space: nowrap; }
.dsh-ego-side-captcha-txt { flex: 1; min-width: 0; }
.dsh-ego-side-captcha-txt b { color: #ff6961; }
.dsh-ego-side-captcha-kind {
  flex: none; font-size: 9.5px; padding: 2px 7px; border-radius: 999px;
  background: rgba(255,255,255,.15); text-transform: uppercase; letter-spacing: .3px;
}

/* ---- tab strip: frosted pills ---- */
.dsh-ego-side-tabs {
  display: flex; gap: 5px; padding: 7px 10px; flex-shrink: 0;
  border-bottom: 1px solid rgba(128,128,128,.12);
  overflow-x: auto; scrollbar-width: thin;
}
.dsh-ego-side-tabs:empty { display: none; }
.dsh-ego-side-tab {
  display: inline-flex; align-items: center; gap: 5px; max-width: 160px;
  white-space: nowrap; padding: 4px 10px; border-radius: 999px; cursor: pointer;
  font-size: 11px; flex-shrink: 0;
  border: 1px solid rgba(128,128,128,.2); background: rgba(128,128,128,.12);
  opacity: .7; transition: background .15s, opacity .15s, border-color .15s;
}
.dsh-ego-side-tab > .dsh-ego-side-tabtxt { overflow: hidden; text-overflow: ellipsis; }
.dsh-ego-side-tab:hover { opacity: 1; background: rgba(128,128,128,.2); }
.dsh-ego-side-tab.active {
  background: #0a84ff; color: #fff; border-color: transparent; opacity: 1;
  box-shadow: 0 2px 8px rgba(10,132,255,.3);
}
.dsh-ego-side-tabdot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .5; flex-shrink: 0; }
.dsh-ego-side-tab.active .dsh-ego-side-tabdot { background: #fff; opacity: 1; }
.dsh-ego-side-tabclose {
  flex-shrink: 0; width: 13px; height: 13px; line-height: 12px; text-align: center;
  border-radius: 50%; font-size: 11px; opacity: .5; margin-left: 1px;
}
.dsh-ego-side-tabclose:hover { background: rgba(255,255,255,.2); color: #ff453a; opacity: 1; }

/* ---- main body ---- */
.dsh-ego-side-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; }
.dsh-ego-side-empty { padding: 20px 12px; text-align: center; font-size: 12px; opacity: .5; line-height: 1.7; }

.dsh-ego-side-liveview { display: flex; flex-direction: column; gap: 7px; min-height: 60px; overflow: hidden; }
.dsh-ego-side-livebadge {
  font-size: 10.5px; opacity: .6; letter-spacing: .2px;
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.dsh-ego-side-state-dot {
  display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  background: #30d158; box-shadow: 0 0 5px #30d15888; flex-shrink: 0;
  animation: dsh-ego-side-breathe 2.4s ease-in-out infinite;
}
.dsh-ego-side-state-dot.busy { background: #30d158; box-shadow: 0 0 6px #30d158bb; animation: none; }
.dsh-ego-side-state-dot.pin { background: #0a84ff; box-shadow: 0 0 5px #0a84ff88; animation: none; }
@keyframes dsh-ego-side-breathe {
  0%, 100% { box-shadow: 0 0 2px #30d15822; opacity: .5; }
  50%      { box-shadow: 0 0 10px #30d158ee; opacity: 1; }
}
.dsh-ego-side-back {
  background: rgba(128,128,128,.18); border: 1px solid rgba(128,128,128,.2);
  border-radius: 6px; cursor: pointer; font-size: 10.5px; padding: 2px 8px;
  display: inline-flex; align-items: center; gap: 3px;
  transition: background .15s ease; color: inherit;
}
.dsh-ego-side-back:hover { background: rgba(128,128,128,.3); }
.dsh-ego-side-back.dsh-ego-pick-on { background: rgba(56,189,248,.28); color: #0ea5e9; }
.dsh-ego-side-liveimg {
  width: 100%; border-radius: 9px; display: block;
  max-height: 50vh; object-fit: contain;
  border: 1px solid rgba(128,128,128,.2); background: #000;
  user-select: none; -webkit-user-select: none; touch-action: none;
  will-change: transform; cursor: grab;
}
.dsh-ego-side-livetitle { font-size: 12px; font-weight: 600; }
.dsh-ego-side-liveurl { font-size: 10.5px; opacity: .55; word-break: break-all; }
.dsh-ego-side-liveurl.dsh-ego-side-hint { color: #75c2ff; font-style: italic; font-weight: 500; opacity: 1; }
.dsh-ego-side-hint { animation: dsh-ego-side-hint-in .2s ease; }
@keyframes dsh-ego-side-hint-in { from { opacity: .3 } to { opacity: 1 } }

/* ---- history overlay (covers the body area) ---- */
.dsh-ego-side-history {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  overflow: hidden;
}
.dsh-ego-side-historyhead {
  padding: 8px 10px; font-size: 11px; font-weight: 600; opacity: .6;
  display: flex; align-items: center; gap: 5px;
  border-bottom: 1px solid rgba(128,128,128,.1); flex-shrink: 0;
}
.dsh-ego-side-historyhead svg { width: 11px; height: 11px; }
.dsh-ego-side-historylist { overflow-y: auto; padding: 5px; }
.dsh-ego-side-hitem {
  display: flex; gap: 7px; align-items: center; padding: 5px; border-radius: 8px;
  cursor: pointer; transition: background .15s ease;
}
.dsh-ego-side-hitem:hover { background: rgba(128,128,128,.15); }
.dsh-ego-side-hitem.active { background: rgba(10,132,255,.15); }
.dsh-ego-side-hthumb {
  width: 52px; height: 38px; border-radius: 5px; object-fit: cover; background: #000;
  flex-shrink: 0; border: 1px solid rgba(128,128,128,.2);
}
.dsh-ego-side-hinfo { min-width: 0; flex: 1; }
.dsh-ego-side-htitle { font-size: 10px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-ego-side-hurl { font-size: 9.5px; opacity: .5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-ego-side-hactive { color: #30d158; font-size: 9.5px; }
.dsh-ego-side-hnone { padding: 16px 8px; text-align: center; font-size: 10.5px; opacity: .4; }
`;
/**
* M1.6 — quote a picked element into the conversation composer.
* 2026-09-23 revision 2: NO auto-submit, ever. Elements from ONE page
* accumulate into ONE dictionary block, wrapped like the image
* attachments are — the block carries its source CDP connection
* (endpoint + targetId) so the agent can find the element's DOM again
* (backendNodeId is directly addressable via bcdp_cdp DOM.describeNode).
* Format inside the draft:
*   [CDP-PICKS page="..." targetId="..." endpoint="..."]
*   {"cdpEndpoint":..., "targetId":..., "pageUrl":..., "elements":[{n,backendNodeId,tag,id,name,focusable,describe}]}
*   [/CDP-PICKS]
*/
function deliverPickToConversation(ctx, element, action) {
	try {
		var describe = element && typeof element.describe === "string" ? element.describe : "";
		if (describe === "") return {
			ok: false,
			code: "empty-describe"
		};
		if (action !== "quote") return {
			ok: false,
			code: "bad-action"
		};
		var sessionId = ctx.sessions.list.getSnapshot().current;
		if (!sessionId) return {
			ok: false,
			code: "no-active-session"
		};
		var actx = ctx.sessions.scope(sessionId);
		if (!actx) return {
			ok: false,
			code: "no-session-scope"
		};
		var conversation = ctx.get("conversation");
		if (!conversation || !conversation.input) return {
			ok: false,
			code: "no-conversation-service"
		};
		var input = conversation.input.for(actx);
		if (!input || typeof input.setDraft !== "function") return {
			ok: false,
			code: "no-input-facade"
		};
		var snap = input.state && input.state.getSnapshot ? input.state.getSnapshot() : null;
		var draft = snap && typeof snap.draft === "string" ? snap.draft : "";
		var src = element.source || {
			endpoint: "",
			targetId: "",
			pageUrl: "",
			pageTitle: ""
		};
		var entry = {
			backendNodeId: element.backendNodeId,
			tag: element.tag,
			id: element.id,
			name: element.name,
			focusable: !!element.keyboardFocusable,
			describe
		};
		var re = /\[CDP-PICKS[^\]]*\]\n([\s\S]*?)\n\[\/CDP-PICKS\]/g, found = null, mm;
		while ((mm = re.exec(draft)) !== null) try {
			var obj = JSON.parse(mm[1]);
			if (obj && obj.targetId === src.targetId && obj.cdpEndpoint === src.endpoint) {
				found = mm;
				mm[0].split("\n")[0];
				break;
			}
		} catch (e) {}
		var elements = [Object.assign({ n: 1 }, entry)];
		var page = {
			cdpEndpoint: src.endpoint,
			targetId: src.targetId,
			pageUrl: src.pageUrl,
			pageTitle: src.pageTitle
		};
		if (found) try {
			var prev = JSON.parse(found[1]);
			var list = prev && prev.elements ? prev.elements : [];
			var maxN = 0;
			for (var k = 0; k < list.length; k++) if (list[k].n > maxN) maxN = list[k].n;
			entry.n = maxN + 1;
			list.push(entry);
			page.elements = list;
			draft = draft.slice(0, found.index) + draft.slice(found.index + found[0].length);
		} catch (e) {}
		if (!page.elements) page.elements = elements;
		var block = "[CDP-PICKS page=\"" + String(src.pageTitle || src.pageUrl || "").replace(/"/g, "'") + "\" targetId=\"" + src.targetId + "\" endpoint=\"" + src.endpoint + "\"]\n" + JSON.stringify(page, null, 2) + "\n[/CDP-PICKS]";
		draft = draft ? draft + (draft.charAt(draft.length - 1) === "\n" ? "" : "\n") + block : block;
		input.setDraft(draft);
		return {
			ok: true,
			code: "drafted",
			count: page.elements.length
		};
	} catch (err) {
		return {
			ok: false,
			code: "deliver-failed",
			message: String(err && err.message || err)
		};
	}
}
function createPickControl(onState, deliver) {
	var enabled = false;
	var timer = null;
	var seenPicks = 0;
	var deliveredPicks = -1;
	var request = null;
	function emit(pick, message) {
		onState(pick, message);
	}
	function stopPolling() {
		if (timer) {
			window.clearInterval(timer);
			timer = null;
		}
	}
	function post(enabledNow, targetId) {
		var body = { enabled: enabledNow };
		if (targetId) body.targetId = targetId;
		return fetch("/api/bcdp/pick", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body)
		}).then(function(r) {
			return r.json().catch(function() {
				return null;
			});
		}).catch(function() {
			return null;
		});
	}
	function applyState(state) {
		if (!state || typeof state !== "object") return;
		if (state.lastPick && state.lastAction && state.picks !== deliveredPicks && typeof deliver === "function") {
			deliveredPicks = state.picks;
			var result = deliver(state.lastPick, state.lastAction);
			if (result && result.ok) emit("picked", wt("pickQuoted") + " (" + result.count + ")");
			else emit("failed", wt("pickDeliverFailed") + (result && result.code ? " (" + result.code + ")" : ""));
		}
		if (state.picks !== seenPicks) seenPicks = state.picks;
		if (state.enabled) emit("on", state.code === "picking" ? wt("picking") : state.message || wt("picking"));
		else if (state.code === "picked") emit("picked", state.lastPick ? state.lastPick.describe : wt("picked"));
		else if (state.code && state.code !== "idle" && state.code !== "delivered") {
			emit("failed", state.message || state.code);
			enabled = false;
			stopPolling();
		} else if (!state.enabled) {
			enabled = false;
			stopPolling();
			if (state.code === "idle" && !(state.lastPick && state.lastAction)) emit("off", "");
		}
	}
	function pollOnce() {
		if (request) return;
		request = fetch("/api/bcdp/pick").then(function(r) {
			return r.json().catch(function() {
				return null;
			});
		}).catch(function() {
			return null;
		});
		request.then(function(res) {
			request = null;
			if (res && res.ok !== false && res.state) applyState(res.state);
			else {
				enabled = false;
				stopPolling();
				emit("off", "");
			}
		});
	}
	function toggle(targetId) {
		if (enabled) {
			disable();
			return;
		}
		if (!targetId) {
			emit("failed", wt("noActivePages"));
			return;
		}
		post(true, targetId).then(function(res) {
			var state = res && res.ok !== false ? res.state : null;
			if (!state || state.enabled !== true) {
				emit("failed", state && state.message || res && res.error || wt("pickFailed"));
				return;
			}
			enabled = true;
			seenPicks = state.picks || 0;
			deliveredPicks = state.lastAction ? state.picks || 0 : (state.picks || 0) - 1;
			emit("on", wt("picking"));
			stopPolling();
			timer = window.setInterval(pollOnce, 1e3);
		});
	}
	function clickAt(x, y, targetId) {
		if (!enabled || !targetId) return;
		fetch("/api/bcdp/pick/click", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				targetId,
				x,
				y
			})
		}).then(function(r) {
			return r.json().catch(function() {
				return null;
			});
		}).catch(function() {
			return null;
		}).then(function(res) {
			if (res && res.ok !== false && res.state) applyState(res.state);
			else emit("failed", res && (res.error || res.code) || wt("pickFailed"));
		});
	}
	function disable() {
		var wasEnabled = enabled;
		enabled = false;
		stopPolling();
		emit("off", "");
		if (wasEnabled) post(false, "");
	}
	return {
		toggle,
		disable,
		clickAt,
		isEnabled: function() {
			return enabled;
		}
	};
}
function LivePreviewController(ctx) {
	this.ctx = ctx;
	this.store = createSnapshotStore(this._initialState());
	this.frameCache = /* @__PURE__ */ new Map();
	this.pageMeta = /* @__PURE__ */ new Map();
	this.lastList = [];
	this.pinned = null;
	this.currentActiveId = null;
	this.agentActiveId = null;
	this.selectedTabId = null;
	this.zoomState = {
		scale: 1,
		tx: 0,
		ty: 0
	};
	this.liveCount = 0;
	this.disposed = false;
	this.visible = false;
	this.clientId = "sidebar-" + Math.random().toString(36).slice(2);
	this.watchStarted = false;
	this.watchTargetId = null;
	this.watchRenewTimer = null;
	this.watchStopTimer = null;
	this.watchRequest = null;
	this.backend = "cdp";
	this.streamGeneration = 0;
	this.streamState = "idle";
	this.streamMessage = "";
	this.streamMime = "video/mp4; codecs=\"avc1.42E01E\"";
	this.liveVideo = null;
	this.videoCleanup = null;
	this.documentVisible = document.visibilityState !== "hidden";
	this.onDocumentVisibility = this._handleDocumentVisibility.bind(this);
	this.sse = null;
	this.reconnectFallbackTimer = null;
	this.lastSawActive = false;
	this.lastFrameAt = 0;
	this.followTimer = null;
	this.pendingLiveFrame = null;
	this.liveFlushRaf = null;
	this.liveImg = null;
	this.liveImgTargetId = null;
	this.wiringStale = false;
	this._lastUnwiredAt = 0;
	this._wiredRecomputeQueued = false;
	this.historyOpen = false;
	this._zoomHint = null;
	this._zoomHintTimer = null;
	this._pointerState = null;
	var self = this;
	this.keyboardProxy = createKeyboardProxy(function(targetId, type, params) {
		self.sendInput(targetId, type, params);
	});
	this.dismissedGuides = {
		login: false,
		captcha: false
	};
	this._pick = "off";
	this._pickMessage = "";
	this._pickTargetId = null;
	this.pickControl = createPickControl(function(pick, message) {
		self._setPickState(pick, message);
	}, function(el, a) {
		return deliverPickToConversation(ctx, el, a);
	});
}
LivePreviewController.prototype._initialState = function() {
	return {
		spaces: [],
		pinned: null,
		selectedTabId: null,
		currentTargetId: null,
		currentSpace: null,
		liveCount: 0,
		busy: false,
		showLoginGuide: false,
		captchaKind: null,
		historyOpen: false,
		zoomHint: null,
		wiringStale: false,
		backend: "cdp",
		streamState: "idle",
		streamMessage: "",
		streamGeneration: 0,
		streamMime: "video/mp4; codecs=\"avc1.42E01E\"",
		pick: "off",
		pickMessage: ""
	};
};
LivePreviewController.prototype.subscribe = function(cb) {
	return this.store.subscribe(cb);
};
LivePreviewController.prototype.getSnapshot = function() {
	return this.store.getSnapshot();
};
LivePreviewController.prototype._setPickState = function(pick, message) {
	this._pick = pick;
	this._pickMessage = message || "";
	var self = this;
	this.store.update(function(s) {
		s.pick = self._pick;
		s.pickMessage = self._pickMessage;
	});
};
LivePreviewController.prototype._recompute = function() {
	var hasPage = this.lastList.some(function(s) {
		return s.url && !s.url.startsWith("about:");
	});
	var captchaHit = this.lastList.find(function(s) {
		return s.humanCheck && s.humanCheck.detected;
	});
	var self = this;
	var currentSpace = null;
	var currentTargetId = null;
	if (this.pinned) {
		currentSpace = this.pinned;
		currentTargetId = this.pinned.targetId;
	} else if (this.selectedTabId !== null) {
		currentSpace = this.lastList.find(function(s) {
			return s.targetId === self.selectedTabId;
		}) || null;
		currentTargetId = this.selectedTabId;
		if (currentSpace && !currentSpace.thumbnail) {
			var cached = this.frameCache.get(currentTargetId);
			if (cached) currentSpace = Object.assign({}, currentSpace, { thumbnail: cached });
		}
	} else {
		var activeMarked = this.lastList.find(function(s) {
			return s.active === true;
		});
		if (!activeMarked && this.lastList.length > 0) activeMarked = this.lastList.slice().sort(function(a, b) {
			return (b.lastActive || 0) - (a.lastActive || 0);
		})[0];
		if (activeMarked) {
			currentSpace = Object.assign({}, activeMarked);
			currentTargetId = activeMarked.targetId;
			if (!currentSpace.thumbnail) {
				var cached2 = this.frameCache.get(currentTargetId);
				if (cached2) currentSpace.thumbnail = cached2;
			}
		}
	}
	this.currentActiveId = currentTargetId;
	this.wiringStale = currentTargetId != null && this.liveImgTargetId !== currentTargetId;
	var showLogin = hasPage && !captchaHit && !this.dismissedGuides.login;
	var captchaKind = captchaHit && !this.dismissedGuides.captcha ? captchaHit.humanCheck.kind || "captcha" : null;
	if (this.pickControl.isEnabled() && currentTargetId !== this._pickTargetId) this.togglePick();
	this.store.update(function(s) {
		s.spaces = self.lastList;
		s.pinned = self.pinned;
		s.selectedTabId = self.selectedTabId;
		s.currentTargetId = currentTargetId;
		s.currentSpace = currentSpace;
		s.liveCount = self.liveCount;
		s.busy = self.lastSawActive;
		s.showLoginGuide = showLogin;
		s.captchaKind = captchaKind;
		s.historyOpen = self.historyOpen;
		s.zoomHint = self._zoomHint;
		s.wiringStale = self.wiringStale;
		s.backend = self.backend;
		s.streamState = self.streamState;
		s.streamMessage = self.streamMessage;
		s.streamGeneration = self.streamGeneration;
		s.streamMime = self.streamMime;
		s.pick = self._pick;
		s.pickMessage = self._pickMessage;
	});
	this._syncWatch(currentTargetId);
};
LivePreviewController.prototype.start = function() {
	document.addEventListener("visibilitychange", this.onDocumentVisibility);
	this._recompute();
	if (this.visible) {
		this.refresh();
		this.openStream();
	}
};
LivePreviewController.prototype.togglePick = function() {
	var targetId = this.currentActiveId;
	if (this.pickControl.isEnabled()) {
		this._pickTargetId = null;
		this.pickControl.toggle(targetId);
		return;
	}
	this._pickTargetId = targetId;
	this.pickControl.toggle(targetId);
};
LivePreviewController.prototype.dispose = function() {
	this.keyboardProxy.dispose();
	this.disposed = true;
	try {
		this.pickControl.disable();
	} catch (e) {}
	if (this.liveFlushRaf != null) try {
		window.cancelAnimationFrame(this.liveFlushRaf);
	} catch (e) {}
	if (this.followTimer) window.clearTimeout(this.followTimer);
	if (this.reconnectFallbackTimer) window.clearTimeout(this.reconnectFallbackTimer);
	if (this._zoomHintTimer) window.clearTimeout(this._zoomHintTimer);
	document.removeEventListener("visibilitychange", this.onDocumentVisibility);
	if (this.watchRenewTimer) window.clearInterval(this.watchRenewTimer);
	if (this.watchStopTimer) window.clearTimeout(this.watchStopTimer);
	this._stopWatch(true);
	this._destroyVideo();
	this.closeStream();
};
LivePreviewController.prototype._handleDocumentVisibility = function() {
	this.documentVisible = document.visibilityState !== "hidden";
	if (this.documentVisible && this.visible) {
		this.refresh();
		if (!this.sse) this.openStream();
		this._syncWatch(this.currentActiveId);
	}
};
LivePreviewController.prototype.setVisible = function(v) {
	this.visible;
	this.visible = v;
	if (v) {
		this.refresh();
		this.openStream();
		this._syncWatch(this.currentActiveId);
	} else {
		this.closeStream();
		this._stopWatch(false);
		this._destroyVideo();
	}
};
LivePreviewController.prototype._requestWatch = function(route, body) {
	if (this.watchRequest) return null;
	var self = this;
	this.watchRequest = postJson(route, body).finally(function() {
		self.watchRequest = null;
	});
	return this.watchRequest;
};
LivePreviewController.prototype._applyCaptureStatus = function(status) {
	if (!status || typeof status !== "object") return;
	if (Number.isFinite(status.generation) && status.generation < this.streamGeneration) return;
	if (status.generation === this.streamGeneration && this.streamState === "streaming" && status.state === "starting") return;
	var nextBackend = status.backend || this.backend;
	var nextGeneration = status.generation ?? this.streamGeneration;
	var nextState = status.state || this.streamState;
	var generationChanged = this.streamGeneration !== nextGeneration;
	this.backend = nextBackend;
	this.streamState = nextState;
	this.streamMessage = status.message || status.code || "";
	this.streamGeneration = nextGeneration;
	this.streamMime = status.mime || this.streamMime;
	if (generationChanged || this.backend !== "ffmpeg") this._destroyVideo();
	this._recompute();
};
LivePreviewController.prototype._syncWatch = function(targetId) {
	if (this.disposed || !this.visible || !targetId) return;
	var self = this;
	if (this.watchStopTimer) {
		window.clearTimeout(this.watchStopTimer);
		this.watchStopTimer = null;
	}
	var route = this.watchStarted ? WATCH_SWITCH_ROUTE : WATCH_START_ROUTE;
	if (this.watchStarted && this.watchTargetId === targetId) return;
	var body = {
		clientId: this.clientId,
		targetId
	};
	var request = this._requestWatch(route, body);
	if (!request) {
		this.watchRequest.finally(function() {
			self._syncWatch(targetId);
		});
		return;
	}
	request.then(function(status) {
		self.watchStarted = status && status.ok !== false;
		self.watchTargetId = status && status.targetId || targetId;
		if (self.watchTargetId !== targetId) {
			self.selectedTabId = null;
			self.currentActiveId = self.watchTargetId;
		}
		self._applyCaptureStatus(status);
		if (!self.visible) self._stopWatch(true);
	}).catch(function() {});
	if (!this.watchRenewTimer) this.watchRenewTimer = window.setInterval(function() {
		if (self.visible && self.watchTargetId) {
			var renewal = self._requestWatch(WATCH_START_ROUTE, {
				clientId: self.clientId,
				targetId: self.watchTargetId
			});
			if (renewal) renewal.then(function(status) {
				self._applyCaptureStatus(status);
			}).catch(function() {});
		}
	}, 5e3);
};
LivePreviewController.prototype._stopWatch = function(immediate) {
	var self = this;
	if (this.watchRenewTimer) {
		window.clearInterval(this.watchRenewTimer);
		this.watchRenewTimer = null;
	}
	var stop = function() {
		self.watchStopTimer = null;
		self.watchStarted = false;
		self.watchTargetId = null;
		postJson(WATCH_STOP_ROUTE, { clientId: self.clientId }).catch(function() {});
	};
	if (immediate) stop();
	else {
		if (this.watchStopTimer) window.clearTimeout(this.watchStopTimer);
		this.watchStopTimer = window.setTimeout(stop, 1500);
	}
};
LivePreviewController.prototype._destroyVideo = function() {
	if (this.videoCleanup) try {
		this.videoCleanup();
	} catch (e) {}
	this.videoCleanup = null;
	this.liveVideo = null;
};
LivePreviewController.prototype.setLiveVideo = function(video, targetId) {
	this._destroyVideo();
	this.liveVideo = video;
	this.liveImg = video;
	this.liveImgTargetId = targetId;
	if (!video || this.backend !== "ffmpeg" || this.streamState !== "streaming") return;
	var self = this;
	this.videoCleanup = createMsePlayer(video, this.streamGeneration, this.streamMime, function(message) {
		self.streamState = "failed";
		self.streamMessage = message;
		self._recompute();
	});
};
LivePreviewController.prototype.setLiveImg = function(img, targetId) {
	this.liveImg = img;
	this.liveImgTargetId = targetId;
	if (img && targetId != null) {
		var cached = this.frameCache.get(targetId);
		if (cached) try {
			img.src = cached;
		} catch (e) {}
	}
};
LivePreviewController.prototype.refresh = function() {
	var self = this;
	(async function() {
		try {
			var res = await fetch(SPACES_ROUTE, { cache: "no-store" });
			if (self.disposed || !res.ok) {
				self._renderEmpty();
				return;
			}
			var data = await res.json();
			if (!data || data.ok !== true) {
				self._renderEmpty();
				return;
			}
			self._applyCaptureStatus(data.capture);
			self._processSpaces(data.spaces);
		} catch (e) {
			self._renderEmpty();
		}
	})();
};
LivePreviewController.prototype._renderEmpty = function() {
	if (this.lastList.length === 0) this._processSpaces([]);
};
LivePreviewController.prototype._processSpaces = function(spaces) {
	if (this.disposed) return;
	this.lastList = Array.isArray(spaces) ? spaces : [];
	for (var i = 0; i < this.lastList.length; i++) {
		var s = this.lastList[i];
		var prev = this.pageMeta.get(s.targetId) || { targetId: s.targetId };
		var meta = {
			url: s.url,
			title: s.title,
			targetId: s.targetId
		};
		if (Number.isFinite(s.viewportW)) meta.vw = s.viewportW;
		else if (prev.vw !== void 0) meta.vw = prev.vw;
		if (Number.isFinite(s.viewportH)) meta.vh = s.viewportH;
		else if (prev.vh !== void 0) meta.vh = prev.vh;
		this.pageMeta.set(s.targetId, meta);
	}
	var liveIds = new Set(this.lastList.map(function(s$1) {
		return s$1.targetId;
	}));
	var pm = this.pageMeta;
	pm.forEach(function(_, id) {
		if (!liveIds.has(id)) pm.delete(id);
	});
	var fc = this.frameCache;
	fc.forEach(function(_, id) {
		if (!liveIds.has(id)) fc.delete(id);
	});
	var activeMarked = this.lastList.find(function(s$1) {
		return s$1.active === true;
	});
	if (activeMarked) this.agentActiveId = activeMarked.targetId;
	this.liveCount = this.lastList.length;
	var busy = this.lastList.some(function(s$1) {
		return Date.now() - (s$1.lastActive || 0) <= ACTIVE_WINDOW_MS;
	});
	if (busy !== this.lastSawActive) this.lastSawActive = busy;
	this._recompute();
};
LivePreviewController.prototype.openStream = function() {
	if (this.disposed || !this.visible) return;
	this.closeStream();
	var self = this;
	fetch(WATCH_STATUS_ROUTE, { cache: "no-store" }).then(function(res) {
		return res.ok ? res.json() : null;
	}).then(function(status) {
		self._applyCaptureStatus(status);
	}).catch(function() {});
	try {
		this.sse = new EventSource("/api/bcdp/stream");
	} catch (e) {
		return;
	}
	this.sse.addEventListener("frame", function(ev) {
		try {
			var m = JSON.parse(ev.data);
			if (!m || !m.targetId || !m.data) return;
			if (Number.isFinite(m.vw) && Number.isFinite(m.vh)) {
				var cur = self.pageMeta.get(m.targetId) || { targetId: m.targetId };
				self.pageMeta.set(m.targetId, Object.assign({}, cur, {
					vw: m.vw,
					vh: m.vh
				}));
			}
			self.applyFrame(m.targetId, "data:image/jpeg;base64," + m.data, m.vw, m.vh);
		} catch (e) {}
	});
	this.sse.addEventListener("spaces", function(ev) {
		if (self.disposed) return;
		try {
			var list = JSON.parse(ev.data);
			if (Array.isArray(list)) self._processSpaces(list);
		} catch (e) {}
	});
	this.sse.addEventListener("capture-status", function(ev) {
		try {
			self._applyCaptureStatus(JSON.parse(ev.data));
		} catch (e) {}
	});
	this.sse.onerror = function() {
		if (self.reconnectFallbackTimer) return;
		self.reconnectFallbackTimer = window.setTimeout(function() {
			self.reconnectFallbackTimer = null;
			if (self.disposed || !self.visible) return;
			self.refresh();
		}, 1500);
	};
};
LivePreviewController.prototype.closeStream = function() {
	try {
		if (this.sse) this.sse.close();
	} catch (e) {}
	this.sse = null;
};
LivePreviewController.prototype.applyFrame = function(targetId, dataUrl, vw, vh) {
	if (this.disposed) return;
	this.frameCache.delete(targetId);
	this.frameCache.set(targetId, dataUrl);
	var MAX_CACHED_FRAMES = 12;
	if (this.frameCache.size > MAX_CACHED_FRAMES) {
		var self = this;
		this.frameCache.forEach(function(_, id) {
			if (self.frameCache.size <= MAX_CACHED_FRAMES) return;
			if (id === targetId || id === self.liveImgTargetId) return;
			self.frameCache.delete(id);
		});
	}
	if (Number.isFinite(vw) && Number.isFinite(vh)) {
		var cur = this.pageMeta.get(targetId) || { targetId };
		this.pageMeta.set(targetId, Object.assign({}, cur, {
			vw,
			vh
		}));
	}
	if (this.liveImg && this.liveImgTargetId === targetId) {
		var self2 = this;
		this.pendingLiveFrame = dataUrl;
		if (!this.liveFlushRaf && !this.disposed) this.liveFlushRaf = window.requestAnimationFrame(function() {
			self2.liveFlushRaf = null;
			if (self2.disposed || !self2.liveImg || self2.pendingLiveFrame == null) return;
			try {
				self2.liveImg.src = self2.pendingLiveFrame;
			} catch (e) {}
			self2.pendingLiveFrame = null;
		});
		return;
	}
	if (!this.pinned && this.selectedTabId === null && targetId === this.agentActiveId) {
		var now = Date.now();
		if (now - this.lastFrameAt >= FRAME_FOLLOW_MIN_MS) {
			this.lastFrameAt = now;
			if (this.followTimer) window.clearTimeout(this.followTimer);
			var self3 = this;
			this.followTimer = window.setTimeout(function() {
				if (self3.disposed || self3.pinned || self3.selectedTabId !== null) return;
				if (self3.liveImg && self3.liveImgTargetId === targetId) return;
				if (!self3.pageMeta.get(targetId)) return;
				self3.currentActiveId = targetId;
				self3._recompute();
			}, 0);
		}
	}
};
LivePreviewController.prototype.sendInput = function(targetId, type, params) {
	if (!!!targetId || this.disposed || type !== "mouseReleased" && type !== "keyUp" && !this.visible) return;
	var self = this;
	fetch(INPUT_ROUTE, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(Object.assign({
			targetId,
			type
		}, params))
	}).then(function(res) {
		if (res.status === 409) {
			self.liveImgTargetId = null;
			self._pointerState = null;
			self.refresh();
		}
	}).catch(function() {});
};
LivePreviewController.prototype.browserXY = function(e) {
	if (this.liveImgTargetId == null || !this.liveImg) return null;
	var m = this.pageMeta.get(this.liveImgTargetId);
	var vw = m && m.vw, vh = m && m.vh;
	if (!Number.isFinite(vw) || !Number.isFinite(vh)) return null;
	var img = this.liveImg;
	var rect = img.getBoundingClientRect();
	var natW = img.naturalWidth || img.videoWidth || rect.width;
	var natH = img.naturalHeight || img.videoHeight || rect.height;
	if (!natW || !natH) return null;
	var scale = Math.min(rect.width / natW, rect.height / natH);
	var contentW = natW * scale;
	var contentH = natH * scale;
	var ox = (rect.width - contentW) / 2;
	var oy = (rect.height - contentH) / 2;
	var rx = e.clientX - rect.left - ox;
	var ry = e.clientY - rect.top - oy;
	return {
		x: rx / contentW * vw,
		y: ry / contentH * vh
	};
};
LivePreviewController.prototype.pinTo = function(space) {
	if (this.disposed) return;
	this.pinned = space;
	this.selectedTabId = null;
	this._recompute();
};
LivePreviewController.prototype.unpin = function() {
	this.pinned = null;
	this._recompute();
};
LivePreviewController.prototype.selectTab = function(targetId) {
	if (this.selectedTabId === targetId) {
		this.selectedTabId = null;
		this.pinned = null;
	} else {
		this.selectedTabId = targetId;
		this.pinned = null;
	}
	this._recompute();
	this._syncWatch(this.selectedTabId || this.currentActiveId);
};
LivePreviewController.prototype.closeTab = function(targetId) {
	var self = this;
	(async function() {
		try {
			await fetch(EGO_CLOSE_ROUTE, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ targetId })
			});
		} catch (e) {}
		if (self.selectedTabId === targetId) {
			self.selectedTabId = null;
			self.pinned = null;
		}
		self.refresh();
	})();
};
LivePreviewController.prototype.toggleHistory = function() {
	this.historyOpen = !this.historyOpen;
	this._recompute();
};
LivePreviewController.prototype.dismissGuide = function(which) {
	this.dismissedGuides[which] = true;
	this._recompute();
};
LivePreviewController.prototype.flushLogin = function() {
	return (async function() {
		return (await fetch(FLUSH_ROUTE, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}"
		})).json();
	})();
};
LivePreviewController.prototype._showHint = function(txt) {
	this._zoomHint = txt;
	this._recompute();
	if (this._zoomHintTimer) window.clearTimeout(this._zoomHintTimer);
	var self = this;
	this._zoomHintTimer = window.setTimeout(function() {
		self._zoomHint = null;
		self._recompute();
	}, 2e3);
};
LivePreviewController.prototype.noteWired = function() {
	if (!this.wiringStale) return;
	this.wiringStale = false;
	if (this._wiredRecomputeQueued) return;
	this._wiredRecomputeQueued = true;
	var self = this;
	Promise.resolve().then(function() {
		self._wiredRecomputeQueued = false;
		if (!self.disposed) self._recompute();
	});
};
LivePreviewController.prototype._signalUnwired = function() {
	var now = Date.now();
	if (now - this._lastUnwiredAt < 5e3) return;
	this._lastUnwiredAt = now;
	try {
		console.warn("[dsh-browser-cdp] live view not wired (liveImgTargetId=" + this.liveImgTargetId + ", current=" + this.currentActiveId + ") — input dropped");
	} catch (e) {}
	this._showHint(wt("hintNotCaptured"));
};
LivePreviewController.prototype._applyZoom = function() {
	if (!this.liveImg) return;
	this.liveImg.style.transformOrigin = "0 0";
	this.liveImg.style.transform = "translate(" + this.zoomState.tx + "px," + this.zoomState.ty + "px) scale(" + this.zoomState.scale + ")";
};
LivePreviewController.prototype.resetZoom = function() {
	this.zoomState = {
		scale: 1,
		tx: 0,
		ty: 0
	};
	this._applyZoom();
	this._showHint(wt("hintReset"));
};
LivePreviewController.prototype.handleWheel = function(e) {
	e.preventDefault();
	e.stopPropagation();
	if (e.ctrlKey || e.metaKey) {
		if (!this.liveImg) return;
		var rect = this.liveImg.getBoundingClientRect();
		var mx = e.clientX - rect.left, my = e.clientY - rect.top;
		var next = Math.min(8, Math.max(1, this.zoomState.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
		if (next <= 1) {
			this.resetZoom();
			return;
		}
		this.zoomState.tx = mx - (mx - this.zoomState.tx) * (next / this.zoomState.scale);
		this.zoomState.ty = my - (my - this.zoomState.ty) * (next / this.zoomState.scale);
		this.zoomState.scale = next;
		this._applyZoom();
		this._showHint(wt("hintPan"));
		return;
	}
	var p = this.browserXY(e);
	if (p && this.liveImgTargetId) this.sendInput(this.liveImgTargetId, "mouseWheel", {
		x: p.x,
		y: p.y,
		deltaX: e.deltaX || 0,
		deltaY: e.deltaY || (e.deltaMode === 1 ? 40 : e.deltaY || 100)
	});
	else this._signalUnwired();
};
LivePreviewController.prototype.handlePointerDown = function(e) {
	if (e.button !== 0) return;
	if (this.pickControl.isEnabled()) {
		var pp = this.browserXY(e);
		if (pp) this.pickControl.clickAt(pp.x, pp.y, this.liveImgTargetId);
		return;
	}
	this._pointerState = {
		viewPanning: false,
		browserDrag: false,
		sx: e.clientX,
		sy: e.clientY,
		stx: this.zoomState.tx,
		sty: this.zoomState.ty,
		lastDragPos: null,
		downButtons: 0,
		targetId: this.liveImgTargetId
	};
	try {
		e.currentTarget.setPointerCapture(e.pointerId);
	} catch (err) {}
	if (e.ctrlKey || e.metaKey) {
		this._pointerState.viewPanning = true;
		e.currentTarget.style.cursor = "grabbing";
		this._showHint(wt("hintScroll"));
		return;
	}
	this._pointerState.browserDrag = true;
	this.keyboardProxy.focusAt(e, this._pointerState.targetId);
	this._pointerState.downButtons = 1;
	var p = this.browserXY(e);
	if (p) {
		this._pointerState.lastDragPos = p;
		this.sendInput(this._pointerState.targetId, "mousePressed", {
			x: p.x,
			y: p.y,
			button: "left",
			buttons: 1,
			clickCount: 1
		});
	} else this._signalUnwired();
};
LivePreviewController.prototype.handlePointerMove = function(e) {
	if (!this._pointerState) {
		var p = this.browserXY(e);
		if (p) this.sendInput(this.liveImgTargetId, "mouseMoved", {
			x: p.x,
			y: p.y,
			buttons: 0
		});
		return;
	}
	if (this._pointerState.viewPanning) {
		this.zoomState.tx = this._pointerState.stx + (e.clientX - this._pointerState.sx);
		this.zoomState.ty = this._pointerState.sty + (e.clientY - this._pointerState.sy);
		this._applyZoom();
		return;
	}
	if (this._pointerState.browserDrag) {
		var p2 = this.browserXY(e);
		if (p2) {
			this.sendInput(this._pointerState.targetId, "mouseMoved", {
				x: p2.x,
				y: p2.y,
				buttons: this._pointerState.downButtons
			});
			this._pointerState.lastDragPos = p2;
		}
	}
};
LivePreviewController.prototype.handlePointerUp = function(e) {
	if (!this._pointerState) return;
	if (this._pointerState.viewPanning) {
		if (e.currentTarget) e.currentTarget.style.cursor = "grab";
	}
	if (this._pointerState.browserDrag) {
		if (this._pointerState.lastDragPos && this._pointerState.targetId) this.sendInput(this._pointerState.targetId, "mouseReleased", {
			x: this._pointerState.lastDragPos.x,
			y: this._pointerState.lastDragPos.y,
			button: "left",
			buttons: 0,
			clickCount: 1
		});
	}
	if (e.currentTarget) e.currentTarget.style.cursor = "grab";
	this._pointerState = null;
};
LivePreviewController.prototype.handleDoubleClick = function(e) {
	e.preventDefault();
	this.resetZoom();
};
function EgoBrowserTab(props) {
	var visible = props.visible;
	var ctx = props.ctx;
	var controllerRef = React.useRef(null);
	if (controllerRef.current === null) controllerRef.current = new LivePreviewController(ctx);
	var controller = controllerRef.current;
	var useSnapshotRef = React.useRef(null);
	if (useSnapshotRef.current === null) useSnapshotRef.current = bindSnapshotSelector(controller.store);
	var state = useSnapshotRef.current(function(s) {
		return s;
	});
	var imgRef = React.useRef(null);
	var videoRef = React.useRef(null);
	var bindLiveImg = function(el) {
		imgRef.current = el;
		if (el && state.currentTargetId != null && (controller.liveImg !== el || controller.liveImgTargetId !== state.currentTargetId)) {
			controller.setLiveImg(el, state.currentTargetId);
			controller.noteWired();
		}
	};
	var bindLiveVideo = function(el) {
		videoRef.current = el;
		if (el && state.currentTargetId != null && (controller.liveImg !== el || controller.liveImgTargetId !== state.currentTargetId)) {
			controller.setLiveVideo(el, state.currentTargetId);
			controller.noteWired();
		}
	};
	React.useEffect(function() {
		controller.start();
		return function() {
			controller.dispose();
		};
	}, [controller]);
	React.useEffect(function() {
		controller.setVisible(visible);
	}, [visible, controller]);
	React.useEffect(function() {
		if (imgRef.current && state.currentTargetId != null) controller.setLiveImg(imgRef.current, state.currentTargetId);
		if (videoRef.current && state.currentTargetId != null) controller.setLiveVideo(videoRef.current, state.currentTargetId);
	}, [
		state.currentTargetId,
		state.backend,
		state.streamGeneration,
		state.streamState,
		controller
	]);
	React.useEffect(function() {
		var img = imgRef.current || videoRef.current;
		if (!img) return;
		var handler = function(e) {
			controller.handleWheel(e);
		};
		img.addEventListener("wheel", handler, { passive: false });
		return function() {
			img.removeEventListener("wheel", handler);
		};
	}, [
		controller,
		state.currentTargetId,
		state.backend,
		state.streamGeneration
	]);
	var h = React.createElement;
	var header = h("div", { className: "dsh-ego-side-head" }, h("span", { className: "dsh-ego-side-title" }, h("span", { dangerouslySetInnerHTML: { __html: ICON_GLOBE } }), h("span", { style: { marginLeft: "5px" } }, state.busy ? wt("titleLive") : wt("title"))), h("button", {
		className: "dsh-ego-side-iconbtn" + (state.busy ? " spinning" : ""),
		title: wt("refresh"),
		onClick: function() {
			controller.refresh();
		}
	}, h("span", { dangerouslySetInnerHTML: { __html: ICON_REFRESH } })), h("button", {
		className: "dsh-ego-side-iconbtn" + (state.historyOpen ? "" : " off"),
		title: state.historyOpen ? wt("historyHide") : wt("historyShow"),
		onClick: function() {
			controller.toggleHistory();
		}
	}, h("span", { dangerouslySetInnerHTML: { __html: ICON_CLOCK } })));
	if (state.historyOpen) {
		var sorted = state.spaces.slice().sort(function(a, b) {
			return (a.lastActive || 0) - (b.lastActive || 0);
		});
		return h("div", { className: "dsh-ego-side-root" }, header, h("div", { className: "dsh-ego-side-history" }, h("div", { className: "dsh-ego-side-historyhead" }, h("span", { dangerouslySetInnerHTML: { __html: ICON_CLOCK } }), " " + wt("history")), h("div", { className: "dsh-ego-side-historylist" }, sorted.length === 0 ? h("div", { className: "dsh-ego-side-hnone" }, wt("noHistory")) : sorted.map(function(s) {
			return h("div", {
				key: s.targetId,
				className: "dsh-ego-side-hitem" + (s.targetId === state.currentTargetId ? " active" : ""),
				onClick: function() {
					controller.pinTo(s);
					controller.toggleHistory();
				}
			}, s.thumbnail ? h("img", {
				className: "dsh-ego-side-hthumb",
				src: s.thumbnail,
				alt: ""
			}) : h("div", { className: "dsh-ego-side-hthumb" }), h("div", { className: "dsh-ego-side-hinfo" }, h("div", { className: "dsh-ego-side-htitle" }, s.title || s.url || wt("newTab")), h("div", { className: "dsh-ego-side-hurl" }, s.url || "(about:blank)"), s.targetId === state.currentTargetId ? h("div", { className: "dsh-ego-side-hactive" }, "● " + wt("current")) : null));
		}))));
	}
	var guides = [];
	if (state.showLoginGuide) guides.push(h(EgoLoginGuide, {
		key: "login",
		controller
	}));
	if (state.captchaKind) guides.push(h(EgoCaptchaGuide, {
		key: "captcha",
		kind: state.captchaKind,
		controller
	}));
	var tabsEl = state.spaces.length > 0 ? h("div", { className: "dsh-ego-side-tabs" }, state.spaces.map(function(s) {
		var isActive = s.targetId === state.selectedTabId || state.selectedTabId === null && s.targetId === state.currentTargetId;
		return h("div", {
			key: s.targetId,
			className: "dsh-ego-side-tab" + (isActive ? " active" : ""),
			title: s.url || "",
			onClick: function() {
				controller.selectTab(s.targetId);
			}
		}, h("span", { className: "dsh-ego-side-tabdot" }), h("span", { className: "dsh-ego-side-tabtxt" }, s.title || s.url || wt("newTab")), h("span", {
			className: "dsh-ego-side-tabclose",
			title: wt("closeTab"),
			onClick: function(e) {
				e.stopPropagation();
				controller.closeTab(s.targetId);
			}
		}, "×"));
	})) : null;
	var body;
	var currentSpace = state.currentSpace;
	if (!currentSpace) body = h("div", { className: "dsh-ego-side-body" }, h("div", { className: "dsh-ego-side-empty" }, h("div", null, wt("noActivePages")), h("div", { style: { fontSize: "11px" } }, wt("noActiveHint"))));
	else {
		var liveImg = state.backend === "ffmpeg" ? h("video", {
			ref: bindLiveVideo,
			key: "livevideo-" + state.streamGeneration,
			className: "dsh-ego-side-liveimg",
			muted: true,
			autoPlay: true,
			playsInline: true,
			onPointerDown: function(e) {
				controller.handlePointerDown(e);
			},
			onPointerMove: function(e) {
				controller.handlePointerMove(e);
			},
			onPointerUp: function(e) {
				controller.handlePointerUp(e);
			},
			onPointerCancel: function(e) {
				controller.handlePointerUp(e);
			},
			onDoubleClick: function(e) {
				controller.handleDoubleClick(e);
			}
		}) : currentSpace.thumbnail ? h("img", {
			ref: bindLiveImg,
			key: "liveimg",
			className: "dsh-ego-side-liveimg",
			src: currentSpace.thumbnail,
			alt: "live",
			draggable: false,
			onPointerDown: function(e) {
				controller.handlePointerDown(e);
			},
			onPointerMove: function(e) {
				controller.handlePointerMove(e);
			},
			onPointerUp: function(e) {
				controller.handlePointerUp(e);
			},
			onPointerCancel: function(e) {
				controller.handlePointerUp(e);
			},
			onDoubleClick: function(e) {
				controller.handleDoubleClick(e);
			}
		}) : h("div", { className: "dsh-ego-side-liveurl" }, state.streamMessage || wt("noScreenshot"));
		body = h("div", { className: "dsh-ego-side-body" }, h("div", { className: "dsh-ego-side-liveview" }, h("div", { className: "dsh-ego-side-livebadge" }, h("span", { className: "dsh-ego-side-state-dot" + (state.pinned ? " pin" : state.busy ? " busy" : "") }), h("span", { style: { flex: 1 } }, (state.backend === "ffmpeg" ? "FFmpeg · H.264" : "CDP") + " · " + (state.streamState === "failed" ? state.streamMessage || wt("failed") : state.streamState) + (state.currentTargetId ? state.wiringStale ? " · " + wt("stale") : " · " + wt("captured") : "")), state.pinned ? h("button", {
			className: "dsh-ego-side-back",
			type: "button",
			onClick: function() {
				controller.unpin();
			}
		}, wt("backToLive")) : null, h("button", {
			className: "dsh-ego-side-back" + (state.pick === "on" ? " dsh-ego-pick-on" : ""),
			type: "button",
			title: wt("pickModeHint"),
			onClick: function() {
				controller.togglePick();
			}
		}, state.pick === "failed" ? wt("pickFailed") : state.pick === "on" ? wt("picking") : wt("pickMode")), h("button", {
			className: "dsh-ego-side-back",
			type: "button",
			title: wt("openExternal"),
			onClick: function() {
				var url = currentSpace.url;
				if (url && !url.startsWith("about:") && !url.startsWith("chrome://")) window.open(url, "_blank", "noopener");
			}
		}, wt("openExternal")), h("button", {
			className: "dsh-ego-side-back",
			type: "button",
			title: wt("raiseWindowHint"),
			onClick: function() {
				fetch("/api/bcdp/raise", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{}"
				}).then(function(r) {
					return r.json().catch(function() {
						return null;
					});
				}).catch(function() {
					return null;
				});
			}
		}, wt("raiseWindow"))), liveImg, h("div", { className: "dsh-ego-side-livetitle" }, currentSpace.title || currentSpace.url || wt("newTab")), h("div", { className: "dsh-ego-side-liveurl" + (state.zoomHint ? " dsh-ego-side-hint" : "") }, state.zoomHint || currentSpace.url || "")));
	}
	return h("div", { className: "dsh-ego-side-root" }, header, guides, tabsEl, body);
}
function EgoLoginGuide(props) {
	var controller = props.controller;
	var h = React.createElement;
	var noteState = React.useState("");
	var note = noteState[0], setNote = noteState[1];
	var savingState = React.useState(false);
	var saving = savingState[0], setSaving = savingState[1];
	return h("div", { className: "dsh-ego-side-login" }, h("span", { className: "dsh-ego-side-login-txt" }, wt("loginTitle")), h("button", {
		className: "dsh-ego-side-login-btn" + (saving ? " saving" : ""),
		type: "button",
		disabled: saving,
		onClick: function() {
			setSaving(true);
			setNote("");
			controller.flushLogin().then(function(j) {
				if (j && j.ok) setNote(wt("loginSaved", { n: j.total || "" }));
				else setNote(j && j.error ? wt("loginNotConnected") : wt("loginFailed"));
			}).catch(function() {
				setNote(wt("loginFailed"));
			}).finally(function() {
				setSaving(false);
			});
		}
	}, saving ? wt("loginSaving") : wt("loginBtn")), note ? h("span", { className: "dsh-ego-side-login-note" }, note) : null, h("button", {
		className: "dsh-ego-side-iconbtn",
		type: "button",
		title: wt("loginDismiss"),
		onClick: function() {
			controller.dismissGuide("login");
		}
	}, "×"));
}
function EgoCaptchaGuide(props) {
	var controller = props.controller;
	var kind = props.kind;
	var h = React.createElement;
	return h("div", { className: "dsh-ego-side-captcha" }, h("span", { className: "dsh-ego-side-captcha-txt" }, h("b", null, wt("captchaTitle")), " — " + wt("captchaHint")), h("span", { className: "dsh-ego-side-captcha-kind" }, kind), h("button", {
		className: "dsh-ego-side-iconbtn",
		type: "button",
		title: wt("captchaDismiss"),
		onClick: function() {
			controller.dismissGuide("captcha");
		}
	}, "×"));
}
function mountSidebarTab(ctx, betterSidebar) {
	if (!betterSidebar) return function() {};
	var styleEl = document.createElement("style");
	styleEl.textContent = TAB_CSS;
	document.head.appendChild(styleEl);
	var disposeTab = betterSidebar.registerTab({
		id: "dsh-browser-cdp:watch",
		title: function() {
			return wt("title");
		},
		order: 70,
		single: true,
		component: EgoBrowserTab
	});
	var probeDisposed = false;
	var baseline = null;
	var autoOpened = {};
	var openWatchTab = function(sessionId) {
		var key = sessionId || "";
		if (autoOpened[key] === true) return;
		autoOpened[key] = true;
		try {
			betterSidebar.openTab({ type: "dsh-browser-cdp:watch" }, sessionId ? { sessionId } : void 0);
		} catch (e) {}
	};
	(async function() {
		if (probeDisposed) return;
		try {
			var res = await fetch(SPACES_ROUTE, { cache: "no-store" });
			if (!res.ok) return;
			var data = await res.json();
			if (data && typeof data.toolCallCount === "number") baseline = data.toolCallCount;
		} catch (e) {}
	})();
	var probeSse = null;
	try {
		probeSse = new EventSource("/api/bcdp/stream");
	} catch (e) {}
	if (probeSse) probeSse.addEventListener("tool-call", function(ev) {
		if (probeDisposed) return;
		try {
			var m = JSON.parse(ev.data);
			if (!m || typeof m.count !== "number") return;
			var sid = typeof m.sessionId === "string" && m.sessionId !== "" ? m.sessionId : void 0;
			if (baseline === null) {
				baseline = m.count;
				if (m.count > 0) openWatchTab(sid);
				return;
			}
			if (m.count > baseline) openWatchTab(sid);
		} catch (e) {}
	});
	return function() {
		probeDisposed = true;
		try {
			if (probeSse) probeSse.close();
		} catch (e) {}
		disposeTab();
		styleEl.remove();
	};
}
function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&#39;"
	})[c]);
}
const name = "dsh-browser-cdp";

//#endregion
exports.apply = apply;
exports.inject = inject;
exports.name = name;
return module.exports; } });
//# sourceMappingURL=client.js.map