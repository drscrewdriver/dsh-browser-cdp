/**
 * src/cast/fallback-tab-report.ts — tab-anchor reports on routes with no CDP ws.
 *
 * `captureTabReport` (src/tab-report.ts) reads the Accessibility tree over a CDP
 * websocket. Two routes have no such socket:
 *
 *  • `ego-cli`  — the host drives a short heredoc; the runtime hands the script
 *                 `page` / `browser` / `taskSpaces` as parameters, so an in-page
 *                 `page.evaluate` is the only way to see the DOM.
 *  • `tabbit-cli` — a Playwright snippet runs inside the CLI; same story.
 *
 * Both therefore use ONE in-page collector (`COLLECT_FN_SOURCE`, embedded in
 * both script dialects) and hand its role/name pairs to the SAME numbering and
 * anchor machinery the CDP path uses (`reportScope` + `numberReportNodes`), so
 * a report means the same thing whichever route produced it. Synthetic
 * `backendNodeId`s only exist to seed `anchorFor`; the report says so through
 * `source` so nobody mistakes them for live CDP node ids.
 */

import { numberReportNodes, reportScope, MAX_REPORT_ELEMENTS, TAB_REPORT_TYPE, type TabReportElement } from '../tab-report.ts'
import type { AxNode } from '../cdp/dom.ts'

/** Sentinel the ego heredoc prints; carries the snapshot JSON. */
export const AX_SENTINEL = '@@BCDP_AX@@'

/** Hard cap on candidates collected in one pass (DOM scan is O(n)). */
export const MAX_COLLECTED = 400

export type FallbackRoute = 'ego-cli' | 'tabbit-cli'

export interface FallbackAxSnapshot {
  url: string
  title: string
  /** Real tab id when the runtime reported one (ego), else ''. */
  targetId: string
  nodes: { role: string; name: string }[]
}

export interface FallbackReportInput {
  route: FallbackRoute
  /** Requested tab id — echoed into the report so the dock card can match it. */
  targetId: string
  snapshot: FallbackAxSnapshot
  now?: number
  maxElements?: number
  /** A route that could not read the DOM at all (still yields a URL+title report). */
  degraded?: 'ego-cli' | 'tabbit-cli'
}

/**
 * The in-page collector, shared byte-for-byte by the ego heredoc and the Tabbit
 * Playwright snippet. Deliberately framework-agnostic DOM: interactive tags plus
 * explicit ARIA roles, first 400 in document order, whitespace collapsed, name
 * capped at 120 chars. Nodes without any accessible label are dropped (a report
 * of unnamed buttons helps nobody).
 */
export const COLLECT_FN_SOURCE =
  `() => {\n` +
  `  const sel = 'a[href],button,input,select,textarea,[role],[contenteditable="true"],[onclick],[tabindex]'\n` +
  `  const out = []\n` +
  `  const seen = new Set()\n` +
  `  for (const el of document.querySelectorAll(sel)) {\n` +
  `    if (out.length >= ${MAX_COLLECTED}) break\n` +
  `    if (seen.has(el)) continue\n` +
  `    seen.add(el)\n` +
  `    const role = String(el.getAttribute('role') || el.tagName.toLowerCase()).slice(0, 40)\n` +
  `    const raw = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.innerText || el.value || ''\n` +
  `    const name = String(raw).replace(/\\s+/g, ' ').trim().slice(0, 120)\n` +
  `    if (name === '') continue\n` +
  `    out.push({ role: role, name: name })\n` +
  `  }\n` +
  `  return out\n` +
  `}`

/** Embed a value as a JS literal (U+2028/2029 are syntax errors in a heredoc). */
const js = (v: unknown): string =>
  JSON.stringify(v).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

/**
 * ego heredoc: activate the agent's task space, read the CURRENT tab's url/title
 * plus the in-page candidates, and print one sentinel line. Errors are reported
 * through the sentinel (an `ok:false` line) so the host can distinguish "route
 * unavailable" from "page returned nothing".
 */
export function buildEgoAxScript(spaceJson: string): string {
  return (
    `try {\n` +
    `  await taskSpaces.useOrCreate(${spaceJson})\n` +
    `  const __tab = await browser.currentTab()\n` +
    `  const __info = await page.info()\n` +
    `  const __nodes = await page.evaluate(${COLLECT_FN_SOURCE})\n` +
    `  console.log(${js(AX_SENTINEL)} + JSON.stringify({ ok: true, url: __info.url || '', title: __info.title || '', targetId: __tab.targetId || '', nodes: Array.isArray(__nodes) ? __nodes : [] }))\n` +
    `} catch (__err) {\n` +
    `  console.log(${js(AX_SENTINEL)} + JSON.stringify({ ok: false, error: String((__err && __err.message) || __err) }))\n` +
    `}\n`
  )
}

/**
 * Tabbit Playwright snippet. `page.evaluate` sees the same DOM the CLI's own
 * observe tool would; the receipt carries only plain JSON so nothing is
 * demoted to a resource.
 */
export function buildTabbitAxSnippet(): string {
  return [
    `const __nodes = await page.evaluate(${COLLECT_FN_SOURCE});`,
    `return {url: page.url(), title: await page.title(), nodes: __nodes};`,
  ].join('\n')
}

/** Parse the newest sentinel line; null when the script never reached it. */
export function parseAxSentinel(stdout: string): { ok: boolean; url?: string; title?: string; targetId?: string; nodes?: { role: string; name: string }[]; error?: string } | null {
  const lines = stdout.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const idx = lines[i].indexOf(AX_SENTINEL)
    if (idx === -1) continue
    const payload = lines[i].slice(idx + AX_SENTINEL.length).trim()
    if (payload === '') continue
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>
      if (parsed === null || typeof parsed !== 'object') return null
      const nodes = Array.isArray(parsed.nodes)
        ? (parsed.nodes as unknown[])
            .map((n) => {
              const rec = (n ?? {}) as { role?: unknown; name?: unknown }
              return { role: typeof rec.role === 'string' ? rec.role : '', name: typeof rec.name === 'string' ? rec.name : '' }
            })
            .filter((n) => n.name !== '')
        : []
      return {
        ok: parsed.ok === true,
        ...(typeof parsed.url === 'string' ? { url: parsed.url } : {}),
        ...(typeof parsed.title === 'string' ? { title: parsed.title } : {}),
        ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
        ...(typeof parsed.error === 'string' ? { error: parsed.error } : {}),
        nodes,
      }
    } catch {
      return null
    }
  }
  return null
}

/**
 * Turn one collected snapshot into a TabAnchorReport. Numbering, anchors and the
 * truncation flag all come from the CDP path's own helpers so both routes agree.
 */
export function composeFallbackReport(input: FallbackReportInput): {
  type: 'tab-anchor-report'
  cdpEndpoint: string
  targetId: string
  pageUrl: string
  pageTitle: string
  frameId: string
  capturedAt: number
  elements: TabReportElement[]
  truncated: boolean
  source: FallbackRoute
  degraded?: 'ego-cli' | 'tabbit-cli'
} {
  const capturedAt = input.now ?? Date.now()
  const pageUrl = input.snapshot.url || ''
  const frameId = reportScope(pageUrl, capturedAt)
  const nodes: AxNode[] = input.snapshot.nodes.map((n, i) => ({
    nodeId: String(i + 1),
    backendNodeId: i + 1,
    role: n.role || 'generic',
    name: n.name,
    ignored: false,
    keyboardFocusable: false,
  }))
  const numbered = numberReportNodes(nodes, frameId, input.maxElements ?? MAX_REPORT_ELEMENTS)
  return {
    type: TAB_REPORT_TYPE,
    cdpEndpoint: input.route,
    targetId: input.snapshot.targetId || input.targetId,
    pageUrl,
    pageTitle: input.snapshot.title || '',
    frameId,
    capturedAt,
    elements: numbered.elements,
    truncated: numbered.truncated,
    source: input.route,
    ...(input.degraded ? { degraded: input.degraded } : {}),
  }
}
