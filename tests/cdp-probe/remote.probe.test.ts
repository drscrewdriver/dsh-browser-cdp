import { describe, expect, it } from 'vitest'
import { discoverWebSocketUrl } from '../../src/cdp/endpoint.ts'
import { CdpSession } from '../../src/cdp/session.ts'

/**
 * M0.8 — the probe fixture for the P0 CDP base.
 *
 * decomposition.md acceptance: "探针夹具在**远端 CDP**（192.168.100.25:9223）
 * 跑通五步往返，附**延迟 ms 实测值**与退出码，且**路径上不经过 U1 runtime**".
 *
 * That is a MANUAL, evidence-producing run, so it is skipped unless a target is
 * supplied — the default `vitest run` must never depend on a live browser or
 * any dynamic source:
 *
 *   CDP_PROBE_URL=http://192.168.100.25:9223 \
 *     node node_modules/vitest/vitest.mjs run tests/cdp-probe/remote.probe.test.ts
 *
 * Note what this file does NOT use: `EGO_LINUX_*`, the vendored runtime, or any
 * `ego_*` tool. The whole path is our own M0.1 + M0.2, which is the point.
 */

const target = process.env.CDP_PROBE_URL ?? ''
const log = (step: string, detail: string): void => {
  process.stdout.write(`  [probe] ${step.padEnd(28)} ${detail}\n`)
}

describe.skipIf(target === '')('M0.8 five-step round trip against the live remote CDP', () => {
  it('walks discovery → open → getVersion → targets → attach+enable without the vendored runtime', async () => {
    expect(target, 'set CDP_PROBE_URL to run the probe').not.toBe('')

    // ── step 1: discovery (no runtime involved, plain HTTP) ──────────────────
    const discovery = await discoverWebSocketUrl(target, { timeoutMs: 3000 })
    expect(discovery.ok, `discovery failed: ${discovery.ok ? '' : discovery.code} ${discovery.ok ? '' : discovery.message}`).toBe(true)
    if (!discovery.ok) return
    log('1 discovery', `${discovery.latencyMs}ms → ${discovery.wsUrl}`)
    log('  browser', `${discovery.browser} (protocol ${discovery.protocolVersion})`)
    expect(discovery.wsUrl.startsWith('ws://') || discovery.wsUrl.startsWith('wss://')).toBe(true)

    // ── step 2: open the long-lived session ────────────────────────────────
    const session = new CdpSession({ url: discovery.wsUrl, connectTimeoutMs: 5000 })
    const openedAt = Date.now()
    await session.connect()
    log('2 ws open', `${Date.now() - openedAt}ms (state=${session.state})`)
    expect(session.state).toBe('open')

    try {
      // ── step 3: a real command round trip ────────────────────────────────
      const t3 = Date.now()
      const version = (await session.call('Browser.getVersion')) as { product?: string; protocolVersion?: string }
      log('3 Browser.getVersion', `${Date.now() - t3}ms → ${version.product}`)
      expect(typeof version.product).toBe('string')

      // ── step 4: enumerate page targets ───────────────────────────────────
      const t4 = Date.now()
      const targets = (await session.call('Target.getTargets')) as {
        targetInfos?: Array<{ targetId: string; type: string; url: string }>
      }
      const pages = (targets.targetInfos ?? []).filter((info) => info.type === 'page')
      log('4 Target.getTargets', `${Date.now() - t4}ms → ${pages.length} page target(s)`)
      expect(Array.isArray(targets.targetInfos)).toBe(true)

      if (pages.length > 0) {
        // ── step 5: attach + enable a stateful domain on the SAME session ──
        const t5 = Date.now()
        const attached = (await session.call('Target.attachToTarget', {
          targetId: pages[0]!.targetId,
          flatten: true,
        })) as { sessionId?: string }
        expect(typeof attached.sessionId).toBe('string')
        await session.call('Page.enable', {}, { sessionId: attached.sessionId })
        log('5 attach + Page.enable', `${Date.now() - t5}ms (sessionId=${attached.sessionId})`)

        // Observation only (M0.3/M0.7 own the assertion): the plan claims a
        // missing `highlightConfig` must fail LOUDLY rather than silently.
        // Record what this runtime actually does; do not fail the probe on it.
        const observed = await session
          .call('Overlay.setInspectMode', { mode: 'searchForNode' }, { sessionId: attached.sessionId, timeoutMs: 3000 })
          .then(() => 'resolved (browser accepted despite no highlightConfig)')
          .catch((error: Error) => `rejected: ${error.message}`)
        log('  note highlightConfig', observed)

        await session.call('Target.detachFromTarget', { sessionId: attached.sessionId })
      } else {
        log('5 attach + Page.enable', 'skipped — no page target open in the remote browser')
      }
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
})
