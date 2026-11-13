/**
 * ego-browser cast-server — host half of the realtime watch panel.
 *
 * Bridges the client UI (/api/bcdp/*) to the ego-cast worker
 * (bin/cdp-cast-worker.mjs) that attaches to the agent's live browser and
 * streams screencast JPEGs. Everything the agent's own browser does is pushed;
 * this host route only *reads* the worker's loopback JSON. No navigation, no
 * writes, no host env changes — consistent with the plugin's read-only stance.
 *
 * Lifecycle: the worker is launched lazily (only once), on the first request,
 * when a live agent browser is expected. If no browser.json exists yet it
 * exits cleanly; we surface an empty spaces list so the panel says
 * "no live browser right now" instead of erroring.
 */
import { fileURLToPath } from 'node:url'
import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { request, type ClientRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import type { EgoContext, RegisterRouteOptions, ResolvedConfig, WebServerLike } from './types.ts'
import type { SettingsBridge } from './settings.ts'
import type { FfmpegInstallationManager, FfmpegStatus } from './ffmpeg-installation.ts'
import type { LoginImportOptions, LoginImportReport } from './login-import.ts'
import { EGO_LINUX_CDP_URL, EGO_CLI_KIND, TABBIT_CLI_KIND, resolveEffectiveLink } from './cdp-targets.ts'
import { runtimeOfLink } from './runtime/backend-runtime.ts'
import { BCDP_CDP_ENGINE } from './cdp/capabilities.ts'
import { snapshotStats } from './runtime/stats.ts'
import { defaultFocusStore, type TargetFocus } from './runtime/focus.ts'
import { CLIENT_BUILD } from './client/build.ts'
import type { CliFramePoller } from './cast/cli-frame-poller.ts'
import type { PanelActionRunner } from './cast/panel-actions.ts'

const WORKER_BIN = fileURLToPath(new URL('../bin/cdp-cast-worker.mjs', import.meta.url))

// ── R1: activated CDP endpoint for the watch/stream worker ────────────────
// The cast worker is a separate long-lived process that attaches to the SAME
// browser the tools drive. It cannot read the host half's per-spawn env, so
// the resolved endpoint is handed to it explicitly: once as env when it
// starts, and again on every activation change (which also recycles it — see
// `setAttachEndpoint`). Same rules as for tools: nothing derived is persisted,
// and no resolved endpoint simply means "no remote attach" (the worker then
// behaves exactly as it did before R1).
let attachWsUrl: string | null = null
/** Engine of the attached endpoint, published next to it. */
let attachEngine: 'chrome' | 'lightpanda' | 'tabbit' | 'unknown' | null = null
/** Logger captured in initCastServer so module-level helpers can report. */
let castLogger: { info?: (message: string) => void; warn?: (message: string) => void } | undefined
/**
 * The active ego-cli frame poller, published by initCastServer so the tool-side
 * doctor can report the current frame source without threading the instance
 * through every registration. Null when no cast server is wired (headless host).
 */
let activeCliPoller: CliFramePoller | null = null
/** Frame-source status for bcdp_doctor: running + the newest frame's age. */
export function getCliPollStatus(): { running: boolean; lastFrameAgeMs: number | null; frameSeq: number } {
  if (!activeCliPoller || !activeCliPoller.isRunning()) return { running: false, lastFrameAgeMs: null, frameSeq: 0 }
  const f = activeCliPoller.getFrame()
  return {
    running: true,
    lastFrameAgeMs: f ? Math.max(0, Date.now() - f.updatedAt) : null,
    frameSeq: f ? f.seq : 0,
  }
}

/**
 * Publish the currently resolved endpoint for the worker. Called by the host
 * half whenever the ACTIVATED target changes (new target, new endpoint, or
 * mode switching away from remote). Returns true when the value actually
 * changed, which is the caller's signal that the worker must be recycled.
 * The engine rides along so a spawned worker gets its capability projection
 * via env (`BCDP_CDP_ENGINE`) instead of re-deriving it.
 */
export function setAttachEndpoint(wsUrl: string | null, engine: 'chrome' | 'lightpanda' | 'tabbit' | 'unknown' | null = null): boolean {
  const next = wsUrl && wsUrl !== '' ? wsUrl : null
  const nextEngine = next === null ? null : engine
  if (next === attachWsUrl && nextEngine === attachEngine) return false
  attachWsUrl = next
  attachEngine = nextEngine
  return true
}

/** The endpoint the worker should attach to right now (null = none). */
export function getAttachEndpoint(): string | null {
  return attachWsUrl
}

/** The engine of the attached endpoint (null = none attached). */
export function getAttachEngine(): 'chrome' | 'lightpanda' | 'tabbit' | 'unknown' | null {
  return attachEngine
}

/**
 * Stop a running worker so the next request respawns it with the new argv
 * seed (T2.4: an activation change must take effect on a live panel, not only
 * after a host restart). Kills only the pid WE spawned (per our namespaced state file) —
 * never a name-matched sweep, which previously took out the DSH subprocess
 * runner along with our own tree (issues #34 defect 2 / #40).
 */
export async function recycleWorker(reason: string): Promise<boolean> {
  const state = await knownWorkerState()
  if (state.pid === null || !isProcessAlive(state.pid)) return false
  try {
    process.kill(state.pid, 'SIGTERM')
  } catch {
    try {
      process.kill(state.pid, 'SIGKILL')
    } catch {
      return false
    }
  }
  castLogger?.info?.(`recycled cast worker (pid ${state.pid}) because ${reason}`)
  return true
}

export const EGO_SPACES_ROUTE = '/api/bcdp/spaces'
export const EGO_STREAM_ROUTE = '/api/bcdp/stream'
export const EGO_HEALTH_ROUTE = '/api/bcdp/health'
export const EGO_CLOSE_ROUTE = '/api/bcdp/close'
export const EGO_FLUSH_ROUTE = '/api/bcdp/flush'
export const EGO_RAISE_ROUTE = '/api/bcdp/raise'
export const EGO_MARKS_ROUTE = '/api/bcdp/marks'
export const EGO_PICK_ROUTE = '/api/bcdp/pick'
export const EGO_LOGIN_IMPORT_ROUTE = '/api/bcdp/login-import'
export const EGO_INPUT_ROUTE = '/api/bcdp/input'
export const EGO_WATCH_START_ROUTE = '/api/bcdp/watch/start'
export const EGO_WATCH_SWITCH_ROUTE = '/api/bcdp/watch/switch'
export const EGO_WATCH_STOP_ROUTE = '/api/bcdp/watch/stop'
export const EGO_WATCH_STATUS_ROUTE = '/api/bcdp/watch/status'
/** Operation focus: which tab the next tool call drives (host-owned). */
export const EGO_FOCUS_ROUTE = '/api/bcdp/focus'
/** Host-local counters for the automatic sources (probe / tick / frame / queue). */
export const EGO_STATS_ROUTE = '/api/bcdp/stats'
/**
 * "Sync the active object now" — the panel's ⟳.
 *
 * Clicking it must not require a tool call: after a host restart the tab strip can
 * be filled from a read-only inventory (tabbit) or a fresh attach pass (cdp).
 */
export const EGO_SYNC_ROUTE = '/api/bcdp/sync'
/**
 * Client → host handshake: "this is the build I am running".
 *
 * The renderer can keep a cached bundle across host upgrades (the module URL's
 * revision does not track file contents), so "did my UI fix ship?" was
 * unanswerable from the outside. The client reports its build here; the host logs
 * it (visible in the app log without any auth) and echoes it in /api/bcdp/stats.
 */
export const EGO_HELLO_ROUTE = '/api/bcdp/hello'
/**
 * One frame of ONE tab, on demand.
 *
 * Frames used to follow only the active tab, so any other tab sat on "暂无截图"
 * forever no matter what the user clicked. This is the per-object counterpart of
 * the 3 s polls.
 */
export const EGO_CAPTURE_ROUTE = '/api/bcdp/capture'
export const EGO_VIDEO_ROUTE = '/api/bcdp/video'
export const EGO_VIDEO_STATUS_ROUTE = '/api/bcdp/video/status'
// ego-cli degraded frame source: serves the newest CLI-captured viewport PNG to
// the watch panel when no CDP screencast is available.
export const EGO_CLI_FRAME_ROUTE = '/api/bcdp/cli-frame'
/** Synthetic target id the panel shows for the single CLI fallback frame. */
export const CLI_FRAME_TARGET_ID = '__cli_frame__'

// ── tool-call signal (auto-open sidebar Tab) ─────────────────────────────
// Module-level counter bumped by markEgoToolCall() from the tool execute
// path (src/index.ts: defineEgoTool). When a new tool call lands, we
// broadcast a `tool-call` SSE event to every connected watch-panel client
// so the sidebar auto-opens instantly — NO client-side polling needed.
// (Previously the client polled /api/bcdp/spaces every 2s to detect this;
//  that loop is now gone.) Process-local; resets to 0 on host restart,
// which is fine — the auto-open is a one-shot per session anyway.
let toolCallCount = 0
/**
 * `/api/bcdp/watch/*` accounting.
 *
 * `refused` counts the CLI-channel answers. It is the cheapest proof that the
 * 1728-request 409 storm is gone: the old client stopped retrying as soon as the
 * route answered 200, and the new client never asks at all.
 */
let watchCalls = 0
let watchRefused = 0
export function getWatchCounters(): { calls: number; refused: number } {
  return { calls: watchCalls, refused: watchRefused }
}
/** Last build the panel reported via /api/bcdp/hello (+ when). Out-of-band proof
 * of which client bundle is actually running; also echoed in /api/bcdp/stats. */
let lastClientBuild = ''
let lastClientAt = 0
let reportedClientBuild = ''
const sseClients = new Set<ServerResponse>()

/** Timestamp of the last bcdp_* tool call — the idle reaper's activity signal. */
let lastEgoActivity = 0
export function getLastEgoActivity(): number {
  return lastEgoActivity
}

// ── activity subscribers (tool-tier injection) ────────────────────────────
// The tier controller needs the same signal the reaper reads — "a bcdp_* call
// just happened" — but must not have to thread a callback through the nine
// `markEgoToolCall()` call sites in the tool bodies. One module-level fan-out
// keeps the tools oblivious to tiers.
const activityListeners = new Set<(sessionId?: string) => void>()

/**
 * Subscribe to "one bcdp_* call just landed".
 * @returns the unsubscribe function.
 */
export function onEgoActivity(cb: (sessionId?: string) => void): () => void {
  activityListeners.add(cb)
  return () => {
    activityListeners.delete(cb)
  }
}

export function markEgoToolCall(sessionId?: string): void {
  toolCallCount += 1
  lastEgoActivity = Date.now()
  // Tier fan-out: never let a listener throw into the tool's own result path.
  for (const cb of [...activityListeners]) {
    try {
      cb(sessionId)
    } catch {
      /* tier reapply is best-effort; the tool call stands */
    }
  }
  // Push the new count to every connected SSE client immediately. The event
  // payload carries the counter AND the calling session id (when the caller
  // supplied one): the client scopes its sidebar auto-open to that session, so
  // a background conversation's tool call lands in ITS OWN sidebar instead of
  // the one the user happens to be reading.
  const payload = sessionId === undefined || sessionId === ''
    ? { count: toolCallCount }
    : { count: toolCallCount, sessionId }
  const frame = `event: tool-call\ndata: ${JSON.stringify(payload)}\n\n`
  for (const res of sseClients) {
    try {
      res.write(frame)
    } catch {
      sseClients.delete(res)
    }
  }
}

/**
 * Push one CLI-captured frame into the live watch-panel stream. In the degraded
 * ego-cli mode there is no screencast worker to emit `spaces`/`frame` events, so
 * the poller is their only source: we broadcast a synthetic single-space `spaces`
 * event (tab bar + active page) followed by a `frame` event (the image) to every
 * connected client. The client's existing SSE handlers render both, so the panel
 * updates the instant a frame lands — no client polling, no chicken/egg.
 *
 * `fmt` names the image encoding: the client builds `data:image/<fmt>;base64,…`,
 * so a JPEG frame MUST say `jpeg` or the panel renders garbage. Default `png`
 * keeps the ego-cli poller (which captures PNG) unchanged.
 */
/** One row of the panel's shared tab bucket (worker spaces / CLI frame / Tabbit). */
export interface CliSpaceRow {
  targetId: string
  url: string
  title: string
  active: boolean
  lastActive: number
  /** Browser window the tab lives in. Two windows with the same pages look like
   * duplicated rows; the panel shows a W1/W2 badge instead of hiding one. */
  windowId?: number
}

export function broadcastCliFrame(
  frame: { png: Buffer; url: string; title: string; seq: number; updatedAt: number; fmt?: 'png' | 'jpeg'; targetId?: string },
  spaces?: CliSpaceRow[],
): void {
  broadcastCliFrames([{ targetId: frame.targetId ?? '', png: frame.png, fmt: frame.fmt, url: frame.url, title: frame.title }], spaces, frame.updatedAt)
}

/** One captured image bound to the tab it came from. */
export interface CliFrameImage {
  targetId: string
  png: Buffer
  fmt?: 'png' | 'jpeg'
  url?: string
  title?: string
}

/**
 * Push one capture CYCLE into the live stream: 全模式 sends one image per tab,
 * 仅激活 sends exactly one. Every image is its own `frame` event keyed by
 * `targetId`, so the client caches a picture per tab and the strip can show the
 * right one when the user switches — the active tab's image is the one the
 * panel outlines.
 */
export function broadcastCliFrames(images: CliFrameImage[], spaces?: CliSpaceRow[], at?: number): void {
  if (images.length === 0) return
  const stamp = at ?? Date.now()
  // Remember the cycle so the hold/heartbeat timer can re-emit it during the gap
  // between 3s CLI captures (a screenshot can momentarily stall rendering).
  lastCliFrames = images
  lastCliFrameAt = stamp
  lastCliFrameRealAt = stamp
  // A caller that KNOWS the real tab inventory hands it in, so the panel's tab
  // strip is driven by the same cadence as the picture. No override = synthetic
  // single row (ego-cli / Tabbit callers always provide one now).
  lastCliSpaces = spaces && spaces.length > 0 ? spaces : null
  writeCliImages(images, stamp)
}
/** Tab inventory supplied by the newest frame broadcast (null = synthetic row). */
let lastCliSpaces: CliSpaceRow[] | null = null
/**
 * Push a SPACES-ONLY update to the panel.
 *
 * Frame broadcasts are the usual carrier, but they early-return when there is
 * no image (blank page, capture skipped). Structural changes — a tab closed, a
 * task recycled — must still reach the strip immediately instead of waiting for
 * the next successful capture.
 */
export function broadcastCliSpaces(rows: CliSpaceRow[]): void {
  lastCliSpaces = rows.length > 0 ? rows : null
  if (sseClients.size === 0) return
  const chunk = `event: spaces\ndata: ${JSON.stringify(rows)}\n\n`
  for (const client of sseClients) {
    try { client.write(chunk) } catch { /* dropped by its own close handler */ }
  }
}

/**
 * How many panels are currently subscribed to the CLI-channel SSE stream.
 *
 * The automatic sources read this: a frame nobody will ever see must not spend
 * the backend's shared budget (Tabbit: one `nodejs` receipt per capture, 1024
 * per task — measured to starve the tool path in ~51 minutes of polling).
 */
export function panelWatcherCount(): number {
  return sseClients.size
}

/**
 * Push the operation focus to every panel client.
 *
 * One event, one owner: the panel never has to infer "which row is current"
 * from the spaces ordering anymore — and a CLI channel (no worker, no CDP) can
 * carry the same event, which is why it lives here instead of in the worker.
 */
export function broadcastFocus(focus: TargetFocus | null): void {
  if (sseClients.size === 0) return
  const payload = focus === null ? null : { targetId: focus.targetId, source: focus.source, at: focus.at }
  const chunk = `event: focus\ndata: ${JSON.stringify(payload)}\n\n`
  for (const client of sseClients) {
    try { client.write(chunk) } catch { /* a dead client is dropped by its own close handler */ }
  }
}

/**
 * The worker half of a focus write, injected by initCastServer (it owns
 * ensureWorker/proxyPost). Null in a headless host or on a CLI channel.
 */
let focusPusher: ((targetId: string) => Promise<{ status: number; body: unknown } | null>) | null = null
export function setFocusPusher(fn: typeof focusPusher): void {
  focusPusher = fn
}

/**
 * Record `targetId` as the operation focus and tell everyone who cares.
 *
 * The store is written FIRST (the panel highlight must not wait on a socket),
 * then the worker is told; a worker answering `focus-stale` clears it, because a
 * tab that is gone must not stay highlighted. `targetId === ''` clears.
 *
 * This is the single entry point for BOTH producers: an operator click and a
 * tool result that reports the tab it just drove.
 */
export async function pushFocus(targetId: string, source: TargetFocus['source'] = 'agent'): Promise<TargetFocus | null> {
  const id = String(targetId ?? '').trim()
  const focus = defaultFocusStore.set(id, source)
  broadcastFocus(focus)
  if (id !== '' && focusPusher !== null) {
    const result = await focusPusher(id).catch(() => null)
    if (result !== null && result.status >= 400) {
      const cleared = defaultFocusStore.set('', 'agent')
      broadcastFocus(cleared)
      return cleared
    }
  }
  return focus
}
/** Newest capture cycle, replayed by the 1s hold timer in initCastServer. */
let lastCliFrames: CliFrameImage[] | null = null
/** Wall-clock of the last broadcast/replay; the hold timer only fills >1s gaps. */
let lastCliFrameAt = 0
/**
 * Wall-clock of the last REAL capture (never bumped by a replay). The hold
 * buffer is measured against this, not against `lastCliFrameAt`.
 */
let lastCliFrameRealAt = 0
/**
 * 缓冲窗口：真实捕获节奏 3–6s（一次 tick 要跑 1–2 个 CLI，慢页面上单帧能贴
 * 近 8s 截止），所以没刷新时面板最多靠重播撑 4s。
 */
export const CLI_FRAME_HOLD_MAX_AGE_MS = 4000
/**
 * 心跳重播判定（抽成纯函数是为了把“最多缓冲 4s”钉成可断言的不变量）：
 * 距上次重播 ≥1s（避免每帧刷）且距上次真实捕获 ≤缓冲窗口。
 */
export const cliFrameHoldDue = (now: number, lastRealAt: number, lastReplayAt: number): boolean =>
  lastRealAt !== 0 &&
  now - lastReplayAt >= 1000 &&
  now - lastRealAt <= CLI_FRAME_HOLD_MAX_AGE_MS
/** Push one capture cycle to every SSE client. `includeSpaces` also re-emits the
 * spaces list (real captures do; the 1s hold replay only refreshes the images
 * to avoid churning the client's store/render every second). */
function writeCliImages(images: CliFrameImage[], at: number, includeSpaces = true): void {
  if (sseClients.size === 0) return
  const first = images[0]!
  const rows: CliSpaceRow[] = lastCliSpaces ?? [{
    targetId: CLI_FRAME_TARGET_ID,
    url: first.url ?? '',
    title: first.title ?? '',
    active: true,
    lastActive: at,
  }]
  const spacesFrame = `event: spaces\ndata: ${JSON.stringify(rows)}\n\n`
  const activeRow = rows.find((row) => row.active) ?? rows[0]
  const events: string[] = []
  for (const image of images) {
    // Bind each image to the tab it came from, falling back to the active row so
    // a legacy caller without targetId still lands somewhere renderable.
    const targetId = image.targetId || activeRow?.targetId || CLI_FRAME_TARGET_ID
    events.push(`event: frame\ndata: ${JSON.stringify({ targetId, data: image.png.toString('base64'), fmt: image.fmt ?? 'png', ts: at })}\n\n`)
  }
  for (const res of sseClients) {
    try {
      if (includeSpaces) res.write(spacesFrame)
      for (const event of events) res.write(event)
    } catch {
      sseClients.delete(res)
    }
  }
}

/** 全模式 session override: null = follow the persisted `tabTracking` setting. */
let cliTrackOverride: boolean | null = null
/** @internal effective tracking mode (panel toggle first, then the setting). */
export function getCliTrackAll(fallback: boolean): boolean {
  return cliTrackOverride === null ? fallback === true : cliTrackOverride
}
/** @internal */
export function setCliTrackAll(next: boolean | null): void {
  cliTrackOverride = typeof next === 'boolean' ? next : null
}
/** @internal drop the session override so the saved setting wins again. */
export function clearCliTrackOverride(): void {
  cliTrackOverride = null
}

function castStatePath(): string {
  // Mirror the ego-lite runtime state dir across platforms so we find the
  // worker's state file wherever it ran: Windows uses
  // %LOCALAPPDATA%\ego-lite-linux; POSIX uses $XDG_STATE_HOME (default
  // ~/.local/state)/ego-lite-linux. Honors EGO_LINUX_STATE_DIR overrides.
  // The FILE is plugin-namespaced (dsh-browser-cdp.cast.json): the upstream
  // dsh-ego-browser worker shares this dir under ego-cast.json, and
  // bridging to a foreign worker breaks every route we extended it with
  // (pick/marks/raise 404). Read ONLY our own file.
  const e = process.env
  const isWin = process.platform === 'win32'
  const home = e.HOME || e.USERPROFILE || (isWin ? e.LOCALAPPDATA || '' : '/root')
  const stateHome = e.EGO_LINUX_STATE_DIR || (isWin
    ? (e.LOCALAPPDATA || `${home}\\AppData\\Local`)
    : (e.XDG_STATE_HOME || `${home}/.local/state`))
  return stateHome.endsWith('ego-lite-linux')
    ? `${stateHome}/dsh-browser-cdp.cast.json`
    : `${stateHome}/ego-lite-linux/dsh-browser-cdp.cast.json`
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/** Proxy a worker loopback endpoint. Returns null when the worker is unreachable. */
async function proxyFrom(port: number, path: string): Promise<unknown> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

interface ProxyPostResult {
  status: number
  body: unknown
}

/** Proxy a POST with a JSON body to the worker. Returns status and body, or null when unreachable. */
export async function proxyPost(port: number, path: string, body: unknown, timeoutMs = 4000): Promise<ProxyPostResult | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { status: r.status, body: await r.json().catch(() => ({ ok: false, error: `worker returned ${r.status}` })) }
  } catch {
    return null
  }
}

/**
 * Bridge the worker's SSE stream to the DSH watch panel.
 *
 * The host's webServer calls this as a plain HTTP handler and then returns, so
 * we write the `text/event-stream` headers, start consuming the worker's
 * /api/stream body, and forward every SSE line verbatim onto `res` from a
 * background loop. The connection stays open until the worker stream ends or
 * the client disconnects. If the worker is unreachable we still emit a valid
 * empty SSE stream (the panel stays quiet instead of erroring).
 *
 * Each `res` is also registered in the module-level `sseClients` set so
 * markEgoToolCall() can inject `tool-call` events directly into the live
 * stream (the sidebar auto-open signal), without the client polling.
 */
export function proxyWorkerStream(port: number, res: ServerResponse, path: string): () => void {
  let cancelled = false
  let ended = false
  const endOnce = (): void => {
    if (ended) return
    ended = true
    sseClients.delete(res)
    try {
      res.end()
    } catch {
      /* ignore */
    }
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.write(':ok\n\n')
  sseClients.add(res)
  // No worker to bridge (ensureWorker() returned null and the handler passed
  // the -1 sentinel): keep the SSE connection open and quiet so
  // markEgoToolCall() can still push `tool-call` events and EventSource does
  // not reconnect-loop. request() below would synchronously throw
  // ERR_SOCKET_BAD_PORT on port -1 and leave the response dangling, which the
  // webserver's last-resort guard turns into a bare connection destroy —
  // the browser then reports net::ERR_EMPTY_RESPONSE.
  if (!Number.isInteger(port) || port <= 0) {
    res.on('close', () => {
      sseClients.delete(res)
    })
    return () => {
      sseClients.delete(res)
    }
  }
  // Use node:http (not fetch) to consume the worker's SSE stream. fetch buffers
  // chunked responses in a way that delays/interleaves the first data chunks
  // under Node's undici, which the real-time frame pipeline cannot tolerate —
  // http.request streams them as they arrive and frames forward immediately.
  const up: ClientRequest = request(
    { host: '127.0.0.1', port, path, method: 'GET', headers: { accept: 'text/event-stream' } },
    (upRes: IncomingMessage) => {
      upRes.on('data', (chunk: Buffer) => {
        if (cancelled || ended) return
        try {
          if (!res.write(chunk)) {
            upRes.pause()
            res.once('drain', () => {
              if (!cancelled && !ended) upRes.resume()
            })
          }
        } catch {
          cancelled = true
          endOnce()
        }
      })
      upRes.on('end', endOnce)
      upRes.on('error', endOnce)
    },
  )
  up.on('error', endOnce)
  up.setTimeout(5000, () => {
    try {
      up.destroy()
    } catch {
      /* ignore */
    }
    endOnce()
  })
  up.end()
  const onClose = (): void => {
    cancelled = true
    sseClients.delete(res)
    try {
      up.destroy()
    } catch {
      /* ignore */
    }
  } // don't end res here; let worker stream close it
  res.on('close', onClose)
  return () => {
    cancelled = true
    sseClients.delete(res)
    try {
      up.destroy()
    } catch {
      /* ignore */
    }
  }
}

function proxyWorkerVideo(port: number, req: IncomingMessage, res: ServerResponse): void {
  const sourceUrl = new URL(req.url || EGO_VIDEO_ROUTE, 'http://dsh.internal')
  const generation = sourceUrl.searchParams.get('generation')
  const path = `/api/video/stream${generation ? `?generation=${encodeURIComponent(generation)}` : ''}`
  let upstream: ClientRequest
  let ended = false
  const end = (): void => {
    if (ended) return
    ended = true
    try {
      res.end()
    } catch {
      /* ignore */
    }
  }
  upstream = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { accept: 'video/mp4' } }, (upRes: IncomingMessage) => {
    res.writeHead(upRes.statusCode || 502, {
      'content-type': upRes.headers['content-type'] || 'application/octet-stream',
      'cache-control': 'no-store',
      ...(upRes.headers['x-ego-generation'] ? { 'x-ego-generation': upRes.headers['x-ego-generation'] } : {}),
      ...(upRes.headers['x-ego-backend'] ? { 'x-ego-backend': upRes.headers['x-ego-backend'] } : {}),
    })
    upRes.on('data', (chunk: Buffer) => {
      if (ended) return
      try {
        if (!res.write(chunk)) {
          upRes.pause()
          res.once('drain', () => {
            if (!ended) upRes.resume()
          })
        }
      } catch {
        upstream.destroy()
        end()
      }
    })
    upRes.on('end', end)
    upRes.on('error', end)
  })
  upstream.on('error', () => {
    if (!res.headersSent) sendJson(res, 502, { ok: false, error: 'video worker unavailable' })
    else end()
  })
  upstream.setTimeout(5000, () => {
    try {
      upstream.destroy()
    } catch {
      /* ignore */
    }
    if (!res.headersSent) sendJson(res, 504, { ok: false, error: 'video worker timeout' })
    else end()
  })
  upstream.end()
  res.on('close', () => {
    ended = true
    try {
      upstream.destroy()
    } catch {
      /* ignore */
    }
  })
}

async function readJsonBody(req: IncomingMessage, maxBytes = 8192): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > maxBytes) throw new Error('body too large')
    chunks.push(Buffer.from(chunk as Uint8Array))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
}

interface WorkerState {
  port: number | null
  pid: number | null
}

/** Read the worker's { port, pid } from ego-cast.json, if any. */
async function knownWorkerState(): Promise<WorkerState> {
  try {
    const { readFile } = await import('node:fs/promises')
    const state = JSON.parse(await readFile(castStatePath(), 'utf8')) as { port?: unknown; pid?: unknown }
    return {
      port: typeof state.port === 'number' ? state.port : null,
      pid: typeof state.pid === 'number' ? state.pid : null,
    }
  } catch {
    return { port: null, pid: null }
  }
}

/** Is a process with this pid alive? (false for our own / empty / signals fail) */
function isProcessAlive(pid: number | null): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0) // signal 0 = existence probe, no side effect
    return true
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    return e && e.code === 'EPERM' // exists but not ours to signal
  }
}

interface CaptureConfigPayload {
  captureBackend: ResolvedConfig['captureBackend']
  ffmpegFallbackReason: string
  streamProfile: ResolvedConfig['streamProfile']
  cdpFps: number
  cdpQuality: number
  cdpMaxWidth: number
  cdpBackstopIntervalMs: number
  ffmpegFps: number
  ffmpegMaxWidth: number
  ffmpegBitrateKbps: number
  ffmpegEncoder: ResolvedConfig['ffmpegEncoder']
  ffmpegPath: string
  ffmpegResolvedPath: string
}

function captureConfig(cfg: ResolvedConfig, ffmpegManager: FfmpegInstallationManager | null): CaptureConfigPayload {
  const ffmpegStatus: FfmpegStatus | undefined = ffmpegManager?.status()
  const unavailable = cfg.captureBackend === 'ffmpeg' && !ffmpegStatus?.canSelectFfmpeg
  return {
    captureBackend: unavailable ? 'cdp' : cfg.captureBackend,
    ffmpegFallbackReason: unavailable ? (ffmpegStatus?.reason || 'FFmpeg is unavailable') : '',
    streamProfile: cfg.streamProfile,
    cdpFps: cfg.cdpFps,
    cdpQuality: cfg.cdpQuality,
    cdpMaxWidth: cfg.cdpMaxWidth,
    cdpBackstopIntervalMs: cfg.cdpBackstopIntervalMs,
    ffmpegFps: cfg.ffmpegFps,
    ffmpegMaxWidth: cfg.ffmpegMaxWidth,
    ffmpegBitrateKbps: cfg.ffmpegBitrateKbps,
    ffmpegEncoder: cfg.ffmpegEncoder,
    ffmpegPath: cfg.ffmpegPath,
    ffmpegResolvedPath: ffmpegStatus?.canSelectFfmpeg ? (ffmpegStatus.path || '') : '',
  }
}

type EnsureWorker = () => Promise<number | null>
type PushConfig = (cfg: ResolvedConfig) => Promise<void>

/**
 * Env handed to a spawned cast worker.
 *
 * Electron hosts (DSH Desktop): process.execPath is the Electron binary, so
 * children need ELECTRON_RUN_AS_NODE=1 or they boot as a second Electron app
 * (issue #42). Mirror of resolveEgoEnv's guard — inlined here because
 * cast-server cannot import from index.ts (circular import).
 *
 * R1 adds the resolved remote endpoint so the worker attaches to the SAME
 * browser the tools drive; without it, `resolveBrowser()` inside the worker
 * would fall back to reading a local browser.json that does not exist.
 */
function workerEnv(): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env }
  if ((process.versions as { electron?: string }).electron && base.ELECTRON_RUN_AS_NODE === undefined) {
    base.ELECTRON_RUN_AS_NODE = '1'
  }
  const ws = getAttachEndpoint()
  if (ws) base[EGO_LINUX_CDP_URL] = ws
  else delete base[EGO_LINUX_CDP_URL]
  // Lightpanda backend — the worker cannot read the host's attach cache, so
  // the projected engine travels as data; an absent value means "full
  // capabilities" (the pre-Lightpanda behavior).
  const engine = getAttachEngine()
  if (engine) base[BCDP_CDP_ENGINE] = engine
  else delete base[BCDP_CDP_ENGINE]
  return base
}

/**
 * 该激活通道是否由 CLI 轮询供帧（而不是 CDP screencast）。
 *
 * 这是 CDP worker 的门禁依据。不能用 `getAttachEndpoint() === null` 当判据：
 * `cdpMode=local`（受管本地启动）也没有远端 endpoint，但那里 worker 才是正确数据源。
 */
export function isCliCaptureChannel(cfg: Pick<ResolvedConfig, 'links' | 'activeTargetId'>): boolean {
  const link = resolveEffectiveLink(cfg.links, cfg.activeTargetId)?.link
  // Capability, not kind: "does this channel's frames come from a host poller"
  // is the actual question, and a new CLI channel answers it once here instead
  // of being added to this function.
  return runtimeOfLink(link)?.usesCdpWorker === false
}

/** Ensure a single ego-cast worker is running (idempotent). Launches it via
 * ctx.subprocess. Re-spawns whenever the previous worker is found dead (its
 * pid no longer alive or its /api/health does not answer), so a crashed
 * worker is brought back without a host restart. Spawn is rate-limited to
 * avoid hot-looping while a headless container has no browser yet.
 */
function makeEnsureWorker(ctx: EgoContext, cfg: ResolvedConfig, ffmpegManager: FfmpegInstallationManager | null): EnsureWorker {
  let lastAttempt = 0
  async function launchedWorkerPort(): Promise<number | null> {
    const state = await knownWorkerState()
    if (state.pid === null || !isProcessAlive(state.pid)) return null
    const alive = await proxyFrom(state.port!, '/api/health')
    return alive ? state.port : null
  }
  return async function ensureWorker(): Promise<number | null> {
    // 通道门禁：在 ego-cli / tabbit-cli 上 worker 永远 attach 不上，却会抱着一个
    // 重启后已失效的 targetId 反复失败（`No target with given id found`），并把
    // `spaces: []` 每 ~1s 推入同一条 SSE——把 CLI 轮询刚送到的真帧抹掉。
    // 面板表现为「显示一秒后恢复空」。这些通道上帧的唯一数据源是 CliFramePoller。
    if (isCliCaptureChannel(cfg)) return null
    const running = await launchedWorkerPort()
    if (running !== null) return running
    // Worker is dead or not yet up; spawn one, rate-limited.
    const now = Date.now()
    if (now - lastAttempt > 8000) {
      lastAttempt = now
      try {
        // Pass the current cast config to the worker as a JSON argv arg so it
        // starts with the right screencast parameters without needing an
        // extra round-trip POST. The worker reads process.argv[2].
        await ffmpegManager?.check({ configuredPath: cfg.ffmpegPath, requestedEncoder: cfg.ffmpegEncoder }).catch(() => null)
        const initCfg = JSON.stringify(captureConfig(cfg, ffmpegManager))
        const handle = ctx.subprocess.spawn({
          argv: [process.execPath, WORKER_BIN, initCfg],
          // cwd is required by the dsh-subprocess provider on DSH >= 0.1.5 —
          // omitting it throws inside spawn() and the catch below swallowed it
          // silently, making the watch panel never start (issue #34 defect 1).
          cwd: process.cwd(),
          env: workerEnv(),
          stdio: {
            stdin: { data: '' },
            stdout: { maxBytes: 8192 },
            stderr: { maxBytes: 4096 },
          },
          graceMs: 12_000,
        })
        handle.done.catch(() => null)
        const deadline = Date.now() + 8000
        while (Date.now() < deadline) {
          const ready = await launchedWorkerPort()
          if (ready !== null) return ready
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        return null
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * Push the current cast config to a running worker via POST /api/config.
 * Best-effort: if the worker is unreachable or the POST fails, the config
 * will take effect on the next worker spawn (argv seed). Called whenever the
 * settings layer reports a change.
 */
function makePushConfig(ensureWorker: EnsureWorker, ffmpegManager: FfmpegInstallationManager | null): PushConfig {
  let lastPush = ''
  return async function pushConfig(cfg: ResolvedConfig): Promise<void> {
    await ffmpegManager?.check({ configuredPath: cfg.ffmpegPath, requestedEncoder: cfg.ffmpegEncoder }).catch(() => null)
    const port = await ensureWorker()
    if (port === null) return
    const payload = JSON.stringify(captureConfig(cfg, ffmpegManager))
    // Dedupe: don't re-push identical config (settings onChange can fire
    // multiple times for a single logical edit).
    if (payload === lastPush) return
    lastPush = payload
    try {
      const result = await proxyPost(port, '/api/config', JSON.parse(payload))
      if (!result || result.status >= 400) throw new Error('worker config update failed')
    } catch {
      // worker may be mid-restart; the next ensureWorker will re-seed via argv
    }
  }
}

/**
 * Register the watch-panel routes. Call inside plugin apply() with the real
 * ctx; dispose is returned for ctx.effect cleanup.
 *
 * `bridge` is the settings bridge — its `onChange` is used to react to
 * live settings saves and push the new config to a running worker.
 */
export function initCastServer(
  ctx: EgoContext,
  cfg: ResolvedConfig,
  bridge: SettingsBridge,
  ffmpegManager: FfmpegInstallationManager | null,
  openAgentWindow: () => Promise<{ ok: boolean; error?: string }> = async () => ({ ok: false, error: 'raise not supported by this host build' }),
  loginImport: (opts: LoginImportOptions) => Promise<LoginImportReport> = async () => ({ ok: false, error: 'login import not supported by this host build' }),
  cliPoller: CliFramePoller | null = null,
  panelActions: PanelActionRunner | null = null,
  tabbitSpaces: (() => { tabs: Array<{ targetId: string; url: string; title: string; active: boolean; lastActive: number }>; updatedAt: number; complete: boolean }) | null = null,
  /**
   * CLI channels have no worker, so `/api/bcdp/close` cannot proxy. The host
   * injects how to close a tab there (tabbit: `page.close()` under the task that
   * OWNS the tab). `reason` is surfaced to the panel: a silent 501 is exactly why
   * the × looked dead.
   */
  closeCliTab: (targetId: string) => Promise<{ ok: boolean; reason: string }> = async () => ({ ok: false, reason: 'not-supported' }),
  /**
   * Channel-native page actions (tab-click activation, reload, goto).
   *
   * The `panelActions` runner is ego-cli heredoc code and answers 502 on tabbit,
   * which is what made the panel's 刷新页面 / tab click look dead there. The host
   * injects this one instead; returning `null` means "this channel cannot".
   */
  pageAction: ((action: Record<string, unknown>) => Promise<{ ok: boolean; reason?: string }>) | null = null,
  /**
   * Backs `POST /api/bcdp/sync`. The host owns both channel branches (attach pass
   * for cdp, read-only inventory for tabbit), so the route is a thin forwarder.
   */
  syncOnRefresh: () => Promise<Record<string, unknown>> = async () => ({
    ok: false,
    error: 'refresh sync not supported by this host build',
  }),
  /** Backs `POST /api/bcdp/capture` for channels without a worker. */
  captureOnDemand: (targetId: string) => Promise<Record<string, unknown>> = async () => ({
    ok: false,
    error: 'on-demand capture not supported by this host build',
  }),
): void {
  const ensureWorker = makeEnsureWorker(ctx, cfg, ffmpegManager)
  // Point the shared focus writer at this server's worker. A CLI channel has no
  // worker (ensureWorker returns null for it), which is exactly right: those
  // channels sync the focus over SSE only.
  setFocusPusher(async (targetId) => {
    const port = await ensureWorker()
    if (port === null) return null
    return proxyPost(port, '/api/focus', { targetId })
  })
  const pushConfig = makePushConfig(ensureWorker, ffmpegManager)
  activeCliPoller = cliPoller
  // Identity of the connection target the panel is currently viewing. The
  // panel's login / captcha strips use it to name the window the user must act
  // in (a CDP endpoint label, "ego browser", "Tabbit browser", …) instead of
  // hard-coding one backend's window title.
  const activeLinkInfo = (): { kind: string; label: string; engine: string | null } => {
    const eff = resolveEffectiveLink(cfg.links, cfg.activeTargetId)
    return {
      kind: eff?.link.kind ?? '',
      label: (eff?.link as { label?: string } | undefined)?.label ?? '',
      engine: getAttachEngine(),
    }
  }
  // The web shell exposes `webServer` — the only HTTP host surface the plugin
  // uses. It is NOT a required inject (TUI / headless hosts have none), so we
  // resolve it opportunistically via ctx.get('webServer'); if absent here there
  // is nothing to register, so exit cleanly.
  const rawServer = (ctx as EgoContext).get?.('webServer') as WebServerLike | undefined
  if (!rawServer || typeof rawServer.register !== 'function') {
    return
  }

  // ── trust fence for /api/bcdp/* ────────────────────────────────────────────
  // Exact-path routes match BEFORE the host's `/api` prefix trust-fence route,
  // so every handler below would otherwise answer unauthenticated requests.
  // The host issues a `dsh-auth-<processKey>` cookie that is HttpOnly AND
  // SameSite=Strict: a cross-site page (CSRF driver-by) never carries it, so
  // requiring its mere presence closes the remote surface. A local process can
  // still forge the header, but that is the same threat tier as the host's own
  // token fence (a local process can read the process token too).
  const isTrustedRequest = (req: IncomingMessage): boolean =>
    /(?:^|;\s*)dsh-auth-[^=]+=/.test(String(req.headers.cookie ?? ''))
  const guardHandler = (handler: NonNullable<RegisterRouteOptions['handler']>) =>
    async (req: unknown, resRaw: unknown) => {
      const res = resRaw as ServerResponse
      if (!isTrustedRequest(req as IncomingMessage)) {
        res.statusCode = 401
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end('{"ok":false,"error":"unauthorized"}')
        return
      }
      return handler(req, res)
    }
  // Scope the guard to THIS plugin's registrations only: never patch the host
  // webServer singleton in place — other plugins' routes registered through the
  // same service instance must keep their own (unguarded) semantics.
  const rawRegister = rawServer.register.bind(rawServer) as (opts: RegisterRouteOptions) => () => void
  const server = Object.assign(Object.create(Object.getPrototypeOf(rawServer)), rawServer, {
    register: (opts: RegisterRouteOptions) => rawRegister({
      ...opts,
      handler: opts.handler ? guardHandler(opts.handler) : opts.handler,
    }),
  })

  // Hot-push config changes to a running worker. The settings bridge fires
  // onChange whenever the user saves a new castFpsCap / screencastQuality /
  // screencastMaxWidth in the settings card.
  if (typeof bridge?.onChange === 'function') {
    const off = bridge.onChange(() => {
      // A saved setting wins over the panel's session override, so the card and
      // the panel can never disagree after a save.
      clearCliTrackOverride()
      pushConfig(cfg)
    })
    if (typeof off === 'function') {
      ctx.effect?.(() => () => {
        try {
          off()
        } catch {
          /* ignore */
        }
      })
    }
  }

  const disposeSpaces = server.register({
    kind: 'exact',
    path: EGO_SPACES_ROUTE,
    handler: async (_req: unknown, resRaw: unknown) => {
      const res = resRaw as ServerResponse
      const port = await ensureWorker()
      if (port === null) {
        // Degraded ego-cli path: no screencast worker, but the CLI frame poller
        // may be serving one synthetic space so the panel fills with the 5s
        // fallback frame instead of the "no live browser" empty state.
        const cliFrame = cliPoller && cliPoller.isRunning() ? cliPoller.getFrame() : null
        if (cliFrame) {
          // Serve the REAL tab inventory when the capture reported one (the
          // panel then renders a multi-tab strip); the synthetic single row is
          // only for an older capture path that had no inventory.
          const frameTabs = Array.isArray(cliFrame.tabs) ? cliFrame.tabs : []
          const rows = frameTabs.length > 0
            ? frameTabs.map((t) => ({
                targetId: t.targetId,
                url: t.url,
                title: t.title,
                active: t.active,
                lastActive: cliFrame.updatedAt,
              }))
            : [{
                targetId: CLI_FRAME_TARGET_ID,
                url: cliFrame.url,
                title: cliFrame.title,
                active: true,
                lastActive: cliFrame.updatedAt,
              }]
          return sendJson(res, 200, {
            ok: true,
            toolCallCount,
            cliFrameMode: true,
            cliFrameIntervalMs: 3000,
            cliFrameTargetId: cliFrame.targetId || CLI_FRAME_TARGET_ID,
            link: activeLinkInfo(),
            spaces: rows,
          })
        }
        // Tabbit's available tabs live in the host's inventory cache (3s poller).
        // Serving them here puts them in the SAME tab bucket the CDP/ego routes
        // feed, so the strip, history drawer and @-quotable tabs all work on a
        // Tabbit session too. Stale beyond 20s = not served (the cache is empty
        // until the first poll lands, and a dead CLI must not look alive).
        const tb = tabbitSpaces?.()
        if (tb && tb.tabs.length > 0 && Date.now() - tb.updatedAt < 20_000) {
          return sendJson(res, 200, {
            ok: true,
            backend: 'tabbit-cli',
            toolCallCount,
            link: activeLinkInfo(),
            spaces: tb.tabs,
          })
        }
        return sendJson(res, 200, { ok: false, spaces: [], toolCallCount, link: activeLinkInfo(), reason: 'no live agent browser' })
      }
      const data = await proxyFrom(port, '/api/spaces')
      if (!data) return sendJson(res, 200, { ok: false, spaces: [], toolCallCount, link: activeLinkInfo(), reason: 'worker not ready' })
      // Attach the host-side tool-call counter (the worker doesn't know about
      // tool invocations; only the host's defineEgoTool path does) and the
      // active link identity — the panel's login / captcha copy must name the
      // backend the user is actually looking at (CDP endpoint, ego CLI, Tabbit,
      // Lightpanda), not a hard-coded "CDP bridge" window.
      return sendJson(res, 200, { ...(data as Record<string, unknown>), link: activeLinkInfo(), toolCallCount })
    },
  })

  // GET /api/bcdp/stream — Server-Sent Events: real-time screencast frames and
  // the live tab/spaces list. The web shell supports exact HTTP routes and this
  // handler keeps the connection open for the worker->panel fan-out.
  const disposeStream = server.register({
    kind: 'exact',
    path: EGO_STREAM_ROUTE,
    handler: async (_req: unknown, resRaw: unknown) => {
      const res = resRaw as ServerResponse
      const port = await ensureWorker()
      if (port === null) {
        proxyWorkerStream(-1, res, '/api/stream')
        return
      }
      proxyWorkerStream(port, res, '/api/stream')
    },
  })

  // GET /api/bcdp/cli-frame — the ego-cli degraded frame source. Serves the
  // newest CLI-captured viewport PNG (image/png) so the watch panel's <img> can
  // load it directly; 204 when the poller has no frame yet (cold start, switch
  // off, or a space with no active page). Local read-only, no SSE image mirror.
  const disposeCliFrame = server.register({
    kind: 'exact',
    path: EGO_CLI_FRAME_ROUTE,
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const want = url.searchParams.get('targetId') ?? ''
      const pollerFrame = cliPoller && cliPoller.isRunning() ? cliPoller.getFrame() : null
      let body: Buffer | null = pollerFrame?.png ?? null
      let contentType = 'image/png'
      let seq = String(pollerFrame?.seq ?? 0)
      let servedTarget = ''
      // tabbit frames never reach `cliPoller` — they are broadcast per tab and land
      // in `lastCliFrames`. Serving only the poller left every tabbit panel on 204
      // ("有图也不显示"), so fall back to the broadcast ring: exact target when
      // asked, otherwise the newest frame of the last cycle.
      if (body === null && lastCliFrames !== null && lastCliFrames.length > 0) {
        const exact = want === '' ? undefined : lastCliFrames.find((img) => img.targetId === want)
        const pick = exact ?? lastCliFrames[0]
        if (pick !== undefined) {
          body = pick.png
          contentType = pick.fmt === 'jpeg' ? 'image/jpeg' : 'image/png'
          seq = String(lastCliFrameAt)
          servedTarget = pick.targetId
        }
      }
      if (body === null) {
        res.statusCode = 204
        res.end()
        return
      }
      res.writeHead(200, {
        'content-type': contentType,
        'content-length': body.length,
        'cache-control': 'no-store',
        'x-cli-frame-seq': seq,
        'x-cli-frame-target': servedTarget,
      })
      res.end(body)
    },
  })

  // POST /api/bcdp/input — forward a watch-panel pointer/wheel intention to the
  // real agent page. Coordinates are already in browser CSS pixels (the panel
  // maps them). The web shell passes the raw body through to the worker.
  const disposeInput = server.register({
    kind: 'exact',
    path: EGO_INPUT_ROUTE,
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      const port = await ensureWorker()
      if (port === null) return sendJson(res, 400, { ok: false, error: 'no live agent browser' })
      const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
      const result = await proxyPost(port, '/api/input', body)
      if (!result) return sendJson(res, 502, { ok: false, error: 'input worker unavailable' })
      return sendJson(res, result.status, result.body)
    },
  })

  // POST /api/bcdp/capture — one frame of ONE tab (panel: 刷新页面 / tab click).
  // Worker channels: activating the tab is what makes the screencast produce a
  // frame for it, so switch there and report `deferred`. CLI channels: the host
  // runs a single capture for that tab id.
  const disposeCapture = server.register({
    kind: 'exact',
    path: EGO_CAPTURE_ROUTE,
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
      const targetId = typeof body.targetId === 'string' ? body.targetId : ''
      if (!targetId) return sendJson(res, 400, { ok: false, error: 'targetId required' })
      const port = await ensureWorker()
      if (port === null) {
        try {
          const out = await captureOnDemand(targetId)
          return sendJson(res, out.ok === true ? 200 : 502, out)
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: `${(err as Error)?.message ?? err}`.slice(0, 200) })
        }
      }
      const sw = await proxyPost(port, '/api/switch-tab', { targetId })
      return sendJson(res, 200, { ok: true, action: 'activate', deferred: true, switch: sw?.status ?? null })
    },
  })

  // POST /api/bcdp/sync — panel ⟳: pull the active object in without a tool call.
  const disposeSync = server.register({
    kind: 'exact',
    path: EGO_SYNC_ROUTE,
    handler: async (_req: unknown, resRaw: unknown) => {
      const res = resRaw as ServerResponse
      try {
        const out = await syncOnRefresh()
        return sendJson(res, out.ok === true ? 200 : 409, out)
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: `${(err as Error)?.message ?? err}`.slice(0, 200) })
      }
    },
  })

  // POST /api/bcdp/hello — the panel reports which client build it is running.
  const disposeHello = server.register({
    kind: 'exact',
    path: EGO_HELLO_ROUTE,
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
      const build = typeof body.build === 'string' ? body.build : ''
      lastClientBuild = build
      lastClientAt = Date.now()
      // Log once per build: this line is the out-of-band proof of which bundle the
      // renderer actually runs (readable from the app log, no auth needed).
      if (build !== '' && build !== reportedClientBuild) {
        reportedClientBuild = build
        ctx.logger?.info?.(`dsh-browser-cdp: panel client build ${build} (host ${CLIENT_BUILD})`)
        // Also on raw stdout: the host logger can be buffered/dropped, and this
        // single line is what tells support which bundle the renderer really runs.
        try {
          process.stdout.write(`[bcdp] panel client build ${build} (host ${CLIENT_BUILD})\n`)
        } catch { /* stdout may be closed in some hosts */ }
        // …and in a small file: the only channel that survives a detached stdout,
        // an expired web token and a renderer we cannot inspect. One line per
        // build, appended, so it is also a history of what loaded when.
        try {
          const dir = join(homedir(), '.dsh')
          appendFileSync(join(dir, 'bcdp-panel-build.log'), `${new Date().toISOString()} panel=${build} host=${CLIENT_BUILD}\n`)
        } catch { /* read-only home: the two channels above still apply */ }
      }
      return sendJson(res, 200, { ok: true, hostBuild: CLIENT_BUILD, matches: build === CLIENT_BUILD })
    },
  })

  // POST /api/bcdp/close — close a browser tab by targetId.
  const disposeClose = server.register({
    kind: 'exact',
    path: EGO_CLOSE_ROUTE,
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
      const targetId = typeof body.targetId === 'string' ? body.targetId : ''
      if (!targetId) return sendJson(res, 400, { ok: false, error: 'targetId required' })
      const port = await ensureWorker()
      if (port === null) {
        // CLI channel: the tab is closed through its own runtime, not the worker.
        //
        // Bounded on purpose. The panel fires this from a click handler, and an
        // unbounded await left the request `pending` forever (measured: two rows
        // stuck in the network tab, no response ever). A close that cannot answer
        // in 8 s is reported as a timeout instead of hanging the UI.
        const out = await Promise.race([
          closeCliTab(targetId),
          new Promise<{ ok: boolean; reason: string }>((resolve) => {
            setTimeout(() => resolve({ ok: false, reason: 'close-timeout' }), 8000)
          }),
        ])
        // 202 = dispatched. The panel must not wait on the browser: the row is
        // removed by the next inventory broadcast if the tab is really gone, and
        // stays put otherwise. 200 is reserved for a verified close.
        if (out.ok && out.reason === 'dispatched') {
          return sendJson(res, 202, { ok: true, pending: true, targetId })
        }
        return sendJson(res, out.ok ? 200 : (out.reason === 'close-timeout' ? 504 : 409), out.ok
          ? { ok: true, closed: true, targetId }
          : { ok: false, error: 'close failed', reason: out.reason })
      }
      const result = await proxyPost(port, '/api/close', { targetId })
      if (!result) return sendJson(res, 502, { ok: false, error: 'close worker unavailable' })
      return sendJson(res, result.status, result.body)
    },
  })

  // POST /api/bcdp/marks — 阶段 3 / R4: set-of-marks capture (image + numbered
  // element map) through the worker's resident connection. Same trust fence and
  // forwarding shape as /api/bcdp/close.
  const disposeMarks = server.register({
    kind: 'exact',
    path: EGO_MARKS_ROUTE,
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      const port = await ensureWorker()
      if (port === null) return sendJson(res, 400, { ok: false, error: 'no live agent browser' })
      const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
      const result = await proxyPost(port, '/api/marks', body, 20000)
      if (!result) return sendJson(res, 502, { ok: false, error: 'marks worker unavailable' })
      return sendJson(res, result.status, result.body)
    },
  })

  // 阶段 5 / R6 (T5.19): pick-mode control. POST forwards {enabled, targetId}
  // to the worker's resident-connection picker; GET polls the pick state the
  // panel observes (lastPick included); POST /click forwards the T5.1b
  // coordinate fallback. One registration, branched on method+path — the
  // worker exposes both on sibling paths.
  const disposePick = server.register({
    kind: 'exact',
    path: EGO_PICK_ROUTE,
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      const port = await ensureWorker()
      if (port === null) return sendJson(res, 400, { ok: false, error: 'no live agent browser' })
      if (req.method === 'POST') {
        const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
        const result = await proxyPost(port, '/api/pick', body)
        if (!result) return sendJson(res, 502, { ok: false, error: 'pick worker unavailable' })
        return sendJson(res, result.status, result.body)
      }
      const result = await proxyFrom(port, '/api/pick')
      return sendJson(res, 200, result || { ok: false, state: 'idle', reason: 'worker not ready' })
    },
  })

  // T5.1b fallback — panel-sent viewport coordinates. Separate exact route so
  // matching never depends on the host's exact-path semantics.
  const disposePickClick = server.register({
    kind: 'exact',
    path: `${EGO_PICK_ROUTE}/click`,
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      const port = await ensureWorker()
      if (port === null) return sendJson(res, 400, { ok: false, error: 'no live agent browser' })
      const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
      const result = await proxyPost(port, '/api/pick/click', body)
      if (!result) return sendJson(res, 502, { ok: false, error: 'pick worker unavailable' })
      return sendJson(res, result.status, result.body)
    },
  })

  // POST /api/bcdp/flush — force login cookies down to the disk profile.
  const disposeFlush = server.register({
    kind: 'exact',
    path: EGO_FLUSH_ROUTE,
    handler: async (_req: unknown, resRaw: unknown) => {
      const res = resRaw as ServerResponse
      const port = await ensureWorker()
      if (port === null) return sendJson(res, 400, { ok: false, error: 'no live agent browser' })
      const result = await proxyPost(port, '/api/flush', {})
      if (!result) return sendJson(res, 502, { ok: false, error: 'flush worker unavailable' })
      return sendJson(res, result.status, result.body)
    },
  })

  // POST /api/bcdp/window-size — panel size-sync / presets / maximize.
  // CDP-worker route: proxy to the worker (Browser.setWindowBounds on the real
  // Chrome window). ego-cli route: no CDP ws reaches the host, so the injected
  // panelActions runner performs the same operation as a short heredoc through
  // the CLI channel (identical request/response shape).
  const disposeWindowSize = server.register({
    kind: 'exact',
    path: '/api/bcdp/window-size',
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
      const port = await ensureWorker()
      if (port === null) {
        if (panelActions === null) return sendJson(res, 409, { ok: false, error: 'no live agent browser (size-sync needs the CDP worker or the ego-cli route)' })
        const out = await panelActions.windowSize(body)
        return sendJson(res, out.ok === true ? 200 : 502, out)
      }
      const result = await proxyPost(port, '/api/window-size', body)
      if (!result) return sendJson(res, 502, { ok: false, error: 'window-size worker unavailable' })
      return sendJson(res, result.status, result.body)
    },
  })

  // GET/POST /api/bcdp/tracking — 全模式 (capture every tab) vs 仅激活 (one).
  // Host-side switch: the CLI poller reads it each tick, so the panel can flip
  // modes without a restart. GET reports the current value for first paint.
  const disposeTracking = server.register({
    kind: 'exact',
    path: '/api/bcdp/tracking',
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      if (req.method === 'POST') {
        const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
        if (typeof body.all === 'boolean') setCliTrackAll(body.all)
      }
      // The persisted setting is the source of truth; the panel toggle is a
      // session override on top of it (a settings save clears it).
      return sendJson(res, 200, { ok: true, all: getCliTrackAll(cfg.tabTracking === 'all'), setting: cfg.tabTracking })
    },
  })

  // POST /api/bcdp/switch-tab — the user clicked a tab in the panel. Worker
  // route: activate the target (the screencast follows it). ego-cli route: the
  // injected panelActions runner switches through `browser.switchTab`.
  const disposeSwitchTab = server.register({
    kind: 'exact',
    path: '/api/bcdp/switch-tab',
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
      if (typeof body.targetId !== 'string' || body.targetId === '') {
        return sendJson(res, 400, { ok: false, error: 'targetId required' })
      }
      const port = await ensureWorker()
      if (port === null) {
        if (pageAction !== null) {
          const out = await pageAction({ type: 'switch', ...body })
          if (out.ok === true) {
            broadcastFocus(defaultFocusStore.set(String(body.targetId), 'operator'))
            return sendJson(res, 200, { ...out, ok: true, action: 'switch' })
          }
          if (out.reason !== 'unsupported-channel') {
            return sendJson(res, 502, { ok: false, error: 'switch failed', reason: out.reason })
          }
        }
        if (panelActions === null) return sendJson(res, 409, { ok: false, error: 'no live agent browser' })
        const out = await panelActions.switchTab(body)
        if (out.ok === true) broadcastFocus(defaultFocusStore.set(String(body.targetId), 'operator'))
        return sendJson(res, out.ok === true ? 200 : 502, out)
      }
      const result = await proxyPost(port, '/api/switch-tab', body)
      if (!result) return sendJson(res, 502, { ok: false, error: 'switch-tab worker unavailable' })
      // The operator picked this tab: record it once, so the next spaces snapshot
      // highlights it without having to infer anything from ordering.
      if (result.status < 400) broadcastFocus(defaultFocusStore.set(String(body.targetId), 'operator'))
      return sendJson(res, result.status, result.body)
    },
  })

  // POST /api/bcdp/focus { targetId, source? } — set or clear the OPERATION
  // focus. Two things this deliberately does NOT do: activate the target (a
  // sync path must never raise a window) and outlive the process (a target id
  // is a runtime handle). An id the worker calls stale is dropped here too, so
  // the panel stops highlighting a row that is gone.
  const disposeFocus = server.register({
    kind: 'exact',
    path: EGO_FOCUS_ROUTE,
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
      const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : ''
      const source = body.source === 'operator' ? 'operator' : 'agent'
      // Same single path the tool side uses, so "operator clicked" and "agent
      // drove a tab" cannot diverge in what they store or broadcast.
      const focus = await pushFocus(targetId, source)
      return sendJson(res, 200, { ok: true, focus })
    },
  })

  // POST /api/bcdp/navigate — panel refresh / manual URL. Worker route proxies
  // (Page.reload / Page.navigate); ego-cli route runs page.reload / page.goto in
  // a heredoc via the injected panelActions runner.
  const disposePanelNavigate = server.register({
    kind: 'exact',
    path: '/api/bcdp/navigate',
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
      const port = await ensureWorker()
      if (port === null) {
        if (pageAction !== null) {
          const out = await pageAction({ type: 'navigate', ...body })
          if (out.ok === true) return sendJson(res, 200, { ...out, ok: true, action: 'navigate' })
          if (out.reason !== 'unsupported-channel') {
            return sendJson(res, 502, { ok: false, error: 'navigate failed', reason: out.reason })
          }
        }
        if (panelActions === null) return sendJson(res, 409, { ok: false, error: 'no live agent browser' })
        const out = await panelActions.navigate(body)
        return sendJson(res, out.ok === true ? 200 : 502, out)
      }
      const result = await proxyPost(port, '/api/navigate', body)
      if (!result) return sendJson(res, 502, { ok: false, error: 'navigate worker unavailable' })
      return sendJson(res, result.status, result.body)
    },
  })

  // POST /api/bcdp/raise — pop the agent browser out as a REAL visible window
  // (issue #51): when the backing browser runs headless, the runtime's
  // `ego-browser --open` replaces it with a headed instance on the SAME
  // profile (tabs restore); when it is already visible, --open just raises
  // the window. The actual spawn is injected by the host plugin (it owns
  // egoBin + the env resolution).
  const disposeRaise = server.register({
    kind: 'exact',
    path: EGO_RAISE_ROUTE,
    handler: async (_req: unknown, resRaw: unknown) => {
      const res = resRaw as ServerResponse
      try {
        const result = await openAgentWindow()
        return sendJson(res, result.ok ? 200 : 500, result)
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: String((err as Error)?.message || err) })
      }
    },
  })

  // POST /api/bcdp/login-import — the settings card's entry point for the
  // login-cookie importer (issue #46). The heavy lifting (system browser
  // probe, ABE-safe CDP read, write into the agent browser) is injected by
  // the host plugin; the body mirrors bcdp_login_import's arguments.
  const disposeLoginImport = server.register({
    kind: 'exact',
    path: EGO_LOGIN_IMPORT_ROUTE,
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
      try {
        const result = await loginImport({
          source: (['chrome', 'edge', 'brave', 'auto'].includes(String(body.source)) ? String(body.source) : 'auto') as LoginImportOptions['source'],
          domains: Array.isArray(body.domains) ? (body.domains as unknown[]).map(String) : undefined,
          profile: typeof body.profile === 'string' && body.profile !== '' ? body.profile : undefined,
          closeSource: body.closeSource === true,
          dryRun: body.dryRun === true,
        })
        return sendJson(res, result.ok ? 200 : 400, result)
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: String((err as Error)?.message || err) })
      }
    },
  })

  const disposeHealth = server.register({
    kind: 'exact',
    path: EGO_HEALTH_ROUTE,
    handler: async (_req: unknown, resRaw: unknown) => {
      const res = resRaw as ServerResponse
      const port = await ensureWorker()
      if (port === null) return sendJson(res, 200, { ok: false })
      const h = await proxyFrom(port, '/api/health')
      return sendJson(res, 200, h || { ok: false })
    },
  })

  // Automatic-source counters (probe passes, tab-inventory ticks, frames).
  // Host-local: it answers "is the machinery still working", which the worker
  // cannot know (the CLI pollers and the attach probe both live here).
  const disposeStats = server.register({
    kind: 'exact',
    path: EGO_STATS_ROUTE,
    handler: async (_req: unknown, resRaw: unknown) => {
      const res = resRaw as ServerResponse
      // `clientBuild` lets a running renderer compare against its own constant and
      // reload once when the host was upgraded but the cached bundle was not.
      return sendJson(res, 200, {
        ok: true,
        clientBuild: CLIENT_BUILD,
        panelBuild: lastClientBuild,
        panelBuildAt: lastClientAt,
        stats: snapshotStats(),
      })
    },
  })

  const watchRoutes: (() => void)[] = [
    [EGO_WATCH_START_ROUTE, '/api/watch/start'],
    [EGO_WATCH_SWITCH_ROUTE, '/api/watch/switch'],
    [EGO_WATCH_STOP_ROUTE, '/api/watch/stop'],
  ].map(([path, workerPath]) => server.register!({
    kind: 'exact', path,
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      const body = await readJsonBody(req).catch(() => ({})) as Record<string, unknown>
      watchCalls += 1
      const port = await ensureWorker()
      if (port === null) {
        // CLI channels have NO worker by design — frames come from the poller. This
        // used to answer 409 `worker not ready`, and the panel's retry chain turned
        // that into a storm (measured: 1728 POSTs, one every few ms). Worse, the 409
        // also reset the client's capture state, which is why the panel showed
        // "CDP · idle · 未接管 / no agent browser page" while the strip had tabs.
        //
        // Answer like a watch that is simply idle: older clients latch
        // `watchStarted = ok !== false` and stop retrying, new clients skip watch on
        // CLI channels entirely.
        watchRefused += 1
        return sendJson(res, 200, {
          ok: true,
          state: 'idle',
          backend: 'cli-poll',
          targetId: typeof body.targetId === 'string' ? body.targetId : '',
          reason: 'cli channel: frames come from the poller (no CDP screencast)',
        })
      }
      const timeoutMs = workerPath === '/api/watch/start' || workerPath === '/api/watch/switch' ? 30000 : 4000
      const result = await proxyPost(port, workerPath, body, timeoutMs)
      return result
        ? sendJson(res, result.status, result.body)
        : sendJson(res, 502, { ok: false, error: 'worker request failed' })
    },
  }))
  const disposeWatchStatus = server.register({
    kind: 'exact', path: EGO_WATCH_STATUS_ROUTE,
    handler: async (_req: unknown, resRaw: unknown) => {
      const res = resRaw as ServerResponse
      const port = await ensureWorker()
      const result = port === null ? null : await proxyFrom(port, '/api/watch/status')
      return sendJson(res, 200, result || { ok: false, state: 'idle', reason: 'worker not ready' })
    },
  })
  const disposeVideoStatus = server.register({
    kind: 'exact', path: EGO_VIDEO_STATUS_ROUTE,
    handler: async (_req: unknown, resRaw: unknown) => {
      const res = resRaw as ServerResponse
      const port = await ensureWorker()
      const result = port === null ? null : await proxyFrom(port, '/api/video/status')
      return sendJson(res, 200, result || { ok: false, state: 'idle', reason: 'worker not ready' })
    },
  })
  const disposeVideo = server.register({
    kind: 'exact', path: EGO_VIDEO_ROUTE,
    handler: async (reqRaw: unknown, resRaw: unknown) => {
      const req = reqRaw as IncomingMessage
      const res = resRaw as ServerResponse
      const port = await ensureWorker()
      if (port === null) return sendJson(res, 502, { ok: false, error: 'worker not ready' })
      proxyWorkerVideo(port, req, res)
    },
  })

  // Frame hold/buffer: replay the newest CLI frame once per second so the watch
  // panel never goes blank in the 3s capture gap (a screenshot can momentarily
  // stall the page's rendering, and there is no screencast on the ego-cli route).
  // Skipped when a CDP screencast endpoint owns the panel, and when no frame or
  // no client is present. This is the "cache ≥1s" guarantee the user asked for.
  //
  // The replay is bounded by CLI_FRAME_HOLD_MAX_AGE_MS: a real capture tick costs
  // 1–2 CLI runs (0.15–2.6 s each, and slow ticks skip a beat), so the actual
  // cadence is 3–6 s — the buffer exists to bridge exactly that. Past 4 s of
  // silence the panel keeps the last painted image but the timer stops feeding:
  // replaying a five-minute-old frame forever makes a dead capture path look
  // alive, which is the worse failure.
  const cliFrameHoldTimer = setInterval(() => {
    if (sseClients.size === 0) return
    if (getAttachEndpoint() !== null) return
    if (lastCliFrames === null) return
    if (!cliFrameHoldDue(Date.now(), lastCliFrameRealAt, lastCliFrameAt)) return
    const at = Date.now()
    lastCliFrameAt = at
    // FRAMES ONLY. Replaying `spaces` every second made the panel rebuild its view
    // once a second, and that rebuild re-applied the PREVIOUS cached image while
    // the SSE frame had already painted the new one — the visible "gap" between
    // 3s captures. The image is all this timer owes the client; the tab list is
    // already re-asserted by the next real capture.
    writeCliImages(lastCliFrames, at, false)
  }, 1000)
  try { (cliFrameHoldTimer as unknown as { unref?: () => void }).unref?.() } catch { /* ignore */ }
  ctx.effect?.(() => () => { clearInterval(cliFrameHoldTimer) })

  ctx.effect?.(() => () => {
    try { disposeSpaces() } catch { /* ignore */ }
    try { disposeStream() } catch { /* ignore */ }
    try { disposeCliFrame() } catch { /* ignore */ }
    try { disposeInput() } catch { /* ignore */ }
    try { disposeClose() } catch { /* ignore */ }
    try { disposeMarks() } catch { /* ignore */ }
    try { disposePick() } catch { /* ignore */ }
    try { disposePickClick() } catch { /* ignore */ }
    try { disposeFlush() } catch { /* ignore */ }
    try { disposeWindowSize() } catch { /* ignore */ }
    try { disposeSwitchTab() } catch { /* ignore */ }
    try { disposeFocus() } catch { /* ignore */ }
    // The pusher closes over this server's worker; leaving it registered would
    // let a later focus write target a dead port.
    setFocusPusher(null)
    try { disposeTracking() } catch { /* ignore */ }
    try { disposePanelNavigate() } catch { /* ignore */ }
    try { disposeRaise() } catch { /* ignore */ }
    try { disposeLoginImport() } catch { /* ignore */ }
    try { disposeHealth() } catch { /* ignore */ }
    try { disposeStats() } catch { /* ignore */ }
    for (const dispose of watchRoutes) try { dispose() } catch { /* ignore */ }
    try { disposeWatchStatus() } catch { /* ignore */ }
    try { disposeVideoStatus() } catch { /* ignore */ }
    try { disposeVideo() } catch { /* ignore */ }
  })
}
