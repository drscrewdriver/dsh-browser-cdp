/**
 * src/jev/act.ts — 阶段 10: turn a judge's answer back into a real action.
 *
 * This module is where the frame contract's central promise is either kept or
 * broken. The judge answers with a number `n`; this file must convert that into
 * a click, a fill, or a scroll on a page whose layout may have changed since
 * the screenshot the judge was looking at.
 *
 * ── The one rule ───────────────────────────────────────────────────────────
 *
 * **A frame rect is never used as a click target.** `frame.ts` says so and this
 * file is where it is enforced. Every action re-measures:
 *
 *     backendNodeId  →  DOM.getBoxModel (fresh)  →  point in VIEWPORT space
 *                    →  DOM.getNodeForLocation    →  is it still the same node?
 *
 * The last step is what makes a stale frame safe rather than merely detectable:
 * if the element moved, we click where it IS; if something else is now on top of
 * it, we refuse with `click-missed` instead of clicking through an overlay.
 *
 * ── Why the answer is validated before anything is dispatched ──────────────
 *
 * `n` comes from a model, so it can be absent, out of range, or describe an
 * element that is disabled or already ruled out. Each of those is a distinct
 * outcome here, and each returns without touching the page. The failure this
 * prevents is subtle: clicking "something nearby" because `n` was slightly
 * wrong produces a plausible-looking trace that is silently acting on the
 * wrong element.
 */

import { type BoxOutcome, boxModel, nodeAtPoint } from '../cdp/dom.ts'
import { type InputResult, type MouseButton, clickAt, fillText, wheel } from '../cdp/input.ts'
import type { PageCall } from '../cdp/page.ts'
import type { Frame, FrameNode } from './frame.ts'

/** The distinct ways an action can decline to happen. */
export type ActCode =
  | 'ok'
  | 'no-answer'
  | 'candidate-not-found'
  | 'candidate-excluded'
  | 'candidate-disabled'
  | 'no-box-model'
  | 'click-missed'
  | 'input-timeout'
  | 'input-failed'
  | 'hit-test-failed'

export interface ActOk {
  ok: true
  code: 'ok'
  /** What was done, for the history line. */
  action: 'click' | 'fill' | 'scroll'
  n: number
  backendNodeId: number
  point: { x: number; y: number }
  /** The freshly measured rect — NOT the frame's. Recorded so a trace shows the drift. */
  measured: { x: number; y: number; width: number; height: number }
  /** How far the element moved between capture and action, in CSS px. Diagnostic. */
  drift: number
}

export interface ActFailure {
  ok: false
  code: Exclude<ActCode, 'ok'>
  message: string
  n: number
}

export type ActOutcome = ActOk | ActFailure

/**
 * Pick the candidate a judge referred to.
 *
 * Out of range is a FAILURE, not a wrap or a clamp. A judge that answered `99`
 * on a 20-element frame did not mean element 19; treating it as 19 is how a
 * hallucinated index turns into a real click.
 */
export function resolveCandidate(
  frame: Frame,
  n: number,
  excluded: readonly number[] = [],
): { ok: true; node: FrameNode } | ActFailure {
  if (!Number.isInteger(n) || n < 1) {
    return { ok: false, code: 'no-answer', message: `candidate index must be a positive integer (got ${n})`, n }
  }
  const node = frame.dom.nodes.find((candidate) => candidate.n === n)
  if (node === undefined) {
    return {
      ok: false,
      code: 'candidate-not-found',
      message: `no candidate ${n} in frame ${frame.frameId} (it has ${frame.dom.nodes.length})`,
      n,
    }
  }
  if (excluded.includes(n)) {
    return { ok: false, code: 'candidate-excluded', message: `candidate ${n} was already ruled out`, n }
  }
  return { ok: true, node }
}

export interface ActionDeps {
  call: PageCall
  sessionId: string | undefined
  timeoutMs?: number
  button?: MouseButton
}

/**
 * Click a candidate, re-measuring first.
 *
 * Sequence, and why each step is here:
 *   1. `resolveCandidate` — the number is real and not excluded.
 *   2. `DOM.getBoxModel` with the CURRENT scroll offset — the element's position
 *      NOW, in viewport space. `boxModel` does the scroll subtraction itself.
 *   3. `DOM.getNodeForLocation` at the measured centre — is the element still
 *      the topmost thing at that point? This is what catches an overlay.
 *   4. `clickAt` with `expectedBackendNodeId` — a second hit check after the
 *      click, so a mid-flight re-layout is reported as `click-missed`.
 */
export async function clickCandidate(
  deps: ActionDeps,
  frame: Frame,
  n: number,
  options: { excluded?: readonly number[]; scroll?: { x: number; y: number } } = {},
): Promise<ActOutcome> {
  const resolved = resolveCandidate(frame, n, options.excluded ?? [])
  if (!resolved.ok) return resolved
  const { node } = resolved
  if (node.state.disabled) {
    // Checked before dispatching. A disabled element's click is silently
    // swallowed by the browser, which then looks like "the loop did nothing".
    return { ok: false, code: 'candidate-disabled', message: `candidate ${n} (${node.role} "${node.name}") is disabled`, n }
  }

  const measured = await measure(deps, node, options.scroll)
  if (!measured.ok) return { ok: false, code: 'no-box-model', message: measured.message, n }

  const point = centreOf(measured.rect)
  // Pre-click hit test: the same check `clickAt` does afterwards, run BEFORE
  // dispatching so an overlay costs nothing instead of costing a stray click.
  const hit = await nodeAtPoint(deps.call, deps.sessionId, point.x, point.y, deps.timeoutMs)
  if (!hit.ok) return { ok: false, code: 'hit-test-failed', message: hit.message, n }
  if (hit.backendNodeId !== node.backendNodeId) {
    return {
      ok: false,
      code: 'click-missed',
      message:
        `candidate ${n} measured to ${point.x},${point.y} but that point resolves to ` +
        `backendNodeId ${hit.backendNodeId} — something is on top of it or the page moved`,
      n,
    }
  }

  const clicked = await clickAt(deps.call, deps.sessionId, {
    point,
    expectedBackendNodeId: node.backendNodeId,
    ...(deps.button === undefined ? {} : { button: deps.button }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
  })
  if (!clicked.ok) {
    // `click-missed` and `input-timeout` are different problems: one means the
    // page changed, the other means the channel is stuck. Both are surfaced.
    const code = clicked.code === 'click-missed' ? 'click-missed' : clicked.code === 'input-timeout' ? 'input-timeout' : 'input-failed'
    return { ok: false, code, message: clicked.message, n }
  }

  return {
    ok: true,
    code: 'ok',
    action: 'click',
    n,
    backendNodeId: node.backendNodeId,
    point,
    measured: measured.rect,
    drift: driftOf(node.rect, measured.rect),
  }
}

/** Fill a candidate, re-measuring and re-resolving the node first. */
export async function fillCandidate(
  deps: ActionDeps,
  frame: Frame,
  n: number,
  text: string,
  options: { excluded?: readonly number[]; scroll?: { x: number; y: number } } = {},
): Promise<ActOutcome> {
  const resolved = resolveCandidate(frame, n, options.excluded ?? [])
  if (!resolved.ok) return resolved
  const { node } = resolved
  if (node.state.disabled) {
    return { ok: false, code: 'candidate-disabled', message: `candidate ${n} is disabled`, n }
  }

  const measured = await measure(deps, node, options.scroll)
  if (!measured.ok) return { ok: false, code: 'no-box-model', message: measured.message, n }
  const point = centreOf(measured.rect)

  if (text === '') return { ok: false, code: 'input-failed', message: 'fill called with empty text', n }

  // `fillText` focuses by backendNodeId then inserts. The backend id came from
  // this frame, but the NODE was just confirmed to still exist at the measured
  // point — that confirmation is why a stale id is safe to reuse here.
  const filled: InputResult = await fillText(deps.call, deps.sessionId, node.backendNodeId, text, deps.timeoutMs ?? 5000)
  if (!filled.ok) {
    return { ok: false, code: filled.code === 'input-timeout' ? 'input-timeout' : 'input-failed', message: filled.message, n }
  }

  return {
    ok: true,
    code: 'ok',
    action: 'fill',
    n,
    backendNodeId: node.backendNodeId,
    point,
    measured: measured.rect,
    drift: driftOf(node.rect, measured.rect),
  }
}

/** Scroll the page. Not tied to a candidate — the control option `scroll` uses this. */
export async function scrollPage(deps: ActionDeps, deltaY: number): Promise<ActOutcome> {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return { ok: false, code: 'input-failed', message: `scroll needs a non-zero delta (got ${deltaY})`, n: 0 }
  }
  // A wheel event needs a point to be dispatched at; the viewport centre is the
  // neutral choice and does not require measuring anything.
  const outcome = await wheel(deps.call, deps.sessionId, {
    x: 0,
    y: 0,
    deltaX: 0,
    deltaY,
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
  })
  if (!outcome.ok) {
    return { ok: false, code: outcome.code === 'input-timeout' ? 'input-timeout' : 'input-failed', message: outcome.message, n: 0 }
  }
  return {
    ok: true,
    code: 'ok',
    action: 'scroll',
    n: 0,
    backendNodeId: 0,
    point: { x: 0, y: 0 },
    measured: { x: 0, y: 0, width: 0, height: 0 },
    drift: 0,
  }
}

// ── measuring ──────────────────────────────────────────────────────────────

async function measure(
  deps: ActionDeps,
  node: FrameNode,
  scroll: { x: number; y: number } | undefined,
): Promise<{ ok: true; rect: { x: number; y: number; width: number; height: number } } | { ok: false; message: string }> {
  const outcome: BoxOutcome = await boxModel(
    deps.call,
    deps.sessionId,
    { backendNodeId: node.backendNodeId },
    {
      // When the caller does not supply the scroll offset we ask for scroll 0,
      // which yields a DOCUMENT-space rect. That is still correct for hit
      // testing only when the page has not scrolled — so the caller is expected
      // to pass the frame's own scroll. Documented rather than guessed at.
      ...(scroll === undefined ? {} : { scroll }),
      ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
    },
  )
  if (!outcome.ok) return { ok: false, message: outcome.message }
  return { ok: true, rect: outcome.rect }
}

const centreOf = (rect: { x: number; y: number; width: number; height: number }): { x: number; y: number } => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
})

/**
 * How far the element moved between capture and action, in CSS px.
 *
 * Reported, never used to decide. A large drift is the signal that the page
 * changed under the judge — worth putting in the trace, not worth acting on.
 */
function driftOf(
  captured: { x: number; y: number } | null,
  measured: { x: number; y: number },
): number {
  if (captured === null) return 0
  return Math.round(Math.hypot(measured.x - captured.x, measured.y - captured.y) * 100) / 100
}

/**
 * Build a history line for the loop from an outcome.
 *
 * Lives here rather than in `prompt.ts` because it is a projection of THIS
 * module's result shape; `prompt.ts` only needs the small `HistoryStep`.
 */
export function toHistoryNote(outcome: ActOutcome): { action: string; n: number; ok: boolean; note: string } {
  if (outcome.ok) {
    if (outcome.action === 'scroll') {
      return { action: 'scroll', n: 0, ok: true, note: 'page scrolled; the frame will be recaptured' }
    }
    const drift = outcome.drift > 1 ? ` (element had drifted ${outcome.drift}px since capture)` : ''
    return { action: outcome.action, n: outcome.n, ok: true, note: `${outcome.action} dispatched${drift}` }
  }
  return { action: 'none', n: outcome.n, ok: false, note: `${outcome.code}: ${outcome.message}` }
}
