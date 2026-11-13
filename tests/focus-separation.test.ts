import { beforeEach, describe, expect, it } from 'vitest'
import { defaultFocusStore, focusIdFrom } from '../src/runtime/focus.ts'
import { pushFocus, setFocusPusher } from '../src/cast-server.ts'

/**
 * The separation contract, end to end at the seam both producers share:
 *
 *   - ONE writer (pushFocus) for both "operator clicked" and "agent drove a tab",
 *     so the two can never disagree about what is current.
 *   - The store is written before the worker is asked (the highlight must not
 *     wait on a socket), and a worker that says the tab is gone CLEARS it —
 *     otherwise a closed tab stays highlighted forever.
 *   - A tool result only moves the focus when it actually names a tab.
 */
describe('focus separation (pushFocus seam)', () => {
  beforeEach(() => {
    defaultFocusStore.clear()
    setFocusPusher(null)
  })

  it('records the focus without a worker (CLI channels sync over SSE only)', async () => {
    const focus = await pushFocus('t-1', 'agent')
    expect(focus).toMatchObject({ targetId: 't-1', source: 'agent' })
    expect(defaultFocusStore.get()?.targetId).toBe('t-1')
  })

  it('lets the operator override the agent on the same tab', async () => {
    await pushFocus('t-1', 'agent')
    await pushFocus('t-1', 'operator')
    expect(defaultFocusStore.get()?.source).toBe('operator')
  })

  it('clears the focus when the worker answers focus-stale', async () => {
    setFocusPusher(async () => ({ status: 409, body: { code: 'focus-stale' } }))
    const focus = await pushFocus('t-gone', 'agent')
    expect(focus).toBeNull()
    expect(defaultFocusStore.get()).toBeNull()
  })

  it('keeps the focus when the worker accepts it', async () => {
    setFocusPusher(async () => ({ status: 200, body: { ok: true } }))
    await pushFocus('t-1', 'agent')
    expect(defaultFocusStore.get()?.targetId).toBe('t-1')
  })

  it('clears on an empty id without ever calling the worker', async () => {
    let calls = 0
    setFocusPusher(async () => { calls += 1; return { status: 200, body: {} } })
    await pushFocus('', 'agent')
    expect(calls).toBe(0)
    expect(defaultFocusStore.get()).toBeNull()
  })

  it('extracts a tab id from the shapes tools actually return', () => {
    expect(focusIdFrom({ page: { targetId: 'p-1' } })).toBe('p-1')
    expect(focusIdFrom({ tab: { targetId: 't-2' } })).toBe('t-2')
    expect(focusIdFrom({ targetId: 't-3' })).toBe('t-3')
    // A tool that reports no tab must not move the focus.
    expect(focusIdFrom({ ok: true, page: { url: 'https://example.com' } })).toBeNull()
    expect(focusIdFrom(null)).toBeNull()
    expect(focusIdFrom('targetId')).toBeNull()
  })
})