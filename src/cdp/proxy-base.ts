/**
 * src/cdp/proxy-base.ts — the HTTP face of a CDP PROXY.
 *
 * A remote attach hands over only a WebSocket URL. Proxies (CloakBrowser and
 * friends) serve `/json/*` under the SAME path the socket lives on, so the
 * DevTools HTTP base is derivable without asking anybody:
 *
 *   wss://host/api/profiles/<id>/cdp  →  https://host/api/profiles/<id>/cdp
 *   ws://host:9222/devtools/browser/x →  http://host:9222/devtools/browser/x
 *
 * Two rules matter: swap the scheme (ws→http, wss→https) and keep the path that
 * the PROXY was mounted under — but DROP a plain DevTools socket path, because
 * for those the HTTP face is the origin itself:
 *
 *   wss://host/api/profiles/x/cdp   → https://host/api/profiles/x/cdp + /json/list
 *   ws://127.0.0.1:9337/devtools/browser/<uuid>
 *                                   → http://127.0.0.1:9337 + /json/list
 *
 * That second case is not hypothetical: appending `/json/list` to the DevTools
 * socket path yields 404, the observation silently degrades, and the panel looks
 * like it has no foreground at all. Unparseable input returns null; this never
 * throws, because it runs inside a 1 s snapshot tick.
 *
 * Lives here (not in the worker) so it can be unit-tested: importing the worker
 * module starts the worker.
 */

export function proxyBase(wsUrl: string): string | null {
  const raw = String(wsUrl ?? '').trim()
  if (raw === '') return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null
    const scheme = url.protocol === 'wss:' ? 'https:' : 'http:'
    // A bare DevTools socket (`/devtools/browser/<id>`, `/devtools/page/<id>`)
    // has no HTTP prefix of its own: the DevTools HTTP server is the origin.
    const devtoolsAt = url.pathname.indexOf('/devtools/')
    const path = devtoolsAt >= 0 ? url.pathname.slice(0, devtoolsAt) : url.pathname
    return `${scheme}//${url.host}${path.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}