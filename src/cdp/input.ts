/**
 * src/cdp/input.ts — M0.6: mouse and text input.
 *
 * Acceptance (decomposition.md `M0.6`): `dispatchMouseEvent`
 * (move/press/release/wheel) + `insertText`; **direct `.value` assignment is
 * forbidden**; every click carries a timeout and a hit re-check.
 *
 * The two rules worth explaining:
 *
 *  - **No `.value = …` anywhere.** Assigning a DOM value is invisible to
 *    React-style controlled inputs (they re-render from their own state and
 *    wipe it) and fires no `input`/`change` events, so the page believes the
 *    field is empty while the screenshot shows text. `Input.insertText` is a
 *    real input event, so it is the only text path this module exposes — there
 *    is deliberately no direct-value helper to reach for.
 *  - **Clicks are verified, not assumed.** `Input.dispatchMouseEvent` acks as
 *    soon as the event is queued, so a "successful" click can still land on an
 *    overlay or miss after a re-layout. Each click therefore re-checks the
 *    point with `DOM.getNodeForLocation` and reports `click-missed` rather than
 *    leaving the caller to wonder which of the two happened.
 */

import type { LayerFailure, PageCall } from './page.ts'
import { nodeAtPoint } from './dom.ts'

export interface Point {
  x: number
  y: number
}

export type MouseButton = 'none' | 'left' | 'middle' | 'right' | 'back' | 'forward'
export type MouseEventType = 'mouseMoved' | 'mousePressed' | 'mouseReleased' | 'mouseWheel'

export interface InputResult {
  ok: boolean
  code: string
  message: string
  /** The raw CDP reply, always recorded. */
  value: unknown
}

function inputFailure(code: string, message: string): InputResult {
  return { ok: false, code, message, value: null }
}

export interface MouseOptions {
  type: MouseEventType
  x: number
  y: number
  button?: MouseButton
  clickCount?: number
  /** Sum of the pressed buttons bitmask, per the CDP spec. */
  buttons?: number
  modifiers?: number
  deltaX?: number
  deltaY?: number
  sessionId?: string
  timeoutMs?: number
}

const BUTTON_MASK: Record<MouseButton, number> = {
  none: 0,
  left: 1,
  middle: 4,
  right: 2,
  back: 8,
  forward: 16,
}

/**
 * Build the wire params for one mouse event.
 *
 * `buttons` (the bitmask of what is currently held) is derived from the event
 * type and button unless the caller overrides it — Chrome distinguishes "which
 * button changed" from "which buttons are down", and getting that wrong makes
 * drags silently do nothing.
 */
export function mouseParams(options: MouseOptions): Record<string, unknown> {
  const button = options.button ?? (options.type === 'mouseMoved' || options.type === 'mouseWheel' ? 'none' : 'left')
  const held = options.buttons ?? (options.type === 'mousePressed' ? BUTTON_MASK[button] : 0)
  const params: Record<string, unknown> = {
    type: options.type,
    x: Math.round(options.x),
    y: Math.round(options.y),
    button,
    buttons: held,
    clickCount: options.clickCount ?? (options.type === 'mouseMoved' ? 0 : 1),
    modifiers: options.modifiers ?? 0,
  }
  if (options.type === 'mouseWheel') {
    params.deltaX = options.deltaX ?? 0
    params.deltaY = options.deltaY ?? 0
  }
  return params
}

export async function dispatchMouse(
  call: PageCall,
  sessionId: string | undefined,
  options: MouseOptions,
): Promise<InputResult> {
  if (!Number.isFinite(options.x) || !Number.isFinite(options.y)) {
    return inputFailure('invalid-point', `mouse point must be finite numbers (got ${options.x},${options.y})`)
  }
  const timeoutMs = options.timeoutMs ?? 5000
  try {
    const value = await call('Input.dispatchMouseEvent', mouseParams(options), {
      ...(sessionId === undefined ? {} : { sessionId }),
      timeoutMs,
    })
    return { ok: true, code: 'ok', message: '', value }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A timeout is NOT "the click did not happen" — it is "we stopped waiting".
    // Callers need that distinction, so it gets its own code.
    const code = /timed out/i.test(message) ? 'input-timeout' : 'input-failed'
    return inputFailure(code, `${options.type} at ${options.x},${options.y}: ${message}`)
  }
}

export const moveMouse = (call: PageCall, sessionId: string | undefined, options: Omit<MouseOptions, 'type'>): Promise<InputResult> =>
  dispatchMouse(call, sessionId, { ...options, type: 'mouseMoved' })

export const pressMouse = (call: PageCall, sessionId: string | undefined, options: Omit<MouseOptions, 'type'>): Promise<InputResult> =>
  dispatchMouse(call, sessionId, { ...options, type: 'mousePressed' })

export const releaseMouse = (call: PageCall, sessionId: string | undefined, options: Omit<MouseOptions, 'type'>): Promise<InputResult> =>
  dispatchMouse(call, sessionId, { ...options, type: 'mouseReleased' })

export const wheel = (call: PageCall, sessionId: string | undefined, options: Omit<MouseOptions, 'type'>): Promise<InputResult> =>
  dispatchMouse(call, sessionId, { ...options, type: 'mouseWheel' })

/** Insert text as a real input event. The ONLY text path this module offers. */
export async function insertText(
  call: PageCall,
  sessionId: string | undefined,
  text: string,
  timeoutMs = 5000,
): Promise<InputResult> {
  if (text === '') return inputFailure('empty-text', 'insertText called with nothing to insert')
  try {
    const value = await call('Input.insertText', { text }, { ...(sessionId === undefined ? {} : { sessionId }), timeoutMs })
    return { ok: true, code: 'ok', message: '', value }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return inputFailure(/timed out/i.test(message) ? 'input-timeout' : 'input-failed', message)
  }
}

/** Focus a node so a following `insertText` lands in the right field. */
export async function focusNode(
  call: PageCall,
  sessionId: string | undefined,
  backendNodeId: number,
  timeoutMs = 5000,
): Promise<InputResult> {
  try {
    const value = await call('DOM.focus', { backendNodeId }, {
      ...(sessionId === undefined ? {} : { sessionId }),
      timeoutMs,
    })
    return { ok: true, code: 'ok', message: '', value }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return inputFailure(/timed out/i.test(message) ? 'input-timeout' : 'focus-failed', message)
  }
}

/** Focus, then insert. Text is never assigned to `.value` directly. */
export async function fillText(
  call: PageCall,
  sessionId: string | undefined,
  backendNodeId: number,
  text: string,
  timeoutMs = 5000,
): Promise<InputResult> {
  const focused = await focusNode(call, sessionId, backendNodeId, timeoutMs)
  if (!focused.ok) return focused
  return insertText(call, sessionId, text, timeoutMs)
}

export interface ClickOk {
  ok: true
  point: Point
  /** `verified` when an expected node was supplied and re-checked. */
  hit: 'verified' | 'unverified'
  backendNodeId: number
  steps: MouseEventType[]
}

export interface ClickOptions {
  point: Point
  /**
   * When supplied, the point is re-checked after the click. A different node
   * means the click landed on something else (an overlay, or a re-layout).
   */
  expectedBackendNodeId?: number
  button?: MouseButton
  clickCount?: number
  sessionId?: string
  timeoutMs?: number
}

export type ClickResult = ClickOk | LayerFailure

/**
 * Move → press → release, each step individually timed out, then re-check the
 * hit. Returns which step failed instead of a bare boolean, so a caller can
 * tell "the input channel is stuck" from "the page moved under me".
 */
export async function clickAt(
  call: PageCall,
  sessionId: string | undefined,
  options: ClickOptions,
): Promise<ClickResult> {
  const { point } = options
  const timeoutMs = options.timeoutMs ?? 5000
  const steps: MouseEventType[] = []
  const base = {
    x: point.x,
    y: point.y,
    ...(options.button === undefined ? {} : { button: options.button }),
    ...(options.clickCount === undefined ? {} : { clickCount: options.clickCount }),
    timeoutMs,
  }

  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const) {
    const outcome = await dispatchMouse(call, sessionId, { ...base, type })
    if (!outcome.ok) return { ok: false, code: outcome.code, message: `${type} step failed: ${outcome.message}` }
    steps.push(type)
  }

  const hit = await nodeAtPoint(call, sessionId, point.x, point.y, timeoutMs)
  if (!hit.ok) return { ok: false, code: hit.code, message: `hit re-check after click: ${hit.message}` }

  if (options.expectedBackendNodeId !== undefined && hit.backendNodeId !== options.expectedBackendNodeId) {
    return {
      ok: false,
      code: 'click-missed',
      message:
        `click dispatched but ${point.x},${point.y} resolves to backendNodeId ${hit.backendNodeId}, ` +
        `not the expected ${options.expectedBackendNodeId}`,
    }
  }

  return {
    ok: true,
    point,
    hit: options.expectedBackendNodeId === undefined ? 'unverified' : 'verified',
    backendNodeId: hit.backendNodeId,
    steps,
  }
}
