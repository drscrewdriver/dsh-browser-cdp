import { describe, expect, it } from 'vitest'
import {
  CHOICE_OPTIONS_ADVISORY,
  MAX_CHOICE_OPTIONS,
  MAX_QUESTIONS,
  MAX_SCORE_LEVELS,
  MIN_SCORE_LEVELS,
  THRESHOLD_BUCKETS,
  bucketFor,
  buildSystemOneRequest,
  checkChoiceMargin,
  choice,
  noul,
  normalizeAnswers,
  runnerUpProbability,
  score,
  topProbability,
  validateQuestions,
} from '../src/jev/wire.ts'

/**
 * Wire-format acceptance. Every assertion here is a claim about what
 * `laya-api/src/laya_api/schemas.py` does with the payload — the server's
 * pydantic `model_validator`s are the authority, not the docs. No server is
 * contacted: the point is that a bad payload is rejected LOCALLY, before a
 * round trip turns it into an unreadable 422.
 */

describe('JEV wire · request shape', () => {
  it('emits exactly the three keys the server allows (extra=forbid)', () => {
    const body = buildSystemOneRequest({ goal: 'sign in' }, { q: noul('is it done?') }, 'laya')
    expect(Object.keys(body).sort()).toEqual(['model', 'questions', 'state'])
  })

  it('accepts state as a string, an object, and an array', () => {
    const questions = { q: noul('done?') }
    for (const state of ['text', { a: 1 }, [1, 2]]) {
      expect(() => buildSystemOneRequest(state, questions, 'laya')).not.toThrow()
    }
  })

  it('keeps the constructor shapes to the primitive definitions', () => {
    expect(noul('q')).toEqual({ type: 'noul', instructions: 'q' })
    expect(noul('q', { true: 'yes', false: 'no' })).toEqual({
      type: 'noul',
      instructions: 'q',
      criteria: { true: 'yes', false: 'no' },
    })
    expect(choice('pick', { a: 'when a' })).toEqual({ type: 'choice', instructions: 'pick', criteria: { a: 'when a' } })
    expect(score('rate', ['low', 'high'])).toEqual({ type: 'score', instructions: 'rate', criteria: ['low', 'high'] })
  })
})

describe('JEV wire · validation matches the server limits', () => {
  it('rejects an empty question set', () => {
    const issues = validateQuestions({})
    expect(issues.map((issue) => issue.code)).toContain('questions-empty')
  })

  it('rejects an EMPTY choice criteria object', () => {
    // The exact accident this guards: a candidate list filtered to nothing.
    // The server answers 422, which reads like a model failure.
    const issues = validateQuestions({ c: choice('pick', {}) })
    const issue = issues.find((entry) => entry.code === 'choice-criteria-empty')
    expect(issue).toBeDefined()
    expect(issue?.questionId).toBe('c')
  })

  it('rejects a choice table above the protocol ceiling', () => {
    const criteria: Record<string, string> = {}
    for (let i = 0; i < MAX_CHOICE_OPTIONS + 1; i += 1) criteria[`o${i}`] = 'always'
    const issues = validateQuestions({ c: choice('pick', criteria) })
    expect(issues.map((issue) => issue.code)).toContain('choice-criteria-over-limit')
  })

  it('accepts a choice table at exactly the ceiling', () => {
    const criteria: Record<string, string> = {}
    for (let i = 0; i < MAX_CHOICE_OPTIONS; i += 1) criteria[`o${i}`] = 'always'
    expect(validateQuestions({ c: choice('pick', criteria) })).toEqual([])
  })

  it('enforces the score level range 2..10', () => {
    expect(validateQuestions({ s: score('rate', ['only']) }).map((i) => i.code)).toContain('score-criteria-out-of-range')
    const eleven = Array.from({ length: MAX_SCORE_LEVELS + 1 }, (_, i) => `l${i}`)
    expect(validateQuestions({ s: score('rate', eleven) }).map((i) => i.code)).toContain('score-criteria-out-of-range')
    expect(validateQuestions({ s: score('rate', ['low', 'high']) })).toEqual([])
    expect(MIN_SCORE_LEVELS).toBe(2)
  })

  it('enforces the question count ceiling', () => {
    const questions: Record<string, ReturnType<typeof noul>> = {}
    for (let i = 0; i < MAX_QUESTIONS + 1; i += 1) questions[`q${i}`] = noul('done?')
    expect(validateQuestions(questions).map((i) => i.code)).toContain('questions-over-limit')
  })

  it('reports EVERY issue rather than stopping at the first', () => {
    // Fixing one 422 per round trip is the slowest way to converge, so a
    // multi-problem payload must come back with all of them.
    const issues = validateQuestions({
      a: choice('pick', {}),
      b: score('rate', []),
      c: choice('pick', { x: 'ok' }),
    })
    expect(issues.length).toBeGreaterThanOrEqual(2)
  })

  it('separates an empty noul instruction from a valid one', () => {
    expect(validateQuestions({ n: noul('   ') }).map((i) => i.code)).toContain('noul-instructions-empty')
    expect(validateQuestions({ n: noul('done?') })).toEqual([])
  })

  it('states the advisory option ceiling below the protocol ceiling', () => {
    expect(CHOICE_OPTIONS_ADVISORY).toBeLessThan(MAX_CHOICE_OPTIONS)
  })
})

describe('JEV wire · answer normalisation never fabricates a value', () => {
  it('drops a tagged-but-valueless answer instead of defaulting it to 0', () => {
    // The JevLoop lesson: a fabricated 0 is a definite "no" that silently
    // steers the loop. A drop is recoverable, a false value is not.
    const result = normalizeAnswers({ gate: { type: 'noul' } }, ['gate'])
    expect(result.answers.gate).toBeUndefined()
    expect(result.dropped).toEqual(['gate'])
    expect(result.missing).toEqual(['gate'])
  })

  it('clamps a noul probability into 0..1', () => {
    expect(normalizeAnswers({ g: { noul: 1.4 } }, ['g']).answers.g).toEqual({ type: 'noul', noul: 1 })
    expect(normalizeAnswers({ g: { noul: -2 } }, ['g']).answers.g).toEqual({ type: 'noul', noul: 0 })
  })

  it('reads a choice by its value, not by its type tag', () => {
    const result = normalizeAnswers(
      { pick: { choice: 'b', probabilities: { a: 0.2, b: 0.7 }, confidence: 0.3 } },
      ['pick'],
    )
    expect(result.answers.pick).toEqual({ type: 'choice', choice: 'b', probabilities: { a: 0.2, b: 0.7 }, confidence: 0.3 })
  })

  it('derives confidence from the probabilities when the server omits it', () => {
    const result = normalizeAnswers({ pick: { choice: 'b', probabilities: { a: 0.2, b: 0.75 } } }, ['pick'])
    expect(result.answers.pick?.type).toBe('choice')
    if (result.answers.pick?.type === 'choice') expect(result.answers.pick.confidence).toBeCloseTo(0.75)
  })

  it('drops an empty-string choice — a blank option is not an answer', () => {
    expect(normalizeAnswers({ pick: { choice: '' } }, ['pick']).dropped).toEqual(['pick'])
  })

  it('drops a score answer with no number', () => {
    expect(normalizeAnswers({ s: { legend: { 1: 'low' } } }, ['s']).dropped).toEqual(['s'])
  })

  it('names answers the caller asked for that never arrived', () => {
    const result = normalizeAnswers({ a: { noul: 1 } }, ['a', 'b', 'c'])
    expect(result.missing.sort()).toEqual(['b', 'c'])
  })

  it('survives a non-object payload without throwing', () => {
    expect(normalizeAnswers(null, ['x']).missing).toEqual(['x'])
    expect(normalizeAnswers('nope', ['x']).missing).toEqual(['x'])
  })
})

describe('JEV wire · thresholds use top, never confidence', () => {
  it('reads top from the chosen option for a choice answer', () => {
    const answer = normalizeAnswers({ p: { choice: 'b', probabilities: { a: 0.2, b: 0.7 } } }, ['p']).answers.p
    expect(topProbability(answer)).toBeCloseTo(0.7)
  })

  it('reads the runner-up as the SECOND highest probability', () => {
    const answer = normalizeAnswers({ p: { choice: 'b', probabilities: { a: 0.2, b: 0.7, c: 0.1 } } }, ['p']).answers.p
    expect(runnerUpProbability(answer)).toBeCloseTo(0.2)
  })

  it('requires BOTH a high top and a clear margin', () => {
    // 0.55 vs 0.45 is a coin flip wearing a confident number.
    const nervous = normalizeAnswers({ p: { choice: 'a', probabilities: { a: 0.55, b: 0.45 } } }, ['p']).answers.p
    const flagged = checkChoiceMargin(nervous, 0.5, 0.15)
    expect(flagged.ok).toBe(false)
    expect(flagged.code).toBe('below-margin')

    const clear = normalizeAnswers({ p: { choice: 'a', probabilities: { a: 0.8, b: 0.1 } } }, ['p']).answers.p
    expect(checkChoiceMargin(clear, 0.5, 0.15).ok).toBe(true)
  })

  it('fails a low top even when the margin is huge', () => {
    const weak = normalizeAnswers({ p: { choice: 'a', probabilities: { a: 0.3, b: 0.05 } } }, ['p']).answers.p
    expect(checkChoiceMargin(weak, 0.5, 0.15).code).toBe('below-top')
  })

  it('fails a missing answer rather than treating it as confident', () => {
    expect(checkChoiceMargin(undefined, 0.5, 0.15).code).toBe('no-answer')
  })

  it('binds the bucket to the candidate count, loosening as options shrink', () => {
    // The whole reason buckets exist: `top` distributions are not comparable
    // at 5 options and at 20, so a single threshold would be wrong at one end.
    expect(bucketFor(5).minTop).toBe(0.6)
    expect(bucketFor(5).minMargin).toBe(0)
    expect(bucketFor(20).minMargin).toBe(0.15)
    expect(bucketFor(20).minTop).toBeLessThan(bucketFor(5).minTop)
  })

  it('applies the strictest bucket above the largest defined one', () => {
    const strictest = THRESHOLD_BUCKETS[THRESHOLD_BUCKETS.length - 1]
    expect(bucketFor(500)).toEqual(strictest)
    expect(bucketFor(500).minMargin).toBe(0.15)
  })

  it('buckets are ordered, so the lookup cannot silently skip one', () => {
    const ceilings = THRESHOLD_BUCKETS.map((bucket) => bucket.maxCandidates)
    expect([...ceilings].sort((a, b) => a - b)).toEqual(ceilings)
    // The 20-option bucket must match the prompt layer's chunk ceiling.
    expect(ceilings[ceilings.length - 1]).toBe(CHOICE_OPTIONS_ADVISORY)
  })
})
