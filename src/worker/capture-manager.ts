export interface CaptureStatus {
  backend: string
  state: string
  targetId: string | null
  /** Multi-target (#15): every watched target. `targetId` stays = most recently started. */
  targetIds?: string[]
  /** ffmpeg single-stream boundary: only one target can be observed. */
  singleStream?: boolean
  singleStreamReason?: string
  generation: number
  code?: string | null
  message?: string | null
  watchers?: number
  [key: string]: unknown
}

export interface CaptureBackend {
  start(opts: { targetId: string; generation: number }): Promise<void>
  stop(reason: string): Promise<void>
  dispose?(): void | Promise<void>
  /** #15: stop exactly one target; other targets keep streaming. */
  stopTarget?(targetId: string, reason?: string): Promise<void>
  /** #15: all currently-watched target ids. */
  targetIds?(): string[]
}

export type CaptureBackendFactory = (opts: {
  generation: number
  onStatus: (status: Record<string, unknown>) => void
}) => CaptureBackend

interface Lease {
  clientId: string
  backend: string
  targetId: string
  expiresAt: number
}

export interface CaptureManagerOptions {
  backendFactories: Record<string, CaptureBackendFactory>
  getConfig: () => { captureBackend: string; ffmpegFallbackReason?: string }
  onStatus: (status: Record<string, unknown>) => void
  /** Lightpanda backend — false when the attached engine cannot produce pixels (no screencast, no window). No capture loop is started and the status carries `engineUnsupported`. */
  screencastSupported?: boolean
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout
  clearTimer?: (timer: NodeJS.Timeout) => void
  leaseTtlMs?: number
  idleGraceMs?: number
}

export class CaptureManager {
  backendFactories: Record<string, CaptureBackendFactory>
  getConfig: () => { captureBackend: string; ffmpegFallbackReason?: string }
  onStatus: (status: Record<string, unknown>) => void
  screencastSupported: boolean
  now: () => number
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout
  clearTimer: (timer: NodeJS.Timeout) => void
  leaseTtlMs: number
  idleGraceMs: number
  leases: Map<string, Lease>
  backend: CaptureBackend | null
  backendName: string | null
  targetId: string | null
  generation: number
  statusValue: Record<string, unknown>
  transition: Promise<unknown>
  stopTimer: NodeJS.Timeout | null
  sweepTimer: NodeJS.Timeout

  constructor({ backendFactories, getConfig, onStatus, screencastSupported = true, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, leaseTtlMs = 120000, idleGraceMs = 1500 }: CaptureManagerOptions) {
    this.backendFactories = backendFactories
    this.getConfig = getConfig
    this.onStatus = onStatus
    this.screencastSupported = screencastSupported
    this.now = now
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.leaseTtlMs = leaseTtlMs
    this.idleGraceMs = idleGraceMs
    this.leases = new Map()
    this.backend = null
    this.backendName = null
    this.targetId = null
    this.generation = 0
    const fallbackReason = this.getConfig().ffmpegFallbackReason
    this.statusValue = { backend: this.#resolvedBackend(), state: 'idle', targetId: null, generation: 0, ...(fallbackReason ? { code: 'ffmpeg-fallback-cdp', message: fallbackReason } : {}), ...(screencastSupported ? {} : { engineUnsupported: true }) }
    this.transition = Promise.resolve()
    this.stopTimer = null
    this.sweepTimer = this.setTimer(() => this.#sweep(), Math.min(5000, this.leaseTtlMs))
  }

  /**
   * #15 D7 — derive the desired target set from the lease set. NO reference
   * counting: sweep-expired leases, in-place switchWatch retargets and
   * stop/start-on-same-target all collapse into "recompute the set", which
   * cannot leak (counting can: stale counts, orphaned old targets, flash on
   * transient zero).
   */
  #activeTargets(): string[] {
    return [...new Set([...this.leases.values()].map((lease) => lease.targetId))]
  }

  #resolvedBackend(requested?: string): string {
    const value = requested || this.getConfig().captureBackend
    return value === 'auto' ? 'cdp' : value
  }

  async startWatch({ clientId, backend, targetId }: { clientId: string; backend?: string; targetId: string }): Promise<Record<string, unknown>> {
    if (!clientId || !targetId) throw new Error('clientId and targetId are required')
    this.clearTimer(this.stopTimer!)
    this.stopTimer = null
    const requestedBackend = backend || this.getConfig().captureBackend
    this.leases.set(clientId, { clientId, backend: requestedBackend, targetId, expiresAt: this.now() + this.leaseTtlMs })
    return this.#enqueue(async () => { await this.#ensureWatched(this.#resolvedBackend(requestedBackend), this.#activeTargets()); return this.status() })
  }

  async switchWatch({ clientId, targetId }: { clientId: string; targetId: string }): Promise<Record<string, unknown>> {
    const lease = this.leases.get(clientId)
    if (!lease) throw new Error('watch lease not found')
    lease.targetId = targetId
    lease.expiresAt = this.now() + this.leaseTtlMs
    return this.#enqueue(async () => { await this.#ensureWatched(this.#resolvedBackend(lease.backend), this.#activeTargets()); return this.status() })
  }

  async stopWatch({ clientId }: { clientId: string }): Promise<Record<string, unknown>> {
    this.leases.delete(clientId)
    if (this.leases.size === 0 && !this.stopTimer) {
      this.stopTimer = this.setTimer(() => {
        this.stopTimer = null
        if (this.leases.size === 0) this.stop('no-watchers').catch(() => {
          /* ignore */
        })
      }, this.idleGraceMs)
    } else if (this.leases.size > 0) {
      // Some leases remain: diff the derived set immediately so a stopped
      // target's screencast ends without waiting for the grace timer.
      const desiredBackend = this.#resolvedBackend([...this.leases.values()].sort((a, b) => b.expiresAt - a.expiresAt)[0].backend)
      return this.#enqueue(async () => { await this.#ensureWatched(desiredBackend, this.#activeTargets()); return this.status() })
    }
    return this.status()
  }

  async updateConfig(): Promise<void | Record<string, unknown>> {
    const desired = this.#resolvedBackend()
    if (!this.backend) {
      const lease = [...this.leases.values()].sort((a, b) => b.expiresAt - a.expiresAt)[0]
      if (lease) return this.#enqueue(() => this.#ensureWatched(this.#resolvedBackend(lease.backend), this.#activeTargets()))
      const fallbackReason = this.getConfig().ffmpegFallbackReason
      this.#setStatus({ backend: desired, state: 'idle', targetId: null, code: fallbackReason ? 'ffmpeg-fallback-cdp' : null, message: fallbackReason || 'config-updated' })
      return
    }
    return this.#enqueue(() => this.#ensureWatched(desired, this.#activeTargets()))
  }

  async browserDisconnected(): Promise<void> {
    return this.#enqueue(async () => {
      await this.#stopBackend('browser-disconnected')
      this.#setStatus({ backend: this.#resolvedBackend(), state: 'failed', targetId: null, code: 'browser-disconnected', message: 'Browser disconnected' })
    }) as Promise<void>
  }

  async browserConnected(): Promise<void | Record<string, unknown>> {
    if (this.leases.size > 0) return this.#enqueue(() => this.#ensureWatched(this.#resolvedBackend(), this.#activeTargets()))
  }

  /**
   * #15 — keep the backend watching EXACTLY the derived target set.
   * Whole-set diff (D7): one call may both add and remove; per-lease
   * start/stop would leak in that batch. Backend swap (global action) is the
   * only path that tears the whole backend down.
   */
  async #ensureWatched(backendName: string, targetIds: string[]): Promise<void> {
    // Lightpanda backend gate: no screencast methods AND no window means NEITHER
    // backend can produce pixels. Refuse before touching the browser so the
    // observation window never hammers UnknownMethod every N seconds; the
    // status carries `engineUnsupported` for the panel's degraded-view banner.
    if (!this.screencastSupported) {
      await this.#stopBackend('engine-unsupported')
      this.#setStatus({ backend: backendName, state: 'unsupported', targetId: targetIds[0] ?? null, code: 'engine-unsupported', message: 'the attached engine cannot capture frames (no screencast, no window)', engineUnsupported: true })
      return
    }
    // ffmpeg single-stream boundary (C1): only one target observable.
    const effective = backendName === 'ffmpeg' ? targetIds.slice(-1) : targetIds
    if (backendName === 'ffmpeg' && targetIds.length > 1) {
      this.#setStatus({ backend: backendName, singleStream: true, singleStreamReason: 'FFmpeg captures one window stream; only the newest watched target is observed', targetId: effective[0] ?? null, targetIds: effective })
    }
    // Backend swap: tear down and rebuild (factory re-reads config).
    if (this.backend && this.backendName !== backendName) {
      await this.#stopBackend('backend-change')
    }
    if (!this.backend) {
      const factory = this.backendFactories[backendName]
      if (!factory) {
        const message = `${backendName} backend is unavailable`
        this.#setStatus({ backend: backendName, state: 'failed', targetId: effective[0] ?? null, code: 'capture-backend-unavailable', message })
        if (backendName === 'ffmpeg' && this.backendFactories.cdp) {
          await this.#ensureWatched('cdp', targetIds)
          if (this.backend && this.backendName === 'cdp') this.#setStatus({ backend: 'cdp', code: 'ffmpeg-fallback-cdp', message: `FFmpeg unavailable; using CDP: ${message}` })
        }
        return
      }
      try {
        this.backendName = backendName
        this.generation += 1
        const generation = this.generation
        const fallbackReason = backendName === 'cdp' ? this.getConfig().ffmpegFallbackReason : null
        this.#setStatus({ backend: backendName, state: 'starting', targetId: effective[0] ?? null, generation, code: fallbackReason ? 'ffmpeg-fallback-cdp' : null, message: fallbackReason || null })
        let candidate: CaptureBackend
        candidate = factory({ generation, onStatus: (status) => {
          if (this.backend !== candidate || this.generation !== generation) return
          this.#setStatus({ ...status, generation })
        } })
        this.backend = candidate
        for (const targetId of effective) await candidate.start({ targetId, generation })
      } catch (error) {
        const e = error as Error & { code?: string }
        const failed = this.backend
        this.backend = null
        if (failed) {
          await failed.stop?.('start-failed').catch(() => { /* ignore */ })
          await Promise.resolve(failed.dispose?.()).catch(() => { /* ignore */ })
        }
        this.#setStatus({ backend: backendName, state: 'failed', targetId: effective[0] ?? null, generation: this.generation, code: e.code, message: e.message })
        if (backendName === 'ffmpeg' && this.backendFactories.cdp) {
          await this.#ensureWatched('cdp', targetIds)
          if (this.backend && this.backendName === 'cdp') this.#setStatus({ backend: 'cdp', code: 'ffmpeg-fallback-cdp', message: `FFmpeg unavailable; using CDP: ${e.message}` })
        }
      }
      return
    }
    // Same backend alive: diff the set. idempotent start() + per-target
    // stopTarget() mean order does not matter and unchanged targets are
    // untouched (no restart, no flicker).
    const live = new Set(this.backend.targetIds?.() ?? (this.targetId ? [this.targetId] : []))
    for (const targetId of effective) {
      if (!live.has(targetId)) {
        try { await this.backend.start({ targetId, generation: this.generation }) } catch (error) {
          this.#setStatus({ backend: backendName, state: 'failed', targetId, code: (error as { code?: string }).code, message: (error as Error).message })
        }
      }
    }
    if (this.backend.stopTarget) {
      for (const targetId of [...live]) {
        if (!effective.includes(targetId)) await this.backend.stopTarget(targetId, 'lease-set-changed')
      }
    } else if (live.size > 0 && effective.length === 0) {
      await this.#stopBackend('no-watchers')
    }
    if (effective.length === 0) {
      await this.#stopBackend('no-watchers')
      return
    }
    this.targetId = effective[effective.length - 1]
    // Diff path changed the set without going through #setStatus: publish the
    // new focus so status().targetId / targetIds reflect the derived set.
    this.#setStatus({ targetId: this.targetId, targetIds: this.backend.targetIds?.() ?? effective })
  }

  async #activate(backendName: string, targetId: string, force = false): Promise<void> {
    if (!force && this.backend && this.backendName === backendName && this.targetId === targetId) return
    await this.#ensureWatched(backendName, [targetId])
  }

  async #stopBackend(reason = 'stopped'): Promise<void> {
    const backend = this.backend
    this.backend = null
    this.backendName = null
    this.targetId = null
    if (backend) {
      await backend.stop(reason)
      await backend.dispose?.()
    }
    this.#setStatus({ backend: this.#resolvedBackend(), state: 'idle', targetId: null, targetIds: [], generation: this.generation, message: reason })
  }

  stop(reason = 'stopped'): Promise<void> {
    return this.#enqueue(() => this.#stopBackend(reason)) as Promise<void>
  }

  #enqueue<T>(work: () => Promise<T> | T): Promise<T> {
    const run = this.transition.then(work, work) as Promise<T>
    this.transition = run.catch(() => {
      /* ignore */
    })
    return run
  }

  status(): Record<string, unknown> {
    const live = this.backend?.targetIds?.() ?? null
    return { ...this.statusValue, watchers: this.leases.size, ...(live !== null ? { targetIds: live } : {}) }
  }

  #setStatus(status: Record<string, unknown>): void {
    this.statusValue = { ...this.statusValue, ...status }
    this.onStatus(this.status())
  }

  #sweep(): void {
    const now = this.now()
    for (const [clientId, lease] of this.leases) if (lease.expiresAt <= now) this.leases.delete(clientId)
    if (this.leases.size === 0 && this.backend) this.stop('lease-expired').catch(() => {
      /* ignore */
    })
    // D7 — no counting to sync: the next derivation from the remaining leases
    // is automatically correct. Diff now so expired targets stop promptly.
    if (this.leases.size > 0 && this.backend) {
      const desiredBackend = this.#resolvedBackend([...this.leases.values()].sort((a, b) => b.expiresAt - a.expiresAt)[0].backend)
      this.#enqueue(() => this.#ensureWatched(desiredBackend, this.#activeTargets())).catch(() => { /* ignore */ })
    }
    this.sweepTimer = this.setTimer(() => this.#sweep(), Math.min(5000, this.leaseTtlMs))
  }

  async dispose(): Promise<void> {
    this.clearTimer(this.stopTimer!)
    this.clearTimer(this.sweepTimer)
    this.leases.clear()
    await this.stop('disposed')
  }
}
