/**
 * src/cast/cli-frame-poller.ts — degraded observation frame source for the
 * `ego-cli` link kind.
 *
 * When the activated link is a local ego CLI, no CDP ws is injected, so the
 * screencast worker cannot attach and the watch panel would show nothing. This
 * poller is the fallback: every `intervalMs` it runs a short heredoc through
 * the SAME CLI channel real tools use (`ego-browser nodejs`), captures one
 * viewport PNG, and keeps the newest frame in memory for the host route to
 * serve. One frame in, one frame out — no streaming, no SSE image mirror.
 *
 * Design constraints (from the approved plan):
 *  - It is a fire-and-forget short subprocess, NOT a long-lived process, so it
 *    lives in the host half (cast-server), not inside cdp-cast-worker.
 *  - It never contends with a real tool call: when `isBusy()` is true (a bcdp_*
 *    call holds the plugin lock) the tick is skipped, and the previous frame
 *    stays served. Frame freshness is subordinate to correctness of actions.
 *  - Capture failures are silent by design: a wedged space / no active tab /
 *    transient cold start must not blank the panel — the last good frame is the
 *    honest degraded state, and the next tick retries.
 *  - `capture` is injected (returns the CLI's merged stdout), so this module
 *    imports nothing from index.ts and never touches ctx.subprocess directly.
 */

/** Sentinel the frame heredoc prints; carries base64 PNG + url + title. */
export const FRAME_SENTINEL = '@@BCDP_FRAME@@'

export interface CliFrameTab {
  targetId: string
  url: string
  title: string
  active: boolean
}

/** One captured image, bound to the tab it came from. */
export interface CliFrameImage {
  targetId: string
  png: Buffer
  fmt: 'png' | 'jpeg'
  url: string
  title: string
}

export interface CliFrame {
  /** Active tab's image (kept for single-frame consumers). */
  png: Buffer
  /** Image encoding of `png` (the name predates JPEG captures). */
  fmt: 'png' | 'jpeg'
  /** Page URL at capture time ('' when unavailable). */
  url: string
  /** Page title at capture time ('' when unavailable). */
  title: string
  /** The tab the ACTIVE image was captured from. */
  targetId: string
  /** Every image in this cycle — one per tracked tab (all-mode) or just the active one. */
  frames: CliFrameImage[]
  /** Full tab inventory at capture time, so the panel can list every tab. */
  tabs: CliFrameTab[]
  /** Monotonic sequence counter — the frontend cache-busts `?t=seq` with it. */
  seq: number
  /** Wall-clock of the successful capture (ms since epoch). */
  updatedAt: number
}

export interface CliFramePollerOptions {
  /** Poll cadence in ms. The approved plan fixes 5000; kept injectable for tests. */
  intervalMs: number
  /**
   * Run the capture heredoc and resolve with the CLI's MERGED stdout+stderr.
   * Injected by the host so this module stays free of ctx/cfg/subprocess and of
   * any import from index.ts. Must resolve (never reject) — a thrown error is
   * still caught defensively below, but a rejecting capture is a host bug.
   */
  capture: () => Promise<string>
  /** True while a bcdp_* tool call owns the plugin lock — skip this tick. */
  isBusy?: () => boolean
  /**
   * Called after each successful capture with the new frame. The host uses this
   * to push the frame through the watch panel's live SSE stream (a `spaces` +
   * `frame` event), so the panel updates the instant a frame lands instead of
   * waiting on a client poll — the degraded mode has no screencast worker to
   * emit those events, so the poller is their only source.
   */
  onFrame?: (frame: CliFrame) => void
  /** Injectable clock for tests; defaults to Date.now. */
  now?: () => number
}

/**
 * Parse one capture's merged stdout for the frame sentinel line. Returns the
 * decoded frame, or null when the sentinel is absent or its payload malformed
 * (a CLI that errored before reaching the log line, a truncated base64, etc.).
 * Scans last-to-first so trailing log noise cannot displace the payload, and so
 * the behaviour matches the tool-side `parseSentinel` convention.
 * @internal exported for tests
 */
export function parseFrameSentinel(stdout: string, seq: number, at: number): CliFrame | null {
  const lines = stdout.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const idx = line.indexOf(FRAME_SENTINEL)
    if (idx === -1) continue
    const payload = line.slice(idx + FRAME_SENTINEL.length).trim()
    if (payload === '') continue
    let parsed: { png?: unknown; url?: unknown; title?: unknown; targetId?: unknown; tabs?: unknown; fmt?: unknown; frames?: unknown }
    try {
      parsed = JSON.parse(payload) as typeof parsed
    } catch {
      return null
    }
    if (typeof parsed.png !== 'string' || parsed.png === '') return null
    let png: Buffer
    try {
      png = Buffer.from(parsed.png, 'base64')
    } catch {
      return null
    }
    if (png.length === 0) return null
    // The inventory is what makes the panel multi-tab: without it the host would
    // fall back to one synthetic row and the strip would show a single tab.
    const tabs: CliFrameTab[] = Array.isArray(parsed.tabs)
      ? (parsed.tabs as unknown[])
          .map((row) => {
            const rec = (row ?? {}) as { targetId?: unknown; url?: unknown; title?: unknown; active?: unknown }
            return {
              targetId: typeof rec.targetId === 'string' ? rec.targetId : '',
              url: typeof rec.url === 'string' ? rec.url : '',
              title: typeof rec.title === 'string' ? rec.title : '',
              active: rec.active === true,
            }
          })
          .filter((row) => row.targetId !== '')
      : []
    const targetId = typeof parsed.targetId === 'string' ? parsed.targetId : ''
    const fmt: 'png' | 'jpeg' = parsed.fmt === 'jpeg' ? 'jpeg' : 'png'
    const url = typeof parsed.url === 'string' ? parsed.url : ''
    const title = typeof parsed.title === 'string' ? parsed.title : ''
    // All-mode: one image per tracked tab. Legacy/active-only payloads carry a
    // single image, so synthesise the one-element list from the top-level fields.
    const frames: CliFrameImage[] = []
    if (Array.isArray(parsed.frames)) {
      for (const row of parsed.frames as unknown[]) {
        const rec = (row ?? {}) as { targetId?: unknown; png?: unknown; fmt?: unknown; url?: unknown; title?: unknown }
        if (typeof rec.png !== 'string' || rec.png === '' || typeof rec.targetId !== 'string' || rec.targetId === '') continue
        let bytes: Buffer
        try {
          bytes = Buffer.from(rec.png, 'base64')
        } catch {
          continue
        }
        if (bytes.length === 0) continue
        frames.push({
          targetId: rec.targetId,
          png: bytes,
          fmt: rec.fmt === 'jpeg' ? 'jpeg' : 'png',
          url: typeof rec.url === 'string' ? rec.url : '',
          title: typeof rec.title === 'string' ? rec.title : '',
        })
      }
    }
    if (frames.length === 0) {
      frames.push({ targetId, png, fmt, url, title })
    }
    return {
      png,
      fmt,
      url,
      title,
      targetId,
      frames,
      tabs,
      seq,
      updatedAt: at,
    }
  }
  return null
}

export class CliFramePoller {
  private readonly opts: CliFramePollerOptions
  private timer: ReturnType<typeof setInterval> | null = null
  private latest: CliFrame | null = null
  private seq = 0
  /** Guard against overlapping ticks (a capture slower than the interval). */
  private inFlight = false

  constructor(opts: CliFramePollerOptions) {
    this.opts = opts
  }

  /** Start polling. Idempotent: a second call while running is a no-op. */
  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      void this.tick()
    }, this.opts.intervalMs)
    // Never keep the host process alive just for the poller.
    this.timer.unref?.()
    // Fire one capture immediately so the panel is not blank for a full interval.
    void this.tick()
  }

  /** Stop polling and drop the cached frame (the panel reverts to its placeholder). */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.latest = null
  }

  isRunning(): boolean {
    return this.timer !== null
  }

  /** The newest captured frame, or null when there is none yet. */
  getFrame(): CliFrame | null {
    return this.latest
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return
    if (this.opts.isBusy && this.opts.isBusy()) return
    this.inFlight = true
    try {
      const stdout = await this.opts.capture()
      const frame = parseFrameSentinel(stdout, ++this.seq, (this.opts.now ?? Date.now)())
      // A failed capture keeps the previous frame on purpose (silent degrade).
      if (frame !== null) {
        this.latest = frame
        if (this.opts.onFrame) {
          try { this.opts.onFrame(frame) } catch { /* a push failure must not break the poll */ }
        }
      }
    } catch {
      /* never throw out of a timer tick */
    } finally {
      this.inFlight = false
    }
  }
}

/**
 * The capture heredoc.
 *
 * Two fixes over the old `page.screenshot()` script:
 *  1. It captures the browser's ACTIVE tab, not the ego SESSION's preferred
 *     target. `bcdp_tab op=new` makes the new tab active in Chrome while the
 *     session target can stay on the previous page — which is why the panel
 *     used to track tab #1 forever while the inventory said #2 was active.
 *     Capturing by an explicit `Target.attachToTarget` session also avoids
 *     switching tabs (a passive observer must not steal the agent's target).
 *  2. It returns the FULL tab inventory, so the panel lists every tab instead
 *     of one synthetic row.
 *
 * `all` turns on 全模式: every tab in the space is captured in ONE process (one
 * attach/shot per tab, capped at `maxTabs`) and returned as `frames[]`, so the
 * panel can show a live picture per tab and outline whichever is active. Off =
 * 仅激活: a single image for the active tab (what the panel had before).
 *
 * The old facade path stays as a fallback: a runtime whose `cdp()` rejects a
 * sessionId still yields a frame (bound to the session page), just without
 * per-tab targeting. Images are JPEG over CDP (no temp file); the fallback
 * keeps `page.screenshot()`'s PNG file.
 */
export function buildFrameScript(spaceJson: string, opts: { all?: boolean; maxTabs?: number } = {}): string {
  const all = opts.all === true
  const maxTabs = Math.max(1, Math.min(8, opts.maxTabs ?? 6))
  return (
    `const __task = await taskSpaces.useOrCreate(${spaceJson})\n` +
    `let __tabs = []\n` +
    `try { __tabs = await browser.listTabs() } catch { __tabs = [] }\n` +
    `const __blank = (u) => /^(about:|chrome:|chrome-extension:|edge:|devtools:|data:)/.test(String(u || ''))\n` +
    `const __active = __tabs.find((t) => t.active === true) || __tabs.find((t) => !__blank(t.url)) || __tabs[0] || null\n` +
    `const __all = ${all ? 'true' : 'false'}\n` +
    `const __cap = async (t) => {\n` +
    `  try {\n` +
    `    const __att = await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true })\n` +
    `    const __sid = __att && __att.sessionId\n` +
    `    if (!__sid) return null\n` +
    `    let __u = t.url || ''\n` +
    `    let __ti = t.title || ''\n` +
    `    try {\n` +
    `      const __m = await cdp('Runtime.evaluate', { expression: '({url: location.href, title: document.title})', returnByValue: true }, __sid)\n` +
    `      const __v = (__m && __m.result && __m.result.value) || {}\n` +
    `      __u = __v.url || __u\n` +
    `      __ti = __v.title || __ti\n` +
    `    } catch {}\n` +
    `    const __s = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 70, fromSurface: true }, __sid)\n` +
    `    try { await cdp('Target.detachFromTarget', { sessionId: __sid }) } catch {}\n` +
    `    if (!__s || !__s.data) return null\n` +
    `    return { targetId: t.targetId, png: __s.data, fmt: 'jpeg', url: __u, title: __ti }\n` +
    `  } catch { return null }\n` +
    `}\n` +
    `const __frames = []\n` +
    `const __plan = __all ? __tabs.slice(0, ${maxTabs}) : (__active ? [__active] : [])\n` +
    `for (const __t of __plan) {\n` +
    `  const __img = await __cap(__t)\n` +
    `  if (__img) __frames.push(__img)\n` +
    `}\n` +
    `let __png = ''\n` +
    `let __fmt = 'jpeg'\n` +
    `let __url = ''\n` +
    `let __title = ''\n` +
    `let __targetId = ''\n` +
    `const __actImg = __frames.find((f) => __active && f.targetId === __active.targetId) || __frames[0] || null\n` +
    `if (__actImg) { __png = __actImg.png; __fmt = __actImg.fmt; __url = __actImg.url; __title = __actImg.title; __targetId = __actImg.targetId }\n` +
    `if (__png === '') {\n` +
    `  let __info = {}\n` +
    `  try { __info = await page.info() } catch { __info = {} }\n` +
    `  const __p = await page.screenshot({ fullPage: false })\n` +
    `  const __fs = await import('node:fs/promises')\n` +
    `  __png = (await __fs.readFile(__p)).toString('base64')\n` +
    `  try { await __fs.unlink(__p) } catch {}\n` +
    `  __fmt = 'png'\n` +
    `  __url = __url || __info.url || ''\n` +
    `  __title = __title || __info.title || ''\n` +
    `  if (__targetId === '') {\n` +
    `    const __match = __tabs.find((t) => (__info.url || '') !== '' && t.url === __info.url)\n` +
    `    __targetId = (__match && __match.targetId) || ''\n` +
    `  }\n` +
    `  __frames.push({ targetId: __targetId, png: __png, fmt: __fmt, url: __url, title: __title })\n` +
    `}\n` +
    `console.log(${JSON.stringify(FRAME_SENTINEL)} + JSON.stringify({ png: __png, fmt: __fmt, url: __url, title: __title, targetId: __targetId, frames: __frames, tabs: __tabs.map((t) => ({ targetId: t.targetId, url: t.url || '', title: t.title || '', active: t.active === true })) }))\n`
  )
}
