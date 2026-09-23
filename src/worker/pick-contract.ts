/**
 * src/worker/pick-contract.ts — T5.2: the pick failure contract.
 *
 * Five error CLASSES (spec.md R6): connection / target / arming / hit /
 * describe. Every failure the picker can produce maps into exactly one class,
 * so the panel can show a class-level reason ("connection lost", "nothing
 * there") instead of a raw CDP code. `PickResult` / `PickFailure` are the two
 * shapes a pick attempt can resolve to — a pick is either fully described
 * (G7) or a classified failure; there is no "coordinates only" third state.
 */

/** The five T5.2 error classes, in the order a pick can fail. */
export type PickErrorClass = 'connection' | 'target' | 'arming' | 'hit' | 'describe'

/** Codes the picker itself produces, grouped by class. */
export const PICK_ERROR_CLASSES: Readonly<Record<PickErrorClass, readonly string[]>> = {
  // The resident connection or its worker is not usable at all.
  connection: ['browser-disconnected', 'worker-unavailable', 'connect-failed', 'command-timeout'],
  // No target, or the target the panel pointed at is gone.
  target: ['target-required', 'target-stale', 'no-session', 'no-session-scope'],
  // DOM/Overlay enable or inspect-mode arming failed (F10 domain rules).
  arming: ['enable-failed', 'domain-split', 'inspect-failed', 'highlight-config-missing'],
  // The point resolved to nothing, or was not a point.
  hit: ['no-node-at-point', 'hit-test-failed', 'invalid-point'],
  // The node was hit but its identity could not be resolved (G7: not a pick).
  describe: ['describe-failed', 'empty-describe'],
}

/** Classify a failure code; delivery-side codes classify as their nearest class. */
export function classifyPickError(code: string): PickErrorClass | 'unknown' {
  for (const cls of Object.keys(PICK_ERROR_CLASSES) as PickErrorClass[]) {
    if (PICK_ERROR_CLASSES[cls].includes(code)) return cls
  }
  // Delivery-side codes (client half) map onto the same five classes.
  if (['no-active-session', 'phase-not-plain'].includes(code)) return 'target'
  if (['no-conversation-service', 'no-input-facade', 'bad-action', 'deliver-failed'].includes(code)) return 'describe'
  return 'unknown'
}

/** A pick that resolved to a fully described element (G7-clean). */
export interface PickResult {
  ok: true
  element: {
    backendNodeId: number
    tag: string
    id: string
    role: string
    name: string
    keyboardFocusable: boolean
    rect: { x: number; y: number; width: number; height: number } | null
    describe: string
  }
}

/** A classified failure — never a bare string, never silent. */
export interface PickFailure {
  ok: false
  errorClass: PickErrorClass | 'unknown'
  code: string
  message: string
}

export type PickAttempt = PickResult | PickFailure
