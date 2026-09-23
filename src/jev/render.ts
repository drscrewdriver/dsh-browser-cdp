/**
 * src/jev/render.ts — 阶段 10: drive `bin/cdp-render-worker.mjs` through the host.
 *
 * ── Why an adapter is needed at all ────────────────────────────────────────
 *
 * The host's `ctx.subprocess.spawn` takes a FIXED stdin string
 * (`stdio.stdin.data`) and hands back the collected output when the process
 * exits. The render worker speaks a line-based JSON-RPC session, which would
 * like a long-lived pipe. Two designs were available:
 *
 *   (a) Keep the session by spawning and holding many handles — but the host
 *       contract gives no way to write to stdin after spawn, so a session
 *       cannot be held that way.
 *   (b) Spawn the worker ONCE PER CALL, feeding it the connect step and the
 *       requested step as two stdin lines, then read the last reply line.
 *
 * This file does (b). The cost is real and is stated rather than hidden: each
 * call re-attaches to the page, so per-call latency includes `Target.getTargets`
 * + `attachToTarget` + the four `*.enable` calls. A long agent loop would want
 * the session form, which needs a spawn contract this host does not yet offer
 * (recorded as a follow-up in the plan, not worked around here).
 *
 * Why the worker script itself is unchanged: it already batches a script of
 * lines and exits when stdin closes, so it supports this shape without a
 * single-process daemon and without a second IPC mechanism.
 */

import type { SpawnSpec, SubprocessService } from '../types.ts'

/** The reply line the worker emits for a request id. */
interface WorkerReply {
  v: number
  id: number | null
  ok: boolean
  result?: unknown
  error?: { code: string; message: string }
}

export interface RenderCallTuning {
  /** Per-command CDP timeout inside the worker. */
  timeoutMs: number
  /** Host-side grace before the process is killed. */
  graceMs: number
  stdoutMaxBytes: number
  stderrMaxBytes: number
}

export const DEFAULT_RENDER_TUNING: RenderCallTuning = {
  timeoutMs: 15000,
  graceMs: 30000,
  // A base64 JPEG of 200 KiB is ~270 K characters on one line, so the stdout
  // ceiling has to clear an image with room to spare. Measured: the real page
  // produced 140,220 bytes -> ~187 K chars. 4 MiB leaves headroom for PNG.
  stdoutMaxBytes: 4 * 1024 * 1024,
  stderrMaxBytes: 64 * 1024,
}

export interface RenderCallOptions {
  /** Absolute path to the worker script. */
  workerPath: string
  /** `ws://…/devtools/browser/<id>` — the BROWSER-level endpoint. */
  wsUrl: string
  /** Which target the worker should prefer, when the caller knows it. */
  targetId?: string
  /** Extra JSON-RPC steps to run after `connect`, in order. */
  steps: { method: string; params?: Record<string, unknown> }[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  nodePath?: string
  tuning?: Partial<RenderCallTuning>
}

export interface RenderCallResult {
  /** The `connect` reply, or null when connecting failed. */
  connected: { targetId: string; targetUrl: string; sessionId: string } | null
  /** One entry per requested step. `ok:false` carries the worker's own message. */
  steps: { method: string; ok: boolean; result?: unknown; error?: string }[]
  /** Everything the worker logged on stderr — kept whether or not it succeeded. */
  log: string
  exitCode: number | null
}

/** `node` is assumed present: the worker is our own JS and the host runs Node. */
const defaultNodePath = (): string => process.execPath

/**
 * Build the stdin script: connect first, then each step, all as separate lines.
 *
 * `id` values are 1..N in emission order so the replies can be matched by id
 * rather than by position — a worker that logs an unsolicited line cannot shift
 * the mapping.
 */
export function buildWorkerScript(options: Pick<RenderCallOptions, 'wsUrl' | 'targetId' | 'steps'>): string {
  const lines: string[] = []
  lines.push(
    JSON.stringify({
      id: 1,
      method: 'connect',
      params: {
        wsUrl: options.wsUrl,
        ...(options.targetId === undefined || options.targetId === '' ? {} : { targetId: options.targetId }),
      },
    }),
  )
  options.steps.forEach((step, index) => {
    lines.push(JSON.stringify({ id: index + 2, method: step.method, params: step.params ?? {} }))
  })
  return `${lines.join('\n')}\n`
}

/**
 * Parse the worker's stdout into replies, keyed by id.
 *
 * Tolerant on purpose: a shebang banner, a stray log line, or a truncated final
 * line must not lose the replies that DID arrive. Unparsable lines are skipped;
 * a missing reply for a requested id surfaces as an explicit failure at the
 * call site instead of an `undefined` that reads like an empty result.
 */
export function parseWorkerReplies(stdout: string): Map<number, WorkerReply> {
  const replies = new Map<number, WorkerReply>()
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (line === '' || line[0] !== '{') continue
    let parsed: WorkerReply
    try {
      parsed = JSON.parse(line) as WorkerReply
    } catch {
      continue
    }
    if (typeof parsed.id === 'number') replies.set(parsed.id, parsed)
  }
  return replies
}

/**
 * Run one render call: spawn the worker, run connect + the steps, collect.
 *
 * Never throws for a worker-level failure. A failure is DATA here — the caller
 * decides whether a dead connection is fatal, and mixing "could not spawn" with
 * "the page had no candidates" into one exception path is how a retry loop ends
 * up retrying the wrong thing.
 */
export async function runRenderCall(
  subprocess: SubprocessService,
  options: RenderCallOptions,
): Promise<RenderCallResult> {
  const tuning = { ...DEFAULT_RENDER_TUNING, ...options.tuning }
  const spec: SpawnSpec = {
    argv: [options.nodePath ?? defaultNodePath(), options.workerPath],
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
    stdio: {
      stdin: { data: buildWorkerScript(options) },
      stdout: { maxBytes: tuning.stdoutMaxBytes },
      stderr: { maxBytes: tuning.stderrMaxBytes },
    },
    graceMs: tuning.graceMs,
  }

  const handle = subprocess.spawn(spec)
  const exit = await handle.done
  const stdout = readAll(handle.collected.stdout)
  const log = readAll(handle.collected.stderr)
  const replies = parseWorkerReplies(stdout)

  const connectReply = replies.get(1)
  const connected =
    connectReply !== undefined && connectReply.ok ? (connectReply.result as RenderCallResult['connected']) : null

  const steps = options.steps.map((step, index) => {
    const reply = replies.get(index + 2)
    if (reply === undefined) {
      return { method: step.method, ok: false, error: `the worker returned no reply for ${step.method}` }
    }
    return reply.ok
      ? { method: step.method, ok: true, result: reply.result }
      : { method: step.method, ok: false, error: reply.error?.message ?? 'unknown worker error' }
  })

  return { connected, steps, log, exitCode: exit.exitCode }
}

/** Read a collect reader from the start. Missing reader = empty, not an error. */
function readAll(reader: { readFrom(offset: number): { text: string } } | undefined): string {
  if (reader === undefined) return ''
  try {
    return reader.readFrom(0).text
  } catch {
    return ''
  }
}
