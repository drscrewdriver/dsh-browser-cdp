/**
 * src/cdp/page.ts — M0.7: page operations. Screenshot, Overlay, Runtime binding.
 *
 * Three rules this module encodes, each of which was learned the hard way:
 *
 *  1. **A clip is in DOCUMENT coordinates.** `Page.captureScreenshot`'s clip
 *     origin is the document, so a "viewport" capture anchored at `{x:0,y:0}`
 *     silently returns blank pixels once the page is scrolled (that was the
 *     v0.8.5 bug). A viewport-space clip is therefore REQUIRED to declare its
 *     `scroll` offset — we translate it, and refuse with `missing-scroll`
 *     rather than cropping the wrong region.
 *  2. **`highlightConfig` is mandatory.** Measured against Chrome 153: omit it
 *     and the browser answers `Internal error: highlight configuration
 *     parameter is missing`. We fail fast with our own code BEFORE the round
 *     trip, and every call's return value is recorded — "look but don't log"
 *     is how a silently-disabled Overlay survives a week of debugging.
 *  3. **Page → host feedback uses `Runtime.addBinding`, never polling.**
 *
 * No I/O of its own: every function takes the M0.2 `call` surface, so the whole
 * layer is testable against a scripted fake and re-usable by the probe fixture.
 */

export type PageCall = (
  method: string,
  params: unknown,
  options?: { sessionId?: string; timeoutMs?: number },
) => Promise<unknown>

export interface LayerFailure {
  ok: false
  code: string
  message: string
}

// ── screenshot ──────────────────────────────────────────────────────────────

export interface ClipRect {
  x: number
  y: number
  width: number
  height: number
  scale?: number
}

export interface ScreenshotOptions {
  format?: 'png' | 'jpeg'
  /** JPEG quality, 0–100. Ignored for PNG. */
  quality?: number
  clip?: ClipRect
  /**
   * Which space `clip` is expressed in. "viewport" means "relative to what the
   * user currently sees" and REQUIRES `scroll`; "document" is the CDP native
   * space and is passed through untouched.
   */
  clipSpace?: 'document' | 'viewport'
  /** Current scroll offset, needed to translate a viewport clip. */
  scroll?: { x: number; y: number }
  /**
   * Whether Chrome may render outside the visible viewport. Defaults to `true`
   * when a clip is present (a document-space clip is usually off-screen) and
   * `false` otherwise. Always passed explicitly, so the wire is unambiguous.
   */
  captureBeyondViewport?: boolean
  timeoutMs?: number
}

export interface ScreenshotOk {
  ok: true
  /** base64 image data as returned by CDP. */
  data: string
  bytes: number
  /** The clip actually sent, in document coordinates (null = full viewport). */
  clip: ClipRect | null
  captureBeyondViewport: boolean
}

export type ScreenshotResult = ScreenshotOk | LayerFailure

/**
 * Translate an option set into the exact wire parameters, or explain why it
 * cannot be done. Exported because the decision — not the image — is what the
 * callers and the fixtures need to reason about.
 */
export function resolveClip(
  options: ScreenshotOptions,
): { ok: true; clip: ClipRect | null; captureBeyondViewport: boolean } | LayerFailure {
  const beyond = options.captureBeyondViewport ?? options.clip !== undefined
  if (options.clip === undefined) return { ok: true, clip: null, captureBeyondViewport: beyond }

  const { x, y, width, height, scale } = options.clip
  for (const [name, value] of Object.entries({ x, y, width, height })) {
    if (!Number.isFinite(value)) {
      return { ok: false, code: 'invalid-clip', message: `clip.${name} must be a finite number` }
    }
  }
  if (width <= 0 || height <= 0) {
    return { ok: false, code: 'invalid-clip', message: `clip width/height must be positive (got ${width}x${height})` }
  }

  if (options.clipSpace === 'viewport') {
    const scroll = options.scroll
    if (scroll === undefined) {
      return {
        ok: false,
        code: 'missing-scroll',
        message:
          'a viewport clip needs the current scroll offset: CDP clip coordinates are document-relative, ' +
          'so cropping without it silently captures the wrong region',
      }
    }
    if (!Number.isFinite(scroll.x) || !Number.isFinite(scroll.y)) {
      return { ok: false, code: 'missing-scroll', message: 'scroll.x / scroll.y must be finite numbers' }
    }
    return {
      ok: true,
      clip: { x: x + scroll.x, y: y + scroll.y, width, height, ...(scale === undefined ? {} : { scale }) },
      captureBeyondViewport: beyond,
    }
  }

  return { ok: true, clip: { x, y, width, height, ...(scale === undefined ? {} : { scale }) }, captureBeyondViewport: beyond }
}

export async function captureScreenshot(
  call: PageCall,
  sessionId: string | undefined,
  options: ScreenshotOptions = {},
): Promise<ScreenshotResult> {
  const resolved = resolveClip(options)
  if (!resolved.ok) return resolved

  const params: Record<string, unknown> = {
    format: options.format ?? 'png',
    captureBeyondViewport: resolved.captureBeyondViewport,
  }
  if (params.format === 'jpeg' && options.quality !== undefined) params.quality = options.quality
  if (resolved.clip !== null) params.clip = resolved.clip

  try {
    const result = (await call('Page.captureScreenshot', params, {
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    })) as { data?: unknown }
    const data = typeof result?.data === 'string' ? result.data : ''
    if (data === '') {
      return { ok: false, code: 'empty-screenshot', message: 'Page.captureScreenshot returned no data' }
    }
    return {
      ok: true,
      data,
      bytes: Buffer.byteLength(data, 'base64'),
      clip: resolved.clip,
      captureBeyondViewport: resolved.captureBeyondViewport,
    }
  } catch (error) {
    return { ok: false, code: 'screenshot-failed', message: error instanceof Error ? error.message : String(error) }
  }
}

/** Current scroll offset, in CSS pixels. Needed to anchor a viewport clip. */
export async function readScrollOffset(
  call: PageCall,
  sessionId: string | undefined,
  timeoutMs?: number,
): Promise<{ ok: true; x: number; y: number } | LayerFailure> {
  try {
    const result = (await call(
      'Runtime.evaluate',
      { expression: '[window.scrollX, window.scrollY]', returnByValue: true },
      { ...(sessionId === undefined ? {} : { sessionId }), ...(timeoutMs === undefined ? {} : { timeoutMs }) },
    )) as { result?: { value?: unknown } }
    const value = result?.result?.value
    if (!Array.isArray(value) || value.length < 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
      return { ok: false, code: 'scroll-unreadable', message: 'window.scrollX/scrollY did not evaluate to two numbers' }
    }
    return { ok: true, x: Number(value[0]), y: Number(value[1]) }
  } catch (error) {
    return { ok: false, code: 'scroll-unreadable', message: error instanceof Error ? error.message : String(error) }
  }
}

// ── Overlay ─────────────────────────────────────────────────────────────────

/** Exactly the message Chrome 153 answers when `highlightConfig` is omitted. */
export const HIGHLIGHT_CONFIG_MISSING_MESSAGE = 'highlight configuration parameter is missing'

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export interface HighlightConfig {
  showInfo?: boolean
  showStyles?: boolean
  showRulers?: boolean
  contentColor?: Rgba
  paddingColor?: Rgba
  borderColor?: Rgba
  marginColor?: Rgba
}

/** A visible, neutral box — the default for a set-of-marks highlight. */
export const NEUTRAL_HIGHLIGHT_CONFIG: HighlightConfig = {
  showInfo: false,
  contentColor: { r: 56, g: 132, b: 255, a: 0.28 },
  borderColor: { r: 56, g: 132, b: 255, a: 0.9 },
}

/**
 * The config to send alongside `mode: 'none'`.
 *
 * A config is ALWAYS required — even to switch inspect mode off — because the
 * browser rejects the command outright without one.
 */
export const DISABLED_HIGHLIGHT_CONFIG: HighlightConfig = {
  showInfo: false,
  contentColor: { r: 0, g: 0, b: 0, a: 0 },
}

export interface OverlayResult {
  ok: boolean
  code: string
  message: string
  /**
   * The raw CDP reply. Recorded on purpose: a security/state-shifting command
   * whose answer is not kept is a command nobody can debug later.
   */
  value: unknown
}

function overlayFailure(code: string, message: string): OverlayResult {
  return { ok: false, code, message, value: null }
}

export interface HighlightOptions {
  backendNodeId?: number
  nodeId?: number
  config?: HighlightConfig
  sessionId?: string
  timeoutMs?: number
}

export async function highlightNode(call: PageCall, options: HighlightOptions = {}): Promise<OverlayResult> {
  if (options.config === undefined) {
    return overlayFailure(
      'highlight-config-missing',
      `highlightNode needs an explicit highlightConfig (${HIGHLIGHT_CONFIG_MISSING_MESSAGE} is what the browser answers otherwise)`,
    )
  }
  if (options.backendNodeId === undefined && options.nodeId === undefined) {
    return overlayFailure('highlight-target-missing', 'highlightNode needs a backendNodeId or a nodeId')
  }
  const params: Record<string, unknown> = { highlightConfig: options.config }
  if (options.backendNodeId !== undefined) params.backendNodeId = options.backendNodeId
  if (options.nodeId !== undefined) params.nodeId = options.nodeId
  try {
    const value = await call('Overlay.highlightNode', params, {
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    })
    return { ok: true, code: 'ok', message: '', value }
  } catch (error) {
    return overlayFailure('highlight-failed', error instanceof Error ? error.message : String(error))
  }
}

export type InspectMode = 'none' | 'searchForNode' | 'searchForUAShadowDOM'

export interface InspectOptions {
  mode: InspectMode
  config?: HighlightConfig
  sessionId?: string
  timeoutMs?: number
}

/**
 * Enter (or leave) inspect mode.
 *
 * `highlightConfig` is always sent — see `DISABLED_HIGHLIGHT_CONFIG` for the
 * `none` case. Omitting it is the exact mistake F10 records, so we refuse it
 * in-process instead of shipping a command we know Chrome rejects.
 */
export async function setInspectMode(call: PageCall, options: InspectOptions): Promise<OverlayResult> {
  if (options.config === undefined) {
    return overlayFailure(
      'highlight-config-missing',
      `setInspectMode(${options.mode}) needs a highlightConfig (${HIGHLIGHT_CONFIG_MISSING_MESSAGE} otherwise)`,
    )
  }
  try {
    const value = await call(
      'Overlay.setInspectMode',
      { mode: options.mode, highlightConfig: options.config },
      {
        ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      },
    )
    return { ok: true, code: 'ok', message: '', value }
  } catch (error) {
    return overlayFailure('inspect-mode-failed', error instanceof Error ? error.message : String(error))
  }
}

// ── Runtime.addBinding: page → host feedback ────────────────────────────────

export interface BindingCalledParams {
  name: string
  payload: string
  executionContextId: number
}

export async function addBinding(
  call: PageCall,
  name: string,
  options: { sessionId?: string; timeoutMs?: number } = {},
): Promise<OverlayResult> {
  if (name.trim() === '') return overlayFailure('binding-name-missing', 'addBinding needs a non-empty binding name')
  try {
    const value = await call(
      'Runtime.addBinding',
      { name },
      {
        ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      },
    )
    return { ok: true, code: 'ok', message: '', value }
  } catch (error) {
    return overlayFailure('binding-failed', error instanceof Error ? error.message : String(error))
  }
}

/** Minimal shape of the M0.3 dispatcher this needs — avoids a hard import cycle. */
export interface BindingEventSource {
  onMethod(method: string, handler: (params: unknown, sessionId?: string, method?: string) => void): () => void
}

/**
 * Subscribe to a named binding. This is the page → host channel R6's pick
 * result travels on; it is push-based, so nothing here polls.
 */
export function onBindingCalled(
  dispatcher: BindingEventSource,
  name: string,
  handler: (params: BindingCalledParams) => void,
): () => void {
  return dispatcher.onMethod('Runtime.bindingCalled', (params) => {
    const typed = params as Partial<BindingCalledParams> | undefined
    if (typed === undefined || typed.name !== name) return
    handler({
      name: typed.name,
      payload: typeof typed.payload === 'string' ? typed.payload : '',
      executionContextId: typeof typed.executionContextId === 'number' ? typed.executionContextId : 0,
    })
  })
}
