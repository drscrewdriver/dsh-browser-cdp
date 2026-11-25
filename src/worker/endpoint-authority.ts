/**
 * Endpoint authority (#20) — who the cast worker should be connected to, RIGHT NOW.
 *
 * The pre-#20 resolver trusted `EGO_LINUX_CDP_URL` as absolute truth. That env
 * is a spawn-time snapshot: when the idle browser closes and a `bcdp_navigate`
 * relaunches it on a new port (40025 → 33253 in the report), the snapshot still
 * points at the OLD port. If an old browser instance is still alive there, the
 * websocket never closes, so the reconnect loop never re-resolves — the panel
 * stays welded to a New Tab of a browser nobody is using (findings F2).
 *
 * Authority is decided by host class, not by a single global order:
 *   - remote env (host is not loopback) → env is the ONLY authority. This is
 *     the #12 path; a loopback probe must never override a remote endpoint.
 *   - local env / no env → state-file candidates (browser.json, launcher.json),
 *     each validated with `/json/version`; env is only a last fallback.
 * Every function here is injectable (fs / net / clock via `EndpointIO`) so the
 * unit tests never touch a real browser; the module itself imports nothing but
 * types — no new runtime dependency.
 */

export interface Candidate {
  /** Numeric loopback port when known; null for a pure ws URL (remote env). */
  port: number | null
  /** Declared ws URL (browser.json carries its own — never re-splice it). */
  wsUrl: string | null
  pid: number | null
  source: 'state' | 'launcher' | 'env'
  /** File mtime ms (state/launcher) or startedAt; recency sort key. */
  fresh: number
  /** Raw wsUrl is already authoritative (remote env): skip /json/version. */
  trustWsUrl?: boolean
}

export interface ResolvedEndpoint {
  wsUrl: string
  port: number | null
  pid: number | null
  /** Identity of the connected instance — see `instanceKey`. */
  instanceKey: string
}

export interface EndpointIO {
  /** File mtime in ms; -1 when the file is absent/unreadable. */
  statMtime: (path: string) => Promise<number>
  /** Parsed JSON object; null on missing file OR bad JSON (never throws). */
  readJson: (path: string) => Promise<Record<string, unknown> | null>
  /** GET a `/json/version`-style URL; {wsUrl} on success, null on ANY failure. */
  fetchVersion: (url: string) => Promise<{ wsUrl?: string } | null>
  /** pid liveness (signal-0 style); used only as a recency hint, never a gate. */
  isAlive: (pid: number) => boolean
  env: Record<string, string | undefined>
}

/** pid:port identity of one browser instance; stable across ws reconnects. */
export function instanceKey(pid: number | null, port: number | null): string {
  return `${pid ?? 'nopid'}:${port ?? 'noport'}`
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]'])

/**
 * Is this host (or ws/http URL host segment) loopback? A proxy-prefixed host
 * segment like "gateway.corp:8443/127.0.0.1" is NOT loopback — that is a remote
 * path and keeps env authority (#12 regression guard).
 */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase())
}

export interface EndpointResolverPaths {
  /** <STATE_DIR>/browser.json — written by the ego-linux runtime. */
  browserStatePath: string
  /** ~/.dsh/cache/dsh-browser-cdp/launcher.json — written by our managed launcher. */
  launcherStatePath: string
}

interface StatePortRecord {
  port: number
  wsUrl: string | null
  pid: number | null
  source: 'state' | 'launcher'
  fresh: number
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

/** browser.json / launcher.json share one shape interest: port + optional ws endpoint + pid. */
function stateRecord(raw: Record<string, unknown> | null, source: 'state' | 'launcher', fresh: number): StatePortRecord | null {
  if (raw === null) return null
  const port = num(raw.port)
  if (port === null) return null
  // launcher.json stores its endpoint as `http://127.0.0.1:<port>`; browser.json
  // stores the real `webSocketDebuggerUrl`. Both are accepted; the probe answer
  // always wins over a re-splice.
  const wsUrl = str(raw.wsUrl) ?? (str(raw.endpoint)?.startsWith('ws') ? str(raw.endpoint) : null)
  return { port, wsUrl, pid: num(raw.pid), source, fresh }
}

/** Parse EGO_LINUX_CDP_URL into a candidate; unparseable (proxy-prefixed) URLs keep env-source with wsUrl only. */
export function envCandidate(env: Record<string, string | undefined>): Candidate | null {
  const raw = env.EGO_LINUX_CDP_URL
  if (!raw) return null
  let parsed: URL | null = null
  try { parsed = new URL(raw) } catch { parsed = null }
  if (parsed === null || !isLoopbackHost(parsed.hostname)) {
    // Remote (or unparseable) env: the ws URL itself is the authority.
    return { port: null, wsUrl: raw, pid: null, source: 'env', fresh: 0, trustWsUrl: true }
  }
  const port = num(Number(parsed.port))
  return { port, wsUrl: raw, pid: null, source: 'env', fresh: 0 }
}

/**
 * Build the resolver bound to one set of state paths. `fingerprint()` lets the
 * 5s watcher skip ALL probing (zero network) while neither mtime nor the
 * recorded port changed; `remoteAuthoritative()` gates the whole watcher off
 * for remote env.
 */
export function createEndpointResolver(io: EndpointIO, paths: EndpointResolverPaths): {
  resolve: () => Promise<ResolvedEndpoint | null>
  fingerprint: () => Promise<string>
  remoteAuthoritative: () => boolean
} {
  const envRemote = (): boolean => {
    const c = envCandidate(io.env)
    return c !== null && c.source === 'env' && c.port === null
  };

  async function collectCandidates(): Promise<Candidate[]> {
    // No network here — pure file/env reads, ordered later by recency.
    const [stateMtime, launcherMtime, stateRaw, launcherRaw] = await Promise.all([
      io.statMtime(paths.browserStatePath),
      io.statMtime(paths.launcherStatePath),
      io.readJson(paths.browserStatePath),
      io.readJson(paths.launcherStatePath),
    ])
    const out: Candidate[] = []
    const state = stateRecord(stateRaw, 'state', stateMtime)
    if (state) out.push({ ...state, fresh: Math.max(stateMtime, state.fresh) })
    const launcher = stateRecord(launcherRaw, 'launcher', launcherMtime)
    // engine === 'lightpanda' rides the SAME /json/version probe — the launcher
    // readiness gate already proved the port speaks DevTools HTTP.
    if (launcher) out.push({ ...launcher, fresh: Math.max(launcherMtime, launcher.fresh) })
    const candidates: Candidate[] = out.map((r) => ({ port: r.port, wsUrl: r.wsUrl, pid: r.pid, source: r.source, fresh: r.fresh }))
    // Live pid first, then freshest file — the record whose process is gone is
    // usually the stale one, but a re-exec browser orphans its pid (issue #19),
    // so this is a sort hint, never an exclusion.
    candidates.sort((a, b) => (Number(io.isAlive(b.pid ?? -1)) - Number(io.isAlive(a.pid ?? -1))) || (b.fresh - a.fresh))
    return candidates
  }

  async function probeCandidate(c: Candidate): Promise<ResolvedEndpoint | null> {
    if (c.trustWsUrl === true && c.wsUrl !== null) {
      return { wsUrl: c.wsUrl, port: c.port, pid: c.pid, instanceKey: instanceKey(c.pid, c.port) }
    }
    if (c.port === null) return null
    const version = await io.fetchVersion(`http://127.0.0.1:${c.port}/json/version`)
    if (version === null) return null
    // 自带 wsUrl 优先，不回拼 (spec §1): the state file's declared URL wins;
    // the probe's answer is only used when the record carries none.
    const wsUrl = c.wsUrl ?? str(version.wsUrl)
    if (wsUrl === null) return null
    return { wsUrl, port: c.port, pid: c.pid, instanceKey: instanceKey(c.pid, c.port) }
  }

  async function resolve(): Promise<ResolvedEndpoint | null> {
    const env = envCandidate(io.env)
    if (env !== null && env.trustWsUrl === true) {
      // #12: remote env is never second-guessed by loopback probes.
      return { wsUrl: env.wsUrl!, port: null, pid: null, instanceKey: instanceKey(null, null) }
    }
    const candidates = await collectCandidates()
    for (const c of candidates) {
      const hit = await probeCandidate(c)
      if (hit !== null) return hit
    }
    // All local candidates dead → env (loopback) as last fallback, probed too:
    // an env port with nothing behind it must not become "truth" again.
    if (env !== null && env.source === 'env') {
      const hit = await probeCandidate(env)
      if (hit !== null) return hit
      // A ws env URL we cannot even name a port for is still better than null
      // when it is the ONLY declared endpoint (pre-#20 behavior).
      if (env.wsUrl !== null && env.port === null) return { wsUrl: env.wsUrl, port: null, pid: null, instanceKey: instanceKey(null, null) }
    }
    return null
  }

  async function fingerprint(): Promise<string> {
    const [a, b, stateRaw, launcherRaw] = await Promise.all([
      io.statMtime(paths.browserStatePath),
      io.statMtime(paths.launcherStatePath),
      io.readJson(paths.browserStatePath),
      io.readJson(paths.launcherStatePath),
    ])
    const state = stateRecord(stateRaw, 'state', a)
    const launcher = stateRecord(launcherRaw, 'launcher', b)
    return `${a}:${state?.port ?? '-'}|${b}:${launcher?.port ?? '-'}`
  }

  return { resolve, fingerprint, remoteAuthoritative: envRemote }
}

// ── foreground pick (F3) ─────────────────────────────────────────────────────

export interface ListPage {
  id: string
  url?: string
}

/** Pages that mean "nothing is being looked at"; ordering around them is what the New Tab bug is. */
export const BLANK_PAGE_URLS = ['chrome://newtab', 'about:blank', 'chrome://startpage', 'edge://newtab', 'data:,']

export function isBlankPageUrl(url: string | undefined): boolean {
  if (!url) return true
  const u = url.trim().toLowerCase()
  return BLANK_PAGE_URLS.includes(u)
}

/**
 * Pick the foreground page from a `/json/list` page set.
 *
 * The old code took the FIRST `type === 'page'` entry and commented it as
 * "the FOREGROUND tab" — the assumption never held: a freshly opened New Tab
 * usually sorts first, so the panel snapped to it (findings F3). Order:
 *   1. the page whose visibilityState === 'visible'   (local only — a remote
 *      proxy cannot answer per-page probes, so callers keep first-page there)
 *   2. the first non-blank page
 *   3. the first page (last resort; a single-tab browser lands here)
 *
 * The getter may be sync (tests, warm cache) or async (one per-target CDP
 * evaluate); every answer is requested up front, so async probes run in
 * parallel and the hot path pays one round-trip, not N.
 */
export async function pickForegroundId(
  pages: readonly ListPage[],
  visibility: (id: string) => string | undefined | Promise<string | undefined>,
): Promise<string | null> {
  if (pages.length === 0) return null
  const seen = await Promise.all(pages.map((p) => Promise.resolve(visibility(p.id)).catch(() => undefined)))
  const hit = pages.findIndex((_, i) => seen[i] === 'visible')
  if (hit >= 0) return pages[hit]!.id
  const real = pages.findIndex((p) => !isBlankPageUrl(p.url))
  return real >= 0 ? pages[real]!.id : pages[0]!.id
}

/**
 * The extra probe field carried by HUMAN_PROBE_JS (#20): visibility rides the
 * SAME Runtime.evaluate as readyState/dpr — zero extra round-trips. Kept as a
 * function so the probe string and the picker test agree on one expression.
 */
export const VISIBILITY_PROBE_JS = 'document.visibilityState'
