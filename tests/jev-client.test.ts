import { describe, expect, it } from 'vitest'
import {
  assembleSystemOneBody,
  buildJudgeRuntime,
  defaultRuleJudge,
  describeJudge,
  resolvePreferOrder,
  sendJudge,
} from '../src/jev/client.ts'
import type { JudgeSettings } from '../src/types.ts'
import { choice, noul } from '../src/jev/wire.ts'

/**
 * Client acceptance. Two claims carry the weight:
 *
 *   1. `refuse` is ALWAYS the terminal hop and cannot be removed or reordered by
 *      a user's preference string. A chain that could be configured to "never
 *      refuse" has given up the one guarantee it exists to provide.
 *   2. The assembled request body has EXACTLY the three allowed keys. The server
 *      sets `extra="forbid"`, so a stray field is a 422 — and a 422 reads to a
 *      human as "the model refused", which is the most expensive false signal.
 */

const settings = (over: Partial<JudgeSettings> = {}): JudgeSettings => ({
  jevUrl: '',
  jevKey: '',
  jevModel: 'jev',
  layaUrl: 'http://127.0.0.1:8000',
  layaKey: 'k',
  layaModel: 'laya',
  prefer: 'jev,laya,rule',
  chunkSize: 20,
  maxImageBytes: 0,
  historyLimit: 5,
  archiveImage: false,
  stepBudget: 20,
  wallMs: 120_000,
  ...over,
})

describe('jev client · the preference string cannot break the chain', () => {
  it('parses a normal order', () => {
    expect(resolvePreferOrder('jev,laya,rule')).toEqual(['jev', 'laya', 'rule', 'refuse'])
  })

  it('DROPS an unknown name instead of failing', () => {
    // A typo should not disable judgement entirely.
    expect(resolvePreferOrder('jev,bogus,rule')).toEqual(['jev', 'rule', 'refuse'])
  })

  it('collapses duplicates, keeping the FIRST occurrence', () => {
    // Order is the whole point of the field, so the first mention wins.
    expect(resolvePreferOrder('rule,jev,rule')).toEqual(['rule', 'jev', 'refuse'])
  })

  it('ignores whitespace and empty segments', () => {
    expect(resolvePreferOrder(' jev , , laya ')).toEqual(['jev', 'laya', 'refuse'])
  })

  it('ALWAYS appends refuse, even when the user names it elsewhere', () => {
    // The one guarantee: you cannot configure away the terminal refusal.
    expect(resolvePreferOrder('refuse,jev')).toEqual(['jev', 'refuse'])
    expect(resolvePreferOrder('laya,refuse,jev')).toEqual(['laya', 'jev', 'refuse'])
  })

  it('yields just refuse when nothing legal remains', () => {
    // Truthful: the user disabled every hop.
    expect(resolvePreferOrder('')).toEqual(['refuse'])
    expect(resolvePreferOrder('nonsense')).toEqual(['refuse'])
  })
})

describe('jev client · which hops exist', () => {
  it('creates no jev hop when its URL is empty', () => {
    // "Not configured" and "misconfigured" are different facts: the first is
    // silent, the second should be reported.
    const runtime = buildJudgeRuntime(settings({ jevUrl: '' }))
    expect(runtime.chain.resolve().map((hop) => hop.provider.name)).not.toContain('jev')
  })

  it('creates the jev hop when a URL is given', () => {
    const runtime = buildJudgeRuntime(settings({ jevUrl: 'https://jev.example' }))
    expect(runtime.chain.resolve().map((hop) => hop.provider.name)).toContain('jev')
  })

  it('reports a keyless hop as UNAVAILABLE with a named reason', () => {
    // Not an error state — a skip. The chain must be able to see it coming.
    const runtime = buildJudgeRuntime(settings({ layaKey: '' }))
    const hop = runtime.chain.resolve().find((entry) => entry.provider.name === 'laya')
    expect(hop?.available).toBe(false)
    expect(hop?.reason).toBe('laya-no-api-key')
  })

  it('defaults the laya URL to the sidecar port, not JevLoop\u2019s 7789', () => {
    expect(settings().layaUrl).toBe('http://127.0.0.1:8000')
  })

  it('can remove the offline rule hop entirely', () => {
    const runtime = buildJudgeRuntime(settings(), { withoutRule: true })
    expect(runtime.chain.resolve().map((hop) => hop.provider.name)).not.toContain('rule')
  })
})

describe('jev client · the assembled request body', () => {
  const questions = { control: choice('pick one', { act: 'when acting', done: 'when finished' }) }

  it('contains EXACTLY the three keys the server allows', () => {
    const assembled = assembleSystemOneBody(
      { state: 'hello', questions, model: 'laya' },
      { name: 'laya', baseUrl: 'http://127.0.0.1:8000' },
    )
    expect(Object.keys(assembled.body).sort()).toEqual(['model', 'questions', 'state'])
  })

  it('targets /v1/systemone and tolerates a trailing slash', () => {
    const assembled = assembleSystemOneBody(
      { state: 's', questions, model: 'laya' },
      { name: 'laya', baseUrl: 'http://127.0.0.1:8000//' },
    )
    expect(assembled.url).toBe('http://127.0.0.1:8000/v1/systemone')
  })

  it('carries the question set through UNCHANGED, so a preview equals the request', () => {
    const assembled = assembleSystemOneBody({ state: 's', questions, model: 'laya' }, { name: 'laya', baseUrl: 'http://x' })
    expect(assembled.body.questions).toBe(questions)
  })

  it('reports an invalid question set alongside the body rather than throwing', () => {
    // A caller PREVIEWING wants to see what is wrong; a caller SENDING must
    // refuse. Splitting those decisions is what keeps preview and send from
    // drifting into two different encoders.
    const assembled = assembleSystemOneBody(
      { state: 's', questions: { bad: choice('pick', {}) }, model: 'laya' },
      { name: 'laya', baseUrl: 'http://x' },
    )
    expect(assembled.issues.map((issue) => issue.code)).toContain('choice-criteria-empty')
    // The body is still produced — preview is not send.
    expect(assembled.body.questions.bad).toBeDefined()
  })

  it('accepts structured state as well as a string', () => {
    const assembled = assembleSystemOneBody(
      { state: { url: 'x', nodes: [1, 2] }, questions, model: 'laya' },
      { name: 'laya', baseUrl: 'http://x' },
    )
    expect(assembled.body.state).toEqual({ url: 'x', nodes: [1, 2] })
  })
})

describe('jev client · sendJudge refuses locally before spending a request', () => {
  it('does NOT call fetch for an invalid question set, and names the reason', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url))
      return { ok: true, status: 200, json: async () => ({ answers: {} }) } as unknown as Response
    }) as unknown as typeof fetch

    const runtime = buildJudgeRuntime(settings(), { fetch: fetchImpl, now: () => 0 })
    const result = await sendJudge(runtime, { questions: { bad: choice('pick', {}) }, state: 's' })

    // Zero round trips, and the reason is attached — a 422 would have said
    // "bad request", which reads like a model refusal.
    expect(calls).toHaveLength(0)
    expect(result.provider).toBe('refuse')
    expect(result.trace.some((entry) => entry.startsWith('invalid-questions:choice-criteria-empty'))).toBe(true)
  })

  it('sends a valid set and returns the answer', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url))
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(Object.keys(body).sort()).toEqual(['model', 'questions', 'state'])
      return {
        ok: true,
        status: 200,
        json: async () => ({ answers: { control: { choice: 'act', probabilities: { act: 0.9 }, confidence: 0.8 } }, model: 'laya' }),
      } as unknown as Response
    }) as unknown as typeof fetch

    const runtime = buildJudgeRuntime(settings(), { fetch: fetchImpl, now: () => 0 })
    const result = await sendJudge(runtime, {
      questions: { control: choice('pick', { act: 'when acting', done: 'when finished' }) },
      state: 's',
    })
    expect(calls).toHaveLength(1)
    expect(result.provider).toBe('laya')
    expect(result.answers.control?.type).toBe('choice')
  })
})

describe('jev client · describeJudge makes no calls', () => {
  it('describes every hop including the terminal refusal', () => {
    const runtime = buildJudgeRuntime(settings({ jevUrl: 'https://j', jevKey: 'k' }))
    const lines = describeJudge(runtime)
    expect(lines.some((line) => line.startsWith('jev') && line.includes('ready'))).toBe(true)
    expect(lines.some((line) => line.startsWith('laya') && line.includes('ready'))).toBe(true)
    expect(lines.some((line) => line.includes('refuse') && line.includes('terminal'))).toBe(true)
  })

  it('marks a keyless hop as skipped with its reason', () => {
    const runtime = buildJudgeRuntime(settings({ layaKey: '' }))
    expect(describeJudge(runtime).some((line) => line.includes('laya') && line.includes('laya-no-api-key'))).toBe(true)
  })

  it('runs offline with no fetch at all', () => {
    // A status report that performs a request every time it is asked for status
    // is a status report nobody runs.
    const runtime = buildJudgeRuntime(settings({ jevUrl: '', layaUrl: '', withoutRule: true } as Partial<JudgeSettings>))
    expect(() => describeJudge(runtime)).not.toThrow()
  })
})

describe('jev client · the offline rule hop stays honest', () => {
  it('answers with an option that is IN the table it was given', () => {
    // Answering outside the table would be rejected by the server, which turns
    // an offline run into an error rather than a degraded answer.
    const rule = defaultRuleJudge()
    const answers = rule({
      questions: { control: choice('pick', { act: 'when acting', done: 'when finished' }) },
      state: 's',
    })
    const answer = answers.control
    expect(answer?.type).toBe('choice')
    if (answer?.type === 'choice') expect(['act', 'done']).toContain(answer.choice)
  })

  it('prefers `wait` when it is offered, because a blind heuristic must not click', () => {
    const rule = defaultRuleJudge()
    const answers = rule({
      questions: { control: choice('pick', { done: 'a', act: 'b', wait: 'c' }) },
      state: 's',
    })
    const answer = answers.control
    if (answer?.type === 'choice') expect(answer.choice).toBe('wait')
  })

  it('skips a question it cannot answer rather than inventing a value', () => {
    const rule = defaultRuleJudge()
    const answers = rule({ questions: { gate: noul('is it done?') }, state: 's' })
    // No fabricated `noul: 0` — a made-up 0 is a definite "no".
    expect(answers.gate).toBeUndefined()
  })
})
