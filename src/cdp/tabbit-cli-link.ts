/**
 * src/cdp/tabbit-cli-link.ts — Tabbit CLI backend adapter.
 *
 * Parallel to cli-link.ts (ego CLI). Drives Tabbit browser via `tabbit-cli nodejs`
 * commands that execute Playwright code in the browser's embedded runtime.
 *
 * Execution model:
 *   1. resolveTabbitCli() — locate tabbit-cli binary (LOCALAPPDATA → PATH)
 *   2. probeTabbitCli()   — readiness check via `tabbit-cli diagnose`
 *   3. runTabbitSnippet() — execute a Playwright JS snippet via stdin
 *   4. parseTabbitReceipt() — parse JSON receipt from stdout
 *   5. openSpace/closeSpace/listTabs — task lifecycle helpers
 *
 * P0-1 (linkScope slot isolation), P0-3 (reaper skip), P0-4 (gate) are the
 * pre-conditions that make this backend safe alongside ego-cli/cdp/lightpanda.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SubprocessService, SubprocessHandle, CollectReader } from '../types.ts'
import { readAll } from '../util.ts'

// ── CLI path resolution ──────────────────────────────────────────────────────

export interface TabbitCliResolution {
  found: boolean
  cliPath: string
  error?: string
}

/**
 * Three-tier detection for tabbit-cli:
 * 1. Explicit cfg.cliPath (from link row)
 * 2. Windows LOCALAPPDATA standard install path
 * 3. POSIX ~/.local/bin or PATH
 */
export function resolveTabbitCli(cliPath?: string): TabbitCliResolution {
  // Tier 1: explicit
  if (cliPath && cliPath.trim() !== '') {
    const p = cliPath.trim()
    if (existsSync(p)) return { found: true, cliPath: p }
    return { found: false, cliPath: p, error: `explicit path not found: ${p}` }
  }

  // Tier 2: platform-specific default
  const e = process.env
  const isWin = process.platform === 'win32'
  if (isWin) {
    const localAppData = e.LOCALAPPDATA || ''
    const candidates = [
      join(localAppData, 'Tabbit', 'LocalAgent', 'bin', 'tabbit-cli.exe'),
      join(localAppData, 'Tabbit', 'LocalAgent', 'bin', 'tabbit-cli'),
    ]
    for (const c of candidates) {
      if (existsSync(c)) return { found: true, cliPath: c }
    }
  } else {
    // macOS / Linux
    const home = e.HOME || e.USERPROFILE || ''
    const posixCandidates = [
      join(home, '.local', 'bin', 'tabbit-cli'),
      '/usr/local/bin/tabbit-cli',
    ]
    for (const c of posixCandidates) {
      if (existsSync(c)) return { found: true, cliPath: c }
    }
  }

  // Tier 3: PATH probe (via which/where is deferred to the caller;
  // we report not-found and the caller can attempt PATH-based spawn)
  return {
    found: false,
    cliPath: '',
    error: isWin
      ? `tabbit-cli.exe not found at %LOCALAPPDATA%\\Tabbit\\LocalAgent\\bin\\`
      : 'tabbit-cli not found in ~/.local/bin or /usr/local/bin',
  }
}

// ── Receipt parsing ──────────────────────────────────────────────────────────

export interface TabbitReceipt {
  ok: boolean
  status: 'succeeded' | 'failed' | 'interrupted' | 'queued' | 'running'
  data?: unknown
  error?: { code: string; message: string }
  requestId?: string
  /**
   * Tab ids the CLI acquired for this run (`result.acquisition.tabIds`).
   * `data` only carries `result.value`, so without this field every caller was
   * blind to which tab the snippet actually ran against — that is what the
   * frame poller needs to re-target the SAME page the tools drove.
   */
  tabIds?: number[]
}

/**
 * Parse stdout from `tabbit-cli nodejs` — expects a single JSON object
 * matching the receipt schema from SKILL.md.
 * Pure JSON.parse, no sentinel needed.
 */
export function parseTabbitReceipt(stdout: string): TabbitReceipt {
  const trimmed = stdout.trim()
  if (trimmed === '') {
    return { ok: false, status: 'failed', error: { code: 'EMPTY_OUTPUT', message: 'tabbit-cli produced no stdout' } }
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // Try last line (diagnostics might be on stderr but sometimes bleeds to stdout)
    const lines = trimmed.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        parsed = JSON.parse(lines[i]!)
        break
      } catch { /* continue scanning */ }
    }
    // If still no luck after scanning
    if (!parsed!) {
      return { ok: false, status: 'failed', error: { code: 'PARSE_ERROR', message: `cannot parse tabbit receipt: ${trimmed.slice(0, 200)}` } }
    }
  }
  const obj = parsed!
  const status = String(obj.status ?? 'failed') as TabbitReceipt['status']
  const requestId = typeof obj.requestId === 'string' ? obj.requestId : (typeof (obj.result as any)?.requestId === 'string' ? (obj.result as any).requestId : undefined)
  // Acquisition lives NEXT TO `result.value`, not inside it, so the tab ids have
  // to be lifted out here or they are lost for every caller.
  const acqTabs = (obj.result as any)?.acquisition?.tabIds
  const tabIds = Array.isArray(acqTabs)
    ? acqTabs.filter((n: unknown): n is number => typeof n === 'number')
    : undefined
  const tabField = tabIds && tabIds.length > 0 ? { tabIds } : {}

  if (status === 'succeeded') {
    const result = obj.result as Record<string, unknown> | undefined
    const value = result?.value ?? result ?? obj
    return { ok: true, status, data: value, requestId, ...tabField }
  }
  if (status === 'queued' || status === 'running') {
    return { ok: false, status, requestId, ...tabField }
  }
  // failed / interrupted
  const errMsg = typeof obj.error === 'string' ? obj.error
    : typeof (obj.result as any)?.error === 'string' ? (obj.result as any).error
    : typeof obj.message === 'string' ? obj.message
    : 'unknown error'
  const errCode = typeof obj.code === 'string' ? obj.code
    : /timeout/i.test(errMsg) ? 'TIMEOUT'
    : /not attached|not found|no element/i.test(errMsg) ? 'ELEMENT_NOT_FOUND'
    : /ERR_|net::|navigation/i.test(errMsg) ? 'NAVIGATION_FAILED'
    : 'EXECUTION_FAILED'
  return { ok: false, status, error: { code: errCode, message: errMsg }, requestId, ...tabField }
}

// ── Core execution ───────────────────────────────────────────────────────────

export interface TabbitRunOptions {
  cliPath: string
  taskName: string
  requestId: string
  timeoutMs?: number
  /** Optional: acquire a specific user tab (档位 B) */
  tabId?: number
  /** Optional: acquire a group (档位 B) */
  groupId?: number
}

export interface TabbitRunResult {
  receipt: TabbitReceipt
  exitCode: number
}

/**
 * `--timeout-ms` accepted range, straight from the CLI's own rejection message:
 *
 *   "--timeout-ms must be from 60000 through 180000; the default is 60000, so
 *    omit it unless the program needs longer"
 *
 * Anything shorter makes the CLI refuse the whole request with REQUEST_FAILED
 * and never run the snippet. This is a hard contract, so it is enforced here
 * once instead of at every call site — the 3 s frame poller used to pass 10 s /
 * 15 s and therefore NEVER captured a frame, which is invisible because the
 * rejection surfaces as an ordinary "failed" receipt rather than an exception.
 */
export const TABBIT_MIN_TIMEOUT_MS = 60000
export const TABBIT_MAX_TIMEOUT_MS = 180000

/**
 * Execute a Playwright JS snippet via tabbit-cli nodejs.
 * Writes JS code to stdin, collects stdout JSON receipt.
 */
export async function runTabbitSnippet(
  subprocess: SubprocessService,
  jsCode: string,
  opts: TabbitRunOptions,
): Promise<TabbitRunResult> {
  const args = ['nodejs', '--task', opts.taskName, '--request-id', opts.requestId]
  // Only forward a timeout the CLI will accept; out-of-range is omitted so the
  // CLI applies its own 60 s default. A sub-60 s deadline is expressed INSIDE
  // the snippet (a Promise.race), not on the command line.
  const timeout = opts.timeoutMs === undefined
    ? undefined
    : Math.min(TABBIT_MAX_TIMEOUT_MS, Math.max(TABBIT_MIN_TIMEOUT_MS, opts.timeoutMs))
  if (timeout !== undefined) args.push('--timeout-ms', String(timeout))
  if (opts.tabId !== undefined) args.push('--tab', String(opts.tabId))
  if (opts.groupId !== undefined) args.push('--group', String(opts.groupId))

  const handle = subprocess.spawn({
    argv: [opts.cliPath, ...args],
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: {
      stdin: { data: jsCode },
      stdout: { maxBytes: 4 * 1024 * 1024 },
      stderr: { maxBytes: 64 * 1024 },
    },
    graceMs: (timeout ?? TABBIT_MIN_TIMEOUT_MS) + 15000, // program timeout + grace
  })

  const { exitCode } = await handle.done
  const stdout = readAll(handle.collected.stdout)
  const receipt = parseTabbitReceipt(stdout)
  return { receipt, exitCode: exitCode ?? 1 }
}

/**
 * Poll a pending receipt (queued/running) up to maxWait ms.
 * Returns the final receipt or a timeout error.
 */
export async function pollTabbitPending(
  subprocess: SubprocessService,
  opts: { cliPath: string; taskName: string; requestId: string; maxWaitMs?: number },
): Promise<TabbitReceipt> {
  const maxWait = opts.maxWaitMs ?? 60000
  const pollInterval = 5000
  const start = Date.now()

  while (Date.now() - start < maxWait) {
    const args = ['receipt', '--task', opts.taskName, '--request-id', opts.requestId, '--wait-ms', String(pollInterval)]
    const handle = subprocess.spawn({
      argv: [opts.cliPath, ...args],
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: { stdin: { data: '' }, stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
      graceMs: pollInterval + 10000,
    })
    await handle.done
    const stdout = readAll(handle.collected.stdout)
    const receipt = parseTabbitReceipt(stdout)
    if (receipt.status !== 'queued' && receipt.status !== 'running') return receipt
  }
  return { ok: false, status: 'interrupted', error: { code: 'POLL_TIMEOUT', message: `receipt still pending after ${maxWait}ms` } }
}

// ── Task lifecycle helpers ───────────────────────────────────────────────────

/** Create a task (档位 A: returns inventory without acquiring) */
export async function tabbitCreateTask(
  subprocess: SubprocessService,
  cliPath: string,
  taskName: string,
): Promise<{ tabs: Array<{ id: number; title: string; url: string; state: string }>; currentTabId: number | null; total: number; complete: boolean }> {
  const handle = subprocess.spawn({
    argv: [cliPath, 'create', '--task', taskName],
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: { stdin: { data: '' }, stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
    graceMs: 10000,
  })
  await handle.done
  const stdout = readAll(handle.collected.stdout)
  try {
    const parsed = JSON.parse(stdout.trim())
    return {
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs : [],
      currentTabId: typeof parsed.currentTabId === 'number' ? parsed.currentTabId : null,
      total: typeof parsed.total === 'number' ? parsed.total : 0,
      complete: parsed.complete === true,
    }
  } catch {
    return { tabs: [], currentTabId: null, total: 0, complete: false }
  }
}

/** Finish a task (retain tabs by default) */
export async function tabbitFinishTask(
  subprocess: SubprocessService,
  cliPath: string,
  taskName: string,
  discard = false,
): Promise<{ released: boolean }> {
  const args = ['finish', '--task', taskName]
  if (discard) args.push('--discard')
  const handle = subprocess.spawn({
    argv: [cliPath, ...args],
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: { stdin: { data: '' }, stdout: { maxBytes: 64 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
    graceMs: 10000,
  })
  await handle.done
  return { released: true }
}

/**
 * One tab as `tabbit-cli tabs` reports it. The field names come straight from
 * the CLI: the identifier is `tabId` (not `id`) and the "current tab" marker is
 * the boolean `active`. Both were missing from the type this used to declare,
 * so consumers had to reach through `any` to find the tab they wanted.
 */
export interface TabbitTab {
  tabId: number
  title: string
  url: string
  state: string
  /** True for the one foreground tab of the window. */
  active?: boolean
  index?: number
  group?: number | null
  windowId?: number
}

/** List tabs with optional state filter */
export async function tabbitListTabs(
  subprocess: SubprocessService,
  cliPath: string,
  taskName: string,
  stateFilter?: 'available' | 'owned' | 'claimed',
): Promise<{ tabs: TabbitTab[]; total: number; complete: boolean }> {
  const args = ['tabs', '--task', taskName]
  if (stateFilter) args.push('--state', stateFilter)
  const handle = subprocess.spawn({
    argv: [cliPath, ...args],
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: { stdin: { data: '' }, stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
    graceMs: 10000,
  })
  await handle.done
  const stdout = readAll(handle.collected.stdout)
  try {
    const parsed = JSON.parse(stdout.trim())
    return {
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs : [],
      total: typeof parsed.total === 'number' ? parsed.total : 0,
      complete: parsed.complete === true,
    }
  } catch {
    return { tabs: [], total: 0, complete: false }
  }
}

/** Diagnose: check if tabbit-cli can reach the browser (short timeout, no launch). */
export async function tabbitDiagnose(
  subprocess: SubprocessService,
  cliPath: string,
): Promise<{ reachable: boolean; raw: string }> {
  const handle = subprocess.spawn({
    argv: [cliPath, 'diagnose'],
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: { stdin: { data: '' }, stdout: { maxBytes: 128 * 1024 }, stderr: { maxBytes: 128 * 1024 } },
    graceMs: 20000, // Allow time for browser cold-start (tabbit-cli launches browser if needed)
  })
  const { exitCode } = await handle.done
  const stdout = readAll(handle.collected.stdout)
  return { reachable: (exitCode ?? 1) === 0, raw: stdout }
}

// ── Playwright snippet builders (档位 A) ─────────────────────────────────────

export function buildNavigateSnippet(url: string, waitUntil: string): string {
  return `await page.goto(${JSON.stringify(url)}, {waitUntil: ${JSON.stringify(waitUntil)}}); return {url: page.url(), title: await page.title()};`
}

export function buildObserveSnippet(maxChars: number): string {
  return `return await tabbit.observe({frames: "none", maxChars: ${maxChars}});`
}

export function buildClickSnippet(locatorExpr: string): string {
  return `await ${locatorExpr}.click(); return {clicked: true};`
}

export function buildFillSnippet(locatorExpr: string, value: string): string {
  return `await ${locatorExpr}.fill(${JSON.stringify(value)}); return {filled: true};`
}

/**
 * In-snippet capture deadline (ms).
 *
 * `Page.captureScreenshot` is NOT reliably fast in this runtime: the same tab
 * that answers in 132 ms can also never answer at all, and an unanswered send
 * blocks the whole evaluation until the CLI's hard deadline, which takes the
 * executor down and kills every other call in that task. A short `Promise.race`
 * inside the snippet keeps a stuck capture from becoming a stuck task.
 */
export const TABBIT_CAPTURE_DEADLINE_MS = 8000

/** The race-guarded capture expression shared by both snippet builders. */
function captureWithDeadline(format: 'png' | 'jpeg', quality: number | undefined, deadlineMs: number): string[] {
  const params = `{format: "${format}"${quality === undefined ? '' : `, quality: ${quality}`}, fromSurface: true}`
  return [
    `const c = await context.newCDPSession(page);`,
    `let r = null, capErr = null;`,
    `try {`,
    `  r = await Promise.race([`,
    `    c.send("Page.captureScreenshot", ${params}),`,
    `    new Promise((_, reject) => setTimeout(() => reject(new Error("capture-deadline")), ${deadlineMs})),`,
    `  ]);`,
    `} catch (e) { capErr = String((e && e.message) || e); }`,
    `try { await c.detach(); } catch {}`,
    `if (capErr !== null || !r) return {skipped: "capture-timeout", error: capErr, url: page.url()};`,
  ]
}

export function buildScreenshotSnippet(outPath: string, deadlineMs = TABBIT_CAPTURE_DEADLINE_MS): string {
  // Same demotion trap as the frame poller: a viewport PNG base64 exceeds
  // tabbit-cli's inline threshold, so the receipt comes back as a `resource`
  // ({type, resourceId, byteLength}) with NO `value` — which is why this tool
  // used to answer `base64: "[object Object]"`. Write the bytes to a file and
  // return the path; the host reads it.
  //
  // `page.screenshot()` is deliberately NOT used: in this runtime it blocks on
  // font loading and dies at its 30 s timeout (observed repeatedly on baidu.com).
  const p = JSON.stringify(outPath)
  return [
    ...captureWithDeadline('png', undefined, deadlineMs),
    `const buf = Buffer.from(r.data, "base64");`,
    `const fs = await import("node:fs");`,
    `fs.writeFileSync(${p}, buf);`,
    `return {path: ${p}, bytes: buf.length, url: page.url(), title: await page.title()};`,
  ].join('\n')
}

/** JPEG quality for the live watch-panel frame stream. */
export const TABBIT_FRAME_JPEG_QUALITY = 50

/**
 * Build the live watch-panel frame-capture snippet.
 *
 * The bytes go to `outPath` INSIDE the CLI process and only the path travels
 * back in the receipt, for the same resource-demotion reason as
 * `buildScreenshotSnippet`. The old snippet returned the raw base64, which over
 * threshold became a `resource`; the poller then found no `receipt.data.base64`,
 * broadcast nothing, and — because the receipt still said `succeeded` — logged
 * nothing either. That is exactly how the panel stayed empty while every tool
 * call reported success.
 *
 * JPEG (not PNG) because the panel refreshes on a 3 s cadence: a PNG of a heavy
 * page takes ~2.6 s to encode, JPEG/q50 a fraction of that and ~3× smaller over
 * SSE.
 *
 * A blank page is skipped instead of captured: `about:blank` hangs the CLI until
 * its hard deadline (observed: 60 s EVALUATION_TIMEOUT), and a blank frame tells
 * the panel nothing anyway.
 */
export function buildFrameCaptureSnippet(
  outPath: string,
  quality = TABBIT_FRAME_JPEG_QUALITY,
  deadlineMs = TABBIT_CAPTURE_DEADLINE_MS,
): string {
  const p = JSON.stringify(outPath)
  return [
    `const url = page.url();`,
    `if (!url || url === "about:blank") return {skipped: "blank", url: url || ""};`,
    ...captureWithDeadline('jpeg', quality, deadlineMs),
    `const buf = Buffer.from(r.data, "base64");`,
    `const fs = await import("node:fs");`,
    `fs.writeFileSync(${p}, buf);`,
    `return {path: ${p}, url, title: await page.title(), bytes: buf.length};`,
  ].join('\n')
}

/**
 * Translate a bcdp_* locator/ref format into a Playwright locator expression.
 * - `loc=role:button[name="Save"]` → `page.getByRole("button", {name: "Save", exact: true})`
 * - `loc=css:.btn-submit` → `page.locator(".btn-submit")`
 * - `@N` → `page.locator('[data-ref="N"]')` (best-effort, may not work on Tabbit)
 */
export function translateLocator(selector: string): string | null {
  if (!selector) return null
  // loc=role format
  const roleMatch = selector.match(/^loc=role:(\w+)\[name="(.+?)"\]$/)
  if (roleMatch) {
    return `page.getByRole(${JSON.stringify(roleMatch[1])}, {name: ${JSON.stringify(roleMatch[2])}, exact: true})`
  }
  // loc=css format
  const cssMatch = selector.match(/^loc=css:(.+)$/)
  if (cssMatch) {
    return `page.locator(${JSON.stringify(cssMatch[1])})`
  }
  // loc=href format
  const hrefMatch = selector.match(/^loc=href:(.+)$/)
  if (hrefMatch) {
    return `page.locator(${JSON.stringify(`a[href="${hrefMatch[1]}"]`)})`
  }
  // Plain CSS selector (no loc= prefix)
  if (!selector.startsWith('@') && !selector.startsWith('loc=')) {
    return `page.locator(${JSON.stringify(selector)})`
  }
  // @N ref — best-effort (won't work reliably on Tabbit)
  return null
}
