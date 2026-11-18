import type { CdpClient } from './cdp-client.ts'

interface Session {
  targetId: string
  sessionId: string
  viewportW: number | null
  viewportH: number | null
}

interface JpegFrame {
  targetId: string
  data: string
  vw: number | null
  vh: number | null
  ts: number
  backstop?: boolean
}

export class TargetSessions {
  cdp: CdpClient
  sessions: Map<string, Session>
  detachDestroyed: () => void
  destroyedHandlers: Set<(targetId: string) => void>

  constructor(cdp: CdpClient) {
    this.cdp = cdp
    this.sessions = new Map()
    this.detachDestroyed = cdp.on('Target.targetDestroyed', (params: unknown) => {
      const { targetId } = params as { targetId?: string }
      if (!targetId) return
      this.sessions.delete(targetId)
      for (const handler of this.destroyedHandlers || []) handler(targetId)
    })
    this.destroyedHandlers = new Set()
  }

  async ensure(targetId: string): Promise<Session> {
    if (this.sessions.has(targetId)) return this.sessions.get(targetId)!
    const result = await this.cdp.call('Target.attachToTarget', { targetId, flatten: true }) as { sessionId?: string }
    if (!result.sessionId) throw new Error(`CDP did not return a session for ${targetId}`)
    const session: Session = { targetId, sessionId: result.sessionId, viewportW: null, viewportH: null }
    this.sessions.set(targetId, session)
    await Promise.allSettled([
      this.cdp.call('Page.enable', {}, session.sessionId),
      this.cdp.call('Runtime.enable', {}, session.sessionId),
    ])
    await this.updateViewport(targetId)
    return session
  }

  get(targetId: string): Session | null {
    return this.sessions.get(targetId) || null
  }

  onDestroyed(handler: (targetId: string) => void): () => void {
    this.destroyedHandlers.add(handler)
    return () => {
      this.destroyedHandlers.delete(handler)
    }
  }

  async updateViewport(targetId: string): Promise<Session> {
    const session = await this.ensure(targetId)
    try {
      const result = await this.cdp.call('Page.getLayoutMetrics', {}, session.sessionId) as { cssLayoutViewport?: { clientWidth?: number; width?: number; clientHeight?: number; height?: number }; cssViewport?: { clientWidth?: number; width?: number; clientHeight?: number; height?: number } }
      const viewport = result.cssLayoutViewport || result.cssViewport || {}
      if (Number.isFinite(viewport.clientWidth ?? viewport.width)) session.viewportW = (viewport.clientWidth ?? viewport.width!) as number
      if (Number.isFinite(viewport.clientHeight ?? viewport.height)) session.viewportH = (viewport.clientHeight ?? viewport.height!) as number
    } catch { /* ignore */ }
    return session
  }

  async call(targetId: string, method: string, params: unknown = {}, timeoutMs = 6000): Promise<unknown> {
    const session = await this.ensure(targetId)
    return this.cdp.call(method, params, session.sessionId, timeoutMs)
  }

  async sendInput(targetId: string, payload: Record<string, unknown> | null): Promise<{ ok: boolean; error?: string }> {
    const { type, x, y, button = 'left', buttons = 0, deltaX = 0, deltaY = 0, clickCount = 0, modifiers = 0 } = payload || {} as Record<string, unknown>
    if (type === 'mouseMoved') {
      await this.call(targetId, 'Input.dispatchMouseEvent', { type, x, y, buttons })
    } else if (type === 'mousePressed' || type === 'mouseReleased') {
      await this.call(targetId, 'Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount, modifiers })
    } else if (type === 'mouseWheel') {
      await this.call(targetId, 'Input.dispatchMouseEvent', { type, x, y, deltaX, deltaY })
    } else if (type === 'insertText') {
      const text = typeof (payload as { text?: unknown })?.text === 'string' ? (payload as { text: string }).text : ''
      if (text === '' || text.length > 10000) return { ok: false, error: 'text must contain 1-10000 characters' }
      await this.call(targetId, 'Input.insertText', { text })
    } else if (type === 'keyDown' || type === 'keyUp') {
      const key = typeof (payload as { key?: unknown })?.key === 'string' ? (payload as { key: string }).key.slice(0, 64) : ''
      const code = typeof (payload as { code?: unknown })?.code === 'string' ? (payload as { code: string }).code.slice(0, 64) : ''
      if (!key) return { ok: false, error: 'key is required' }
      const virtualKeyCode = Number.isInteger((payload as { windowsVirtualKeyCode?: unknown }).windowsVirtualKeyCode) ? (payload as { windowsVirtualKeyCode: number }).windowsVirtualKeyCode : 0
      await this.call(targetId, 'Input.dispatchKeyEvent', {
        type,
        key,
        code,
        modifiers,
        autoRepeat: !!(payload as { autoRepeat?: unknown }).autoRepeat,
        windowsVirtualKeyCode: virtualKeyCode,
        nativeVirtualKeyCode: virtualKeyCode,
        ...(type === 'keyDown' && key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
      })
    } else {
      return { ok: false, error: `unsupported input type: ${type}` }
    }
    return { ok: true }
  }

  async dispose(): Promise<void> {
    this.detachDestroyed?.()
    const current = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.allSettled(current.map((session) =>
      this.cdp.call('Target.detachFromTarget', { sessionId: session.sessionId }),
    ))
  }
}

interface CdpConfig {
  cdpQuality: number
  cdpMaxWidth: number
  cdpFps: number
  cdpBackstopIntervalMs: number
}

interface CurrentCapture {
  targetId: string
  sessionId: string
  lastFrameAt: number
  startedAt: number
}

export interface CdpCaptureBackendOptions {
  cdp: CdpClient
  sessions: TargetSessions
  getConfig: () => CdpConfig
  onStatus: (status: Record<string, unknown>) => void
  onJpegFrame: (frame: JpegFrame) => void
  /** Lightpanda backend — wire format for screencast + backstop shots. Default 'jpeg' (= pre-Lightpanda behavior). */
  imageFormat?: 'jpeg' | 'png'
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout
  clearTimer?: (timer: NodeJS.Timeout) => void
}

/**
 * Multi-target CDP capture backend (#15).
 *
 * One screencast session PER watched target: several watch leases pointing at
 * different tabs each keep their own `Page.startScreencast` stream, and none of
 * them stops the others. Multiple leases on the SAME targetId are collapsed by
 * the manager into one entry here (derived set, no reference counting — D7).
 * `stopTarget` removes exactly one; `stop` clears everything.
 */
export class CdpCaptureBackend {
  cdp: CdpClient
  sessions: TargetSessions
  getConfig: () => CdpConfig
  onStatus: (status: Record<string, unknown>) => void
  onJpegFrame: (frame: JpegFrame) => void
  imageFormat: 'jpeg' | 'png'
  now: () => number
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout
  clearTimer: (timer: NodeJS.Timeout) => void
  /** targetId → live capture state. The multi-target replacement for `current`. */
  captures: Map<string, CurrentCapture>
  /** targetId → newest undelivered frame (per-target pacing). */
  pendingFrames: Map<string, JpegFrame>
  /** targetId → throttle timer for that target's next flush. */
  sendTimers: Map<string, NodeJS.Timeout>
  /** targetId → timestamp of the last frame actually delivered. */
  lastSentAt: Map<string, number>
  /** Single shared backstop timer: one tick screenshots every stale target. */
  backstopTimer: NodeJS.Timeout | null
  metrics: { sourceFrames: number; sentFrames: number; droppedFrames: number; ackErrors: number; targets: number }
  offFrame: (() => void) | null
  offDestroyed: (() => void) | null

  constructor({ cdp, sessions, getConfig, onStatus, onJpegFrame, imageFormat = 'jpeg', now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }: CdpCaptureBackendOptions) {
    this.cdp = cdp
    this.sessions = sessions
    this.getConfig = getConfig
    this.onStatus = onStatus
    this.onJpegFrame = onJpegFrame
    this.imageFormat = imageFormat
    this.now = now
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.captures = new Map()
    this.pendingFrames = new Map()
    this.sendTimers = new Map()
    this.lastSentAt = new Map()
    this.backstopTimer = null
    this.metrics = { sourceFrames: 0, sentFrames: 0, droppedFrames: 0, ackErrors: 0, targets: 0 }
    this.offFrame = cdp.on('Page.screencastFrame', (params: unknown, targetSessionId?: string) => this.#onFrame(params as Record<string, unknown>, targetSessionId))
    this.offDestroyed = sessions.onDestroyed?.((targetId: string) => {
      if (!this.captures.has(targetId)) return
      const remaining = this.captures.size - 1
      this.stopTarget(targetId, 'target-destroyed').then(() => {
        // Only a GLOBAL failure state when this was the last target: one tab
        // closing under multi-watch must not tear down the other watchers.
        if (remaining > 0) return
        this.onStatus({ backend: 'cdp', state: 'failed', targetId, code: 'capture-target-destroyed', message: 'The watched target was closed' })
      }).catch(() => {
        /* ignore */
      })
    })
  }

  /** Reverse lookup: which watched target owns this flattened session id. */
  #captureBySession(targetSessionId?: string): CurrentCapture | null {
    if (!targetSessionId) return null
    for (const capture of this.captures.values()) {
      if (capture.sessionId === targetSessionId) return capture
    }
    return null
  }

  /** All currently-watched target ids (manager derives the desired set from leases). */
  targetIds(): string[] {
    return [...this.captures.keys()]
  }

  async start({ targetId }: { targetId: string }): Promise<void> {
    // Idempotent per target: the second lease on the same tab must NOT restart
    // (and must NOT stop anything else — that was the #15 freeze mechanism).
    if (this.captures.has(targetId)) return
    const session = await this.sessions.ensure(targetId)
    const config = this.getConfig()
    this.captures.set(targetId, { targetId, sessionId: session.sessionId, lastFrameAt: 0, startedAt: this.now() })
    this.metrics.targets = this.captures.size
    this.onStatus({ backend: 'cdp', state: 'starting', targetId })
    try {
      await this.cdp.call('Page.startScreencast', {
        format: this.imageFormat,
        // quality is a JPEG-only knob; Lightpanda rejects the call outright,
        // so the png projection never sends it (capabilities single decision).
        ...(this.imageFormat === 'jpeg' ? { quality: config.cdpQuality } : {}),
        maxWidth: config.cdpMaxWidth,
        everyNthFrame: 1,
      }, session.sessionId)
      this.onStatus({ backend: 'cdp', state: 'streaming', targetId, metrics: this.metrics })
      this.#scheduleBackstop()
    } catch (error) {
      this.captures.delete(targetId)
      this.metrics.targets = this.captures.size
      this.onStatus({ backend: 'cdp', state: 'failed', targetId, code: 'cdp-start-failed', message: (error as Error).message })
      throw error
    }
  }

  /** Keep legacy single-target shape for callers that only know "switch". */
  async switchTarget({ targetId }: { targetId: string }): Promise<void> {
    this.onStatus({ backend: 'cdp', state: 'switching', targetId })
    await this.start({ targetId })
  }

  async updateConfig(): Promise<void> {
    // Restart every live screencast so format/quality/fps apply to all targets.
    for (const targetId of this.captures.keys()) {
      const capture = this.captures.get(targetId)!
      await this.cdp.call('Page.stopScreencast', {}, capture.sessionId).catch(() => { /* ignore */ })
      const config = this.getConfig()
      try {
        await this.cdp.call('Page.startScreencast', {
          format: this.imageFormat,
          ...(this.imageFormat === 'jpeg' ? { quality: config.cdpQuality } : {}),
          maxWidth: config.cdpMaxWidth,
          everyNthFrame: 1,
        }, capture.sessionId)
      } catch (error) {
        this.captures.delete(targetId)
        this.metrics.targets = this.captures.size
        this.onStatus({ backend: 'cdp', state: 'failed', targetId, code: 'cdp-start-failed', message: (error as Error).message })
      }
    }
  }

  /** Stop exactly one target's screencast; the others keep streaming. */
  async stopTarget(targetId: string, reason = 'stopped'): Promise<void> {
    this.#clearSendTimer(targetId)
    this.pendingFrames.delete(targetId)
    const capture = this.captures.get(targetId)
    if (!capture) return
    this.captures.delete(targetId)
    this.lastSentAt.delete(targetId)
    this.metrics.targets = this.captures.size
    await this.cdp.call('Page.stopScreencast', {}, capture.sessionId).catch(() => { /* ignore */ })
    this.onStatus({ backend: 'cdp', state: this.captures.size > 0 ? 'streaming' : 'idle', targetId: this.captures.size > 0 ? targetId : null, message: reason, metrics: this.metrics })
  }

  async stop(reason = 'stopped'): Promise<void> {
    for (const targetId of [...this.captures.keys()]) {
      this.#clearSendTimer(targetId)
      const capture = this.captures.get(targetId)!
      this.captures.delete(targetId)
      this.lastSentAt.delete(targetId)
      await this.cdp.call('Page.stopScreencast', {}, capture.sessionId).catch(() => { /* ignore */ })
    }
    this.pendingFrames.clear()
    this.metrics.targets = 0
    if (this.backstopTimer) {
      this.clearTimer(this.backstopTimer)
      this.backstopTimer = null
    }
    if (this.lastSentAt.size === 0) {
      this.onStatus({ backend: 'cdp', state: 'idle', targetId: null, message: reason, metrics: this.metrics })
    }
  }

  status(): Record<string, unknown> {
    return {
      backend: 'cdp',
      state: this.captures.size > 0 ? 'streaming' : 'idle',
      // Legacy single-value field: the most recently STARTED target. New
      // readers must consume `targetIds` instead (FR7).
      targetId: this.captures.size > 0 ? [...this.captures.keys()][this.captures.size - 1] : null,
      targetIds: this.targetIds(),
      metrics: { ...this.metrics },
    }
  }

  dispose(): void {
    this.offFrame?.()
    this.offFrame = null
    this.offDestroyed?.()
    this.offDestroyed = null
    if (this.backstopTimer) {
      this.clearTimer(this.backstopTimer)
      this.backstopTimer = null
    }
  }

  #clearSendTimer(targetId: string): void {
    const timer = this.sendTimers.get(targetId)
    if (timer) {
      this.clearTimer(timer)
      this.sendTimers.delete(targetId)
    }
  }

  async #onFrame(params: Record<string, unknown>, targetSessionId?: string): Promise<void> {
    // Correctness core of multi-target (#15): a frame only belongs to the
    // watched target whose flattened session carried it. Unknown sessions are
    // dropped outright — that is what keeps A's panel free of B's pixels.
    const capture = this.#captureBySession(targetSessionId)
    if (!capture) return
    this.metrics.sourceFrames += 1
    if (params.sessionId === undefined || params.sessionId === null) {
      this.metrics.ackErrors += 1
    } else {
      this.cdp.call('Page.screencastFrameAck', { sessionId: params.sessionId }, targetSessionId).catch((error: Error) => {
        this.metrics.ackErrors += 1
        this.onStatus({ backend: 'cdp', state: 'streaming', targetId: capture.targetId, code: 'cdp-ack-failed', message: error.message, metrics: this.metrics })
      })
    }
    if (!params.data) return
    const metadata = (params.metadata || {}) as { visibleViewportWidth?: number; visibleViewportHeight?: number }
    const session = this.sessions.get(capture.targetId)
    if (session) {
      if (Number.isFinite(metadata.visibleViewportWidth)) session.viewportW = metadata.visibleViewportWidth!
      if (Number.isFinite(metadata.visibleViewportHeight)) session.viewportH = metadata.visibleViewportHeight!
    }
    this.pendingFrames.set(capture.targetId, {
      targetId: capture.targetId,
      data: params.data as string,
      vw: session?.viewportW || null,
      vh: session?.viewportH || null,
      ts: this.now(),
    })
    capture.lastFrameAt = this.now()
    const minGap = 1000 / this.getConfig().cdpFps
    const last = this.lastSentAt.get(capture.targetId) || 0
    const delay = Math.max(0, minGap - (this.now() - last))
    if (delay === 0) this.#flushLatest(capture.targetId)
    else if (!this.sendTimers.has(capture.targetId)) this.sendTimers.set(capture.targetId, this.setTimer(() => this.#flushLatest(capture.targetId), delay))
    if (delay > 0) this.metrics.droppedFrames += 1
  }

  #flushLatest(targetId: string): void {
    this.sendTimers.delete(targetId)
    const frame = this.pendingFrames.get(targetId)
    this.pendingFrames.delete(targetId)
    const capture = this.captures.get(targetId)
    if (!frame || !capture) return
    this.lastSentAt.set(targetId, this.now())
    this.metrics.sentFrames += 1
    this.onJpegFrame(frame)
  }

  /** One shared timer: every tick, screenshot each target whose frames stalled. */
  #scheduleBackstop(): void {
    if (this.backstopTimer) return
    const interval = this.getConfig().cdpBackstopIntervalMs
    this.backstopTimer = this.setTimer(async () => {
      this.backstopTimer = null
      const stale = [...this.captures.values()].filter((capture) => this.now() - capture.lastFrameAt >= interval)
      for (const capture of stale) {
        try {
          const session = await this.sessions.updateViewport(capture.targetId)
          const scale = session.viewportW! > this.getConfig().cdpMaxWidth ? this.getConfig().cdpMaxWidth / session.viewportW! : 1
          const result = await this.cdp.call('Page.captureScreenshot', {
            format: this.imageFormat,
            ...(this.imageFormat === 'jpeg' ? { quality: this.getConfig().cdpQuality } : {}),
            captureBeyondViewport: false,
            ...(session.viewportW && session.viewportH ? { clip: { x: 0, y: 0, width: session.viewportW, height: session.viewportH, scale } } : {}),
          }, capture.sessionId) as { data?: string }
          if (result.data) this.onJpegFrame({ targetId: capture.targetId, data: result.data, vw: session.viewportW, vh: session.viewportH, ts: this.now(), backstop: true })
        } catch { /* ignore */ }
      }
      if (this.captures.size > 0) this.#scheduleBackstop()
    }, interval)
  }
}
