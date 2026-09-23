import { describe, expect, it } from 'vitest'
import {
  DISABLED_HIGHLIGHT_CONFIG,
  NEUTRAL_HIGHLIGHT_CONFIG,
  addBinding,
  captureScreenshot,
  highlightNode,
  onBindingCalled,
  readScrollOffset,
  resolveClip,
  setInspectMode,
  type PageCall,
} from '../src/cdp/page.ts'
import { accessibilityTree, boxModel, describeNode, flattenAxTree, nodeAtPoint } from '../src/cdp/dom.ts'
import { clickAt, dispatchMouse, fillText, insertText, mouseParams } from '../src/cdp/input.ts'
import { EventDispatcher } from '../src/cdp/events.ts'

/**
 * M0.5 / M0.6 / M0.7 acceptance. Every CDP call goes through a scripted fake,
 * so these fixtures never open a socket, read a clock, or need a browser.
 */

interface RecordedCall {
  method: string
  params: Record<string, unknown>
  sessionId?: string
  timeoutMs?: number
}

function scripted(handlers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: RecordedCall[] = []
  const call: PageCall = async (method, params, options) => {
    calls.push({
      method,
      params: (params ?? {}) as Record<string, unknown>,
      ...(options?.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    })
    const handler = handlers[method]
    if (handler === undefined) throw new Error(`unexpected CDP method ${method}`)
    return handler((params ?? {}) as Record<string, unknown>)
  }
  return {
    calls,
    call,
    methods: (): string[] => calls.map((entry) => entry.method),
    last: (): RecordedCall => calls[calls.length - 1]!,
  }
}

const QUAD = [10, 20, 110, 20, 110, 70, 10, 70] // 100x50 at (10,20)

// ── M0.7 screenshot clip semantics ──────────────────────────────────────────

describe('M0.7 resolveClip', () => {
  it('leaves a clip-less capture in viewport space', () => {
    expect(resolveClip({})).toEqual({ ok: true, clip: null, captureBeyondViewport: false })
  })

  it('passes a document clip through untouched and allows off-screen rendering', () => {
    expect(resolveClip({ clip: { x: 1, y: 2, width: 3, height: 4 } })).toEqual({
      ok: true,
      clip: { x: 1, y: 2, width: 3, height: 4 },
      captureBeyondViewport: true,
    })
  })

  it('translates a viewport clip by the scroll offset', () => {
    expect(resolveClip({ clip: { x: 5, y: 6, width: 10, height: 20 }, clipSpace: 'viewport', scroll: { x: 100, y: 300 } })).toEqual({
      ok: true,
      clip: { x: 105, y: 306, width: 10, height: 20 },
      captureBeyondViewport: true,
    })
  })

  it('REFUSES a viewport clip with no scroll offset rather than cropping the wrong region', () => {
    const result = resolveClip({ clip: { x: 0, y: 0, width: 10, height: 10 }, clipSpace: 'viewport' })
    expect(result).toMatchObject({ ok: false, code: 'missing-scroll' })
    expect(result.ok === false && result.message).toContain('document-relative')
  })

  it('honours an explicit captureBeyondViewport over the default', () => {
    expect(resolveClip({ clip: { x: 0, y: 0, width: 1, height: 1 }, captureBeyondViewport: false })).toMatchObject({
      captureBeyondViewport: false,
    })
  })

  it('rejects a degenerate or non-finite clip', () => {
    expect(resolveClip({ clip: { x: 0, y: 0, width: 0, height: 10 } })).toMatchObject({ ok: false, code: 'invalid-clip' })
    expect(resolveClip({ clip: { x: 0, y: 0, width: 10, height: Number.NaN } })).toMatchObject({
      ok: false,
      code: 'invalid-clip',
    })
  })

  it('keeps scale when supplied and omits it otherwise', () => {
    const withScale = resolveClip({ clip: { x: 0, y: 0, width: 4, height: 4, scale: 2 } })
    expect(withScale.ok && withScale.clip).toEqual({ x: 0, y: 0, width: 4, height: 4, scale: 2 })
    const without = resolveClip({ clip: { x: 0, y: 0, width: 4, height: 4 } })
    // No `scale: undefined` key at all — the wire payload stays minimal.
    expect(without.ok && Object.keys(without.clip ?? {})).toEqual(['x', 'y', 'width', 'height'])
  })
})

describe('M0.7 captureScreenshot', () => {
  const pngBase64 = Buffer.from('0123456789').toString('base64')

  it('sends the resolved clip, the explicit beyond flag and the session id', async () => {
    const fake = scripted({ 'Page.captureScreenshot': () => ({ data: pngBase64 }) })
    const result = await captureScreenshot(fake.call, 'S-1', {
      clip: { x: 1, y: 2, width: 3, height: 4 },
      clipSpace: 'viewport',
      scroll: { x: 10, y: 20 },
    })
    expect(fake.last()).toEqual({
      method: 'Page.captureScreenshot',
      params: {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 11, y: 22, width: 3, height: 4 },
      },
      sessionId: 'S-1',
    })
    expect(result).toMatchObject({ ok: true, bytes: 10, captureBeyondViewport: true })
  })

  it('passes jpeg quality only for jpeg', async () => {
    const fake = scripted({ 'Page.captureScreenshot': () => ({ data: pngBase64 }) })
    await captureScreenshot(fake.call, undefined, { format: 'jpeg', quality: 70 })
    expect(fake.last()!.params).toEqual({ format: 'jpeg', captureBeyondViewport: false, quality: 70 })

    const png = scripted({ 'Page.captureScreenshot': () => ({ data: pngBase64 }) })
    await captureScreenshot(png.call, undefined, { format: 'png', quality: 70 })
    expect(png.last()!.params).toEqual({ format: 'png', captureBeyondViewport: false })
  })

  it('refuses before the round trip when a viewport clip has no scroll', async () => {
    const fake = scripted({})
    const result = await captureScreenshot(fake.call, undefined, {
      clip: { x: 0, y: 0, width: 5, height: 5 },
      clipSpace: 'viewport',
    })
    expect(result).toMatchObject({ ok: false, code: 'missing-scroll' })
    expect(fake.calls).toHaveLength(0)
  })

  it('treats an empty image body as a failure, not a zero-byte success', async () => {
    const fake = scripted({ 'Page.captureScreenshot': () => ({}) })
    expect(await captureScreenshot(fake.call, undefined, {})).toMatchObject({ ok: false, code: 'empty-screenshot' })
  })

  it('maps a CDP error to screenshot-failed', async () => {
    const fake = scripted({
      'Page.captureScreenshot': () => {
        throw new Error('capture beyond viewport is disabled')
      },
    })
    expect(await captureScreenshot(fake.call, undefined, {})).toMatchObject({ ok: false, code: 'screenshot-failed' })
  })

  it('reads the scroll offset through Runtime.evaluate', async () => {
    const fake = scripted({ 'Runtime.evaluate': () => ({ result: { value: [12, 34] } }) })
    expect(await readScrollOffset(fake.call, 'S-1')).toEqual({ ok: true, x: 12, y: 34 })
    expect(fake.last()!.params).toMatchObject({ returnByValue: true })
  })

  it('reports an unreadable scroll offset instead of assuming zero', async () => {
    const fake = scripted({ 'Runtime.evaluate': () => ({ result: { value: ['nope', null] } }) })
    expect(await readScrollOffset(fake.call, undefined)).toMatchObject({ ok: false, code: 'scroll-unreadable' })
  })
})

// ── M0.7 Overlay: highlightConfig is mandatory ──────────────────────────────

describe('M0.7 Overlay', () => {
  it('refuses highlightNode without a config, and never calls the browser', async () => {
    const fake = scripted({})
    const result = await highlightNode(fake.call, { backendNodeId: 1 })
    expect(result).toMatchObject({ ok: false, code: 'highlight-config-missing' })
    expect(fake.calls).toHaveLength(0)
  })

  it('refuses highlightNode without a target', async () => {
    const fake = scripted({})
    expect(await highlightNode(fake.call, { config: NEUTRAL_HIGHLIGHT_CONFIG })).toMatchObject({
      ok: false,
      code: 'highlight-target-missing',
    })
  })

  it('records the raw return value of a highlight', async () => {
    const fake = scripted({ 'Overlay.highlightNode': () => ({ ok: 'raw-reply' }) })
    const result = await highlightNode(fake.call, { backendNodeId: 42, config: NEUTRAL_HIGHLIGHT_CONFIG })
    expect(result).toMatchObject({ ok: true, code: 'ok', value: { ok: 'raw-reply' } })
    expect(fake.last()!.params).toMatchObject({ backendNodeId: 42, highlightConfig: NEUTRAL_HIGHLIGHT_CONFIG })
  })

  it('refuses setInspectMode without a config — even for mode none', async () => {
    const fake = scripted({})
    const result = await setInspectMode(fake.call, { mode: 'none' })
    expect(result).toMatchObject({ ok: false, code: 'highlight-config-missing' })
    expect(fake.calls).toHaveLength(0)
  })

  it('sends searchForNode with the config and records the reply', async () => {
    const fake = scripted({ 'Overlay.setInspectMode': () => ({ highlighted: true }) })
    const result = await setInspectMode(fake.call, { mode: 'searchForNode', config: NEUTRAL_HIGHLIGHT_CONFIG, sessionId: 'S-1' })
    expect(result).toMatchObject({ ok: true, value: { highlighted: true } })
    expect(fake.last()).toMatchObject({
      method: 'Overlay.setInspectMode',
      params: { mode: 'searchForNode', highlightConfig: NEUTRAL_HIGHLIGHT_CONFIG },
      sessionId: 'S-1',
    })
  })

  it('accepts the neutral "off" config for mode none', async () => {
    const fake = scripted({ 'Overlay.setInspectMode': () => ({}) })
    expect(await setInspectMode(fake.call, { mode: 'none', config: DISABLED_HIGHLIGHT_CONFIG })).toMatchObject({ ok: true })
  })

  it('maps a CDP rejection to an explicit code', async () => {
    const fake = scripted({
      'Overlay.setInspectMode': () => {
        throw new Error('Internal error: highlight configuration parameter is missing')
      },
    })
    const result = await setInspectMode(fake.call, { mode: 'searchForNode', config: NEUTRAL_HIGHLIGHT_CONFIG })
    expect(result).toMatchObject({ ok: false, code: 'inspect-mode-failed' })
    expect(result.message).toContain('highlight configuration parameter is missing')
  })
})

// ── M0.7 binding: page → host, push-based ───────────────────────────────────

describe('M0.7 Runtime.addBinding', () => {
  it('rejects an empty binding name', async () => {
    const fake = scripted({})
    expect(await addBinding(fake.call, '  ')).toMatchObject({ ok: false, code: 'binding-name-missing' })
    expect(fake.calls).toHaveLength(0)
  })

  it('registers a named binding and records the reply', async () => {
    const fake = scripted({ 'Runtime.addBinding': () => ({}) })
    expect(await addBinding(fake.call, 'dshPick', { sessionId: 'S-9' })).toMatchObject({ ok: true })
    expect(fake.last()).toMatchObject({ method: 'Runtime.addBinding', params: { name: 'dshPick' }, sessionId: 'S-9' })
  })

  it('delivers only the named binding payload, without polling', () => {
    const dispatcher = new EventDispatcher()
    const seen: Array<{ payload: string }> = []
    onBindingCalled(dispatcher, 'dshPick', (params) => seen.push({ payload: params.payload }))
    dispatcher.dispatch('Runtime.bindingCalled', { name: 'someoneElse', payload: '{"n":1}' }, 'S-1')
    dispatcher.dispatch('Runtime.bindingCalled', { name: 'dshPick', payload: '{"selector":"#kw"}', executionContextId: 3 }, 'S-1')
    expect(seen).toEqual([{ payload: '{"selector":"#kw"}' }])
  })

  it('normalises a malformed binding payload instead of throwing', () => {
    const dispatcher = new EventDispatcher()
    const seen: string[] = []
    onBindingCalled(dispatcher, 'dshPick', (params) => seen.push(params.payload))
    dispatcher.dispatch('Runtime.bindingCalled', { name: 'dshPick' }, undefined)
    expect(seen).toEqual([''])
  })
})

// ── M0.5 DOM ────────────────────────────────────────────────────────────────

describe('M0.5 hit testing + identity', () => {
  it('resolves a point to a backendNodeId', async () => {
    const fake = scripted({ 'DOM.getNodeForLocation': () => ({ backendNodeId: 77, nodeId: 5, frameId: 'F1' }) })
    expect(await nodeAtPoint(fake.call, 'S-1', 12.6, 40.2)).toEqual({
      ok: true,
      backendNodeId: 77,
      nodeId: 5,
      frameId: 'F1',
    })
    expect(fake.last()!.params).toMatchObject({ x: 13, y: 40 })
  })

  it('rejects a non-finite point without a round trip', async () => {
    const fake = scripted({})
    expect(await nodeAtPoint(fake.call, undefined, Number.NaN, 1)).toMatchObject({ ok: false, code: 'invalid-point' })
    expect(fake.calls).toHaveLength(0)
  })

  it('reports "nothing there" distinctly from a transport error', async () => {
    const empty = scripted({ 'DOM.getNodeForLocation': () => ({ nodeId: 0 }) })
    expect(await nodeAtPoint(empty.call, undefined, 1, 1)).toMatchObject({ ok: false, code: 'no-node-at-point' })

    const broken = scripted({
      'DOM.getNodeForLocation': () => {
        throw new Error('session closed')
      },
    })
    expect(await nodeAtPoint(broken.call, undefined, 1, 1)).toMatchObject({ ok: false, code: 'hit-test-failed' })
  })

  it('builds semantics from describeNode attributes', async () => {
    const fake = scripted({
      'DOM.describeNode': () => ({
        node: { nodeName: 'BUTTON', attributes: ['id', 'go', 'aria-label', 'Search', 'tabindex', '0'] },
      }),
    })
    expect(await describeNode(fake.call, 'S-1', { backendNodeId: 3 })).toEqual({
      ok: true,
      tag: 'button',
      id: 'go',
      role: '',
      name: 'Search',
      keyboardFocusable: true,
      attributes: { id: 'go', 'aria-label': 'Search', tabindex: '0' },
    })
  })

  it('requires a node reference and reports a missing node', async () => {
    const fake = scripted({ 'DOM.describeNode': () => ({}) })
    expect(await describeNode(fake.call, undefined, {})).toMatchObject({ ok: false, code: 'node-ref-missing' })
    expect(await describeNode(fake.call, undefined, { backendNodeId: 1 })).toMatchObject({ ok: false, code: 'node-not-found' })
  })

  it('subtracts scroll from the box and never invents a bottom edge', async () => {
    const fake = scripted({ 'DOM.getBoxModel': () => ({ model: { content: QUAD } }) })
    const result = await boxModel(fake.call, 'S-1', { backendNodeId: 9 }, { scroll: { x: 10, y: 20 } })
    expect(result).toEqual({
      ok: true,
      documentRect: { x: 10, y: 20, width: 100, height: 50 },
      rect: { x: 0, y: 0, width: 100, height: 50 },
    })
    expect(result.ok && Object.keys(result.rect)).toEqual(['x', 'y', 'width', 'height'])
  })

  it('reports an unusable quad', async () => {
    const fake = scripted({ 'DOM.getBoxModel': () => ({ model: { content: [1, 2] } }) })
    expect(await boxModel(fake.call, undefined, { backendNodeId: 9 })).toMatchObject({ ok: false, code: 'no-box-model' })
  })

  it('flattens the AX tree into role/name/focusable', async () => {
    const nodes = flattenAxTree([
      { nodeId: '1', role: { value: 'button' }, name: { value: 'Go' }, ignored: false, properties: [{ name: 'focusable', value: { value: true } }] },
      { nodeId: '2', role: { value: 'generic' }, ignored: true },
    ])
    expect(nodes).toEqual([
      { nodeId: '1', role: 'button', name: 'Go', ignored: false, keyboardFocusable: true },
      { nodeId: '2', role: 'generic', name: '', ignored: true, keyboardFocusable: false },
    ])
  })

  it('fetches the AX tree and reports a malformed reply', async () => {
    const good = scripted({ 'Accessibility.getFullAXTree': () => ({ nodes: [{ nodeId: '1', role: { value: 'link' } }] }) })
    expect(await accessibilityTree(good.call, 'S-1')).toMatchObject({ ok: true, nodes: [{ role: 'link' }] })

    const bad = scripted({ 'Accessibility.getFullAXTree': () => ({}) })
    expect(await accessibilityTree(bad.call, undefined)).toMatchObject({ ok: false, code: 'ax-tree-missing' })
  })
})

// ── M0.6 input ──────────────────────────────────────────────────────────────

describe('M0.6 mouse params', () => {
  it('rounds coordinates and derives the held-button mask', () => {
    expect(mouseParams({ type: 'mousePressed', x: 10.4, y: 20.6 })).toEqual({
      type: 'mousePressed',
      x: 10,
      y: 21,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      modifiers: 0,
    })
  })

  it('marks a move as buttonless with no click count', () => {
    expect(mouseParams({ type: 'mouseMoved', x: 0, y: 0 })).toMatchObject({ button: 'none', buttons: 0, clickCount: 0 })
  })

  it('adds deltas only for a wheel event', () => {
    expect(mouseParams({ type: 'mouseWheel', x: 1, y: 1, deltaX: 5, deltaY: -120 })).toMatchObject({ deltaX: 5, deltaY: -120 })
    expect(mouseParams({ type: 'mousePressed', x: 1, y: 1 })).not.toHaveProperty('deltaY')
  })

  it('lets a caller hold a button across a drag', () => {
    expect(mouseParams({ type: 'mouseMoved', x: 1, y: 1, button: 'left', buttons: 1 })).toMatchObject({ buttons: 1 })
  })
})

describe('M0.6 dispatch + text', () => {
  it('carries an explicit timeout on every mouse event', async () => {
    const fake = scripted({ 'Input.dispatchMouseEvent': () => ({}) })
    await dispatchMouse(fake.call, 'S-1', { type: 'mousePressed', x: 5, y: 5, timeoutMs: 1234 })
    expect(fake.last()).toMatchObject({ method: 'Input.dispatchMouseEvent', sessionId: 'S-1', timeoutMs: 1234 })
  })

  it('distinguishes a timeout from a hard failure', async () => {
    const slow = scripted({
      'Input.dispatchMouseEvent': () => {
        throw new Error('CDP Input.dispatchMouseEvent timed out after 5000ms')
      },
    })
    expect(await dispatchMouse(slow.call, undefined, { type: 'mousePressed', x: 1, y: 1 })).toMatchObject({
      ok: false,
      code: 'input-timeout',
    })

    const dead = scripted({
      'Input.dispatchMouseEvent': () => {
        throw new Error('Target closed')
      },
    })
    expect(await dispatchMouse(dead.call, undefined, { type: 'mousePressed', x: 1, y: 1 })).toMatchObject({
      ok: false,
      code: 'input-failed',
    })
  })

  it('rejects a non-finite point without a round trip', async () => {
    const fake = scripted({})
    expect(await dispatchMouse(fake.call, undefined, { type: 'mouseMoved', x: Number.NaN, y: 0 })).toMatchObject({
      ok: false,
      code: 'invalid-point',
    })
    expect(fake.calls).toHaveLength(0)
  })

  it('types through Input.insertText, never through a value assignment', async () => {
    const fake = scripted({ 'Input.insertText': () => ({}) })
    expect(await insertText(fake.call, 'S-1', 'hello')).toMatchObject({ ok: true })
    expect(fake.methods()).toEqual(['Input.insertText'])
    // The whole point: no Runtime.evaluate, no `.value =` — a page script would
    // be invisible to controlled inputs.
    expect(fake.methods()).not.toContain('Runtime.evaluate')
  })

  it('refuses an empty insertion', async () => {
    const fake = scripted({})
    expect(await insertText(fake.call, undefined, '')).toMatchObject({ ok: false, code: 'empty-text' })
    expect(fake.calls).toHaveLength(0)
  })

  it('focuses before inserting, in that order', async () => {
    const fake = scripted({ 'DOM.focus': () => ({}), 'Input.insertText': () => ({}) })
    expect(await fillText(fake.call, 'S-1', 12, 'kw')).toMatchObject({ ok: true })
    expect(fake.methods()).toEqual(['DOM.focus', 'Input.insertText'])
    expect(fake.calls[0]!.params).toEqual({ backendNodeId: 12 })
  })

  it('stops before inserting when the focus step fails', async () => {
    const fake = scripted({
      'DOM.focus': () => {
        throw new Error('Node is detached')
      },
    })
    expect(await fillText(fake.call, undefined, 12, 'kw')).toMatchObject({ ok: false, code: 'focus-failed' })
    expect(fake.methods()).toEqual(['DOM.focus'])
  })
})

describe('M0.6 clickAt: timed steps + hit re-check', () => {
  const happy = {
    'Input.dispatchMouseEvent': () => ({}),
    'DOM.getNodeForLocation': () => ({ backendNodeId: 55 }),
  }

  it('walks move → press → release and re-checks the hit', async () => {
    const fake = scripted(happy)
    const result = await clickAt(fake.call, 'S-1', { point: { x: 4, y: 9 }, expectedBackendNodeId: 55 })
    expect(result).toMatchObject({ ok: true, hit: 'verified', backendNodeId: 55, steps: ['mouseMoved', 'mousePressed', 'mouseReleased'] })
    expect(fake.methods()).toEqual([
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'DOM.getNodeForLocation',
    ])
  })

  it('marks the click unverified when no expectation was supplied', async () => {
    const fake = scripted(happy)
    expect(await clickAt(fake.call, undefined, { point: { x: 1, y: 1 } })).toMatchObject({ ok: true, hit: 'unverified' })
  })

  it('reports click-missed when the point resolves to a different node', async () => {
    const fake = scripted({ ...happy, 'DOM.getNodeForLocation': () => ({ backendNodeId: 99 }) })
    const result = await clickAt(fake.call, undefined, { point: { x: 1, y: 1 }, expectedBackendNodeId: 55 })
    expect(result).toMatchObject({ ok: false, code: 'click-missed' })
    expect(result.ok === false && result.message).toContain('99')
  })

  it('names the failing step instead of a bare boolean', async () => {
    let seen = 0
    const fake = scripted({
      'Input.dispatchMouseEvent': () => {
        seen += 1
        if (seen === 2) throw new Error('CDP Input.dispatchMouseEvent timed out after 5000ms')
        return {}
      },
      'DOM.getNodeForLocation': () => ({ backendNodeId: 1 }),
    })
    const result = await clickAt(fake.call, undefined, { point: { x: 1, y: 1 } })
    expect(result).toMatchObject({ ok: false, code: 'input-timeout' })
    expect(result.ok === false && result.message).toContain('mousePressed step failed')
    expect(fake.methods()).not.toContain('DOM.getNodeForLocation')
  })
})
