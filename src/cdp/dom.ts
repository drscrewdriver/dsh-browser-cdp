/**
 * src/cdp/dom.ts — M0.5: hit testing, node identity, layout boxes, semantics.
 *
 * Acceptance (decomposition.md `M0.5`): `getNodeForLocation` → `backendNodeId`
 * → `describeNode`; `getBoxModel` **minus `scrollX/scrollY`**; semantics come
 * from the accessibility tree.
 *
 * Why the scroll subtraction is in the API and not left to callers: CDP hands
 * back boxes in DOCUMENT space, while a panel that wants to draw a frame over a
 * clickable element works in VIEWPORT space. Forgetting that offset puts the
 * frame exactly `scrollY` pixels off — a bug that only shows up on a scrolled
 * page, i.e. never during a smoke test. The returned rect deliberately has no
 * `bottom`: CDP's own quads have none, and inventing one invites the class of
 * off-by-one that comes from mixing conventions.
 */

import type { LayerFailure, PageCall } from './page.ts'

export interface HitResult {
  ok: true
  backendNodeId: number
  nodeId: number
  frameId: string
}

export type HitOutcome = HitResult | LayerFailure

/** Which element is at a viewport point? Input coordinates, not document ones. */
export async function nodeAtPoint(
  call: PageCall,
  sessionId: string | undefined,
  x: number,
  y: number,
  timeoutMs?: number,
): Promise<HitOutcome> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, code: 'invalid-point', message: `point must be finite numbers (got ${x},${y})` }
  }
  try {
    const result = (await call(
      'DOM.getNodeForLocation',
      { x: Math.round(x), y: Math.round(y), includeUserAgentShadowDOM: false },
      { ...(sessionId === undefined ? {} : { sessionId }), ...(timeoutMs === undefined ? {} : { timeoutMs }) },
    )) as { backendNodeId?: unknown; nodeId?: unknown; frameId?: unknown }
    if (typeof result?.backendNodeId !== 'number') {
      return { ok: false, code: 'no-node-at-point', message: `nothing resolved at ${x},${y}` }
    }
    return {
      ok: true,
      backendNodeId: result.backendNodeId,
      nodeId: typeof result.nodeId === 'number' ? result.nodeId : 0,
      frameId: typeof result.frameId === 'string' ? result.frameId : '',
    }
  } catch (error) {
    return { ok: false, code: 'hit-test-failed', message: error instanceof Error ? error.message : String(error) }
  }
}

export interface NodeRef {
  backendNodeId?: number
  nodeId?: number
}

/**
 * The semantic identity of a node — the shape R6 feeds to the conversation,
 * and the one the loop's judge consumes. Deliberately mirrors what
 * `Accessibility` already knows so no page injection is needed (F8).
 */
export interface NodeSemantics {
  ok: true
  tag: string
  id: string
  role: string
  name: string
  keyboardFocusable: boolean
  attributes: Record<string, string>
}

export type SemanticsOutcome = NodeSemantics | LayerFailure

export async function describeNode(
  call: PageCall,
  sessionId: string | undefined,
  ref: NodeRef,
  timeoutMs?: number,
): Promise<SemanticsOutcome> {
  if (ref.backendNodeId === undefined && ref.nodeId === undefined) {
    return { ok: false, code: 'node-ref-missing', message: 'describeNode needs a backendNodeId or a nodeId' }
  }
  const params: Record<string, unknown> = { depth: 0, pierce: true }
  if (ref.backendNodeId !== undefined) params.backendNodeId = ref.backendNodeId
  else params.nodeId = ref.nodeId
  try {
    const result = (await call('DOM.describeNode', params, {
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    })) as { node?: { nodeName?: unknown; attributes?: unknown; backendNodeId?: unknown } }
    const node = result?.node
    if (node === undefined) return { ok: false, code: 'node-not-found', message: 'DOM.describeNode returned no node' }

    const rawAttributes = Array.isArray(node.attributes) ? node.attributes : []
    const attributes: Record<string, string> = {}
    for (let index = 0; index + 1 < rawAttributes.length; index += 2) {
      attributes[String(rawAttributes[index])] = String(rawAttributes[index + 1])
    }
    const tag = typeof node.nodeName === 'string' ? node.nodeName.toLowerCase() : ''
    const role = attributes.role ?? ''
    const name = attributes['aria-label'] ?? attributes.name ?? attributes.title ?? ''
    const keyboardFocusable = attributes.tabindex !== undefined
      ? Number(attributes.tabindex) >= 0
      : ['a', 'button', 'input', 'select', 'textarea'].includes(tag) && attributes.disabled === undefined

    return {
      ok: true,
      tag,
      id: attributes.id ?? '',
      role,
      name,
      keyboardFocusable,
      attributes,
    }
  } catch (error) {
    return { ok: false, code: 'describe-failed', message: error instanceof Error ? error.message : String(error) }
  }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface BoxResult {
  ok: true
  /** VIEWPORT-space rect (scroll already subtracted). No `bottom` by design. */
  rect: Rect
  /** Document-space rect as CDP reported it, kept for diagnostics. */
  documentRect: Rect
}

export type BoxOutcome = BoxResult | LayerFailure

/** A CDP quad is 8 numbers: x1,y1 .. x4,y4. */
function quadToRect(quad: unknown): Rect | null {
  if (!Array.isArray(quad) || quad.length < 8) return null
  const xs = [Number(quad[0]), Number(quad[2]), Number(quad[4]), Number(quad[6])]
  const ys = [Number(quad[1]), Number(quad[3]), Number(quad[5]), Number(quad[7])]
  if ([...xs, ...ys].some((value) => !Number.isFinite(value))) return null
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

export async function boxModel(
  call: PageCall,
  sessionId: string | undefined,
  ref: NodeRef,
  options: { scroll?: { x: number; y: number }; timeoutMs?: number } = {},
): Promise<BoxOutcome> {
  if (ref.backendNodeId === undefined && ref.nodeId === undefined) {
    return { ok: false, code: 'node-ref-missing', message: 'boxModel needs a backendNodeId or a nodeId' }
  }
  const params: Record<string, unknown> = {}
  if (ref.backendNodeId !== undefined) params.backendNodeId = ref.backendNodeId
  else params.nodeId = ref.nodeId
  try {
    const result = (await call('DOM.getBoxModel', params, {
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    })) as { model?: { content?: unknown } }
    const documentRect = quadToRect(result?.model?.content)
    if (documentRect === null) {
      return { ok: false, code: 'no-box-model', message: 'DOM.getBoxModel returned no usable content quad' }
    }
    const scroll = options.scroll ?? { x: 0, y: 0 }
    return {
      ok: true,
      documentRect,
      rect: { ...documentRect, x: documentRect.x - scroll.x, y: documentRect.y - scroll.y },
    }
  } catch (error) {
    return { ok: false, code: 'box-model-failed', message: error instanceof Error ? error.message : String(error) }
  }
}

export interface AxNode {
  /** The AX node id, which Chrome also uses as the DOM backend node id. */
  nodeId: string
  /** Numeric form of `nodeId`, ready for `Overlay.highlightNode`. 0 when unparsable. */
  backendNodeId: number
  role: string
  name: string
  ignored: boolean
  keyboardFocusable: boolean
}

export interface AxResult {
  ok: true
  nodes: AxNode[]
}

export type AxOutcome = AxResult | LayerFailure

interface RawAxNode {
  nodeId?: unknown
  ignored?: unknown
  role?: { value?: unknown }
  name?: { value?: unknown }
  properties?: Array<{ name?: unknown; value?: { value?: unknown } }>
}

/** Flatten `Accessibility.getFullAXTree` into the semantics the judge consumes. */
export function flattenAxTree(nodes: readonly RawAxNode[]): AxNode[] {
  const out: AxNode[] = []
  for (const node of nodes) {
    const properties = node.properties ?? []
    const focusable = properties.find((property) => property.name === 'focusable')
    out.push({
      nodeId: typeof node.nodeId === 'string' ? node.nodeId : '',
      backendNodeId: Number.parseInt(typeof node.nodeId === 'string' ? node.nodeId : '', 10) || 0,
      role: typeof node.role?.value === 'string' ? node.role.value : '',
      name: typeof node.name?.value === 'string' ? node.name.value : '',
      ignored: node.ignored === true,
      keyboardFocusable: focusable?.value?.value === true,
    })
  }
  return out
}

export async function accessibilityTree(
  call: PageCall,
  sessionId: string | undefined,
  timeoutMs?: number,
): Promise<AxOutcome> {
  try {
    const result = (await call(
      'Accessibility.getFullAXTree',
      {},
      { ...(sessionId === undefined ? {} : { sessionId }), ...(timeoutMs === undefined ? {} : { timeoutMs }) },
    )) as { nodes?: unknown }
    if (!Array.isArray(result?.nodes)) {
      return { ok: false, code: 'ax-tree-missing', message: 'Accessibility.getFullAXTree returned no nodes array' }
    }
    return { ok: true, nodes: flattenAxTree(result.nodes as RawAxNode[]) }
  } catch (error) {
    return { ok: false, code: 'ax-tree-failed', message: error instanceof Error ? error.message : String(error) }
  }
}
