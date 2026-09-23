/**
 * src/cdp/cli-link.ts — the LOCAL ego CLI link kind (R7).
 *
 * A `kind:'ego-cli'` link does NOT point the runtime at a CDP endpoint. It
 * hands browser ownership to the ego CLI itself, which is the only way to
 * reach the real ego-lite app: the `EGO_LINUX_CDP_URL` contract we inject for
 * `kind:'cdp'` belongs to the bundled Linux port, and the native macOS
 * `ego-browser` never reads it.
 *
 * Three things this module owns, all deliberately conservative because the
 * target binary varies by install:
 *
 *  1. RESOLUTION (four steps): explicit `cliPath` → `ego-browser` on PATH →
 *     the macOS app-bundle helper → the bundled Linux port. The app-bundle
 *     path is upstream's own macOS preference (its `real-browser-e2e` runner
 *     hardcodes it), but PATH wins here because that is what the install docs
 *     tell users to rely on.
 *  2. SPAWN SHAPE: probed, never guessed. The real macOS CLI is an executable
 *     inside the app bundle, while `ego-browser-v2` and our bundled port are
 *     JS files. A file-extension hint picks the first attempt; a shape-class
 *     spawn error (EACCES / ENOEXEC / ENOENT-after-exists) flips to the other.
 *  3. READINESS: an authoritative minimal-heredoc probe over the SAME channel
 *     work uses (`<cli> nodejs`). `--status` is opportunistic only — it is
 *     documented as a Linux-port command, so the native CLI may not know it,
 *     and an unknown option must degrade silently instead of failing the link.
 *
 * Every side effect is injectable; the fixtures never touch a real clock, a
 * real PATH, or a real process.
 */

import { existsSync } from 'node:fs'
import type { SpawnSpec, SubprocessService } from '../types.ts'

/** Where a resolved CLI came from — reported by the doctor and the panel. */
export type CliOrigin = 'explicit' | 'path' | 'app-bundle' | 'bundled'

/** How the CLI must be launched: directly, or through the node interpreter. */
export type SpawnShape = 'direct' | 'node'

/** Upstream's own macOS location for the real CLI (verbatim, from its e2e runner). */
export const MACOS_APP_BUNDLE_CLI =
  '/Applications/ego lite.app/Contents/Frameworks/ego Framework.framework/Versions/Current/Helpers/ego-browser'

/** The sentinel the readiness heredoc prints; its absence means "not usable". */
export const CLI_READY_SENTINEL = '__BCDP_CLI_READY__'

/** How long the opportunistic `--status` fast path may take before we ignore it. */
export const CLI_STATUS_TIMEOUT_MS = 2000

// ── io ─────────────────────────────────────────────────────────────────────

export interface CliRunRequest {
  argv: readonly string[]
  stdin: string
  timeoutMs: number
}

export interface CliRunResult {
  exitCode: number | null
  stdout: string
  stderr: string
  /** `ENOENT` / `EACCES` / `ENOEXEC` when the process could not be started. */
  spawnErrorCode?: string
  timedOut?: boolean
  latencyMs: number
}

/**
 * Every side effect the link kind needs. The real implementation goes through
 * `ctx.subprocess`; tests pass plain closures.
 */
export interface CliLinkIo {
  platform: NodeJS.Platform
  /** Does this exact path exist? */
  exists(path: string): boolean
  /** PATH lookup for a bare command name; '' when not found. */
  which(name: string): string
  run(request: CliRunRequest): Promise<CliRunResult>
  now(): number
}

/**
 * Build a PATH lookup that honours Windows' PATHEXT.
 *
 * The separator and the list delimiter follow the SIMULATED platform, not the
 * running one: `node:path`'s `join`/`delimiter` are host-dependent, so a
 * darwin/linux lookup running on Windows would otherwise build
 * `dir\ego-browser` and find nothing.
 */
export function makeWhich(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean,
): (name: string) => string {
  const isWin = platform === 'win32'
  const sep = isWin ? '\\' : '/'
  const dirs = (env.PATH ?? '').split(isWin ? ';' : ':').filter((dir) => dir !== '')
  const exts = isWin ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ext) => ext !== '') : ['']
  const joinFor = (dir: string, file: string): string => `${dir.replace(/[\\/]+$/, '')}${sep}${file}`
  return (name: string) => {
    if (name === '') return ''
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = joinFor(dir, name + ext)
        if (exists(candidate)) return candidate
      }
    }
    return ''
  }
}

// ── resolution ─────────────────────────────────────────────────────────────

export interface CliResolveInput {
  /** User-configured path; '' = auto-resolve. */
  cliPath?: string
  /** Our bundled port, used as the last resort. */
  bundled: string
}

export interface CliResolution {
  ok: boolean
  path: string
  origin: CliOrigin | ''
  code: '' | 'cli-not-found'
  message: string
}

/**
 * Resolve the CLI to launch. An explicit path that does not exist is an ERROR
 * rather than a silent skip to the next candidate — silently driving a
 * different browser than the one the user named would be worse than failing.
 */
export function resolveCliBinary(input: CliResolveInput, io: CliLinkIo): CliResolution {
  const explicit = (input.cliPath ?? '').trim()
  if (explicit !== '') {
    if (io.exists(explicit)) return { ok: true, path: explicit, origin: 'explicit', code: '', message: '' }
    return {
      ok: false,
      path: explicit,
      origin: '',
      code: 'cli-not-found',
      message: `the configured CLI path does not exist: ${explicit}`,
    }
  }
  const onPath = io.which('ego-browser')
  if (onPath !== '') return { ok: true, path: onPath, origin: 'path', code: '', message: '' }

  if (io.platform === 'darwin' && io.exists(MACOS_APP_BUNDLE_CLI)) {
    return { ok: true, path: MACOS_APP_BUNDLE_CLI, origin: 'app-bundle', code: '', message: '' }
  }
  if (input.bundled !== '' && io.exists(input.bundled)) {
    return { ok: true, path: input.bundled, origin: 'bundled', code: '', message: '' }
  }
  return {
    ok: false,
    path: '',
    origin: '',
    code: 'cli-not-found',
    message:
      'no ego CLI found: put `ego-browser` on PATH (ego lite onboarding does this), set cliPath, or keep the bundled runtime in place',
  }
}

/** File-extension hint for the FIRST spawn attempt. Never the final word. */
export function preferredShape(cliPath: string): SpawnShape {
  return /\.(mjs|cjs|js)$/i.test(cliPath) ? 'node' : 'direct'
}

/** argv for one shape. `rest` is appended after the shape's own prefix. */
export function spawnArgvFor(shape: SpawnShape, cliPath: string, rest: readonly string[]): string[] {
  // The bundled port is a plain .mjs with no +x bit, so it needs the node
  // prefix; the macOS app-bundle CLI is a real executable and must NOT get it
  // (node would try to parse a binary as JavaScript).
  return shape === 'node' ? [process.execPath, cliPath, ...rest] : [cliPath, ...rest]
}

/** A spawn failure that means "this shape is wrong", not "the CLI is broken". */
export function isShapeClassSpawnError(code: string | undefined): boolean {
  return code === 'EACCES' || code === 'ENOEXEC' || code === 'ENOENT'
}

// ── readiness probe ────────────────────────────────────────────────────────

export type CliProbeCode =
  | ''
  | 'cli-not-found'
  | 'cli-not-executable'
  | 'cli-probe-timeout'
  | 'cli-probe-failed'
  | 'cli-sdk-path-unsupported'

export interface CliProbeInput extends CliResolveInput {
  /** Pass `--sdk-path <bundledHarness>` so OUR patched harness runs. */
  useSdkPath?: boolean
  /** Absolute path of the harness bundle to inject; '' disables the flag. */
  sdkPath?: string
  /** Overall timeout for the authoritative heredoc probe. */
  timeoutMs?: number
}

export interface CliProbeResult {
  ok: boolean
  code: CliProbeCode
  message: string
  cliPath: string
  origin: CliOrigin | ''
  shape: SpawnShape | ''
  /** From `--status` when that fast path is supported and answered. */
  running?: boolean
  /** Non-fatal note, e.g. the SDK flag was refused and dropped. */
  warning?: string
  latencyMs: number
}

const DEFAULT_PROBE_TIMEOUT_MS = 20_000

function looksLikeUnknownSdkFlag(text: string): boolean {
  return /unknown option.*sdk-path|unrecognized option.*sdk-path|invalid option.*sdk-path/i.test(text)
}

/** Parse `--status` output. Loose on purpose: only the boolean `running` matters. */
export function parseCliStatus(stdout: string): { ok: true; running: boolean } | { ok: false } {
  const text = stdout.trim()
  if (text === '' || text[0] !== '{') return { ok: false }
  try {
    const parsed = JSON.parse(text) as { running?: unknown }
    if (typeof parsed.running !== 'boolean') return { ok: false }
    return { ok: true, running: parsed.running }
  } catch {
    return { ok: false }
  }
}

/**
 * Probe one link end to end: resolve → pick a working shape → (optionally)
 * read `--status` → confirm with a real heredoc round-trip.
 *
 * Failure codes are disjoint so the caller can print something actionable:
 *  - `cli-not-found`      nothing to launch
 *  - `cli-not-executable` both shapes refused to start it
 *  - `cli-probe-timeout`  the heredoc probe ran out of time
 *  - `cli-probe-failed`   it ran but did not reach our sentinel
 */
export async function probeCliLink(input: CliProbeInput, io: CliLinkIo): Promise<CliProbeResult> {
  const started = io.now()
  const resolve = resolveCliBinary(input, io)
  if (!resolve.ok) {
    return { ok: false, code: 'cli-not-found', message: resolve.message, cliPath: resolve.path, origin: '', shape: '', latencyMs: 0 }
  }
  const cliPath = resolve.path
  const timeoutMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : DEFAULT_PROBE_TIMEOUT_MS

  // ── shape + status in ONE round-trip ────────────────────────────────────
  // `--status` doubles as the shape probe: if the CLI starts at all, its
  // answer may also tell us whether its backing browser is up. Running it
  // twice would double the cost of every probe for no extra information.
  const hint = preferredShape(cliPath)
  const order: SpawnShape[] = hint === 'node' ? ['node', 'direct'] : ['direct', 'node']
  let shape: SpawnShape | '' = ''
  let lastShapeMessage = ''
  let statusRun: CliRunResult | undefined
  for (const candidate of order) {
    const attempt = await io.run({
      argv: spawnArgvFor(candidate, cliPath, ['--status']),
      stdin: '',
      timeoutMs: CLI_STATUS_TIMEOUT_MS,
    })
    if (attempt.spawnErrorCode === undefined || !isShapeClassSpawnError(attempt.spawnErrorCode)) {
      shape = candidate
      statusRun = attempt
      break
    }
    lastShapeMessage = `${candidate} spawn failed: ${attempt.spawnErrorCode}`
  }
  if (shape === '') {
    return {
      ok: false,
      code: 'cli-not-executable',
      message: `the ego CLI at ${cliPath} could not be started in either form (${lastShapeMessage})`,
      cliPath,
      origin: resolve.origin,
      shape: '',
      latencyMs: Math.max(0, io.now() - started),
    }
  }

  // ── opportunistic `--status` reading (may simply not exist on this CLI) ──
  let running: boolean | undefined
  if (statusRun && statusRun.exitCode === 0 && !statusRun.timedOut) {
    const parsed = parseCliStatus(statusRun.stdout)
    if (parsed.ok) running = parsed.running
  }

  // ── authoritative heredoc probe, over the same channel work uses ─────────
  const sdkArgs = input.useSdkPath === true && (input.sdkPath ?? '') !== '' ? ['--sdk-path', input.sdkPath as string] : []
  const script = `console.log(${JSON.stringify(CLI_READY_SENTINEL)})\n`
  const runHeredoc = (extra: readonly string[]): Promise<CliRunResult> =>
    io.run({
      argv: spawnArgvFor(shape as SpawnShape, cliPath, ['nodejs', ...extra]),
      stdin: script,
      timeoutMs,
    })

  let warning: string | undefined
  let result = await runHeredoc(sdkArgs)
  if (sdkArgs.length > 0 && looksLikeUnknownSdkFlag(result.stdout + result.stderr)) {
    // The flag is a capability, not a requirement: report it, drop it, retry
    // once. The user's intent to reach a browser still wins over the nicety of
    // running our own harness.
    warning = 'this ego CLI does not support --sdk-path; retried with the CLI\'s own harness'
    result = await runHeredoc([])
  }

  const latencyMs = Math.max(0, io.now() - started)
  const base = { cliPath, origin: resolve.origin, shape, latencyMs, ...(warning ? { warning } : {}), ...(running === undefined ? {} : { running }) }
  if (result.timedOut) {
    return { ok: false, code: 'cli-probe-timeout', message: `the ego CLI did not answer within ${timeoutMs}ms`, ...base }
  }
  if (result.spawnErrorCode !== undefined) {
    return { ok: false, code: 'cli-not-executable', message: `spawn failed: ${result.spawnErrorCode}`, ...base }
  }
  if (result.exitCode !== 0 || !result.stdout.includes(CLI_READY_SENTINEL)) {
    const tail = (result.stderr || result.stdout).trim().slice(-400)
    return {
      ok: false,
      code: 'cli-probe-failed',
      message: `the ego CLI ran but did not reach the readiness sentinel (exit ${String(result.exitCode)})${tail ? `: ${tail}` : ''}`,
      ...base,
    }
  }
  return { ok: true, code: '', message: '', ...base }
}

// ── real io ────────────────────────────────────────────────────────────────

function readAll(reader: { readFrom(offset: number): { text: string; nextOffset: number } } | undefined): string {
  if (!reader) return ''
  try {
    return reader.readFrom(0).text
  } catch {
    return ''
  }
}

/**
 * The production `CliLinkIo`: PATH lookup + `existsSync` here, process spawn
 * through the host's subprocess service.
 */
export function createSubprocessCliIo(subprocess: SubprocessService): CliLinkIo {
  return {
    platform: process.platform,
    exists: (path) => {
      try { return existsSync(path) } catch { return false }
    },
    which: makeWhich(process.platform, process.env, (path) => {
      try { return existsSync(path) } catch { return false }
    }),
    now: () => Date.now(),
    run: async (request) => {
      const startedAt = Date.now()
      const spec: SpawnSpec = {
        argv: [...request.argv],
        cwd: process.cwd(),
        stdio: {
          stdin: { data: request.stdin },
          stdout: { maxBytes: 64 * 1024 },
          stderr: { maxBytes: 64 * 1024 },
        },
        graceMs: request.timeoutMs,
      }
      try {
        const handle = subprocess.spawn(spec)
        let timedOut = false
        const timer = setTimeout(() => { timedOut = true }, request.timeoutMs)
        const outcome = await handle.done
        clearTimeout(timer)
        return {
          exitCode: outcome.exitCode,
          stdout: readAll(handle.collected.stdout),
          stderr: readAll(handle.collected.stderr),
          ...(timedOut ? { timedOut: true } : {}),
          latencyMs: Date.now() - startedAt,
        }
      } catch (err) {
        const code = (err as { code?: unknown })?.code
        return {
          exitCode: null,
          stdout: '',
          stderr: err instanceof Error ? err.message : String(err),
          ...(typeof code === 'string' ? { spawnErrorCode: code } : {}),
          latencyMs: Date.now() - startedAt,
        }
      }
    },
  }
}
