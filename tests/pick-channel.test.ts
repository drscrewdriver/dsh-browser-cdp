import { describe, expect, it } from 'vitest'
import type { CdpClient } from '../src/worker/cdp-client.ts'
import type { TargetSessions } from '../src/worker/capture-cdp.ts'
import { PickChannel, describeElement, type PickElement } from '../src/worker/pick-channel.ts'
import { PICK_BINDING, parsePickAction } from '../src/worker/pick-ui.ts'

/**
 * M1.4 / T5.1c acceptance: the picker runs on the worker's resident connection,
 * enables `DOM` before `Overlay`, always sends a `highlightConfig`, exits
 * inspect mode the moment something is picked (T5.13), and refuses a pick whose
 * node description cannot be resolved (G7 — "coords only" is not a pick).
 */

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

type Handler = (params: unknown, sessionId?: string) => void

function harness(overrides: { enableFails?: boolean; describeFails?: boolean; hitBackendNodeId?: number | null } = {}) {
  const calls: Array<{ method: string; params: Record<string, unknown>; sessionId?: string }> = []
  const listeners = new Map<string, Set<Handler>>()

  const dispatch = async (method: string, params: Record<string, unknown>, sessionId?: string): Promise<unknown> => {
    calls.push({ method, params, ...(sessionId === undefined ? {} : { sessionId }) })
    if (method === 'DOM.enable' && overrides.enableFails) throw new Error('DOM is not available')
    if (method === 'Runtime.evaluate') return { result: { value: [10, 20] } }
    if (method === 'DOM.getNodeForLocation') {
      if (overrides.hitBackendNodeId === null) return {}
      return { backendNodeId: overrides.hitBackendNodeId ?? 77, nodeId: 9, frameId: 'F1' }
    }
    if (method === 'DOM.describeNode') {
      if (overrides.describeFails) throw new Error('Node is detached from the document')
      return { node: { nodeName: 'BUTTON', attributes: ['id', 'go', 'aria-label', 'Search'] } }
    }
    if (method === 'DOM.getBoxModel') return { model: { content: [10, 20, 110, 20, 110, 70, 10, 70] } }
    return {}
  }

  const cdp = {
    call: (method: string, params: unknown, sessionId?: string) => dispatch(method, (params ?? {}) as Record<string, unknown>, sessionId),
    on: (method: string, handler: Handler) => {
      if (!listeners.has(method)) listeners.set(method, new Set())
      listeners.get(method)!.add(handler)
      return () => listeners.get(method)!.delete(handler)
    },
  } as unknown as CdpClient

  const sessions = {
    ensure: async (targetId: string) => ({ targetId, sessionId: `S-${targetId}`, viewportW: null, viewportH: null }),
    get: (targetId: string) => (targetId === 'T1' ? { targetId, sessionId: `S-${targetId}` } : null),
    call: (targetId: string, method: string, params: unknown, timeoutMs?: number) =>
      dispatch(method, (params ?? {}) as Record<string, unknown>, `S-${targetId}`),
  } as unknown as TargetSessions

  const picks: PickElement[] = []
  const errors: string[] = []
  const actions: Array<{ element: PickElement; action: string }> = []
  const channel = new PickChannel({
    cdp,
    sessions,
    onPick: (element) => picks.push(element),
    onAction: (element, action) => actions.push({ element, action }),
    onError: (code) => errors.push(code),
  })
  const fire = (method: string, params: unknown, sessionId?: string): void => {
    for (const handler of [...(listeners.get(method) ?? [])]) handler(params, sessionId)
  }
  return {
    channel,
    picks,
    errors,
    actions,
    fire,
    methods: (): string[] => calls.map((entry) => entry.method),
    callsFor: (method: string) => calls.filter((entry) => entry.method === method),
  }
}

describe('M1.4 PickChannel enable/disable', () => {
  it('arms DOM before Overlay, then enters inspect mode with a config', async () => {
    const h = harness()
    const state = await h.channel.setEnabled(true, 'T1')
    expect(h.methods().slice(0, 3)).toEqual(['DOM.enable', 'Overlay.enable', 'Overlay.setInspectMode'])
    const inspect = h.callsFor('Overlay.setInspectMode')[0]!
    expect(inspect.params).toMatchObject({ mode: 'searchForNode' })
    expect(inspect.params.highlightConfig).toBeDefined()
    expect(inspect.sessionId).toBe('S-T1')
    expect(state).toMatchObject({ enabled: true, code: 'picking', targetId: 'T1' })
    expect(state.enabledDomains).toEqual(['DOM.enable', 'Overlay.enable'])
  })

  it('refuses to arm without a target, without touching the browser', async () => {
    const h = harness()
    const state = await h.channel.setEnabled(true, '')
    expect(state).toMatchObject({ enabled: false, code: 'target-required' })
    expect(h.methods()).toEqual([])
  })

  it('surfaces an enable failure and never enters inspect mode', async () => {
    const h = harness({ enableFails: true })
    const state = await h.channel.setEnabled(true, 'T1')
    expect(state).toMatchObject({ enabled: false, code: 'enable-failed' })
    expect(state.message).toContain('DOM.enable')
    expect(h.methods()).not.toContain('Overlay.setInspectMode')
  })

  it('leaves inspect mode with the neutral config and is safe when already idle', async () => {
    const h = harness()
    await h.channel.setEnabled(false, 'T1')
    const off = h.callsFor('Overlay.setInspectMode')[0]!
    expect(off.params).toMatchObject({ mode: 'none' })
    expect(off.params.highlightConfig).toBeDefined()
    await expect(h.channel.setEnabled(false, 'T1')).resolves.toMatchObject({ enabled: false, code: 'idle' })
  })
})

describe('M1.4 PickChannel pick handling', () => {
  it('turns an inspectNodeRequested into a described element and EXITS inspect mode', async () => {
    const h = harness()
    await h.channel.setEnabled(true, 'T1')
    const before = h.methods().length

    h.fire('Overlay.inspectNodeRequested', { backendNodeId: 42 }, 'S-T1')
    await flush()

    // T5.13: mode is dropped before the element is even described.
    const after = h.methods().slice(before)
    expect(after[0]).toBe('Overlay.setInspectMode')
    expect(h.callsFor('Overlay.setInspectMode')[1]!.params).toMatchObject({ mode: 'none' })

    expect(h.picks).toHaveLength(1)
    expect(h.picks[0]).toEqual({
      backendNodeId: 42,
      tag: 'button',
      id: 'go',
      role: '',
      name: 'Search',
      keyboardFocusable: true,
      // document rect (10,20) minus scroll (10,20) = viewport (0,0)
      rect: { x: 0, y: 0, width: 100, height: 50 },
      documentRect: { x: 10, y: 20, width: 100, height: 50 },
      describe: 'button #go name="Search" focusable',
    })
    const state = h.channel.state()
    expect(state).toMatchObject({ enabled: false, code: 'picked', picks: 1 })
    expect(state.lastPick?.backendNodeId).toBe(42)
  })

  it('ignores a pick event from another target session', async () => {
    const h = harness()
    await h.channel.setEnabled(true, 'T1')
    h.fire('Overlay.inspectNodeRequested', { backendNodeId: 42 }, 'S-OTHER')
    await flush()
    expect(h.picks).toHaveLength(0)
    expect(h.channel.state().enabled).toBe(true)
  })

  it('ignores a pick event when the picker is not armed', async () => {
    const h = harness()
    h.fire('Overlay.inspectNodeRequested', { backendNodeId: 42 }, 'S-T1')
    await flush()
    expect(h.picks).toHaveLength(0)
  })

  it('refuses a pick whose node cannot be described (G7: coords are not a pick)', async () => {
    const h = harness({ describeFails: true })
    await h.channel.setEnabled(true, 'T1')
    h.fire('Overlay.inspectNodeRequested', { backendNodeId: 42 }, 'S-T1')
    await flush()
    expect(h.picks).toHaveLength(0)
    expect(h.channel.state().lastPick).toBeNull()
    expect(h.channel.state().code).toBe('describe-failed')
    expect(h.errors).toContain('describe-failed')
  })

  it('stops listening after a pick, so a stale event cannot double-fire', async () => {
    const h = harness()
    await h.channel.setEnabled(true, 'T1')
    h.fire('Overlay.inspectNodeRequested', { backendNodeId: 42 }, 'S-T1')
    await flush()
    h.fire('Overlay.inspectNodeRequested', { backendNodeId: 43 }, 'S-T1')
    await flush()
    expect(h.picks).toHaveLength(1)
    expect(h.channel.state().picks).toBe(1)
  })
})

describe('M1.4 PickChannel helpers', () => {
  it('serialises an element identity as one line', () => {
    expect(describeElement({ tag: 'a', id: 'login', role: 'link', name: 'Sign in', keyboardFocusable: true })).toBe(
      'a #login role=link name="Sign in" focusable',
    )
    expect(describeElement({ tag: 'div', id: '', role: '', name: '', keyboardFocusable: false })).toBe(
      'div name="" not-focusable',
    )
  })

  it('reports no candidates when the picker was never armed', async () => {
    const h = harness()
    expect(await h.channel.candidates()).toEqual([])
  })

  it('states are copied, so a caller cannot mutate internal state', async () => {
    const h = harness()
    await h.channel.setEnabled(true, 'T1')
    const snapshot = h.channel.state()
    snapshot.enabled = false
    expect(h.channel.state().enabled).toBe(true)
  })
})

describe('M1.5 selection UI + action delivery (T5.10–T5.13)', () => {
  const pickOnce = async (h: ReturnType<typeof harness>): Promise<void> => {
    await h.channel.setEnabled(true, 'T1')
    h.fire('Overlay.inspectNodeRequested', { backendNodeId: 42 }, 'S-T1')
    await flush()
  }

  it('injects the frame + bar and arms the binding right after a pick', async () => {
    const h = harness()
    await pickOnce(h)
    expect(h.callsFor('Runtime.addBinding')).toHaveLength(1)
    expect(h.callsFor('Runtime.addBinding')[0]!.params).toMatchObject({ name: PICK_BINDING })
    const ui = h.callsFor('Runtime.evaluate').find((entry) => String(entry.params.expression).includes('__dsh-pick-box'))
    expect(ui).toBeDefined()
    expect(String(ui!.params.expression)).toContain('引用到对话')
  })

  it('delivers a "quote" action: confirm drawn, onAction fired, picker RE-ARMS (T5.13)', async () => {
    const h = harness()
    await pickOnce(h)
    expect(h.channel.state().code).toBe('picked')

    h.fire('Runtime.bindingCalled', { name: PICK_BINDING, payload: JSON.stringify({ action: 'quote' }) }, 'S-T1')
    await flush()
    await flush()

    expect(h.actions).toHaveLength(1)
    expect(h.actions[0]!.action).toBe('quote')
    expect(h.actions[0]!.element.backendNodeId).toBe(42)
    expect(h.channel.state().lastAction).toBe('quote')
    // The confirm expression was evaluated (✓ 已引用到输入框, 2.5s collapse).
    expect(h.callsFor('Runtime.evaluate').some((e) => String(e.params.expression).includes('已引用到输入框'))).toBe(true)
    // T5.13 second half: the picker is armed again without a panel round trip.
    expect(h.channel.state().enabled).toBe(true)
    expect(h.channel.state().code).toBe('picking')
  })

  it('delivers a "quote" action from the Enter shortcut too', async () => {
    const h = harness()
    await pickOnce(h)
    h.fire('Runtime.bindingCalled', { name: PICK_BINDING, payload: JSON.stringify({ action: 'quote' }) }, 'S-T1')
    await flush()
    await flush()
    expect(h.actions).toHaveLength(1)
    expect(h.actions[0]!.action).toBe('quote')
    expect(h.channel.state().lastAction).toBe('quote')
  })

  it('refuses a malformed binding payload instead of guessing', async () => {
    const h = harness()
    await pickOnce(h)
    h.fire('Runtime.bindingCalled', { name: PICK_BINDING, payload: 'not json' }, 'S-T1')
    await flush()
    expect(h.actions).toHaveLength(0)
    expect(h.errors).toContain('bad-payload')
  })

  it('refuses an unknown action value', async () => {
    const h = harness()
    await pickOnce(h)
    h.fire('Runtime.bindingCalled', { name: PICK_BINDING, payload: JSON.stringify({ action: 'delete-all' }) }, 'S-T1')
    await flush()
    expect(h.actions).toHaveLength(0)
    expect(h.errors).toContain('bad-action')
  })

  it('ignores binding calls from another target session', async () => {
    const h = harness()
    await pickOnce(h)
    h.fire('Runtime.bindingCalled', { name: PICK_BINDING, payload: JSON.stringify({ action: 'quote' }) }, 'S-OTHER')
    await flush()
    expect(h.actions).toHaveLength(0)
  })

  it('disable strips the injected UI from the page (T5.21)', async () => {
    const h = harness()
    await pickOnce(h)
    const before = h.callsFor('Runtime.evaluate').length
    await h.channel.setEnabled(false, 'T1')
    const after = h.callsFor('Runtime.evaluate')
    expect(after.length).toBeGreaterThan(before)
    expect(String(after.at(-1)!.params.expression)).toContain('__dsh-pick-style')
  })
})

describe('T5.1b coordinate fallback (pickAt)', () => {
  it('resolves a viewport point to a described pick through the SAME pipeline', async () => {
    const h = harness()
    const state = await h.channel.pickAt('T1', 40, 25)
    // Hit test happened on the target's page session.
    const hit = h.callsFor('DOM.getNodeForLocation')[0]!
    expect(hit.params).toMatchObject({ x: 40, y: 25 })
    expect(hit.sessionId).toBe('S-T1')
    // Then describe → box → UI, exactly like the event path.
    expect(h.callsFor('DOM.describeNode')).toHaveLength(1)
    expect(state.lastPick).toMatchObject({ backendNodeId: 77, describe: 'button #go name="Search" focusable' })
    expect(state.picks).toBe(1)
    // The injected UI is there too.
    expect(h.callsFor('Runtime.addBinding')).toHaveLength(1)
  })

  it('refuses a blank point with an explicit reason (T5.8)', async () => {
    const h = harness({ hitBackendNodeId: null })
    const state = await h.channel.pickAt('T1', 5, 5)
    expect(state.enabled).toBe(false)
    expect(state.code).toBe('no-node-at-point')
    expect(state.lastPick).toBeNull()
    // Nothing was described, nothing injected.
    expect(h.callsFor('DOM.describeNode')).toHaveLength(0)
  })

  it('refuses without a target before touching the browser', async () => {
    const h = harness()
    const state = await h.channel.pickAt('', 1, 2)
    expect(state.code).toBe('target-required')
    expect(h.methods()).toEqual([])
  })

  it('refuses a pick whose node cannot be described, via the fallback too (G7)', async () => {
    const h = harness({ describeFails: true })
    const state = await h.channel.pickAt('T1', 1, 2)
    expect(state.code).toBe('describe-failed')
    expect(state.lastPick).toBeNull()
  })

  it('T5.8 cross-domain iframe: the hit resolves but the node cannot be described — classified, explicit', async () => {
    // Cross-origin frames surface as a backendNodeId whose describe is
    // refused (OOPIF nodes are not describable from the browser session).
    const h = harness({ describeFails: true })
    const state = await h.channel.pickAt('T1', 30, 40)
    expect(state.code).toBe('describe-failed')
    expect(state.errorClass).toBe('describe')
    expect(state.lastPick).toBeNull()
    expect(state.enabled).toBe(false)
    // And the UI was never drawn for an undescribed node.
    expect(h.callsFor('Runtime.addBinding')).toHaveLength(0)
  })

  it('T5.8 blank spot: classified as a hit failure, explicit reason', async () => {
    const h = harness({ hitBackendNodeId: null })
    const state = await h.channel.pickAt('T1', 5, 5)
    expect(state.code).toBe('no-node-at-point')
    expect(state.errorClass).toBe('hit')
  })
})

describe('T5.12 payload parsing', () => {
  it('accepts exactly the two actions', () => {
    expect(parsePickAction(JSON.stringify({ action: 'quote' }))).toEqual({ ok: true, action: 'quote' })
    expect(parsePickAction(JSON.stringify({ action: 'quote' }))).toEqual({ ok: true, action: 'quote' })
  })
  it('refuses anything else', () => {
    expect(parsePickAction('not json')).toEqual({ ok: false, code: 'bad-payload' })
    expect(parsePickAction(JSON.stringify({ action: 'other' }))).toEqual({ ok: false, code: 'bad-action' })
    expect(parsePickAction(JSON.stringify({}))).toEqual({ ok: false, code: 'bad-action' })
  })
})
