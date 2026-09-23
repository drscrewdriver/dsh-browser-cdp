/**
 * src/cdp/marks.ts — 阶段 3 / R4: set-of-marks over pure CDP, zero injection.
 *
 * A6 wants "one call that returns the image AND the `{n → element}` map, where
 * `n` can be fed back to a click". T3.1r moved marking from page injection to
 * CDP-native, and this module is the resulting shape:
 *
 *   Accessibility.getFullAXTree  →  interactive candidates, numbered in
 *                                  document order (n = 1..N)
 *   DOM.getBoxModel              →  viewport rect per candidate (scroll minus'd)
 *   Overlay.highlightNode        →  OPTIONAL: highlight exactly one of them
 *   Page.captureScreenshot       →  the image, same session
 *   Overlay.hideHighlight        →  best-effort cleanup, always attempted
 *
 * One measured constraint, stated instead of papered over: `Overlay` renders a
 * SINGLE highlight at a time, so N numbered boxes cannot be drawn natively —
 * that is what the numbered MAP is for. A caller that needs the boxes drawn
 * goes back to page injection, which T3.1r explicitly moved away from.
 *
 * Everything is read-only plus a transient highlight: no DOM is touched, no
 * `.value` is assigned, and the highlight is cleared even when the screenshot
 * fails.
 */

import type { LayerFailure, PageCall } from './page.ts'
import { accessibilityTree, boxModel, type AxNode } from './dom.ts'
import { NEUTRAL_HIGHLIGHT_CONFIG, captureScreenshot, readScrollOffset } from './page.ts'

/** Roles that make an AX node a click/fill target worth numbering. */
export const INTERACTIVE_ROLES = [
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'option',
  'switch',
  'slider',
] as const

export function isInteractiveRole(role: string): boolean {
  return (INTERACTIVE_ROLES as readonly string[]).includes(role)
}

export interface MarkedElement {
  /** 1-based index into the returned `marks` array — the number a caller echoes back. */
  n: number
  /** The AX node id, which IS the DOM backend node id for the Overlay domain. */
  backendNodeId: number
  role: string
  name: string
  keyboardFocusable: boolean
  /** VIEWPORT-space rect (scroll already subtracted). Null when unmeasurable. */
  rect: { x: number; y: number; width: number; height: number } | null
  /** Document-space rect, for diagnostics. */
  documentRect: { x: number; y: number; width: number; height: number } | null
}

/**
 * Number the interactive candidates of an AX tree.
 *
 * Document order is preserved (the tree arrives in order), duplicates are
 * dropped by node id, ignored nodes are skipped, and `limit` caps the set so a
 * huge page cannot flood the caller — the cap is the caller's budget, applied
 * BEFORE any per-node round trip.
 */
export function interactiveCandidates(nodes: readonly AxNode[], limit = 20): MarkedElement[] {
  const seen = new Set<number>()
  const out: MarkedElement[] = []
  for (const node of nodes) {
    if (out.length >= limit) break
    if (node.ignored || !isInteractiveRole(node.role)) continue
    if (seen.has(node.backendNodeId)) continue
    seen.add(node.backendNodeId)
    out.push({
      n: out.length + 1,
      backendNodeId: node.backendNodeId,
      role: node.role,
      name: node.name,
      keyboardFocusable: node.keyboardFocusable,
      rect: null,
      documentRect: null,
    })
  }
  return out
}

export interface CaptureMarkedOptions {
  /** Max candidates to number. Applied before any per-node round trip. */
  limit?: number
  /** 1-based index into the marks to highlight while the shot is taken. */
  highlightIndex?: number
  /** Measure a rect per candidate (N extra round trips). Default true. */
  measureRects?: boolean
  format?: 'png' | 'jpeg'
  quality?: number
  sessionId?: string
  timeoutMs?: number
}

export interface CaptureMarkedOk {
  ok: true
  data: string
  bytes: number
  marks: MarkedElement[]
  /** The mark that was highlighted, or null. */
  highlighted: number | null
  /** Non-fatal highlight failure, recorded rather than swallowed. */
  highlightError: { code: string; message: string } | null
}

export type CaptureMarkedResult = CaptureMarkedOk | LayerFailure

export async function captureMarked(
  call: PageCall,
  sessionId: string | undefined,
  options: CaptureMarkedOptions = {},
): Promise<CaptureMarkedResult> {
  const limit = options.limit ?? 20
  const measureRects = options.measureRects ?? true

  const tree = await accessibilityTree(call, sessionId, options.timeoutMs)
  if (!tree.ok) return tree

  const marks = interactiveCandidates(tree.nodes, limit)

  if (measureRects) {
    // Rects are reported in VIEWPORT space so a panel can draw over the live
    // image; that needs the current scroll offset. An unreadable offset
    // degrades to document space rather than failing the capture.
    const scroll = await readScrollOffset(call, sessionId, options.timeoutMs)
    const scrollOffset = scroll.ok ? { x: scroll.x, y: scroll.y } : { x: 0, y: 0 }
    for (const mark of marks) {
      const box = await boxModel(call, sessionId, { backendNodeId: mark.backendNodeId }, {
        scroll: scrollOffset,
        timeoutMs: options.timeoutMs,
      })
      if (box.ok) {
        mark.rect = box.rect
        mark.documentRect = box.documentRect
      }
    }
  }

  let highlighted: number | null = null
  let highlightError: { code: string; message: string } | null = null
  if (options.highlightIndex !== undefined) {
    const wanted = marks.find((mark) => mark.n === options.highlightIndex)
    if (wanted === undefined) {
      highlightError = {
        code: 'highlight-index-out-of-range',
        message: `no mark #${options.highlightIndex} (only ${marks.length} candidates)`,
      }
    } else {
      try {
        await call(
          'Overlay.highlightNode',
          { backendNodeId: wanted.backendNodeId, highlightConfig: NEUTRAL_HIGHLIGHT_CONFIG },
          { ...(sessionId === undefined ? {} : { sessionId }), ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) },
        )
        highlighted = wanted.n
      } catch (error) {
        // Non-fatal: the shot is still worth taking, the miss is recorded.
        highlightError = { code: 'highlight-failed', message: error instanceof Error ? error.message : String(error) }
      }
    }
  }

  const shot = await captureScreenshot(call, sessionId, {
    format: options.format,
    quality: options.quality,
    timeoutMs: options.timeoutMs,
  })

  // Cleanup happens no matter how the shot went: a stuck highlight outlives
  // the tool call otherwise, and the next caller would inherit it.
  try {
    await call('Overlay.hideHighlight', {}, {
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    })
  } catch {
    // Hide is best-effort; recording it is not worth a failure path.
  }

  if (!shot.ok) return shot
  return { ok: true, data: shot.data, bytes: shot.bytes, marks, highlighted, highlightError }
}
