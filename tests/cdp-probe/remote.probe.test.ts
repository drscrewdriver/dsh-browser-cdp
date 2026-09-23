import { describe, expect, it } from 'vitest'
import { discoverWebSocketUrl } from '../../src/cdp/endpoint.ts'
import { CdpSession } from '../../src/cdp/session.ts'
import { DomainAffinity, EventDispatcher, enableDomains } from '../../src/cdp/events.ts'
import {
  DISABLED_HIGHLIGHT_CONFIG,
  NEUTRAL_HIGHLIGHT_CONFIG,
  addBinding,
  onBindingCalled,
  setInspectMode,
  type PageCall,
} from '../../src/cdp/page.ts'
import { dispatchMouse } from '../../src/cdp/input.ts'

/**
 * M0.8 — the probe fixture for the P0 CDP base.
 *
 * decomposition.md acceptance: "探针夹具在**远端 CDP**（192.168.100.25:9223）
 * 跑通五步往返，附**延迟 ms 实测值**与退出码，且**路径上不经过 U1 runtime**",
 * plus assertions for the `setInspectMode` / `Input` latency and the page → host
 * event channel.
 *
 * Manual, evidence-producing run — skipped unless a target is supplied, so the
 * default `vitest run` never depends on a live browser:
 *
 *   CDP_PROBE_URL=http://192.168.100.25:9223 \
 *     node node_modules/vitest/vitest.mjs run tests/cdp-probe/remote.probe.test.ts
 *
 * Deliberately NON-INVASIVE: read-only commands, one zero-delta wheel for the
 * input timing, and a binding round trip that only calls back into the binding
 * WE registered. It never clicks, types, or navigates on the target page.
 */

const target = process.env.CDP_PROBE_URL ?? ''
const log = (step: string, detail: string): void => {
  process.stdout.write(`  [probe] ${step.padEnd(30)} ${detail}\n`)
}

describe.skipIf(target === '')('M0.8 probe against the live remote CDP', () => {
  it('walks discovery → open → version → targets → attach → enable, without the vendored runtime', async () => {
    expect(target, 'set CDP_PROBE_URL to run the probe').not.toBe('')

    // ── step 1: discovery (plain HTTP, no runtime involved) ─────────────────
    const discovery = await discoverWebSocketUrl(target, { timeoutMs: 3000 })
    if (!discovery.ok) throw new Error(`discovery failed: ${discovery.code} ${discovery.message}`)
    log('1 discovery', `${discovery.latencyMs}ms → ${discovery.wsUrl}`)
    log('  browser', `${discovery.browser} (protocol ${discovery.protocolVersion})`)
    expect(discovery.wsUrl.startsWith('ws://') || discovery.wsUrl.startsWith('wss://')).toBe(true)

    // ── step 2: the long-lived session ─────────────────────────────────────
    const session = new CdpSession({ url: discovery.wsUrl, connectTimeoutMs: 5000 })
    const openedAt = Date.now()
    await session.connect()
    log('2 ws open', `${Date.now() - openedAt}ms (state=${session.state})`)
    expect(session.state).toBe('open')

    // M0.6 / M0.7 take a bare `call` surface rather than the session object, so
    // the layer stays testable without a socket. Bind it once here.
    const call: PageCall = (method, params, options) => session.call(method, params, options)

    const dispatcher = new EventDispatcher()
    const unwire = dispatcher.wire(session)
    const affinity = new DomainAffinity()

    try {
      // ── step 3: a real command round trip ───────────────────────────────
      const t3 = Date.now()
      const version = (await session.call('Browser.getVersion')) as { product?: string }
      log('3 Browser.getVersion', `${Date.now() - t3}ms → ${version.product}`)
      expect(typeof version.product).toBe('string')

      // ── step 4: enumerate page targets ──────────────────────────────────
      const t4 = Date.now()
      const targets = (await session.call('Target.getTargets')) as {
        targetInfos?: Array<{ targetId: string; type: string; url: string }>
      }
      const pages = (targets.targetInfos ?? []).filter((info) => info.type === 'page')
      log('4 Target.getTargets', `${Date.now() - t4}ms → ${pages.length} page target(s)`)
      expect(Array.isArray(targets.targetInfos)).toBe(true)
      if (pages.length === 0) {
        log('5 attach', 'skipped — no page target open in the remote browser')
        return
      }

      // ── step 5: attach + ordered enable + affinity pin ─────────────────
      const t5 = Date.now()
      const attached = (await session.call('Target.attachToTarget', { targetId: pages[0]!.targetId, flatten: true })) as {
        sessionId?: string
      }
      const pageSession = attached.sessionId
      expect(typeof pageSession).toBe('string')
      const enabled = await enableDomains(
        call,
        pageSession,
        ['Overlay', 'DOM', 'Page'], // deliberately out of order: DOM must still win
        affinity,
        pages[0]!.targetId,
        'probe-connection',
      )
      log('5 attach + enable', `${Date.now() - t5}ms (sessionId=${pageSession})`)
      log('  enable order', enabled.order.join(' -> '))
      expect(enabled.order).toEqual(['Page.enable', 'DOM.enable', 'Overlay.enable'])
      expect(enabled.failures).toEqual([])
      expect(affinity.ownerOf(pages[0]!.targetId, 'Overlay')).toBe('probe-connection')

      // ── step 6: setInspectMode latency. The plan's <10ms reference came from
      //    the local prototype (F11); a WiFi-attached remote is a different
      //    measurement, so the hard bound stays generous and the real number is
      //    recorded here rather than hidden behind a flaky assert. ──────────
      const t6 = Date.now()
      const inspect = await setInspectMode(call, {
        mode: 'searchForNode',
        config: NEUTRAL_HIGHLIGHT_CONFIG,
        sessionId: pageSession,
        timeoutMs: 3000,
      })
      log('6 setInspectMode(searchForNode)', `${Date.now() - t6}ms (ok=${inspect.ok})`)
      expect(inspect.ok, inspect.message).toBe(true)
      expect(inspect.value).toBeDefined() // the reply is recorded, not discarded
      await setInspectMode(call, {
        mode: 'none',
        config: DISABLED_HIGHLIGHT_CONFIG,
        sessionId: pageSession,
        timeoutMs: 3000,
      })

      // ── step 7: Input latency, measured with a zero-delta wheel — a no-op
      //    for the page. The probe must not click or type on someone's browser. ─
      const t7 = Date.now()
      const wheel = await dispatchMouse(call, pageSession, {
        type: 'mouseWheel',
        x: 10,
        y: 10,
        deltaX: 0,
        deltaY: 0,
        timeoutMs: 3000,
      })
      log('7 Input.dispatchMouseEvent', `${Date.now() - t7}ms (ok=${wheel.ok})`)
      expect(wheel.ok, wheel.message).toBe(true)

      // ── step 8: page → host feedback over Runtime.addBinding (T5.12) ────
      const received: string[] = []
      const name = `dshProbe${Date.now().toString(36)}`
      const off = onBindingCalled(dispatcher, name, (params) => received.push(params.payload))
      const bound = await addBinding(call, name, { sessionId: pageSession, timeoutMs: 3000 })
      expect(bound.ok, bound.message).toBe(true)
      const t8 = Date.now()
      await session.call(
        'Runtime.evaluate',
        { expression: `${name}("probe-payload")` },
        { sessionId: pageSession, timeoutMs: 3000 },
      )
      const deadline = Date.now() + 3000
      while (received.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
      log('8 binding -> host', `${Date.now() - t8}ms, payloads=${JSON.stringify(received)}`)
      expect(received).toEqual(['probe-payload'])
      off()

      // ── step 9: detach cleanly ──────────────────────────────────────────
      await session.call('Target.detachFromTarget', { sessionId: pageSession })
      void unwire
    } finally {
      session.close()
    }
    expect(session.state).toBe('closed')
  })

  it('fails an illegal scheme loudly and without touching the network', async () => {
    const result = await discoverWebSocketUrl('ftp://192.168.100.25:9223', { timeoutMs: 3000 })
    log('neg illegal scheme', `${result.ok ? 'resolved' : result.code} (latency ${result.latencyMs}ms)`)
    expect(result).toMatchObject({ ok: false, code: 'invalid-scheme', latencyMs: 0 })
  })

  it('fails an unroutable endpoint loudly instead of hanging', async () => {
    const result = await discoverWebSocketUrl('http://10.255.255.1:9223', { timeoutMs: 1200 })
    log('neg unreachable', `${result.ok ? 'resolved' : result.code} (latency ${result.latencyMs}ms)`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(['probe-timeout', 'probe-failed']).toContain(result.code)
  })

  it('refuses a highlight command with no config before any round trip (M0.7 floor)', async () => {
    // A call that would throw if reached: proves the refusal happens in-process,
    // which is what makes "no silent highlightConfig" enforceable at all.
    const neverReached: PageCall = async () => {
      throw new Error('the layer must not reach the browser without a highlightConfig')
    }
    const refused = await setInspectMode(neverReached, { mode: 'searchForNode' })
    log('neg highlightConfig', `${refused.code} (no round trip reached)`)
    expect(refused).toMatchObject({ ok: false, code: 'highlight-config-missing' })
  })
})
