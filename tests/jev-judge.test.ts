import { describe, expect, it } from 'vitest'
import {
  HttpJudgeProvider,
  JudgeChain,
  PROVIDER_ORDER,
  RuleJudgeProvider,
  type JudgeChainConfig,
  type JudgeDeps,
  type JudgeRequest,
} from '../src/jev/judge.ts'
import { noul } from '../src/jev/wire.ts'

/**
 * Judge-seam acceptance. Two properties are the reason this seam exists and are
 * therefore tested hardest:
 *
 *   1. A provider that cannot work is SKIPPED, not called. laya-api has no
 *      anonymous branch, so sending without a key guarantees a 401 — the skip
 *      is what makes a missing key cost zero round trips.
 *   2. Degradation is RECORDED. JevLoop's seam falls back invisibly; a caller
 *      here can always tell a model judgement from a heuristic one.
 *
 * No network: `fetch` is injected. No wall clock: `now` is injected.
 */

const questions = { gate: noul('is it done?') }
const request: JudgeRequest = { questions, state: 'state' }

/** A deterministic clock: each read advances by 5ms, so latency is exact. */
function steppingClock(step = 5): JudgeDeps['now'] {
  let value = 1000
  return () => {
    const current = value
    value += step
    return current
  }
}

function fetchReturning(body: unknown, ok = true, status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return {
      ok,
      status,
      json: async () => body,
    } as unknown as Response
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const configured = { baseUrl: 'http://127.0.0.1:8000', apiKey: 'k', model: 'laya', timeoutMs: 1000 }

describe('judge · the HTTP provider sends the wire format verbatim', () => {
  it('posts to /v1/systemone with a bearer key and exactly three body keys', async () => {
    const { fetchImpl, calls } = fetchReturning({ answers: { gate: { noul: 1 } }, model: 'laya' })
    const provider = new HttpJudgeProvider('laya', configured)
    const response = await provider.decide(request, { fetch: fetchImpl, now: steppingClock() })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('http://127.0.0.1:8000/v1/systemone')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer k')
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['model', 'questions', 'state'])
    expect(response.provider).toBe('laya')
    expect(response.answers.gate).toEqual({ type: 'noul', noul: 1 })
  })

  it('tolerates a trailing slash on the base URL without doubling it', async () => {
    const { fetchImpl, calls } = fetchReturning({ answers: { gate: { noul: 1 } } })
    const provider = new HttpJudgeProvider('laya', { ...configured, baseUrl: 'http://127.0.0.1:8000//' })
    await provider.decide(request, { fetch: fetchImpl, now: steppingClock() })
    expect(calls[0]?.url).toBe('http://127.0.0.1:8000/v1/systemone')
  })

  it('reports latency from the injected clock', async () => {
    const { fetchImpl } = fetchReturning({ answers: { gate: { noul: 1 } } })
    const provider = new HttpJudgeProvider('laya', configured)
    const response = await provider.decide(request, { fetch: fetchImpl, now: steppingClock(7) })
    expect(response.latencyMs).toBe(7)
  })

  it('names unusable answers instead of defaulting them', async () => {
    const { fetchImpl } = fetchReturning({ answers: { gate: { type: 'noul' } } })
    const provider = new HttpJudgeProvider('laya', configured)
    const response = await provider.decide(request, { fetch: fetchImpl, now: steppingClock() })
    expect(response.provider).toBe('laya')
    expect(response.dropped).toEqual(['gate'])
    expect(response.warnings.map((warning) => warning.code)).toContain('answers-dropped')
  })

  it('refuses a malformed question set WITHOUT a round trip', async () => {
    // A 422 says "bad request" and reads as "the model refused" — the most
    // expensive kind of false signal, so it is prevented locally.
    const { fetchImpl, calls } = fetchReturning({ answers: {} })
    const provider = new HttpJudgeProvider('laya', configured)
    const response = await provider.decide(
      { questions: { bad: { type: 'choice', instructions: 'pick', criteria: {} } }, state: 's' },
      { fetch: fetchImpl, now: steppingClock() },
    )
    expect(calls).toHaveLength(0)
    expect(response.provider).toBe('refuse')
    expect(response.trace.some((entry) => entry.startsWith('choice-criteria-empty'))).toBe(true)
  })

  it('turns a non-OK status into a refusal carrying the code', async () => {
    const { fetchImpl } = fetchReturning({}, false, 401)
    const provider = new HttpJudgeProvider('laya', configured)
    const response = await provider.decide(request, { fetch: fetchImpl, now: steppingClock() })
    expect(response.provider).toBe('refuse')
    expect(response.trace).toContain('http-401')
  })

  it('distinguishes a transport failure from a timeout', async () => {
    const boom = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const provider = new HttpJudgeProvider('laya', configured)
    const response = await provider.decide(request, { fetch: boom, now: steppingClock() })
    expect(response.trace.some((entry) => entry.startsWith('network:'))).toBe(true)
  })

  it('is unavailable without a key — the exact JevLoop defect', async () => {
    // laya-api's /v1/systemone has no anonymous branch (v1.py:172 -> v1.py:27),
    // so a keyless call is a guaranteed 401. The verdict is computed, not tried.
    const provider = new HttpJudgeProvider('laya', { ...configured, apiKey: '' })
    const verdict = provider.available()
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('laya-no-api-key')
  })

  it('is unavailable without a base URL or a model', () => {
    expect(new HttpJudgeProvider('jev', { ...configured, baseUrl: '' }).available().reason).toBe('jev-no-base-url')
    expect(new HttpJudgeProvider('jev', { ...configured, model: '  ' }).available().reason).toBe('jev-no-model')
  })
})

describe('judge · the rule provider is honest about being a heuristic', () => {
  it('always marks its answer degraded', async () => {
    const provider = new RuleJudgeProvider(() => ({ gate: { type: 'noul', noul: 1 } }))
    const response = await provider.decide(request, { fetch: fetch, now: steppingClock() })
    expect(response.provider).toBe('rule')
    expect(response.degraded).toBe(true)
  })

  it('survives a throwing rule without losing the failure', async () => {
    const provider = new RuleJudgeProvider(() => {
      throw new Error('rule blew up')
    })
    const response = await provider.decide(request, { fetch: fetch, now: steppingClock() })
    expect(response.warnings.map((warning) => warning.code)).toContain('rule-threw')
    expect(response.missing).toEqual(['gate'])
  })
})

describe('judge · the chain degrades loudly, never silently', () => {
  const noRule: JudgeChainConfig = { jev: null, laya: null, rule: null }

  it('answers from the first available provider and is not degraded', async () => {
    const { fetchImpl, calls } = fetchReturning({ answers: { gate: { noul: 1 } } })
    const chain = new JudgeChain({ ...noRule, laya: configured }, { fetch: fetchImpl, now: steppingClock() })
    const result = await chain.decide(request)
    expect(result.provider).toBe('laya')
    expect(result.degraded).toBe(false)
    expect(result.chain).toEqual(['laya:answered'])
    expect(calls).toHaveLength(1)
  })

  it('SKIPS a keyless laya without calling it, and records why', async () => {
    const { fetchImpl, calls } = fetchReturning({ answers: {} })
    const chain = new JudgeChain(
      { ...noRule, laya: { ...configured, apiKey: '' }, rule: () => ({ gate: { type: 'noul', noul: 0 } }) },
      { fetch: fetchImpl, now: steppingClock() },
    )
    const result = await chain.decide(request)
    // Zero round trips: the whole point of the availability verdict.
    expect(calls).toHaveLength(0)
    expect(result.chain).toEqual(['laya:skipped', 'rule:answered'])
    expect(result.trace).toContain('laya-skipped:laya-no-api-key')
  })

  it('falls from a FAILING jev to laya and marks the result degraded', async () => {
    const { fetchImpl, calls } = fetchReturning({}, false, 502)
    // Both hops share the injected fetch, so jev fails and laya — reached with
    // the same failing transport — also refuses; the chain must still record
    // both attempts in order.
    const chain = new JudgeChain(
      { ...noRule, jev: configured, laya: { ...configured, baseUrl: 'http://127.0.0.1:8000' } },
      { fetch: fetchImpl, now: steppingClock() },
    )
    const result = await chain.decide(request)
    expect(calls.length).toBe(2)
    expect(result.chain).toEqual(['jev:failed', 'laya:failed', 'refuse:terminal'])
    expect(result.provider).toBe('refuse')
  })

  it('marks a fall-through to laya as degraded even though laya is a real model', async () => {
    // A per-URL fetch: jev is unreachable, laya works. This is the case the
    // `degraded` flag exists for — it is NOT visible from the answer alone.
    const seen: string[] = []
    const perUrl = (async (url: string | URL | Request) => {
      const text = String(url)
      seen.push(text)
      if (text.includes('9000')) throw new Error('ECONNREFUSED')
      return { ok: true, status: 200, json: async () => ({ answers: { gate: { noul: 1 } } }) } as unknown as Response
    }) as unknown as typeof fetch

    const chain = new JudgeChain(
      { ...noRule, jev: { ...configured, baseUrl: 'http://127.0.0.1:9000' }, laya: configured },
      { fetch: perUrl, now: steppingClock() },
    )
    const result = await chain.decide(request)
    expect(seen).toHaveLength(2)
    expect(result.provider).toBe('laya')
    expect(result.degraded).toBe(true)
    expect(result.chain).toEqual(['jev:failed', 'laya:answered'])
  })

  it('reaches the terminal refusal with every reason attached', async () => {
    const chain = new JudgeChain(
      { jev: { ...configured, apiKey: '' }, laya: { ...configured, apiKey: '' }, rule: null },
      { fetch: fetch, now: steppingClock() },
    )
    const result = await chain.decide(request)
    expect(result.provider).toBe('refuse')
    expect(result.answers).toEqual({})
    // Every question is named as unanswered — a caller cannot mistake this for
    // "the judge said no action".
    expect(result.missing).toEqual(['gate'])
    expect(result.trace).toEqual(['jev-skipped:jev-no-api-key', 'laya-skipped:laya-no-api-key'])
    expect(result.chain).toEqual(['jev:skipped', 'laya:skipped', 'refuse:terminal'])
    expect(result.warnings.map((warning) => warning.code)).toContain('judge-unavailable')
  })

  it('honours a caller-supplied preference order', async () => {
    const chain = new JudgeChain(
      {
        jev: configured,
        laya: configured,
        rule: () => ({ gate: { type: 'noul', noul: 0 } }),
        prefer: ['rule'],
      },
      { fetch: fetch, now: steppingClock() },
    )
    const result = await chain.decide(request)
    expect(result.provider).toBe('rule')
    expect(result.chain).toEqual(['rule:answered'])
  })

  it('exposes the resolved order with each hop\u2019s verdict, without calling anything', () => {
    const chain = new JudgeChain({ jev: null, laya: { ...configured, apiKey: '' }, rule: () => ({}) })
    const resolved = chain.resolve()
    expect(resolved.map((hop) => hop.provider.name)).toEqual(['laya', 'rule'])
    expect(resolved[0]?.available).toBe(false)
    expect(resolved[1]?.available).toBe(true)
  })

  it('skips providers the user has not configured at all', () => {
    const chain = new JudgeChain({ ...noRule, rule: () => ({}) })
    expect(chain.resolve().map((hop) => hop.provider.name)).toEqual(['rule'])
  })

  it('keeps the declared provider order as the default preference', () => {
    expect([...PROVIDER_ORDER]).toEqual(['jev', 'laya', 'rule', 'refuse'])
  })
})
