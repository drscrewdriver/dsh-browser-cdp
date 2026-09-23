/**
 * src/jev/pipe.ts — 阶段 10: the pipeline itself, and its two exits.
 *
 * This is the module that answers the request directly: take a frame (screenshot
 * + numbered DOM), take an intent, and produce JUDGEMENT TRAFFIC in the JEV wire
 * format — or the equivalent Laya workflow bundle.
 *
 * ── The shape of one round ─────────────────────────────────────────────────
 *
 * A round is deliberately NOT an agent loop (that is stage 7). It is:
 *
 *     frame + intent  →  questions  →  judge  →  an actionable reference (n)
 *
 * Two rounds exist here and no more, because the second only makes sense after
 * the first says so:
 *
 *   ROUND 1  control   — done / act / scroll / wait / blocked   (5 fixed options)
 *   ROUND 2  chapter   — WHICH PART of the page                 (a few options)
 *   ROUND 3  pick      — which numbered candidate in it, and how risky it is
 *
 * Asking "which of these 20 elements" before knowing whether we should act at
 * all is how a loop acts on a page it was supposed to leave alone. That is why
 * each round is gated on the previous answer rather than folded into one big
 * question.
 *
 * The CHAPTER round is the "narrow the search" step. It is skipped — not
 * answered trivially — when the frame has only one chapter, because a question
 * with a single option is a round trip that can only go one way.
 *
 * ── The two exits are ONE encoder ──────────────────────────────────────────
 *
 * §5 of the design says the JEV wire format and the Laya workflow bundle share
 * the frame and the injector rather than being two codecs. That is enforced
 * structurally here: `buildRound` produces both from one `QuestionSet` and one
 * `state` string, so the archive copy and the transmitted copy cannot drift.
 *
 * ── What this module refuses to do ─────────────────────────────────────────
 *
 * It does not decide the safety of an action. It reports the danger score and
 * the threshold verdict; the caller owns the policy. A pipeline that decided its
 * own risk appetite would be one nobody could audit.
 */

import type { Chapter, Frame } from './frame.ts'
import { chaptersOf, chunkIndexOf, planChunks, sliceFrame, type ChunkPlan } from './frame.ts'
import type { JudgeChainResult, JudgeRequest, JudgeResponse, JudgeProvider } from './judge.ts'
import {
  CHAPTER_CHOICE_ID,
  CONTROL_CHOICE_ID,
  buildIntentState,
  canScroll,
  chapterQuestions,
  controlQuestions,
  pickQuestions,
  type HistoryStep,
  type IntentSpec,
  type ProgressReport,
} from './prompt.ts'
import {
  type AnswerSet,
  type Question,
  type QuestionSet,
  type SystemOneRequest,
  bucketFor,
  buildSystemOneRequest,
  checkChoiceMargin,
  validateQuestions,
} from './wire.ts'
import type { FrameNode } from './frame.ts'

export interface PipeConfig {
  /** The model field of the wire request. */
  model: string
  /** Candidate ceiling for a single round. Matches the chunk ceiling. */
  chunkSize: number
  /** Frame byte budget. 0 = unbounded (the default: measured pages fit). */
  maxImageBytes: number
  /** History depth delivered to the judge. */
  historyLimit: number
  /** How many bytes of base64 image the ARCHIVE copy keeps. 0 = keep all. */
  archiveImageBudget: number
}

export const DEFAULT_PIPE_CONFIG: PipeConfig = {
  model: 'laya',
  chunkSize: 20,
  // Measured (A.9): a real full-page JPEG was 136.9 KiB. The default is
  // therefore "unbounded" and chunking is driven by the candidate count
  // instead — a byte budget nobody needed would slice static pages for nothing.
  maxImageBytes: 0,
  historyLimit: 5,
  archiveImageBudget: 0,
}

/**
 * The JEV exit: exactly what `POST /v1/systemone` takes.
 *
 * `SystemOneRequest` carries only `{model, state, questions}` — proven by the
 * wire tests, because `extra="forbid"` makes any additional field a 422.
 */
export interface JevExit {
  kind: 'jev-wire'
  endpoint: string
  body: SystemOneRequest
}

/**
 * The Laya exit: the WHOLE round as one archive-able object.
 *
 * No base64 image by default. The reason is practical: the bundle is meant to
 * be replayed and moved between machines, and a bundle that always carries a
 * few hundred KiB of image is a bundle nobody keeps.
 */
export interface LayaExit {
  kind: 'laya-frame'
  frameId: string
  intent: IntentSpec
  round: RoundKind
  frame: {
    target: Frame['target']
    viewport: Frame['viewport']
    image: { format: string; bytes: number; quality: number | null; overBudget: boolean } | null
    nodes: FrameNode[]
    truncated: boolean
    total: number
  }
  chunk: { index: number; total: number; itemCount: number; containerHint: string } | null
  questions: QuestionSet
  /** Present only when the caller asked to embed the image. */
  imageBase64?: string
}

/**
 * One assembled round: the state text, the questions, and both exits.
 *
 * `issues` is carried rather than thrown: a question set the server would
 * reject is a MODELLING problem (an empty candidate list usually means the page
 * has no candidates), and the caller may legitimately want to record it.
 */
/** The three rounds, in the order they are asked. */
export type RoundKind = 'control' | 'chapter' | 'pick'

export interface PipeRound {
  round: RoundKind
  frameId: string
  /** The assembled `# INTENT` / `# FRAME` / `# HISTORY` text. */
  state: string
  questions: QuestionSet
  /** Non-empty when this round must not be sent as-is. */
  issues: { code: string; message: string; questionId: string }[]
  plan: ChunkPlan
  chunkIndex: number
  jev: JevExit
  laya: LayaExit
}

export interface BuildRoundInput {
  frame: Frame
  intent: IntentSpec
  round: RoundKind
  history?: readonly HistoryStep[]
  excluded?: readonly number[]
  /** Which chunk to judge. Ignored for a `control` round, which is page-level. */
  chunkIndex?: number
  /**
   * The chapter to restrict a `pick` round to. Omitted = offer every candidate
   * in the chunk, which is what a page with a single chapter gets.
   */
  chapterKey?: string
  /** Mechanical progress from the loop, rendered into `# PROGRESS`. */
  progress?: ProgressReport
  endpoint?: string
  config?: Partial<PipeConfig>
}

/**
 * Assemble one round from a frame and an intent.
 *
 * Pure: no network, no clock. The judge is a separate call, which is what makes
 * the encoder testable against a fixture and the archived bundle reproducible.
 */
export function buildRound(input: BuildRoundInput): PipeRound {
  const config = { ...DEFAULT_PIPE_CONFIG, ...input.config }
  const plan = planChunks({
    candidateCount: input.frame.dom.nodes.length,
    imageBytes: input.frame.image?.bytes ?? null,
    maxBytes: config.maxImageBytes,
    chunkSize: config.chunkSize,
  })

  const chunkIndex = input.round === 'control' ? 1 : Math.max(1, input.chunkIndex ?? 1)
  const chunk = plan.chunkTotal > 1 || input.round !== 'control' ? sliceFrame(input.frame, plan, chunkIndex) : null
  if (input.round !== 'control' && chunk === null) {
    // A pick round for a chunk that does not exist is a caller bug, not a page
    // state. Saying so beats assembling a question about an empty list.
    throw new Error(
      `pick round asked for chunk ${chunkIndex} but the plan has ${plan.chunkTotal} chunk(s)`,
    )
  }

  const excluded = new Set(input.excluded ?? [])
  // The candidates this round may OFFER. A chapter round offers none (it asks
  // about sections); a pick round offers the chunk, minus anything ruled out,
  // and minus anything outside the chosen chapter.
  const inChunk = chunk?.nodes ?? input.frame.dom.nodes
  const offered =
    input.round === 'control'
      ? []
      : input.round === 'chapter'
        ? []
        : inChunk.filter((node) => !excluded.has(node.n) && (input.chapterKey === undefined || node.container === input.chapterKey))

  const chapters = chaptersOf(input.round === 'chapter' ? inChunk.filter((node) => !excluded.has(node.n)) : offered)
  const chosenChapter =
    input.round === 'pick' && input.chapterKey !== undefined
      ? chapters.find((entry) => entry.key === input.chapterKey) ?? null
      : null
  // Counted against the WHOLE chunk rather than derived by subtraction: the
  // offered list has already had exclusions and the chapter filter applied, so
  // subtracting it would silently fold the excluded count into "elsewhere" and
  // tell the judge about candidates it never had a chance to see.
  const elsewhere =
    chosenChapter === null ? 0 : inChunk.filter((node) => node.container !== chosenChapter.key).length

  const state = buildIntentState({
    intent: input.intent,
    frame: input.frame,
    chunk,
    history: input.history ?? [],
    excluded: input.excluded ?? [],
    historyLimit: config.historyLimit,
    ...(input.progress === undefined ? {} : { progress: input.progress }),
    // ONE set, two views: the same `offered` array the question table is built
    // from. Without this the FRAME prose listed candidates the table could not
    // accept — the judge then answers with one of them and the round is wasted.
    nodes: input.round === 'control' ? input.frame.dom.nodes : offered,
    chapter:
      chosenChapter === null
        ? null
        : { key: chosenChapter.key, label: chosenChapter.label, total: elsewhere },
  })

  // A candidate that was already ruled out must not be OFFERED again.
  //
  // The `excluded` line in HISTORY says "do not propose these", but a judge
  // given the option anyway will sometimes take it — and then the loop spends a
  // judge call to be told something it already knew. Removing them from the
  // table is what makes the exclusion structural rather than advisory.
  //
  // The frame numbers are NOT renumbered (21..26 stay 21..26), so a number still
  // means one element for both sides of the seam.
  const questions =
    input.round === 'control'
      ? controlQuestions(canScroll(input.frame))
      : input.round === 'chapter'
        ? chapterQuestions(chapters)
        : pickQuestions(offered)

  const issues = validateQuestions(questions)
  const body = buildSystemOneRequest(state, questions, config.model)

  return {
    round: input.round,
    frameId: input.frame.frameId,
    state,
    questions,
    issues,
    plan,
    chunkIndex,
    jev: { kind: 'jev-wire', endpoint: input.endpoint ?? '', body },
    laya: {
      kind: 'laya-frame',
      frameId: input.frame.frameId,
      intent: input.intent,
      round: input.round,
      frame: {
        target: input.frame.target,
        viewport: input.frame.viewport,
        image:
          input.frame.image === null
            ? null
            : {
                format: input.frame.image.format,
                bytes: input.frame.image.bytes,
                quality: input.frame.image.quality,
                overBudget: input.frame.image.overBudget,
              },
        // What the judge was actually shown, so an archived bundle and a live
        // prompt can never disagree about it. For a pick round this is the
        // OFFERED set (exclusions removed), not the raw chunk.
        nodes: input.round === 'control' ? (chunk?.nodes ?? input.frame.dom.nodes) : offered,
        truncated: input.frame.dom.truncated,
        total: input.frame.dom.total,
      },
      chunk:
        chunk === null
          ? null
          : {
              index: chunk.chunkIndex,
              total: chunk.chunkTotal,
              // `itemCount` is the number of OPTIONS, not the size of the slice:
              // a chunk of 20 with 3 ruled out offers 17, and a caller reading
              // the bundle needs the number it can actually choose from.
              itemCount: offered.length === 0 ? chunk.itemCount : offered.length,
              containerHint: chunk.containerHint,
            },
      questions,
      ...(config.archiveImageBudget !== 0 && input.frame.image !== null && input.frame.image.dataBase64 !== ''
        ? { imageBase64: input.frame.image.dataBase64 }
        : {}),
    },
  }
}

/** Turn a round into the `JudgeRequest` the seam takes. */
export const toJudgeRequest = (round: PipeRound): JudgeRequest => ({
  questions: round.questions,
  state: round.state,
})

// ── reading a judgement back ───────────────────────────────────────────────

export type RoundIntent =
  | { kind: 'done'; top: number }
  | { kind: 'act'; top: number }
  | { kind: 'scroll'; top: number }
  | { kind: 'wait'; top: number }
  | { kind: 'blocked'; top: number }
  /** The judge answered, but not confidently enough to act on. */
  | { kind: 'unclear'; code: string; top: number; margin: number }
  /** The judge said nothing usable. Distinct from `unclear` — see below. */
  | { kind: 'no-answer'; missing: string[] }
  /** No provider could answer at all. */
  | { kind: 'unavailable'; trace: string[] }

/**
 * Read round 1's control answer into a decision.
 *
 * The distinction that matters most here is `no-answer` vs `unavailable`:
 * "the model was asked and gave nothing" and "no model was reachable" look
 * identical if both collapse to "no action", and they call for opposite
 * responses — one is a prompt problem, the other is a configuration problem.
 *
 * `unclear` (a low-confidence answer) is likewise its own outcome: it means the
 * judge DID answer, just not decisively, so a caller can retry with a tighter
 * question rather than treating the element as ruled out.
 */
export function readControl(result: JudgeResponse): RoundIntent {
  if (result.provider === 'refuse') return { kind: 'unavailable', trace: result.trace }

  const answer = result.answers[CONTROL_CHOICE_ID]
  if (answer === undefined) return { kind: 'no-answer', missing: result.missing }

  const optionCount = CONTROL_OPTION_COUNT
  const bucket = bucketFor(optionCount)
  const margin = checkChoiceMargin(answer, bucket.minTop, bucket.minMargin)
  if (!margin.ok) return { kind: 'unclear', code: margin.code, top: margin.top, margin: margin.margin }

  if (answer.type !== 'choice') return { kind: 'no-answer', missing: [CONTROL_CHOICE_ID] }
  switch (answer.choice) {
    case 'done':
      return { kind: 'done', top: margin.top }
    case 'act':
      return { kind: 'act', top: margin.top }
    case 'scroll':
      return { kind: 'scroll', top: margin.top }
    case 'wait':
      return { kind: 'wait', top: margin.top }
    case 'blocked':
      return { kind: 'blocked', top: margin.top }
    default:
      // A choice the table did not offer. Returned verbatim by the server only
      // if the table and the answer disagree, which is a bug worth surfacing.
      return { kind: 'unclear', code: `unknown-option:${answer.choice}`, top: margin.top, margin: margin.margin }
  }
}

/** The control table's size, used to pick the threshold bucket. */
export const CONTROL_OPTION_COUNT = 5

export type ChapterOutcome =
  /** The judge chose a section. `nodes` are its candidates, already filtered. */
  | { kind: 'chapter'; key: string; label: string; nodes: FrameNode[]; top: number; margin: number }
  /** The answer named a section that is not in the table it was given. */
  | { kind: 'unknown-chapter'; key: string; top: number; margin: number }
  | { kind: 'unclear'; code: string; top: number; margin: number }
  | { kind: 'no-answer'; missing: string[] }
  | { kind: 'unavailable'; trace: string[] }

/**
 * Read the chapter answer.
 *
 * An unknown section key is its own outcome rather than a fallback to "look
 * everywhere": falling back would silently undo the narrowing while the trace
 * claimed it happened, which is worse than admitting the answer was unusable.
 */
export function readChapter(result: JudgeResponse, chapters: readonly Chapter[]): ChapterOutcome {
  if (result.provider === 'refuse') return { kind: 'unavailable', trace: result.trace }

  const answer = result.answers[CHAPTER_CHOICE_ID]
  if (answer === undefined || answer.type !== 'choice') return { kind: 'no-answer', missing: result.missing }

  const bucket = bucketFor(chapters.length)
  const margin = checkChoiceMargin(answer, bucket.minTop, bucket.minMargin)
  if (!margin.ok) return { kind: 'unclear', code: margin.code, top: margin.top, margin: margin.margin }

  const chosen = chapters.find((chapter) => chapter.key === answer.choice)
  if (chosen === undefined) return { kind: 'unknown-chapter', key: answer.choice, top: margin.top, margin: margin.margin }
  return { kind: 'chapter', key: chosen.key, label: chosen.label, nodes: chosen.nodes, top: margin.top, margin: margin.margin }
}

export type PickOutcome =
  | { kind: 'pick'; n: number; top: number; margin: number; danger: number | null; node: FrameNode }
  | { kind: 'unclear'; code: string; top: number; margin: number }
  | { kind: 'no-answer'; missing: string[] }
  | { kind: 'unavailable'; trace: string[] }
  | { kind: 'out-of-frame'; n: number }

/**
 * Read round 2's answer into an actionable reference.
 *
 * The `out-of-frame` case is worth its own outcome: a judge that returns `n`
 * beyond the candidate list is exactly the failure the numbering scheme exists
 * to make visible, and reporting it as `out-of-frame` is what keeps it from
 * being clamped into a click on the last element.
 */
export function readPick(result: JudgeResponse, candidates: readonly FrameNode[]): PickOutcome {
  if (result.provider === 'refuse') return { kind: 'unavailable', trace: result.trace }

  const answer = result.answers.candidate
  if (answer === undefined || answer.type !== 'choice') return { kind: 'no-answer', missing: result.missing }

  const bucket = bucketFor(candidates.length)
  const margin = checkChoiceMargin(answer, bucket.minTop, bucket.minMargin)
  if (!margin.ok) return { kind: 'unclear', code: margin.code, top: margin.top, margin: margin.margin }

  const n = Number.parseInt(answer.choice, 10)
  if (!Number.isFinite(n)) {
    return { kind: 'unclear', code: `non-numeric:${answer.choice}`, top: margin.top, margin: margin.margin }
  }
  const node = candidates.find((candidate) => candidate.n === n)
  if (node === undefined) return { kind: 'out-of-frame', n }

  const dangerAnswer = result.answers.danger
  const danger = dangerAnswer !== undefined && dangerAnswer.type === 'score' ? dangerAnswer.score : null
  return { kind: 'pick', n, top: margin.top, margin: margin.margin, danger, node }
}

// ── the two exits as serialisable documents ────────────────────────────────

/**
 * The JEV exit as a ready-to-send document.
 *
 * `questions` is returned as-is rather than re-encoded, so the body a test
 * asserts on is byte-identical to the body the wire layer would send.
 */
export function serializeJev(round: PipeRound): string {
  return JSON.stringify(round.jev.body)
}

/** The Laya exit as JSON. Stable key order comes from the object literal. */
export function serializeLaya(round: PipeRound): string {
  return JSON.stringify(round.laya, null, 2)
}

export interface PipelineDeps {
  provider: JudgeProvider
  /** Needed only when a pick round must be assembled after a control round. */
  buildPick?: (chunkIndex: number) => PipeRound
}

export interface RoundTrace {
  round: 'control' | 'pick'
  provider: string
  model: string
  latencyMs: number
  degraded: boolean
  chain: string[]
  trace: string[]
  /** Which question forced the chunk decision — for after-the-fact explanation. */
  chunkReason: string
  chunkTotal: number
}

export interface ControlStep {
  round: PipeRound
  judgement: JudgeResponse
  intent: RoundIntent
  trace: RoundTrace
}

/**
 * Run round 1: ask the control question and read the answer.
 *
 * Does NOT act. It returns the decision, because the caller owns the policy on
 * whether a `blocked` or a low-confidence `act` should proceed — and because
 * keeping the judgement separate from the action is what makes the trace
 * auditable.
 */
export async function runControlRound(
  round: PipeRound,
  provider: JudgeProvider,
  deps: { now: () => number; fetch: typeof fetch },
): Promise<ControlStep> {
  const started = deps.now()
  const judgement = await provider.decide(toJudgeRequest(round), deps)
  return {
    round,
    judgement,
    intent: readControl(judgement),
    trace: {
      round: 'control',
      provider: judgement.provider,
      model: judgement.model,
      latencyMs: deps.now() - started,
      degraded: judgement.degraded,
      chain: chainOf(judgement),
      trace: judgement.trace,
      chunkReason: round.plan.reason,
      chunkTotal: round.plan.chunkTotal,
    },
  }
}

/** The chunk a candidate number belongs to, for a caller walking the plan. */
export const chunkForCandidate = (n: number, chunkSize: number, total: number): number =>
  chunkIndexOf(total, chunkSize, n - 1)

/**
 * The hop list of a judgement, when it has one.
 *
 * A bare `JudgeProvider` answers a `JudgeResponse` with no `chain`; only
 * `JudgeChain` records the hops. The trace field is therefore optional in
 * substance even though it is required in `JudgeChainResult`, and a caller
 * reading a bare provider's answer must not see `undefined` where it expects a
 * list — an absent chain means "one provider was asked", which is one hop, not
 * zero.
 */
function chainOf(result: JudgeResponse): string[] {
  const chain = (result as Partial<JudgeChainResult>).chain
  return Array.isArray(chain) ? chain : [`${result.provider}:answered`]
}

/**
 * Collect the warnings a round produced that a caller must not drop.
 *
 * Only two things here are actionable, and both would be silent defects if the
 * caller ignored them:
 *
 *  - `frame.dom.truncated` — the judge saw fewer candidates than exist, so a
 *    "no suitable element" answer is not evidence that none exists.
 *  - `image.overBudget` — the caller set a byte budget and did not get it.
 */
export function roundWarnings(round: PipeRound): string[] {
  const warnings: string[] = []
  // Read from the Laya exit rather than from the frame: that is the copy the
  // caller archives, and a warning that disagrees with the archived copy is
  // worse than no warning. "What did the judge actually see" needs one answer.
  if (round.laya.frame.truncated) {
    warnings.push('frame-truncated: the judge saw fewer candidates than the page has')
  }
  const image = round.laya.frame.image
  if (image !== null && image.overBudget) {
    warnings.push(`image-over-budget: ${image.bytes} bytes exceeded the configured budget`)
  }
  for (const issue of round.issues) warnings.push(`invalid-question: ${issue.code} (${issue.questionId})`)
  return warnings
}
