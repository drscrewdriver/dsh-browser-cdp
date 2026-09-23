/**
 * src/jev/wire.ts — 阶段 10: the JEV wire primitives, defined once.
 *
 * WHY THIS FILE EXISTS RATHER THAN IMPORTING `JevLoop`.
 *
 * The three primitives — `noul`, `choice`, `score` — are a WIRE FORMAT, not a
 * library feature. `laya-api/src/laya_api/schemas.py` IS the protocol: its
 * pydantic `model_validator`s are what the server actually enforces, so the
 * shapes below are copied from that file rather than from documentation. Three
 * of its rules are load-bearing and each is enforced here BEFORE a request is
 * sent, because a 422 costs a round trip and reads as "the model refused":
 *
 *   1. `extra="forbid"` — one extra field is a 422. So every request built here
 *      carries exactly `{model, state, questions}` and nothing else.
 *   2. `choice.criteria` must be a NON-EMPTY OBJECT (≤255 keys). A list is a
 *      422, and an empty one is a 422 — both are easy to produce by accident
 *      when a candidate list is filtered down to nothing.
 *   3. `score.criteria` must be an ARRAY of 2..10 levels. `score` is the weakest
 *      primitive (more levels, less accurate), so the cap is also design advice.
 *
 * We deliberately do NOT import JevLoop: it is a separate Node package with a
 * build step (our zero-new-runtime-dependency rule), its laya provider sends no
 * API key (laya-api REQUIRES one — `v1.py:172` → `v1.py:27`, no anonymous
 * branch), and its loop excludes screenshots from the judge input, which is the
 * one thing this pipeline is built to send.
 *
 * Pure data + pure functions: no I/O, no clock, no fetch. That is what makes the
 * wire contract unit-testable without a server.
 */

/** What the model is being asked. Keys are the answer ids that come back. */
export type QuestionType = 'noul' | 'choice' | 'score'

/** P(true) — a gate. Used for "is this done" / "must we act". */
export interface NoulQuestion {
  type: 'noul'
  instructions: string
  /** Optional: spelling out both ends measurably improves the judgement. */
  criteria?: { true: string; false: string }
}

/**
 * Pick one option — routing.
 *
 * ⚠️ The KEY is the option itself (it returns verbatim as `answers[id].choice`),
 * and the VALUE is "under what conditions should this be picked". Writing the
 * value as a noun label instead of a criterion is the most common way to make a
 * choice question useless.
 */
export interface ChoiceQuestion {
  type: 'choice'
  instructions: string
  criteria: Record<string, string>
}

/** An ordered scale, low → high. Scores may come back fractional. */
export interface ScoreQuestion {
  type: 'score'
  instructions: string
  criteria: string[]
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion
export type QuestionSet = Record<string, Question>

export interface NoulAnswer {
  type: 'noul'
  noul: number
}
export interface ChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities: Record<string, number>
  confidence: number
}
export interface ScoreAnswer {
  type: 'score'
  score: number
  legend: Record<string, string>
  probabilities: Record<string, number>
  confidence: number
}
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer
export type AnswerSet = Record<string, Answer>

/** The exact request body `POST /v1/systemone` accepts. */
export interface SystemOneRequest {
  model: string
  state: string | Record<string, unknown> | unknown[]
  questions: QuestionSet
}

// ── constructors ────────────────────────────────────────────────────────────

export const noul = (instructions: string, criteria?: { true: string; false: string }): NoulQuestion =>
  criteria === undefined ? { type: 'noul', instructions } : { type: 'noul', instructions, criteria }

export const choice = (instructions: string, criteria: Record<string, string>): ChoiceQuestion => ({
  type: 'choice',
  instructions,
  criteria,
})

export const score = (instructions: string, criteria: string[]): ScoreQuestion => ({
  type: 'score',
  instructions,
  criteria,
})

// ── the limits the SERVER enforces, stated in our own words ──────────────────

/** `choice` options: an option table is a fixed head budget, so more is worse. */
export const MAX_CHOICE_OPTIONS = 255
/** Practical ceiling: measured to degrade well before the protocol limit. */
export const CHOICE_OPTIONS_ADVISORY = 20
/** `score` levels: ≥2 to be a scale at all, ≤10 per the protocol. */
export const MIN_SCORE_LEVELS = 2
export const MAX_SCORE_LEVELS = 10
export const MAX_QUESTIONS = 256

export interface ValidationIssue {
  code: string
  message: string
  /** Which question id the issue belongs to ('' for whole-request issues). */
  questionId: string
}

/**
 * Validate a question set against the SERVER's rules.
 *
 * Returns every issue rather than the first, because a caller fixing one 422 at
 * a time over a network round trip is the slowest possible way to converge.
 * `over`-limits are separated from `invalid`-shapes: an over-limit table is a
 * design decision to revisit, a wrong shape is a bug.
 */
export function validateQuestions(questions: QuestionSet): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const ids = Object.keys(questions)
  if (ids.length === 0) {
    issues.push({ code: 'questions-empty', message: 'a request needs at least one question', questionId: '' })
  }
  if (ids.length > MAX_QUESTIONS) {
    issues.push({
      code: 'questions-over-limit',
      message: `${ids.length} questions exceeds the protocol limit of ${MAX_QUESTIONS}`,
      questionId: '',
    })
  }

  for (const id of ids) {
    const question = questions[id]
    if (question === undefined) continue
    if (question.type === 'noul') {
      if (question.instructions.trim() === '') {
        issues.push({ code: 'noul-instructions-empty', message: 'noul needs instructions', questionId: id })
      }
      continue
    }
    if (question.type === 'choice') {
      const keys = Object.keys(question.criteria)
      if (keys.length === 0) {
        // The exact failure mode this guards: a candidate list filtered to
        // nothing produces an empty table, which the server rejects — and the
        // rejection looks like a model problem rather than an empty page.
        issues.push({
          code: 'choice-criteria-empty',
          message: 'a choice question needs a non-empty option table — an empty candidate list is not a valid question',
          questionId: id,
        })
      } else if (keys.length > MAX_CHOICE_OPTIONS) {
        issues.push({
          code: 'choice-criteria-over-limit',
          message: `${keys.length} options exceeds the protocol limit of ${MAX_CHOICE_OPTIONS}`,
          questionId: id,
        })
      }
      continue
    }
    const levels = question.criteria
    if (levels.length < MIN_SCORE_LEVELS || levels.length > MAX_SCORE_LEVELS) {
      issues.push({
        code: 'score-criteria-out-of-range',
        message: `a score question needs ${MIN_SCORE_LEVELS}..${MAX_SCORE_LEVELS} levels (got ${levels.length})`,
        questionId: id,
      })
    }
  }
  return issues
}

/** Build the request body. Only the three allowed keys are ever emitted. */
export function buildSystemOneRequest(
  state: SystemOneRequest['state'],
  questions: QuestionSet,
  model: string,
): SystemOneRequest {
  return { model, state, questions }
}

// ── answer normalisation ────────────────────────────────────────────────────

export interface NormalizeResult {
  answers: AnswerSet
  /** Answer ids that were present but unusable, and ids the caller asked for that are missing. */
  dropped: string[]
  missing: string[]
}

/**
 * Coerce a server answer set into ours, and REPORT what it could not use.
 *
 * The rule this follows was learned in JevLoop's own parser and is worth
 * repeating: a malformed answer is MORE dangerous than a failed request. A
 * failure is caught by the fallback chain; a fabricated `0` is a definite
 * "no" that silently steers the loop. So a value-free answer is DROPPED and
 * named, never defaulted.
 */
export function normalizeAnswers(
  raw: unknown,
  expected: readonly string[],
): NormalizeResult {
  const answers: AnswerSet = {}
  const dropped: string[] = []
  if (raw === null || typeof raw !== 'object') {
    return { answers, dropped, missing: [...expected] }
  }

  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') {
      dropped.push(id)
      continue
    }
    const record = value as Record<string, unknown>
    // Judge the VALUE, not the tag: `{"type":"noul"}` with no number is the
    // malformed case that a tag-only check would pass through as 0.
    if (isFiniteNumber(record.noul)) {
      answers[id] = { type: 'noul', noul: clamp(record.noul, 0, 1) }
      continue
    }
    if (typeof record.choice === 'string' && record.choice !== '') {
      const probabilities = numberMap(record.probabilities)
      answers[id] = {
        type: 'choice',
        choice: record.choice,
        probabilities,
        confidence: isFiniteNumber(record.confidence) ? record.confidence : maxOf(probabilities),
      }
      continue
    }
    if (isFiniteNumber(record.score)) {
      const probabilities = numberMap(record.probabilities)
      answers[id] = {
        type: 'score',
        score: record.score,
        legend: stringMap(record.legend),
        probabilities,
        confidence: isFiniteNumber(record.confidence) ? record.confidence : maxOf(probabilities),
      }
      continue
    }
    dropped.push(id)
  }

  const missing = expected.filter((id) => !(id in answers))
  return { answers, dropped, missing }
}

// ── policy: probabilities → a decision ──────────────────────────────────────

/**
 * The probability of the option that was picked.
 *
 * This — not `confidence` — is the number a threshold may use. `confidence` is
 * a normalised entropy (`1 - H/log(k)`), so the same threshold means something
 * different at 2 options and at 20; a bare `top` threshold does not move when
 * the option table grows.
 */
export function topProbability(answer: Answer | undefined): number {
  if (answer === undefined) return 0
  if (answer.type === 'choice') return answer.probabilities[answer.choice] ?? 0
  if (answer.type === 'noul') return Math.max(answer.noul, 1 - answer.noul)
  return answer.confidence ?? 0
}

/** The runner-up's probability — what a margin threshold compares against. */
export function runnerUpProbability(answer: Answer | undefined): number {
  if (answer === undefined || answer.type !== 'choice') return 0
  const values = Object.values(answer.probabilities).sort((a, b) => b - a)
  return values[1] ?? 0
}

export interface Margin {
  ok: boolean
  top: number
  runnerUp: number
  margin: number
  code: '' | 'no-answer' | 'below-top' | 'below-margin'
}

/**
 * The choice gate: `top ≥ minTop` AND (`top - runnerUp ≥ minMargin`).
 *
 * Both halves are required. A top of 0.8 with a runner-up of 0.79 is a coin
 * flip wearing a confident number, and acting on it is how an agent clicks the
 * wrong button while every metric says it was sure.
 */
export function checkChoiceMargin(
  answer: Answer | undefined,
  minTop: number,
  minMargin: number,
): Margin {
  if (answer === undefined) return { ok: false, top: 0, runnerUp: 0, margin: 0, code: 'no-answer' }
  const top = topProbability(answer)
  const second = runnerUpProbability(answer)
  const margin = Math.max(0, top - second)
  if (top < minTop) return { ok: false, top, runnerUp: second, margin, code: 'below-top' }
  if (margin < minMargin) return { ok: false, top, runnerUp: second, margin, code: 'below-margin' }
  return { ok: true, top, runnerUp: second, margin, code: '' }
}

/**
 * Threshold buckets, bound to the CANDIDATE COUNT.
 *
 * The numbers are not taste: a fixed 5-option control question and a 20-option
 * in-chunk question do not produce comparable `top` distributions, so the
 * thresholds differ. `minMargin` is only meaningful for `choice`; for a fixed
 * control set it is 0 because there is nothing to confuse it with.
 */
export interface ThresholdBucket {
  maxCandidates: number
  minTop: number
  minMargin: number
}

export const THRESHOLD_BUCKETS: readonly ThresholdBucket[] = [
  { maxCandidates: 5, minTop: 0.6, minMargin: 0 },
  { maxCandidates: 8, minTop: 0.6, minMargin: 0.1 },
  { maxCandidates: 20, minTop: 0.5, minMargin: 0.15 },
]

/** The bucket for a candidate count. Above the last bucket, the strictest applies. */
export function bucketFor(candidateCount: number): ThresholdBucket {
  for (const bucket of THRESHOLD_BUCKETS) {
    if (candidateCount <= bucket.maxCandidates) return bucket
  }
  const last = THRESHOLD_BUCKETS[THRESHOLD_BUCKETS.length - 1]
  return last ?? { maxCandidates: 20, minTop: 0.5, minMargin: 0.15 }
}

// ── tools ───────────────────────────────────────────────────────────────────

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

function numberMap(value: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (value === null || typeof value !== 'object') return out
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const num = Number(raw)
    if (Number.isFinite(num)) out[key] = num
  }
  return out
}

function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (value === null || typeof value !== 'object') return out
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') out[key] = raw
  }
  return out
}

function maxOf(map: Record<string, number>): number {
  const values = Object.values(map)
  return values.length === 0 ? 0 : Math.max(...values)
}
