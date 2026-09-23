/**
 * src/cdp/session.ts — M0.2: one long-lived CDP connection.
 *
 * The reason this module exists: a stateful CDP domain (`DOM`, `Overlay`, …)
 * cannot survive across processes. `ego_cdp` spawns a fresh process per call,
 * so `Overlay.highlightNode` there dies with `Overlay must be enabled before a
 * tool can be shown` (findings F10). Everything that needs sticky protocol
 * state — highlight + screenshot in one breath, inspect-mode events, the R6
 * pick loop — has to run on a connection that STAYS OPEN.
 *
 * What it guarantees:
 *  - command id pairing with a per-command timeout (no promise is ever left
 *    hanging on a dropped frame);
 *  - unexpected close → exponential backoff reconnect, and after every
 *    successful reconnect the `replay` (enable) sequence is re-issued, because
 *    a reopened socket has NO enabled domains and would otherwise fail
 *    *silently* — the one failure mode findings F10 explicitly warns about;
 *  - replay failures are recorded and reported, never swallowed.
 *
 * What it deliberately does NOT do: route commands to different sockets by
 * domain (that is M0.3's stateful-domain affinity) or know any domain's
 * semantics. It moves frames and owns the lifecycle.
 *
 * Zero runtime dependencies: the socket factory is injected, defaulting to the
 * Node 22 global `WebSocket`. Tests inject a fake socket AND fake timers, so no
 * fixture reads a real clock or touches a real network.
 */

export type CdpSessionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

export type CdpSessionErrorCode =
  | 'no-websocket'
  | 'connect-failed'
  | 'connect-timeout'
  | 'socket-error'
  | 'not-open'
  | 'command-timeout'
  | 'closed'
  | 'reconnect-exhausted'

export class CdpSessionError extends Error {
  readonly code: CdpSessionErrorCode
  constructor(code: CdpSessionErrorCode, message: string) {
    super(message)
    this.name = 'CdpSessionError'
    this.code = code
  }
}

/** The slice of a WebSocket this module needs — `ws`, Node's global, and test doubles all satisfy it. */
export interface WebSocketLike {
  send(data: string): void
  close(): void
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    handler: (event: { data?: unknown; message?: string; code?: number; wasClean?: boolean }) => void,
  ): void
}

export interface CdpTimers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export interface ReplayFailure {
  method: string
  message: string
}

export interface CdpSessionOptions {
  url: string
  /** Injected in tests; defaults to the Node 22 global WebSocket. */
  createSocket?: (url: string) => WebSocketLike
  connectTimeoutMs?: number
  commandTimeoutMs?: number
  /** Attempt index (0-based) → delay in ms. Exhausted list = give up. */
  backoffScheduleMs?: readonly number[]
  /** Injected in tests so no fixture reads a real clock. */
  timers?: CdpTimers
  onStateChange?: (state: CdpSessionState, detail?: string) => void
  onReplayError?: (failure: ReplayFailure) => void
}

interface Pending {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: unknown
}

type EventHandler = (params: unknown, sessionId?: string) => void

export const DEFAULT_CONNECT_TIMEOUT_MS = 5000
export const DEFAULT_COMMAND_TIMEOUT_MS = 6000
export const DEFAULT_BACKOFF_SCHEDULE_MS = [250, 500, 1000, 2000, 4000] as const

const DEFAULT_TIMERS: CdpTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function defaultCreateSocket(url: string): WebSocketLike {
  const ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket
  if (ctor === undefined) {
    throw new CdpSessionError(
      'no-websocket',
      'no WebSocket implementation available — the host must supply createSocket (Node >= 22 provides a global WebSocket)',
    )
  }
  return new ctor(url)
}

export class CdpSession {
  readonly url: string
  state: CdpSessionState = 'idle'
  /** Replay failures from the most recent reconnect — surfaced, never swallowed. */
  lastReplayFailures: ReplayFailure[] = []

  #options: Required<Pick<CdpSessionOptions, 'connectTimeoutMs' | 'commandTimeoutMs'>> & CdpSessionOptions
  #timers: CdpTimers
  #socket: WebSocketLike | null = null
  #nextId = 0
  #pending = new Map<number, Pending>()
  #events = new Map<string, Set<EventHandler>>()
  #replay: string[] = []
  #attempt = 0
  #intentionalClose = false
  #reconnectTimer: unknown = null

  constructor(options: CdpSessionOptions) {
    this.url = options.url
    this.#options = {
      ...options,
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      commandTimeoutMs: options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    }
    this.#timers = options.timers ?? DEFAULT_TIMERS
  }

  /**
   * The ordered enable sequence re-issued after every successful (re)connect.
   * M0.3 owns the ordering rules (`DOM.enable` before `Overlay.enable`); this
   * class only replays what it is handed, in the order it is handed.
   */
  setReplay(methods: readonly string[]): void {
    this.#replay = [...methods]
  }

  on(method: string, handler: EventHandler): () => void {
    if (!this.#events.has(method)) this.#events.set(method, new Set())
    this.#events.get(method)!.add(handler)
    return () => {
      this.#events.get(method)?.delete(handler)
    }
  }

  #setState(state: CdpSessionState, detail?: string): void {
    this.state = state
    this.#options.onStateChange?.(state, detail)
  }

  /** Dial and resolve once the socket is open. Rejects with a structured code. */
  connect(): Promise<void> {
    if (this.state === 'open') return Promise.resolve()
    if (this.state === 'closed') {
      return Promise.reject(new CdpSessionError('closed', 'session was closed; create a new one instead of reusing it'))
    }
    this.#setState('connecting')
    return this.#dial(this.#options.connectTimeoutMs)
  }

  #dial(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        this.#timers.clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      }
      const timer = this.#timers.setTimeout(() => {
        this.#teardown()
        finish(new CdpSessionError('connect-timeout', `no CDP open event from ${this.url} within ${timeoutMs}ms`))
      }, timeoutMs)

      let socket: WebSocketLike
      try {
        socket = (this.#options.createSocket ?? defaultCreateSocket)(this.url)
      } catch (error) {
        finish(error instanceof CdpSessionError ? error : new CdpSessionError('connect-failed', String(error)))
        return
      }
      this.#socket = socket

      // Every listener ignores events from a socket that is no longer current:
      // tearing a socket down (reconnect, close) detaches it first, so its own
      // trailing close/error event must not drive a second reconnect.
      socket.addEventListener('open', () => {
        if (settled || this.#socket !== socket) return
        this.#attempt = 0
        this.#setState('open')
        finish()
        void this.#replaySequence()
      })
      socket.addEventListener('message', (event) => {
        if (this.#socket !== socket) return
        this.#handleMessage(event)
      })
      socket.addEventListener('close', () => {
        if (this.#socket !== socket) return
        this.#handleUnexpectedClose('socket closed')
      })
      socket.addEventListener('error', (event) => {
        if (this.#socket !== socket) return
        // An error before `open` is a failed connect, not a dropped session.
        if (!settled) {
          this.#teardown()
          finish(new CdpSessionError('connect-failed', event?.message || `socket error dialing ${this.url}`))
          return
        }
        this.#handleUnexpectedClose(event?.message || 'socket error')
      })
    })
  }

  /**
   * Re-issue the enable sequence. Failures are recorded on
   * `lastReplayFailures` and reported through `onReplayError` — a silently
   * disabled domain is exactly the bug this method exists to prevent.
   */
  async #replaySequence(): Promise<void> {
    if (this.#replay.length === 0) return
    this.lastReplayFailures = []
    for (const method of this.#replay) {
      try {
        await this.call(method, {})
      } catch (error) {
        const failure: ReplayFailure = { method, message: error instanceof Error ? error.message : String(error) }
        this.lastReplayFailures.push(failure)
        this.#options.onReplayError?.(failure)
      }
    }
  }

  #handleMessage(event: { data?: unknown }): void {
    let message: {
      id?: number
      error?: { message?: string; code?: number; data?: unknown }
      result?: unknown
      method?: string
      params?: unknown
      sessionId?: string
    }
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
    } catch {
      return
    }
    if (typeof message.id === 'number' && this.#pending.has(message.id)) {
      const pending = this.#pending.get(message.id)!
      this.#pending.delete(message.id)
      this.#timers.clearTimeout(pending.timer)
      if (message.error) {
        const error = new Error(message.error.message || `CDP error ${message.error.code}`) as Error & {
          code?: number
          data?: unknown
        }
        error.code = message.error.code
        error.data = message.error.data
        pending.reject(error)
      } else {
        pending.resolve(message.result || {})
      }
      return
    }
    if (message.method === undefined) return
    for (const handler of this.#events.get(message.method) || []) {
      try {
        handler(message.params || {}, message.sessionId)
      } catch {
        // One bad consumer must not stop dispatch to the others.
      }
    }
  }

  #handleUnexpectedClose(detail: string): void {
    this.#teardown()
    if (this.#intentionalClose || this.state === 'closed') return
    this.#scheduleReconnect(detail)
  }

  #scheduleReconnect(detail: string): void {
    const schedule = this.#options.backoffScheduleMs ?? DEFAULT_BACKOFF_SCHEDULE_MS
    const attempt = this.#attempt
    if (attempt >= schedule.length) {
      this.#setState('closed', `reconnect exhausted after ${schedule.length} attempts (${detail})`)
      return
    }
    this.#attempt = attempt + 1
    const delay = schedule[attempt]
    this.#setState('reconnecting', `${detail}; retrying in ${delay}ms`)
    this.#reconnectTimer = this.#timers.setTimeout(() => {
      this.#reconnectTimer = null
      this.#dial(this.#options.connectTimeoutMs).catch((error: Error) => {
        // `dial` already reported the failure; keep walking the schedule.
        this.#handleUnexpectedClose(error.message)
      })
    }, delay)
  }

  /** Reject everything in flight and forget the socket. Pending is never left hanging. */
  #teardown(): void {
    const socket = this.#socket
    this.#socket = null
    if (socket) {
      try {
        socket.close()
      } catch {
        // Closing an already-dead socket is not interesting.
      }
    }
    for (const pending of this.#pending.values()) {
      this.#timers.clearTimeout(pending.timer)
      pending.reject(new CdpSessionError('socket-error', `CDP connection closed while ${pending.method} was in flight`))
    }
    this.#pending.clear()
  }

  /**
   * Send one command and await its reply.
   *
   * A call made while the socket is not open fails FAST with `not-open` rather
   * than queueing: a queued command would either run against a freshly
   * reconnected session (wrong domain state) or hang past the caller's own
   * deadline. Callers that can tolerate a reconnect should retry explicitly.
   */
  call(method: string, params: unknown = {}, options: { sessionId?: string; timeoutMs?: number } = {}): Promise<unknown> {
    if (this.#socket === null || this.state !== 'open') {
      return Promise.reject(new CdpSessionError('not-open', `cannot ${method}: session is ${this.state}, not open`))
    }
    const timeoutMs = options.timeoutMs ?? this.#options.commandTimeoutMs
    const id = ++this.#nextId
    const payload: Record<string, unknown> = { id, method, params }
    if (options.sessionId !== undefined) payload.sessionId = options.sessionId
    return new Promise<unknown>((resolve, reject) => {
      const timer = this.#timers.setTimeout(() => {
        this.#pending.delete(id)
        reject(new CdpSessionError('command-timeout', `CDP ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.#pending.set(id, { method, resolve, reject, timer })
      try {
        this.#socket!.send(JSON.stringify(payload))
      } catch (error) {
        this.#timers.clearTimeout(timer)
        this.#pending.delete(id)
        reject(new CdpSessionError('socket-error', error instanceof Error ? error.message : String(error)))
      }
    })
  }

  /** Intentional shutdown: no reconnect, no retry. */
  close(): void {
    this.#intentionalClose = true
    if (this.#reconnectTimer !== null) {
      this.#timers.clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = null
    }
    this.#teardown()
    if (this.state !== 'closed') this.#setState('closed', 'closed by caller')
  }
}
