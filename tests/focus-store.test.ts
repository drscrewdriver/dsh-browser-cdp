import { describe, expect, it } from 'vitest'
import { createFocusStore } from '../src/runtime/focus.ts'

/**
 * Why this file exists: "which tab is current" used to be derived in three
 * places (capture lease, /json/list order, panel selection) and reconciled by
 * whoever read it last. The store is only useful if it is strictly
 * single-writer and side-effect free, so those two properties are what these
 * tests pin.
 */
describe('FocusStore', () => {
  it('records the operation focus and reports it back', () => {
    const store = createFocusStore(() => 1000)
    expect(store.get()).toBeNull()
    const focus = store.set('t-1', 'agent')
    expect(focus).toEqual({ targetId: 't-1', source: 'agent', at: 1000 })
    expect(store.get()?.targetId).toBe('t-1')
  })

  it('an empty id clears it (a worker answering focus-stale must be able to drop it)', () => {
    const store = createFocusStore()
    store.set('t-1', 'operator')
    expect(store.set('', 'agent')).toBeNull()
    expect(store.get()).toBeNull()
  })

  it('does not emit for an identical rewrite, but does refresh the timestamp', () => {
    // A poll loop rewriting "same tab, same source" every second must not
    // produce an SSE event per tick.
    let at = 1
    const store = createFocusStore(() => at)
    let events = 0
    store.onChange(() => { events += 1 })
    store.set('t-1', 'agent')
    at = 2
    const again = store.set('t-1', 'agent')
    expect(events).toBe(1)
    expect(again?.at).toBe(2)
    // A different source IS a change: the operator overriding the agent matters.
    store.set('t-1', 'operator')
    expect(events).toBe(2)
  })

  it('reports staleness against a live target list', () => {
    const store = createFocusStore()
    store.set('t-1', 'agent')
    expect(store.isStale(['t-1', 't-2'])).toBe(false)
    expect(store.isStale(['t-2'])).toBe(true)
    // No focus at all is never "stale" — nothing to correct.
    store.clear()
    expect(store.isStale([])).toBe(false)
  })

  it('emits null on clear and stops after unsubscribe', () => {
    const store = createFocusStore()
    const seen: Array<string | null> = []
    const off = store.onChange((focus) => seen.push(focus?.targetId ?? null))
    store.set('t-1', 'agent')
    store.clear()
    off()
    store.set('t-2', 'agent')
    expect(seen).toEqual(['t-1', null])
  })
})