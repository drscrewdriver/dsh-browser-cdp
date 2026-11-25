import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createEndpointResolver, envCandidate, instanceKey, isLoopbackHost, type EndpointIO } from '../src/worker/endpoint-authority.ts'

/**
 * #20 — endpoint authority unit tests. Everything the resolver touches
 * (state files, /json/version, pid table, env) is injected; no real browser,
 * no real fs. The worker-side watcher (maybeReplaceEndpoint / 5s interval)
 * lives inside the self-running worker module and is guarded by the source
 * contract at the bottom — same pattern as worker-dispatch.test.ts.
 */

interface FakeOpts {
  files?: Record<string, string>
  mtimes?: Record<string, number>
  livePorts?: number[]
  alivePids?: number[]
  env?: Record<string, string | undefined>
}

const BROWSER = '/state/browser.json'
const LAUNCHER = '/cache/launcher.json'

function fakeIO(opts: FakeOpts): { io: EndpointIO; fetches: string[] } {
  const fetches: string[] = []
  const io: EndpointIO = {
    statMtime: async (p) => (p in (opts.files || {}) ? (opts.mtimes?.[p] ?? 0) : -1),
    readJson: async (p) => {
      const raw = opts.files?.[p]
      if (raw === undefined) return null
      try { return JSON.parse(raw) as Record<string, unknown> } catch { return null }
    },
    fetchVersion: async (u) => {
      fetches.push(u)
      const m = u.match(/127\.0\.0\.1:(\d+)/)
      const port = m ? Number(m[1]) : NaN
      if (!opts.livePorts?.includes(port)) return null
      return { wsUrl: `ws://127.0.0.1:${port}/devtools/browser/${port}` }
    },
    isAlive: (pid) => opts.alivePids?.includes(pid) ?? false,
    env: opts.env ?? {},
  }
  return { io, fetches }
}

const paths = { browserStatePath: BROWSER, launcherStatePath: LAUNCHER }

describe('env candidate parsing', () => {
  it('loopback env keeps a numeric port and competes as a candidate only', () => {
    const c = envCandidate({ EGO_LINUX_CDP_URL: 'ws://127.0.0.1:40025/devtools/browser/abc' })
    expect(c).toMatchObject({ port: 40025, source: 'env' })
    expect(c && 'trustWsUrl' in c).toBe(false)
  })

  it('remote env (non-loopback host) is trusted without probing (#12 guard)', () => {
    const c = envCandidate({ EGO_LINUX_CDP_URL: 'ws://203.0.113.9:9222/devtools/browser/x' })
    expect(c).toMatchObject({ port: null, source: 'env', trustWsUrl: true })
  })

  it('proxy-prefixed host segment counts as remote, not loopback', () => {
    expect(isLoopbackHost('gateway.corp:8443/127.0.0.1')).toBe(false)
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
  })
})

describe('resolveBrowser candidates (spec §1)', () => {
  it('remote env is the only authority — live loopback state does NOT override it', async () => {
    const { io, fetches } = fakeIO({
      files: { [BROWSER]: JSON.stringify({ port: 40025, wsUrl: 'ws://127.0.0.1:40025/devtools/browser/s', pid: 11 }) },
      livePorts: [40025],
      env: { EGO_LINUX_CDP_URL: 'ws://203.0.113.9:9222/devtools/browser/r' },
    })
    const hit = await createEndpointResolver(io, paths).resolve()
    expect(hit).toMatchObject({ wsUrl: 'ws://203.0.113.9:9222/devtools/browser/r', port: null })
    expect(fetches).toHaveLength(0) // no loopback probing at all on the remote path
  })

  it('stale env port yields to the live state-file candidate, and the port travels back', async () => {
    const { io } = fakeIO({
      files: { [BROWSER]: JSON.stringify({ port: 33253, wsUrl: 'ws://127.0.0.1:33253/devtools/browser/new', pid: 22 }) },
      mtimes: { [BROWSER]: 100 },
      alivePids: [22],
      livePorts: [33253],
      env: { EGO_LINUX_CDP_URL: 'ws://127.0.0.1:40025/devtools/browser/old' },
    })
    const hit = await createEndpointResolver(io, paths).resolve()
    // R1 + F4: the NEW port wins and is returned as a NUMBER, so devtoolsBase
    // stays on the local branch (no proxyObserveCache poisoning).
    expect(hit).toMatchObject({ port: 33253, wsUrl: 'ws://127.0.0.1:33253/devtools/browser/new', instanceKey: '22:33253' })
  })

  it('state ports dead → loopback env probed as last fallback', async () => {
    const { io, fetches } = fakeIO({
      files: { [BROWSER]: JSON.stringify({ port: 33253, pid: 22 }), [LAUNCHER]: JSON.stringify({ pid: 33, port: 45333, endpoint: 'http://127.0.0.1:45333', startedAt: 1 }) },
      livePorts: [40025],
      env: { EGO_LINUX_CDP_URL: 'ws://127.0.0.1:40025/devtools/browser/env' },
    })
    const hit = await createEndpointResolver(io, paths).resolve()
    expect(hit).toMatchObject({ port: 40025, instanceKey: 'nopid:40025' })
    expect(fetches).toEqual([
      'http://127.0.0.1:33253/json/version',
      'http://127.0.0.1:45333/json/version',
      'http://127.0.0.1:40025/json/version',
    ])
  })

  it('every source dead → null (the 3s retry semantics stay), and never throws', async () => {
    const { io } = fakeIO({ files: { [BROWSER]: '{broken json' } })
    expect(await createEndpointResolver(io, paths).resolve()).toBeNull()
  })

  it('browser.json without wsUrl uses the probe answer; launcher engine is irrelevant to probing', async () => {
    const { io } = fakeIO({
      files: {
        [BROWSER]: JSON.stringify({ port: 40025, pid: 22 }),
        [LAUNCHER]: JSON.stringify({ pid: 33, port: 39999, endpoint: 'http://127.0.0.1:39999', startedAt: 9, engine: 'lightpanda' }),
      },
      // lightpanda launcher record is fresher (mtime) and answers → connects (#20 R3)
      mtimes: { [BROWSER]: 1, [LAUNCHER]: 2 },
      alivePids: [33],
      livePorts: [39999],
    })
    const hit = await createEndpointResolver(io, paths).resolve()
    expect(hit).toMatchObject({ port: 39999, wsUrl: 'ws://127.0.0.1:39999/devtools/browser/39999', instanceKey: '33:39999' })
  })

  it('live pid sorts ahead of a fresher file with a dead pid', async () => {
    const { io } = fakeIO({
      files: {
        [BROWSER]: JSON.stringify({ port: 40025, pid: 22 }),
        [LAUNCHER]: JSON.stringify({ pid: 33, port: 39999, endpoint: 'http://127.0.0.1:39999', startedAt: 9 }),
      },
      mtimes: { [BROWSER]: 1, [LAUNCHER]: 99 },
      alivePids: [22],
      livePorts: [40025, 39999],
    })
    const hit = await createEndpointResolver(io, paths).resolve()
    expect(hit).toMatchObject({ port: 40025 })
  })

  it('no env at all still resolves through the state files (pure-local launch)', async () => {
    const { io } = fakeIO({
      files: { [BROWSER]: JSON.stringify({ port: 40025, wsUrl: 'ws://127.0.0.1:40025/devtools/browser/x', pid: 22 }) },
      alivePids: [22],
      livePorts: [40025],
    })
    expect(await createEndpointResolver(io, paths).resolve()).toMatchObject({ port: 40025 })
  })
})

describe('fingerprint (spec §2 zero-cost gate)', () => {
  it('repeated calls with unchanged files make zero network requests', async () => {
    const { io, fetches } = fakeIO({ files: { [BROWSER]: JSON.stringify({ port: 40025, pid: 22 }) }, livePorts: [40025] })
    const r = createEndpointResolver(io, paths)
    const a = await r.fingerprint()
    const b = await r.fingerprint()
    expect(a).toBe(b)
    expect(fetches).toHaveLength(0)
  })

  it('a rewritten port changes the fingerprint even when only mtime moved', async () => {
    const files = { [BROWSER]: JSON.stringify({ port: 40025, pid: 22 }) }
    const r1 = createEndpointResolver(fakeIO({ files, mtimes: { [BROWSER]: 1 } }).io, paths)
    const r2 = createEndpointResolver(fakeIO({ files: { [BROWSER]: JSON.stringify({ port: 33253, pid: 22 }) }, mtimes: { [BROWSER]: 2 } }).io, paths)
    expect(await r1.fingerprint()).not.toBe(await r2.fingerprint())
  })

  it('remote env flags the watcher off entirely', async () => {
    const { io } = fakeIO({ env: { EGO_LINUX_CDP_URL: 'ws://10.0.0.8:9222/devtools/browser/r' } })
    expect(createEndpointResolver(io, paths).remoteAuthoritative()).toBe(true)
    const { io: io2 } = fakeIO({ env: { EGO_LINUX_CDP_URL: 'ws://127.0.0.1:9222/devtools/browser/l' } })
    expect(createEndpointResolver(io2, paths).remoteAuthoritative()).toBe(false)
  })
})

describe('instanceKey identity (F2)', () => {
  it('two browsers on two ports never share a key', () => {
    expect(instanceKey(22, 40025)).not.toBe(instanceKey(22, 33253))
    expect(instanceKey(null, null)).toBe('nopid:noport')
  })
})

// ── worker source contract ───────────────────────────────────────────────────

const workerSource = readFileSync(fileURLToPath(new URL('../src/worker/cdp-cast-worker.ts', import.meta.url)), 'utf8')

describe('cast worker endpoint-authority contract (#20)', () => {
  it('env snapshot is no longer treated as truth', () => {
    expect(workerSource).not.toMatch(/if \(process\.env\.EGO_LINUX_CDP_URL\) return \{ wsUrl: process\.env\.EGO_LINUX_CDP_URL, port: null \}/)
    expect(workerSource).toMatch(/createEndpointResolver\(/)
  })

  it('a different instanceKey swaps the connection via ws.close, never on probe miss', () => {
    expect(workerSource).toMatch(/if \(next\.instanceKey === current\) return/)
    expect(workerSource).toMatch(/const next = await resolveBrowser\(\)\s*\n\s*if \(!next\) return/)
    expect(workerSource).toMatch(/endpoint replaced: \$\{current\} -> \$\{next\.instanceKey\}/)
  })

  it('the watcher runs on its own 5s interval and is skipped wholesale for remote env', () => {
    expect(workerSource).toMatch(/setInterval\(\(\) => \{ maybeReplaceEndpoint\(\)/)
    expect(workerSource).toMatch(/if \(endpointResolver\.remoteAuthoritative\(\)\) return/)
  })

  it('foreground pick uses visibility chain locally, first-page remotely (#12 keeps its semantics)', () => {
    expect(workerSource).toMatch(/await pickForegroundId\(pages\.slice\(0, 30\), visibilityOf\)/)
    expect(workerSource).toMatch(/visibilityState=document\.visibilityState/)
  })

  it('spaces rows carry the cached visibility without dropping the old fields', () => {
    expect(workerSource).toMatch(/visibility: probe\?\.visibilityState/)
    expect(workerSource).toMatch(/readyState: probe\?\.readyState, dpr: probe\?\.dpr/)
  })
})
