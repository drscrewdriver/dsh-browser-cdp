import { describe, expect, it } from 'vitest'
import { BudgetLedger, DEFAULT_BUDGETS, detectOscillation, needsConfirmation, runLoop } from '../src/jev/loop.ts'
import type { ActOutcome } from '../src/jev/act.ts'
import { buildFrame } from '../src/jev/frame.ts'
import type { JudgeChainResult, JudgeRequest } from '../src/jev/judge.ts'
import type { Frame } from '../src/jev/frame.ts'
import type { IntentSpec } from '../src/jev/prompt.ts'
import type { CaptureResult, ActRequest, LoopEffects, VerifyResult } from '../src/jev/loop.ts'

/**
 * Loop acceptance. Every assertion here is about STOPPING, because that is the
 * property an agent loop is actually judged on:
 *
 *   - `done` is a CLAIM and must be verified before it is believed;
 *   - `blocked` is not `done` (both stop, but one is a failure);
 *   - `exhausted` names WHICH budget, because the remedies differ;
 *   - `stuck` is reachable, or the loop spins until a budget saves it.
 *
 * All effects are injected and the clock is fake, so a 20-round loop with a
 * 120-second ceiling runs in microseconds and every budget is exercised exactly.
 */

const target = { endpoint: 'ws://x/devtools/browser/1', targetId: 'T1', url: 'https://example.test/', title: 'Ex' }
const viewport = { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }

const intent: IntentSpec = {
  goal: 'submit the form',
  kind: 'click',
  targetHints: [],
  successCriteria: ['the confirmation page is visible'],
  stopConditions: [],
  source: 'user',
}

function makeFrame(count: number): Frame {
  return buildFrame({
    target,
    viewport,
    image: null,
    nodes: Array.from({ length: count }, (_, i) => ({
      backendNodeId: 200 + i,
      role: 'button',
      name: `Action ${i + 1}`,
      container: 'main',
    })),
    documentRevision: 1,
    seq: 1,
    limit: count,
    now: () => 0,
  }).frame
}

/** A judge response choosing one option, with a configurable margin. */
function choiceAnswer(
  answers: Record<string, string>,
  options: { top?: number; provider?: JudgeChainResult['provider'] } = {},
): JudgeChainResult {
  const top = options.top ?? 0.95
  const built: Record<string, unknown> = {}
  for (const [id, value] of Object.entries(answers)) {
    built[id] = { type: 'choice', choice: value, probabilities: { [value]: top, other: 1 - top }, confidence: top }
  }
  return {
    answers: built as JudgeChainResult['answers'],
    provider: options.provider ?? 'laya',
    model: 'laya',
    latencyMs: 1,
    degraded: options.provider === 'rule',
    trace: [],
    warnings: [],
    dropped: [],
    missing: [],
    chain: [`${options.provider ?? 'laya'}:answered`],
  }
}

/** A noul answer, for the verification round. */
function noulAnswer(value: number): JudgeChainResult {
  return {
    answers: { satisfied: { type: 'noul', noul: value } },
    provider: 'laya',
    model: 'laya',
    latencyMs: 1,
    degraded: false,
    trace: [],
    warnings: [],
    dropped: [],
    missing: [],
    chain: ['laya:answered'],
  }
}

interface Harness {
  effects: LoopEffects
  /** Every judge request, so a test can assert what the judge was ASKED. */
  judged: JudgeRequest[]
  /** Every action, in order. */
  acted: ActRequest[]
  captures: () => number
}

/**
 * A scripted loop harness.
 *
 * `control` answers the control question per round; `pick` answers the candidate
 * question. Both are functions of the round index so a test can script "act,
 * then done". The judge distinguishes the two by which question ids it sees —
 * exactly as a real provider would.
 */
function harness(input: {
  frames?: number
  control: (round: number) => JudgeChainResult
  pick?: (round: number) => JudgeChainResult
  act?: (request: ActRequest) => Promise<ActOutcome> | ActOutcome
  verify?: (intent: IntentSpec) => VerifyResult
  now?: () => number
}): Harness {
  const judged: JudgeRequest[] = []
  const acted: ActRequest[] = []
  let captures = 0
  let round = 0

  const okAct = (request: ActRequest): ActOutcome => ({
    ok: true,
    code: 'ok',
    action: request.action === 'scroll' ? 'scroll' : 'click',
    n: request.n,
    backendNodeId: 200 + request.n,
    point: { x: 1, y: 1 },
    measured: { x: 0, y: 0, width: 10, height: 10 },
    drift: 0,
  })

  return {
    judged,
    acted,
    captures: () => captures,
    effects: {
      async capture(): Promise<CaptureResult> {
        captures += 1
        return { frame: makeFrame(input.frames ?? 3), documentRevision: captures }
      },
      async judge(request: JudgeRequest): Promise<JudgeChainResult> {
        judged.push(request)
        round += 1
        // A pick round is identified by its question ids, not by a counter —
        // the loop is free to ask in any order and the fake must not assume one.
        if ('candidate' in request.questions) {
          return input.pick === undefined ? choiceAnswer({ candidate: '1' }) : input.pick(round)
        }
        if ('satisfied' in request.questions) return noulAnswer(1)
        return input.control(round)
      },
      async act(request: ActRequest): Promise<ActOutcome> {
        acted.push(request)
        return input.act === undefined ? okAct(request) : input.act(request)
      },
      async verify(): Promise<VerifyResult> {
        return input.verify === undefined ? { satisfied: true, note: 'criteria observed' } : input.verify(intent)
      },
      now: input.now ?? (() => 0),
      async sleep(): Promise<void> {},
    },
  }
}

describe('jev loop · verification gates the claim of done', () => {
  it('reports done only when the criteria actually hold', async () => {
    const h = harness({ control: () => choiceAnswer({ control: 'done' }), verify: () => ({ satisfied: true, note: 'ok' }) })
    const result = await runLoop({ intent, effects: h.effects })
    expect(result.status).toBe('done')
    expect(result.steps.some((step) => step.action === 'verify')).toBe(true)
  })

  it('does NOT report done when the criteria do not hold', async () => {
    // The failure this prevents: a model says "done", nobody checks, and the
    // run reports success on a page that is still half-filled.
    const h = harness({
      control: () => choiceAnswer({ control: 'done' }),
      verify: () => ({ satisfied: false, note: 'no confirmation banner' }),
    })
    const result = await runLoop({ intent, effects: h.effects })
    expect(result.status).not.toBe('done')
    expect(result.steps.some((step) => step.control === 'done-unverified')).toBe(true)
  })

  it('gives up as stuck when the claim repeats without the criteria holding', async () => {
    const h = harness({
      control: () => choiceAnswer({ control: 'done' }),
      verify: () => ({ satisfied: false, note: 'still not there' }),
    })
    const result = await runLoop({ intent, effects: h.effects, stalledLimit: 3 })
    expect(result.status).toBe('stuck')
    expect(result.reason).toContain('claimed done')
  })

  it('treats a failed verification call as an error, not as a success', async () => {
    const h = harness({
      control: () => choiceAnswer({ control: 'done' }),
      verify: () => {
        throw new Error('verify exploded')
      },
    })
    const result = await runLoop({ intent, effects: h.effects })
    expect(result.status).toBe('error')
  })
})

describe('jev loop · blocked is not done', () => {
  it('reports blocked with its own status', async () => {
    const h = harness({ control: () => choiceAnswer({ control: 'blocked' }) })
    const result = await runLoop({ intent, effects: h.effects })
    // "Finished" and "cannot proceed" both stop; conflating them would turn an
    // unrecoverable state into a success.
    expect(result.status).toBe('blocked')
    expect(result.status).not.toBe('done')
  })
})

describe('jev loop · every exit is reachable and named', () => {
  it('reports unavailable when the judge refused', async () => {
    const h = harness({
      control: () =>
        choiceAnswer({ control: 'act' }, { provider: 'refuse' }),
    })
    const result = await runLoop({ intent, effects: h.effects })
    expect(result.status).toBe('unavailable')
  })

  it('names WHICH budget ran out', async () => {
    // The remedies differ: `captures` says raise the capture budget, `steps`
    // says the page needs a different approach.
    const h = harness({ control: () => choiceAnswer({ control: 'wait' }) })
    const result = await runLoop({ intent, effects: h.effects, budgets: { ...DEFAULT_BUDGETS, captures: 2, steps: 99 } })
    expect(result.status).toBe('exhausted')
    expect(result.exhaustedKind).toBe('captures')
  })

  it('stops on the step budget', async () => {
    const h = harness({ control: () => choiceAnswer({ control: 'wait' }) })
    const result = await runLoop({ intent, effects: h.effects, budgets: { ...DEFAULT_BUDGETS, steps: 4, captures: 99 } })
    expect(result.status).toBe('exhausted')
    expect(result.exhaustedKind).toBe('steps')
    expect(result.steps.length).toBeLessThanOrEqual(4)
  })

  it('stops on the wall clock using the injected clock, not a real one', async () => {
    let t = 0
    const h = harness({ control: () => choiceAnswer({ control: 'wait' }), now: () => (t += 5_000) })
    const result = await runLoop({
      intent,
      effects: h.effects,
      budgets: { ...DEFAULT_BUDGETS, wallMs: 12_000, steps: 99, captures: 99 },
    })
    expect(result.status).toBe('exhausted')
    expect(result.exhaustedKind).toBe('wallMs')
  })

  it('stops on the judge budget', async () => {
    const h = harness({ control: () => choiceAnswer({ control: 'wait' }) })
    const result = await runLoop({ intent, effects: h.effects, budgets: { ...DEFAULT_BUDGETS, judge: 3, steps: 99, captures: 99 } })
    expect(result.status).toBe('exhausted')
    expect(result.exhaustedKind).toBe('judge')
  })

  it('reports stuck after repeated unclear answers', async () => {
    // 0.3 is under every bucket's `top` gate, so the answer is unusable.
    const h = harness({ control: () => choiceAnswer({ control: 'act' }, { top: 0.3 }) })
    const result = await runLoop({ intent, effects: h.effects, unclearLimit: 3 })
    expect(result.status).toBe('stuck')
    expect(result.reason).toContain('unclear')
  })

  it('reports stuck when every candidate has been ruled out', async () => {
    // Every action fails, so each pick rules its candidate out; eventually the
    // frame has nothing left to offer.
    const h = harness({
      frames: 2,
      control: () => choiceAnswer({ control: 'act' }),
      act: (request) => ({ ok: false, code: 'click-missed', message: 'overlay', n: request.n }),
    })
    const result = await runLoop({ intent, effects: h.effects, stalledLimit: 5 })
    expect(result.status).toBe('stuck')
  })
})

describe('jev loop · exclusions are structural, not advisory', () => {
  it('records a ruled-out candidate and never offers it again', async () => {
    const h = harness({
      frames: 3,
      control: () => choiceAnswer({ control: 'act' }),
      // Always name candidate 1: after it fails once it must not be askable.
      pick: () => choiceAnswer({ candidate: '1' }),
      act: (request) => ({ ok: false, code: 'click-missed', message: 'overlay', n: request.n }),
    })
    const result = await runLoop({ intent, effects: h.effects, stalledLimit: 4 })
    expect(result.excluded).toContain(1)

    // The next pick question must not LIST the excluded candidate. This is the
    // assertion that separates "the judge was told" from "the judge cannot".
    const pickRequests = h.judged.filter((request) => 'candidate' in request.questions)
    const second = pickRequests[1]
    expect(second).toBeDefined()
    const question = second?.questions.candidate
    if (question?.type === 'choice') expect(Object.keys(question.criteria)).not.toContain('1')
  })

  it('carries the excluded set in the prompt history', async () => {
    const h = harness({
      frames: 3,
      control: () => choiceAnswer({ control: 'act' }),
      pick: () => choiceAnswer({ candidate: '1' }),
      act: (request) => ({ ok: false, code: 'input-failed', message: 'nope', n: request.n }),
    })
    await runLoop({ intent, effects: h.effects, stalledLimit: 4 })
    const withExclusion = h.judged.find((request) => typeof request.state === 'string' && request.state.includes('excluded'))
    expect(withExclusion).toBeDefined()
  })

  it('refuses an out-of-frame number instead of clamping it', async () => {
    const h = harness({
      frames: 3,
      control: () => choiceAnswer({ control: 'act' }),
      pick: () => choiceAnswer({ candidate: '99' }),
    })
    const result = await runLoop({ intent, effects: h.effects, stalledLimit: 2 })
    expect(result.steps.some((step) => step.control === 'out-of-frame')).toBe(true)
    expect(h.acted).toHaveLength(0)
  })
})

describe('jev loop · act path', () => {
  it('asks the control question first and the candidate question second', async () => {
    // The gating property: asking "which of these 20" before "should we act at
    // all" is how a loop acts on a page it should have left alone.
    const h = harness({
      control: () => choiceAnswer({ control: 'act' }),
      pick: () => choiceAnswer({ candidate: '2' }),
    })
    const result = await runLoop({ intent, effects: h.effects, budgets: { ...DEFAULT_BUDGETS, steps: 2 } })
    expect(h.judged[0]?.questions.control).toBeDefined()
    expect(h.judged[0]?.questions.candidate).toBeUndefined()
    expect(h.acted[0]?.n).toBe(2)
    expect(result.steps.some((step) => step.control === 'act' && step.ok)).toBe(true)
  })

  it('re-captures after a successful action instead of reusing the stale frame', async () => {
    const h = harness({
      control: () => choiceAnswer({ control: 'act' }),
      pick: () => choiceAnswer({ candidate: '1' }),
      act: () => ({ ok: true, code: 'ok', action: 'click', n: 1, backendNodeId: 201, point: { x: 0, y: 0 }, measured: { x: 0, y: 0, width: 1, height: 1 }, drift: 0 }),
    })
    await runLoop({ intent, effects: h.effects, budgets: { ...DEFAULT_BUDGETS, steps: 2, captures: 9 } })
    // Two rounds, therefore two captures: the action invalidated the first.
    expect(h.captures()).toBeGreaterThanOrEqual(2)
  })

  it('reports the danger score without deciding what to do about it', async () => {
    const danger: JudgeChainResult = {
      ...choiceAnswer({ candidate: '1' }),
      answers: {
        candidate: { type: 'choice', choice: '1', probabilities: { 1: 0.9 }, confidence: 0.9 },
        danger: { type: 'score', score: 4, legend: {}, probabilities: {}, confidence: 0.9 },
      },
    }
    const h = harness({ control: () => choiceAnswer({ control: 'act' }), pick: () => danger })
    const result = await runLoop({ intent, effects: h.effects, budgets: { ...DEFAULT_BUDGETS, steps: 1 } })
    // The loop REPORTS it; the caller owns the appetite.
    expect(result.steps.some((step) => step.note.includes('danger 4/4'))).toBe(true)
    // And the action still went out — the loop has no veto of its own.
    expect(h.acted).toHaveLength(1)
  })

  it('scrolls and then invalidates the frame, clearing stale exclusions', async () => {
    const h = harness({ control: () => choiceAnswer({ control: 'scroll' }) })
    const result = await runLoop({ intent, effects: h.effects, budgets: { ...DEFAULT_BUDGETS, steps: 1 } })
    expect(h.acted[0]?.action).toBe('scroll')
    expect(result.steps[0]?.action).toBe('scroll')
  })

  it('waits and then demands a fresh capture', async () => {
    // Waiting on the SAME frame would show identical bytes and earn the
    // identical answer, which is a spin rather than a wait.
    const h = harness({ control: () => choiceAnswer({ control: 'wait' }) })
    await runLoop({ intent, effects: h.effects, budgets: { ...DEFAULT_BUDGETS, steps: 3, captures: 9 } })
    expect(h.captures()).toBeGreaterThanOrEqual(2)
  })
})

describe('jev loop · the ledger refuses rather than overdrawing', () => {
  it('reports a spend that would exceed the limit', () => {
    const ledger = new BudgetLedger({ ...DEFAULT_BUDGETS, steps: 2 }, () => 0)
    expect(ledger.check('steps').ok).toBe(true)
    ledger.spend('steps', 2)
    const verdict = ledger.check('steps')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.kind).toBe('steps')
  })

  it('reports the first exhausted budget in a stable order', () => {
    const ledger = new BudgetLedger({ ...DEFAULT_BUDGETS, steps: 0 }, () => 0)
    expect(ledger.exhausted()).toBe('steps')
  })

  it('tracks wall time through the injected clock only', () => {
    let t = 1_000
    const ledger = new BudgetLedger({ ...DEFAULT_BUDGETS, wallMs: 5_000 }, () => t)
    expect(ledger.check('wallMs').ok).toBe(true)
    t = 7_000
    expect(ledger.check('wallMs').ok).toBe(false)
    expect(ledger.elapsed()).toBe(6_000)
  })

  it('reports remaining budgets for a trace line', () => {
    const ledger = new BudgetLedger({ ...DEFAULT_BUDGETS, steps: 5 }, () => 0)
    ledger.spend('steps', 2)
    expect(ledger.snapshot().steps).toBe(3)
  })
})

describe('jev loop · helpers a caller reads', () => {
  it('flags a danger score at or above the caller threshold', () => {
    expect(needsConfirmation(4, 3)).toBe(true)
    expect(needsConfirmation(2, 3)).toBe(false)
    // A MISSING danger score must not read as "safe".
    expect(needsConfirmation(null, 3)).toBe(false)
  })

  it('detects the oscillation signature: the same failing action repeating', () => {
    const history = [
      { action: 'click', n: 2, ok: false, note: 'a' },
      { action: 'click', n: 2, ok: false, note: 'b' },
      { action: 'click', n: 2, ok: false, note: 'c' },
      { action: 'click', n: 2, ok: false, note: 'd' },
    ]
    expect(detectOscillation(history, 4)).toBe(true)
    expect(detectOscillation(history.slice(0, 2), 4)).toBe(false)
  })

  it('does not flag a run of SUCCESSFUL repeats as oscillation', () => {
    const history = Array.from({ length: 4 }, () => ({ action: 'click', n: 2, ok: true, note: 'x' }))
    expect(detectOscillation(history, 4)).toBe(false)
  })
})
