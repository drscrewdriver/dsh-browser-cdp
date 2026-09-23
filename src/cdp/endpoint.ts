/**
 * src/cdp/endpoint.ts — M0.1: CDP endpoint resolution.
 *
 * One job: turn whatever the user typed into a `ws://` URL a session can dial,
 * and NEVER guess. `http(s)://host:port` goes through `GET /json/version` →
 * `webSocketDebuggerUrl` (dial-direct for `ws(s)://…`). Every failure path
 * returns a structured code, because a typo must not degrade into an opaque
 * network error three layers down.
 *
 * Acceptance (decomposition.md `M0.1`): only `ws` leaves this module; timeout
 * and illegal scheme each carry their own code. Pure apart from the injectable
 * `fetchVersion` — fixtures use fixed data and never touch a real clock or
 * network, and the error codes are contract (the client maps them to i18n), so
 * they are not renamed casually.
 */

export const ENDPOINT_SCHEMES = ['http', 'https', 'ws', 'wss'] as const

export type EndpointScheme = (typeof ENDPOINT_SCHEMES)[number]

export type CdpErrorCode =
  | 'empty-endpoint'
  | 'invalid-endpoint'
  | 'invalid-scheme'
  | 'probe-timeout'
  | 'probe-failed'
  | 'http-status'
  | 'bad-json'
  | 'no-ws-url'

export interface EndpointOk {
  ok: true
  /** Normalized endpoint exactly as it should be persisted (no trailing slash). */
  endpoint: string
  scheme: EndpointScheme
}

export interface EndpointErr {
  ok: false
  code: CdpErrorCode
  message: string
}

export type EndpointCheck = EndpointOk | EndpointErr

export const DEFAULT_DISCOVERY_TIMEOUT_MS = 3000

/**
 * Validate + normalize a user-supplied endpoint string.
 *
 * Accepts `http(s)://host[:port]` (needs `/json/version` discovery) and
 * `ws(s)://…` (dial-direct). Anything else, including a bare `host:port`, is
 * rejected with an explicit code — guessing a scheme here would turn a typo
 * into a confusing network-level failure later.
 */
export function normalizeEndpoint(raw: unknown): EndpointCheck {
  if (typeof raw !== 'string') return { ok: false, code: 'invalid-endpoint', message: 'endpoint must be a string' }
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, code: 'empty-endpoint', message: 'endpoint is empty' }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, code: 'invalid-endpoint', message: `endpoint is not a valid URL: ${trimmed}` }
  }
  const scheme = url.protocol.replace(/:$/, '') as EndpointScheme
  if (!(ENDPOINT_SCHEMES as readonly string[]).includes(scheme)) {
    return {
      ok: false,
      code: 'invalid-scheme',
      message: `endpoint scheme must be http, https, ws or wss (got "${url.protocol}")`,
    }
  }
  if (url.hostname === '') {
    return { ok: false, code: 'invalid-endpoint', message: `endpoint has no host: ${trimmed}` }
  }
  return { ok: true, endpoint: url.origin + url.pathname.replace(/\/+$/, ''), scheme }
}

/** The minimal `Response` surface discovery needs; `fetch` satisfies it. */
export interface VersionResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export interface DiscoveryOptions {
  timeoutMs?: number
  /** Injected in tests so a fixture never touches the network. */
  fetchVersion?: (target: string, init: { signal: AbortSignal }) => Promise<VersionResponse>
  /** Injected in tests so a fixture never reads a real clock. */
  now?: () => number
}

export interface DiscoveryOk {
  ok: true
  /** The value the user typed, normalized for persistence. */
  endpoint: string
  scheme: EndpointScheme
  /** The only shape this module ever hands to a session. */
  wsUrl: string
  browser: string
  protocolVersion: string
  latencyMs: number
}

export interface DiscoveryErr {
  ok: false
  code: CdpErrorCode
  message: string
  latencyMs: number
}

export type DiscoveryResult = DiscoveryOk | DiscoveryErr

/**
 * Resolve an endpoint to a `ws://` URL.
 *
 * `ws(s)://` is returned unchanged (already a dial target, so there is nothing
 * to discover and a wrong guess is impossible). `http(s)://` is probed over
 * `/json/version`; the discovered uuid changes every time the remote browser
 * restarts, so callers persist the value the user typed, never this.
 */
export async function discoverWebSocketUrl(raw: unknown, options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  const now = options.now ?? (() => Date.now())
  const started = now()
  const elapsed = (): number => Math.max(0, now() - started)

  const check = normalizeEndpoint(raw)
  if (!check.ok) return { ok: false, code: check.code, message: check.message, latencyMs: 0 }

  if (check.scheme === 'ws' || check.scheme === 'wss') {
    return {
      ok: true,
      endpoint: check.endpoint,
      scheme: check.scheme,
      wsUrl: check.endpoint,
      browser: '',
      protocolVersion: '',
      latencyMs: 0,
    }
  }

  const timeoutMs =
    Number.isFinite(options.timeoutMs) && (options.timeoutMs as number) > 0
      ? (options.timeoutMs as number)
      : DEFAULT_DISCOVERY_TIMEOUT_MS
  const target = `${check.endpoint}/json/version`
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    const fetchImpl =
      options.fetchVersion ??
      ((url: string, init: { signal: AbortSignal }) => fetch(url, { signal: init.signal }) as unknown as Promise<VersionResponse>)
    const response = await fetchImpl(target, { signal })
    if (!response.ok) {
      return {
        ok: false,
        code: 'http-status',
        message: `${target} answered HTTP ${response.status}`,
        latencyMs: elapsed(),
      }
    }
    let payload: { webSocketDebuggerUrl?: unknown; Browser?: unknown; 'Protocol-Version'?: unknown }
    try {
      payload = (await response.json()) as typeof payload
    } catch {
      return { ok: false, code: 'bad-json', message: `${target} did not return JSON`, latencyMs: elapsed() }
    }
    const wsUrl = typeof payload.webSocketDebuggerUrl === 'string' ? payload.webSocketDebuggerUrl : ''
    if (wsUrl === '') {
      return {
        ok: false,
        code: 'no-ws-url',
        message: `${target} did not return a webSocketDebuggerUrl (not a DevTools endpoint?)`,
        latencyMs: elapsed(),
      }
    }
    return {
      ok: true,
      endpoint: check.endpoint,
      scheme: check.scheme,
      wsUrl,
      browser: typeof payload.Browser === 'string' ? payload.Browser : '',
      protocolVersion: typeof payload['Protocol-Version'] === 'string' ? payload['Protocol-Version'] : '',
      latencyMs: elapsed(),
    }
  } catch (error) {
    const err = error as { name?: string; message?: string }
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ok: false,
      code: timedOut ? 'probe-timeout' : 'probe-failed',
      message: timedOut
        ? `no answer from ${target} within ${timeoutMs}ms`
        : `endpoint unreachable: ${err?.message ?? String(error)}`,
      latencyMs: elapsed(),
    }
  }
}
