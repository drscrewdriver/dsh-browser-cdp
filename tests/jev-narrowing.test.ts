import { describe, expect, it } from 'vitest'
import { buildFrame, chaptersOf, shouldAskChapter, type Frame, type FrameNodeInput } from '../src/jev/frame.ts'
import {
  JUDGE_SECTIONS,
  assertJudgeIsolation,
  buildIntentState,
  chapterQuestion,
  chapterQuestions,
  type IntentSpec,
  type ProgressReport,
} from '../src/jev/prompt.ts'
import { buildRound, readChapter } from '../src/jev/pipe.ts'
import { runLoop, type LoopEffects } from '../src/jev/loop.ts'
import type { JudgeChainResult } from '../src/jev/judge.ts'
import { validateQuestions } from '../src/jev/wire.ts'

/**
 * Acceptance for the three things this round added, each of which the user
 * asked for by name:
 *
 *   1. 动作分章节化 — narrowing by chapter before choosing an element.
 *   2. 意图 + 操作进度 — a MECHANICAL progress section the judge can steer on.
 *   3. 不带完整会话 session 前缀 — the judge context is isolated, ENFORCED.
 */

/** A `choice` response for one question id. Typed once so fixtures stay literal. */
function choiceResult(id: string, choice: string, top = 0.9): JudgeChainResult {
  return {
    answers: { [id]: { type: 'choice', choice, probabilities: { [choice]: top, other: 1 - top }, confidence: top } },
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

const target = { endpoint: 'ws://x/devtools/browser/1', targetId: 'T1', url: 'https://shop.example/checkout', title: 'Checkout' }
const viewport = { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }

const intent: IntentSpec = {
  goal: 'complete the purchase',
  kind: 'click',
  targetHints: [],
  successCriteria: ['an order number is visible'],
  stopConditions: [],
  source: 'user',
}

/** A page with three chapters: a checkout form, a nav, and a coupon form. */
function framed(): Frame {
  const nodes: FrameNodeInput[] = [
    { backendNodeId: 1, role: 'textbox', name: 'Email', container: 'form#1', containerLabel: 'the form "Checkout"' },
    { backendNodeId: 2, role: 'textbox', name: 'Card', container: 'form#1', containerLabel: 'the form "Checkout"' },
    { backendNodeId: 3, role: 'button', name: 'Pay now', container: 'form#1', containerLabel: 'the form "Checkout"' },
    { backendNodeId: 4, role: 'link', name: 'Back to cart', container: 'navigation#1', containerLabel: 'the navigation' },
    { backendNodeId: 5, role: 'button', name: 'Apply coupon', container: 'form#2', containerLabel: 'the form "Coupon"' },
  ]
  return buildFrame({ target, viewport, image: null, nodes, documentRevision: 1, seq: 1, limit: 20, now: () => 0 }).frame
}

/** A page with ONE chapter — the chapter round must be skipped. */
function singleChapterFrame(): Frame {
  return buildFrame({
    target,
    viewport,
    image: null,
    nodes: [
      { backendNodeId: 1, role: 'button', name: 'Only', container: 'page', containerLabel: 'the page itself' },
      { backendNodeId: 2, role: 'link', name: 'Also', container: 'page', containerLabel: 'the page itself' },
    ],
    documentRevision: 1,
    seq: 1,
    limit: 20,
    now: () => 0,
  }).frame
}

describe('章节化 · grouping candidates into chapters', () => {
  it('groups by container in FIRST-APPEARANCE order', () => {
    // A judge should be offered sections in the order the page presents them —
    // the order a human reads it — not alphabetically.
    const chapters = chaptersOf(framed().dom.nodes)
    expect(chapters.map((chapter) => chapter.key)).toEqual(['form#1', 'navigation#1', 'form#2'])
    expect(chapters.map((chapter) => chapter.nodes.length)).toEqual([3, 1, 1])
  })

  it('keeps every chapter\'s candidates in document order with their original n', () => {
    const chapters = chaptersOf(framed().dom.nodes)
    expect(chapters[0]?.nodes.map((node) => node.n)).toEqual([1, 2, 3])
    // Numbering is NOT renumbered per chapter: `n` still identifies one element.
    expect(chapters[1]?.nodes.map((node) => node.n)).toEqual([4])
  })

  it('carries the readable label through for prose', () => {
    expect(chaptersOf(framed().dom.nodes)[0]?.label).toBe('the form "Checkout"')
  })

  it('asks for a chapter only when there is more than one', () => {
    // A question with a single option is a round trip that can only go one way.
    expect(shouldAskChapter(singleChapterFrame().dom.nodes)).toBe(false)
    expect(shouldAskChapter(framed().dom.nodes)).toBe(true)
  })

  it('returns one chapter for an unchaptered page rather than none', () => {
    const chapters = chaptersOf(singleChapterFrame().dom.nodes)
    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.key).toBe('page')
  })
})

describe('章节化 · the chapter question', () => {
  it('keys options by a short chapter key, because the key comes back verbatim', () => {
    const question = chapterQuestion(chaptersOf(framed().dom.nodes))
    expect(Object.keys(question.criteria)).toEqual(['form#1', 'navigation#1', 'form#2'])
  })

  it('writes each option as a CONDITION, and names what is inside', () => {
    // A noun label ("the nav bar") makes the judge match text instead of
    // reasoning about where the intent can be satisfied — the standard way to
    // ruin a routing question.
    const question = chapterQuestion(chaptersOf(framed().dom.nodes))
    for (const criterion of Object.values(question.criteria)) {
      expect(criterion).toContain('holds the control this intent needs')
      expect(criterion.length).toBeGreaterThan(40)
    }
    expect(question.criteria['form#1']).toContain('button "Pay now"')
  })

  it('summarises a long chapter instead of listing everything', () => {
    const many = buildFrame({
      target,
      viewport,
      image: null,
      nodes: Array.from({ length: 9 }, (_, i) => ({
        backendNodeId: i + 1,
        role: 'button',
        name: `b${i}`,
        container: 'form#1',
        containerLabel: 'the form "Big"',
      })),
      documentRevision: 1,
      seq: 1,
      limit: 20,
      now: () => 0,
    }).frame
    expect(chapterQuestion(chaptersOf(many.dom.nodes)).criteria['form#1']).toContain('+5 more')
  })

  it('THROWS on no chapters rather than building an invalid empty table', () => {
    expect(() => chapterQuestion([])).toThrow(/at least one chapter/)
  })

  it('is a valid question set under the protocol', () => {
    expect(validateQuestions(chapterQuestions(chaptersOf(framed().dom.nodes)))).toEqual([])
    expect(Object.keys(chapterQuestions(chaptersOf(framed().dom.nodes)))).toEqual(['chapter'])
  })
})

describe('章节化 · what each round OFFERS', () => {
  it('a chapter round offers no candidates at all', () => {
    const round = buildRound({ frame: framed(), intent, round: 'chapter' })
    expect(Object.keys(round.questions)).toEqual(['chapter'])
    expect(round.questions.candidate).toBeUndefined()
  })

  it('a pick round WITH a chapter offers only that chapter', () => {
    const round = buildRound({ frame: framed(), intent, round: 'pick', chapterKey: 'navigation#1' })
    const question = round.questions.candidate
    expect(question?.type).toBe('choice')
    // Only the nav's one candidate (n = 4) — the other four are NOT re-listed.
    if (question?.type === 'choice') expect(Object.keys(question.criteria)).toEqual(['4'])
  })

  it('a pick round WITHOUT a chapter offers the whole frame (single-chapter pages)', () => {
    const round = buildRound({ frame: singleChapterFrame(), intent, round: 'pick' })
    const question = round.questions.candidate
    if (question?.type === 'choice') expect(Object.keys(question.criteria)).toEqual(['1', '2'])
  })

  it('says out loud which section it is looking at, and how many are elsewhere', () => {
    // "Here are 4 candidates" means something different when the judge knows the
    // other 16 are elsewhere and were deliberately not re-listed.
    const round = buildRound({ frame: framed(), intent, round: 'pick', chapterKey: 'form#1' })
    expect(String(round.state)).toContain('chapter: form#1 — the form "Checkout"')
    // The fixture has 5 candidates: 3 in form#1, and navigation#1 + form#2 make 2.
    expect(String(round.state)).toContain('2 other candidate(s) live elsewhere')
  })

  it('counts "elsewhere" against the WHOLE frame, not by subtraction', () => {
    // Subtracting the offered list would fold excluded candidates into
    // "elsewhere" and tell the judge about elements it never had a chance to see.
    const round = buildRound({ frame: framed(), intent, round: 'pick', chapterKey: 'form#1', excluded: [2] })
    // Still 2: the excluded candidate is inside form#1, so it is neither offered
    // nor counted as "elsewhere" — it simply is not the judge's business.
    expect(String(round.state)).toContain('2 other candidate(s) live elsewhere')
    const question = round.questions.candidate
    if (question?.type === 'choice') expect(Object.keys(question.criteria)).toEqual(['1', '3'])
  })

  it('lists EXACTLY the candidates the question can accept', () => {
    // The invariant that broke first: the FRAME prose listed the whole chunk
    // while the table offered only the chosen chapter, so the judge could read
    // four extra options and answer with one the round would reject. Prose and
    // table are two views of ONE set and must not drift.
    const round = buildRound({ frame: framed(), intent, round: 'pick', chapterKey: 'form#1', excluded: [2] })
    const listed = String(round.state)
      .split('\n')
      .filter((line) => /^\d+\. /.test(line))
      .map((line) => Number.parseInt(line, 10))
    const question = round.questions.candidate
    const offerable = question?.type === 'choice' ? Object.keys(question.criteria).map(Number) : []
    expect(listed).toEqual(offerable)
    expect(listed).toEqual([1, 3])
    // And the excluded one is NOT listed, so "do not propose these" is not
    // contradicted by the list right above it.
    expect(listed).not.toContain(2)
  })

  it('lists the whole frame for a control round, which is page-level', () => {
    const round = buildRound({ frame: framed(), intent, round: 'control' })
    const listed = String(round.state).split('\n').filter((line) => /^\d+\. /.test(line))
    expect(listed).toHaveLength(5)
  })

  it('drops an excluded candidate from the CHAPTER counts too', () => {
    const round = buildRound({ frame: framed(), intent, round: 'chapter', excluded: [1, 2, 3] })
    // form#1 is now empty, so it is not offered as a place to look.
    const question = round.questions.chapter
    if (question?.type === 'choice') expect(Object.keys(question.criteria)).not.toContain('form#1')
  })
})

describe('进度 · the progress section is mechanical and optional', () => {
  const progress: ProgressReport = {
    step: 3,
    stepBudget: 20,
    judgeLeft: 51,
    capturesLeft: 3,
    chapters: [
      { key: 'navigation#1', attempts: 1, outcome: 'every candidate ruled out' },
      { key: 'form#1', attempts: 2, outcome: 'acting on button "Pay now"' },
    ],
    completed: ['click link "Accept cookies" in form#2'],
    note: 'recovering from a failed click',
  }

  it('is absent when the loop is not running', () => {
    expect(buildIntentState({ intent, frame: framed() })).not.toContain('# PROGRESS')
  })

  it('renders counts, chapter outcomes and completed actions', () => {
    const state = buildIntentState({ intent, frame: framed(), progress })
    expect(state).toContain('# PROGRESS')
    expect(state).toContain('step: 3 of 20')
    expect(state).toContain('budget left: judge=51 captures=3')
    expect(state).toContain('navigation#1: 1 attempt(s), every candidate ruled out')
    expect(state).toContain('click link "Accept cookies" in form#2')
    expect(state).toContain('note: recovering from a failed click')
  })

  it('says "none yet" rather than omitting a section, so absence is unambiguous', () => {
    const fresh: ProgressReport = { ...progress, chapters: [], completed: [], note: '' }
    const state = buildIntentState({ intent, frame: framed(), progress: fresh })
    expect(state).toContain('chapters entered: none yet')
    expect(state).toContain('actions that succeeded: none yet')
    expect(state).not.toContain('note:')
  })

  it('places progress between INTENT and FRAME', () => {
    const state = buildIntentState({ intent, frame: framed(), progress })
    expect(state.indexOf('# INTENT')).toBeLessThan(state.indexOf('# PROGRESS'))
    expect(state.indexOf('# PROGRESS')).toBeLessThan(state.indexOf('# FRAME'))
  })
})

describe('上下文隔离 · enforced, not promised', () => {
  it('a real judge context contains only the four allowed sections', () => {
    const state = buildIntentState({
      intent,
      frame: framed(),
      progress: { step: 1, stepBudget: 20, judgeLeft: 60, capturesLeft: 5, chapters: [], completed: [], note: '' },
      history: [{ action: 'click', n: 1, ok: true, note: 'ok' }],
      excluded: [2],
    })
    const headings = state
      .split('\n')
      .filter((line) => /^# [A-Z][A-Z_-]*$/.test(line))
      .map((line) => line.slice(2))
    expect(headings).toEqual(['INTENT', 'PROGRESS', 'FRAME', 'HISTORY'])
    expect(headings.every((heading) => (JUDGE_SECTIONS as readonly string[]).includes(heading))).toBe(true)
  })

  it('THROWS when a foreign section is present', () => {
    // The failure this prevents: somebody appends `# SESSION` to be helpful, and
    // every judgement silently starts carrying the agent's conversation.
    expect(() => assertJudgeIsolation('# INTENT\ngoal: x\n\n# SESSION\nuser: hello')).toThrow(/leaked a non-judge section: "# SESSION"/)
    expect(() => assertJudgeIsolation('# CONVERSATION\n…')).toThrow(/leaked/)
  })

  it('accepts the four allowed sections in any order', () => {
    expect(() => assertJudgeIsolation('# HISTORY\n\n# FRAME\n\n# INTENT\n\n# PROGRESS')).not.toThrow()
  })

  it('does NOT false-positive on a # inside content', () => {
    // Node names, URLs and prose legitimately contain `#`. Only a bare
    // upper-case word is treated as a heading, which is the shape this file emits.
    expect(() => assertJudgeIsolation('# FRAME\nurl: https://x.test/a#fragment\n1. link "#anchor" [nav]\n# not a heading')).not.toThrow()
    expect(() => assertJudgeIsolation('# FRAME\n1. button "Save #1" [form#1]')).not.toThrow()
  })

  it('the guard runs on every composed state, so a leak cannot ship', () => {
    // Asserted indirectly: if the guard were not wired into buildIntentState,
    // the previous case would pass through and a leak would go unnoticed.
    const state = buildIntentState({ intent, frame: framed() })
    expect(() => assertJudgeIsolation(state)).not.toThrow()
  })
})

describe('章节化 · reading the chapter answer', () => {
  const chapters = chaptersOf(framed().dom.nodes)

  const answer = (choice: string, top = 0.9): JudgeChainResult => choiceResult('chapter', choice, top)

  it('resolves a chosen key to its candidates', () => {
    const read = readChapter(answer('form#1'), chapters)
    expect(read.kind).toBe('chapter')
    if (read.kind === 'chapter') {
      expect(read.nodes.map((node) => node.n)).toEqual([1, 2, 3])
      expect(read.label).toBe('the form "Checkout"')
    }
  })

  it('reports an unknown section as its OWN outcome, never a fallback', () => {
    // Falling back to "look everywhere" would silently undo the narrowing while
    // the trace claimed it happened — worse than admitting the answer was useless.
    const read = readChapter(answer('footer#9'), chapters)
    expect(read.kind).toBe('unknown-chapter')
    if (read.kind === 'unknown-chapter') expect(read.key).toBe('footer#9')
  })

  it('is unclear when the margin is too thin for the chapter count', () => {
    const thin: JudgeChainResult = {
      ...answer('form#1'),
      answers: { chapter: { type: 'choice', choice: 'form#1', probabilities: { 'form#1': 0.4, 'form#2': 0.35 }, confidence: 0.05 } },
    }
    expect(readChapter(thin, chapters).kind).toBe('unclear')
  })

  it('reports unavailability and a missing answer distinctly', () => {
    expect(readChapter({ ...answer('form#1'), provider: 'refuse', trace: ['x'] }, chapters).kind).toBe('unavailable')
    expect(readChapter({ ...answer('form#1'), answers: {}, missing: ['chapter'] }, chapters).kind).toBe('no-answer')
  })
})

describe('章节化 · the loop walks control → chapter → candidate', () => {
  function loopHarness(frame: Frame, pickKey = '3') {
    const judged: string[] = []
    const acted: number[] = []
    const effects: LoopEffects = {
      async capture() { return { frame, documentRevision: 1 } },
      async judge(request) {
        const ids = Object.keys(request.questions)
        judged.push(ids.join('+'))
        const state = String(request.state)
        if (ids.includes('chapter')) {
          // Steer into the checkout form, whose button carries n = 3.
          return choiceResult('chapter', 'form#1')
        }
        if (ids.includes('candidate')) {
          // The offered set must be the CHOSEN chapter's only, and the judge
          // answers with a number from it.
          const offered = Object.keys((request.questions.candidate as { criteria: Record<string, string> }).criteria)
          return choiceResult('candidate', offered.includes(pickKey) ? pickKey : offered[0] ?? '1')
        }
        void state
        return choiceResult('control', 'act')
      },
      async act(request) {
        acted.push(request.n)
        return { ok: true, code: 'ok', action: 'click', n: request.n, backendNodeId: 200 + request.n, point: { x: 0, y: 0 }, measured: { x: 0, y: 0, width: 1, height: 1 }, drift: 0 }
      },
      async verify() { return { satisfied: true, note: 'ok' } },
      now: () => 0,
      async sleep() {},
    }
    return { effects, judged, acted }
  }

  it('asks control, then chapter, then candidate — in that order', async () => {
    const h = loopHarness(framed())
    await runLoop({ intent, effects: h.effects, budgets: { steps: 2, judge: 20, captures: 9, chunksPerCapture: 8, wallMs: 60_000 } })
    expect(h.judged.slice(0, 3)).toEqual(['control', 'chapter', 'candidate+danger'])
  })

  it('SKIPS the chapter round when the page has only one section', async () => {
    const h = loopHarness(singleChapterFrame(), '1')
    await runLoop({ intent, effects: h.effects, budgets: { steps: 2, judge: 20, captures: 9, chunksPerCapture: 8, wallMs: 60_000 } })
    expect(h.judged.slice(0, 2)).toEqual(['control', 'candidate+danger'])
    expect(h.judged).not.toContain('chapter')
  })

  it('acts on a candidate from the CHOSEN chapter', async () => {
    const h = loopHarness(framed(), '3')
    // ONE step: two steps would legitimately act twice, because the loop
    // re-captures after an action and asks again — which is the point of a loop.
    await runLoop({ intent, effects: h.effects, budgets: { steps: 1, judge: 20, captures: 9, chunksPerCapture: 8, wallMs: 60_000 } })
    expect(h.acted).toEqual([3])
  })

  it('tells the judge which chapters were already entered', async () => {
    // This is what stops the loop being sent back into a section that yielded
    // nothing — the whole reason progress exists.
    const h = loopHarness(framed(), '3')
    const states: string[] = []
    const wrapped: LoopEffects = {
      ...h.effects,
      async judge(request) {
        states.push(String(request.state))
        return h.effects.judge(request)
      },
    }
    await runLoop({ intent, effects: wrapped, budgets: { steps: 2, judge: 20, captures: 9, chunksPerCapture: 8, wallMs: 60_000 } })
    const withProgress = states.find((state) => state.includes('chapters entered:'))
    expect(withProgress).toBeDefined()
    expect(withProgress).toContain('form#1')
  })

  it('reports an unknown section as stuck, not as a silent retry of the whole page', async () => {
    const h = loopHarness(framed())
    const misdirected: LoopEffects = {
      ...h.effects,
      async judge(request) {
        if (Object.keys(request.questions).includes('chapter')) {
          return choiceResult('chapter', 'footer#9', 0.95)
        }
        return h.effects.judge(request)
      },
    }
    const result = await runLoop({ intent, effects: misdirected, stalledLimit: 2, budgets: { steps: 9, judge: 20, captures: 9, chunksPerCapture: 8, wallMs: 60_000 } })
    expect(result.status).toBe('stuck')
    expect(result.steps.some((step) => step.control === 'unknown-chapter')).toBe(true)
    expect(h.acted).toHaveLength(0)
  })
})
