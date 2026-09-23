import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NODE_LIMIT,
  buildFrame,
  chunkIndexOf,
  dominantContainer,
  frameIdFor,
  isInteractiveRole,
  planChunks,
  sliceFrame,
  type Frame,
  type FrameNodeInput,
} from '../src/jev/frame.ts'

/**
 * Frame-contract acceptance. Two claims are load-bearing and are tested as
 * claims, not as implementation details:
 *
 *   1. `n` is contiguous and refers to the candidate at that index — always.
 *      A judge answers with `n`; the caller resolves it by index. If the
 *      numbering had holes, a judge's "7" would mean different things to the
 *      two sides of the seam.
 *   2. Chunking is CONDITIONAL. The measured page (136.9 KiB / 26 candidates)
 *      must not be sliced for the image, only for the candidate count.
 */

const target = { endpoint: 'http://127.0.0.1:9223', targetId: 'T1', url: 'https://example.test/', title: 'Example' }
const viewport = { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }

const node = (id: number, role = 'button', name = `btn-${id}`, container = 'main'): FrameNodeInput => ({
  backendNodeId: id,
  role,
  name,
  container,
})

describe('jev frame · candidate numbering', () => {
  it('numbers 1..N contiguously in document order', () => {
    const { frame } = buildFrame({
      target,
      viewport,
      image: null,
      nodes: [node(11), node(22), node(33)],
      documentRevision: 1,
      seq: 1,
    })
    expect(frame.dom.nodes.map((entry) => entry.n)).toEqual([1, 2, 3])
    expect(frame.dom.nodes.map((entry) => entry.backendNodeId)).toEqual([11, 22, 33])
  })

  it('skips non-interactive roles and COUNTS them rather than silently dropping', () => {
    const { frame, skippedNonInteractive } = buildFrame({
      target,
      viewport,
      image: null,
      nodes: [node(1), node(2, 'heading'), node(3, 'paragraph'), node(4)],
      documentRevision: 1,
      seq: 1,
    })
    expect(frame.dom.nodes.map((entry) => entry.backendNodeId)).toEqual([1, 4])
    expect(skippedNonInteractive).toBe(2)
  })

  it('drops duplicate backend node ids so two numbers never mean one element', () => {
    const { frame } = buildFrame({
      target,
      viewport,
      image: null,
      nodes: [node(7), node(7, 'link'), node(8)],
      documentRevision: 1,
      seq: 1,
    })
    expect(frame.dom.nodes.map((entry) => entry.backendNodeId)).toEqual([7, 8])
    expect(frame.dom.nodes.map((entry) => entry.n)).toEqual([1, 2])
  })

  it('applies the limit BEFORE numbering, so n stays contiguous when capped', () => {
    const many = Array.from({ length: 30 }, (_, i) => node(i + 1))
    const { frame } = buildFrame({ target, viewport, image: null, nodes: many, documentRevision: 1, seq: 1, limit: 4 })
    expect(frame.dom.nodes.map((entry) => entry.n)).toEqual([1, 2, 3, 4])
    // `total` still reports what was FOUND — the judge is told the page is
    // bigger than the list it was given.
    expect(frame.dom.total).toBe(30)
  })

  it('records rects but marks them null when unknown, never a fake zero', () => {
    const { frame } = buildFrame({
      target,
      viewport,
      image: null,
      nodes: [{ backendNodeId: 5, role: 'button', name: 'b', rect: null }],
      documentRevision: 1,
      seq: 1,
    })
    expect(frame.dom.nodes[0]?.rect).toBeNull()
  })

  it('normalizes state flags to booleans so a judge never reads undefined', () => {
    const { frame } = buildFrame({
      target,
      viewport,
      image: null,
      nodes: [node(1)],
      documentRevision: 1,
      seq: 1,
    })
    expect(frame.dom.nodes[0]?.state).toEqual({ disabled: false, checked: false, expanded: false, focusable: false })
  })

  it('agrees with marks.ts on which roles are interactive', () => {
    for (const role of ['button', 'link', 'textbox', 'checkbox', 'tab', 'menuitem']) {
      expect(isInteractiveRole(role)).toBe(true)
    }
    expect(isInteractiveRole('heading')).toBe(false)
    expect(isInteractiveRole('image')).toBe(false)
  })
})

describe('jev frame · stable ids', () => {
  it('hashes the same state to the same id and different state apart', () => {
    const a = frameIdFor({ targetId: 'T1' }, 7, 1)
    const b = frameIdFor({ targetId: 'T1' }, 7, 1)
    const c = frameIdFor({ targetId: 'T1' }, 7, 2)
    const d = frameIdFor({ targetId: 'T2' }, 7, 1)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).not.toBe(d)
    expect(a).toHaveLength(16)
  })

  it('is not a timestamp — two captures of one document differ only by seq', () => {
    // Asserted because a time-based id would make a log un-derivable.
    expect(frameIdFor({ targetId: 'T' }, 1, 1)).toBe(frameIdFor({ targetId: 'T' }, 1, 1))
  })

  it('uses the injected clock for capturedAt', () => {
    const { frame } = buildFrame({
      target,
      viewport,
      image: null,
      nodes: [node(1)],
      documentRevision: 1,
      seq: 1,
      now: () => 1234,
    })
    expect(frame.capturedAt).toBe(1234)
  })
})

describe('jev frame · chunking is conditional, not default', () => {
  it('does NOT slice a page whose image and candidates both fit', () => {
    // The measured case: 136.9 KiB under a 1 MiB budget.
    const plan = planChunks({ candidateCount: 20, imageBytes: 140220, maxBytes: 1048576 })
    expect(plan.chunkTotal).toBe(1)
    expect(plan.reason).toBe('fits')
    expect(plan.sizes).toEqual([20])
  })

  it('does NOT slice for a big image when the candidates fit — that is a format problem', () => {
    // Slicing candidates would not shrink the image. Saying so beats emitting
    // N chunks that are all over budget.
    const plan = planChunks({ candidateCount: 12, imageBytes: 2_000_000, maxBytes: 1048576 })
    expect(plan.chunkTotal).toBe(1)
    expect(plan.reason).toBe('image-over-budget')
  })

  it('slices when the candidate list exceeds the ceiling', () => {
    // The measured page: 26 candidates against a 20 ceiling.
    const plan = planChunks({ candidateCount: 26, imageBytes: 140220, maxBytes: 1048576 })
    expect(plan.chunkTotal).toBe(2)
    expect(plan.reason).toBe('too-many-candidates')
    expect(plan.sizes).toEqual([20, 6])
  })

  it('reports both causes when the image and the list are each over budget', () => {
    const plan = planChunks({ candidateCount: 30, imageBytes: 5_000_000, maxBytes: 1048576 })
    expect(plan.reason).toBe('both')
    expect(plan.chunkTotal).toBe(2)
  })

  it('treats maxBytes 0 as unbounded', () => {
    expect(planChunks({ candidateCount: 10, imageBytes: 9_999_999, maxBytes: 0 }).reason).toBe('fits')
  })

  it('never loses a candidate: the sizes always sum to the input count', () => {
    for (const count of [0, 1, 19, 20, 21, 41, 100]) {
      const plan = planChunks({ candidateCount: count, imageBytes: null, maxBytes: 0 })
      expect(plan.sizes.reduce((sum, size) => sum + size, 0)).toBe(count)
      expect(plan.chunkTotal).toBe(plan.sizes.length)
    }
  })

  it('defaults the chunk ceiling to the advisory option ceiling', () => {
    expect(DEFAULT_NODE_LIMIT).toBe(20)
  })
})

describe('jev frame · slicing', () => {
  const build = (count: number): Frame =>
    buildFrame({
      target,
      viewport,
      image: null,
      nodes: Array.from({ length: count }, (_, i) => node(i + 1)),
      documentRevision: 1,
      seq: 1,
      limit: count,
    }).frame

  it('returns null out of range rather than wrapping', () => {
    // A silent wrap turns a budget problem into an infinite loop.
    const frame = build(26)
    const plan = planChunks({ candidateCount: 26, imageBytes: null, maxBytes: 0 })
    expect(sliceFrame(frame, plan, 0)).toBeNull()
    expect(sliceFrame(frame, plan, 3)).toBeNull()
    expect(sliceFrame(frame, plan, 1)).not.toBeNull()
    expect(sliceFrame(frame, plan, 2)).not.toBeNull()
  })

  it('preserves document order and the ORIGINAL n across chunks', () => {
    const frame = build(26)
    const plan = planChunks({ candidateCount: 26, imageBytes: null, maxBytes: 0 })
    const first = sliceFrame(frame, plan, 1)
    const second = sliceFrame(frame, plan, 2)
    expect(first?.nodes.map((entry) => entry.n)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    // The second chunk keeps n = 21..26 — renumbering here would make the same
    // judge answer mean two different elements.
    expect(second?.nodes.map((entry) => entry.n)).toEqual([21, 22, 23, 24, 25, 26])
    expect(second?.itemCount).toBe(6)
  })

  it('carries the chunk metadata a judge needs to place itself', () => {
    const frame = build(26)
    const plan = planChunks({ candidateCount: 26, imageBytes: null, maxBytes: 0 })
    const second = sliceFrame(frame, plan, 2)
    expect(second?.frameId).toBe(frame.frameId)
    expect(second?.chunkIndex).toBe(2)
    expect(second?.chunkTotal).toBe(2)
  })

  it('locates a candidate index in its chunk', () => {
    expect(chunkIndexOf(26, 20, 0)).toBe(1)
    expect(chunkIndexOf(26, 20, 19)).toBe(1)
    expect(chunkIndexOf(26, 20, 20)).toBe(2)
    expect(chunkIndexOf(10, 20, 9)).toBe(1)
  })

  it('names the dominant container, and says "other" for nothing', () => {
    const frame = build(26)
    expect(dominantContainer([])).toBe('other')
    expect(dominantContainer(frame.dom.nodes)).toBe('main')
  })
})
