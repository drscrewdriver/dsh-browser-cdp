/**
 * src/jev/attempt.ts — 阶段 10 追加：平的「尝试」循环（`bcdp_jev_attempt`）。
 *
 * The user's contract for this tool, verbatim:
 *
 *   「llm 给意图，选项根据 dom 生成，laya/jev 有 5 次行动的预算，
 *     决策模型花完预算或者自己选择结束则给回执」
 *
 * This is deliberately NOT the three-level narrowing loop (`loop.ts`). The
 * differences, and why they are not regressions:
 *
 *   - ONE decision per round: the option table IS the frame's DOM candidates
 *     plus one fixed `end` option. No control question ("should we act at
 *     all"), no chapter question — the outer LLM already decided to attempt,
 *     and the budget is the safety net instead of the control gate.
 *   - `end` is a FIRST-CLASS option the decision model can pick at any round.
 *     It is accepted WITHOUT a confidence gate: a false `end` just returns to
 *     the caller, who verifies through CDP anyway; gating it would make the
 *     model unable to stop honestly.
 *   - A candidate pick BELOW its bucket threshold is not acted on: stopping
 *     with `unclear` beats clicking on a coin flip.
 *   - The judge context is DOM-tree text only. Laya is a text classifier and
 *     cannot read the screenshot, so the image is captured and archived but
 *     never pretends to inform the decision — the state carries the SAME
 *     candidate list the option table offers (列表==表, the invariant the
 *     narrowing loop learned the hard way).
 *   - No exclusion set: every round re-captures and renumbers, so the judge
 *     always answers about the page as it is NOW.
 *
 * Every terminal state returns a receipt; nothing throws past the capture.
 */

import type { Frame, FrameNode } from './frame.ts'
import { anchorFor } from './anchors.ts'
import type { JudgeChainResult, JudgeRequest } from './judge.ts'
import type { IntentSpec } from './prompt.ts'
import { assertJudgeIsolation } from './prompt.ts'
import type { LoopEffects } from './loop.ts'
import { bucketFor, checkChoiceMargin, choice } from './wire.ts'

/** Fixed question id; the judge's answer key for every round. */
export const ATTEMPT_QUESTION_ID = 'pick'
/** The option key that means "I choose to stop". */
export const ATTEMPT_END_KEY = 'end'

export interface AttemptStep {
  /** 1-based action ordinal. */
  index: number
  /** The frame number acted on. */
  n: number
  ok: boolean
  /** What was done, in receipt prose (`click button "OK" [main]`). */
  label: string
  /** Snapshot-stable anchor of the node touched, on success only. */
  anchor?: string
  provider: string
  degraded: boolean
  /** The judge's `top` for this round's pick. */
  top: number
}

export type AttemptStatus =
  | 'ended'      // the model chose `end` by itself
  | 'exhausted'  // the action budget was spent
  | 'blocked'    // the page offered no candidates at all
  | 'unclear'    // a pick failed its confidence gate — refuse to act on a guess
  | 'unavailable' // no usable judge answer
  | 'error'      // capture threw

export interface AttemptResult {
  status: AttemptStatus
  reason: string
  actions: AttemptStep[]
  /** Candidates offered in the LAST round (0 when none). */
  candidates: number
  /** Identity of the last frame, for the caller's own CDP verification. */
  lastFrameId: string
  lastUrl: string
}

export interface AttemptInput {
  intent: IntentSpec
  effects: LoopEffects
  /** Action budget — how many element actions the model may spend. */
  maxActions?: number
}

/** One candidate, as BOTH a FRAME list line and an option-table value. */
function candidateLine(node: FrameNode): string {
  return `${node.role} "${node.name}" [${node.containerLabel}]`
}

function endOptionText(): string {
  return 'the goal is already achieved, or nothing on this page can advance it — stop and report back'
}

export function buildAttemptState(frame: Frame, intent: IntentSpec, actions: readonly AttemptStep[], maxActions: number): string {
  const nodes = frame.dom.nodes
  const lines: string[] = []
  lines.push('# INTENT')
  lines.push(`goal: ${intent.goal}`)
  for (const criterion of intent.successCriteria) lines.push(`success criterion: ${criterion}`)
  lines.push(`actions left: ${Math.max(0, maxActions - actions.length)}`)
  lines.push('')
  lines.push('# FRAME')
  lines.push(`url: ${frame.target.url}`)
  if (frame.dom.truncated) {
    lines.push(`(candidate list truncated: showing ${nodes.length} of ${frame.dom.total})`)
  }
  for (const node of nodes) lines.push(`${node.n}. ${candidateLine(node)}`)
  if (actions.length > 0) {
    lines.push('')
    lines.push('# HISTORY')
    for (const step of actions) {
      lines.push(`${step.ok ? 'ok' : 'FAILED'}: ${step.label}`)
    }
  }
  const state = lines.join('\n')
  // Same guard the narrowing loop uses: if a heading ever leaks in that is not
  // one of the whitelisted sections, this throws BEFORE anything is sent.
  assertJudgeIsolation(state)
  return state
}

export function attemptQuestion(nodes: readonly FrameNode[]) {  const criteria: Record<string, string> = { [ATTEMPT_END_KEY]: endOptionText() }
  for (const node of nodes) criteria[String(node.n)] = candidateLine(node)
  return choice(
    'Pick the NUMBER of the element your next click should act on to advance the goal, ' +
      `or pick "${ATTEMPT_END_KEY}" when it applies.`,
    criteria,
  )
}

export async function runAttempt(input: AttemptInput): Promise<AttemptResult> {
  const maxActions = input.maxActions ?? 5
  const actions: AttemptStep[] = []
  let lastFrameId = ''
  let lastUrl = ''
  let candidates = 0

  for (;;) {
    let frame: Frame
    try {
      const captured = await input.effects.capture()
      frame = captured.frame
    } catch (error) {
      return {
        status: 'error',
        reason: `capture failed: ${error instanceof Error ? error.message : String(error)}`,
        actions,
        candidates,
        lastFrameId,
        lastUrl,
      }
    }
    lastFrameId = frame.frameId
    lastUrl = frame.target.url
    candidates = frame.dom.nodes.length

    if (candidates === 0) {
      return {
        status: 'blocked',
        reason: 'the DOM tree offered no interactive candidates — nothing to choose from',
        actions,
        candidates,
        lastFrameId,
        lastUrl,
      }
    }

    const request: JudgeRequest = {
      questions: { [ATTEMPT_QUESTION_ID]: attemptQuestion(frame.dom.nodes) },
      state: buildAttemptState(frame, input.intent, actions, maxActions),
    }
    let result: JudgeChainResult
    try {
      result = await input.effects.judge(request)
    } catch (error) {
      return {
        status: 'unavailable',
        reason: `the judge chain threw: ${error instanceof Error ? error.message : String(error)}`,
        actions,
        candidates,
        lastFrameId,
        lastUrl,
      }
    }
    const answer = result.answers[ATTEMPT_QUESTION_ID]
    if (answer === undefined || answer.type !== 'choice' || typeof answer.choice !== 'string' || answer.choice === '') {
      return {
        status: 'unavailable',
        reason: `no usable pick answer from ${result.provider} (chain: ${result.chain.join(' → ')})`,
        actions,
        candidates,
        lastFrameId,
        lastUrl,
      }
    }

    // `end` is the model's own decision to stop. Accepted without a confidence
    // gate — see the module header.
    if (answer.choice === ATTEMPT_END_KEY) {
      return {
        status: 'ended',
        reason: 'the decision model chose to end by itself',
        actions,
        candidates,
        lastFrameId,
        lastUrl,
      }
    }

    const n = Number.parseInt(answer.choice, 10)
    const node = frame.dom.nodes.find((candidate) => candidate.n === n)
    if (node === undefined) {
      return {
        status: 'unclear',
        reason: `the judge named "${answer.choice}", which is not an offered option`,
        actions,
        candidates,
        lastFrameId,
        lastUrl,
      }
    }

    // A candidate pick must clear its bucket. The table has candidates + `end`,
    // so the bucket size is N+1, not N.
    const bucket = bucketFor(candidates + 1)
    const margin = checkChoiceMargin(answer, bucket.minTop, bucket.minMargin)
    if (!margin.ok) {
      return {
        status: 'unclear',
        reason: `the pick for ${node.role} "${node.name}" did not clear its bucket (top=${margin.top.toFixed(2)}, runner-up=${margin.runnerUp.toFixed(2)}, margin=${margin.margin.toFixed(2)}, needs top≥${bucket.minTop}${bucket.minMargin > 0 ? ` margin≥${bucket.minMargin}` : ''})`,
        actions,
        candidates,
        lastFrameId,
        lastUrl,
      }
    }

    const outcome = await input.effects.act({ frame, n, action: 'click' })
    const label = `click ${node.role} "${node.name}" [${node.containerLabel}]`
    actions.push({
      index: actions.length + 1,
      n,
      ok: outcome.ok,
      label: outcome.ok ? label : `${label} — failed: ${outcome.message}`,
      provider: result.provider,
      degraded: result.degraded,
      top: margin.top,
      ...(outcome.ok ? { anchor: anchorFor(frame.frameId, outcome.backendNodeId) } : {}),
    })

    if (actions.length >= maxActions) {
      return {
        status: 'exhausted',
        reason: `the action budget (${maxActions}) was spent`,
        actions,
        candidates,
        lastFrameId,
        lastUrl,
      }
    }
  }
}
