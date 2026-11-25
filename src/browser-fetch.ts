/**
 * browser-fetch — the plugin's first CROSS-PLUGIN service surface (1.15.0).
 *
 * What it offers: `fetchRenderedHtml({ url })` — navigate a BACKGROUND tab of the
 * agent browser the user already logged into, wait for load, and return the
 * rendered `documentElement.outerHTML` plus the main-document status code. The
 * consumer (dsh-union-search >= 0.13.0) owns all conversion/formatting; this
 * module is transport only.
 *
 * Why a dedicated CDP connection instead of the ego-cli heredoc facade: the
 * facade has `page.evaluate` but no background-tab primitive, and going through
 * the facade would serialize behind the tool/poller lock (a fetch would stall
 * live tool calls). `login-import.ts` already proved the main process can open
 * its own short-lived connection: endpoint authority files (browser.json /
 * launcher.json) → /json/version probe → webSocketDebuggerUrl. One connection
 * per call, tab closed + socket closed in finally — a browser restart between
 * calls is picked up naturally (no stale long-lived socket).
 *
 * Security stance (server-side, no bypass knobs):
 *  - http(s) only; loopback/private/link-local/metadata targets are refused at
 *    both URL literal and DNS-resolution level (rebinding guarded best effort,
 *    same acceptance as union-search's advance_fetch);
 *  - maxBytes clamped to 2MB, html truncated server-side;
 *  - the tab is created with `background: true` and never activated.
 */
import dns from 'node:dns'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createEndpointResolver, type EndpointIO } from './worker/endpoint-authority.ts'
import { defaultLauncherStatePath } from './cdp/launcher.ts'
import { resolveEgoStateDir } from './login-import.ts'
import { CdpClient } from './worker/cdp-client.ts'

// ── contract ─────────────────────────────────────────────────────────────────

export interface FetchRenderedRequest {
  url: string
  /** 'load' (default) waits for Page.loadEventFired; 'idle' adds a settle window. */
  waitUntil?: 'load' | 'idle'
  /** Server-side truncation budget; clamped to [1024, MAX_BYTES_LIMIT]. */
  maxBytes?: number
  /** Navigation+wait budget. Clamped to [1000, 60000]. */
  timeoutMs?: number
}

export interface FetchRenderedOk {
  ok: true
  finalUrl: string
  /** Main-document status; null when Network events never surfaced one. */
  statusCode: number | null
  html: string
  truncated: boolean
}

export type BrowserFetchErrorCode =
  | 'bad-request'
  | 'blocked-target'
  | 'no-browser'
  | 'nav-failed'
  | 'timeout'

export interface FetchRenderedErr {
  ok: false
  error: { code: BrowserFetchErrorCode; message: string }
}

export interface BrowserFetchService {
  fetchRenderedHtml(req: FetchRenderedRequest, signal?: AbortSignal): Promise<FetchRenderedOk | FetchRenderedErr>
}

export const BROWSER_FETCH_SERVICE_NAME = 'browser-fetch'
export const MAX_BYTES_LIMIT = 2 * 1024 * 1024
const DEFAULT_MAX_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 20000
/** settle window for waitUntil:'idle' after load fired. */
const IDLE_SETTLE_MS = 800

// ── target gate ──────────────────────────────────────────────────────────────

/** Loopback/private/reserved literals + well-known internal names → true (refuse). */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  if (h === '') return true
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localdomain') || h.endsWith('.onion')) return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return isPrivateIpV4(h)
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
    if (mapped) return isPrivateIpV4(mapped[1]!)
    const head = h.replace(/[^0-9a-f]/g, '').slice(0, 4)
    const hi = parseInt(head.padEnd(4, '0'), 16)
    if (!Number.isFinite(hi)) return true
    if ((hi & 0xfe00) === 0xfc00) return true // ULA fc00::/7
    if ((hi & 0xffc0) === 0xfe80) return true // link-local fe80::/10
    return false
  }
  return false
}

function isPrivateIpV4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a = 0, b = 0] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a >= 224) return true
  return false
}

/** Returns an explanation when blocked, '' when allowed. */
export async function blockedTargetReason(urlObj: URL): Promise<string> {
  if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') return `unsupported protocol "${urlObj.protocol}"`
  if (isBlockedHost(urlObj.hostname)) return `${urlObj.hostname} is a loopback/private/reserved target`
  try {
    const addrs = await dns.promises.lookup(urlObj.hostname, { all: true })
    for (const a of addrs) {
      if (a.family === 4 ? isPrivateIpV4(a.address) : isBlockedHost(a.address)) {
        return `${urlObj.hostname} resolves to private/reserved address ${a.address}`
      }
    }
  } catch {
    return `cannot resolve ${urlObj.hostname}`
  }
  return ''
}

// ── minimal CDP websocket connect (same shape as login-import's) ────────────

interface WsLike {
  addEventListener(type: string, fn: (...args: unknown[]) => void, opts?: unknown): void
  send(data: string): void
  close(): void
}

export type CdpConn = { client: CdpClient; close: () => void }
export type ConnectFn = (wsUrl: string, timeoutMs: number) => Promise<CdpConn>

export const defaultConnect: ConnectFn = async (wsUrl, timeoutMs) => {
  const WsImpl = (globalThis as { WebSocket?: new (url: string) => WsLike }).WebSocket
  if (!WsImpl) throw new Error('global WebSocket is unavailable (Node >= 22 required)')
  const ws = new WsImpl(wsUrl)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP websocket open timed out: ${wsUrl}`)), timeoutMs)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`CDP websocket connect failed: ${wsUrl}`)) }, { once: true })
  })
  return { client: new CdpClient(ws as never), close: () => { try { ws.close() } catch { /* ignore */ } } }
}

// ── endpoint resolver (main-process assembly of the worker-side factory) ────

export function createMainEndpointResolver(env: NodeJS.ProcessEnv = process.env): () => Promise<string | null> {
  const io: EndpointIO = {
    statMtime: async (p) => { try { return (await fsp.stat(p)).mtimeMs } catch { return -1 } },
    readJson: async (p) => { try { return JSON.parse(await fsp.readFile(p, 'utf8')) as Record<string, unknown> } catch { return null } },
    fetchVersion: async (u) => {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(1000) })
        if (!r.ok) return null
        const j = await r.json() as { webSocketDebuggerUrl?: string }
        return { wsUrl: typeof j.webSocketDebuggerUrl === 'string' ? j.webSocketDebuggerUrl : undefined }
      } catch { return null }
    },
    isAlive: (pid) => { try { process.kill(pid, 0); return true } catch { return false } },
    env: env as Record<string, string | undefined>,
  }
  const stateDir = resolveEgoStateDir(env)
  const resolver = createEndpointResolver(io, {
    browserStatePath: path.join(stateDir, 'browser.json'),
    launcherStatePath: defaultLauncherStatePath(),
  })
  return async () => {
    try {
      const hit = await resolver.resolve()
      return hit?.wsUrl ?? null
    } catch {
      return null
    }
  }
}

// ── service ──────────────────────────────────────────────────────────────────

export interface BrowserFetchDeps {
  resolveEndpoint?: () => Promise<string | null>
  connect?: ConnectFn
}

export function createBrowserFetchService(deps: BrowserFetchDeps = {}): BrowserFetchService {
  const resolveEndpoint = deps.resolveEndpoint ?? createMainEndpointResolver()
  const connect = deps.connect ?? defaultConnect

  async function fetchOnce(wsUrl: string, req: FetchRenderedRequest, budgetMs: number, byteCap: number, signal?: AbortSignal): Promise<FetchRenderedOk | FetchRenderedErr> {
    let conn: CdpConn | null = null
    let targetId: string | null = null
    let sessionId: string | null = null
    try {
      conn = await connect(wsUrl, 5000)
      const client = conn.client
      const created = await client.call('Target.createTarget', { url: 'about:blank', background: true }, undefined, 8000) as { targetId?: string }
      targetId = typeof created?.targetId === 'string' ? created.targetId : null
      if (!targetId) return err('nav-failed', 'Target.createTarget returned no targetId')
      const attached = await client.call('Target.attachToTarget', { targetId, flatten: true }, undefined, 8000) as { sessionId?: string }
      sessionId = typeof attached?.sessionId === 'string' ? attached.sessionId : null
      if (!sessionId) return err('nav-failed', 'Target.attachToTarget returned no sessionId')

      await client.call('Page.enable', {}, sessionId, 5000)
      await client.call('Network.enable', {}, sessionId, 5000)

      let statusCode: number | null = null
      let docUrl: string | null = null
      const offResponse = client.on('Network.responseReceived', (params, sid) => {
        if (sid !== sessionId) return
        const p = params as { type?: string; response?: { status?: number; url?: string } }
        if (p?.type === 'Document' && typeof p.response?.status === 'number') {
          statusCode = p.response.status
          if (typeof p.response.url === 'string') docUrl = p.response.url
        }
      })
      // One-shot load wait, armed BEFORE navigate so a fast load cannot be missed.
      const loadWait = new Promise<'loaded' | 'timeout' | 'aborted'>((resolve) => {
        const t = setTimeout(() => resolve('timeout'), budgetMs)
        const off = client.on('Page.loadEventFired', (_params, sid) => {
          if (sid !== sessionId) return
          clearTimeout(t); off(); resolve('loaded')
        })
        const onAb = () => { clearTimeout(t); off(); resolve('aborted') }
        if (signal?.aborted) { onAb(); return }
        signal?.addEventListener('abort', onAb, { once: true })
      })

      await client.call('Page.navigate', { url: req.url }, sessionId, Math.min(budgetMs, 15000))
      const waited = await loadWait
      offResponse()
      if (waited === 'aborted') return err('timeout', 'aborted while waiting for page load')
      if (waited === 'timeout') return err('timeout', `page load exceeded ${budgetMs}ms`)
      if (req.waitUntil === 'idle') await sleep(IDLE_SETTLE_MS)

      const evaluated = await client.call('Runtime.evaluate', {
        expression: 'document.documentElement ? document.documentElement.outerHTML : ""',
        returnByValue: true,
      }, sessionId, 10000) as { result?: { value?: unknown } }
      const html = typeof evaluated?.result?.value === 'string' ? evaluated.result.value : ''
      if (!html) return err('nav-failed', 'rendered page produced empty DOM')
      const truncated = Buffer.byteLength(html, 'utf8') > byteCap
      return {
        ok: true,
        finalUrl: docUrl ?? req.url,
        statusCode,
        html: truncated ? clipUtf8(html, byteCap) : html,
        truncated,
      }
    } catch (error) {
      return err('nav-failed', error instanceof Error ? error.message : String(error))
    } finally {
      if (conn) {
        if (targetId) { try { await conn.client.call('Target.closeTarget', { targetId }, undefined, 3000) } catch { /* tab may be gone */ } }
        try { conn.close() } catch { /* ignore */ }
      }
    }
  }

  return {
    async fetchRenderedHtml(req, signal) {
      let urlObj: URL
      try {
        urlObj = new URL(String(req?.url ?? ''))
      } catch {
        return err('bad-request', `invalid url: ${String(req?.url).slice(0, 120)}`)
      }
      const blocked = await blockedTargetReason(urlObj)
      if (blocked !== '') return err('blocked-target', blocked)
      const byteCap = Math.min(Math.max(Number(req.maxBytes) || DEFAULT_MAX_BYTES, 1024), MAX_BYTES_LIMIT)
      const budgetMs = Math.min(Math.max(Number(req.timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), 60000)

      // Resolve + connect fresh every call; one endpoint-refresh retry when the
      // first attempt failed at connection level (browser restart, R6).
      let last: FetchRenderedOk | FetchRenderedErr = err('no-browser', 'no endpoint attempt made')
      for (let attempt = 0; attempt < 2; attempt++) {
        const wsUrl = await resolveEndpoint()
        if (wsUrl === null) return err('no-browser', 'no live browser endpoint (state files unprobed) — start the agent browser first')
        try {
          last = await fetchOnce(wsUrl, req, budgetMs, byteCap, signal)
        } catch (error) {
          last = err('nav-failed', error instanceof Error ? error.message : String(error))
        }
        if (last.ok === true) return last
        const code = last.error.code
        // nav-failed covers connect-level deaths; retry once with a fresh endpoint.
        if (code !== 'nav-failed' || attempt === 1 || signal?.aborted) return last
      }
      return last
    },
  }
}

function err(code: BrowserFetchErrorCode, message: string): FetchRenderedErr {
  return { ok: false, error: { code, message: message.slice(0, 300) } }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** UTF-8 safe clip at byteCap without splitting a multi-byte character. */
export function clipUtf8(text: string, byteCap: number): string {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= byteCap) return text
  let end = byteCap
  // walk back over continuation bytes (0b10xxxxxx)
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--
  return buf.subarray(0, end).toString('utf8')
}
