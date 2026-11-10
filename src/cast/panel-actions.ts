/**
 * src/cast/panel-actions.ts — panel-driven browser actions on the ego-cli route.
 *
 * The CDP-worker route answers /api/window-size + /api/navigate natively (it
 * owns a CDP websocket). An `ego-cli` link injects NO ws into the host, so the
 * same two actions are executed here as a short heredoc through the SAME CLI
 * channel real tools use: the runtime hands the script `page` / `browser` /
 * `taskSpaces` / `cdp` as function parameters (harness `execute()` runs the
 * script as `new AsyncFunction(...names, code)`), so `cdp()` inside the heredoc
 * is a raw CDP passthrough on the browser connection.
 *
 * Request/response shapes deliberately mirror the worker route, so the client
 * speaks ONE protocol no matter which route is active:
 *   window-size: { width?, height?, delta?, dy?, aspect?, maximize? } →
 *                { ok, windowId, viewport: { width, height } }
 *   navigate:    { reload?, ignoreCache?, url? } → { ok, reloaded | url }
 *
 * Pure script/parse helpers only — the host injects the subprocess runner.
 */

import {
  ASPECT_RATIOS,
  MAX_VIEWPORT_HEIGHT,
  MAX_VIEWPORT_WIDTH,
  MIN_VIEWPORT_HEIGHT,
  MIN_VIEWPORT_WIDTH,
} from '../worker/window-size.ts'

/** Sentinel the heredoc prints; carries the JSON outcome. */
export const PANEL_SENTINEL = '@@BCDP_PANEL@@'

export interface PanelActionOutcome {
  ok: boolean
  [key: string]: unknown
}

/** Host-side runner for the two panel actions (CDP-worker route not available). */
export interface PanelActionRunner {
  windowSize: (body: Record<string, unknown>) => Promise<PanelActionOutcome>
  navigate: (body: Record<string, unknown>) => Promise<PanelActionOutcome>
  /** Make one tab the browser's active target (the user clicked it in the panel). */
  switchTab: (body: Record<string, unknown>) => Promise<PanelActionOutcome>
}

/**
 * Embed a value as a JS literal. `JSON.stringify` alone leaves U+2028/U+2029
 * raw, which is a syntax error inside the heredoc source.
 */
const js = (v: unknown): string =>
  JSON.stringify(v).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

/** Only well-typed, known fields reach the heredoc (a body is client input). */
function pickTargetId(body: Record<string, unknown>): string {
  return typeof body.targetId === 'string' ? body.targetId.trim().slice(0, 200) : ''
}

/** Field whitelist for the window-size contract. */
function pickWindowRequest(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of ['width', 'height', 'delta', 'dy'] as const) {
    const v = body[key]
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
  }
  if (typeof body.aspect === 'string' && body.aspect !== '') out.aspect = body.aspect
  if (body.maximize === true) out.maximize = true
  return out
}

/** Same discipline as pickWindowRequest, for the navigate route. */
function pickNavigateRequest(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (body.reload === true) out.reload = true
  if (body.ignoreCache === true) out.ignoreCache = true
  if (typeof body.url === 'string') {
    const url = body.url.trim()
    if (url !== '') out.url = url.slice(0, 4096)
  }
  return out
}

/**
 * Parse the newest sentinel line. Returns null when the script never reached
 * its log (a cold start, a CLI crash, a truncated frame, …) so the caller can
 * surface the runner's own error instead of a fake success.
 */
export function parsePanelResult(stdout: string): PanelActionOutcome | null {
  const lines = stdout.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const idx = lines[i].indexOf(PANEL_SENTINEL)
    if (idx === -1) continue
    const payload = lines[i].slice(idx + PANEL_SENTINEL.length).trim()
    if (payload === '') continue
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>
      if (parsed === null || typeof parsed !== 'object') return null
      return { ...parsed, ok: parsed.ok === true }
    } catch {
      return null
    }
  }
  return null
}

/**
 * window-size heredoc. Mirrors the worker route arithmetic exactly:
 * drag deltas apply to the CURRENT page viewport, aspect presets derive the
 * height from the (possibly new) width, and the target window adds Chrome's own
 * frame delta (bounds − viewport) so the PAGE lands at the requested size.
 *
 * `Browser.setWindowBounds` refuses width/height while the window is maximized,
 * so a non-normal state is restored first.
 */
export function buildEgoWindowSizeScript(spaceJson: string, body: Record<string, unknown>): string {
  const req = js(pickWindowRequest(body))
  return (
    `const __bcdpReq = ${req}\n` +
    `const __bcdpClampW = (w) => Math.min(${MAX_VIEWPORT_WIDTH}, Math.max(${MIN_VIEWPORT_WIDTH}, Math.round(w)))\n` +
    `const __bcdpClampH = (h) => Math.min(${MAX_VIEWPORT_HEIGHT}, Math.max(${MIN_VIEWPORT_HEIGHT}, Math.round(h)))\n` +
    `const __bcdpRatios = ${js(ASPECT_RATIOS)}\n` +
    `try {\n` +
    `  await taskSpaces.useOrCreate(${spaceJson})\n` +
    `  const __tab = await browser.currentTab()\n` +
    `  const __info = await page.info()\n` +
    `  let __win = null\n` +
    `  try { __win = await cdp('Browser.getWindowForTarget', { targetId: __tab.targetId }) }\n` +
    `  catch { __win = await cdp('Browser.getWindowForTarget', {}) }\n` +
    `  const __windowId = __win && __win.windowId\n` +
    `  if (typeof __windowId !== 'number') throw new Error('Browser.getWindowForTarget returned no windowId')\n` +
    `  const __b = (__win && __win.bounds) || {}\n` +
    `  if (__bcdpReq.maximize === true) {\n` +
    `    await cdp('Browser.setWindowBounds', { windowId: __windowId, bounds: { windowState: 'maximized' } })\n` +
    `    console.log(${js(PANEL_SENTINEL)} + JSON.stringify({ ok: true, maximized: true, windowId: __windowId, targetId: __tab.targetId, url: __info.url || '' }))\n` +
    `  } else {\n` +
    `    const __curW = Number(__info.w) || 0\n` +
    `    const __curH = Number(__info.h) || 0\n` +
    `    const __cfW = Math.max(0, (Number(__b.width) || 0) - __curW)\n` +
    `    const __cfH = Math.max(0, (Number(__b.height) || 0) - __curH)\n` +
    `    let __w = typeof __bcdpReq.width === 'number' ? __bcdpReq.width : (typeof __bcdpReq.delta === 'number' ? __curW + __bcdpReq.delta : __curW)\n` +
    `    let __h = typeof __bcdpReq.height === 'number' ? __bcdpReq.height : (typeof __bcdpReq.dy === 'number' ? __curH + __bcdpReq.dy : __curH)\n` +
    `    if (typeof __bcdpReq.aspect === 'string' && typeof __bcdpRatios[__bcdpReq.aspect] === 'number') __h = Math.round(__w * __bcdpRatios[__bcdpReq.aspect])\n` +
    `    __w = __bcdpClampW(__w)\n` +
    `    __h = __bcdpClampH(__h)\n` +
    `    if (__b.windowState && __b.windowState !== 'normal') {\n` +
    `      await cdp('Browser.setWindowBounds', { windowId: __windowId, bounds: { windowState: 'normal' } })\n` +
    `    }\n` +
    `    const __bounds = { width: __w + __cfW, height: __h + __cfH, windowState: 'normal' }\n` +
    `    if (typeof __b.left === 'number') __bounds.left = __b.left\n` +
    `    if (typeof __b.top === 'number') __bounds.top = __b.top\n` +
    `    await cdp('Browser.setWindowBounds', { windowId: __windowId, bounds: __bounds })\n` +
    `    console.log(${js(PANEL_SENTINEL)} + JSON.stringify({ ok: true, windowId: __windowId, targetId: __tab.targetId, viewport: { width: __w, height: __h } }))\n` +
    `  }\n` +
    `} catch (__bcdpErr) {\n` +
    `  console.log(${js(PANEL_SENTINEL)} + JSON.stringify({ ok: false, error: String((__bcdpErr && __bcdpErr.message) || __bcdpErr) }))\n` +
    `}\n`
  )
}

/**
 * switch-tab heredoc — the user clicked a tab in the panel.
 *
 * This is the ONE place a panel action deliberately mutates the browser: the
 * click means "show me that tab", so activating it is the intent. `switchTab`
 * also re-points the CLI session's preferred target, which keeps the agent and
 * the panel looking at the same page instead of silently diverging.
 */
export function buildEgoSwitchTabScript(spaceJson: string, body: Record<string, unknown>): string {
  const targetId = js(pickTargetId(body))
  return (
    `const __bcdpTarget = ${targetId}\n` +
    `try {\n` +
    `  if (__bcdpTarget === '') throw new Error('targetId required')\n` +
    `  await taskSpaces.useOrCreate(${spaceJson})\n` +
    `  const __tabs = await browser.listTabs()\n` +
    `  const __hit = __tabs.find((t) => t.targetId === __bcdpTarget)\n` +
    `  if (!__hit) throw new Error('tab not found: ' + __bcdpTarget)\n` +
    `  if (__hit.active !== true) await browser.switchTab({ targetId: __bcdpTarget })\n` +
    `  console.log(${js(PANEL_SENTINEL)} + JSON.stringify({ ok: true, targetId: __bcdpTarget, url: __hit.url || '', title: __hit.title || '' }))\n` +
    `} catch (__bcdpErr) {\n` +
    `  console.log(${js(PANEL_SENTINEL)} + JSON.stringify({ ok: false, error: String((__bcdpErr && __bcdpErr.message) || __bcdpErr) }))\n` +
    `}\n`
  )
}

/**
 * navigate heredoc — panel refresh / manual URL. Uses the runtime facades
 * (`page.reload` / `page.goto`) rather than raw CDP so the CLI keeps its own
 * load-state semantics and navigation guards.
 */
export function buildEgoNavigateScript(spaceJson: string, body: Record<string, unknown>): string {
  const req = js(pickNavigateRequest(body))
  return (
    `const __bcdpReq = ${req}\n` +
    `try {\n` +
    `  await taskSpaces.useOrCreate(${spaceJson})\n` +
    `  if (__bcdpReq.reload === true) {\n` +
    `    await page.reload({ ignoreCache: __bcdpReq.ignoreCache === true })\n` +
    `    let __u = ''\n` +
    `    try { __u = await page.url() } catch {}\n` +
    `    console.log(${js(PANEL_SENTINEL)} + JSON.stringify({ ok: true, reloaded: true, url: __u }))\n` +
    `  } else {\n` +
    `    const __target = typeof __bcdpReq.url === 'string' ? __bcdpReq.url.trim() : ''\n` +
    `    if (__target === '') throw new Error('url required')\n` +
    `    await page.goto(__target)\n` +
    `    let __after = ''\n` +
    `    try { __after = await page.url() } catch {}\n` +
    `    console.log(${js(PANEL_SENTINEL)} + JSON.stringify({ ok: true, url: __after || __target }))\n` +
    `  }\n` +
    `} catch (__bcdpErr) {\n` +
    `  console.log(${js(PANEL_SENTINEL)} + JSON.stringify({ ok: false, error: String((__bcdpErr && __bcdpErr.message) || __bcdpErr) }))\n` +
    `}\n`
  )
}
