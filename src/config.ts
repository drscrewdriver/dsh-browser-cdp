import z from 'schemastery'
import type { CdpTarget, RawConfig, ResolvedConfig } from './types.ts'
import { sanitizeTargets } from './cdp-targets.ts'

const backend = z.union(['auto', 'cdp', 'ffmpeg'])
const profile = z.union(['low', 'balanced', 'high'])
const cdpMode = z.union(['auto', 'local', 'remote'])
const encoder = z.union([
  'auto', 'software', 'h264_mf', 'h264_nvenc', 'h264_qsv', 'h264_amf',
  'h264_videotoolbox', 'h264_vaapi',
])

// Defaults live in resolveConfig so a persisted legacy value is not hidden by
// a schema default before the one-release migration runs.
export const Config = z.object({
  isolateSpaces: z.boolean().description('Space isolation: false = persistent profile (keep logins across restarts); true = isolated sandbox.'),
  idleTimeoutMin: z.number().min(0).max(1440).step(1).description('Auto-stop the backing browser after N minutes without an bcdp_* call (0 = off). Relaunches on demand at the next call.'),
  chromePath: z.string().description('Path to Chrome/Chromium. Empty = auto-detect.'),
  captureBackend: backend.description('Capture backend: auto, cdp, or ffmpeg.'),
  streamProfile: profile.description('Capture quality profile.'),
  cdpFps: z.number().min(5).max(30).step(1).description('CDP preview FPS.'),
  cdpQuality: z.number().min(1).max(100).step(1).description('CDP JPEG quality.'),
  cdpMaxWidth: z.number().min(320).max(1920).step(40).description('CDP frame max width.'),
  cdpBackstopIntervalMs: z.number().min(1000).max(10000).step(100).description('CDP recovery screenshot interval.'),
  ffmpegFps: z.number().min(5).max(30).step(1).description('FFmpeg video FPS.'),
  ffmpegMaxWidth: z.number().min(320).max(1920).step(40).description('FFmpeg video max width.'),
  ffmpegBitrateKbps: z.number().min(500).max(20000).step(250).description('FFmpeg target video bitrate in kbps.'),
  ffmpegEncoder: encoder.description('FFmpeg H.264 encoder.'),
  ffmpegPath: z.string().description('Custom FFmpeg path. Empty = detect PATH or managed install.'),
  githubMirror: z.string().description('HTTPS base replacing https://github.com for managed downloads.'),
  // User-defined extra CLI args. Shell-like tokenize; mutually-exclusive
  // control flags are stripped (see EGO_CLI_BLOCKED / CHROME_BLOCKED below).
  runtimeArgs: z.string().description('Extra args appended to the vendored runtime argv. Takes effect on the next bcdp_* call.'),
  chromeArgs: z.string().description('Extra args appended to the Chrome launch argv. Takes effect on the next browser cold start (the browser is a singleton).'),
  // ── R1: CDP target sequence + activation ────────────────────────────────
  // `cdpTargets` is the ordered sequence; `activeTargetId` singles out one of
  // them. Probe fields ride along so the panel can paint a reachability badge
  // right after startup, before any probe round-trip has happened.
  cdpTargets: z.array(z.object({
    id: z.string(),
    label: z.string(),
    endpoint: z.string(),
    enabled: z.boolean(),
    note: z.string(),
    probeStatus: z.union(['unknown', 'ok', 'error']),
    probeLatencyMs: z.number(),
    probeError: z.string(),
    probeCode: z.string(),
    probeAt: z.number(),
  })).description('Ordered CDP target sequence. Only the ACTIVATED and enabled entry receives every bcdp_* call.'),
  activeTargetId: z.string().description('Id of the activated entry in cdpTargets. Empty = nothing activated.'),
  cdpMode: cdpMode.description('auto = use the activated target and never start a local browser silently; remote = only ever connect to the activated target; local = always use local browser control.'),
  cdpProbeTimeoutMs: z.number().min(200).max(30000).step(100).description('Timeout for one CDP endpoint probe (http endpoints answer /json/version).'),
  // ── R4: screenshot material ─────────────────────────────────────────────
  cursorHud: z.boolean().description('Draw the agent cursor HUD into screenshots.'),
  cursorName: z.string().description('Name label shown in the cursor HUD.'),
  // ── M0.9 local launcher knobs (declared now, launcher lands in T2.11+) ──
  allowLocalFallback: z.boolean().description('auto mode may fall back to launching a local browser when the activated target is unreachable. Off by default: the fallback must be explicit.'),
  legacyEgoToolNames: z.boolean().description('ALSO register the tools under their old ego_* names for scripts written before the bcdp_* rename. Off by default; mutually exclusive with installing the upstream ego-browser plugin (same tool names).'),
  localHeadless: z.boolean().description('Run the locally launched browser headless.'),
  remoteEnabled: z.boolean().description('Master switch for REMOTE attach. Off = the configured target sequence is preserved but inert (nothing probes or connects remotely); flip back on any time. Does not affect cdpMode=local.'),
  localUserDataDir: z.string().description('Profile dir for the locally launched browser. Empty = managed dir; never point at your daily Chrome profile.'),
  // Deprecated read-compatible keys. The settings UI only writes canonical keys.
  castFpsCap: z.number().min(0).max(60).step(1),
  screencastQuality: z.number().min(1).max(100).step(1),
  screencastMaxWidth: z.number().min(320).max(1920).step(40),
  backstopIntervalMs: z.number().min(200).max(10000).step(100),
})

// ── user-defined extra CLI args ─────────────────────────────────────────────
/**
 * Flags the user must NOT put in `runtimeArgs`: these runtime subcommands
 * exit before the heredoc runs (--status/--stop/--help/...) or steal the
 * browser window (--open), so appending them would break every bcdp_* tool.
 * `--headless` is managed by EGO_LINUX_HEADLESS; `--sdk-path` is allowed.
 */
export const EGO_CLI_BLOCKED = new Set<string>([
  '--status',
  '--stop',
  '--open',
  '--spaces',
  '--spaces-daemon',
  '--prune-spaces',
  '--import-chrome-profile',
  '--install-desktop-entry',
  '--help',
  '-h',
])

/**
 * Flags the user must NOT put in `chromeArgs`: these are managed by the
 * launcher / EGO_LINUX_PROXY and overriding them would break CDP control,
 * profile isolation, or the proxy bypass list. `--proxy-server` should go
 * through EGO_LINUX_PROXY (which also sets the bypass list).
 */
export const CHROME_BLOCKED = new Set<string>([
  '--user-data-dir',
  '--remote-debugging-port',
  '--remote-allow-origins',
  '--headless',
  '--no-startup-window',
  '--proxy-server',
  '--proxy-bypass-list',
])

/**
 * Shell-like tokenizer for user-supplied arg strings. Handles single/double
 * quotes and backslash escapes; bare whitespace separates tokens. Returns []
 * for empty/whitespace-only input. Used for both `runtimeArgs` and `chromeArgs`
 * (mirrored in runtime/ego-linux/src/chrome.mjs for the Chrome side, since the
 * runtime must not import from src/).
 */
export function tokenizeArgs(input: unknown): string[] {
  if (typeof input !== 'string') return []
  const out: string[] = []
  let cur = ''
  let i = 0
  let quote: string | null = null
  while (i < input.length) {
    const c = input[i]!
    if (quote) {
      if (c === '\\') {
        const next = input[i + 1]
        if (next !== undefined) {
          cur += next
          i += 2
          continue
        }
      } else if (c === quote) {
        quote = null
        i += 1
        continue
      }
      cur += c
      i += 1
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      i += 1
      continue
    }
    if (c === '\\') {
      const next = input[i + 1]
      if (next !== undefined) {
        cur += next
        i += 2
        continue
      }
      i += 1
      continue
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (cur !== '') {
        out.push(cur)
        cur = ''
      }
      i += 1
      continue
    }
    cur += c
    i += 1
  }
  if (cur !== '') out.push(cur)
  return out
}

/**
 * Split a raw arg string into tokens, dropping any token (and, for `--flag
 * value` pairs, its value) that appears in `blocked`. A "blocked" token with a
 * `=` attached (e.g. `--headless=new`) is also dropped. Returns the surviving
 * tokens. Exposed for tests and for the runtime to mirror.
 */
export function filterArgs(raw: string, blocked: Set<string>): string[] {
  const tokens = tokenizeArgs(raw)
  const kept: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!
    const key = tok.includes('=') ? tok.slice(0, tok.indexOf('=')) : tok
    if (blocked.has(key)) {
      // Drop a bare `--flag value` pair when the flag is blocklisted and the
      // next token does not itself look like a flag (i.e. it is the value).
      if (!tok.includes('=') && i + 1 < tokens.length && !tokens[i + 1]!.startsWith('-')) {
        i += 1
      }
      continue
    }
    kept.push(tok)
  }
  return kept
}

const finiteIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback
}

export function resolveConfig(config: RawConfig = {}): ResolvedConfig {
  const legacyFps = finiteIn(config.castFpsCap, 0, 60)
    ? (config.castFpsCap === 0 ? 20 : Math.max(5, Math.min(30, config.castFpsCap)))
    : 20
  const selectedProfile = oneOf(config.streamProfile, ['low', 'balanced', 'high'], 'balanced')
  const profileDefaults = selectedProfile === 'low'
    ? { fps: 15, width: 960, bitrateKbps: 2000 }
    : selectedProfile === 'high'
      ? { fps: 30, width: 1600, bitrateKbps: 8000 }
      : { fps: 20, width: 1280, bitrateKbps: 4000 }
  return {
    chromePath: typeof config.chromePath === 'string' ? config.chromePath : '',
    captureBackend: oneOf(config.captureBackend, ['auto', 'cdp', 'ffmpeg'], 'auto'),
    streamProfile: selectedProfile,
    cdpFps: finiteIn(config.cdpFps, 5, 30) ? config.cdpFps : legacyFps,
    cdpQuality: finiteIn(config.cdpQuality, 1, 100) ? config.cdpQuality : (finiteIn(config.screencastQuality, 1, 100) ? config.screencastQuality : 55),
    cdpMaxWidth: finiteIn(config.cdpMaxWidth, 320, 1920) ? config.cdpMaxWidth : (finiteIn(config.screencastMaxWidth, 320, 1920) ? config.screencastMaxWidth : 960),
    cdpBackstopIntervalMs: finiteIn(config.cdpBackstopIntervalMs, 1000, 10000) ? config.cdpBackstopIntervalMs : (finiteIn(config.backstopIntervalMs, 200, 10000) ? Math.max(1000, config.backstopIntervalMs) : 3000),
    ffmpegFps: finiteIn(config.ffmpegFps, 5, 30) ? config.ffmpegFps : profileDefaults.fps,
    ffmpegMaxWidth: finiteIn(config.ffmpegMaxWidth, 320, 1920) ? config.ffmpegMaxWidth : profileDefaults.width,
    ffmpegBitrateKbps: finiteIn(config.ffmpegBitrateKbps, 500, 20000) ? config.ffmpegBitrateKbps : profileDefaults.bitrateKbps,
    ffmpegEncoder: oneOf(config.ffmpegEncoder, ['auto', 'software', 'h264_mf', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox', 'h264_vaapi'], 'auto'),
    ffmpegPath: typeof config.ffmpegPath === 'string' ? config.ffmpegPath : '',
    githubMirror: typeof config.githubMirror === 'string' ? config.githubMirror : '',
    // User-defined extra args: stored raw (string), filtered at the call site
    // so a saved value is not silently mutated by a later blocklist change.
    // v0.12.0 rename: egoCliArgs -> runtimeArgs (read the old key one version back).
    runtimeArgs: typeof config.runtimeArgs === 'string'
      ? config.runtimeArgs
      : typeof (config as Record<string, unknown>).egoCliArgs === 'string'
        ? ((config as Record<string, unknown>).egoCliArgs as string)
        : '',
    chromeArgs: typeof config.chromeArgs === 'string' ? config.chromeArgs : '',
    isolateSpaces: typeof config.isolateSpaces === 'boolean' ? config.isolateSpaces : config.isolateSpaces === 'true' || config.isolateSpaces === '1' || config.isolateSpaces === 1,
    idleTimeoutMin: finiteIn(config.idleTimeoutMin, 0, 1440) ? config.idleTimeoutMin : 0,
    // CDP sequence: every entry is sanitized (bad endpoints dropped) and probe
    // state is normalized to defaults so a partially written row cannot leave
    // the panel rendering `undefined` badges.
    cdpTargets: sanitizeTargets(config.cdpTargets).map(normalizeProbeState),
    activeTargetId: typeof config.activeTargetId === 'string' ? config.activeTargetId : '',
    cdpMode: oneOf(config.cdpMode, ['auto', 'local', 'remote'], 'auto'),
    cdpProbeTimeoutMs: finiteIn(config.cdpProbeTimeoutMs, 200, 30000) ? config.cdpProbeTimeoutMs : 3000,
    cursorHud: config.cursorHud === undefined ? true : Boolean(config.cursorHud),
    cursorName: typeof config.cursorName === 'string' && config.cursorName.trim() !== '' ? config.cursorName : 'DeepSeek',
    allowLocalFallback: config.allowLocalFallback === undefined ? false : Boolean(config.allowLocalFallback),
    legacyEgoToolNames: Boolean(config.legacyEgoToolNames),
    localHeadless: config.localHeadless === undefined ? false : Boolean(config.localHeadless),
    localUserDataDir: typeof config.localUserDataDir === 'string' ? config.localUserDataDir : '',
    remoteEnabled: config.remoteEnabled === undefined ? true : Boolean(config.remoteEnabled),
  }
}

/**
 * Fill the per-target probe fields so downstream code (panel badge, doctor
 * output) can read them without a null-check ladder.
 */
export function normalizeProbeState(target: CdpTarget): CdpTarget {
  return {
    ...target,
    probeStatus: target.probeStatus === 'ok' || target.probeStatus === 'error' ? target.probeStatus : 'unknown',
    probeLatencyMs: typeof target.probeLatencyMs === 'number' && Number.isFinite(target.probeLatencyMs) ? target.probeLatencyMs : 0,
    probeError: typeof target.probeError === 'string' ? target.probeError : '',
    probeCode: typeof target.probeCode === 'string' ? target.probeCode : '',
    probeAt: typeof target.probeAt === 'number' && Number.isFinite(target.probeAt) ? target.probeAt : 0,
  }
}
