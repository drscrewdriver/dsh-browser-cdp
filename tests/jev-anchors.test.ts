import { describe, expect, it } from 'vitest'
import { anchorFor, isAnchorFormat } from '../src/jev/anchors.ts'
import { buildFrame } from '../src/jev/frame.ts'
import type { Frame } from '../src/jev/frame.ts'
import { DEFAULT_BUDGETS, runLoop } from '../src/jev/loop.ts'
import type { ActOutcome } from '../src/jev/act.ts'
import type { ActRequest, LoopEffects } from '../src/jev/loop.ts'
import type { JudgeChainResult, JudgeRequest } from '../src/jev/judge.ts'
import type { IntentSpec } from '../src/jev/prompt.ts'

/**
 * T7.3 骨架验收 — the anchor's two invariants and its first consumer.
 *
 * 1. 同输入同锚：same scope + same node → the same string (frameId is a
 *    content hash, so this is deterministic, not "usually stable");
 * 2. 跨快照必须变：any different snapshot scope → a different anchor, which
 *    is what makes an anchor invalid in a foreign snapshot BY CONSTRUCTION
 *    rather than by bookkeeping.
 *
 * The consumer test pins the wiring: a successful element action records the
 * anchor of the node it touched in the loop trace (`LoopStep.anchor`).
 */

const target = { endpoint: 'ws://x/devtools/browser/1', targetId: 'T1', url: 'https://example.test/', title: 'Ex' }
const viewport = { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }

const intent: IntentSpec = {
  goal: 'submit the form',
  kind: 'click',
  targetHints: [],
  successCriteria: ['the confirmation page is visible'],
  stopConditions: [],
  source: 'user',
}

function makeFrame(count: number): Frame {
  return buildFrame({
    target,
    viewport,
    image: null,
    nodes: Array.from({ length: count }, (_, i) => ({
      backendNodeId: 200 + i,
      role: 'button',
      name: `Action ${i + 1}`,
      container: 'main',
    })),
    documentRevision: 1,
    seq: 1,
    limit: count,
    now: () => 0,
  }).frame
}

describe('jev anchors · T7.3 invariants', () => {
  it('mints sb-<16hex>, recognized by isAnchorFormat', () => {
    const anchor = anchorFor('frame-scope', 7)
    expect(anchor).toMatch(/^sb-[0-9a-f]{16}$/)
    expect(isAnchorFormat(anchor)).toBe(true)
    expect(isAnchorFormat('SB-0123456789abcdef')).toBe(false)
    expect(isAnchorFormat('sb-0123456789abcdef0')).toBe(false)
    expect(isAnchorFormat('sb-xyz')).toBe(false)
  })

  it('same input → same anchor (同输入同锚)', () => {
    expect(anchorFor('frame-a', 42)).toBe(anchorFor('frame-a', 42))
  })

  it('a different snapshot scope changes every anchor (跨快照必须变)', () => {
    // A recapture that changes the page changes documentRevision → frameId;
    // the anchor minted in the old frame must never equal the new one.
    const frameOne = buildFrame({
      target,
      viewport,
      image: null,
      nodes: [{ backendNodeId: 7, role: 'button', name: 'Go', container: 'main' }],
      documentRevision: 1,
      seq: 1,
      limit: 8,
      now: () => 0,
    }).frame
    const frameTwo = buildFrame({
      target,
      viewport,
      image: null,
      nodes: [{ backendNodeId: 7, role: 'button', name: 'Go', container: 'main' }],
      documentRevision: 2,
      seq: 1,
      limit: 8,
      now: () => 0,
    }).frame
    expect(frameTwo.frameId).not.toBe(frameOne.frameId)
    expect(anchorFor(frameTwo.frameId, 7)).not.toBe(anchorFor(frameOne.frameId, 7))
  })

  it('different nodes in the same snapshot get different anchors', () => {
    const scope = 'frame-a'
    expect(anchorFor(scope, 7)).not.toBe(anchorFor(scope, 8))
  })
})

describe('jev anchors · first consumer: the loop trace', () => {
  it('a successful element action records the anchor of the node it touched', async () => {
    const frame = makeFrame(3)
    const judged: JudgeRequest[] = []
    const choiceAnswer = (answers: Record<string, string>): JudgeChainResult => {
      const built: Record<string, unknown> = {}
      for (const [id, value] of Object.entries(answers)) {
        built[id] = { type: 'choice', choice: value, probabilities: { [value]: 0.95, other: 0.05 }, confidence: 0.95 }
      }
      return {
        answers: built as JudgeChainResult['answers'],
        provider: 'laya',
        model: 'laya',
        latencyMs: 1,
        degraded: false,
        trace: [],
        warnings: [],
        dropped: [],
        missing: [],
        chain: ['laya:answered'],
      }
    }
    const effects: LoopEffects = {
      async capture() {
        return { frame, documentRevision: 1 }
      },
      async judge(request: JudgeRequest): Promise<JudgeChainResult> {
        judged.push(request)
        if ('candidate' in request.questions) return choiceAnswer({ candidate: '2' })
        return choiceAnswer({ control: 'act' })
      },
      async act(request: ActRequest): Promise<ActOutcome> {
        return {
          ok: true,
          code: 'ok',
          action: request.action === 'scroll' ? 'scroll' : 'click',
          n: request.n,
          backendNodeId: 200 + request.n,
          point: { x: 1, y: 1 },
          measured: { x: 0, y: 0, width: 10, height: 10 },
          drift: 0,
        }
      },
      async verify() {
        return { satisfied: true, note: 'criteria observed' }
      },
      now: () => 0,
      async sleep(): Promise<void> {},
    }

    const result = await runLoop({ intent, effects, budgets: { ...DEFAULT_BUDGETS, steps: 1 } })
    const actStep = result.steps.find((s) => s.control === 'act' && s.ok)
    expect(actStep).toBeDefined()
    // The anchor is minted from the frame the action ran in and the node the
    // act actually touched (backendNodeId = 200 + n = 202), not the round's
    // numbering — so an archived trace names the element across renumbering.
    expect(actStep?.anchor).toBe(anchorFor(frame.frameId, 202))
  })
})
