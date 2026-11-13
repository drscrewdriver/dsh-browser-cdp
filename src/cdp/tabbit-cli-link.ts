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
  /** 溢出结果只读回了一部分（达到字节上限或资源读取中断）。 */
  dataTruncated?: boolean
  /** 降级载荷的原始字节数，仅在有 `dataTruncated` 时有意义。 */
  dataByteLength?: number
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
  // failed / interrupted。错误信息在代际间有三种形态：字符串 `error`、
  // `result.error`、对象 `error:{name,code,message}`（Runtime Service 与新版 CLI
  // 用的就是这个）。缺掉第三种时所有真机失败都会被洗成 'unknown error'，
  // 模型拿不到任何可行动信息，只能盲重试。
  const errObj = obj.error as { message?: unknown; code?: unknown } | undefined
  const errMsg = typeof obj.error === 'string' ? obj.error
    : typeof (obj.result as any)?.error === 'string' ? (obj.result as any).error
    : typeof errObj?.message === 'string' ? errObj.message
    : typeof obj.message === 'string' ? obj.message
    : 'unknown error'
  const errCode = typeof obj.code === 'string' ? obj.code
    : typeof errObj?.code === 'string' ? errObj.code
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

  // 结果超过厂商运行时的 inline 阈值（`INLINE_RESULT_THRESHOLD_BYTES` = 16 KiB，
  // 硬编码不可配置）时，回执里的 `result` 是 `{resourceId, byteLength, elapsedMs,
  // nextAction, requestId}` —— 没有 `value`。旧逻辑把它直接当成值，于是上层看到
  // `ok:true` 但所有字段都是空（大快照、大 console.log 静默变空）。按 `resource`
  // 子命令分块读回，把可用上限抬到我们自己声明的量级，截断时显式上报。
  if (receipt.ok) {
    const ref = tabbitResourceRef(receipt.data)
    if (ref !== null) {
      const { text, complete } = await readTabbitResource(subprocess, opts.cliPath, opts.taskName, ref.resourceId)
      if (text !== '') {
        try {
          receipt.data = JSON.parse(text)
        } catch {
          receipt.data = text
        }
      } else {
        receipt.data = null
      }
      if (!complete) {
        receipt.dataTruncated = true
        receipt.dataByteLength = ref.byteLength
      }
    }
  }

  return { receipt, exitCode: exitCode ?? 1 }
}

/** 降级后只在回执里出现的资源引用。 */
export interface TabbitResourceRef {
  resourceId: string
  byteLength: number
}

/** 我们自己定的读回上限（不是厂商的 16 KiB inline 阈值，那个改不了）。 */
export const TABBIT_RESOURCE_MAX_BYTES = 2_000_000
/** 厂商单页上限 MAX_RESOURCE_READ_BYTES = 64 KiB，超过会拆成多页。 */
export const TABBIT_RESOURCE_PAGE_BYTES = 64 * 1024

/**
 * 判断一份 `data` 是不是「被降级成资源」的载荷。
 *
 * 要同时命中 `resourceId`（非空字符串）与数字 `byteLength`，且不得有 `value` 键：
 * 页面代码真的可能返回一个带 resourceId 的对象，单字段判据会误伤。
 */
export const tabbitResourceRef = (data: unknown): TabbitResourceRef | null => {
  if (typeof data !== 'object' || data === null) return null
  const o = data as Record<string, unknown>
  if (typeof o.resourceId !== 'string' || o.resourceId === '') return null
  if (typeof o.byteLength !== 'number') return null
  if ('value' in o) return null
  return { resourceId: o.resourceId, byteLength: o.byteLength }
}

/**
 * 用 `resource` 子命令分块读回一个溢出结果。
 *
 * 实测扁平形状：`{data, nextOffset, eof, offset, offsetUnit:"byte", byteLength, resourceId, encoding}`，
 * 其中 `data` 就是结果值的 JSON 文本。偏移按**字节**计且服务端要求起始偏移落在
 * 字符边界上（`startingOffsetMustBeBoundary`），所以下一跳必须用服务给的 `nextOffset`
 * 原值，不能自己累加长度。畸形块（无 nextOffset / 空 data / 不前进）一律当
 * 「没读完」收手，绝不自旋。
 */
export async function readTabbitResource(
  subprocess: SubprocessService,
  cliPath: string,
  taskName: string,
  resourceId: string,
  maxBytes: number = TABBIT_RESOURCE_MAX_BYTES,
): Promise<{ text: string; complete: boolean }> {
  let offset = 0
  let text = ''
  for (let guard = 0; guard < 4096; guard += 1) {
    const handle = subprocess.spawn({
      argv: [
        cliPath,
        'resource',
        '--task',
        taskName,
        '--resource',
        resourceId,
        '--offset',
        String(offset),
        '--max-bytes',
        String(TABBIT_RESOURCE_PAGE_BYTES),
      ],
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: { stdin: { data: '' }, stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
      graceMs: 40_000,
    })
    const { exitCode } = await handle.done
    const stdout = readAll(handle.collected.stdout).trim()
    if ((exitCode ?? 1) !== 0 || stdout === '') return { text, complete: false }
    let chunk: { data?: unknown; nextOffset?: unknown; eof?: unknown }
    try {
      chunk = JSON.parse(stdout)
    } catch {
      return { text, complete: false }
    }
    const piece = typeof chunk.data === 'string' ? chunk.data : ''
    if (chunk.eof === true) return { text: text + piece, complete: true }
    if (piece === '') return { text, complete: false }
    const next = typeof chunk.nextOffset === 'number' ? chunk.nextOffset : Number.NaN
    // 偏移不前进说明这块是重发，它的 data 不带新信息：并进结果就会重复拼接
    // （实测会凑出 `partialpartial`），所以先判位移再入库。
    if (!Number.isFinite(next) || next <= offset) return { text, complete: false }
    text += piece
    offset = next
    if (offset >= maxBytes) return { text, complete: false }
  }
  return { text, complete: false }
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
): Promise<{ tabs: TabbitTab[]; total: number; complete: boolean; focusedWindowId: number }> {
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
      // The CLI reports which WINDOW the user is looking at. Two windows with
      // the same two pages look like duplicate tabs in the panel unless we scope
      // to one of them — which is exactly what happened in the field.
      focusedWindowId: typeof parsed.focusedWindowId === 'number' ? parsed.focusedWindowId : 0,
    }
  } catch {
    return { tabs: [], total: 0, complete: false, focusedWindowId: 0 }
  }
}

/** Diagnose: check if tabbit-cli can reach the browser (short timeout, no launch). */
/** One live task as `diagnose` reports it. */
export interface TabbitTaskSummary {
  taskName: string
  taskId: string
  ownedTabIds: number[]
}

/**
 * Parse `diagnose` into the task→owned-tabs map.
 *
 * Needed because tab ownership is PER TASK: a tab owned by `dsh-<session>` (created
 * by a tool call) cannot be acquired by the panel's `dsh-panel` task, so a close
 * issued from the panel silently failed. The owner has to be looked up first.
 * Tolerant by design: any unparseable line is skipped, never thrown.
 */
export function parseTabbitTasks(raw: string): TabbitTaskSummary[] {
  const lines = raw.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('{'))
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]) as { tasks?: unknown }
      if (!Array.isArray(parsed.tasks)) continue
      return parsed.tasks
        .filter((task): task is Record<string, unknown> => typeof task === 'object' && task !== null)
        .map((task) => ({
          taskName: typeof task.taskName === 'string' ? task.taskName : '',
          taskId: typeof task.taskId === 'string' ? task.taskId : '',
          ownedTabIds: Array.isArray(task.ownedTabIds)
            ? task.ownedTabIds.filter((id): id is number => typeof id === 'number')
            : [],
        }))
        .filter((task) => task.taskName !== '')
    } catch { /* keep looking for a JSON line */ }
  }
  return []
}

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

/**
 * `bcdp_snapshot` 的 observe 封装。
 *
 * 契约（运行时自描述 docs.mjs，capabilityVersion 20）：`tabbit.observe()` 返回的是
 * 对象 `{page, pages, frames, snapshot, snapshotTruncated, …}`，**文本在 `snapshot`**，
 * 直接 `String()` 整个对象只会得到 `[object Object]`。同时把 `snapshotTruncated`
 * 透出去：截断后的快照不能当作完整清单用。
 */
export function buildObserveSnippet(maxChars: number): string {
  return [
    `const __o = await tabbit.observe({frames: "none", maxChars: ${maxChars}});`,
    `return { snapshot: (__o && typeof __o.snapshot === "string") ? __o.snapshot : "", truncated: !!(__o && __o.snapshotTruncated) };`,
  ].join('\n')
}

export function buildClickSnippet(plan: LocatorPlan): string {
  const head = plan.normalize
    ? `const el = await ${plan.expr}.normalize();`
    : `const el = ${plan.expr};`
  return `${head}\nawait el.click();\nreturn {clicked: true, normalized: ${plan.normalize}};`
}

export function buildFillSnippet(plan: LocatorPlan, value: string): string {
  const head = plan.normalize
    ? `const el = await ${plan.expr}.normalize();`
    : `const el = ${plan.expr};`
  return `${head}\nawait el.fill(${JSON.stringify(value)});\nreturn {filled: true, normalized: ${plan.normalize}};`
}

/** `bcdp_http` 响应体在浏览器侧就截断，避免超大资源拖爆上下文。 */
export const TABBIT_HTTP_BODY_CHARS = 8000

/**
 * 被截断时的出路指引。
 *
 * 实测用例里就有整份 CSS（找 @font-face 解字体加密）——那种响应远超本上限，
 * 只给 `truncated:true` 会让模型拿残缺正文反复重试；得告诉它文件落盘这条真路。
 */
export const TABBIT_HTTP_CLIP_HINT =
  'body clipped at the inline budget; for larger payloads use bcdp_script with page.fetch(url, {as: "file", savePath: artifactPath("name")}) and read the saved file.'

/**
 * `bcdp_js`：单表达式求值。
 *
 * 必须包成 IIFE：Playwright 的 `evaluate` 收字符串时按【表达式】求值，直接传
 * `() => x` 会得到一个函数对象（不可序列化）。表达式内部的 `//` 行注释会
 * 吃掉收尾括号，属于调用方需避免的写法（错误会由 CLI 原样冒出来）。
 */
export function buildJsSnippet(expression: string): string {
  const wrapped = `(() => (${expression}))()`
  return [
    `const __v = await page.evaluate(${JSON.stringify(wrapped)});`,
    `return { ok: true, result: __v };`,
  ].join('\n')
}

/**
 * `bcdp_http`：走 Tabbit 的 `page.fetch`（带浏览器 cookie / CORS / CSP）。
 *
 * 契约（docs.mjs `networkHelper`）：返回的是 **HTTP 元数据对象**，不是 Response——
 * `{ok, status, statusText, url, redirected, bytes, contentType, headers, via, text?, json?, path?}`，
 * 文本在 `__r.text` 属性上（写成 `__r.text()` 会 TypeError）；HTTP 错误返回 `ok:false`
 * 而不抛异常，所以 `ok` 必须透传而不能写死 true。
 * `as:"text"` 显式索要文本；不传 `maxBytes`（那个是尺寸上限，超了会 reject 而非截断），
 * 截断由本 snippet 自己完成。
 */
export function buildHttpSnippet(url: string, init: Record<string, unknown>): string {
  const opts = { ...init, as: 'text' }
  return [
    `const __r = await page.fetch(${JSON.stringify(url)}, ${JSON.stringify(opts)});`,
    `const __t = (typeof __r.text === "string") ? __r.text : "";`,
    `const __clip = __t.length > ${TABBIT_HTTP_BODY_CHARS};`,
    `return { ok: __r.ok !== false, status: __r.status, body: __t.slice(0, ${TABBIT_HTTP_BODY_CHARS}), truncated: __clip, contentType: __r.contentType, ...(__clip ? { hint: ${JSON.stringify(TABBIT_HTTP_CLIP_HINT)} } : {}) };`,
  ].join('\n')
}

/**
 * `bcdp_script`：把内容包进 async IIFE 执行。
 *
 * 两件事必须做对：
 *  1. 捕获 `console.log` —— 既有 description 承诺「可用 console.log(JSON.stringify())
 *     拿 result」，而 Tabbit 通道默认丢弃 console 输出；
 *  2. body 后强制换行 —— 否则末行 `//` 注释会把收尾的 `})();` 一起注释掉。
 */
export function buildScriptSnippet(body: string): string {
  return [
    'const __lines = [];',
    'const __log = console.log;',
    'console.log = (...a) => { try { __lines.push(a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ")) } catch {} };',
    'let __ret = null, __err = null;',
    'try {',
    `  __ret = await (async () => { ${body}\n })();`,
    '} catch (e) { __err = String((e && e.message) || e); }',
    'finally { console.log = __log; }',
    'return { stdout: __lines.join("\\n"), result: __ret, ...(__err !== null ? { error: __err } : {}) };',
  ].join('\n')
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
export const TABBIT_CAPTURE_DEADLINE_MS = 3500

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
 * Capture EVERY page the task owns, in ONE call — the tabbit equivalent of the
 * ego-cli per-tab session trick.
 *
 * 1.9.4 got non-focused pictures on the ego route by enumerating tabs and opening a
 * CDP session per tab (`Target.attachToTarget` → `Page.captureScreenshot`), never
 * activating anything. Tabbit exposes no `Target.*`, but a Playwright Context does:
 * `context.pages()` plus `newCDPSession(page)` per page is the same technique.
 *
 * Only pages the TASK owns are visible, which is exactly the set we drive — and a
 * page that was captured before stays owned, so background tabs keep producing
 * frames without stealing focus.
 *
 * Returns one file per page: `{ pages: [{ url, title, path, bytes }] }`.
 */
export function buildMultiFrameSnippet(
  dirPath: string,
  quality = TABBIT_FRAME_JPEG_QUALITY,
  deadlineMs = TABBIT_CAPTURE_DEADLINE_MS,
): string {
  const dir = JSON.stringify(dirPath)
  return [
    `const dir = ${dir};`,
    `const fs = await import("node:fs");`,
    `const out = [];`,
    `const pages = page.context().pages();`,
    `for (let i = 0; i < pages.length; i += 1) {`,
    `  const p = pages[i];`,
    `  let url = "";`,
    `  try { url = p.url(); } catch { continue; }`,
    `  if (!url || url === "about:blank") { out.push({ url: url || "", skipped: "blank" }); continue; }`,
    `  try {`,
    ...captureWithDeadlineOn('jpeg', quality, deadlineMs, 'p'),
    `    const buf = Buffer.from(r.data, "base64");`,
    `    const target = dir + "/" + i + ".jpg";`,
    `    fs.writeFileSync(target, buf);`,
    `    out.push({ url, title: await p.title(), path: target, bytes: buf.length });`,
    `  } catch (e) { out.push({ url, skipped: "capture", error: String(e && e.message || e) }); }`,
    `}`,
    `return { pages: out };`,
  ].join('\n')
}

/** Same race guard as captureWithDeadline, parameterised by the page variable. */
function captureWithDeadlineOn(
  format: 'png' | 'jpeg',
  quality: number | undefined,
  deadlineMs: number,
  pageVar: string,
): string[] {
  const opts = quality === undefined ? `{ format: ${JSON.stringify(format)} }` : `{ format: ${JSON.stringify(format)}, quality: ${quality} }`
  return [
    `    const session = await ${pageVar}.context().newCDPSession(${pageVar});`,
    `    const r = await Promise.race([`,
    `      session.send("Page.captureScreenshot", ${opts}),`,
    `      new Promise((_, rej) => setTimeout(() => rej(new Error("capture-deadline")), ${deadlineMs})),`,
    `    ]);`,
  ]
}

/**
 * One executable locator plan.
 */
export interface LocatorPlan {
  /** Playwright locator 表达式。 */
  expr: string
  /** true = 动作前先 `await <expr>.normalize()`。 */
  normalize: boolean
}

/**
 * Translate a bcdp_* locator/ref format into a locator plan.
 * - `loc=role:button[name="Save"]` → `page.getByRole("button", {name: "Save", exact: true})`
 * - `loc=css:.btn-submit` → `page.locator(".btn-submit")`
 * - `loc=href:/x` → `page.locator('a[href="/x"]')`
 * - `@e3` / `e3` / `@3` / `3` / `ref=e3` / `ref=3` → `page.locator("aria-ref=e3")` + normalize
 * - 其它裸 CSS → `page.locator(sel)`
 * - 无法识别 → null
 *
 * aria-ref 是 Tabbit 快照 ref 的原生定位器；此前猜成 `[data-ref="N"]` 属性，
 * 绝大多数页面不存在该属性，等于 ref 永远点不中。
 */
export function translateLocator(selector: string): LocatorPlan | null {
  if (!selector) return null
  // loc=role format
  const roleMatch = selector.match(/^loc=role:(\w+)\[name="(.+?)"\]$/)
  if (roleMatch) {
    return {
      expr: `page.getByRole(${JSON.stringify(roleMatch[1])}, {name: ${JSON.stringify(roleMatch[2])}, exact: true})`,
      normalize: false,
    }
  }
  // loc=css format
  const cssMatch = selector.match(/^loc=css:(.+)$/)
  if (cssMatch) {
    return { expr: `page.locator(${JSON.stringify(cssMatch[1])})`, normalize: false }
  }
  // loc=href format
  const hrefMatch = selector.match(/^loc=href:(.+)$/)
  if (hrefMatch) {
    return { expr: `page.locator(${JSON.stringify(`a[href="${hrefMatch[1]}"]`)})`, normalize: false }
  }
  // Snapshot ref（Tabbit 原生 aria-ref 定位器）。
  // 本仓的两种写法都要吃：工具面写的是 `ref=N`，快照侧习惯写 `@N`/`eN`。
  const refMatch = selector.match(/^(?:ref\s*=\s*|@\s*)?\s*(?:e\s*)?(\d+)$/i)
  if (refMatch) {
    return { expr: `page.locator("aria-ref=e${refMatch[1]}")`, normalize: true }
  }
  // Plain CSS selector (no loc= prefix)
  if (!selector.startsWith('@') && !selector.startsWith('loc=')) {
    return { expr: `page.locator(${JSON.stringify(selector)})`, normalize: false }
  }
  return null
}
