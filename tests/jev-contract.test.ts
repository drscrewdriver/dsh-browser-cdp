import { describe, expect, it } from 'vitest'
import { assembleSystemOneBody } from '../src/jev/client.ts'
import { buildSystemOneRequest, choice, noul, score, validateQuestions } from '../src/jev/wire.ts'

/**
 * T10.20 契约对拍 — our encoder against `laya-api`'s observable contract.
 *
 * The live half ran 2026-09-24: `_verify-laya-api/jev_contract_smoke.py`
 * against a real laya-api (ENGINE=stub, 127.0.0.1:8011) passed 33/33,
 * including the three 422 boundaries asserted below. This file is the
 * offline half: the SAME payloads the smoke script sends, run through OUR
 * encoder, to assert two things without a server:
 *
 *   1. 等价体 — the body we put on the wire is exactly the body the smoke
 *      script sends: the three keys `model`/`state`/`questions` and nothing
 *      else, because the server's `SystemOneRequest` sets `extra="forbid"`
 *      and one stray field is a 422 that reads like a model refusal.
 *   2. 边界对齐 — every payload the server answers 422 is rejected locally
 *      by `validateQuestions` with a named issue, so the request never
 *      leaves the process; the server's pydantic validators
 *      (`laya-api/src/laya_api/schemas.py`) are the authority this mirrors.
 */

/** Verbatim from `jev_contract_smoke.py` — the state string and question table it sends. */
const TICKET =
  'Duplicate charge on invoice #4411. We were billed twice for March. ' +
  'Please refund the duplicate today or we will cancel our plan.'

const SMOKE_QUESTIONS = {
  department: choice('Which team should handle this?', {
    billing: 'invoices, payments, refunds',
    technical: 'bugs, outages, integrations',
    sales: 'pricing, new contracts',
  }),
  frustration: score('How frustrated is the customer?', ['Calm', 'Frustrated', 'Very angry']),
  is_urgent: noul('Does this convey urgency?'),
}

describe('T10.20 contract: the body we send == the body the smoke script sends', () => {
  it('happy path: exactly {model, state, questions}, deep-equal to the smoke payload', () => {
    const assembled = assembleSystemOneBody(
      { state: TICKET, questions: SMOKE_QUESTIONS, model: 'laya-latest' },
      { name: 'laya', baseUrl: 'http://127.0.0.1:8011' },
    )
    // 等价体：三个键，一个不多 —— server `extra="forbid"` 下多一键即 422。
    expect(Object.keys(assembled.body).sort()).toEqual(['model', 'questions', 'state'])
    expect(assembled.body).toEqual({
      model: 'laya-latest',
      state: TICKET,
      questions: SMOKE_QUESTIONS,
    })
    // The smoke's happy-path questions are valid by OUR validator too: what we
    // send is what the server accepted (200) in the live run.
    expect(assembled.issues).toEqual([])
    expect(assembled.url).toBe('http://127.0.0.1:8011/v1/systemone')
  })

  it('buildSystemOneRequest alone never grows a fourth key', () => {
    const body = buildSystemOneRequest({ nested: ['state'] }, SMOKE_QUESTIONS, 'laya-latest')
    expect(Object.keys(body)).toHaveLength(3)
  })

  it('url join tolerates a trailing slash on the configured base', () => {
    const assembled = assembleSystemOneBody(
      { state: 'hi', questions: { q: noul('x') }, model: 'laya-latest' },
      { name: 'laya', baseUrl: 'http://127.0.0.1:8011/' },
    )
    expect(assembled.url).toBe('http://127.0.0.1:8011/v1/systemone')
  })
})

describe('T10.20 contract: 422 boundaries align — rejected locally, never sent', () => {
  it('choice without criteria -> choice-criteria-empty (server: 422, live-verified)', () => {
    // The smoke sent {type:'choice', instructions:'pick'} with no criteria and
    // the server answered 422. Our validator must refuse the same payload.
    const bad = { x: { type: 'choice' as const, instructions: 'pick', criteria: {} } }
    const codes = validateQuestions(bad).map((issue) => issue.code)
    expect(codes).toContain('choice-criteria-empty')
  })

  it('empty questions -> questions-empty (server: 422, live-verified)', () => {
    const codes = validateQuestions({}).map((issue) => issue.code)
    expect(codes).toContain('questions-empty')
  })

  it('score below 2 or above 10 levels -> score-criteria-out-of-range (server: 422)', () => {
    const few = { q: score('x', ['only']) }
    expect(validateQuestions(few).map((i) => i.code)).toContain('score-criteria-out-of-range')
    const many = { q: score('x', Array.from({ length: 11 }, (_, i) => `L${i}`)) }
    expect(validateQuestions(many).map((i) => i.code)).toContain('score-criteria-out-of-range')
    // Boundaries the server ACCEPTS (2..10) must stay acceptable locally.
    expect(validateQuestions({ q: score('x', ['a', 'b']) })).toEqual([])
    expect(validateQuestions({ q: score('x', Array.from({ length: 10 }, (_, i) => `L${i}`)) })).toEqual([])
  })

  it('more than 256 questions -> questions-over-limit (server: 422)', () => {
    const many: Record<string, ReturnType<typeof noul>> = {}
    for (let i = 0; i < 257; i += 1) many[`q${i}`] = noul(`question ${i}`)
    expect(validateQuestions(many).map((issue) => issue.code)).toContain('questions-over-limit')
  })

  it('choice above 255 options is flagged (server: 422; advisory locally by design)', () => {
    const criteria: Record<string, string> = {}
    for (let i = 0; i < 256; i += 1) criteria[`opt${i}`] = `option ${i}`
    const codes = validateQuestions({ q: choice('x', criteria) }).map((issue) => issue.code)
    expect(codes).toContain('choice-criteria-over-limit')
  })
})
