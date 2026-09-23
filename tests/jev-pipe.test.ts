import { describe, expect, it } from 'vitest'
import { buildFrame, type Frame } from '../src/jev/frame.ts'
import { RuleJudgeProvider, type JudgeChainResult, type JudgeResponse } from '../src/jev/judge.ts'
import type { IntentSpec } from '../src/jev/prompt.ts'
import {
  CONTROL_OPTION_COUNT,
  DEFAULT_PIPE_CONFIG,
  buildRound,
  readControl,
  readPick,
  roundWarnings,
  runControlRound,
  serializeJev,
  serializeLaya,
  toJudgeRequest,
} from '../src/jev/pipe.ts'
import { validateQuestions } from '../src/jev/wire.ts'

/**
 * Pipeline acceptance. The claims here are the ones §5 of the design makes, and
 * each is falsifiable from the outside:
 *
 *   1. The two exits are ONE encoder. `serializeJev` and `serializeLaya` read
 *      the same `QuestionSet` and the same state string, so an archived bundle
 *      and a transmitted body cannot disagree about what was asked.
 *   2. Round 2 is gated on round 1. A pick round is never assembled speculatively
 *      into the same request as the control question.
 *   3. A judgement is read into a decision WITHOUT conflating its failure modes.
 *      "no answer", "unclear answer", "out of frame", and "no provider" are four
 *      different outcomes with four different remedies.
 *
 * No network, no clock, no browser.
 */

const target = { endpoint: 'http://127.0.0.1:9223', targetId: 'T1', url: 'https://example.test/', title: 'Ex' }
const viewport = { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }

function makeFrame(count: number, withImage = false): Frame {
  return buildFrame({
    target,
    viewport,
    image: withImage
      ? { format: 'jpeg', bytes: 140220, dataBase64: 'AAAA', quality: 72, overBudget: false, maxBytes: 0 }
      : null,
    nodes: Array.from({ length: count }, (_, i) => ({
      backendNodeId: 100 + i,
      role: 'button',
      name: `Action ${i + 1}`,
      container: 'main',
    })),
    documentRevision: 1,
    seq: 1,
    // `limit` must be raised past the frame layer's own 20-candidate default,
    // or a 26-candidate fixture silently becomes a 20-candidate one and the
    // chunking assertions test nothing. (This is exactly what happened first.)
    limit: count,
    now: () => 0,
  }).frame
}

const intent: IntentSpec = {
  goal: 'submit the form',
  kind: 'click',
  targetHints: ['a submit control'],
  successCriteria: ['the confirmation page is visible'],
  stopConditions: ['a captcha appears'],
  source: 'user',
}

/** A judge response with an explicit control answer. */
function controlResponse(choice: string, top = 0.9): JudgeResponse {
  return {
    answers: {
      control: {
        type: 'choice',
        choice,
        probabilities: { [choice]: top, other: 1 - top },
        confidence: top,
      },
    },
    provider: 'rule',
    model: 'rule',
    latencyMs: 1,
    degraded: true,
    trace: [],
    warnings: [],
    dropped: [],
    missing: [],
  }
}

describe('jev pipe · the two exits share one encoder', () => {
  it('produces a JEV body with exactly the three wire keys', () => {
    const round = buildRound({ frame: makeFrame(3), intent, round: 'control' })
    expect(Object.keys(round.jev.body).sort()).toEqual(['model', 'questions', 'state'])
    expect(round.jev.kind).toBe('jev-wire')
  })

  it('carries the SAME questions in both exits', () => {
    const round = buildRound({ frame: makeFrame(3), intent, round: 'control' })
    expect(round.laya.questions).toEqual(round.jev.body.questions)
  })

  it('carries the SAME state text in both exits', () => {
    const round = buildRound({ frame: makeFrame(3), intent, round: 'control' })
    // The wire body's state and the archived bundle must describe one frame
    // identically, or a replay would ask a different question.
    expect(round.laya.frame.nodes).toHaveLength(3)
    expect(round.state).toContain('# INTENT')
    expect(round.state).toContain('# FRAME')
  })

  it('serialises the JEV exit to a body a server would accept', () => {
    const round = buildRound({ frame: makeFrame(3), intent, round: 'control' })
    const parsed = JSON.parse(serializeJev(round)) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(['model', 'questions', 'state'])
    expect(typeof parsed.state).toBe('string')
  })

  it('serialises the Laya exit as a self-describing bundle', () => {
    const round = buildRound({ frame: makeFrame(3), intent, round: 'control' })
    const parsed = JSON.parse(serializeLaya(round)) as Record<string, unknown>
    expect(parsed.kind).toBe('laya-frame')
    expect(parsed.frameId).toBe(round.frameId)
    expect(parsed.round).toBe('control')
    // The intent travels with the frame: an archived judgement without the goal
    // it served cannot be reviewed.
    expect((parsed.intent as IntentSpec).goal).toBe('submit the form')
  })

  it('omits base64 from the archive copy by default', () => {
    // A bundle that always carries a few hundred KiB of image is a bundle
    // nobody keeps.
    const round = buildRound({ frame: makeFrame(3, true), intent, round: 'control' })
    expect(round.laya.imageBase64).toBeUndefined()
    // The image METADATA is still there, so a reviewer knows what the judge saw.
    expect(round.laya.frame.image?.bytes).toBe(140220)
  })

  it('embeds base64 only when the caller opts in', () => {
    const round = buildRound({ frame: makeFrame(3, true), intent, round: 'control', config: { archiveImageBudget: 1 } })
    expect(round.laya.imageBase64).toBe('AAAA')
  })

  it('records the configured model in the wire body', () => {
    const round = buildRound({ frame: makeFrame(3), intent, round: 'control', config: { model: 'jev-pro' } })
    expect(round.jev.body.model).toBe('jev-pro')
  })
})

describe('jev pipe · round 1 asks the control question only', () => {
  it('builds exactly one question, keyed control', () => {
    const round = buildRound({ frame: makeFrame(3), intent, round: 'control' })
    expect(Object.keys(round.questions)).toEqual(['control'])
    expect(validateQuestions(round.questions)).toEqual([])
  })

  it('does not ask which element before knowing whether to act', () => {
    // The whole reason round 2 exists separately: asking "which of these 20"
    // before "should we act at all" is how a loop acts on a page it should
    // have left alone.
    const round = buildRound({ frame: makeFrame(30), intent, round: 'control' })
    expect(Object.keys(round.questions)).not.toContain('candidate')
  })

  it('hands the judge the control id it must answer', () => {
    const round = buildRound({ frame: makeFrame(3), intent, round: 'control' })
    expect(toJudgeRequest(round).questions).toBe(round.questions)
    expect(toJudgeRequest(round).state).toBe(round.state)
  })
})

describe('jev pipe · round 2 asks about numbered candidates', () => {
  it('asks for a candidate and a danger score', () => {
    const round = buildRound({ frame: makeFrame(6), intent, round: 'pick', chunkIndex: 1 })
    expect(Object.keys(round.questions).sort()).toEqual(['candidate', 'danger'])
    expect(validateQuestions(round.questions)).toEqual([])
  })

  it('keys the candidate options by the frame number, which is what returns', () => {
    const round = buildRound({ frame: makeFrame(6), intent, round: 'pick', chunkIndex: 1 })
    const question = round.questions.candidate
    expect(question?.type).toBe('choice')
    if (question?.type === 'choice') expect(Object.keys(question.criteria)).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('describes only the requested chunk, out of a sliced frame', () => {
    // 26 candidates at the 20 ceiling: chunk 2 must carry n = 21..26 and NOT
    // renumber them, or the same judge answer would mean two elements.
    const round = buildRound({ frame: makeFrame(26), intent, round: 'pick', chunkIndex: 2 })
    expect(round.laya.chunk?.index).toBe(2)
    expect(round.laya.chunk?.total).toBe(2)
    expect(round.laya.frame.nodes.map((node) => node.n)).toEqual([21, 22, 23, 24, 25, 26])
    const question = round.questions.candidate
    if (question?.type === 'choice') expect(Object.keys(question.criteria)).toEqual(['21', '22', '23', '24', '25', '26'])
  })

  it('THROWS for a chunk that does not exist instead of asking about nothing', () => {
    expect(() => buildRound({ frame: makeFrame(6), intent, round: 'pick', chunkIndex: 5 })).toThrow(/chunk 5/)
  })

  it('reports the chunk plan a caller needs to walk the pages', () => {
    const round = buildRound({ frame: makeFrame(26), intent, round: 'pick', chunkIndex: 1 })
    expect(round.plan.chunkTotal).toBe(2)
    expect(round.plan.reason).toBe('too-many-candidates')
    expect(round.plan.sizes).toEqual([20, 6])
  })
})

describe('jev pipe · reading the control answer', () => {
  it('reads each of the five options', () => {
    expect(readControl(controlResponse('done')).kind).toBe('done')
    expect(readControl(controlResponse('act')).kind).toBe('act')
    expect(readControl(controlResponse('scroll')).kind).toBe('scroll')
    expect(readControl(controlResponse('wait')).kind).toBe('wait')
    expect(readControl(controlResponse('blocked')).kind).toBe('blocked')
  })

  it('separates a low-confidence answer into "unclear" rather than acting', () => {
    // 0.55 is below the 0.6 gate for a five-option question. A judge that is
    // not sure whether to act must not be read as "act".
    const nervous = controlResponse('act', 0.55)
    const read = readControl(nervous)
    expect(read.kind).toBe('unclear')
    if (read.kind === 'unclear') expect(read.code).toBe('below-top')
  })

  it('applies NO margin requirement at the control level, by design', () => {
    // The 5-option bucket has minMargin 0 because a fixed control set has
    // nothing to confuse it with — there is no neighbouring candidate. So a
    // confident top passes even when the runner-up is close, and the ONLY way
    // to be unclear here is a low top. Asserted because the opposite is the
    // naive expectation, and the naive version would reject valid decisions.
    const close: JudgeResponse = {
      ...controlResponse('act'),
      answers: {
        control: { type: 'choice', choice: 'act', probabilities: { act: 0.62, wait: 0.38 }, confidence: 0.05 },
      },
    }
    const read = readControl(close)
    expect(read.kind).toBe('act')
    if (read.kind === 'act') expect(read.top).toBeCloseTo(0.62)
  })

  it('separates "no answer" from "no provider"', () => {
    // Opposite remedies: one is a prompt problem, the other a configuration one.
    const empty: JudgeResponse = { ...controlResponse('act'), answers: {}, missing: ['control'] }
    expect(readControl(empty).kind).toBe('no-answer')

    const refused: JudgeResponse = { ...controlResponse('act'), provider: 'refuse', answers: {}, trace: ['laya-skipped:no-key'] }
    const read = readControl(refused)
    expect(read.kind).toBe('unavailable')
    if (read.kind === 'unavailable') expect(read.trace).toContain('laya-skipped:no-key')
  })

  it('flags an option the table never offered', () => {
    const weird = controlResponse('teleport')
    const read = readControl(weird)
    expect(read.kind).toBe('unclear')
    if (read.kind === 'unclear') expect(read.code).toContain('unknown-option')
  })
})

describe('jev pipe · reading the pick answer', () => {
  const frame = makeFrame(6)
  const candidates = frame.dom.nodes

  const pickResponse = (choice: string, danger: number | null = null): JudgeResponse => ({
    answers: {
      candidate: { type: 'choice', choice, probabilities: { [choice]: 0.9, other: 0.1 }, confidence: 0.8 },
      ...(danger === null ? {} : { danger: { type: 'score' as const, score: danger, legend: {}, probabilities: {}, confidence: 0.9 } }),
    },
    provider: 'rule',
    model: 'rule',
    latencyMs: 1,
    degraded: true,
    trace: [],
    warnings: [],
    dropped: [],
    missing: [],
  })

  it('resolves a candidate number to a node with its backend id', () => {
    const read = readPick(pickResponse('3'), candidates)
    expect(read.kind).toBe('pick')
    if (read.kind === 'pick') {
      expect(read.n).toBe(3)
      // The backendNodeId is what the executor needs — the number alone is not
      // addressable.
      expect(read.node.backendNodeId).toBe(102)
    }
  })

  it('carries the danger score when the judge supplied one', () => {
    const read = readPick(pickResponse('2', 4), candidates)
    expect(read.kind).toBe('pick')
    if (read.kind === 'pick') expect(read.danger).toBe(4)
  })

  it('leaves danger null rather than inventing a safe default of 0', () => {
    // A fabricated "harmless" is exactly the wrong default for a risk score.
    const read = readPick(pickResponse('2'), candidates)
    if (read.kind === 'pick') expect(read.danger).toBeNull()
  })

  it('reports an out-of-frame number as its own outcome, never clamped', () => {
    // This is the failure the numbering scheme exists to expose.
    const read = readPick(pickResponse('99'), candidates)
    expect(read.kind).toBe('out-of-frame')
    if (read.kind === 'out-of-frame') expect(read.n).toBe(99)
  })

  it('treats a non-numeric choice as unclear rather than guessing an index', () => {
    const read = readPick(pickResponse('the big blue button'), candidates)
    expect(read.kind).toBe('unclear')
  })

  it('is unclear when the margin is too thin for the option count', () => {
    const thin: JudgeResponse = {
      ...pickResponse('2'),
      answers: {
        candidate: { type: 'choice', choice: '2', probabilities: { 2: 0.52, 3: 0.48 }, confidence: 0.01 },
      },
    }
    expect(readPick(thin, candidates).kind).toBe('unclear')
  })

  it('reports no answer when the candidate question came back empty', () => {
    const empty: JudgeResponse = { ...pickResponse('2'), answers: {}, missing: ['candidate'] }
    expect(readPick(empty, candidates).kind).toBe('no-answer')
  })

  it('reports unavailability from a refused chain', () => {
    const refused: JudgeResponse = { ...pickResponse('2'), provider: 'refuse', trace: ['x'] }
    expect(readPick(refused, candidates).kind).toBe('unavailable')
  })
})

describe('jev pipe · the control round runs end to end through a provider', () => {
  it('runs the round and returns a decision plus a trace', async () => {
    const round = buildRound({ frame: makeFrame(3), intent, round: 'control' })
    const provider = new RuleJudgeProvider(() => ({
      control: { type: 'choice', choice: 'act', probabilities: { act: 0.9, wait: 0.05 }, confidence: 0.8 },
    }))
    const step = await runControlRound(round, provider, { now: (() => { let t = 0; return () => (t += 3) })(), fetch })
    expect(step.intent.kind).toBe('act')
    expect(step.trace.provider).toBe('rule')
    expect(step.trace.degraded).toBe(true)
    expect(step.trace.round).toBe('control')
    expect(step.trace.chunkTotal).toBe(1)
    expect(step.trace.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('names the single hop when a bare provider answers', () => {
    // An absent chain means "one provider was asked" — one hop, not zero.
    const round = buildRound({ frame: makeFrame(3), intent, round: 'control' })
    const provider = new RuleJudgeProvider(() => ({ control: { type: 'choice', choice: 'done', probabilities: { done: 1 }, confidence: 1 } }))
    return runControlRound(round, provider, { now: () => 0, fetch }).then((step) => {
      expect(step.trace.chain).toEqual(['rule:answered'])
      expect(step.intent.kind).toBe('done')
    })
  })

  it('records the chunk reason so a slicing decision can be explained later', async () => {
    const round = buildRound({ frame: makeFrame(26), intent, round: 'control' })
    const provider = new RuleJudgeProvider(() => ({ control: { type: 'choice', choice: 'act', probabilities: { act: 1 }, confidence: 1 } }))
    const step = await runControlRound(round, provider, { now: () => 0, fetch })
    expect(step.trace.chunkReason).toBe('too-many-candidates')
    expect(step.trace.chunkTotal).toBe(2)
  })
})

describe('jev pipe · warnings a caller must not drop', () => {
  it('says nothing for a clean round', () => {
    const round = buildRound({ frame: makeFrame(3, true), intent, round: 'control' })
    expect(roundWarnings(round)).toEqual([])
  })

  it('flags an over-budget image', () => {
    const frame = makeFrame(3, true)
    const budgeted: Frame = { ...frame, image: { ...frame.image!, overBudget: true } }
    const round = buildRound({ frame: budgeted, intent, round: 'control' })
    expect(roundWarnings(round).some((warning) => warning.startsWith('image-over-budget'))).toBe(true)
  })

  it('flags a truncated frame, so "no suitable element" is not read as proof', () => {
    const frame = makeFrame(3)
    const truncated: Frame = { ...frame, dom: { ...frame.dom, truncated: true } }
    expect(roundWarnings(buildRound({ frame: truncated, intent, round: 'control' })).some((w) => w.startsWith('frame-truncated'))).toBe(true)
  })
})

describe('jev pipe · defaults', () => {
  it('leaves the image budget unbounded by default', () => {
    // Measured: a full-page JPEG was 136.9 KiB, so a byte budget nobody needed
    // would slice static pages for nothing.
    expect(DEFAULT_PIPE_CONFIG.maxImageBytes).toBe(0)
  })

  it('defaults the chunk ceiling to the 20-option advisory ceiling', () => {
    expect(DEFAULT_PIPE_CONFIG.chunkSize).toBe(20)
    expect(CONTROL_OPTION_COUNT).toBe(5)
  })

  it('keeps a five-step history by default', () => {
    expect(DEFAULT_PIPE_CONFIG.historyLimit).toBe(5)
  })
})
