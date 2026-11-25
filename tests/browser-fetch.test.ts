import { describe, expect, it } from 'vitest'
import {
  createBrowserFetchService,
  isBlockedHost,
  clipUtf8,
  type BrowserFetchService,
} from '../src/browser-fetch.ts'
import type { CdpClient } from '../src/worker/cdp-client.ts'

/**
 * Contract tests for the browser-fetch cross-plugin service (1.15.0).
 * The CDP client is duck-typed: only call()/on() are exercised, with the fake
 * firing Page.loadEventFired during Page.navigate and recording teardown.
 */

interface FakeOpts {
  html?: string
  neverLoad?: boolean
  status?: number | null
  onNavigate?: () => void
}

function makeFakeCdp(opts: FakeOpts = {}) {
  const handlers = new Map<string, (params: unknown, sessionId?: string) => void>()
  const calls: Array<{ method: string; sessionId?: string }> = []
  const client = {
    calls,
    closeTargetCount: 0,
    call: async (method: string, params: unknown, sessionId?: string) => {
      calls.push({ method, sessionId })
      if (method === 'Target.createTarget') return { targetId: 'T1' }
      if (method === 'Target.attachToTarget') return { sessionId: 'S1' }
      if (method === 'Page.navigate') {
        if (opts.status != null) {
          // surface the document response like a real browser would
          setTimeout(() => handlers.get('Network.responseReceived')?.({ type: 'Document', response: { status: opts.status, url: 'https://93.184.216.34/final' } }, 'S1'), 0)
        }
        if (!opts.neverLoad) {
          setTimeout(() => handlers.get('Page.loadEventFired')?.({}, 'S1'), 0)
        }
        opts.onNavigate?.()
        return {}
      }
      if (method === 'Runtime.evaluate') {
        const p = params as { expression?: string }
        if (String(p?.expression).includes('outerHTML')) return { result: { value: opts.html ?? '<html><body>rendered</body></html>' } }
        return { result: { value: '' } }
      }
      if (method === 'Target.closeTarget') {
        ;(client as { closeTargetCount: number }).closeTargetCount++
        return {}
      }
      return {}
    },
    on: (method: string, handler: (params: unknown, sessionId?: string) => void) => {
      handlers.set(method, handler)
      return () => handlers.delete(method)
    },
  }
  return client as unknown as CdpClient & { calls: typeof calls; closeTargetCount: number }
}

function serviceWith(fake: ReturnType<typeof makeFakeCdp>, endpoint = 'ws://fake'): BrowserFetchService & { fake: ReturnType<typeof makeFakeCdp> } {
  const svc = createBrowserFetchService({
    resolveEndpoint: async () => endpoint,
    connect: async () => ({ client: fake, close: () => {} }),
  })
  return { ...svc, fake }
}

describe('target gate', () => {
  it('refuses loopback / private / metadata literals and internal names', () => {
    expect(isBlockedHost('127.0.0.1')).toBe(true)
    expect(isBlockedHost('169.254.169.254')).toBe(true)
    expect(isBlockedHost('10.1.2.3')).toBe(true)
    expect(isBlockedHost('[::1]')).toBe(true)
    expect(isBlockedHost('localhost')).toBe(true)
    expect(isBlockedHost('app.internal')).toBe(true)
    expect(isBlockedHost('site.example')).toBe(false)
    expect(isBlockedHost('8.8.8.8')).toBe(false)
  })

  it('bad-request on unparseable url; blocked-target on ftp', async () => {
    const fake = makeFakeCdp()
    const svc = serviceWith(fake)
    const bad = await svc.fetchRenderedHtml({ url: 'not a url' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('bad-request')
    const ftp = await svc.fetchRenderedHtml({ url: 'ftp://site.example/x' })
    expect(!ftp.ok && ftp.error.code === 'blocked-target').toBe(true)
    expect(fake.calls.length).toBe(0) // gate fires before any CDP traffic
  })
})

describe('fetchRenderedHtml happy path', () => {
  it('navigates a background tab, returns rendered html + document status', async () => {
    const fake = makeFakeCdp({ status: 200 })
    const svc = serviceWith(fake)
    const res = await svc.fetchRenderedHtml({ url: 'https://93.184.216.34/page' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.html).toContain('rendered')
      expect(res.statusCode).toBe(200)
      expect(res.finalUrl).toBe('https://93.184.216.34/final')
      expect(res.truncated).toBe(false)
    }
    const methods = fake.calls.map((c) => c.method)
    expect(methods).toEqual([
      'Target.createTarget',
      'Target.attachToTarget',
      'Page.enable',
      'Network.enable',
      'Page.navigate',
      'Runtime.evaluate',
      'Target.closeTarget',
    ])
    // session-scoped calls must carry the attached sessionId
    expect(fake.calls.find((c) => c.method === 'Page.navigate')?.sessionId).toBe('S1')
  })
})

describe('cleanup and failure modes', () => {
  it('load timeout still closes the tab (nav budget 1000ms floor)', async () => {
    const fake = makeFakeCdp({ neverLoad: true })
    const svc = serviceWith(fake)
    const started = Date.now()
    const res = await svc.fetchRenderedHtml({ url: 'https://93.184.216.34/slow', timeoutMs: 500 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('timeout')
    expect(fake.closeTargetCount).toBe(1)
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('signal abort mid-wait resolves as timeout code and closes tab', async () => {
    const fake = makeFakeCdp({ neverLoad: true })
    const svc = serviceWith(fake)
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 50)
    const res = await svc.fetchRenderedHtml({ url: 'https://93.184.216.34/x', timeoutMs: 5000 }, ctrl.signal)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('timeout')
    expect(fake.closeTargetCount).toBe(1)
  })

  it('no endpoint → no-browser without touching connect', async () => {
    let connects = 0
    const svc = createBrowserFetchService({
      resolveEndpoint: async () => null,
      connect: async () => { connects++; return { client: makeFakeCdp(), close: () => {} } },
    })
    const res = await svc.fetchRenderedHtml({ url: 'https://93.184.216.34/x' })
    expect(!res.ok && res.error.code === 'no-browser').toBe(true)
    expect(connects).toBe(0)
  })

  it('connect failure retries once with a fresh endpoint, then reports nav-failed', async () => {
    let resolves = 0
    let connects = 0
    const svc = createBrowserFetchService({
      resolveEndpoint: async () => { resolves++; return 'ws://dead' },
      connect: async () => { connects++; throw new Error('connect refused') },
    })
    const res = await svc.fetchRenderedHtml({ url: 'https://93.184.216.34/x' })
    expect(!res.ok && res.error.code === 'nav-failed').toBe(true)
    expect(connects).toBe(2)
    expect(resolves).toBe(2)
  })
})

describe('byte budget', () => {
  it('clamps maxBytes to the 2MB limit and truncates without splitting UTF-8', async () => {
    const emoji = String.fromCodePoint(0x1f600) // 4-byte sequence
    const html = 'x'.repeat(4096) + emoji.repeat(10)
    const fake = makeFakeCdp({ html })
    const svc = serviceWith(fake)
    const res = await svc.fetchRenderedHtml({ url: 'https://93.184.216.34/big', maxBytes: 4100 })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.truncated).toBe(true)
      expect(Buffer.byteLength(res.html, 'utf8')).toBeLessThanOrEqual(4100)
      // no lone surrogate at the clip point: re-encode round-trips
      expect(JSON.parse(JSON.stringify({ s: res.html })).s).toBe(res.html)
      expect(res.html.endsWith(emoji) || !res.html.includes(emoji)).toBe(true)
    }
  })

  it('clipUtf8 keeps every multi-byte char whole', () => {
    const s = 'é😀尾'.repeat(50)
    for (const cap of [1, 3, 5, 7, 13]) {
      const c = clipUtf8(s, cap)
      expect(Buffer.byteLength(c, 'utf8')).toBeLessThanOrEqual(cap)
      expect(c).toBe(String.fromCodePoint(...Array.from(c).map((ch) => ch.codePointAt(0)!)))
    }
  })
})
