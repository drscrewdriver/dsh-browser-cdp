/**
 * src/tab-report.ts — 整页 Tab 锚点报告（tab-anchor-report，Phase 1.2）。
 *
 * 一次点击 = 一份整页报告：一次 round-trip 拿整页的 role+name，生成 anchor，
 * 归档一个 JSON，composer 收到一条 token。这比点选循环逐元素 describe 便宜
 * （plan 决策记录：服务端一次抓取），并且复用 picks 归档体系 —— dock card、
 * badge、存储三处零改动（findings §1）。
 *
 * 与 plan 字面方法表有一处差异，写在这里而不是留给读者猜：plan 写的是
 * `DOMSnapshot.captureSnapshot(computedStyles: ['role','aria-label'])`。Blink 的
 * computed-style 查询只答 CSS 属性名，`role` / `aria-label` 会返回空——而锚点
 * 报告的全部内容就是 role+name（plan 自己说"不做进一步可见性判断"）。所以
 * role+name 的来源换成 `Accessibility.getFullAXTree`：与 marks.ts / frame.ts
 * 同一个来源（`source: 'ax-tree'`），走 flattenAxTree + isInteractiveRole。
 * AX 节点 id 就是 DOM backendNodeId（cdp/dom.ts 已写明）。
 *
 * 全可注入：call 面、timers、socket 工厂 —— 测试不读真实时钟、不碰真实网络，
 * 这是本仓对 host-free 模块的既定规矩。
 */

import { createHash } from 'node:crypto'
import { anchorFor } from './jev/anchors.ts'
import { isInteractiveRole } from './jev/frame.ts'
import { CdpSession, type WebSocketLike } from './cdp/session.ts'
import { accessibilityTree, type AxNode } from './cdp/dom.ts'
import type { EngineId } from './cdp/capabilities.ts'
import type { PageCall } from './cdp/page.ts'

/** Report type the dock card keys on (`obj.type === TAB_REPORT_TYPE`). */
export const TAB_REPORT_TYPE = 'tab-anchor-report'

/** Hard ceiling: a huge page is TRUNCATED and the reader is told, never trimmed silently. */
export const MAX_REPORT_ELEMENTS = 200

/** Per-capture CDP deadline (plan 约束 §: 单次抓取超时 15s → capture-timeout). */
export const TAB_REPORT_TIMEOUT_MS = 15000

/** File-name prefix — must not collide with the pick archive (`picks-…`). */
export const TAB_REPORT_FILE_PREFIX = 'tab-'

/** Domains the report needs, in the order CDP requires them (F10: DOM before anything that reads nodes). */
export const REPORT_ENABLE_METHODS = ['DOM.enable', 'Accessibility.enable']

/** Engines that cannot answer a node query; a report from one degrades to URL+title only. */
export const DEGRADED_ENGINE: EngineId = 'lightpanda'

export interface TabReportElement {
  /** `sb-<16hex>` — scoped to THIS capture; invalid in another snapshot by construction. */
  anchor: string
  n: number
  role: string
  name: string
  backendNodeId: number
}

export interface TabAnchorReport {
  type: 'tab-anchor-report'
  cdpEndpoint: string
  targetId: string
  pageUrl: string
  pageTitle: string
  /** The snapshot scope anchors are minted in (jev/anchors.ts calls it scope). */
  frameId: string
  capturedAt: number
  elements: TabReportElement[]
  /** True when the scan hit the ceiling — stated, not silent. */
  truncated: boolean
  /** Engine that could not produce elements; recorded, not hidden. */
  degraded?: 'lightpanda'
}

export type TabReportErrorCode = 'invalid-target' | 'capture-timeout' | 'ax-tree-failed'

export class TabReportError extends Error {
  readonly code: TabReportErrorCode
  constructor(code: TabReportErrorCode, message: string) {
    super(message)
    this.name = 'TabReportError'
    this.code = code
  }
}

/**
 * The capture identity. `frameId` in the JE loop is a content hash of the page
 * state; here there is no documentRevision to hash, so the plan's URL+timestamp
 * combination is what guarantees two captures of the same page mint different
 * anchors. Same page + same second = same scope (findings: accepted trade-off).
 */
export function reportScope(pageUrl: string, capturedAt: number): string {
  return createHash('sha256').update(`${pageUrl}\0${capturedAt}`).digest('hex').slice(0, 32)
}

export interface NumberedResult {
  elements: TabReportElement[]
  /** Candidates found BEFORE the ceiling — so a truncated report says how many there were. */
  total: number
  truncated: boolean
}

/**
 * Number the interactive candidates of one AX snapshot, in document order.
 * Same rules as cdp/marks.ts: ignored nodes are skipped, duplicates dropped by
 * node id, the ceiling caps the set, and the cap is REPORTED as `truncated`.
 */
export function numberReportNodes(nodes: readonly AxNode[], scope: string, maxElements = MAX_REPORT_ELEMENTS): NumberedResult {
  const out: TabReportElement[] = []
  const seen = new Set<number>()
  let total = 0
  for (const node of nodes) {
    if (node.ignored || !isInteractiveRole(node.role)) continue
    if (node.backendNodeId === 0 || seen.has(node.backendNodeId)) continue
    seen.add(node.backendNodeId)
    total += 1
    if (out.length >= maxElements) continue
    out.push({
      anchor: anchorFor(scope, node.backendNodeId),
      n: out.length + 1,
      role: node.role,
      name: node.name,
      backendNodeId: node.backendNodeId,
    })
  }
  return { elements: out, total, truncated: total > maxElements }
}

/** Raw one-snapshot read the report is built from; the seam tests fake. */
export interface AxSnapshot {
  pageUrl: string
  pageTitle: string
  nodes: AxNode[]
  /** Engine could not answer a node query (lightpanda) → empty nodes, degraded flag. */
  degraded: boolean
}

export interface CaptureTabReportInput {
  wsUrl: string
  targetId: string
  engine: EngineId | undefined
  /** Client-supplied from the spaces SSE; used as fallback when the AX read cannot reach the page. */
  urlHint?: string
  titleHint?: string
}

export interface CaptureTabReportDeps {
  now?: () => number
  maxElements?: number
  /** Socket factory threaded into the default AX read (tests never touch a real network). */
  createSocket?: (url: string) => WebSocketLike
  /** AX source seam; defaults to `defaultFetchAx`. Tests hand it canned snapshots. */
  fetchAx?: (input: CaptureTabReportInput, deps: CaptureTabReportDeps) => Promise<AxSnapshot>
}

/**
 * Open a SHORT-LIVED browser-level session, attach the one target, and read its
 * accessibility tree. This does NOT touch the resident cast worker: a second
 * CDP client on the same browser endpoint is normal (that is how the tools and
 * the screencast already coexist). The meta (url/title) comes from a single
 * `Runtime.evaluate` so the report is stamped at the SAME instant as its
 * elements, not from a possibly-stale spaces row.
 */
export async function defaultFetchAx(input: CaptureTabReportInput, deps: CaptureTabReportDeps = {}): Promise<AxSnapshot> {
  if (input.engine === DEGRADED_ENGINE) {
    return { pageUrl: input.urlHint ?? '', pageTitle: input.titleHint ?? '', nodes: [], degraded: true }
  }
  const session = new CdpSession({
    url: input.wsUrl,
    commandTimeoutMs: TAB_REPORT_TIMEOUT_MS,
    ...(deps.createSocket ? { createSocket: deps.createSocket } : {}),
  })
  await session.connect()
  try {
    const attached = (await session.call('Target.attachToTarget', { targetId: input.targetId, flatten: true })) as { sessionId?: unknown }
    const sessionId = typeof attached?.sessionId === 'string' ? attached.sessionId : ''
    if (sessionId === '') throw new TabReportError('invalid-target', `no CDP session resolved for target ${input.targetId}`)
    for (const method of REPORT_ENABLE_METHODS) {
      await session.call(method, {}, { sessionId, timeoutMs: TAB_REPORT_TIMEOUT_MS }).catch(() => { /* best-effort enable */ })
    }
    const call: PageCall = (method, params, options) =>
      session.call(method, params, { sessionId: options?.sessionId ?? sessionId, timeoutMs: options?.timeoutMs ?? TAB_REPORT_TIMEOUT_MS })
    const meta = (await call('Runtime.evaluate', { expression: '({href: location.href, title: document.title})', returnByValue: true })) as { result?: { value?: { href?: unknown; title?: unknown } } }
    const value = meta?.result?.value ?? {}
    const pageUrl = typeof value.href === 'string' ? value.href : (input.urlHint ?? '')
    const pageTitle = typeof value.title === 'string' ? value.title : (input.titleHint ?? '')
    const tree = await accessibilityTree(call, sessionId, TAB_REPORT_TIMEOUT_MS)
    if (!tree.ok) {
      // A dead/blank page still yields a usable report (URL+title, no elements).
      return { pageUrl, pageTitle, nodes: [], degraded: false }
    }
    return { pageUrl, pageTitle, nodes: tree.nodes, degraded: false }
  } finally {
    session.close()
  }
}

/**
 * Build one tab-anchor report. Pure beyond the AX read: scope + numbering are
 * `reportScope` / `numberReportNodes`, both already unit-testable in isolation.
 */
export async function captureTabReport(input: CaptureTabReportInput, deps: CaptureTabReportDeps = {}): Promise<TabAnchorReport> {
  const capturedAt = deps.now?.() ?? Date.now()
  const fetchAx = deps.fetchAx ?? defaultFetchAx
  const snapshot = await fetchAx(input, deps)
  const scope = reportScope(snapshot.pageUrl, capturedAt)
  const numbered = numberReportNodes(snapshot.nodes, scope, deps.maxElements ?? MAX_REPORT_ELEMENTS)
  return {
    type: TAB_REPORT_TYPE,
    cdpEndpoint: input.wsUrl,
    targetId: input.targetId,
    pageUrl: snapshot.pageUrl,
    pageTitle: snapshot.pageTitle,
    frameId: scope,
    capturedAt,
    elements: numbered.elements,
    truncated: numbered.truncated,
    ...(snapshot.degraded ? { degraded: 'lightpanda' as const } : {}),
  }
}
