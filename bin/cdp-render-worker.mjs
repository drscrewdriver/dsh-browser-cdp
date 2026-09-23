#!/usr/bin/env node
/**
 * bin/cdp-render-worker.mjs — standalone render worker (阶段 10 / R8 seed).
 *
 * WHY A SEPARATE PROCESS, NOT A NEW PATH INSIDE THE CAST WORKER.
 *
 * The cast worker reconnects with `setTimeout(3000)` and a `while (true)`
 * loop; it is built for a screencast that should survive a browser restart.
 * The render worker is the opposite kind of process: it opens ONE connection,
 * serves ONE page, and dies with it. Sharing the cast worker would mean a
 * budget/trace loop whose lifetime is coupled to a panel nobody asked to open.
 *
 * It also gives the call surface its own lifetime. The M0.x layer already
 * learned this (M0.2 §"重连后重放 enable 序列"): a reset connection loses every
 * enable and every binding. Keeping the render surface on a process that never
 * silently reconnects means "the connection is gone" is a fact the caller can
 * act on, not a state that lies.
 *
 * IPC: stdin is a JSON-RPC line stream, stdout is one JSON reply per line.
 *   {"id":1,"method":"capture","params":{"marks":true,"limit":20}}
 *   {"id":1,"ok":true,"result":{...}}
 * Keeping IPC JSON-RPC-shaped (not a bespoke format) is deliberate: the host
 * spawns it through `ctx.subprocess` exactly like the CLI heredoc, so nothing
 * in this file may depend on being started by our own code.
 */

import { createInterface } from 'node:readline'

const VERSION = 1

/**
 * The CDP call surface, bound once per connection.
 *
 * `sessionId` is load-bearing, not a detail: a connection to `…/devtools/browser/<id>`
 * is a BROWSER-level endpoint, and page domains answer `'Accessibility.getFullAXTree'
 * wasn't found` there. Measured on the first run of this worker — the commands
 * that work without a session (`Target.getTargets`, `Browser.getVersion`) are
 * exactly the ones that made the omission easy to miss.
 */
let state = {
  wsUrl: '',
  ws: null,
  nextId: 1,
  pending: new Map(),
  connectedAt: 0,
  sessionId: '',
  targetId: '',
  targetUrl: '',
}

function log(message) {
  process.stderr.write(`[cdp-render] ${message}\n`)
}

function reply(id, ok, payload) {
  process.stdout.write(`${JSON.stringify({ v: VERSION, id, ok, ...payload })}\n`)
}

/** One CDP command over the single connection. Rejects on timeout or close. */
function call(method, params = {}, sessionId = state.sessionId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!state.ws || state.ws.readyState !== 1) {
      reject(new Error('the render worker has no live connection'))
      return
    }
    const id = state.nextId++
    const timer = setTimeout(() => {
      state.pending.delete(id)
      reject(new Error(`${method} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    state.pending.set(id, { resolve, reject, timer, method })
    const message = { id, method, params }
    if (sessionId) message.sessionId = sessionId
    try {
      state.ws.send(JSON.stringify(message))
    } catch (error) {
      clearTimeout(timer)
      state.pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

/**
 * Pick the page to serve and attach to it.
 *
 * Prefer an http(s) page: `about:blank` and internal pages have no AX tree worth
 * numbering, and a caller that asked for a capture meant a real page. The choice
 * is REPORTED (`targetId`, `targetUrl`) rather than implied, because "which tab
 * did this image come from" is the first question when a capture looks wrong.
 */
async function attachPage(params) {
  const wanted = String(params.targetId || '')
  const listed = await call('Target.getTargets', {}, '', 8000)
  const pages = (listed?.targetInfos || []).filter((info) => info.type === 'page')
  if (pages.length === 0) throw new Error('the browser has no page target to render')
  const chosen = wanted
    ? pages.find((info) => info.targetId === wanted)
    : (pages.find((info) => /^https?:/i.test(String(info.url))) ?? pages[0])
  if (!chosen) throw new Error(`no page target matches targetId ${wanted}`)

  const attached = await call('Target.attachToTarget', { targetId: chosen.targetId, flatten: true }, '', 8000)
  const sessionId = String(attached?.sessionId || '')
  if (sessionId === '') throw new Error('Target.attachToTarget returned no sessionId')
  state.sessionId = sessionId
  state.targetId = chosen.targetId
  state.targetUrl = String(chosen.url || '')

  // Enable order is the M0.3 contract (src/cdp/events.ts): DOM before Overlay,
  // Accessibility before the AX-tree read. An enable failure is reported here
  // rather than surfacing later as a confusing "method wasn't found".
  for (const domain of ['Page', 'Runtime', 'DOM', 'Accessibility']) {
    await call(`${domain}.enable`, {}, sessionId, 10000)
  }
  return { targetId: chosen.targetId, targetUrl: String(chosen.url || ''), sessionId }
}

async function connect(wsUrl, timeoutMs) {
  if (state.ws) {
    try { state.ws.close() } catch { /* already gone */ }
    state.ws = null
  }
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.close() } catch { /* not open */ }
      reject(new Error(`connect timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('websocket error during connect')) }, { once: true })
  })
  ws.addEventListener('message', (event) => {
    let message
    try { message = JSON.parse(String(event.data)) } catch { return }
    if (typeof message.id !== 'number') return // an event, not a reply
    const entry = state.pending.get(message.id)
    if (!entry) return
    clearTimeout(entry.timer)
    state.pending.delete(message.id)
    if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`))
    else entry.resolve(message.result)
  })
  ws.addEventListener('close', () => {
    for (const [, entry] of state.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('the connection closed while a command was in flight'))
    }
    state.pending.clear()
    state.ws = null
    state.sessionId = ''
    state.targetId = ''
    state.targetUrl = ''
  })
  state.ws = ws
  state.wsUrl = wsUrl
  state.connectedAt = Date.now()
}

/**
 * Count the interactive candidates of a page WITHOUT touching screenshotting.
 *
 * The whole point of the count is that it decides whether the caller must
 * chunk; that decision must therefore not depend on a rendered image.
 */
async function gatherInteractive(limit) {
  const ax = await call('Accessibility.getFullAXTree', {})
  const nodes = Array.isArray(ax?.nodes) ? ax.nodes : []
  const roles = new Set([
    'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
    'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'switch', 'slider',
  ])
  const out = []
  const seen = new Set()
  for (const node of nodes) {
    if (out.length >= limit) break
    if (node.ignored === true) continue
    const role = typeof node.role?.value === 'string' ? node.role.value : ''
    if (!roles.has(role)) continue
    const backendNodeId = Number.parseInt(String(node.nodeId ?? ''), 10)
    if (!Number.isFinite(backendNodeId) || seen.has(backendNodeId)) continue
    seen.add(backendNodeId)
    out.push({
      n: out.length + 1,
      backendNodeId,
      role,
      name: typeof node.name?.value === 'string' ? node.name.value : '',
    })
  }
  return out
}

/**
 * Capture with a BYTE BUDGET.
 *
 * Calibrated from the measured native requirement and the client's own image
 * handling: the budget is honoured by trying JPEG quality steps inside it
 * rather than by cropping the page, because cropping silently removes the very
 * elements the caller asked to see. If even the floor quality overflows, the
 * overrun is REPORTED (`overBudget: true`) — a caller that set a budget must be
 * able to tell "I got what I asked for" from "I got the closest thing".
 */
async function captureWithinBudget({ format, quality, maxBytes, scale, marks, limit, measureRects }) {
  const maxWidth = format === 'jpeg' ? (scale?.maxWidth || 1600) : (scale?.maxWidth || 2400)
  const params = { format, captureBeyondViewport: true }
  if (format === 'jpeg') {
    params.optimizeForSpeed = true
    params.quality = quality || 72
  }
  const attempts = format === 'jpeg'
    ? [params.quality, Math.max(35, params.quality - 18), 45, 35].filter((q, i, a) => a.indexOf(q) === i)
    : [params.quality]

  // A cheap page does not need a resize round trip; only ask for the metrics
  // when the format could overflow.
  let width = 0
  let height = 0
  if (format === 'jpeg') {
    try {
      const metrics = await call('Page.getLayoutMetrics', {})
      const content = metrics?.cssContentSize || metrics?.contentSize
      width = Number(content?.width) || 0
      height = Number(content?.height) || 0
    } catch { /* fall through with no clipping */ }
    if (width > maxWidth) {
      params.clip = { x: 0, y: 0, width, height, scale: maxWidth / width }
    }
  }

  let last = null
  for (const q of attempts) {
    if (format === 'jpeg') params.quality = q
    const shot = await call('Page.captureScreenshot', params, undefined, 30000)
    const data = typeof shot?.data === 'string' ? shot.data : ''
    if (data === '') throw new Error('Page.captureScreenshot returned no data')
    const bytes = Math.floor((data.length * 3) / 4)
    last = { data, bytes, quality: format === 'jpeg' ? q : null }
    if (maxBytes === 0 || bytes <= maxBytes) return { ...last, overBudget: false, attempts: attempts.indexOf(q) + 1 }
  }
  return { ...last, overBudget: true, attempts: attempts.length }
}

/**
 * Act on a numbered candidate, re-measuring first.
 *
 * This mirrors `src/jev/act.ts` deliberately. That module declares the
 * DISCIPLINE and is unit-tested plugin-side against a scripted fake; the actual
 * CDP calls have to live here, because the plugin's Node process has no CDP
 * channel (every `src/cdp/*` module runs inside a worker like this one).
 *
 * The discipline, unchanged: a rect from the frame is NEVER the click target.
 *     backendNodeId → DOM.getBoxModel (fresh) → DOM.getNodeForLocation (pre-check)
 *                   → click → DOM.getNodeForLocation (post-check)
 * The pre-check is what catches an overlay WITHOUT dispatching a stray click.
 */
async function actOnCandidate(params) {
  const backendNodeId = Number(params.backendNodeId)
  const action = String(params.action || 'click')
  if (!Number.isFinite(backendNodeId) || backendNodeId <= 0) {
    return { ok: false, code: 'no-candidate', message: 'act needs a positive backendNodeId' }
  }
  if (state.sessionId === '') await attachPage(params)

  if (action === 'scroll') {
    const deltaY = Number(params.deltaY)
    if (!Number.isFinite(deltaY) || deltaY === 0) {
      return { ok: false, code: 'bad-delta', message: 'scroll needs a non-zero deltaY' }
    }
    // A wheel event needs a point; the viewport centre is neutral and needs no
    // measurement. Zero-x keeps it a pure vertical scroll.
    const centre = await viewportCentre()
    await call('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: centre.x, y: centre.y, deltaX: 0, deltaY, button: 'none', buttons: 0, clickCount: 0,
    })
    return { ok: true, code: 'ok', action: 'scroll', backendNodeId: 0, point: centre, measured: null, drift: 0 }
  }

  if (action === 'fill') {
    const text = String(params.text ?? '')
    if (text === '') return { ok: false, code: 'empty-text', message: 'fill needs non-empty text' }
    const measured = await measure(backendNodeId)
    if (!measured.ok) return measured
    // Focus then insert. NEVER assign `.value`: a controlled input re-renders
    // from its own state and would wipe it, and no input/change event fires, so
    // the page believes the field is empty while a screenshot shows text.
    await call('DOM.focus', { backendNodeId })
    await call('Input.insertText', { text })
    return { ok: true, code: 'ok', action: 'fill', backendNodeId, point: measured.centre, measured: measured.rect, drift: measured.drift }
  }

  const measured = await measure(backendNodeId)
  if (!measured.ok) return measured

  // PRE-check: is this node still the topmost thing at the measured point? Run
  // before dispatching, so an overlay costs nothing instead of costing a click.
  const hit = await call('DOM.getNodeForLocation', {
    x: Math.round(measured.centre.x), y: Math.round(measured.centre.y), includeUserAgentShadowDOM: false,
  })
  if (Number(hit?.backendNodeId) !== backendNodeId) {
    return {
      ok: false,
      code: 'click-missed',
      message: `candidate measured to ${Math.round(measured.centre.x)},${Math.round(measured.centre.y)} but that point resolves to backendNodeId ${hit?.backendNodeId} — something is on top of it or the page moved`,
    }
  }

  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await call('Input.dispatchMouseEvent', {
      type,
      x: Math.round(measured.centre.x),
      y: Math.round(measured.centre.y),
      button: 'left',
      buttons: type === 'mousePressed' ? 1 : 0,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    })
  }

  // POST-check: a mid-flight re-layout is reported, not hidden.
  const after = await call('DOM.getNodeForLocation', {
    x: Math.round(measured.centre.x), y: Math.round(measured.centre.y), includeUserAgentShadowDOM: false,
  })
  if (Number(after?.backendNodeId) !== backendNodeId) {
    return { ok: false, code: 'click-missed', message: 'the click dispatched but the point now resolves to a different node' }
  }
  return { ok: true, code: 'ok', action: 'click', backendNodeId, point: measured.centre, measured: measured.rect, drift: measured.drift }
}

/** A current box model plus the frame-independent drift, for one node. */
async function measure(backendNodeId) {
  let model
  try {
    model = await call('DOM.getBoxModel', { backendNodeId })
  } catch (error) {
    return { ok: false, code: 'no-box-model', message: error instanceof Error ? error.message : String(error) }
  }
  const rect = quadToRect(model?.model?.content)
  if (rect === null) return { ok: false, code: 'no-box-model', message: 'DOM.getBoxModel returned no usable content quad' }
  // CDP boxes are DOCUMENT space; input coordinates are VIEWPORT space. Adding
  // the scroll offset back is what keeps a click on the right element after the
  // page has scrolled — the bug that only shows up on scrolled pages, i.e.
  // never during a smoke test.
  const scroll = await readScroll()
  const viewportRect = { ...rect, x: rect.x - scroll.x, y: rect.y - scroll.y }
  return {
    ok: true,
    rect: viewportRect,
    centre: { x: viewportRect.x + viewportRect.width / 2, y: viewportRect.y + viewportRect.height / 2 },
    drift: 0,
  }
}

async function readScroll() {
  try {
    const result = await call('Runtime.evaluate', { expression: '[window.scrollX, window.scrollY]', returnByValue: true })
    const value = result?.result?.value
    if (Array.isArray(value) && value.length >= 2) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0 }
  } catch { /* a missing scroll offset must not fail the action */ }
  return { x: 0, y: 0 }
}

async function viewportCentre() {
  try {
    const metrics = await call('Page.getLayoutMetrics', {})
    const visual = metrics?.cssVisualViewport || metrics?.visualViewport
    const w = Number(visual?.clientWidth) || 0
    const h = Number(visual?.clientHeight) || 0
    if (w > 0 && h > 0) return { x: Math.round(w / 2), y: Math.round(h / 2) }
  } catch { /* fall through */ }
  return { x: 0, y: 0 }
}

/** A CDP quad is 8 numbers: x1,y1 .. x4,y4. */
function quadToRect(quad) {
  if (!Array.isArray(quad) || quad.length < 8) return null
  const xs = [Number(quad[0]), Number(quad[2]), Number(quad[4]), Number(quad[6])]
  const ys = [Number(quad[1]), Number(quad[3]), Number(quad[5]), Number(quad[7])]
  if ([...xs, ...ys].some((value) => !Number.isFinite(value))) return null
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/**
 * The viewport facts a FRAME needs: size, scroll offset, device pixel ratio.
 *
 * One `Page.getLayoutMetrics` serves all four. They are reported together
 * because a frame that knows its size but not its scroll offset cannot say which
 * part of the document it showed — and `resolveClip`'s whole lesson (a viewport
 * clip is meaningless without `scroll`) is the same lesson at this layer.
 */
async function viewportInfo() {
  const fallback = { width: 0, height: 0, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }
  try {
    const metrics = await call('Page.getLayoutMetrics', {})
    const visual = metrics?.cssVisualViewport || metrics?.visualViewport
    const css = Number(visual?.clientWidth) || 0
    const physical = Number(metrics?.contentSize?.width) || 0
    const devicePixelRatio = css > 0 && physical > 0 ? Math.max(1, Math.round((physical / css) * 100) / 100) : 1
    const pageX = Number(visual?.pageX) || 0
    const pageY = Number(visual?.pageY) || 0
    return {
      width: css || 0,
      height: Number(visual?.clientHeight) || 0,
      // `pageX/pageY` is what CDP calls the scroll offset; `scrollX` is not a
      // field on this reply, and inventing a runtime evaluate round trip for it
      // would make a capture cost one more command for no new information.
      scrollX: pageX,
      scrollY: pageY,
      devicePixelRatio,
    }
  } catch {
    return fallback
  }
}

async function handle(method, params) {
  switch (method) {
    case 'hello':
      return { version: VERSION, connected: state.ws !== null, wsUrl: state.wsUrl, sessionId: state.sessionId }
    case 'connect': {
      await connect(String(params.wsUrl || ''), Number(params.timeoutMs) || 8000)
      const attached = await attachPage(params)
      return { wsUrl: state.wsUrl, ...attached }
    }
    case 'interactive':
      return { candidates: await gatherInteractive(Number(params.limit) || 20) }
    case 'capture': {
      if (params.attach !== false && state.sessionId === '') await attachPage(params)
      const shot = await captureWithinBudget({
        format: params.format === 'png' ? 'png' : 'jpeg',
        quality: Number(params.quality) || 72,
        maxBytes: Number(params.maxBytes) || 0,
        scale: params.scale || {},
        marks: params.marks !== false,
        limit: Number(params.limit) || 20,
        measureRects: params.measureRects !== false,
      })
      // The marks are gathered AFTER the shot on purpose: the numbering the
      // caller receives must describe the page the image shows, and a gather
      // that runs first can drift on a page that renders asynchronously.
      const candidates = params.marks === false ? [] : await gatherInteractive(Number(params.limit) || 20)
      const viewport = await viewportInfo()
      return {
        ...shot,
        marks: candidates,
        viewport,
        pixelRatio: viewport.devicePixelRatio,
        targetId: state.targetId,
        targetUrl: state.targetUrl,
        sessionId: state.sessionId,
      }
    }
    case 'act':
      return actOnCandidate(params)
    case 'ping':
      return { pong: true, connected: state.ws !== null, uptimeMs: state.connectedAt ? Date.now() - state.connectedAt : 0 }
    default:
      throw new Error(`unknown method "${method}"`)
  }
}

const rl = createInterface({ input: process.stdin, terminal: false })
let chain = Promise.resolve()
rl.on('line', (line) => {
  const text = line.trim()
  if (text === '') return
  chain = chain.then(async () => {
    let request
    try { request = JSON.parse(text) } catch { reply(null, false, { error: { code: 'bad-json', message: 'request was not JSON' } }); return }
    const id = request.id ?? null
    try {
      const result = await handle(String(request.method || ''), request.params || {})
      reply(id, true, { result })
    } catch (error) {
      reply(id, false, { error: { code: 'call-failed', message: error instanceof Error ? error.message : String(error) } })
    }
  })
})
rl.on('close', () => {
  if (state.ws) { try { state.ws.close() } catch { /* already gone */ } }
  process.exit(0)
})

log(`ready (pid ${process.pid}, node ${process.version})`)
