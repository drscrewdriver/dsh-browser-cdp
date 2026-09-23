import { describe, expect, it } from 'vitest'
import type { PageCall } from '../src/cdp/page.ts'
import { buildFrame, type Frame } from '../src/jev/frame.ts'
import { clickCandidate, fillCandidate, resolveCandidate, scrollPage, toHistoryNote } from '../src/jev/act.ts'

/**
 * Executor acceptance. The property under test is the frame contract's central
 * promise, stated in `frame.ts` and enforced here: **a rect from a frame is
 * never a click target**. Every action re-measures via `DOM.getBoxModel` and
 * re-checks with `DOM.getNodeForLocation` before dispatching input.
 *
 * The fixtures below make that falsifiable: the frame's recorded rect and the
 * freshly measured box are deliberately DIFFERENT, so an implementation that
 * clicked `node.rect` would land somewhere else and fail the hit check.
 *
 * No socket, no clock: every CDP call goes through a scripted fake.
 */

interface RecordedCall {
  method: string
  params: Record<string, unknown>
}

/** A scripted CDP channel. Unknown methods throw, so a stray call is visible. */
function scripted(handlers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: RecordedCall[] = []
  const call: PageCall = async (method, params) => {
    calls.push({ method, params: (params ?? {}) as Record<string, unknown> })
    const handler = handlers[method]
    if (handler === undefined) throw new Error(`unexpected CDP method ${method}`)
    return handler((params ?? {}) as Record<string, unknown>)
  }
  return { call, calls }
}

const target = { endpoint: 'http://127.0.0.1:9223', targetId: 'T1', url: 'https://example.test/', title: 'Ex' }
const viewport = { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }

/** A frame whose recorded rect is deliberately NOT where the element now is. */
function frameWith(stale: { x: number; y: number; width: number; height: number } | null): Frame {
  return buildFrame({
    target,
    viewport,
    image: null,
    nodes: [{ backendNodeId: 42, role: 'button', name: 'Sign in', rect: stale, container: 'nav' }],
    documentRevision: 1,
    seq: 1,
    now: () => 0,
  }).frame
}

const quad = (x: number, y: number, w: number, h: number): number[] => [x, y, x + w, y, x + w, y + h, x, y + h]

describe('jev act · candidate resolution refuses anything ambiguous', () => {
  const frame = frameWith({ x: 0, y: 0, width: 10, height: 10 })

  it('resolves an in-range candidate', () => {
    const resolved = resolveCandidate(frame, 1)
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.node.backendNodeId).toBe(42)
  })

  it('REFUSES an out-of-range index rather than clamping to the last one', () => {
    // A judge that answered 99 did not mean candidate 1. Clamping is how a
    // hallucinated index becomes a real click on the wrong element.
    const resolved = resolveCandidate(frame, 99)
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.code).toBe('candidate-not-found')
  })

  it('refuses zero and negatives', () => {
    expect(resolveCandidate(frame, 0).ok).toBe(false)
    expect(resolveCandidate(frame, -1).ok).toBe(false)
  })

  it('refuses a non-integer index', () => {
    expect(resolveCandidate(frame, 1.5).ok).toBe(false)
    expect(resolveCandidate(frame, Number.NaN).ok).toBe(false)
  })

  it('refuses an excluded candidate', () => {
    const resolved = resolveCandidate(frame, 1, [1])
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.code).toBe('candidate-excluded')
  })
})

describe('jev act · clicks re-measure instead of trusting the frame', () => {
  it('clicks the FRESH box, not the rect recorded in the frame', async () => {
    // Frame says (0,0,10,10) -> centre (5,5). CDP now says (100,200,40,20)
    // -> centre (120,210). The click must go to 120,210 and the hit check
    // must resolve the same node there.
    const frame = frameWith({ x: 0, y: 0, width: 10, height: 10 })
    const { call, calls } = scripted({
      'DOM.getBoxModel': () => ({ model: { content: quad(100, 200, 40, 20) } }),
      'DOM.getNodeForLocation': () => ({ backendNodeId: 42, nodeId: 1, frameId: 'F' }),
      'Input.dispatchMouseEvent': () => ({}),
    })

    const outcome = await clickCandidate({ call, sessionId: 'S' }, frame, 1)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.point).toEqual({ x: 120, y: 210 })
    expect(outcome.measured).toEqual({ x: 100, y: 200, width: 40, height: 20 })

    const dispatched = calls.filter((entry) => entry.method === 'Input.dispatchMouseEvent')
    expect(dispatched).toHaveLength(3)
    for (const entry of dispatched) {
      expect(entry.params.x).toBe(120)
      expect(entry.params.y).toBe(210)
    }
  })

  it('reports the drift between capture and action rather than hiding it', async () => {
    const frame = frameWith({ x: 0, y: 0, width: 10, height: 10 })
    const { call } = scripted({
      'DOM.getBoxModel': () => ({ model: { content: quad(100, 200, 40, 20) } }),
      'DOM.getNodeForLocation': () => ({ backendNodeId: 42, nodeId: 1, frameId: 'F' }),
      'Input.dispatchMouseEvent': () => ({}),
    })
    const outcome = await clickCandidate({ call, sessionId: 'S' }, frame, 1)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.drift).toBeGreaterThan(100)
  })

  it('refuses when something else is on top of the measured point', async () => {
    // The pre-click hit check. Without it this would dispatch a real click into
    // an overlay — an action nobody asked for and no trace explains.
    const frame = frameWith(null)
    const { call, calls } = scripted({
      'DOM.getBoxModel': () => ({ model: { content: quad(10, 10, 20, 20) } }),
      'DOM.getNodeForLocation': () => ({ backendNodeId: 999, nodeId: 2, frameId: 'F' }),
    })
    const outcome = await clickCandidate({ call, sessionId: 'S' }, frame, 1)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('click-missed')
    // Nothing was dispatched: the check happens BEFORE, not after.
    expect(calls.some((entry) => entry.method === 'Input.dispatchMouseEvent')).toBe(false)
  })

  it('refuses a disabled candidate without measuring anything', async () => {
    const frame = buildFrame({
      target,
      viewport,
      image: null,
      nodes: [{ backendNodeId: 42, role: 'button', name: 'Sign in', disabled: true }],
      documentRevision: 1,
      seq: 1,
    }).frame
    const { call, calls } = scripted({})
    const outcome = await clickCandidate({ call, sessionId: 'S' }, frame, 1)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('candidate-disabled')
    expect(calls).toHaveLength(0)
  })

  it('surfaces a missing box model as no-box-model, not as a click', async () => {
    const frame = frameWith(null)
    const { call } = scripted({
      'DOM.getBoxModel': () => ({ model: {} }),
    })
    const outcome = await clickCandidate({ call, sessionId: 'S' }, frame, 1)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('no-box-model')
  })

  it('surfaces a stuck input channel as input-timeout, distinctly from a miss', async () => {
    const frame = frameWith(null)
    const { call } = scripted({
      'DOM.getBoxModel': () => ({ model: { content: quad(10, 10, 20, 20) } }),
      'DOM.getNodeForLocation': () => ({ backendNodeId: 42, nodeId: 1, frameId: 'F' }),
      'Input.dispatchMouseEvent': () => {
        throw new Error('Command timed out after 5000ms')
      },
    })
    const outcome = await clickCandidate({ call, sessionId: 'S' }, frame, 1)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('input-timeout')
  })

  it('re-checks the hit AFTER the click too, catching a mid-flight re-layout', async () => {
    const frame = frameWith(null)
    let hits = 0
    const { call } = scripted({
      'DOM.getBoxModel': () => ({ model: { content: quad(10, 10, 20, 20) } }),
      'DOM.getNodeForLocation': () => {
        hits += 1
        // First check (pre-click) resolves the node; the post-click check sees
        // something else, i.e. the page moved while the click was in flight.
        return hits === 1
          ? { backendNodeId: 42, nodeId: 1, frameId: 'F' }
          : { backendNodeId: 777, nodeId: 3, frameId: 'F' }
      },
      'Input.dispatchMouseEvent': () => ({}),
    })
    const outcome = await clickCandidate({ call, sessionId: 'S' }, frame, 1)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('click-missed')
  })
})

describe('jev act · fills focus the resolved node and never assign .value', () => {
  it('focuses by backendNodeId then inserts text', async () => {
    const frame = frameWith(null)
    const { call, calls } = scripted({
      'DOM.getBoxModel': () => ({ model: { content: quad(10, 10, 100, 24) } }),
      'DOM.focus': () => ({}),
      'Input.insertText': () => ({}),
    })
    const outcome = await fillCandidate({ call, sessionId: 'S' }, frame, 1, 'hello@example.test')
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.action).toBe('fill')

    const focus = calls.find((entry) => entry.method === 'DOM.focus')
    expect(focus?.params.backendNodeId).toBe(42)
    const insert = calls.find((entry) => entry.method === 'Input.insertText')
    expect(insert?.params.text).toBe('hello@example.test')
    // No path in this module assigns a DOM value — asserted as an absent method,
    // because the absence IS the design (a `.value` write is invisible to React).
    expect(calls.some((entry) => entry.method.includes('Runtime.evaluate'))).toBe(false)
  })

  it('refuses empty text without touching the page', async () => {
    const frame = frameWith(null)
    const { call, calls } = scripted({
      'DOM.getBoxModel': () => ({ model: { content: quad(10, 10, 20, 20) } }),
    })
    const outcome = await fillCandidate({ call, sessionId: 'S' }, frame, 1, '')
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('input-failed')
    expect(calls.some((entry) => entry.method === 'Input.insertText')).toBe(false)
  })
})

describe('jev act · scrolling', () => {
  it('dispatches a wheel event with the requested delta', async () => {
    const { call, calls } = scripted({ 'Input.dispatchMouseEvent': () => ({}) })
    const outcome = await scrollPage({ call, sessionId: 'S' }, 600)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.action).toBe('scroll')
    const wheel = calls[0]
    expect(wheel?.params.type).toBe('mouseWheel')
    expect(wheel?.params.deltaY).toBe(600)
  })

  it('refuses a zero or non-finite delta', async () => {
    const { call } = scripted({})
    expect((await scrollPage({ call, sessionId: 'S' }, 0)).ok).toBe(false)
    expect((await scrollPage({ call, sessionId: 'S' }, Number.NaN)).ok).toBe(false)
  })
})

describe('jev act · history lines are small and truthful', () => {
  it('records a successful click with the drift when it was significant', () => {
    const line = toHistoryNote({
      ok: true,
      code: 'ok',
      action: 'click',
      n: 3,
      backendNodeId: 42,
      point: { x: 1, y: 2 },
      measured: { x: 1, y: 2, width: 10, height: 10 },
      drift: 24.5,
    })
    expect(line.action).toBe('click')
    expect(line.n).toBe(3)
    expect(line.ok).toBe(true)
    expect(line.note).toContain('24.5px')
  })

  it('records a failure as a non-action carrying the code', () => {
    const line = toHistoryNote({ ok: false, code: 'click-missed', message: 'overlay', n: 4 })
    expect(line.ok).toBe(false)
    expect(line.action).toBe('none')
    expect(line.n).toBe(4)
    expect(line.note).toContain('click-missed')
  })
})
