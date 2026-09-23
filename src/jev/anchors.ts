/**
 * src/jev/anchors.ts — 阶段 7 骨架（T7.3）：候选锚 `sb-<16hex>`。
 *
 * The phase-7 plan specified a STABLE REFERENCE for a candidate: an anchor the
 * judge can name and the executor can resolve, scoped to the snapshot it was
 * minted in. The phase-10 loop currently identifies candidates by per-frame
 * numbering (`n`) plus the durable `backendNodeId`, with `frame.frameId` as the
 * snapshot identity — so the anchor is the binding of the three, not a fourth
 * identifier:
 *
 *     anchor = sb- + sha256(frameId \0 backendNodeId)[:16]
 *
 * The two invariants T7.3 demands, both pinned by tests:
 *   1. 同输入同锚 — the same frame and the same node mint the same anchor
 *      (frameId is itself a content hash, not a timestamp);
 *   2. 跨快照必须变 — any recapture that changes the page changes
 *      `documentRevision`, which changes `frameId`, which changes every anchor.
 *      An anchor minted in one snapshot is therefore INVALID in another by
 *      construction; there is no lookup table to go stale, only scope.
 *
 * First consumer (the anti-dead-code declaration): the loop trace — every
 * successful element action records the anchor of the node it touched
 * (`LoopStep.anchor`), giving an archived run a snapshot-stable name for "the
 * thing I acted on" that survives the per-frame renumbering.
 */

import { createHash } from 'node:crypto'

/** Fixed prefix so an anchor is recognizable in a transcript at a glance. */
export const ANCHOR_PREFIX = 'sb-'

/** Hex length after the prefix — half a sha256, collision-safe for this use. */
export const ANCHOR_HEX = 16

/**
 * Mint the anchor for one candidate inside one snapshot scope.
 *
 * `scope` is the frame identity (`frame.frameId`) in the current pipeline; any
 * caller with a different snapshot notion passes its own scope string — the
 * function only demands that different snapshots produce different scope
 * strings, which is exactly what frameId guarantees.
 */
export function anchorFor(scope: string, backendNodeId: number): string {
  const digest = createHash('sha256').update(`${scope}\0${backendNodeId}`).digest('hex')
  return `${ANCHOR_PREFIX}${digest.slice(0, ANCHOR_HEX)}`
}

/** Shape check only: `sb-` followed by exactly 16 lowercase hex digits. */
export function isAnchorFormat(value: string): boolean {
  if (!value.startsWith(ANCHOR_PREFIX)) return false
  const hex = value.slice(ANCHOR_PREFIX.length)
  if (hex.length !== ANCHOR_HEX) return false
  return /^[0-9a-f]+$/.test(hex)
}
