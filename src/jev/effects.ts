/**
 * src/jev/effects.ts — 阶段 10: bind the loop's injected effects to real things.
 *
 * `loop.ts` deliberately knows nothing about browsers, sockets or time; this is
 * the only file that knows about all three. Its job is the unglamorous one: turn
 * a worker reply into a `Frame`, turn a candidate number into a worker `act`
 * call, and turn a judge claim of `done` into a question that can actually be
 * checked.
 *
 * ── The frame comes from the worker, and the worker is told the budget ─────
 *
 * The worker is the only thing that can see the page. So the byte budget travels
 * WITH the capture request rather than being applied afterwards: shrinking an
 * already-taken screenshot plugin-side would mean the worker did the expensive
 * work (a full-page JPEG at quality 72) and then threw it away.
 *
 * ── Verification is a second question, not a re-read of the first answer ───
 *
 * `verify` asks a `noul` — "is the intent satisfied by this frame alone" — and
 * it is asked against the CURRENT frame rather than trusting the control round's
 * `done`. Those are two different questions: the control round asks "should we
 * act", verification asks "did it work". A loop that skipped the second one
 * would report success on the strength of a single model claim, which is the
 * failure mode nobody notices until much later.
 */

import { createHash } from 'node:crypto'
import type { SubprocessService } from '../types.ts'
import type { Frame, FrameNodeInput } from './frame.ts'
import { buildFrame, frameIdFor } from './frame.ts'
import type { ActCode, ActOutcome } from './act.ts'
import type { CaptureResult, ActRequest, LoopEffects, VerifyResult } from './loop.ts'
import type { IntentSpec } from './prompt.ts'
import { doneQuestion } from './prompt.ts'
import type { JudgeRuntime } from './client.ts'
import { sendJudge } from './client.ts'
import { runRenderCall } from './render.ts'

/** The worker's `capture` reply, in the fields this module reads. */
interface CaptureReply {
  data: string
  bytes: number
  quality: number | null
  overBudget: boolean
  attempts: number
  marks: { n: number; backendNodeId: number; role: string; name: string; container?: string; containerLabel?: string }[]
  viewport: { width: number; height: number; scrollX: number; scrollY: number; devicePixelRatio: number }
  targetId: string
  targetUrl: string
}

/** The worker's `act` reply. */
interface ActReply {
  ok: boolean
  code: string
  message?: string
  action?: string
  backendNodeId?: number
  point?: { x: number; y: number }
  measured?: { x: number; y: number; width: number; height: number } | null
  drift?: number
}

export interface EffectsDeps {
  subprocess: SubprocessService
  /** Absolute path to `bin/cdp-render-worker.mjs`. */
  workerPath: string
  /** Browser-level CDP endpoint (`ws://…/devtools/browser/<id>`), or '' if unknown. */
  wsUrl: string
  /** Which page to serve; '' lets the worker prefer an http(s) page. */
  targetId?: string
  judge: JudgeRuntime
  /** Frame byte budget. 0 = unbounded. */
  maxImageBytes: number
  /** Candidate ceiling. Must match the pipe's chunk size or `n` drifts. */
  candidateLimit: number
  now: () => number
  sleep: (ms: number) => Promise<void>
  /** Called with each frame, for a tool that wants to report what was seen. */
  onFrame?: (frame: Frame) => void
}

export interface JudgeEffects extends LoopEffects {
  /** Frames captured so far, for the caller's report. */
  frames(): Frame[]
  /** Set when the worker could not be reached at all; every effect then fails. */
  lastError(): string
}

/**
 * Build the effects the loop runs on.
 *
 * A `sequence` counter feeds `frameIdFor`, so two captures of an unchanged
 * document get DIFFERENT frame ids. That is the point: `seq` is what makes a
 * frame id identify a capture rather than merely a page state, and a log where
 * two different screenshots share an id cannot be replayed.
 */
export function makeJudgeEffects(deps: EffectsDeps): JudgeEffects {
  const frames: Frame[] = []
  let sequence = 0
  // The numbering the judge is answering about. Rebuilt on every capture
  // because the worker renumbers from 1 each time, and a stale map here would
  // resolve a judge's `n` to the WRONG backendNodeId — silently, and only on a
  // page that changed.
  let numbering = new Map<number, number>()
  let error = ''

  const captureWithWorker = async (): Promise<CaptureResult> => {
    const call = await runRenderCall(deps.subprocess, {
      workerPath: deps.workerPath,
      wsUrl: deps.wsUrl,
      ...(deps.targetId === undefined || deps.targetId === '' ? {} : { targetId: deps.targetId }),
      steps: [
        {
          method: 'capture',
          params: {
            format: 'jpeg',
            quality: 72,
            maxBytes: deps.maxImageBytes,
            limit: deps.candidateLimit,
            marks: true,
          },
        },
      ],
    })
    if (call.connected === null) {
      error = call.steps[0]?.error ?? 'the render worker could not attach to the page'
      throw new Error(error)
    }
    const step = call.steps[0]
    if (step === undefined || !step.ok) {
      error = step?.error ?? 'the render worker returned no capture'
      throw new Error(error)
    }
    const reply = step.result as CaptureReply

    sequence += 1
    const target = {
      endpoint: deps.wsUrl,
      targetId: reply.targetId,
      url: reply.targetUrl,
      title: '',
    }
    // A document revision derived from the FRAME CONTENT rather than read from
    // the page: the plugin has no live CDP channel, and hashing what the worker
    // actually saw is both available and a stronger statement — identical bytes
    // mean nothing visible changed.
    const revision = revisionOf(reply)
    const nodes: FrameNodeInput[] = reply.marks.map((mark) => ({
      backendNodeId: mark.backendNodeId,
      role: mark.role,
      name: mark.name,
      // The worker derives the chapter from the AX hierarchy. Passed through
      // verbatim, defaulting to the whole-page chapter when a worker build is
      // older than this field — a missing chapter must degrade to "the page",
      // never to an empty string that would become a nameless choice key.
      container: mark.container ?? 'page',
      containerLabel: mark.containerLabel ?? 'the page itself',
      // No rect: the AX tree does not carry one, and inventing a zero rect would
      // be a fidelity claim this path cannot honour. The executor re-measures
      // before acting regardless, which is why the design makes rect a hint.
      rect: null,
    }))
    const { frame } = buildFrame({
      target,
      viewport: reply.viewport,
      image: {
        format: 'jpeg',
        bytes: reply.bytes,
        dataBase64: reply.data,
        quality: reply.quality,
        overBudget: reply.overBudget,
        maxBytes: deps.maxImageBytes,
      },
      nodes,
      documentRevision: revision,
      seq: sequence,
      limit: deps.candidateLimit,
      now: deps.now,
    })
    numbering = new Map(frame.dom.nodes.map((node) => [node.n, node.backendNodeId]))
    frames.push(frame)
    deps.onFrame?.(frame)
    return { frame, documentRevision: revision }
  }

  return {
    frames: () => frames,
    lastError: () => error,

    async capture(): Promise<CaptureResult> {
      return captureWithWorker()
    },

    async judge(request) {
      return sendJudge(deps.judge, request)
    },

    async act(request: ActRequest): Promise<ActOutcome> {
      const backendNodeId = request.action === 'scroll' ? 0 : numbering.get(request.n)
      if (request.action !== 'scroll' && backendNodeId === undefined) {
        // The number is not in the map, which means it was not in the frame the
        // judge saw. Refusing here is what keeps a stale number from becoming a
        // click on whatever happens to be at that index now.
        return { ok: false, code: 'candidate-not-found', message: `candidate ${request.n} is not in the current frame`, n: request.n }
      }
      const call = await runRenderCall(deps.subprocess, {
        workerPath: deps.workerPath,
        wsUrl: deps.wsUrl,
        steps: [
          {
            method: 'act',
            params: {
              action: request.action === 'scroll' ? 'scroll' : request.action === 'fill' ? 'fill' : 'click',
              backendNodeId,
              // A scroll with no distance is not a scroll. 0.8 of a viewport is
              // the smallest amount that reliably reveals the next row without
              // skipping past the element that was being looked for.
              deltaY: 600,
              ...(request.text === undefined ? {} : { text: request.text }),
            },
          },
        ],
      })
      const step = call.steps[0]
      if (step === undefined || !step.ok) {
        return { ok: false, code: 'input-failed', message: step?.error ?? 'the render worker returned no action result', n: request.n }
      }
      const reply = step.result as ActReply
      if (!reply.ok) {
        return { ok: false, code: codeOf(reply.code), message: reply.message ?? reply.code, n: request.n }
      }
      return {
        ok: true,
        code: 'ok',
        action: (reply.action as 'click' | 'fill' | 'scroll') ?? 'click',
        n: request.n,
        backendNodeId: reply.backendNodeId ?? backendNodeId ?? 0,
        point: reply.point ?? { x: 0, y: 0 },
        measured: reply.measured ?? { x: 0, y: 0, width: 0, height: 0 },
        drift: reply.drift ?? 0,
      }
    },

    async verify(intent: IntentSpec): Promise<VerifyResult> {
      // Verification needs the CURRENT page, so it takes its own capture. It
      // does NOT reuse the loop's frame: the loop's frame is the one the judge
      // already looked at, and confirming a prediction with the same evidence
      // that produced it proves nothing.
      let frame: Frame
      try {
        frame = (await captureWithWorker()).frame
      } catch (captureError) {
        return { satisfied: false, note: `could not re-capture to verify: ${messageOf(captureError)}` }
      }
      const question = doneQuestion(intent.successCriteria)
      const result = await sendJudge(deps.judge, {
        questions: { satisfied: question },
        state: JSON.stringify({
          intent: intent.goal,
          criteria: intent.successCriteria,
          url: frame.target.url,
          candidates: frame.dom.nodes.map((node) => `${node.n}. ${node.role} "${node.name}"`),
        }),
      })
      const answer = result.answers.satisfied
      if (answer === undefined || answer.type !== 'noul') {
        // Unverifiable is NOT verified. Reporting `satisfied: true` here would
        // turn "we could not check" into "it worked", which is the exact
        // substitution this whole function exists to prevent.
        return { satisfied: false, note: `verification did not return a usable answer (${result.provider})` }
      }
      return {
        satisfied: answer.noul >= 0.5,
        note: `verification ${answer.noul.toFixed(2)} from ${result.provider}`,
      }
    },

    now: deps.now,
    sleep: deps.sleep,
  }
}

/**
 * A content-derived document revision.
 *
 * Hashes the target plus the DECODED BYTE COUNT and the candidate set, not the
 * base64 string: base64 of identical bytes is identical, so hashing it would
 * work, but it would also means hashing ~190 KB per capture to answer a question
 * that a three-number tuple answers just as reliably for this purpose.
 */
function revisionOf(reply: CaptureReply): number {
  const digest = createHash('sha1')
    .update(`${reply.targetId}\u0000${reply.targetUrl}\u0000${reply.bytes}`)
    .update(reply.marks.map((mark) => `${mark.backendNodeId}:${mark.role}:${mark.name}`).join('|'))
    .digest()
  return digest.readUInt32BE(0)
}

/**
 * Narrow a worker error code to one `act.ts` declares.
 *
 * `ActCode` is the single vocabulary for action outcomes, so an unrecognised
 * code from the worker becomes `input-failed` rather than being passed through.
 * Passing it through would let a new worker code silently become a code the
 * caller's `switch` has no branch for — the outcome would then fall into
 * whatever `default` happens to do.
 */
const FAILURE_CODES: readonly Exclude<ActCode, 'ok'>[] = [
  'no-answer', 'candidate-not-found', 'candidate-excluded', 'candidate-disabled',
  'no-box-model', 'click-missed', 'input-timeout', 'input-failed', 'hit-test-failed',
]

function codeOf(code: string): Exclude<ActCode, 'ok'> {
  return (FAILURE_CODES as readonly string[]).includes(code)
    ? (code as Exclude<ActCode, 'ok'>)
    : 'input-failed'
}

const messageOf = (value: unknown): string => (value instanceof Error ? value.message : String(value))

/** The frame id a capture would get, for a tool that wants to predict it. */
export const predictFrameId = (targetId: string, revision: number, seq: number): string =>
  frameIdFor({ targetId }, revision, seq)
