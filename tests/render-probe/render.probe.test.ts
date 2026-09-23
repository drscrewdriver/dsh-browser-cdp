/**
 * tests/render-probe/render.probe.test.ts — 阶段 10 探针：渲染预算 + DOM 同会话。
 *
 * GATED. The default `vitest run` must never start a browser or a worker:
 *
 *   BCDP_RENDER_PROBE=1 node node_modules/vitest/vitest.mjs run tests/render-probe/render.probe.test.ts
 *
 * WHAT THIS FIXTURE EXISTS TO ANSWER (and nothing else):
 *
 *  1. Does a JPEG of a real page fit a byte budget at a quality that is still
 *     legible? The client already renders a JPEG frame as an `<img>`; if a full
 *     page fits, the render path can hand back an IMAGE instead of a crop, which
 *     is the whole reason the chunk-count question (T8.5) matters.
 *  2. How much does PNG cost on the same page? That number decides whether PNG
 *     stays available or becomes an explicit opt-in.
 *  3. Can the interactive candidate count be gathered on the SAME connection as
 *     the capture, without a screenshot? That is what makes the "must I chunk?"
 *     decision free.
 *
 * It reads the launcher's own managed browser (M0.9) rather than starting one:
 * a probe must not add a second browser to the machine it is measuring.
 */

import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKER = fileURLToPath(new URL('../../bin/cdp-render-worker.mjs', import.meta.url))
const LAUNCHER_STATE = join(homedir(), '.dsh', 'cache', 'dsh-browser-cdp', 'launcher.json')

const enabled = process.env.BCDP_RENDER_PROBE === '1'
const log = (step: string, detail: string): void => {
  process.stdout.write(`  [render-probe] ${step.padEnd(26)} ${detail}\n`)
}

interface LauncherRecord { endpoint?: string; port?: number; pid?: number }

async function managedEndpoint(): Promise<string> {
  if (!existsSync(LAUNCHER_STATE)) return ''
  try {
    const parsed = JSON.parse(await readFile(LAUNCHER_STATE, 'utf8')) as LauncherRecord
    return typeof parsed.endpoint === 'string' ? parsed.endpoint : ''
  } catch { return '' }
}

/**
 * Where the browser under measurement comes from.
 *
 * Preference order is deliberate: `BCDP_RENDER_PROBE_URL` first (a probe must
 * be pointed at a KNOWN target), then the launcher's own managed instance, and
 * only then the vendored runtime's `browser.json`. The last one is the port's
 * state file — on this machine it exists as soon as a bcdp_* call has run.
 */
const STATE_DIR = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ego-lite-linux')

async function vendoredPortEndpoint(): Promise<number> {
  try {
    const parsed = JSON.parse(await readFile(join(STATE_DIR, 'browser.json'), 'utf8')) as { port?: number }
    return typeof parsed.port === 'number' ? parsed.port : 0
  } catch { return 0 }
}

async function probeTarget(): Promise<{ label: string; endpoint: string }> {
  const explicit = process.env.BCDP_RENDER_PROBE_URL ?? ''
  if (explicit !== '') return { label: 'env', endpoint: explicit }
  const managed = await managedEndpoint()
  if (managed !== '') return { label: 'launcher', endpoint: managed }
  const port = await vendoredPortEndpoint()
  if (port > 0) return { label: 'browser.json', endpoint: `http://127.0.0.1:${port}` }
  return { label: '', endpoint: '' }
}

/** Discover the ws URL through the same plain-HTTP path the plugin uses. */
async function discover(endpoint: string): Promise<string> {
  const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(3000) })
  if (!response.ok) throw new Error(`${endpoint}/json/version → HTTP ${response.status}`)
  const body = (await response.json()) as { webSocketDebuggerUrl?: string }
  if (!body.webSocketDebuggerUrl) throw new Error('no webSocketDebuggerUrl in /json/version')
  return body.webSocketDebuggerUrl
}

/** A tiny line-JSON client for the worker under test. */
function startWorker() {
  const child = spawn(process.execPath, [WORKER], { stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = ''
  const waiting = new Map<number, (value: { ok: boolean; result?: unknown; error?: { code: string; message: string } }) => void>()
  let nextId = 1
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
      if (line.trim() === '') continue
      try {
        const message = JSON.parse(line) as { id: number | null; ok: boolean }
        if (typeof message.id === 'number') waiting.get(message.id)?.(message as never)
      } catch { /* worker logs never reach stdout */ }
    }
  })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  const call = (method: string, params: Record<string, unknown> = {}) => {
    const id = nextId++
    return new Promise<{ ok: boolean; result?: unknown; error?: { code: string; message: string } }>((resolve) => {
      waiting.set(id, resolve)
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }
  return { child, call, stderrText: () => stderr }
}

describe.skipIf(!enabled)('阶段 10 render probe (managed browser)', () => {
  it('measures JPEG-in-budget, PNG cost, and the free interactive count', async () => {
    const { label, endpoint } = await probeTarget()
    if (endpoint === '') {
      log('skip', 'no probe target: set BCDP_RENDER_PROBE_URL, or run one bcdp_* call first')
      return
    }
    const wsUrl = await discover(endpoint)
    log('endpoint', `${endpoint} (from ${label}) → ${wsUrl}`)

    const worker = startWorker()
    try {
      const hello = await worker.call('hello')
      expect(hello.ok).toBe(true)
      log('worker', JSON.stringify(hello.result))

      const connected = await worker.call('connect', { wsUrl, timeoutMs: 8000 })
      if (!connected.ok) throw new Error(`connect failed: ${JSON.stringify(connected.error)}`)
      log('connect', 'ok')

      // ── the free question: how many interactive candidates are there? ─────
      const scanned = await worker.call('interactive', { limit: 40 })
      if (!scanned.ok) throw new Error(`interactive failed: ${JSON.stringify(scanned.error)}`)
      const candidates = (scanned.result as { candidates: unknown[] }).candidates
      log('interactive', `${candidates.length} candidate(s) at limit 40`)

      // ── the byte question: does a full-page JPEG fit? ────────────────────
      const budget = 1_048_576
      const jpeg = await worker.call('capture', {
        format: 'jpeg', quality: 72, maxBytes: budget, scale: { maxWidth: 1600 }, marks: true, limit: 20,
      })
      expect(jpeg.ok).toBe(true)
      const j = jpeg.result as { bytes: number; quality: number | null; overBudget: boolean; attempts: number; marks: unknown[]; pixelRatio: number }
      log('jpeg@72', `${j.bytes} B (${(j.bytes / 1024).toFixed(1)} KiB) overBudget=${j.overBudget} attempts=${j.attempts} q=${j.quality} marks=${j.marks.length} dpr=${j.pixelRatio}`)
      expect(j.bytes).toBeGreaterThan(1000)

      // ── the same page as PNG, for the cost comparison ────────────────────
      const png = await worker.call('capture', {
        format: 'png', maxBytes: 0, scale: { maxWidth: 2400 }, marks: false, limit: 20,
      })
      expect(png.ok).toBe(true)
      const p = png.result as { bytes: number }
      log('png', `${p.bytes} B (${(p.bytes / 1024).toFixed(1)} KiB) — ${(p.bytes / Math.max(1, j.bytes)).toFixed(2)}× the JPEG`)

      // ── budget honoured? ────────────────────────────────────────────────
      log('budget', j.overBudget
        ? `NOT met at floor quality (${j.bytes} B > ${budget} B) — the overrun is reported, not hidden`
        : `met at quality ${j.quality} after ${j.attempts} attempt(s)`)

      const ping = await worker.call('ping')
      expect(ping.ok).toBe(true)
      log('ping', JSON.stringify(ping.result))
    } finally {
      worker.child.kill('SIGTERM')
      log('worker stderr', worker.stderrText().trim().slice(0, 300) || '(empty)')
    }
  }, 120_000)
})
