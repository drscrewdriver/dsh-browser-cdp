import { describe, expect, it } from 'vitest'
import type { Frame } from '../src/jev/frame.ts'
import { buildFrame } from '../src/jev/frame.ts'
import {
  CONTROL_CHOICE_ID,
  CONTROL_OPTIONS,
  DANGER_LEVELS,
  buildIntentState,
  canScroll,
  controlQuestion,
  controlQuestions,
  dangerQuestion,
  doneQuestion,
  pickQuestion,
  pickQuestions,
  type HistoryStep,
  type IntentSpec,
} from '../src/jev/prompt.ts'
import { MAX_SCORE_LEVELS, validateQuestions } from '../src/jev/wire.ts'

/**
 * Intent-injector acceptance. The claims tested here are the ones the design
 * doc makes explicitly, and each is a property a reviewer would otherwise have
 * to take on trust:
 *
 *   1. The candidate list carries NUMBERS, and the question set asks for a
 *      NUMBER. No selector can appear on either side of the exchange.
 *   2. The `excluded` set is always emitted — omitting it is what makes a loop
 *      re-try the same element forever.
 *   3. The assembled state is byte-stable, so a changed judgement is
 *      attributable to the page rather than to prompt drift.
 */

const target = { endpoint: 'http://127.0.0.1:9223', targetId: 'T1', url: 'https://example.test/', title: 'Ex' }
const viewport = { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 2 }

function makeFrame(nodes: { id: number; role: string; name: string; container?: string }[], scrollY = 0): Frame {
  return buildFrame({
    target,
    viewport: { ...viewport, scrollY },
    image: null,
    nodes: nodes.map((entry) => ({
      backendNodeId: entry.id,
      role: entry.role,
      name: entry.name,
      container: entry.container ?? 'main',
    })),
    documentRevision: 1,
    seq: 1,
    now: () => 0,
  }).frame
}

const intent: IntentSpec = {
  goal: 'sign in to the account',
  kind: 'click',
  targetHints: ['a sign-in control in the header'],
  successCriteria: ['the account dashboard is visible'],
  stopConditions: ['a captcha is presented'],
  source: 'user',
}

const frame = makeFrame([
  { id: 1, role: 'button', name: 'Sign in', container: 'nav' },
  { id: 2, role: 'link', name: 'Help', container: 'nav' },
  { id: 3, role: 'textbox', name: 'Email', container: 'form' },
])

describe('jev prompt · the three segments appear in a fixed order', () => {
  it('orders INTENT, then FRAME, then HISTORY', () => {
    const state = buildIntentState({ intent, frame, history: [{ action: 'click', n: 1, ok: true, note: 'ok' }] })
    const intentAt = state.indexOf('# INTENT')
    const frameAt = state.indexOf('# FRAME')
    const historyAt = state.indexOf('# HISTORY')
    expect(intentAt).toBeGreaterThanOrEqual(0)
    expect(frameAt).toBeGreaterThan(intentAt)
    expect(historyAt).toBeGreaterThan(frameAt)
  })

  it('omits the HISTORY header entirely when there is no history and nothing excluded', () => {
    const state = buildIntentState({ intent, frame, history: [] })
    expect(state).not.toContain('# HISTORY')
  })

  it('is byte-stable for identical inputs', () => {
    const a = buildIntentState({ intent, frame, history: [] })
    const b = buildIntentState({ intent, frame, history: [] })
    expect(a).toBe(b)
  })
})

describe('jev prompt · the intent section is faithful to the spec', () => {
  it('carries the goal verbatim and the source for attribution', () => {
    const state = buildIntentState({ intent, frame })
    expect(state).toContain('goal: sign in to the account')
    expect(state).toContain('source: user')
    expect(state).toContain('kind: click')
  })

  it('lists hints, success criteria, and stop conditions under their own labels', () => {
    const state = buildIntentState({ intent, frame })
    expect(state).toContain('targets:')
    expect(state).toContain('done when:')
    expect(state).toContain('stop when:')
    expect(state).toContain('a captcha is presented')
  })

  it('omits empty optional blocks rather than emitting bare headers', () => {
    const bare: IntentSpec = { ...intent, targetHints: [], successCriteria: [], stopConditions: [] }
    const state = buildIntentState({ intent: bare, frame })
    expect(state).not.toContain('targets:')
    expect(state).not.toContain('done when:')
  })
})

describe('jev prompt · the frame section speaks in numbers only', () => {
  it('numbers every candidate and never emits a selector', () => {
    const state = buildIntentState({ intent, frame })
    expect(state).toContain('1. button "Sign in" [nav]')
    expect(state).toContain('2. link "Help" [nav]')
    expect(state).toContain('3. textbox "Email" [form]')
    // No CSS/XPath surface anywhere in the prompt.
    expect(state).not.toMatch(/[>#.]\w+\s*[\[{]/)
    expect(state).not.toContain('document.querySelector')
  })

  it('says out loud when there is no screenshot', () => {
    // A judge told nothing will assume it has an image and describe what it
    // cannot see. The absence must be stated.
    const state = buildIntentState({ intent, frame })
    expect(state).toContain('screenshot: none')
  })

  it('reports the viewport including scroll and device pixel ratio', () => {
    const state = buildIntentState({ intent, frame: makeFrame([{ id: 1, role: 'button', name: 'x' }], 400) })
    expect(state).toContain('1280x800 @2x scroll(0,400)')
  })

  it('flags a truncated scan rather than letting the judge assume it saw everything', () => {
    const truncated: Frame = { ...frame, dom: { ...frame.dom, truncated: true } }
    expect(buildIntentState({ intent, frame: truncated })).toContain('TRUNCATED')
  })

  it('describes a chunk when one is supplied', () => {
    const chunk = {
      frameId: frame.frameId,
      chunkIndex: 2,
      chunkTotal: 3,
      itemCount: frame.dom.nodes.length,
      nodes: frame.dom.nodes,
      containerHint: 'nav',
    }
    const state = buildIntentState({ intent, frame, chunk })
    expect(state).toContain('chunk: 2/3')
    expect(state).toContain('mostly in nav')
  })
})

describe('jev prompt · history keeps the excluded set', () => {
  it('always emits the excluded line when a candidate is ruled out', () => {
    // Without this the judge re-proposes the same element and the loop
    // oscillates until the step budget runs out.
    const state = buildIntentState({ intent, frame, excluded: [2] })
    expect(state).toContain('excluded (do not propose these): 2')
  })

  it('sorts the excluded list so the string is stable', () => {
    const state = buildIntentState({ intent, frame, excluded: [3, 1, 2] })
    expect(state).toContain('excluded (do not propose these): 1, 2, 3')
  })

  it('keeps only the most recent K steps', () => {
    const history: HistoryStep[] = Array.from({ length: 10 }, (_, i) => ({
      action: 'click',
      n: i + 1,
      ok: true,
      note: `step-${i + 1}`,
    }))
    const state = buildIntentState({ intent, frame, history, historyLimit: 3 })
    expect(state).toContain('step-10')
    expect(state).toContain('step-8')
    expect(state).not.toContain('step-7')
  })

  it('marks a failed step visibly rather than as a neutral line', () => {
    const state = buildIntentState({
      intent,
      frame,
      history: [{ action: 'click', n: 2, ok: false, note: 'click-missed' }],
    })
    expect(state).toContain('FAILED')
  })

  it('emits the section with a first-judgement note when only exclusions exist', () => {
    // The case that forced this branch: nothing has been tried yet, but a
    // candidate is already ruled out, so the exclusion list MUST be delivered.
    const state = buildIntentState({ intent, frame, history: [], excluded: [2] })
    expect(state).toContain('# HISTORY')
    expect(state).toContain('first judgement')
    expect(state).toContain('excluded (do not propose these): 2')
  })

  it('never emits a bare "excluded:" with nothing after it', () => {
    // That reads as "everything is excluded" to a careless reader.
    const state = buildIntentState({ intent, frame, history: [{ action: 'click', n: 1, ok: true, note: 'ok' }] })
    expect(state).toContain('# HISTORY')
    expect(state).not.toContain('excluded')
  })
})

describe('jev prompt · the control question', () => {
  it('offers exactly the five fixed options', () => {
    const question = controlQuestion(false)
    expect(Object.keys(question.criteria)).toEqual(['done', 'act', 'wait', 'blocked'])
    expect(CONTROL_OPTIONS).toHaveLength(5)
  })

  it('adds scroll only when the page can scroll', () => {
    expect(Object.keys(controlQuestion(true).criteria)).toContain('scroll')
    expect(Object.keys(controlQuestion(false).criteria)).not.toContain('scroll')
  })

  it('writes each option as a CONDITION, not as a noun label', () => {
    // The most common way to ruin a choice question: the value describes what
    // the option is instead of when to pick it.
    const question = controlQuestion(true)
    for (const criterion of Object.values(question.criteria)) {
      expect(criterion.length).toBeGreaterThan(15)
    }
  })

  it('keeps blocked separate from done', () => {
    // Conflating them turns an unrecoverable stuck state into a success.
    const keys = Object.keys(controlQuestion(true).criteria)
    expect(keys).toContain('blocked')
    expect(keys).toContain('done')
    expect(controlQuestion(true).criteria.blocked).not.toBe(controlQuestion(true).criteria.done)
  })

  it('is a valid single-question set under the protocol', () => {
    expect(validateQuestions(controlQuestions(true))).toEqual([])
    expect(Object.keys(controlQuestions(true))).toEqual([CONTROL_CHOICE_ID])
  })
})

describe('jev prompt · the pick question', () => {
  it('keys options by the candidate number, which is what comes back', () => {
    const question = pickQuestion(frame.dom.nodes)
    expect(Object.keys(question.criteria).sort()).toEqual(['1', '2', '3'])
    expect(question.criteria['1']).toContain('Sign in')
  })

  it('THROWS on an empty candidate list instead of building an invalid table', () => {
    // An empty criteria object is a 422, which reads as a model failure. Better
    // to fail here, where the cause is obvious.
    expect(() => pickQuestion([])).toThrow(/at least one candidate/)
  })

  it('notes a disabled candidate so the judge can avoid it', () => {
    const disabled: Frame = {
      ...frame,
      dom: { ...frame.dom, nodes: [{ ...frame.dom.nodes[0]!, state: { ...frame.dom.nodes[0]!.state, disabled: true } }] },
    }
    expect(pickQuestion(disabled.dom.nodes).criteria['1']).toContain('disabled')
  })

  it('builds a valid two-question set', () => {
    expect(validateQuestions(pickQuestions(frame.dom.nodes))).toEqual([])
  })

  it('offers the danger score within the protocol level range', () => {
    const question = dangerQuestion()
    expect(question.type).toBe('score')
    if (question.type === 'score') {
      expect(question.criteria.length).toBeGreaterThanOrEqual(2)
      expect(question.criteria.length).toBeLessThanOrEqual(MAX_SCORE_LEVELS)
      expect(question.criteria[0]).toContain('harmless')
    }
    expect(DANGER_LEVELS).toHaveLength(5)
  })
})

describe('jev prompt · the completion gate', () => {
  it('spells out both ends of the noul', () => {
    const question = doneQuestion(['the dashboard is visible'])
    expect(question.type).toBe('noul')
    expect(question.criteria?.true).toContain('dashboard is visible')
    expect(question.criteria?.false).toBeTruthy()
  })

  it('falls back to a generic true-case when no criteria are given', () => {
    expect(doneQuestion([]).criteria?.true).toBe('the intent is satisfied')
  })

  it('is a valid question set on its own', () => {
    expect(validateQuestions({ done: doneQuestion(['x']) })).toEqual([])
  })
})

describe('jev prompt · canScroll', () => {
  it('is true once the page has scrolled', () => {
    expect(canScroll(makeFrame([{ id: 1, role: 'button', name: 'x' }], 200))).toBe(true)
  })

  it('is true when the list is empty, since more may exist below', () => {
    expect(canScroll(makeFrame([]))).toBe(true)
  })

  it('is false for a short unscrolled page with candidates', () => {
    expect(canScroll(frame)).toBe(false)
  })
})
