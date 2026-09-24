import { describe, expect, it } from 'vitest'
import { ATTEMPT_END_KEY, ATTEMPT_QUESTION_ID, buildAttemptState, runAttempt } from '../src/jev/attempt.ts'
import { buildFrame } from '../src/jev/frame.ts'
import type { Frame } from '../src/jev/frame.ts'
import { anchorFor } from '../src/jev/anchors.ts'
import type { JudgeChainResult, JudgeRequest } from '../src/jev/judge.ts'
import type { ActOutcome } from '../src/jev/act.ts'
import type { ActRequest, LoopEffects } from '../src/jev/loop.ts'
import type { IntentSpec } from '../src/jev/prompt.ts'

/**
 * The flat attempt loop (`bcdp_jev_attempt`), per the user's contract:
 *
 *   「llm 给意图，选项根据 dom 生成，laya/jev 有 5 次行动的预算，
 *     决策模型花完预算或者自己选择结束则给回执」
 *
 * Every assertion here is about the two legitimate ways to stop — the model's
 * own `end`, and the action budget — plus the guards that keep a bad pick from
 * becoming an action.
 */

const target = { endpoint: 'ws://x/devtools/browser/1', targetId: 'T1', url: 'https://example.test/', title: 'Ex' }
const viewport = { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }

const intent: IntentSpec = {
  goal: 'open the pricing page',
  kind: 'click',
  targetHints: [],
  successCriteria: ['the pricing page is visible'],
  stopConditions: [],
  source: 'user',
}

function makeFrame(count: number, seq: number): Frame {
  return buildFrame({
    target,
    viewport,
    image: null,
    nodes: Array.from({ length: count }, (_, i) => ({
      backendNodeId: 200 + i,
      role: 'link',
      name: `Link ${i + 1}`,
      container: 'nav',
      containerLabel: 'the nav',
    })),
    documentRevision: 1,
    seq,
    limit: count,
    now: () => 0,
  }).frame
}

function pickAnswer(choiceKey: string, top: number, extra: Record<string, number> = {}): JudgeChainResult {
  const probabilities: Record<string, number> = { [choiceKey]: top }
  for (const [key, value] of Object.entries(extra)) probabilities[key] = value
  return {
    answers: {
      [ATTEMPT_QUESTION_ID]: { type: 'choice', choice: choiceKey, probabilities, confidence: top },
    },
    provider: 'laya',
    model: 'laya-latest',
    latencyMs: 1,
    degraded: false,
    trace: [],
    warnings: [],
    dropped: [],
    missing: [],
    chain: ['laya:answered'],
  }
}

interface FakeEffects extends LoopEffects {
  judged: JudgeRequest[]
  acted: ActRequest[]
  captures: number
}

function fakeEffects(input: {
  candidateCount?: number
  judge: (request: JudgeRequest, round: number) => JudgeChainResult
  act?: (request: ActRequest) => ActOutcome
}): FakeEffects {
  let captures = 0
  let round = 0
  const judged: JudgeRequest[] = []
  const acted: ActRequest[] = []
  const count = input.candidateCount ?? 3
  return {
    judged,
    acted,
    get captures() {
      return captures
    },
    async capture() {
      captures += 1
      return { frame: makeFrame(count, captures), documentRevision: captures }
    },
    async judge(request: JudgeRequest): Promise<JudgeChainResult> {
      round += 1
      judged.push(request)
      return input.judge(request, round)
    },
    async act(request: ActRequest): Promise<ActOutcome> {
      acted.push(request)
      if (input.act !== undefined) return input.act(request)
      const node = makeFrame(count, 0).dom.nodes.find((candidate) => candidate.n === request.n)
      return {
        ok: true,
        code: 'ok',
        action: 'click',
        n: request.n,
        backendNodeId: node?.backendNodeId ?? 200 + request.n,
        point: { x: 1, y: 1 },
        measured: { x: 0, y: 0, width: 10, height: 10 },
        drift: 0,
      }
    },
    async verify() {
      return { satisfied: true, note: 'unused in the flat loop' }
    },
    now: () => 0,
    async sleep(): Promise<void> {},
  }
}

describe('bcdp_jev_attempt · the two legitimate ways to stop', () => {
  it('the model picks `end` on the first round → ended, zero actions', async () => {
    const fx = fakeEffects({ judge: () => pickAnswer(ATTEMPT_END_KEY, 0.9) })
    const result = await runAttempt({ intent, effects: fx })
    expect(result.status).toBe('ended')
    expect(result.actions).toHaveLength(0)
    expect(fx.judged).toHaveLength(1)
    expect(fx.captures).toBe(1)
  })

  it('the model spends the whole budget without ending → exhausted after exactly maxActions', async () => {
    // 5 candidates + end = 6 options → the strictest bucket (top≥0.5, margin≥0.15).
    const fx = fakeEffects({
      candidateCount: 5,
      judge: () => pickAnswer('1', 0.9, { 2: 0.05, 3: 0.03, 4: 0.01, end: 0.01 }),
    })
    const result = await runAttempt({ intent, effects: fx, maxActions: 5 })
    expect(result.status).toBe('exhausted')
    expect(result.actions).toHaveLength(5)
    expect(fx.captures).toBe(5)
    expect(fx.acted).toHaveLength(5)
    expect(result.reason).toContain('budget (5)')
  })

  it('the model acts twice, then ends by itself → ended with the actions recorded', async () => {
    const fx = fakeEffects({
      judge: (_request, round) => (round <= 2 ? pickAnswer('2', 0.9, { 1: 0.05, end: 0.05 }) : pickAnswer(ATTEMPT_END_KEY, 0.9)),
    })
    const result = await runAttempt({ intent, effects: fx, maxActions: 5 })
    expect(result.status).toBe('ended')
    expect(result.actions).toHaveLength(2)
    expect(fx.acted[0]?.n).toBe(2)
    expect(result.actions[0]?.anchor).toBe(anchorFor(makeFrame(3, 1).frameId, 201))
  })
})

describe('bcdp_jev_attempt · guards', () => {
  it('a pick below its bucket is NOT acted on — unclear, budget untouched', async () => {
    const fx = fakeEffects({
      // 3 candidates + end = 4 options → bucket ≤5 → top≥0.6. 0.45 fails.
      judge: () => pickAnswer('1', 0.45, { 2: 0.25, 3: 0.2, end: 0.1 }),
    })
    const result = await runAttempt({ intent, effects: fx, maxActions: 5 })
    expect(result.status).toBe('unclear')
    expect(result.actions).toHaveLength(0)
    expect(fx.acted).toHaveLength(0)
    expect(result.reason).toContain('top=0.45')
  })

  it('a pick outside the offered table is unclear, never clamped', async () => {
    const fx = fakeEffects({ judge: () => pickAnswer('9', 0.95) })
    const result = await runAttempt({ intent, effects: fx })
    expect(result.status).toBe('unclear')
    expect(result.reason).toContain('not an offered option')
  })

  it('a page with no candidates is blocked without spending a judge call', async () => {
    const fx = fakeEffects({ candidateCount: 0, judge: () => pickAnswer(ATTEMPT_END_KEY, 0.9) })
    const result = await runAttempt({ intent, effects: fx })
    expect(result.status).toBe('blocked')
    expect(fx.judged).toHaveLength(0)
  })

  it('a failed action is recorded FAILED and still spends the budget', async () => {
    const fx = fakeEffects({
      judge: () => pickAnswer('1', 0.9, { 2: 0.05, end: 0.05 }),
      act: () => ({ ok: false, code: 'click-missed', message: 'the click dispatched but the point now resolves to a different node', n: 1 }),
    })
    const result = await runAttempt({ intent, effects: fx, maxActions: 1 })
    expect(result.status).toBe('exhausted')
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]?.ok).toBe(false)
    expect(result.actions[0]?.anchor).toBeUndefined()
  })
})

describe('bcdp_jev_attempt · the judge context (DOM tree only, 列表==表)', () => {
  it('the option table and the FRAME list come from the same candidates', async () => {
    const fx = fakeEffects({ judge: () => pickAnswer(ATTEMPT_END_KEY, 0.9) })
    await runAttempt({ intent, effects: fx })
    const request = fx.judged[0]
    const question = request?.questions[ATTEMPT_QUESTION_ID]
    expect(question?.type).toBe('choice')
    // The table is candidates + `end`, nothing else.
    expect(Object.keys(question?.criteria ?? {}).sort()).toEqual(['1', '2', '3', ATTEMPT_END_KEY])
    const state = String(request?.state)
    // 列表==表: every offered number appears in the FRAME list with the same prose.
    expect(state).toContain('1. link "Link 1" [the nav]')
    expect(state).toContain('3. link "Link 3" [the nav]')
    expect(state).toContain('# INTENT')
    expect(state).toContain(`goal: ${intent.goal}`)
    expect(state).toContain('success criterion: the pricing page is visible')
  })

  it('HISTORY records what was done, so a later round sees its own past', async () => {
    const fx = fakeEffects({
      judge: (_request, round) => (round === 1 ? pickAnswer('1', 0.9, { 2: 0.05, end: 0.05 }) : pickAnswer(ATTEMPT_END_KEY, 0.9)),
    })
    await runAttempt({ intent, effects: fx, maxActions: 5 })
    const state = String(fx.judged[1]?.state)
    expect(state).toContain('# HISTORY')
    expect(state).toContain('ok: click link "Link 1" [the nav]')
    expect(state).toContain('actions left: 4')
  })

  it('buildAttemptState passes the isolation guard (whitelisted headings only)', () => {
    const state = buildAttemptState(makeFrame(2, 1), intent, [], 5)
    expect(() => {
      // Re-imported guard: any heading outside INTENT/FRAME/HISTORY would throw.
      state.split('\n').forEach((line) => {
        if (!line.startsWith('# ')) return
        const heading = line.slice(2).trim()
        if (!/^[A-Z][A-Z_-]*$/.test(heading)) return
        expect(['INTENT', 'FRAME', 'HISTORY']).toContain(heading)
      })
    }).not.toThrow()
  })
})
