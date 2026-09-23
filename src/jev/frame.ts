/**
 * src/jev/frame.ts — 阶段 10: the FRAME contract.
 *
 * A frame is the only input unit the judge ever sees: one screenshot plus the
 * numbered DOM it came from, plus the intent that chose to look. Everything the
 * judge says refers back to a frame number `n`, never to a selector — that is
 * the property that makes hallucinated selectors structurally impossible
 * (design-jev-loop §1.2) rather than merely discouraged.
 *
 * Two rules in here were paid for by measurement, not reasoning:
 *
 *  1. **Rects are a fidelity claim, not ground truth.** They come from
 *     `DOM.getBoxModel` at capture time and the page may move afterwards, so the
 *     executor re-measures before every click. `buildFrame` therefore records
 *     them but nothing here is allowed to treat them as truth; `act.ts` does the
 *     live measuring. (Measured in A.9: the marks must be gathered AFTER the
 *     shot, or the numbering describes a page that no longer exists.)
 *  2. **Chunking is conditional, not default.** Measured: a real page's full
 *     JPEG was 136.9 KiB against a 1 MiB budget. So a static page is NOT sliced.
 *     `planChunks` first asks whether the image even overflows, which costs one
 *     capture but avoids paying the real price of chunking (extra judge rounds
 *     and rebuilt context) on pages that never needed it.
 */

import { createHash } from 'node:crypto'

/** Roles worth numbering. Mirrors src/cdp/marks.ts so both paths agree. */
export const INTERACTIVE_ROLES = [
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'switch', 'slider',
] as const

export function isInteractiveRole(role: string): boolean {
  return (INTERACTIVE_ROLES as readonly string[]).includes(role)
}

/** One numbered element of a frame. `n` is the ONLY handle a judge may return. */
export interface FrameNode {
  n: number
  backendNodeId: number
  role: string
  name: string
  /** VIEWPORT-space rect (scroll already subtracted). Stale by definition; diagnostics + layout hints only. */
  rect: { x: number; y: number; width: number; height: number } | null
  state: {
    disabled: boolean
    checked: boolean
    expanded: boolean
    focusable: boolean
  }
  /** Where it sits: nav / form / main / list / dialog / other. A chunk-homogeneity hint. */
  container: string
}

export interface FrameImage {
  format: 'png' | 'jpeg'
  bytes: number
  /** base64, as CDP returns it. Absent when the caller asked for a metadata-only frame. */
  dataBase64: string
  quality: number | null
  /** True when the byte budget could not be met even at the floor quality. */
  overBudget: boolean
  maxBytes: number
}

export interface FrameTarget {
  endpoint: string
  targetId: string
  url: string
  title: string
}

export interface FrameViewport {
  width: number
  height: number
  scrollX: number
  scrollY: number
  devicePixelRatio: number
}

export interface Frame {
  frameId: string
  capturedAt: number
  target: FrameTarget
  viewport: FrameViewport
  image: FrameImage | null
  dom: {
    nodes: FrameNode[]
    /** Candidates found before the `limit` cap. */
    total: number
    /** True when the DOM scan hit its hard ceiling — the judge is TOLD, never silently trimmed. */
    truncated: boolean
    source: 'ax-tree'
  }
}

/**
 * A stable frame id.
 *
 * Built from facts that identify WHICH page state this is — target, document
 * revision, capture sequence — rather than from a timestamp, so the same state
 * captured twice hashes the same and a log can be re-derived. `seq` is what
 * keeps two captures of an unchanged document distinct.
 */
export function frameIdFor(target: { targetId: string }, documentRevision: number, seq: number): string {
  return createHash('sha256')
    .update(`${target.targetId}\u0000${documentRevision}\u0000${seq}`)
    .digest('hex')
    .slice(0, 16)
}

export interface FrameNodeInput {
  backendNodeId: number
  role: string
  name: string
  rect?: { x: number; y: number; width: number; height: number } | null
  disabled?: boolean
  checked?: boolean
  expanded?: boolean
  focusable?: boolean
  container?: string
}

export interface BuildFrameInput {
  target: FrameTarget
  viewport: FrameViewport
  image: FrameImage | null
  nodes: readonly FrameNodeInput[]
  documentRevision: number
  seq: number
  /** Cap on numbered candidates. Applied BEFORE numbering, so `n` stays contiguous. */
  limit?: number
  now?: () => number
}

/** Default candidate cap. Matches the chunk ceiling — see THRESHOLD_BUCKETS. */
export const DEFAULT_NODE_LIMIT = 20

export interface BuildFrameResult {
  frame: Frame
  /** Non-interactive nodes that were skipped, counted so a caller can see them. */
  skippedNonInteractive: number
}

/**
 * Number the interactive candidates and freeze them into a frame.
 *
 * Order is DOCUMENT order (the AX tree arrives in it), duplicates by backend
 * node id are dropped, and `limit` caps the set BEFORE numbering — so `n = 1..N`
 * is contiguous and a judge that answers `n = 7` is answering about a candidate
 * the caller can find by index, always.
 */
export function buildFrame(input: BuildFrameInput): BuildFrameResult {
  const limit = input.limit ?? DEFAULT_NODE_LIMIT
  const now = input.now ?? (() => Date.now())
  const seen = new Set<number>()
  const nodes: FrameNode[] = []
  let skipped = 0

  for (const candidate of input.nodes) {
    if (nodes.length >= limit) break
    if (!isInteractiveRole(candidate.role)) { skipped += 1; continue }
    if (seen.has(candidate.backendNodeId)) continue
    seen.add(candidate.backendNodeId)
    nodes.push({
      n: nodes.length + 1,
      backendNodeId: candidate.backendNodeId,
      role: candidate.role,
      name: candidate.name,
      rect: candidate.rect ?? null,
      state: {
        disabled: candidate.disabled === true,
        checked: candidate.checked === true,
        expanded: candidate.expanded === true,
        focusable: candidate.focusable === true,
      },
      container: candidate.container ?? 'other',
    })
  }

  const interactive = input.nodes.filter((candidate) => isInteractiveRole(candidate.role)).length
  return {
    frame: {
      frameId: frameIdFor(input.target, input.documentRevision, input.seq),
      capturedAt: now(),
      target: input.target,
      viewport: input.viewport,
      image: input.image,
      dom: {
        nodes,
        total: interactive,
        // "Truncated" means the SCAN hit a ceiling, not that the caller asked
        // for fewer candidates. Conflating the two would tell a judge the page
        // is smaller than it is.
        truncated: false,
        source: 'ax-tree',
      },
    },
    skippedNonInteractive: skipped,
  }
}

// ── chunking: a conditional branch, not a default ───────────────────────────

export interface ChunkPlanInput {
  /** Candidate count in the frame. */
  candidateCount: number
  /** Measured image size, or null when no image was taken. */
  imageBytes: number | null
  /** The caller's byte budget; 0 = unbounded. */
  maxBytes: number
  /** Per-chunk candidate ceiling. */
  chunkSize?: number
}

export interface ChunkPlan {
  /** 1 = the whole page in one frame. Chunking is the exception. */
  chunkTotal: number
  chunkSize: number
  /** Which question forced the decision, so the trace can explain it. */
  reason: 'fits' | 'image-over-budget' | 'too-many-candidates' | 'both'
  /** Candidates per chunk, in order. Sums to the remainder-free split. */
  sizes: number[]
}

/**
 * Decide whether this frame must be sliced.
 *
 * The order of the questions is deliberate: an image that fits and a candidate
 * list that fits means NO slicing, and most real pages land there (measured
 * 136.9 KiB / 26 candidates against a 1 MiB / 20-candidate set — the image is
 * fine, the candidates are not, which is why both are asked separately).
 */
export function planChunks(input: ChunkPlanInput): ChunkPlan {
  const chunkSize = Math.max(1, input.chunkSize ?? DEFAULT_NODE_LIMIT)
  const overImage = input.imageBytes !== null && input.maxBytes > 0 && input.imageBytes > input.maxBytes
  const overCandidates = input.candidateCount > chunkSize

  if (!overImage && !overCandidates) {
    return { chunkTotal: 1, chunkSize, reason: 'fits', sizes: [input.candidateCount] }
  }
  if (overImage && !overCandidates) {
    // The image is too big but the candidate list is not. Slicing the CANDIDATES
    // would not shrink the IMAGE — that is a format/quality problem, and saying
    // so is better than producing N chunks that are all over budget.
    return { chunkTotal: 1, chunkSize, reason: 'image-over-budget', sizes: [input.candidateCount] }
  }

  const chunkTotal = Math.ceil(input.candidateCount / chunkSize)
  const sizes: number[] = []
  let remaining = input.candidateCount
  while (remaining > 0) {
    const take = Math.min(chunkSize, remaining)
    sizes.push(take)
    remaining -= take
  }
  return {
    chunkTotal,
    chunkSize,
    reason: overImage ? 'both' : 'too-many-candidates',
    sizes,
  }
}

/** The chunk of a frame a given index belongs to (1-based chunk numbers). */
export function chunkIndexOf(candidateCount: number, chunkSize: number, index: number): number {
  if (candidateCount <= chunkSize) return 1
  return Math.floor(index / chunkSize) + 1
}

export interface FrameChunk {
  frameId: string
  chunkIndex: number
  chunkTotal: number
  itemCount: number
  nodes: FrameNode[]
  containerHint: string
}

/**
 * Slice a frame's candidates into chunks, preserving document order.
 *
 * Out-of-range chunk numbers return `null` rather than wrapping: a `next` at the
 * boundary must surface as `no_more_chunks`, because a silent wrap turns a
 * budget problem into an infinite loop.
 */
export function sliceFrame(frame: Frame, plan: ChunkPlan, chunkIndex: number): FrameChunk | null {
  if (chunkIndex < 1 || chunkIndex > plan.chunkTotal) return null
  const start = plan.sizes.slice(0, chunkIndex - 1).reduce((sum, size) => sum + size, 0)
  const count = plan.sizes[chunkIndex - 1] ?? 0
  const nodes = frame.dom.nodes.slice(start, start + count)
  return {
    frameId: frame.frameId,
    chunkIndex,
    chunkTotal: plan.chunkTotal,
    itemCount: nodes.length,
    nodes,
    containerHint: dominantContainer(nodes),
  }
}

/** The container most of these nodes live in — the "is this chunk homogeneous" answer. */
export function dominantContainer(nodes: readonly FrameNode[]): string {
  if (nodes.length === 0) return 'other'
  const counts = new Map<string, number>()
  for (const node of nodes) counts.set(node.container, (counts.get(node.container) ?? 0) + 1)
  let best = 'other'
  let bestCount = -1
  for (const [container, count] of counts) {
    if (count > bestCount) { best = container; bestCount = count }
  }
  return best
}
