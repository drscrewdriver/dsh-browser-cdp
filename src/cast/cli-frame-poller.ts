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

export interface CliFrame {
  /** Raw PNG bytes of the newest captured viewport. */
  png: Buffer
  /** Page URL at capture time ('' when page.info() did not report one). */
  url: string
  /** Page title at capture time ('' when unavailable). */
  title: string
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
    let parsed: { png?: unknown; url?: unknown; title?: unknown }
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
    return {
      png,
      url: typeof parsed.url === 'string' ? parsed.url : '',
      title: typeof parsed.title === 'string' ? parsed.title : '',
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
      if (frame !== null) this.latest = frame
    } catch {
      /* never throw out of a timer tick */
    } finally {
      this.inFlight = false
    }
  }
}

/**
 * The capture heredoc. Uses the runtime's own facades (taskSpaces + page) so it
 * rides the exact channel real tools use; deliberately does NOT call
 * ensureRealTab / switchTab — a passive observer must not move the active tab.
 * `page.screenshot()` in this runtime returns a saved PNG path, so we read the
 * file back into base64 and clean it up.
 */
export function buildFrameScript(spaceJson: string): string {
  return (
    `const task = await taskSpaces.useOrCreate(${spaceJson})\n` +
    `let __info = {}\n` +
    `try { __info = await page.info() } catch { __info = {} }\n` +
    `const __p = await page.screenshot({ fullPage: false })\n` +
    `const __fs = await import('node:fs/promises')\n` +
    `const __png = (await __fs.readFile(__p)).toString('base64')\n` +
    `try { await __fs.unlink(__p) } catch {}\n` +
    `console.log(${JSON.stringify(FRAME_SENTINEL)} + JSON.stringify({ png: __png, url: __info.url || '', title: __info.title || '' }))\n`
  )
}
