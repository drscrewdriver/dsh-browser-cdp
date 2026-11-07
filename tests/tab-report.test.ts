import { describe, expect, it } from 'vitest'
import {
  captureTabReport,
  numberReportNodes,
  reportScope,
  MAX_REPORT_ELEMENTS,
  TAB_REPORT_TYPE,
  type AxSnapshot,
  type CaptureTabReportInput,
} from '../src/tab-report.ts'
import { isAnchorFormat, anchorFor } from '../src/jev/anchors.ts'
import type { AxNode } from '../src/cdp/dom.ts'

/**
 * Tab anchor report — the snapshot-scoped naming invariant carried over from
 * jev/anchors.ts (同输入同锚 / 跨快照必变), plus the report-shape contract the
 * dock card keys on. The AX read is faked via the injectable `fetchAx` seam so
 * no fixture touches a real clock or a real CDP socket.
 */

function axNode(backendNodeId: number, role: string, name: string, ignored = false): AxNode {
  return { nodeId: String(backendNodeId), backendNodeId, role, name, ignored, keyboardFocusable: true }
}

const input: CaptureTabReportInput = {
  wsUrl: 'ws://127.0.0.1:9222/devtools/browser/abc',
  targetId: 'TARGET-1',
  engine: 'chrome',
}

function fakeFetch(snapshot: AxSnapshot) {
  return async () => snapshot
}

describe('reportScope', () => {
  it('is deterministic for the same url + instant', () => {
    expect(reportScope('https://a.test/', 1700000000000)).toBe(reportScope('https://a.test/', 1700000000000))
  })

  it('changes when the capture instant changes (跨快照必须变)', () => {
    expect(reportScope('https://a.test/', 1700000000000)).not.toBe(reportScope('https://a.test/', 1700000000001))
  })
})

describe('numberReportNodes', () => {
  const scope = reportScope('https://a.test/', 1)

  it('numbers interactive candidates in document order and mints valid anchors', () => {
    const nodes = [axNode(10, 'button', 'Submit'), axNode(11, 'generic', 'noise'), axNode(12, 'link', 'Docs')]
    const r = numberReportNodes(nodes, scope)
    expect(r.elements.map((e) => e.n)).toEqual([1, 2])
    expect(r.elements.map((e) => e.role)).toEqual(['button', 'link'])
    expect(r.elements.every((e) => isAnchorFormat(e.anchor))).toBe(true)
    // anchor is exactly what anchors.ts mints for (scope, backendNodeId)
    expect(r.elements[0]!.anchor).toBe(anchorFor(scope, 10))
  })

  it('drops ignored nodes and dedupes by backendNodeId', () => {
    const nodes = [axNode(10, 'button', 'A'), axNode(10, 'button', 'A dup'), axNode(20, 'button', 'B', true)]
    const r = numberReportNodes(nodes, scope)
    expect(r.total).toBe(1)
    expect(r.elements.map((e) => e.backendNodeId)).toEqual([10])
  })

  it('caps at the ceiling and reports truncated, never trimming silently', () => {
    const nodes = Array.from({ length: MAX_REPORT_ELEMENTS + 50 }, (_, i) => axNode(100 + i, 'button', 'b' + i))
    const r = numberReportNodes(nodes, scope)
    expect(r.elements.length).toBe(MAX_REPORT_ELEMENTS)
    expect(r.total).toBe(MAX_REPORT_ELEMENTS + 50)
    expect(r.truncated).toBe(true)
  })

  it('skips zero backendNodeId (unparsable AX ids)', () => {
    const nodes = [axNode(0, 'button', 'ghost'), axNode(5, 'button', 'real')]
    const r = numberReportNodes(nodes, scope)
    expect(r.elements.map((e) => e.backendNodeId)).toEqual([5])
  })
})

describe('captureTabReport', () => {
  it('builds the full report shape from a non-degraded snapshot', async () => {
    const snapshot: AxSnapshot = {
      pageUrl: 'https://shop.test/cart',
      pageTitle: 'Cart',
      nodes: [axNode(7, 'textbox', 'Qty'), axNode(8, 'button', 'Checkout')],
      degraded: false,
    }
    const report = await captureTabReport(input, {
      now: () => 1700000000000,
      fetchAx: fakeFetch(snapshot),
    })
    expect(report.type).toBe(TAB_REPORT_TYPE)
    expect(report.targetId).toBe('TARGET-1')
    expect(report.cdpEndpoint).toBe(input.wsUrl)
    expect(report.pageUrl).toBe('https://shop.test/cart')
    expect(report.pageTitle).toBe('Cart')
    expect(report.capturedAt).toBe(1700000000000)
    expect(report.truncated).toBe(false)
    expect(report.degraded).toBeUndefined()
    expect(report.elements.length).toBe(2)
    expect(isAnchorFormat(report.elements[0]!.anchor)).toBe(true)
    // frameId is the scope the anchors were minted in
    expect(report.frameId).toBe(reportScope('https://shop.test/cart', 1700000000000))
  })

  it('marks a degraded (lightpanda) snapshot with empty elements', async () => {
    const snapshot: AxSnapshot = { pageUrl: 'https://lp.test/', pageTitle: 'LP', nodes: [], degraded: true }
    const report = await captureTabReport({ ...input, engine: 'lightpanda' }, { fetchAx: fakeFetch(snapshot) })
    expect(report.elements).toEqual([])
    expect(report.degraded).toBe('lightpanda')
    expect(report.truncated).toBe(false)
  })

  it('two captures of the same page mint different anchors (per-instant scope)', async () => {
    const snapshot: AxSnapshot = { pageUrl: 'https://a.test/', pageTitle: 'A', nodes: [axNode(1, 'button', 'Go')], degraded: false }
    const r1 = await captureTabReport(input, { now: () => 1000, fetchAx: fakeFetch(snapshot) })
    const r2 = await captureTabReport(input, { now: () => 2000, fetchAx: fakeFetch(snapshot) })
    expect(r1.elements[0]!.anchor).not.toBe(r2.elements[0]!.anchor)
  })
})
