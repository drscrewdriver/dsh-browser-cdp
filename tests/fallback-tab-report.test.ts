import { describe, it, expect } from 'vitest'
import {
  AX_SENTINEL,
  COLLECT_FN_SOURCE,
  MAX_COLLECTED,
  buildEgoAxScript,
  buildTabbitAxSnippet,
  parseAxSentinel,
  composeFallbackReport,
} from '../src/cast/fallback-tab-report.ts'

describe('COLLECT_FN_SOURCE', () => {
  it('scans interactive tags and ARIA roles, capped', () => {
    expect(COLLECT_FN_SOURCE).toContain("a[href],button,input,select,textarea,[role]")
    expect(COLLECT_FN_SOURCE).toContain(`out.length >= ${MAX_COLLECTED}`)
    expect(COLLECT_FN_SOURCE).toContain('aria-label')
    expect(COLLECT_FN_SOURCE).toContain('120')
  })
})

describe('buildEgoAxScript', () => {
  const script = buildEgoAxScript(JSON.stringify('agent-space'))
  it('activates the agent space and reads the current tab', () => {
    expect(script).toContain('taskSpaces.useOrCreate("agent-space")')
    expect(script).toContain('browser.currentTab()')
    expect(script).toContain('page.info()')
    expect(script).toContain('page.evaluate(')
  })
  it('embeds the shared collector verbatim', () => {
    expect(script).toContain(COLLECT_FN_SOURCE)
  })
  it('reports failures through the sentinel', () => {
    expect(script).toContain(AX_SENTINEL)
    expect(script).toContain('catch (__err)')
    expect(script).toContain('ok: false')
  })
})

describe('buildTabbitAxSnippet', () => {
  const snippet = buildTabbitAxSnippet()
  it('uses page.evaluate + page.url/title', () => {
    expect(snippet).toContain('await page.evaluate(')
    expect(snippet).toContain('page.url()')
    expect(snippet).toContain('page.title()')
    expect(snippet).toContain(COLLECT_FN_SOURCE)
  })
})

describe('parseAxSentinel', () => {
  it('parses the newest line', () => {
    const out = `noise\n${AX_SENTINEL}{"ok":true,"url":"https://a.example","title":"A","targetId":"t1","nodes":[{"role":"button","name":"Go"}]}\n`
    const parsed = parseAxSentinel(out)
    expect(parsed?.ok).toBe(true)
    expect(parsed?.url).toBe('https://a.example')
    expect(parsed?.targetId).toBe('t1')
    expect(parsed?.nodes).toEqual([{ role: 'button', name: 'Go' }])
  })
  it('drops unnamed nodes and defaults the role', () => {
    const out = `${AX_SENTINEL}{"ok":true,"nodes":[{"role":"link","name":"x"},{"role":"","name":""},{"name":"y"}]}`
    expect(parseAxSentinel(out)?.nodes).toEqual([
      { role: 'link', name: 'x' },
      { role: '', name: 'y' },
    ])
  })
  it('surfaces an ok:false line with its error', () => {
    const parsed = parseAxSentinel(`${AX_SENTINEL}{"ok":false,"error":"boom"}`)
    expect(parsed?.ok).toBe(false)
    expect(parsed?.error).toBe('boom')
  })
  it('returns null without a sentinel or on malformed JSON', () => {
    expect(parseAxSentinel('plain')).toBeNull()
    expect(parseAxSentinel(`${AX_SENTINEL}{not json`)).toBeNull()
  })
})

describe('composeFallbackReport', () => {
  const base = {
    route: 'ego-cli' as const,
    targetId: 'requested-tab',
    snapshot: {
      url: 'https://example.com/a',
      title: 'Example',
      targetId: 'real-tab',
      nodes: [
        { role: 'button', name: 'Save' },
        { role: 'link', name: 'Home' },
      ],
    },
    now: 1_700_000_000_000,
  }

  it('builds a tab-anchor report with numbered elements', () => {
    const report = composeFallbackReport(base)
    expect(report.type).toBe('tab-anchor-report')
    expect(report.cdpEndpoint).toBe('ego-cli')
    expect(report.source).toBe('ego-cli')
    expect(report.pageUrl).toBe('https://example.com/a')
    expect(report.pageTitle).toBe('Example')
    expect(report.elements.map((e) => e.n)).toEqual([1, 2])
    expect(report.elements[0]!.role).toBe('button')
    // Anchors are scoped to this capture, never empty.
    expect(report.elements[0]!.anchor).toMatch(/^sb-/)
  })

  it('prefers the runtime-reported targetId over the requested one', () => {
    expect(composeFallbackReport(base).targetId).toBe('real-tab')
    const noReal = { ...base, snapshot: { ...base.snapshot, targetId: '' } }
    expect(composeFallbackReport(noReal).targetId).toBe('requested-tab')
  })

  it('is deterministic for the same inputs (stable anchors)', () => {
    expect(composeFallbackReport(base).elements[0]!.anchor).toBe(composeFallbackReport(base).elements[0]!.anchor)
    const later = composeFallbackReport({ ...base, now: base.now + 1000 })
    expect(later.elements[0]!.anchor).not.toBe(composeFallbackReport(base).elements[0]!.anchor)
  })

  it('caps elements and reports truncation', () => {
    const many = { ...base, maxElements: 1 }
    const report = composeFallbackReport(many)
    expect(report.elements).toHaveLength(1)
    expect(report.truncated).toBe(true)
  })

  it('carries a degraded marker for a route that could not read the DOM', () => {
    const report = composeFallbackReport({ ...base, nodes: [], snapshot: { ...base.snapshot, nodes: [] }, degraded: 'tabbit-cli' } as never)
    expect(report.degraded).toBe('tabbit-cli')
    expect(report.elements).toEqual([])
  })
})
