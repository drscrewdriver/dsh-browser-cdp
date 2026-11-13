import { describe, expect, it } from 'vitest'
import { proxyBase } from '../src/cdp/proxy-base.ts'

/**
 * A remote attach gives only a WebSocket URL, so "which tab is in front" has to
 * be asked over HTTP at a base DERIVED from that URL. Two failure modes this
 * pins:
 *   - dropping the path (asking `https://host/json/list` instead of
 *     `https://host/api/profiles/x/cdp/json/list`) — every prefixed proxy 404s;
 *   - keeping the ws/wss scheme (fetch throws on it) — the panel loses its
 *     foreground observation entirely, which is how the remote panel ended up
 *     permanently empty.
 */
describe('proxyBase', () => {
  it('swaps the scheme and keeps a prefixed path', () => {
    expect(proxyBase('wss://host/api/profiles/abc/cdp')).toBe('https://host/api/profiles/abc/cdp')
  })

  it('drops a bare DevTools socket path: the HTTP face is the origin', () => {
    // Found by the local CDP integration probe: appending /json/list to
    // `/devtools/browser/<uuid>` 404s, the observation degrades silently and the
    // panel looks like it has no foreground at all.
    expect(proxyBase('ws://127.0.0.1:9337/devtools/browser/abc')).toBe('http://127.0.0.1:9337')
    expect(proxyBase('ws://127.0.0.1:9337/devtools/page/abc')).toBe('http://127.0.0.1:9337')
  })

  it('trims trailing slashes so /json/list never doubles up', () => {
    expect(proxyBase('wss://host/api/cdp/')).toBe('https://host/api/cdp')
    expect(proxyBase('wss://host/api/cdp//')).toBe('https://host/api/cdp')
  })

  it('never throws on junk (it runs inside the 1s tick)', () => {
    expect(proxyBase('')).toBeNull()
    expect(proxyBase('   ')).toBeNull()
    expect(proxyBase('not a url')).toBeNull()
    // An http(s) URL is not a socket: refuse instead of silently probing it.
    expect(proxyBase('https://host/api/cdp')).toBeNull()
  })
})