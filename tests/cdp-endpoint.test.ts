import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  discoverWebSocketUrl,
  normalizeEndpoint,
} from '../src/cdp/endpoint.ts'

/**
 * M0.1 acceptance (decomposition.md): `http://host:port` → `GET /json/version`
 * → `webSocketDebuggerUrl`; only `ws` leaves the module; timeout and illegal
 * scheme each carry their own structured code.
 *
 * Every fixture below injects `fetchVersion` and `now`, so nothing here reads a
 * real clock or a real network.
 */

function fixedClock(steps: number[]): () => number {
  let index = 0
  return () => {
    const value = steps[Math.min(index, steps.length - 1)]!
    index += 1
    return value
  }
}

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => payload }
}

describe('M0.1 normalizeEndpoint', () => {
  it('rejects a non-string without guessing', () => {
    expect(normalizeEndpoint(42)).toMatchObject({ ok: false, code: 'invalid-endpoint' })
    expect(normalizeEndpoint(null)).toMatchObject({ ok: false, code: 'invalid-endpoint' })
  })

  it('rejects an empty or whitespace-only endpoint', () => {
    expect(normalizeEndpoint('   ')).toMatchObject({ ok: false, code: 'empty-endpoint' })
  })

  it('rejects a bare host:port (no scheme) rather than guessing one', () => {
    expect(normalizeEndpoint('192.168.100.25:9223')).toMatchObject({ ok: false, code: 'invalid-endpoint' })
  })

  it('rejects a non-CDP scheme', () => {
    expect(normalizeEndpoint('ftp://192.168.100.25:9223')).toMatchObject({ ok: false, code: 'invalid-scheme' })
  })

  it('accepts all four CDP schemes and trims the trailing slash', () => {
    expect(normalizeEndpoint('http://192.168.100.25:9223/')).toEqual({
      ok: true,
      endpoint: 'http://192.168.100.25:9223',
      scheme: 'http',
    })
    expect(normalizeEndpoint('https://host:9223')).toMatchObject({ ok: true, scheme: 'https' })
    expect(normalizeEndpoint('ws://host:9223/devtools/browser/abc')).toMatchObject({ ok: true, scheme: 'ws' })
    expect(normalizeEndpoint('wss://host:9223/devtools/browser/abc')).toMatchObject({ ok: true, scheme: 'wss' })
  })
})

describe('M0.1 discoverWebSocketUrl', () => {
  it('resolves an http endpoint through /json/version', async () => {
    const seen: string[] = []
    const result = await discoverWebSocketUrl('http://192.168.100.25:9223', {
      now: fixedClock([100, 107]),
      fetchVersion: async (target) => {
        seen.push(target)
        return jsonResponse({
          Browser: 'Chrome/153.0.8010.36',
          'Protocol-Version': '1.3',
          webSocketDebuggerUrl: 'ws://192.168.100.25:9223/devtools/browser/220f85d9',
        })
      },
    })
    expect(seen).toEqual(['http://192.168.100.25:9223/json/version'])
    expect(result).toMatchObject({
      ok: true,
      wsUrl: 'ws://192.168.100.25:9223/devtools/browser/220f85d9',
      browser: 'Chrome/153.0.8010.36',
      protocolVersion: '1.3',
      endpoint: 'http://192.168.100.25:9223',
      latencyMs: 7,
    })
  })

  it('dials a ws endpoint directly, without a discovery round-trip', async () => {
    let fetched = 0
    const result = await discoverWebSocketUrl('ws://host:9223/devtools/browser/abc', {
      fetchVersion: async () => {
        fetched += 1
        return jsonResponse({})
      },
    })
    expect(fetched).toBe(0)
    expect(result).toMatchObject({ ok: true, wsUrl: 'ws://host:9223/devtools/browser/abc', latencyMs: 0 })
  })

  it('reports a non-2xx answer as http-status', async () => {
    const result = await discoverWebSocketUrl('http://host:9223', {
      fetchVersion: async () => jsonResponse({}, false, 502),
    })
    expect(result).toMatchObject({ ok: false, code: 'http-status' })
    expect(result.ok === false && result.message).toContain('502')
  })

  it('reports a DevTools-less HTTP endpoint as no-ws-url', async () => {
    const result = await discoverWebSocketUrl('http://host:9223', {
      fetchVersion: async () => jsonResponse({ hello: 'world' }),
    })
    expect(result).toMatchObject({ ok: false, code: 'no-ws-url' })
  })

  it('reports a non-JSON body as bad-json, not as unreachable', async () => {
    const result = await discoverWebSocketUrl('http://host:9223', {
      fetchVersion: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <')
        },
      }),
    })
    expect(result).toMatchObject({ ok: false, code: 'bad-json' })
  })

  it('maps an aborted request to probe-timeout and names the budget', async () => {
    const result = await discoverWebSocketUrl('http://10.255.255.1:9223', {
      timeoutMs: 1500,
      fetchVersion: async () => {
        const error = new Error('aborted')
        error.name = 'TimeoutError'
        throw error
      },
    })
    expect(result).toMatchObject({ ok: false, code: 'probe-timeout' })
    expect(result.ok === false && result.message).toContain('1500ms')
  })

  it('maps any other transport failure to probe-failed', async () => {
    const result = await discoverWebSocketUrl('http://host:9223', {
      fetchVersion: async () => {
        throw new Error('ECONNREFUSED')
      },
    })
    expect(result).toMatchObject({ ok: false, code: 'probe-failed' })
    expect(result.ok === false && result.message).toContain('ECONNREFUSED')
  })

  it('never reaches the network for an invalid endpoint', async () => {
    let fetched = 0
    const result = await discoverWebSocketUrl('ftp://host:9223', {
      fetchVersion: async () => {
        fetched += 1
        return jsonResponse({})
      },
    })
    expect(fetched).toBe(0)
    expect(result).toMatchObject({ ok: false, code: 'invalid-scheme', latencyMs: 0 })
  })

  it('exposes a default discovery budget', () => {
    expect(DEFAULT_DISCOVERY_TIMEOUT_MS).toBe(3000)
  })
})
