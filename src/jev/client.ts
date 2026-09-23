/**
 * src/jev/client.ts — 阶段 10: settings → a live judge chain, and the REQUEST BODY.
 *
 * This is the layer that turns "the user typed a URL and a key in the settings
 * panel" into "an object that can answer a question". It is deliberately the
 * only place that knows both about `JudgeSettings` and about `JudgeChain`, so
 * neither the config layer nor the judge layer has to know about the other.
 *
 * ── The request body, which is the part people get wrong ───────────────────
 *
 * `POST /v1/systemone` accepts exactly `{model, state, questions}` and the
 * server sets `extra="forbid"`, so ONE stray field is a 422 — and a 422 reads to
 * a human as "the model refused", which is the most expensive kind of false
 * signal. `assembleSystemOneBody` is therefore the only way a body gets built
 * here, and it is exported on its own so a caller can PREVIEW a body without
 * sending it (that is what `bcdp_jev_ask` does with `dryRun`).
 *
 * ── Why `prefer` is parsed here and not in config ──────────────────────────
 *
 * The saved string is stored raw (same convention as `runtimeArgs`), so a later
 * change to the legal hop list cannot retroactively rewrite what the user typed.
 * The parsing rules are:
 *
 *   1. unknown names are DROPPED, not an error — a typo should not disable
 *      judgement entirely;
 *   2. duplicates collapse, keeping the first occurrence (order is the whole
 *      point of the field);
 *   3. `refuse` is ALWAYS last and cannot be removed or reordered. A preference
 *      list that could put the terminal hop first, or drop it, would let a user
 *      configure "never refuse" — which is the one guarantee the chain exists to
 *      provide.
 */

import type { JudgeSettings } from '../types.ts'
import {
  JudgeChain,
  PROVIDER_ORDER,
  type HttpProviderConfig,
  type JudgeChainResult,
  type JudgeDeps,
  type JudgeRequest,
  type ProviderName,
  type RuleFn,
} from './judge.ts'
import type { AnswerSet, QuestionSet, SystemOneRequest } from './wire.ts'
import { buildSystemOneRequest, validateQuestions } from './wire.ts'

/** The chain plus the facts a status report needs to explain it. */
export interface JudgeRuntime {
  chain: JudgeChain
  settings: JudgeSettings
  /** The parsed preference order, `refuse` included as the terminal hop. */
  order: ProviderName[]
  /** Per-hop verdicts, computed WITHOUT calling anything. */
  hops: { name: ProviderName; available: boolean; reason: string }[]
}

/**
 * Parse the saved `judgePrefer` string into a legal hop order.
 *
 * See the header for the three rules. Note that an EMPTY result is not an error:
 * with nothing legal left, the order is just `[refuse]`, which is a truthful
 * description of "the user disabled every hop".
 */
export function resolvePreferOrder(raw: string): ProviderName[] {
  const legal = PROVIDER_ORDER.filter((name) => name !== 'refuse')
  const seen: ProviderName[] = []
  for (const token of raw.split(',')) {
    const name = token.trim() as ProviderName
    if (name === 'refuse') continue
    if (!legal.includes(name)) continue
    if (seen.includes(name)) continue
    seen.push(name)
  }
  return [...seen, 'refuse']
}

/** A rule judge that is deliberately, visibly trivial. */
export function defaultRuleJudge(): RuleFn {
  return (req) => {
    // The rule hop exists so the pipeline is runnable with no network at all.
    // It answers `wait`, not `act`: a heuristic that cannot see confidence has
    // no business choosing an element, and returning `act` here would make an
    // offline run look like a working agent.
    const answers: AnswerSet = {}
    for (const [id, question] of Object.entries(req.questions)) {
      if (question.type !== 'choice') continue
      const first = Object.keys(question.criteria)[0]
      if (first === undefined) continue
      // Prefer an explicitly present `wait` option; otherwise take the first
      // legal option, so the answer is always IN the table that was sent.
      const choice = 'wait' in question.criteria ? 'wait' : first
      answers[id] = { type: 'choice', choice, probabilities: { [choice]: 1 }, confidence: 1 }
    }
    return answers
  }
}

export interface BuildJudgeRuntimeOptions {
  /** Injected for tests; both default to the real globals. */
  fetch?: typeof fetch
  now?: () => number
  /** Override the offline rule hop. */
  rule?: RuleFn
  /** `rule: null` removes the offline hop entirely. */
  withoutRule?: boolean
}

/**
 * Build the judge runtime from settings.
 *
 * A hop is configured only when it has a URL: an empty `jevUrl` means the user
 * has no JEV judge, which is a different fact from "the JEV judge is
 * misconfigured". The first should be silent and the second should be reported,
 * and this is the branch that keeps them apart.
 */
export function buildJudgeRuntime(
  settings: JudgeSettings,
  options: BuildJudgeRuntimeOptions = {},
): JudgeRuntime {
  const order = resolvePreferOrder(settings.prefer)
  const jev = settings.jevUrl.trim() === '' ? null : httpConfig(settings.jevUrl, settings.jevKey, settings.jevModel)
  const laya = settings.layaUrl.trim() === '' ? null : httpConfig(settings.layaUrl, settings.layaKey, settings.layaModel)

  const deps: JudgeDeps = {
    fetch: options.fetch ?? ((...args) => globalThis.fetch(...args)),
    now: options.now ?? (() => Date.now()),
  }

  // `rule` is configured by default: it is the offline floor, so naming it in
  // `prefer` must always find it.
  const rule = options.withoutRule === true ? null : (options.rule ?? defaultRuleJudge())
  const chain = new JudgeChain({ jev, laya, rule, prefer: order }, deps)

  return { chain, settings, order, hops: [] }
}

const httpConfig = (baseUrl: string, apiKey: string, model: string): HttpProviderConfig => ({
  baseUrl: baseUrl.trim(),
  apiKey: apiKey.trim(),
  model: model.trim() === '' ? 'laya' : model.trim(),
  // One attempt, no retry: retry policy belongs to the caller that knows the
  // deadline. 15s is generous for a judgement and short enough that a dead
  // endpoint does not consume a whole step budget.
  timeoutMs: 15_000,
})

// ── the request body ───────────────────────────────────────────────────────

export interface AssembleBodyInput {
  state: SystemOneRequest['state']
  questions: QuestionSet
  model: string
}

export interface AssembledBody {
  body: SystemOneRequest
  /** Non-empty means this body MUST NOT be sent as-is. */
  issues: { code: string; message: string; questionId: string }[]
  /** `POST` target for the hop this body is destined for. */
  url: string
}

/**
 * Assemble the request body for one hop.
 *
 * Returns the issues ALONGSIDE the body rather than throwing: a caller that is
 * previewing a body (`dryRun`) wants to see what is wrong with it, and a caller
 * about to send needs to refuse. Splitting those two decisions between the
 * assembler and the sender is what keeps "preview" and "send" from drifting into
 * two different encoders.
 */
export function assembleSystemOneBody(
  input: AssembleBodyInput,
  hop: { name: 'jev' | 'laya'; baseUrl: string },
): AssembledBody {
  return {
    body: buildSystemOneRequest(input.state, input.questions, input.model),
    issues: validateQuestions(input.questions),
    url: `${hop.baseUrl.replace(/\/+$/, '')}/v1/systemone`,
  }
}

/** Send one already-assembled body through the chain, refusing an invalid one. */
export async function sendJudge(runtime: JudgeRuntime, request: JudgeRequest): Promise<JudgeChainResult> {
  const issues = validateQuestions(request.questions)
  const fatal = issues.filter((issue) => issue.code !== 'choice-criteria-over-limit')
  if (fatal.length > 0) {
    // Fail locally with the REASONS attached. Letting the server answer 422
    // would produce a message that reads like a model refusal.
    return {
      answers: {},
      provider: 'refuse',
      model: '',
      latencyMs: 0,
      degraded: true,
      trace: fatal.map((issue) => `invalid-questions:${issue.code}:${issue.questionId}`),
      warnings: [],
      dropped: [],
      missing: Object.keys(request.questions),
      chain: ['local:refused'],
    }
  }
  return runtime.chain.decide(request)
}

/**
 * A one-line-per-hop description of the chain, for `bcdp_jev_status`.
 *
 * Computed WITHOUT calling anything, because a status tool that performs a
 * request every time it is asked for status is a status tool nobody runs.
 */
export function describeJudge(runtime: JudgeRuntime): string[] {
  const lines: string[] = []
  const resolved = runtime.chain.resolve()
  for (const name of runtime.order) {
    if (name === 'refuse') {
      lines.push('refuse    terminal (always available; a refusal is a result, not an error)')
      continue
    }
    const hop = resolved.find((entry) => entry.provider.name === name)
    if (hop === undefined) {
      lines.push(`${pad(name)} not configured`)
      continue
    }
    lines.push(hop.available ? `${pad(name)} ready` : `${pad(name)} SKIPPED (${hop.reason})`)
  }
  return lines
}

const pad = (name: string): string => (name + '        ').slice(0, 9)
