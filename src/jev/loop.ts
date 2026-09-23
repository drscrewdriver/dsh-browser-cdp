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
import { type Frame, type FrameNode, chaptersOf, shouldAskChapter } from './frame.ts'
import type { JudgeChainResult, JudgeRequest } from './judge.ts'
import {
  type HistoryStep,
  type IntentSpec,
  type ProgressReport,
  CONTROL_CHOICE_ID,
  buildIntentState,
  canScroll,
  controlQuestion,
  pickQuestion,
} from './prompt.ts'
import { type PipeConfig, type PipeRound, buildRound, readChapter, readControl, readEvaluation, readPick } from './pipe.ts'
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
  /**
   * HANDED BACK to the caller, on purpose.
   *
   * Distinct from `stuck`: `stuck` means the loop exhausted its own ideas, while
   * `escalate` means the loop reached a decision it should not make alone — a
   * step that failed, or a `done` claim the page does not support. The
   * difference matters because the remedy is different: `stuck` wants a new
   * strategy, `escalate` wants a specific recovery the caller can choose.
   */
  | 'escalate'

export type LoopStatus = 'done' | 'blocked' | 'exhausted' | 'stuck' | 'unavailable' | 'error' | 'escalate'

/**
 * A recovery action the caller may take. Named, not executed: the loop reports,
 * the model decides.
 */
export interface RecoveryOption {
  action: 'reload' | 'recapture' | 'scroll' | 'back' | 'abandon'
  /** Why this is worth trying, in one line the model can act on. */
  why: string
}

/**
 * What a caller needs in order to take over.
 *
 * Structured rather than prose because a model reads it: the point of handing
 * back is that something OTHER than this loop decides what to do next, and that
 * decision needs the facts, not a summary.
 */
export interface Escalation {
  reason:
    | 'step-failed'
    | 'done-unverified'
    | 'evaluation-unclear'
    | 'no-verdict'
    | 'judge-unavailable'
  /** The action that led here, e.g. `click button "Pay now"`. */
  lastAction: string
  /** The judge's own verdict or failure text that triggered the hand-back. */
  verdict: string
  /** Mechanical options, most likely first. Never empty. */
  recovery: RecoveryOption[]
  /** One line the caller can act on directly. */
  suggest: string
}

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
  /**
   * Present when `status === 'escalate'`.
   *
   * The loop stops here rather than continuing, because the two cases that
   * escalate (a failed step, an unsupported `done`) are exactly the ones where
   * more of the same is the wrong answer.
   */
  escalation?: Escalation
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
  /**
   * Ask the judge after each successful action whether the step advanced.
   *
   * Defaults to FALSE here even though the setting defaults to true: a caller
   * that wants the extra round trip must say so, so a test or an offline run
   * cannot accidentally double its judge budget.
   */
  evaluate?: boolean
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
  const evaluate = input.evaluate === true

  const history: HistoryStep[] = []
  const excluded: number[] = []
  const steps: LoopStep[] = []
  // Mechanical progress. Every field is written by the LOOP from its own ledgers
  // — nothing here is model-generated, because a progress report a model wrote
  // is a hallucination channel that reads like a record of real events.
  const chapterLog = new Map<string, { key: string; attempts: number; outcome: string }>()
  const completed: string[] = []
  let progressNote = ''
  const progressOf = (): ProgressReport => ({
    step: steps.length + 1,
    stepBudget: budgets.steps,
    judgeLeft: Math.max(0, ledger.snapshot().judge),
    capturesLeft: Math.max(0, ledger.snapshot().captures),
    chapters: [...chapterLog.values()],
    completed: [...completed],
    note: progressNote,
  })
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
      progress: progressOf(),
      config: input.pipe,
    })
    const controlAsked = await ask(ledger, input.effects, controlRound)
    if (!controlAsked.ok) {
      return finish('exhausted', `budget exhausted: ${controlAsked.blockedBy}`, excluded, steps, degraded, ledger, controlAsked.blockedBy)
    }
    const controlAnswer = controlAsked.result
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

    // ── control said `act`: narrow section by section, then pick ─────────
    const outcome = await walkNarrowing(
      ledger,
      input.effects,
      frame,
      input.intent,
      history,
      excluded,
      input.pipe,
      progressOf,
      chapterLog,
    )
    if (!outcome.ok) {
      return finish('exhausted', `budget exhausted: ${outcome.blockedBy}`, excluded, steps, degraded, ledger, outcome.blockedBy)
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
      if (outcome.kind === 'unknown-chapter') {
        // The judge named a SECTION that is not in the table it was given.
        // Labelled as a chapter failure, not a candidate one: the two point at
        // completely different problems (a bad section table vs a bad element
        // table), and a generic "pick failed" would hide which one it was.
        consecutiveStalls += 1
        history.push({ action: 'none', n: 0, ok: false, note: `judge named section ${outcome.key}, which is not in this frame` })
        steps.push(step(ledger, steps.length, 'unknown-chapter', 0, 'none', false, `section ${outcome.key} is not in the table the judge was given`, outcome.result))
        if (consecutiveStalls >= stalledLimit) {
          return finish('stuck', 'judge repeatedly named sections outside the frame', excluded, steps, degraded, ledger)
        }
        continue
      }
      consecutiveUnclear += 1
      // `code` is only present on the unclear variant; the other survivors are
      // `no-answer`. Reporting the variant name keeps the two distinguishable in
      // a trace without inventing a code for the one that has none.
      steps.push(step(ledger, steps.length, `narrowing-${outcome.kind}`, 0, 'none', false, 'no usable answer while narrowing', outcome.result))
      if (consecutiveUnclear >= unclearLimit) {
        return finish('stuck', `no usable answer while narrowing ${consecutiveUnclear}×`, excluded, steps, degraded, ledger)
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
    const actionLabel = `${action.action} ${describeNodeName(outcome.node)}`
    // A SUCCESSFUL action is the only thing that goes in `completed`. A failed
    // one must not, or the judge reads progress on work that never landed.
    completed.push(`${actionLabel} in ${outcome.chapterKey ?? 'the page'}`)
    progressNote = ''
    steps.push(step(ledger, steps.length, 'act', outcome.n, action.action, true, describeNodeName(outcome.node), outcome.result, outcome.danger))

    // ── progress evaluation: did that STEP actually move us? ──────────────
    //
    // Placed here, after the action and before the next capture, for one reason:
    // the question is about the step. Asking it later would be asking about
    // something the judge can no longer see.
    if (evaluate) {
      const evalRound = buildRound({
        frame,
        intent: input.intent,
        round: 'evaluate',
        history,
        excluded,
        progress: progressOf(),
        config: input.pipe,
      })
      const askedEval = await ask(ledger, input.effects, evalRound)
      if (!askedEval.ok) {
        return finish('exhausted', `budget exhausted: ${askedEval.blockedBy}`, excluded, steps, degraded, ledger, askedEval.blockedBy)
      }
      degraded = degraded || askedEval.result.degraded
      const verdict = readEvaluation(askedEval.result)

      if (verdict.kind === 'verdict' && verdict.verdict === 'inprogress') {
        // The only verdict that continues silently — and that is the point of
        // the three states: the common case costs no human attention.
        steps.push(step(ledger, steps.length, 'evaluate:inprogress', outcome.n, 'evaluate', true, `step advanced (top ${verdict.top.toFixed(2)})`, askedEval.result, outcome.danger))
        lastRevision = -1
        continue
      }

      if (verdict.kind === 'verdict' && verdict.verdict === 'done') {
        // A `done` verdict is a CLAIM about the step, so it is checked against
        // the intent's own criteria before the run is allowed to end.
        let checked: VerifyResult
        try {
          checked = await input.effects.verify(input.intent)
        } catch (error) {
          return finish('error', `verification threw: ${messageOf(error)}`, excluded, steps, degraded, ledger)
        }
        if (checked.satisfied) {
          steps.push(step(ledger, steps.length, 'evaluate:done', outcome.n, 'verify', true, checked.note, askedEval.result, outcome.danger))
          return finish('done', checked.note, excluded, steps, degraded, ledger)
        }
        // The judge says the goal is met; the page says it is not. That
        // CONTRADICTION is the most valuable thing the loop can hand back, so it
        // escalates instead of guessing which of the two is wrong.
        steps.push(step(ledger, steps.length, 'evaluate:done-unverified', outcome.n, 'verify', false, checked.note, askedEval.result, outcome.danger))
        return finishEscalated(
          {
            reason: 'done-unverified',
            lastAction: actionLabel,
            verdict: `judge reported done, but the criteria do not hold on the page (${checked.note})`,
            recovery: recoveryFor('done-unverified', action.action),
            suggest: 'The judge believes the goal is met while the page disagrees. Re-capture and re-check, or correct the successCriteria if they are wrong.',
          },
          excluded, steps, degraded, ledger,
        )
      }

      if (verdict.kind === 'verdict' && verdict.verdict === 'fail') {
        steps.push(step(ledger, steps.length, 'evaluate:fail', outcome.n, 'evaluate', false, `step did not advance (top ${verdict.top.toFixed(2)})`, askedEval.result, outcome.danger))
        return finishEscalated(
          {
            reason: 'step-failed',
            lastAction: actionLabel,
            verdict: 'the judge reports the step did not advance',
            recovery: recoveryFor('step-failed', action.action),
            suggest: `The step "${actionLabel}" did not work. Pick a recovery and resume, or stop and report.`,
          },
          excluded, steps, degraded, ledger,
        )
      }

      if (verdict.kind === 'unavailable') {
        return finish('unavailable', 'no judge could answer the progress evaluation', excluded, steps, degraded, ledger)
      }

      // unclear / unknown verdict / no answer: the three-way question is the
      // STRICTEST bucket, so a hesitant verdict is exactly the case where
      // continuing automatically is worst. Escalate rather than coin-flip.
      const detail = verdict.kind === 'unclear' ? verdict.code : verdict.kind
      steps.push(step(ledger, steps.length, `evaluate:${verdict.kind}`, outcome.n, 'evaluate', false, `verdict unusable (${detail})`, askedEval.result, outcome.danger))
      return finishEscalated(
        {
          reason: verdict.kind === 'no-answer' ? 'no-verdict' : 'evaluation-unclear',
          lastAction: actionLabel,
          verdict: `the progress verdict was unusable: ${detail}`,
          recovery: recoveryFor('evaluation-unclear', action.action),
          suggest: 'The judge could not say whether the step advanced. Re-capture and re-evaluate, or take over.',
        },
        excluded, steps, degraded, ledger,
      )
    }

    // The action changed something, so the frame is stale BY DESIGN.
    lastRevision = -1
  }
}

/**
 * The recovery options for a failure, DERIVED from what failed.
 *
 * Mechanical on purpose, and always non-empty: a hand-back with no suggested
 * action pushes the whole problem onto the caller, and the caller in practice is
 * a model that will then guess. Naming `reload` first for a step that failed is
 * the cheap, high-yield move — a page that half-rendered or lost its session
 * state is repaired by a reload far more often than by a cleverer selector.
 */
export function recoveryFor(reason: Escalation['reason'], lastAction: string): RecoveryOption[] {
  if (reason === 'done-unverified') {
    return [
      { action: 'recapture', why: 'the page may have changed after the last capture, so the criteria could now hold' },
      { action: 'scroll', why: 'the thing that would prove completion may be below the fold' },
      { action: 'reload', why: 'a stale render can hide the confirmation that was actually written' },
      { action: 'abandon', why: 'if the criteria are simply wrong, fix the intent rather than the page' },
    ]
  }
  if (reason === 'judge-unavailable') {
    return [
      { action: 'abandon', why: 'no judge answered, which is a configuration problem and not a page problem' },
    ]
  }
  // step-failed / evaluation-unclear
  const reloadable = lastAction === 'click' || lastAction === 'fill'
  const options: RecoveryOption[] = []
  if (reloadable) {
    options.push({ action: 'reload', why: 'a failed interaction often means the page is in a stale or half-loaded state' })
  }
  options.push(
    { action: 'recapture', why: 'the frame the judge decided on may no longer match the page' },
    { action: 'scroll', why: 'the target may have moved out of the captured region' },
    { action: 'back', why: 'the last action may have navigated somewhere unhelpful' },
    { action: 'abandon', why: 'the intent may not be achievable on this page at all' },
  )
  return options
}

/** Wrap up as a hand-back, with the escalation attached. */
function finishEscalated(
  escalation: Escalation,
  excluded: number[],
  steps: LoopStep[],
  degraded: boolean,
  ledger: BudgetLedger,
): LoopResult {
  return {
    status: 'escalate',
    reason: escalation.suggest,
    steps,
    excluded: [...excluded],
    remaining: ledger.snapshot(),
    degraded,
    escalation,
  }
}

// ── the narrowing walk: chunk → chapter → candidate ────────────────────────

type WalkOutcome =
  | { kind: 'pick'; n: number; danger: number | null; node: FrameNode; chapterKey: string | null; result: JudgeChainResult; degraded: boolean }
  | { kind: 'no-answer'; result: JudgeChainResult; degraded: boolean }
  | { kind: 'unclear'; code: string; result: JudgeChainResult; degraded: boolean }
  | { kind: 'unknown-chapter'; key: string; result: JudgeChainResult; degraded: boolean }
  | { kind: 'out-of-frame'; n: number; result: JudgeChainResult; degraded: boolean }
  | { kind: 'unavailable'; result: JudgeChainResult; degraded: boolean }
  | { kind: 'candidates-exhausted'; result: JudgeChainResult; degraded: boolean }

/**
 * Narrow the page down: chunk → chapter → candidate.
 *
 * Why chapters at all, given the extra round trip: every gate in `wire.ts` is
 * bucketed by CANDIDATE COUNT, so a 20-way question is judged against a looser
 * bar than a 5-way one. Splitting 20 options into (5 sections) × (4 candidates)
 * puts BOTH rounds in stricter buckets. The accuracy gain follows from the
 * counts, not from a hope about the model.
 *
 * The chapter round is SKIPPED when the frame has one chapter: a question with a
 * single option is a round trip that can only go one way.
 */
async function walkNarrowing(
  ledger: BudgetLedger,
  effects: LoopEffects,
  frame: Frame,
  intent: IntentSpec,
  history: readonly HistoryStep[],
  excluded: readonly number[],
  pipe: Partial<PipeConfig> | undefined,
  progressOf: () => ProgressReport,
  chapterLog: Map<string, { key: string; attempts: number; outcome: string }>,
): Promise<{ ok: true } & WalkOutcome | { ok: false; blockedBy: BudgetKind }> {
  const plan = buildRound({ frame, intent, round: 'control', history, excluded, config: pipe }).plan
  const chunkSize = plan.chunkSize
  const total = frame.dom.nodes.length
  const chunkTotal = Math.max(1, Math.ceil(total / chunkSize))
  const excludedSet = new Set(excluded)
  let last: JudgeChainResult | null = null

  for (let index = 1; index <= chunkTotal; index += 1) {
    const chunkGate = ledger.check('chunksPerCapture')
    if (!chunkGate.ok) return { ok: false, blockedBy: 'chunksPerCapture' }
    const start = (index - 1) * chunkSize
    const live = frame.dom.nodes.slice(start, start + chunkSize).filter((node) => !excludedSet.has(node.n))
    // An all-excluded chunk can only produce a `no_action` or a hallucinated
    // number, and either costs a judge call. Skipping is strictly cheaper.
    if (live.length === 0) continue
    ledger.spend('chunksPerCapture')

    const chapters = chaptersOf(live)
    const askChapter = shouldAskChapter(live, chapters.length)

    // ── chapter level (the "narrow the search" step) ──────────────────────
    let targets = chapters
    if (askChapter) {
      const round = buildRound({
        frame,
        intent,
        round: 'chapter',
        chunkIndex: index,
        history,
        excluded,
        progress: progressOf(),
        config: pipe,
      })
      const asked = await ask(ledger, effects, round)
      if (!asked.ok) return { ok: false, blockedBy: asked.blockedBy }
      const answer = asked.result
      const read = readChapter(answer, chapters)
      if (read.kind === 'unavailable') return { ok: true, kind: 'unavailable', result: answer, degraded: answer.degraded }
      if (read.kind === 'no-answer' || read.kind === 'unclear' || read.kind === 'unknown-chapter') {
        // Record the attempt against the WHOLE chunk: the judge could not pick a
        // section, so no single section owns the failure.
        recordChapter(chapterLog, `chunk${index}`, 'could not choose a section')
        if (read.kind === 'unknown-chapter') return { ok: true, kind: 'unknown-chapter', key: read.key, result: answer, degraded: answer.degraded }
        return { ok: true, kind: read.kind, code: read.kind === 'unclear' ? read.code : 'no-answer', result: answer, degraded: answer.degraded }
      }
      recordChapter(chapterLog, read.key, `chosen (top ${read.top.toFixed(2)})`)
      last = answer
      targets = chapters.filter((chapter) => chapter.key === read.key)
    }

    // ── candidate level ───────────────────────────────────────────────────
    for (const chapter of targets) {
      const offered = chapter.nodes.filter((node) => !excludedSet.has(node.n))
      if (offered.length === 0) {
        // Everything in this section was ruled out on an earlier round. Saying so
        // in progress is what stops the judge sending the loop back into it.
        recordChapter(chapterLog, chapter.key, 'every candidate ruled out')
        continue
      }
      const round = buildRound({
        frame,
        intent,
        round: 'pick',
        chunkIndex: index,
        chapterKey: askChapter ? chapter.key : undefined,
        history,
        excluded,
        progress: progressOf(),
        config: pipe,
      })
      const asked = await ask(ledger, effects, round)
      if (!asked.ok) return { ok: false, blockedBy: asked.blockedBy }
      const answer = asked.result

      // Resolve against the OFFERED set — the same table the question was built
      // from. Resolving against the raw chunk would let a number that was
      // deliberately not offered resolve to a node, reintroducing exactly the
      // candidate the exclusion set removed.
      const read = readPick(answer, round.laya.frame.nodes)
      if (read.kind === 'pick') {
        if (askChapter) recordChapter(chapterLog, chapter.key, `acting on ${describeNodeName(read.node)}`)
        return { ok: true, kind: 'pick', n: read.n, danger: read.danger, node: read.node, chapterKey: askChapter ? chapter.key : null, result: answer, degraded: answer.degraded }
      }
      if (read.kind === 'unavailable') return { ok: true, kind: 'unavailable', result: answer, degraded: answer.degraded }
      if (read.kind === 'out-of-frame') return { ok: true, kind: 'out-of-frame', n: read.n, result: answer, degraded: answer.degraded }
      if (read.kind === 'unclear') {
        if (askChapter) recordChapter(chapterLog, chapter.key, `no clear candidate (${read.code})`)
        return { ok: true, kind: 'unclear', code: read.code, result: answer, degraded: answer.degraded }
      }
      last = answer
      // `no-answer` here: keep walking, another section may answer cleanly.
    }
  }

  if (last === null) {
    // No chunk was ever asked — every one was fully excluded. There is no
    // response to report, and inventing one would misattribute this outcome to
    // the judge rather than to the exclusion set.
    return { ok: true, kind: 'candidates-exhausted', result: NO_JUDGE_CALL, degraded: false }
  }
  return { ok: true, kind: 'candidates-exhausted', result: last, degraded: last.degraded }
}

/** Count an attempt against a chapter, keeping the most recent outcome. */
function recordChapter(
  log: Map<string, { key: string; attempts: number; outcome: string }>,
  key: string,
  outcome: string,
): void {
  const existing = log.get(key)
  if (existing === undefined) log.set(key, { key, attempts: 1, outcome })
  else {
    existing.attempts += 1
    existing.outcome = outcome
  }
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
 * Charge and run one judge call.
 *
 * Returns WHICH budget blocked it rather than a bare `null`, because the two are
 * not interchangeable: a `null` collapsed both causes into one value, and the
 * call sites then all reported "exhausted: judge" — so a run stopped by the wall
 * clock announced that the judge budget had run out, and the caller raised the
 * wrong limit. The whole point of enumerating the exhaustion kind is that it
 * names the true cause; a helper that loses the cause defeats it.
 *
 * A blocked budget is an EXPECTED outcome of a long run, not an exception, which
 * is why it is a return value rather than a throw.
 */
type AskOutcome =
  | { ok: true; result: JudgeChainResult }
  | { ok: false; blockedBy: BudgetKind }

async function ask(
  ledger: BudgetLedger,
  effects: LoopEffects,
  round: PipeRound,
): Promise<AskOutcome> {
  const gate = ledger.check('judge')
  if (!gate.ok) return { ok: false, blockedBy: 'judge' }
  const wall = ledger.check('wallMs')
  if (!wall.ok) return { ok: false, blockedBy: 'wallMs' }
  ledger.spend('judge')
  return { ok: true, result: await effects.judge({ questions: round.questions, state: round.state }) }
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
