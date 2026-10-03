/**
 * src/cdp/capabilities.ts — engine detection + capability projection.
 *
 * The single point of decision for "what can this CDP endpoint do". The engine
 * is recognized once per probe/attach from `/json/version`'s `Browser` field;
 * every consumer (enable-domain filtering, screenshot format, capture / pick /
 * download gates) reads the projection instead of catching UnknownMethod or
 * -32000 errors after the fact.
 *
 * Zero I/O: pure functions over the discovery string, fixture-testable with no
 * socket and no clock (same discipline as events.ts).
 *
 * Degradation discipline: an UNRECOGNIZED endpoint keeps FULL capabilities —
 * misidentification must only ever withhold, never invent. Recognition only
 * ever downgrades.
 */

export type EngineId = 'chrome' | 'lightpanda' | 'unknown'

/**
 * Recognize the engine from `/json/version`'s `Browser` field
 * (`"Lightpanda/0.4.1"`, `"Chrome/153.0.0.0"`, `"Edg/153.0.0.0"`, …).
 * Empty or unrecognized → `'unknown'` (never guesses).
 */
export function engineOf(browserField: string): EngineId {
  const value = typeof browserField === 'string' ? browserField.trim() : ''
  if (value === '') return 'unknown'
  if (value.startsWith('Lightpanda/')) return 'lightpanda'
  if (value.startsWith('Chrome/') || value.startsWith('Chromium')) return 'chrome'
  if (value.startsWith('Edg/') || value.startsWith('Microsoft Edge ')) return 'chrome'
  return 'unknown'
}

export interface BackendCapabilities {
  engine: EngineId
  /** `Page.startScreencast` / `screencastFrame` exist (live view). */
  screencast: boolean
  /** The `Overlay` domain exists (pick highlight, inspect mode, marks). */
  overlay: boolean
  /** `Runtime.bindingCalled` fires after `addBinding` (pick event path). */
  bindingCalled: boolean
  /** The only wire format `Page.captureScreenshot` accepts. */
  imageFormat: 'jpeg' | 'png'
  /** `Page.loadEventFired` fires (false → `Page.lifecycleEvent name="load"` instead). */
  loadEvent: boolean
  /** `Page.downloadWillBegin` / `downloadProgress` fire (bcdp_download). */
  downloadEvents: boolean
  /**
   * Documentation bit: whether sending `Browser.close` to this endpoint would
   * be meaningful. The plugin NEVER closes the target browser over CDP today
   * (managed stop is killTree; remote stop is WS close). The one `Browser.close`
   * call site (login-import's temp Chrome) targets a LOCALLY spawned process
   * and must not consult this flag — see the regression note there.
   */
  browserClose: boolean
}

const FULL: BackendCapabilities = {
  engine: 'chrome',
  screencast: true,
  overlay: true,
  bindingCalled: true,
  imageFormat: 'jpeg',
  loadEvent: true,
  downloadEvents: true,
  browserClose: true,
}

/**
 * The capability projection per engine. `chrome` / `unknown` → full
 * capabilities (bit-for-bit today's behavior); `lightpanda` → the analysis
 * (docs/plans/2026-10-04-lightpanda-backend-analysis.md §7) projection.
 */
export function capabilitiesFor(engine: EngineId): BackendCapabilities {
  if (engine === 'lightpanda') {
    return {
      engine: 'lightpanda',
      screencast: false, // no screencast methods at all
      overlay: false, // no Overlay domain (UnknownMethod on enable)
      bindingCalled: false, // addBinding exists, the event never fires
      imageFormat: 'png', // captureScreenshot rejects other formats (-32000)
      loadEvent: false, // lifecycleEvent(load) replaces loadEventFired
      downloadEvents: false, // no downloadWillBegin / downloadProgress
      browserClose: false,
    }
  }
  return { ...FULL, engine }
}

/** Convenience: project straight from a discovery `Browser` string. */
export function capabilitiesForBrowser(browserField: string): BackendCapabilities {
  return capabilitiesFor(engineOf(browserField))
}

/**
 * Env key the host half sets when spawning the cast / render workers
 * (mirrors `EGO_LINUX_CDP_URL`'s injection pattern in cast-server). The child
 * processes cannot see the host's attach cache, so the projected engine id
 * travels as data — the host decides once, children only read.
 */
export const BCDP_CDP_ENGINE = 'BCDP_CDP_ENGINE'

/**
 * Project capabilities from the spawn-env value. Anything absent or
 * unrecognized means FULL capabilities — an unknown engine must never
 * conservatively break a Chrome endpoint.
 */
export function capabilitiesFromEnvValue(value: string | undefined): BackendCapabilities {
  return capabilitiesFor(value !== undefined && value.trim() === 'lightpanda' ? 'lightpanda' : 'unknown')
}
