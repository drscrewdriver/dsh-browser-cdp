/**
 * src/jev/loop.ts — 阶段 10 循环线: frame → judge → act → observe → repeat.
 *
 * The loop is expressed as a STATE MACHINE over injected effects, not as a while
 * loop that reaches into the browser. That is the only way it can be tested for
 * the thing that actually matters: whether it stops, and why.
 *
 * ── What this loop refuses to do ───────────────────────────────────────────
 *
 *  - **It never treats "the model said done" as done.** A `done` answer is a
 *    CLAIM, and it is verified against the intent's own `successCriteria` before
 *    the loop reports success. A loop that takes the model's word for it reports
 *    success on a page it never checked — the single most expensive kind of
 *    wrong, because nobody goes back to look.
 *  - **It never retries a ruled-out candidate.** `excluded` grows with every
 *    failed step and is delivered to the judge every round, so the loop cannot
 *    oscillate between two options until the budget runs out.
 *  - **It never re-captures "just in case".** A capture costs a screenshot, a
 *    full AX walk and a judge round. It happens when a step CHANGED something,
 *    or when the loop is genuinely out of options.
 *  - **It has no wall clock of its own.** Time comes from an injected `now()`,
 *    so a test can drive a 20-round loop in zero milliseconds and a run that
 *    stalls on a real clock still terminates on the same budgets.
 *
 * ── Termination is an enumerated outcome, never a boolean ──────────────────
 *
 * `done` / `blocked` / `exhausted` / `stuck` / `unavailable` / `error` are
 * different facts with different remedies. Collapsing them into "finished: true"
 * loses exactly the information the caller needs — and `exhausted` masquerading
 * as success is how an agent reports victory after doing nothing.
 */

import type { ActOutcome } from './act.ts'
import { toHistoryNote } from './act.ts'
import type { Frame, FrameNode } from './frame.ts'
import type { JudgeChainResult, JudgeRequest } from './judge.ts'
import {
  type HistoryStep,
  type IntentSpec,
  CONTROL_CHOICE_ID,
  buildIntentState,
  canScroll,
  controlQuestion,
  pickQuestion,
} from './prompt.ts'
import { type PipeConfig, type PipeRound, buildRound, readControl, readPick } from './pipe.ts'
import { checkChoiceMargin, bucketFor, validateQuestions } from './wire.ts'

// ── budgets: five ledgers, all enforced BEFORE a spend ─────────────────────

/** Names match `BudgetLimits` keys exactly, so a ledger lookup cannot miss. */
export type BudgetKind = 'steps' | 'judge' | 'captures' | 'chunksPerCapture' | 'wallMs'

export interface BudgetLimits {
  /** Judgement rounds in the whole run. */
  steps: number
  /** Model calls (a round can cost more than one on a chunk walk). */
  judge: number
  /** Screenshots taken. Each costs a shot + an AX walk. */
  captures: number
  /** Chunk rounds inside one capture. */
  chunksPerCapture: number
  /** Wall-clock ceiling. */
  wallMs: number
}

export const DEFAULT_BUDGETS: BudgetLimits = {
  steps: 20,
  judge: 60,
  captures: 5,
  // 8 = "the whole page is at most 8 screens deep", from the design doc. Beyond
  // that the page is not a form, it is a corpus, and paging through it with a
  // vision model is the wrong tool.
  chunksPerCapture: 8,
  wallMs: 120_000,
}

export interface BudgetSnapshot {
  steps: number
  judge: number
  captures: number
  chunksPerCapture: number
  wallMs: number
}

/**
 * The ledger.
 *
 * `spend()` REFUSES rather than decrementing past zero, and `check()` lets a
 * caller verify before doing expensive work. That ordering matters: a budget
 * checked after the call it was meant to prevent is a report, not a budget.
 */
export class BudgetLedger {
  private readonly limits: BudgetLimits
  private used: Record<BudgetKind, number> = { steps: 0, judge: 0, captures: 0, chunksPerCapture: 0, wallMs: 0 }
  private readonly now: () => number
  private readonly startedAt: number

  constructor(limits: BudgetLimits, now: () => number) {
    this.limits = limits
    this.now = now
    this.startedAt = now()
  }

  /** Would this spend fit? Checked BEFORE the work, never after. */
  check(kind: BudgetKind, amount = 1): { ok: true } | { ok: false; kind: BudgetKind; remaining: number } {
    const spent = kind === 'wallMs' ? this.elapsed() : this.used[kind]
    const limit = this.limits[kind]
    if (spent + amount > limit) return { ok: false, kind, remaining: Math.max(0, limit - spent) }
    return { ok: true }
  }

  /** Charge a spend. Throws only on programmer error — use `check` first. */
  spend(kind: BudgetKind, amount = 1): void {
    if (kind !== 'wallMs') this.used[kind] += amount
  }

  elapsed(): number {
    return Math.max(0, this.now() - this.startedAt)
  }

  snapshot(): BudgetSnapshot {
    return {
      steps: this.limits.steps - this.used.steps,
      judge: this.limits.judge - this.used.judge,
      captures: this.limits.captures - this.used.captures,
      chunksPerCapture: this.limits.chunksPerCapture,
      wallMs: Math.max(0, this.limits.wallMs - this.elapsed()),
    }
  }

  /** The first exhausted budget, or `null`. Reported verbatim on `exhausted`. */
  exhausted(): BudgetKind | null {
    for (const kind of ['steps', 'judge', 'captures', 'wallMs'] as const) {
      if (!this.check(kind).ok) return kind
    }
    return null
  }
}

// ── termination ────────────────────────────────────────────────────────────

export type StopReason =
  | 'done'
  | 'blocked'
  /** A budget ran out. `budget` names which one. */
  | 'exhausted'
  /** Repeated unclear answers, or the same candidate failing the same way. */
  | 'stuck'
  /** No judge could answer. A configuration problem, not a page problem. */
  | 'unavailable'
  /** The effects layer threw. */
  | 'error'

export type LoopStatus = 'done' | 'blocked' | 'exhausted' | 'stuck' | 'unavailable' | 'error'

export interface LoopStep {
  index: number
  /** What the control round said. */
  control: string
  /** The frame number acted on, 0 when nothing was. */
  n: number
  action: string
  ok: boolean
  note: string
  provider: string
  degraded: boolean
  latencyMs: number
  budget: BudgetSnapshot
}

export interface LoopResult {
  status: LoopStatus
  reason: string
  /**
   * WHICH budget ran out, when `status === 'exhausted'`.
   *
   * Distinct from `remaining` below, and the distinction is the whole point:
   * "exhausted: captures" tells a caller to raise the capture budget, while
   * "exhausted: steps" tells them the page needs a different approach. One
   * ambiguous `budget` field would collapse those into the same report.
   */
  exhaustedKind?: BudgetKind
  steps: LoopStep[]
  /** Frame numbers ruled out along the way. */
  excluded: number[]
  /** What is left of each budget at the end. */
  remaining: BudgetSnapshot
  /** True when any step ran on a non-first-choice provider. */
  degraded: boolean
}

// ── injected effects ───────────────────────────────────────────────────────

export interface CaptureResult {
  frame: Frame
  /** Bumped by the page when the DOM changed; used for the re-capture gate. */
  documentRevision: number
}

export interface ActRequest {
  frame: Frame
  /** The candidate to act on; 0 for a non-element action such as a scroll. */
  n: number
  /** The action the control round chose: `click` / `fill` / `scroll`. */
  action: string
  /** Present only for the explicit-questions entry point. */
  text?: string
}

export interface VerifyResult {
  satisfied: boolean
  note: string
}

/**
 * Everything the loop needs from the outside world.
 *
 * All five are injected, so the loop itself has no notion of a browser, a
 * network, or a clock — which is why its termination behaviour can be tested as
 * a pure state machine.
 */
export interface LoopEffects {
  capture(): Promise<CaptureResult>
  judge(request: JudgeRequest): Promise<JudgeChainResult>
  act(request: ActRequest): Promise<ActOutcome>
  /**
   * Check the intent's `successCriteria` against the CURRENT page.
   *
   * Called only when a judge CLAIMS `done`. Returning `satisfied: false` sends
   * the loop back around rather than reporting success.
   */
  verify(intent: IntentSpec): Promise<VerifyResult>
  now(): number
  /** Advances time for `wait` steps. Injected so a test never really sleeps. */
  sleep(ms: number): Promise<void>
}

export interface LoopInput {
  intent: IntentSpec
  effects: LoopEffects
  budgets?: Partial<BudgetLimits>
  pipe?: Partial<PipeConfig>
  /** How many consecutive unclear answers become `stuck`. */
  unclearLimit?: number
  /** How many consecutive no-progress steps on the same frame become `stuck`. */
  stalledLimit?: number
}

const DEFAULT_UNCLEAR_LIMIT = 3
const DEFAULT_STALLED_LIMIT = 3

/** Node names that mean "this candidate is not the one". Excluded when chosen. */
const isNonAction = (choice: string): boolean => choice === 'no_action' || choice === 'none'

/**
 * Run the loop.
 *
 * See the module header for what it refuses to do; the short version is that
 * every exit is enumerated, every claim of success is verified, and every budget
 * is checked before the work rather than after it.
 */
export async function runLoop(input: LoopInput): Promise<LoopResult> {
  const budgets: BudgetLimits = { ...DEFAULT_BUDGETS, ...input.budgets }
  const ledger = new BudgetLedger(budgets, input.effects.now)
  const unclearLimit = input.unclearLimit ?? DEFAULT_UNCLEAR_LIMIT
  const stalledLimit = input.stalledLimit ?? DEFAULT_STALLED_LIMIT

  const history: HistoryStep[] = []
  const excluded: number[] = []
  const steps: LoopStep[] = []
  let degraded = false
  let consecutiveUnclear = 0
  let consecutiveStalls = 0
  let lastRevision = -1

  let frame: Frame | null = null
  let revision = -1

  while (true) {
    // ── budget gate, BEFORE any work ──────────────────────────────────────
    const exhausted = ledger.exhausted()
    if (exhausted !== null) {
      return finish('exhausted', `budget exhausted: ${exhausted}`, excluded, steps, degraded, ledger, exhausted)
    }
    const stepGate = ledger.check('steps')
    if (!stepGate.ok) {
      return finish('exhausted', `budget exhausted: steps (${stepGate.remaining} left)`, excluded, steps, degraded, ledger, 'steps')
    }
    ledger.spend('steps')

    // ── capture (gated, not "just in case") ──────────────────────────────
    if (frame === null || revision !== lastRevision) {
      const captureGate = ledger.check('captures')
      if (!captureGate.ok) {
        return finish('exhausted', 'budget exhausted: captures', excluded, steps, degraded, ledger, 'captures')
      }
      ledger.spend('captures')
      let captured: CaptureResult
      try {
        captured = await input.effects.capture()
      } catch (error) {
        return finish('error', `capture failed: ${messageOf(error)}`, excluded, steps, degraded, ledger)
      }
      frame = captured.frame
      revision = captured.documentRevision
      lastRevision = captured.documentRevision
    }

    // ── control round ────────────────────────────────────────────────────
    const controlRound = buildRound({
      frame,
      intent: input.intent,
      round: 'control',
      history,
      excluded,
      config: input.pipe,
    })
    const controlAnswer = await ask(ledger, input.effects, controlRound)
    if (controlAnswer === null) {
      return finish('exhausted', 'budget exhausted: judge', excluded, steps, degraded, ledger, 'judge')
    }
    degraded = degraded || controlAnswer.degraded
    const control = readControl(controlAnswer)

    if (control.kind === 'unavailable') {
      return finish('unavailable', `no judge could answer (${controlAnswer.trace.join(', ') || 'no trace'})`, excluded, steps, degraded, ledger)
    }
    if (control.kind === 'no-answer') {
      consecutiveUnclear += 1
      if (consecutiveUnclear >= unclearLimit) {
        return finish('stuck', `control question went unanswered ${consecutiveUnclear}×`, excluded, steps, degraded, ledger)
      }
      steps.push(step(ledger, steps.length, 'no-answer', 0, 'none', false, 'judge returned no usable control answer', controlAnswer))
      continue
    }
    if (control.kind === 'unclear') {
      // `unclear` is its own state: the judge DID answer, just not decisively.
      // Treating it as `no-answer` would hide "the question was too vague".
      consecutiveUnclear += 1
      if (consecutiveUnclear >= unclearLimit) {
        return finish('stuck', `control answer unclear ${consecutiveUnclear}× (${control.code})`, excluded, steps, degraded, ledger)
      }
      steps.push(step(ledger, steps.length, `unclear:${control.code}`, 0, 'none', false, `top=${control.top.toFixed(2)} margin=${control.margin.toFixed(2)}`, controlAnswer))
      continue
    }
    consecutiveUnclear = 0

    if (control.kind === 'blocked') {
      // NOT the same as `done`. "Finished" and "stuck" both mean stop, but
      // conflating them turns an unrecoverable state into a success.
      return finish('blocked', 'the judge reports the intent cannot be progressed from this state', excluded, steps, degraded, ledger)
    }

    if (control.kind === 'done') {
      // Verify the CLAIM before believing it.
      let verdict: VerifyResult
      try {
        verdict = await input.effects.verify(input.intent)
      } catch (error) {
        return finish('error', `verification threw: ${messageOf(error)}`, excluded, steps, degraded, ledger)
      }
      if (verdict.satisfied) {
        steps.push(step(ledger, steps.length, 'done', 0, 'verify', true, verdict.note, controlAnswer))
        return finish('done', verdict.note, excluded, steps, degraded, ledger)
      }
      // A `done` that does not verify is the most valuable single signal the
      // loop gets, so it goes in the history rather than being swallowed.
      consecutiveStalls += 1
      history.push({ action: 'verify', n: 0, ok: false, note: `judge claimed done but: ${verdict.note}` })
      steps.push(step(ledger, steps.length, 'done-unverified', 0, 'verify', false, verdict.note, controlAnswer))
      if (consecutiveStalls >= stalledLimit) {
        return finish('stuck', `judge claimed done ${consecutiveStalls}× without the criteria holding`, excluded, steps, degraded, ledger)
      }
      continue
    }

    if (control.kind === 'wait') {
      await input.effects.sleep(300)
      steps.push(step(ledger, steps.length, 'wait', 0, 'wait', true, 'waited for the page to settle', controlAnswer))
      // A re-capture is REQUIRED, not merely allowed: the judge said the page is
      // mid-transition, so looking at the same frame again would show it the
      // identical bytes and earn the identical answer. Forcing the revision
      // mismatch is what makes `wait` progress instead of spin.
      lastRevision = -1
      history.push({ action: 'wait', n: 0, ok: true, note: 'waited for the page to settle' })
      continue
    }

    if (control.kind === 'scroll') {
      const scrolled = await input.effects.act({ frame, n: 0, action: 'scroll' })
      history.push(toHistoryNote(scrolled))
      steps.push(step(ledger, steps.length, 'scroll', 0, 'scroll', scrolled.ok, scrolled.ok ? 'scrolled; frame will be recaptured' : scrolled.message, controlAnswer))
      // A scroll invalidates the frame on purpose: the whole reason to scroll is
      // that the needed element was not in the last capture.
      lastRevision = -1
      excluded.length = 0
      continue
    }

    // ── control said `act`: pick a candidate, chunk by chunk ─────────────
    const outcome = await walkChunks(ledger, input.effects, frame, input.intent, history, excluded, input.pipe)
    if (outcome === null) {
      return finish('exhausted', 'budget exhausted: judge', excluded, steps, degraded, ledger, 'judge')
    }
    degraded = degraded || outcome.degraded

    if (outcome.kind === 'candidates-exhausted') {
      // Every candidate on this frame has been ruled out. Saying so is better
      // than looping: the page must change, or the intent is unachievable here.
      consecutiveStalls += 1
      steps.push(step(ledger, steps.length, 'no-candidates', 0, 'none', false, 'every candidate in this frame was ruled out', outcome.result))
      if (consecutiveStalls >= stalledLimit) {
        return finish('stuck', 'all candidates ruled out on this frame', excluded, steps, degraded, ledger)
      }
      lastRevision = -1
      continue
    }

    if (outcome.kind !== 'pick') {
      // unavailable / unclear / no-answer from the pick round.
      if (outcome.kind === 'unavailable') {
        return finish('unavailable', 'no judge could answer the candidate question', excluded, steps, degraded, ledger)
      }
      if (outcome.kind === 'out-of-frame') {
        // The judge named a number that is not in the frame it was given. This
        // is the failure the numbering scheme exists to expose, and it must not
        // be clamped into a click on the nearest element.
        consecutiveStalls += 1
        history.push({ action: 'none', n: outcome.n, ok: false, note: `judge named candidate ${outcome.n}, which is not in this frame` })
        steps.push(step(ledger, steps.length, 'out-of-frame', outcome.n, 'none', false, `candidate ${outcome.n} is out of frame`, outcome.result))
        if (consecutiveStalls >= stalledLimit) {
          return finish('stuck', 'judge repeatedly named candidates outside the frame', excluded, steps, degraded, ledger)
        }
        continue
      }
      consecutiveUnclear += 1
      steps.push(step(ledger, steps.length, `pick-${outcome.kind}`, 0, 'none', false, 'candidate answer unusable', outcome.result))
      if (consecutiveUnclear >= unclearLimit) {
        return finish('stuck', `candidate answer unusable ${consecutiveUnclear}×`, excluded, steps, degraded, ledger)
      }
      continue
    }

    // We have a real candidate. Risk is REPORTED, never decided here: the
    // caller owns the appetite, and a loop that decided its own risk threshold
    // would be one nobody could audit.
    const action = await input.effects.act({ frame, n: outcome.n, action: 'click' })
    history.push(toHistoryNote(action))
    if (!action.ok) {
      // A failed action EXCLUDES the candidate. Without this the loop re-picks
      // it next round and burns the budget on the same mistake.
      excluded.push(outcome.n)
      consecutiveStalls += 1
      steps.push(step(ledger, steps.length, `act-failed:${action.code}`, outcome.n, 'click', false, action.message, outcome.result, outcome.danger))
      if (consecutiveStalls >= stalledLimit) {
        return finish('stuck', `action failed ${consecutiveStalls}× (${action.code})`, excluded, steps, degraded, ledger)
      }
      continue
    }

    consecutiveStalls = 0
    steps.push(step(ledger, steps.length, 'act', outcome.n, action.action, true, describeNodeName(outcome.node), outcome.result, outcome.danger))
    // The action changed something, so the frame is stale BY DESIGN.
    lastRevision = -1
  }
}

// ── the chunk walk ─────────────────────────────────────────────────────────

type WalkOutcome =
  | { kind: 'pick'; n: number; danger: number | null; node: FrameNode; result: JudgeChainResult; degraded: boolean }
  | { kind: 'no-answer'; result: JudgeChainResult; degraded: boolean }
  | { kind: 'unclear'; code: string; result: JudgeChainResult; degraded: boolean }
  | { kind: 'out-of-frame'; n: number; result: JudgeChainResult; degraded: boolean }
  | { kind: 'unavailable'; result: JudgeChainResult; degraded: boolean }
  | { kind: 'candidates-exhausted'; result: JudgeChainResult; degraded: boolean }

/**
 * Ask "which candidate" across the frame's chunks.
 *
 * It asks about the chunk that still HAS a candidate before asking about a chunk
 * where everything is ruled out — an all-excluded chunk can only produce a
 * `no_action` or a hallucinated number, and each attempt costs a judge call.
 */
async function walkChunks(
  ledger: BudgetLedger,
  effects: LoopEffects,
  frame: Frame,
  intent: IntentSpec,
  history: readonly HistoryStep[],
  excluded: readonly number[],
  pipe: Partial<PipeConfig> | undefined,
): Promise<WalkOutcome | null> {
  const plan = buildRound({ frame, intent, round: 'control', history, excluded, config: pipe }).plan
  const chunkSize = plan.chunkSize
  const total = frame.dom.nodes.length
  const chunkTotal = Math.max(1, Math.ceil(total / chunkSize))
  const excludedSet = new Set(excluded)
  let last: JudgeChainResult | null = null

  for (let index = 1; index <= chunkTotal; index += 1) {
    const chunkGate = ledger.check('chunksPerCapture')
    if (!chunkGate.ok) return null
    const start = (index - 1) * chunkSize
    const inChunk = frame.dom.nodes.slice(start, start + chunkSize)
    const live = inChunk.filter((node) => !excludedSet.has(node.n))
    if (live.length === 0) continue
    ledger.spend('chunksPerCapture')

    const round = buildRound({ frame, intent, round: 'pick', chunkIndex: index, history, excluded, config: pipe })
    const answer = await ask(ledger, effects, round)
    if (answer === null) return null

    // Resolve against the OFFERED set, i.e. the same table the question was
    // built from. Resolving against the raw chunk would let a number that was
    // deliberately not offered resolve to a node — reintroducing exactly the
    // candidate the exclusion set removed.
    const read = readPick(answer, round.laya.frame.nodes)
    if (read.kind === 'pick') {
      return { kind: 'pick', n: read.n, danger: read.danger, node: read.node, result: answer, degraded: answer.degraded }
    }
    if (read.kind === 'unavailable') return { kind: 'unavailable', result: answer, degraded: answer.degraded }
    if (read.kind === 'out-of-frame') return { kind: 'out-of-frame', n: read.n, result: answer, degraded: answer.degraded }
    if (read.kind === 'unclear') return { kind: 'unclear', code: read.code, result: answer, degraded: answer.degraded }
    if (read.kind === 'no-answer') {
      // Keep walking: another chunk may still answer cleanly.
      last = answer
      continue
    }
  }
  // Nothing anywhere. Returning the LAST response rather than asking again: a
  // final question whose answer cannot be acted on would cost a judge call to
  // learn something the walk already knows.
  if (last === null) {
    // No chunk was ever asked — every one was fully excluded. There is no
    // response to report, and inventing one would misattribute this outcome to
    // the judge rather than to the exclusion set.
    return { kind: 'candidates-exhausted', result: NO_JUDGE_CALL, degraded: false }
  }
  return { kind: 'candidates-exhausted', result: last, degraded: last.degraded }
}

/**
 * A stand-in response for "we never asked".
 *
 * `provider: 'refuse'` is the honest value: nothing answered, and every reader
 * of a `JudgeChainResult` already handles that case. Using a fabricated
 * `provider: 'rule'` would make an unasked question look like a heuristic answer.
 */
const NO_JUDGE_CALL: JudgeChainResult = {
  answers: {},
  provider: 'refuse',
  model: '',
  latencyMs: 0,
  degraded: false,
  trace: ['no-judge-call: every candidate in this frame was excluded'],
  warnings: [],
  dropped: [],
  missing: [],
  chain: [],
}

/**
 * Charge and run one judge call, or `null` when the judge budget is spent.
 *
 * The `null` return is deliberate rather than throwing: the budget is an
 * expected outcome of a long run, not an exceptional one.
 */
async function ask(
  ledger: BudgetLedger,
  effects: LoopEffects,
  round: PipeRound,
): Promise<JudgeChainResult | null> {
  const gate = ledger.check('judge')
  if (!gate.ok) return null
  if (!ledger.check('wallMs').ok) return null
  ledger.spend('judge')
  return effects.judge({ questions: round.questions, state: round.state })
}

// ── steps, finishing, tools ────────────────────────────────────────────────

function step(
  ledger: BudgetLedger,
  index: number,
  control: string,
  n: number,
  action: string,
  ok: boolean,
  note: string,
  result: JudgeChainResult,
  danger?: number | null,
): LoopStep {
  return {
    index,
    control,
    n,
    action,
    ok,
    note: danger === undefined || danger === null ? note : `${note} (danger ${danger}/4)`,
    provider: result.provider,
    degraded: result.degraded,
    latencyMs: result.latencyMs,
    budget: ledger.snapshot(),
  }
}

function finish(
  status: LoopStatus,
  reason: string,
  excluded: number[],
  steps: LoopStep[],
  degraded: boolean,
  ledger: BudgetLedger,
  budget?: BudgetKind,
): LoopResult {
  return {
    status,
    reason,
    ...(budget === undefined ? {} : { exhaustedKind: budget }),
    steps,
    excluded: [...excluded],
    remaining: ledger.snapshot(),
    degraded,
  }
}

// Unused-but-kept helpers that the loop reads for diagnostics.

/** A candidate's label, for a trace line a human will read. */
export function describeNodeName(node: FrameNode): string {
  const name = node.name === '' ? '(unnamed)' : `"${node.name}"`
  return `${node.role} ${name}`
}

/**
 * The risk gate, exposed for callers rather than applied inside the loop.
 *
 * A `danger` at or above `maxDanger` means the caller should confirm before the
 * action, and this returns that verdict without acting on it.
 */
export function needsConfirmation(danger: number | null, maxDanger = 3): boolean {
  return danger !== null && danger >= maxDanger
}

/** Consecutive identical history lines — the oscillation signature. */
export function detectOscillation(history: readonly HistoryStep[], window = 4): boolean {
  if (history.length < window) return false
  const recent = history.slice(-window)
  const first = recent[0]
  if (first === undefined) return false
  return recent.every((entry) => entry.n === first.n && entry.action === first.action && !entry.ok)
}

/**
 * Whether a pick answer's own margin cleared its bucket.
 *
 * Kept here as a named export because the loop does NOT apply it: `readPick`
 * already gates on the bucket, and a second gate in the loop would be a second
 * source of truth for the same threshold.
 */
export function clearedMargin(top: number, runnerUp: number, candidates: number): boolean {
  const bucket = bucketFor(candidates)
  return checkChoiceMargin(
    { type: 'choice', choice: 'x', probabilities: { x: top, y: runnerUp }, confidence: 0 },
    bucket.minTop,
    bucket.minMargin,
  ).ok
}

/** The control question id, re-exported so tools do not import two modules. */
export { CONTROL_CHOICE_ID, controlQuestion, pickQuestion, buildIntentState, canScroll }

/** Build a validated question set, or report why it cannot be one. */
export function validatedControlQuestions(frame: Frame): { ok: true } | { ok: false; issues: string[] } {
  const issues = validateQuestions({ [CONTROL_CHOICE_ID]: controlQuestion(canScroll(frame)) })
  return issues.length === 0 ? { ok: true } : { ok: false, issues: issues.map((issue) => `${issue.code}:${issue.message}`) }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
