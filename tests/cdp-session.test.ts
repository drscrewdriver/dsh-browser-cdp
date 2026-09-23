import { describe, expect, it } from 'vitest'
import {
  CdpSession,
  type CdpSessionOptions,
  type CdpTimers,
  type ReplayFailure,
  type WebSocketLike,
} from '../src/cdp/session.ts'

/**
 * M0.2 acceptance (decomposition.md): long connection lifecycle, command id
 * pairing, per-command timeout, and — the part findings F10 makes mandatory —
 * reconnect with backoff that REPLAYS the enable sequence, because a reopened
 * socket has no enabled domains and would otherwise fail silently.
 *
 * Everything here is injected: a fake socket and fake timers. No fixture reads
 * a real clock, opens a real socket, or depends on a dynamic source.
 */

type SocketEvent = { data?: unknown; message?: string; code?: number; wasClean?: boolean }
type SocketHandler = (event: SocketEvent) => void

class FakeSocket implements WebSocketLike {
  readonly sent: Array<{ id: number; method: string; params: unknown }> = []
  closedByUs = false
  #listeners = new Map<string, Set<SocketHandler>>()

  constructor(readonly url: string) {}

  addEventListener(type: 'open' | 'message' | 'close' | 'error', handler: SocketHandler): void {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set())
    this.#listeners.get(type)!.add(handler)
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as { id: number; method: string; params: unknown })
  }

  close(): void {
    this.closedByUs = true
  }

  emit(type: string, event: SocketEvent = {}): void {
    for (const handler of [...(this.#listeners.get(type) ?? [])]) handler(event)
  }

  open(): void {
    this.emit('open', {})
  }

  /** An unexpected drop (the network went away), as opposed to `close()`. */
  drop(): void {
    this.emit('close', { wasClean: false })
  }

  reply(index: number, result: unknown): void {
    this.emit('message', { data: JSON.stringify({ id: this.sent[index]!.id, result }) })
  }

  replyError(index: number, message: string, code = -32000): void {
    this.emit('message', { data: JSON.stringify({ id: this.sent[index]!.id, error: { message, code } }) })
  }

  methods(): string[] {
    return this.sent.map((message) => message.method)
  }
}

function fakeTimers() {
  let sequence = 0
  let now = 0
  const jobs = new Map<number, { fn: () => void; at: number }>()
  const api: CdpTimers = {
    setTimeout: (fn, ms) => {
      const handle = ++sequence
      jobs.set(handle, { fn, at: now + ms })
      return handle
    },
    clearTimeout: (handle) => {
      jobs.delete(handle as number)
    },
  }
  return {
    api,
    /** Run every job due within `ms`, oldest first, keeping `now` coherent. */
    advance(ms: number): void {
      const target = now + ms
      for (let guard = 0; guard < 100; guard += 1) {
        const due = [...jobs.entries()]
          .filter(([, job]) => job.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (due === undefined) break
        jobs.delete(due[0])
        now = Math.max(now, due[1].at)
        due[1].fn()
      }
      now = target
    },
  }
}

/** Let every already-scheduled microtask/macrotask settle. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function harness(options: Partial<CdpSessionOptions> = {}) {
  const sockets: FakeSocket[] = []
  const timers = fakeTimers()
  const session = new CdpSession({
    url: 'ws://192.168.100.25:9223/devtools/browser/220f85d9',
    createSocket: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    timers: timers.api,
    ...options,
  })
  return {
    session,
    sockets,
    timers,
    socket: (): FakeSocket => sockets[sockets.length - 1]!,
    async connected(): Promise<void> {
      const pending = session.connect()
      this.socket().open()
      await pending
    },
  }
}

describe('M0.2 CdpSession lifecycle', () => {
  it('resolves connect on open and exposes the state', async () => {
    const h = harness()
    const pending = h.session.connect()
    expect(h.session.state).toBe('connecting')
    h.socket().open()
    await pending
    expect(h.session.state).toBe('open')
    expect(h.socket().url).toBe('ws://192.168.100.25:9223/devtools/browser/220f85d9')
  })

  it('reports connect-timeout when the socket never opens', async () => {
    const h = harness({ connectTimeoutMs: 1000 })
    const pending = h.session.connect()
    const assertion = expect(pending).rejects.toMatchObject({ code: 'connect-timeout' })
    h.timers.advance(1000)
    await assertion
  })

  it('reports a socket error during dial as connect-failed', async () => {
    const h = harness()
    const pending = h.session.connect()
    h.socket().emit('error', { message: 'ECONNREFUSED' })
    await expect(pending).rejects.toMatchObject({ code: 'connect-failed' })
  })

  it('refuses to reopen a session that was closed', async () => {
    const h = harness()
    await h.connected()
    h.session.close()
    await expect(h.session.connect()).rejects.toMatchObject({ code: 'closed' })
  })
})

describe('M0.2 command pairing and timeouts', () => {
  it('fails fast when the session is not open instead of queueing', async () => {
    const h = harness()
    await expect(h.session.call('Target.getTargets')).rejects.toMatchObject({ code: 'not-open' })
  })

  it('pairs a command id with its reply', async () => {
    const h = harness()
    await h.connected()
    const call = h.session.call('Browser.getVersion')
    expect(h.socket().sent[0]).toMatchObject({ id: 1, method: 'Browser.getVersion', params: {} })
    h.socket().reply(0, { product: 'Chrome/153.0.8010.36' })
    await expect(call).resolves.toEqual({ product: 'Chrome/153.0.8010.36' })
  })

  it('forwards sessionId verbatim for a flat-session command', async () => {
    const h = harness()
    await h.connected()
    void h.session.call('Page.captureScreenshot', { format: 'png' }, { sessionId: 'S-1' })
    expect(h.socket().sent[0]).toMatchObject({ sessionId: 'S-1', params: { format: 'png' } })
  })

  it('times a command out with a structured code', async () => {
    const h = harness({ commandTimeoutMs: 500 })
    await h.connected()
    const call = h.session.call('Overlay.highlightNode')
    const assertion = expect(call).rejects.toMatchObject({ code: 'command-timeout' })
    h.timers.advance(500)
    await assertion
  })

  it('propagates a CDP error reply (code + message + data)', async () => {
    const h = harness()
    await h.connected()
    const call = h.session.call('Overlay.highlightNode')
    h.socket().replyError(0, 'Overlay must be enabled before a tool can be shown')
    await expect(call).rejects.toMatchObject({
      message: 'Overlay must be enabled before a tool can be shown',
      code: -32000,
    })
  })

  it('rejects in-flight commands when the socket drops (nothing hangs)', async () => {
    const h = harness()
    await h.connected()
    const call = h.session.call('Page.captureScreenshot')
    h.socket().drop()
    await expect(call).rejects.toMatchObject({ code: 'socket-error' })
  })

  it('dispatches events to subscribers and isolates a throwing consumer', async () => {
    const h = harness()
    await h.connected()
    const seen: unknown[] = []
    h.session.on('Overlay.inspectNodeRequested', () => {
      throw new Error('consumer blew up')
    })
    h.session.on('Overlay.inspectNodeRequested', (params) => {
      seen.push(params)
    })
    h.socket().emit('message', { data: JSON.stringify({ method: 'Overlay.inspectNodeRequested', params: { backendNodeId: 42 } }) })
    expect(seen).toEqual([{ backendNodeId: 42 }])
  })

  it('ignores a malformed frame instead of tearing the session down', async () => {
    const h = harness()
    await h.connected()
    h.socket().emit('message', { data: 'not json at all' })
    expect(h.session.state).toBe('open')
  })
})

describe('M0.2 reconnect: backoff + enable replay', () => {
  it('reconnects with backoff and replays the enable sequence on the new socket', async () => {
    const states: string[] = []
    const h = harness({ backoffScheduleMs: [250, 500], onStateChange: (state) => states.push(state) })
    h.session.setReplay(['DOM.enable', 'Overlay.enable'])
    await h.connected()

    expect(h.socket().methods()).toEqual(['DOM.enable'])
    h.socket().reply(0, {})
    await flush()
    expect(h.socket().methods()).toEqual(['DOM.enable', 'Overlay.enable'])
    h.socket().reply(1, {})
    await flush()

    const first = h.socket()
    first.drop()
    expect(h.session.state).toBe('reconnecting')
    expect(states).toContain('reconnecting')

    h.timers.advance(250)
    const second = h.socket()
    expect(second).not.toBe(first)
    second.open()
    await flush()
    // Replay is SEQUENTIAL — each enable is awaited before the next is issued,
    // which is what keeps `DOM.enable` ahead of `Overlay.enable`.
    expect(second.methods()).toEqual(['DOM.enable'])
    second.reply(0, {})
    await flush()
    // The reopened socket is re-armed, in order — this is the whole point.
    expect(second.methods()).toEqual(['DOM.enable', 'Overlay.enable'])
    // …and nothing leaked onto the retired socket after the drop.
    expect(first.methods()).toEqual(['DOM.enable', 'Overlay.enable'])
  })

  it('records and reports a failed replay instead of swallowing it', async () => {
    const failures: ReplayFailure[] = []
    const h = harness({ onReplayError: (failure) => failures.push(failure) })
    h.session.setReplay(['Overlay.enable'])
    await h.connected()
    h.socket().replyError(0, 'Overlay must be enabled before a tool can be shown')
    await flush()
    expect(failures).toEqual([
      { method: 'Overlay.enable', message: 'Overlay must be enabled before a tool can be shown' },
    ])
    expect(h.session.lastReplayFailures).toHaveLength(1)
  })

  it('gives up (closed) once the backoff schedule is exhausted', async () => {
    const h = harness({ backoffScheduleMs: [10, 20] })
    await h.connected()
    h.socket().drop()
    h.timers.advance(10)
    h.socket().drop()
    h.timers.advance(20)
    h.socket().drop()
    expect(h.session.state).toBe('closed')
  })

  it('ignores a late event from a socket that is no longer current', async () => {
    const h = harness({ backoffScheduleMs: [10, 20, 30] })
    await h.connected()
    const first = h.socket()
    first.drop()
    h.timers.advance(10)
    const second = h.socket()
    second.open()
    await flush()
    first.drop() // trailing close from the retired socket
    expect(h.sockets).toHaveLength(2)
    expect(h.session.state).toBe('open')
  })

  it('does not reconnect after an intentional close', async () => {
    const h = harness()
    await h.connected()
    const first = h.socket()
    h.session.close()
    expect(h.session.state).toBe('closed')
    expect(first.closedByUs).toBe(true)
    h.timers.advance(60_000)
    expect(h.sockets).toHaveLength(1)
  })
})
