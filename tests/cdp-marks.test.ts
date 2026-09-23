import { describe, expect, it } from 'vitest'
import { captureMarked, interactiveCandidates, isInteractiveRole } from '../src/cdp/marks.ts'
import type { AxNode } from '../src/cdp/dom.ts'
import type { PageCall } from '../src/cdp/page.ts'

/**
 * 阶段 3 / R4 (T3.1r–T3.3r): one call returns the image AND the numbered map,
 * over pure CDP with zero page injection. Every fixture is scripted — no
 * browser, no clock, no network.
 */

const axNode = (nodeId: string, role: string, name: string, extra: Partial<AxNode> = {}): AxNode => ({
  nodeId,
  backendNodeId: Number.parseInt(nodeId, 10) || 0,
  role,
  name,
  ignored: false,
  keyboardFocusable: true,
  ...extra,
})

const QUAD = [10, 20, 110, 20, 110, 70, 10, 70]
const png = Buffer.from('0123456789').toString('base64')

function scripted(handlers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: Array<{ method: string; params: Record<string, unknown>; sessionId?: string }> = []
  const call: PageCall = async (method, params, options) => {
    calls.push({
      method,
      params: (params ?? {}) as Record<string, unknown>,
      ...(options?.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    })
    const handler = handlers[method]
    if (handler === undefined) throw new Error(`unexpected CDP method ${method}`)
    return handler((params ?? {}) as Record<string, unknown>)
  }
  return { calls, call, methods: (): string[] => calls.map((entry) => entry.method) }
}

const happyHandlers = {
  'Runtime.evaluate': () => ({ result: { value: [10, 20] } }),
  'Accessibility.getFullAXTree': () => ({
    nodes: [
      { nodeId: '11', role: { value: 'button' }, name: { value: 'Search' }, ignored: false, properties: [{ name: 'focusable', value: { value: true } }] },
      { nodeId: '12', role: { value: 'link' }, name: { value: 'Docs' }, ignored: false, properties: [{ name: 'focusable', value: { value: true } }] },
      { nodeId: '13', role: { value: 'generic' }, ignored: false },
      { nodeId: '14', role: { value: 'button' }, name: { value: 'dupe' }, ignored: true },
    ],
  }),
  'DOM.getBoxModel': () => ({ model: { content: QUAD } }),
  'Page.captureScreenshot': () => ({ data: png }),
  'Overlay.highlightNode': () => ({ raw: 'highlighted' }),
  'Overlay.hideHighlight': () => ({}),
}

describe('R4 interactiveCandidates', () => {
  it('numbers interactive roles in document order, 1-based', () => {
    const marks = interactiveCandidates([
      axNode('11', 'generic', 'noise'),
      axNode('12', 'button', 'Search'),
      axNode('13', 'link', 'Docs'),
    ])
    expect(marks.map((mark) => [mark.n, mark.backendNodeId, mark.role])).toEqual([
      [1, 12, 'button'],
      [2, 13, 'link'],
    ])
  })

  it('drops ignored nodes and duplicate backend node ids', () => {
    const marks = interactiveCandidates([
      axNode('11', 'button', 'one'),
      axNode('11', 'button', 'one-again'),
      axNode('12', 'button', 'skipped', { ignored: true }),
      axNode('13', 'button', 'two'),
    ])
    expect(marks.map((mark) => mark.backendNodeId)).toEqual([11, 13])
  })

  it('honours the limit and knows which roles count as interactive', () => {
    const nodes = ['button', 'link', 'textbox', 'checkbox', 'combobox', 'tab', 'switch', 'slider'].map((role, index) =>
      axNode(String(index + 1), role, role),
    )
    expect(interactiveCandidates(nodes, 3)).toHaveLength(3)
    expect(interactiveCandidates(nodes, 3).map((mark) => mark.n)).toEqual([1, 2, 3])
    expect(isInteractiveRole('button')).toBe(true)
    expect(isInteractiveRole('generic')).toBe(false)
  })

  it('returns nothing for an empty tree', () => {
    expect(interactiveCandidates([])).toEqual([])
  })

  it('does not mutate the input nodes', () => {
    const nodes = [axNode('11', 'button', 'Search')]
    interactiveCandidates(nodes)
    expect(nodes[0]!.name).toBe('Search')
  })
})

describe('R4 captureMarked', () => {
  it('returns the image plus the numbered map, and always hides the highlight', async () => {
    const fake = scripted(happyHandlers)
    const result = await captureMarked(fake.call, 'S-1', { limit: 5 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bytes).toBe(10)
    expect(result.highlighted).toBeNull()
    expect(result.highlightError).toBeNull()
    expect(result.marks).toHaveLength(2)
    expect(result.marks[0]).toMatchObject({
      n: 1,
      backendNodeId: 11,
      role: 'button',
      name: 'Search',
      // document (10,20) minus scroll (10,20) read from the page
      rect: { x: 0, y: 0, width: 100, height: 50 },
    })
    expect(fake.methods()).toEqual([
      'Accessibility.getFullAXTree',
      'Runtime.evaluate',
      'DOM.getBoxModel',
      'DOM.getBoxModel',
      'Page.captureScreenshot',
      'Overlay.hideHighlight',
    ])
    expect(fake.calls.every((entry) => entry.sessionId === 'S-1')).toBe(true)
  })

  it('highlights exactly one mark between the measurements and the shot', async () => {
    const fake = scripted(happyHandlers)
    const result = await captureMarked(fake.call, 'S-1', { limit: 5, highlightIndex: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.highlighted).toBe(2)
    expect(result.highlightError).toBeNull()
    expect(fake.methods()).toEqual([
      'Accessibility.getFullAXTree',
      'Runtime.evaluate',
      'DOM.getBoxModel',
      'DOM.getBoxModel',
      'Overlay.highlightNode',
      'Page.captureScreenshot',
      'Overlay.hideHighlight',
    ])
    const highlight = fake.calls.find((entry) => entry.method === 'Overlay.highlightNode')!
    expect(highlight.params).toMatchObject({ backendNodeId: 13 })
    expect(highlight.params.highlightConfig).toBeDefined()
  })

  it('records an out-of-range highlight as non-fatal and still takes the shot', async () => {
    const fake = scripted(happyHandlers)
    const result = await captureMarked(fake.call, undefined, { limit: 5, highlightIndex: 9 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.highlighted).toBeNull()
    expect(result.highlightError).toMatchObject({ code: 'highlight-index-out-of-range' })
    expect(fake.methods()).not.toContain('Overlay.highlightNode')
    expect(fake.methods()).toContain('Page.captureScreenshot')
  })

  it('treats a failed highlight as non-fatal, and still cleans up', async () => {
    const fake = scripted({
      ...happyHandlers,
      'Overlay.highlightNode': () => {
        throw new Error('Internal error: highlight configuration parameter is missing')
      },
    })
    const result = await captureMarked(fake.call, undefined, { limit: 5, highlightIndex: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.highlighted).toBeNull()
    expect(result.highlightError?.code).toBe('highlight-failed')
    expect(result.highlightError?.message).toContain('highlight configuration parameter is missing')
    expect(fake.methods()).toContain('Overlay.hideHighlight')
  })

  it('can skip per-candidate measurements (N round trips saved)', async () => {
    const fake = scripted(happyHandlers)
    const result = await captureMarked(fake.call, undefined, { limit: 5, measureRects: false })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.marks.every((mark) => mark.rect === null && mark.documentRect === null)).toBe(true)
    expect(fake.methods()).not.toContain('DOM.getBoxModel')
    expect(fake.methods()).toEqual([
      'Accessibility.getFullAXTree',
      'Page.captureScreenshot',
      'Overlay.hideHighlight',
    ])
  })

  it('propagates an AX failure and never takes a screenshot', async () => {
    const fake = scripted({ ...happyHandlers, 'Accessibility.getFullAXTree': () => ({}) })
    const result = await captureMarked(fake.call, undefined, {})
    expect(result).toMatchObject({ ok: false, code: 'ax-tree-missing' })
    expect(fake.methods()).not.toContain('Page.captureScreenshot')
  })

  it('still hides the highlight when the screenshot itself fails', async () => {
    const fake = scripted({ ...happyHandlers, 'Page.captureScreenshot': () => ({}) })
    const result = await captureMarked(fake.call, undefined, { limit: 5 })
    expect(result).toMatchObject({ ok: false, code: 'empty-screenshot' })
    expect(fake.methods()).toContain('Overlay.hideHighlight')
  })

  it('caps the candidate set before spending any per-node round trip', async () => {
    const many = Array.from({ length: 40 }, (_, index) => axNode(String(index + 1), 'button', `b${index + 1}`))
    const fake = scripted({
      ...happyHandlers,
      'Accessibility.getFullAXTree': () => ({ nodes: many.map((node) => ({ nodeId: node.nodeId, role: { value: node.role }, name: { value: node.name }, ignored: false })) }),
    })
    const result = await captureMarked(fake.call, undefined, { limit: 5 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.marks).toHaveLength(5)
    expect(fake.calls.filter((entry) => entry.method === 'DOM.getBoxModel')).toHaveLength(5)
  })
})
