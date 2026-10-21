import { describe, expect, it } from 'vitest'
import { discoverWebSocketUrl } from '../../src/cdp/endpoint.ts'
import { CdpSession } from '../../src/cdp/session.ts'
import { EventDispatcher } from '../../src/cdp/events.ts'
import { engineOf } from '../../src/cdp/capabilities.ts'

/**
 * Lightpanda backend probe — the 8 assertions from
 * docs/plans/2026-10-04-lightpanda-backend-analysis.md §11 (+ the Network
 * event set, v2: bcdp_http / bcdp_wait_for_response depend on it).
 *
 * Manual, evidence-producing run — skipped unless a target is supplied, so the
 * default `vitest run` never depends on a live browser:
 *
 *   LP_PROBE_URL=http://127.0.0.1:9222 \
 *     node node_modules/vitest/vitest.mjs run tests/cdp-probe/lightpanda.probe.test.ts
 *
 * Lightpanda runs anywhere CDP-speaking (native Linux/macOS, WSL2, docker) —
 * the probe only sees the endpoint. It creates its OWN target and closes it,
 * and never touches the user's pages.
 */

const target = process.env.LP_PROBE_URL ?? ''
const log = (step: string, detail: string): void => {
  process.stdout.write(`  [lp-probe] ${step.padEnd(34)} ${detail}\n`)
}

/** Wait for one dispatcher event matching `match`, with a wall-clock deadline. */
async function nextEvent(
  dispatcher: EventDispatcher,
  method: string,
  match: (params: Record<string, unknown>) => boolean,
  timeoutMs = 8000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const off = dispatcher.onMethod(method, (params) => {
      if (!match(params as Record<string, unknown>)) return
      off()
      clearTimeout(timer)
      resolve(params as Record<string, unknown>)
    })
    const timer = setTimeout(() => {
      off()
      reject(new Error(`timed out after ${timeoutMs}ms waiting for ${method}`))
    }, timeoutMs)
  })
}

describe.skipIf(target === '')('Lightpanda backend probe (8 assertions)', () => {
  it('walks recognition → navigation → degradation probes on the live engine', async () => {
    expect(target, 'set LP_PROBE_URL to run the probe').not.toBe('')

    // ── 1. recognition: /json/version Browser prefix ─────────────────────────
    const discovery = await discoverWebSocketUrl(target, { timeoutMs: 3000 })
    if (!discovery.ok) throw new Error(`discovery failed: ${discovery.code} ${discovery.message}`)
    log('1 discovery', `${discovery.latencyMs}ms → ${discovery.wsUrl}`)
    log('  browser', `${discovery.browser} (protocol ${discovery.protocolVersion})`)
    expect(engineOf(discovery.browser), `Browser=${discovery.browser}`).toBe('lightpanda')

    const origin = new URL(target).origin
    const session = new CdpSession({ url: discovery.wsUrl, connectTimeoutMs: 5000 })
    await session.connect()
    const dispatcher = new EventDispatcher()
    dispatcher.wire(session)
    try {
      // A throwaway target keeps the probe non-invasive on a shared instance.
      const created = (await session.call('Target.createTarget', { url: 'about:blank' }, { timeoutMs: 8000 })) as {
        targetId?: string
      }
      const targetId = created.targetId ?? ''
      expect(targetId, 'Target.createTarget').not.toBe('')
      const attached = (await session.call(
        'Target.attachToTarget',
        { targetId, flatten: true },
        { timeoutMs: 8000 },
      )) as { sessionId?: string }
      const pageSession = attached.sessionId ?? ''
      expect(pageSession, 'flatten attach').not.toBe('')
      const opt = { sessionId: pageSession, timeoutMs: 8000 }

      try {
        await session.call('Page.enable', {}, opt)

        // ── 2. navigate + lifecycleEvent(load) (LP never sends loadEventFired) ─
        const lifecycle = nextEvent(dispatcher, 'Page.lifecycleEvent', (p) => p.name === 'load')
        await session.call('Page.navigate', { url: `${origin}/json/version` }, opt)
        const load = await lifecycle
        log('2 lifecycleEvent(load)', `arrived for ${String(load.frameId ?? '').slice(0, 8)}…`)
        expect(load.name).toBe('load')

        // ── 3. evaluate / xpath search / AX tree ─────────────────────────────
        const evaluated = (await session.call(
          'Runtime.evaluate',
          { expression: 'document.title + "|" + document.body.innerText.length', returnByValue: true },
          opt,
        )) as { result?: { value?: unknown } }
        log('3 Runtime.evaluate', `→ ${JSON.stringify(evaluated.result?.value)}`)
        expect(evaluated.result).toBeDefined()
        await session.call('DOM.enable', {}, opt)
        const doc = (await session.call('DOM.getDocument', {}, opt)) as { root?: { nodeId?: number } }
        const searched = (await session.call(
          'DOM.performSearch',
          { query: '//html', nodeIds: doc.root ? [doc.root.nodeId!] : [] },
          opt,
        )) as { resultCount?: number }
        log('  DOM.performSearch(//html)', `count=${searched.resultCount}`)
        expect(Number(searched.resultCount ?? 0)).toBeGreaterThan(0)
        const ax = (await session.call('Accessibility.getFullAXTree', {}, opt)) as { nodes?: unknown[] }
        log('  Accessibility.getFullAXTree', `nodes=${ax.nodes?.length ?? 0}`)
        expect(Array.isArray(ax.nodes)).toBe(true)

        // ── 4. screenshot: png renders, jpeg is a structured -32000 ──────────
        const png = (await session.call('Page.captureScreenshot', { format: 'png' }, opt)) as { data?: string }
        log('4 captureScreenshot(png)', `bytes≈${Math.round((png.data?.length ?? 0) * 0.75)}`)
        expect((png.data ?? '').length).toBeGreaterThan(0)
        const jpegError = await session
          .call('Page.captureScreenshot', { format: 'jpeg', quality: 60 }, opt)
          .then(
            () => null,
            (error: Error & { code?: number }) => error,
          )
        log('  captureScreenshot(jpeg)', `code=${(jpegError as { code?: number })?.code} msg=${jpegError?.message}`)
        expect(jpegError, 'jpeg must fail on LP, not silently pass').not.toBeNull()
        expect((jpegError as { code?: number }).code).toBe(-32000)

        // ── 5. cookie round trip (Storage.setCookies/getCookies) ─────────────
        await session.call(
          'Storage.setCookies',
          { cookies: [{ name: 'lpProbe', value: 'ok', url: origin }] },
          opt,
        )
        const jar = (await session.call('Storage.getCookies', {}, opt)) as {
          cookies?: Array<{ name?: string; value?: string }>
        }
        const found = (jar.cookies ?? []).find((cookie) => cookie.name === 'lpProbe')
        log('5 cookies round trip', `→ ${found ? found.value : 'MISSING'}`)
        expect(found?.value).toBe('ok')

        // ── 6. Overlay.enable → structured UnknownMethod, session unharmed ───
        const overlayError = await session
          .call('Overlay.enable', {}, opt)
          .then(
            () => null,
            (error: Error & { code?: number }) => error,
          )
        log('6 Overlay.enable', `code=${(overlayError as { code?: number })?.code} msg=${overlayError?.message}`)
        expect((overlayError as { code?: number })?.code).toBe(-32601)
        const stillAlive = (await session.call('Browser.getVersion', {}, { timeoutMs: 8000 })) as { product?: string }
        log('  session still healthy', `${stillAlive.product}`)
        expect(stillAlive.product).toContain('Lightpanda')

        // ── 7. Input injection ───────────────────────────────────────────────
        await session.call(
          'Input.dispatchMouseEvent',
          { type: 'mouseMoved', x: 4, y: 4, deltaX: 0, deltaY: 0 },
          opt,
        )
        await session.call('Input.insertText', { text: 'x' }, opt)
        log('7 Input injection', 'dispatchMouseEvent + insertText ok')

        // ── 8. Network event set (bcdp_http / wait_for_response dependency) ──
        await session.call('Network.enable', {}, opt)
        const saw = { request: false, response: false, finished: false }
        const offEvents = [
          dispatcher.onMethod('Network.requestWillBeSent', (p) => {
            if ((p as { documentURL?: string }).documentURL !== undefined) saw.request = true
          }),
          dispatcher.onMethod('Network.responseReceived', () => {
            saw.response = true
          }),
          dispatcher.onMethod('Network.loadingFinished', () => {
            saw.finished = true
          }),
        ]
        await session.call('Page.navigate', { url: `${origin}/json/list` }, opt)
        const deadline = Date.now() + 8000
        while (!(saw.request && saw.response && saw.finished) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        for (const off of offEvents) off()
        log('8 Network events', `request=${saw.request} response=${saw.response} finished=${saw.finished}`)
        expect(saw.request && saw.response && saw.finished).toBe(true)

        await session.call('Target.closeTarget', { targetId }, { timeoutMs: 8000 })
      } finally {
        // The throwaway target must not outlive the probe even on failure.
        await session.call('Target.closeTarget', { targetId }, { timeoutMs: 3000 }).catch(() => null)
      }
    } finally {
      session.close()
    }
    expect(session.state).toBe('closed')
  })
})
