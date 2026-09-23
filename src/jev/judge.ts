/**
 * src/jev/judge.ts — 阶段 10: the JUDGE SEAM. This is the integration point we
 * own, and owning it is the point of the stage.
 *
 * Why a seam rather than "just call JevLoop": three things about JevLoop's own
 * seam are wrong for this pipeline, and each is a real defect not a preference.
 *
 *   1. Its laya provider (`backends.ts:67-72`) sends NO API key, but laya-api's
 *      `/v1/systemone` REQUIRES one — `v1.py:172` delegates to `authenticate_key`
 *      at `v1.py:27`, and there is no anonymous branch. Porting that provider
 *      verbatim means every call is a 401.
 *   2. It defaults to port 7789 while laya-api serves 8000. Also an opened-box
 *      connection error, also silent until the first request.
 *   3. Its provider resolution refuses jev without a key and then falls back to
 *      `rule` — which is correct — but the fallback is invisible in the result,
 *      so a caller cannot tell a model judgement from a heuristic one.
 *
 * So this file keeps the good idea (a provider interface with an explicit
 * preference order) and fixes the three: key and port are first-class config,
 * and every fallback is RECORDED in `degraded` + `trace`.
 *
 * ── The degradation chain, explicit and short ───────────────────────────────
 *
 *     http(jev) → http(laya) → rule → refuse
 *
 * Each hop is skipped only for a NAMED reason, and the reasons accumulate in
 * `trace[]`. `refuse` is a real outcome, not an error: returning "the judge is
 * unavailable" is strictly better than silently picking an element to click,
 * because a wrong click is unrecoverable while a refusal is a retry.
 *
 * ── What is deliberately NOT here ──────────────────────────────────────────
 *
 * No retry loop, no backoff, no circuit breaker. Those belong to the caller
 * that knows the deadline. This file answers "try this provider once, tell me
 * exactly what happened".
 */

import { type AnswerSet, type QuestionSet, type SystemOneRequest, buildSystemOneRequest, normalizeAnswers, validateQuestions } from './wire.ts'

/** The canonical provider order. Index order is priority order. */
export const PROVIDER_ORDER = ['jev', 'laya', 'rule', 'refuse'] as const
export type ProviderName = (typeof PROVIDER_ORDER)[number]

/** One HTTP provider's connection facts. Both fields are required, not defaults. */
export interface HttpProviderConfig {
  /** Base URL WITHOUT the path, e.g. `http://127.0.0.1:8000`. */
  baseUrl: string
  /** Sent as `Authorization: Bearer <key>`. laya-api rejects an absent key. */
  apiKey: string
  /** Model field of the request body. Must be non-empty or the server rejects it. */
  model: string
  /** Per-attempt timeout. No retry — see the header. */
  timeoutMs: number
}

export interface JudgeRequest {
  /** Which question set to ask. Keys become answer ids. */
  questions: QuestionSet
  /** The state the model judges. A string (the assembled prompt) or structured. */
  state: SystemOneRequest['state']
}

/** A non-fatal fact worth surfacing: which hop was skipped and why. */
export interface JudgeWarning {
  code: string
  message: string
  provider: string
}

export interface JudgeUsage {
  inputTokens?: number
  outputTokens?: number
  /** Raw provider payload, kept so a cost report never has to re-parse. */
  raw?: unknown
}

export interface JudgeResponse {
  answers: AnswerSet
  /** The provider that ACTUALLY answered — not the one that was preferred. */
  provider: ProviderName
  model: string
  latencyMs: number
  usage?: JudgeUsage
  /**
   * True when the answer did not come from the first-choice provider.
   *
   * This is the field JevLoop's seam lacks. `rule` is deterministic and offline
   * but it is NOT a model judgement, and a caller that cannot tell the
   * difference will overestimate what it was told.
   */
  degraded: boolean
  /** Why the chain moved: one entry per skipped hop, in order. */
  trace: string[]
  warnings: JudgeWarning[]
  /** Answer ids the provider returned malformed values for. Named, never defaulted. */
  dropped: string[]
  /** Answer ids the caller asked for that never came back. */
  missing: string[]
}

/** Injected so tests never touch the network and never read a wall clock. */
export interface JudgeDeps {
  fetch: typeof fetch
  now: () => number
}

export const defaultJudgeDeps = (): JudgeDeps => ({
  fetch: (...args) => globalThis.fetch(...args),
  now: () => Date.now(),
})

/**
 * The seam. One method: ask, answer, or say why not.
 *
 * Deliberately NOT `decide(intent)` — a provider must not be the place that
 * decides WHAT to ask. Assembling the question set is `prompt.ts`'s job, which
 * keeps providers swappable without re-litigating the prompt.
 */
export interface JudgeProvider {
  readonly name: ProviderName
  available(): { ok: boolean; reason: string }
  decide(req: JudgeRequest, deps: JudgeDeps): Promise<JudgeResponse>
}

// ── the HTTP provider: jev and laya differ only in their config ─────────────

interface SystemOneEnvelope {
  answers?: unknown
  model?: unknown
  usage?: unknown
}

/**
 * One HTTP judge. `jev` and `laya` are the same class with different config,
 * because they ARE the same protocol — the only differences that matter are the
 * endpoint, the key, and the model name.
 */
export class HttpJudgeProvider implements JudgeProvider {
  readonly name: ProviderName
  private readonly config: HttpProviderConfig

  constructor(name: 'jev' | 'laya', config: HttpProviderConfig) {
    this.name = name
    this.config = config
  }

  available(): { ok: boolean; reason: string } {
    if (this.config.baseUrl.trim() === '') return { ok: false, reason: `${this.name}-no-base-url` }
    if (this.config.apiKey.trim() === '') {
      // The whole reason this check exists: laya-api has no anonymous branch, so
      // sending anyway guarantees a 401 and burns a round trip to learn nothing.
      return { ok: false, reason: `${this.name}-no-api-key` }
    }
    if (this.config.model.trim() === '') return { ok: false, reason: `${this.name}-no-model` }
    return { ok: true, reason: '' }
  }

  async decide(req: JudgeRequest, deps: JudgeDeps): Promise<JudgeResponse> {
    const started = deps.now()
    const issues = validateQuestions(req.questions)
    const fatal = issues.filter((issue) => issue.code !== 'choice-criteria-over-limit')
    if (fatal.length > 0) {
      // Reject locally. A 422 says "bad request" and reads to a human as "the
      // model refused", which is the most expensive kind of false signal.
      return refuse(this.name, started, deps.now(), fatal.map((issue) => `${issue.code}:${issue.questionId}`))
    }

    const body = buildSystemOneRequest(req.state, req.questions, this.config.model)
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/v1/systemone`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = await deps.fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Always sent. For jev this is the user's key; for laya it is the
          // shared local key. An empty one was already caught by available().
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        return refuse(this.name, started, deps.now(), [`http-${response.status}`])
      }
      const payload = (await response.json()) as SystemOneEnvelope
      const normalized = normalizeAnswers(payload.answers, Object.keys(req.questions))
      const latencyMs = deps.now() - started
      const warnings: JudgeWarning[] = []
      if (normalized.dropped.length > 0) {
        warnings.push({
          code: 'answers-dropped',
          message: `${this.name} returned unusable values for: ${normalized.dropped.join(', ')}`,
          provider: this.name,
        })
      }
      return {
        answers: normalized.answers,
        provider: this.name,
        model: typeof payload.model === 'string' ? payload.model : this.config.model,
        latencyMs,
        usage: payload.usage === undefined ? undefined : { raw: payload.usage },
        // An HTTP provider answering IS the first choice for its own slot; the
        // caller decides whether reaching `laya` counts as degraded.
        degraded: false,
        trace: [],
        warnings,
        dropped: normalized.dropped,
        missing: normalized.missing,
      }
    } catch (error) {
      const code = controller.signal.aborted ? 'timeout' : 'network'
      return refuse(this.name, started, deps.now(), [`${code}:${messageOf(error)}`])
    } finally {
      clearTimeout(timer)
    }
  }
}

// ── the deterministic provider: rule ────────────────────────────────────────

/**
 * A rule judge: always available, never a model.
 *
 * It exists so the pipeline can run offline and in tests, and so a broken
 * endpoint degrades to something rather than nothing. It is honest about what
 * it is: every response carries `degraded: true`, because a caller that treats
 * a rule answer as a model answer will trust a heuristic far too much.
 *
 * The rules themselves are supplied by the caller rather than invented here —
 * this class is the seam, not the policy.
 */
export type RuleFn = (req: JudgeRequest) => AnswerSet

export class RuleJudgeProvider implements JudgeProvider {
  readonly name: ProviderName = 'rule'
  private readonly rule: RuleFn

  constructor(rule: RuleFn) {
    this.rule = rule
  }

  available(): { ok: boolean; reason: string } {
    return { ok: true, reason: '' }
  }

  async decide(req: JudgeRequest, deps: JudgeDeps): Promise<JudgeResponse> {
    const started = deps.now()
    let answers: AnswerSet = {}
    const warnings: JudgeWarning[] = []
    try {
      answers = this.rule(req)
    } catch (error) {
      // A throwing rule is a bug, not a degrade path — say so without hiding it.
      warnings.push({ code: 'rule-threw', message: messageOf(error), provider: 'rule' })
    }
    const normalized = normalizeAnswers(answers, Object.keys(req.questions))
    return {
      answers: normalized.answers,
      provider: 'rule',
      model: 'rule',
      latencyMs: deps.now() - started,
      degraded: true,
      trace: [],
      warnings,
      dropped: normalized.dropped,
      missing: normalized.missing,
    }
  }
}

/**
 * The terminal hop. It never answers — it reports that no provider could.
 *
 * Kept as a provider rather than an exception so the chain has ONE return shape
 * and a caller cannot accidentally treat "unavailable" as "no action needed".
 * `answers` is empty and `missing` names every question that went unanswered.
 */
export class RefuseJudgeProvider implements JudgeProvider {
  readonly name: ProviderName = 'refuse'
  private readonly reasons: string[]

  constructor(reasons: readonly string[]) {
    this.reasons = [...reasons]
  }

  available(): { ok: boolean; reason: string } {
    return { ok: true, reason: '' }
  }

  async decide(req: JudgeRequest, _deps: JudgeDeps): Promise<JudgeResponse> {
    return {
      answers: {},
      provider: 'refuse',
      model: '',
      latencyMs: 0,
      degraded: true,
      trace: [...this.reasons],
      warnings: [{ code: 'judge-unavailable', message: 'no configured provider could answer', provider: 'refuse' }],
      dropped: [],
      missing: Object.keys(req.questions),
      // NOT an error: a refusal is a retryable, reportable outcome. See header.
    }
  }
}

// ── the chain ──────────────────────────────────────────────────────────────

export interface JudgeChainConfig {
  jev: HttpProviderConfig | null
  laya: HttpProviderConfig | null
  /** The rule fallback. `null` disables the hop entirely. */
  rule: RuleFn | null
  /** Which providers the user has enabled. Absent = all enabled. */
  prefer?: readonly string[]
}

export interface JudgeChainResult extends JudgeResponse {
  /** One line per hop: `provider:skipped` / `provider:answered` / `provider:failed`. */
  chain: string[]
}

/**
 * Resolve the chain, then run it IN ORDER until one hop answers.
 *
 * The two behaviours worth stating explicitly:
 *
 *  - A provider that is unavailable for a NAMED reason is skipped, not called,
 *    which is how a missing key costs zero round trips instead of one 401.
 *  - A provider that is called and fails DOES fall through to the next hop, but
 *    the failure is recorded. Silent fall-through is the defect this file exists
 *    to avoid; loud fall-through is the feature.
 */
export class JudgeChain {
  private readonly config: JudgeChainConfig
  private readonly deps: JudgeDeps

  constructor(config: JudgeChainConfig, deps: JudgeDeps = defaultJudgeDeps()) {
    this.config = config
    this.deps = deps
  }

  /** The providers in priority order, each with its availability verdict. */
  resolve(): { provider: JudgeProvider; available: boolean; reason: string }[] {
    const prefer = this.config.prefer ?? PROVIDER_ORDER
    const byName = new Map<ProviderName, JudgeProvider>()
    if (this.config.jev !== null) byName.set('jev', new HttpJudgeProvider('jev', this.config.jev))
    if (this.config.laya !== null) byName.set('laya', new HttpJudgeProvider('laya', this.config.laya))
    if (this.config.rule !== null) byName.set('rule', new RuleJudgeProvider(this.config.rule))
    // `refuse` is constructed lazily by decide() from the accumulated reasons,
    // so it has no config and is never "unavailable".

    const out: { provider: JudgeProvider; available: boolean; reason: string }[] = []
    for (const name of prefer) {
      if (name === 'refuse') continue
      const provider = byName.get(name as ProviderName)
      if (provider === undefined) continue
      const verdict = provider.available()
      out.push({ provider, available: verdict.ok, reason: verdict.reason })
    }
    return out
  }

  async decide(req: JudgeRequest): Promise<JudgeChainResult> {
    const chain: string[] = []
    const trace: string[] = []
    const warnings: JudgeWarning[] = []
    const started = this.deps.now()

    const hops = this.resolve()
    // The first hop that was CONFIGURED is the reference for `degraded`.
    //
    // This must not be derived by counting `:answered` entries in `chain`.
    // The tempting version — "only the first answer counts as undegraded" —
    // is wrong in the exact case the flag exists for: jev configured but
    // unreachable, laya answering. Then the FIRST entry is `jev:failed`, the
    // first `:answered` is laya's, and a count-based check calls a genuine
    // fall-through undegraded. Captured by a test that injects a per-URL fetch.
    const firstConfigured = hops[0]?.provider.name ?? null

    for (const hop of hops) {
      if (!hop.available) {
        chain.push(`${hop.provider.name}:skipped`)
        trace.push(`${hop.provider.name}-skipped:${hop.reason}`)
        warnings.push({ code: 'provider-skipped', message: hop.reason, provider: hop.provider.name })
        continue
      }

      const response = await hop.provider.decide(req, this.deps)
      warnings.push(...response.warnings)

      if (response.provider === 'refuse') {
        // The provider refused locally (its own validation or its own transport
        // error). Record why and move on — the next hop may still work.
        chain.push(`${hop.provider.name}:failed`)
        trace.push(...response.trace.map((entry) => `${hop.provider.name}-${entry}`))
        continue
      }

      chain.push(`${hop.provider.name}:answered`)
      return {
        ...response,
        // Degraded means "not the first hop that was configured". Falling to
        // laya after an unreachable jev IS a degradation, even though laya is a
        // real model; reaching `rule` is the loudest case.
        degraded: hop.provider.name !== firstConfigured || response.degraded,
        trace,
        warnings,
        chain,
        latencyMs: this.deps.now() - started,
      }
    }

    const refused = await new RefuseJudgeProvider(trace).decide(req, this.deps)
    chain.push('refuse:terminal')
    return { ...refused, warnings: [...warnings, ...refused.warnings], chain, latencyMs: this.deps.now() - started }
  }
}

// ── tools ──────────────────────────────────────────────────────────────────

function refuse(provider: ProviderName, started: number, ended: number, reasons: string[]): JudgeResponse {
  return {
    answers: {},
    provider: 'refuse',
    model: '',
    latencyMs: Math.max(0, ended - started),
    degraded: true,
    trace: reasons,
    warnings: [],
    dropped: [],
    missing: [],
    // Note the asymmetry: `provider:'refuse'` travels with the reasons, so the
    // chain above can tell a local rejection from a genuine answer.
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
