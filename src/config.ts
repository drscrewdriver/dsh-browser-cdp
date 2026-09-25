import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cosmokit'
import type { JudgeSettings, LinkBase, RawConfig, ResolvedConfig } from './types.ts'
import { sanitizeLinks } from './cdp-targets.ts'

// ── 0.1.7 declarative settings ──────────────────────────────────────────────
// DSH 0.1.7 removed the imperative settings registration (`ctx.settings`
// section APIs). The Config schema itself IS the settings form now: only the
// fields marked `.volatile()` are projected into the auto-generated settings
// page (composition-only fields stay editable via the profile patch), and a
// volatile-only change is delivered to the running plugin as a live ref
// update plus one `loader/volatile-update` event instead of a remount.
//
// Volatile set below == exactly the fields the former client settings card
// exposed for editing. Hard red lines (schemastery 3.18.4+): `.volatile()`
// only on a fixed object path — never inside a union/lazy/transform branch or
// an enclosing volatile value; the whole `links` array is wrapped, not its
// rows. `.volatile()` does not exist before 3.18.4, so this build targets
// DSH 0.1.7-rc.1+ only.

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
  isolateSpaces: z.boolean().description('Space isolation: false = persistent profile (keep logins across restarts); true = isolated sandbox.').volatile(),
  idleTimeoutMin: z.number().min(0).max(1440).step(1).description('Auto-stop the backing browser after N minutes without an bcdp_* call (0 = off). Relaunches on demand at the next call.').volatile(),
  chromePath: z.string().description('Path to Chrome/Chromium. Empty = auto-detect.').volatile(),
  captureBackend: backend.description('Capture backend: auto, cdp, or ffmpeg.').volatile(),
  streamProfile: profile.description('Capture quality profile.').volatile(),
  cdpFps: z.number().min(5).max(30).step(1).description('CDP preview FPS.').volatile(),
  cdpQuality: z.number().min(1).max(100).step(1).description('CDP JPEG quality.').volatile(),
  cdpMaxWidth: z.number().min(320).max(1920).step(40).description('CDP frame max width.').volatile(),
  cdpBackstopIntervalMs: z.number().min(1000).max(10000).step(100).description('CDP recovery screenshot interval.').volatile(),
  ffmpegFps: z.number().min(5).max(30).step(1).description('FFmpeg video FPS.').volatile(),
  ffmpegMaxWidth: z.number().min(320).max(1920).step(40).description('FFmpeg video max width.').volatile(),
  ffmpegBitrateKbps: z.number().min(500).max(20000).step(250).description('FFmpeg target video bitrate in kbps.').volatile(),
  ffmpegEncoder: encoder.description('FFmpeg H.264 encoder.').volatile(),
  ffmpegPath: z.string().description('Custom FFmpeg path. Empty = detect PATH or managed install.').volatile(),
  githubMirror: z.string().description('HTTPS base replacing https://github.com for managed downloads.').volatile(),
  // User-defined extra CLI args. Shell-like tokenize; mutually-exclusive
  // control flags are stripped (see EGO_CLI_BLOCKED / CHROME_BLOCKED below).
  runtimeArgs: z.string().description('Extra args appended to the vendored runtime argv. Takes effect on the next bcdp_* call.').volatile(),
  chromeArgs: z.string().description('Extra args appended to the Chrome launch argv. Takes effect on the next browser cold start (the browser is a singleton).').volatile(),
  // ── R1/R7: connection sequence + activation ─────────────────────────────
  // `links` is the ordered sequence (priority order); `activeTargetId` singles
  // out one of them. Probe fields ride along so the panel can paint a
  // reachability badge right after startup, before any probe round-trip.
  //
  // R7 widened the element type: `kind:'cdp'` (an endpoint) or `kind:'ego-cli'`
  // (the local CLI drives its own browser; at most one per machine). The schema
  // stays PERMISSIVE on purpose — a pre-R7 row has no `kind` at all and must
  // still validate, because `coerceLink()` is the real gate (it defaults a
  // missing kind to `cdp` and drops anything unusable).
  // The WHOLE array is marked volatile (the only supported array form — row
  // level refs are rejected by schemastery).
  links: z.array(z.union([
    z.object({
      kind: z.string(),
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
    }),
    z.object({
      kind: z.string(),
      id: z.string(),
      label: z.string(),
      cliPath: z.string(),
      useSdkPath: z.boolean(),
      enabled: z.boolean(),
      note: z.string(),
      probeStatus: z.union(['unknown', 'ok', 'error']),
      probeLatencyMs: z.number(),
      probeError: z.string(),
      probeCode: z.string(),
      probeAt: z.number(),
    }),
  ])).description('Ordered connection sequence: CDP endpoints and (at most one) local ego CLI link. Only the ACTIVATED and enabled entry receives every bcdp_* call. Order IS the priority order.').volatile(),
  activeTargetId: z.string().description('Id of the activated entry in links. Empty = nothing activated.').volatile(),
  cdpMode: cdpMode.description('auto = use the activated target and never start a local browser silently; remote = only ever connect to the activated target; local = always use local browser control.').volatile(),
  cdpProbeTimeoutMs: z.number().min(200).max(30000).step(100).description('Timeout for one CDP endpoint probe (http endpoints answer /json/version).'),
  // ── R4: screenshot material ─────────────────────────────────────────────
  cursorHud: z.boolean().description('Draw the agent cursor HUD into screenshots.'),
  cursorName: z.string().description('Name label shown in the cursor HUD.'),
  // ── M0.9 local launcher knobs (declared now, launcher lands in T2.11+) ──
  allowLocalFallback: z.boolean().description('auto mode may fall back to launching a local browser when the activated target is unreachable. Off by default: the fallback must be explicit.'),
  legacyEgoToolNames: z.boolean().description('ALSO register the tools under their old ego_* names for scripts written before the bcdp_* rename. Off by default; mutually exclusive with installing the upstream ego-browser plugin (same tool names).'),
  localHeadless: z.boolean().description('Run the locally launched browser headless.'),
  remoteEnabled: z.boolean().description('Master switch for REMOTE attach. Off = the configured target sequence is preserved but inert (nothing probes or connects remotely); flip back on any time. Does not affect cdpMode=local.').volatile(),
  localUserDataDir: z.string().description('Profile dir for the locally launched browser. Empty = managed dir; never point at your daily Chrome profile.'),
  // Deprecated read-compatible keys. The settings UI only writes canonical keys.
  castFpsCap: z.number().min(0).max(60).step(1),
  screencastQuality: z.number().min(1).max(100).step(1),
  screencastMaxWidth: z.number().min(320).max(1920).step(40),
  backstopIntervalMs: z.number().min(200).max(10000).step(100),
  // ── 阶段 10: JEV/Laya judge (design-jev-pipeline.md) ────────────────────
  //
  // Split into two independent services rather than one `judgeUrl`: a user may
  // have jev, laya, both, or neither, and the chain must be able to skip a hop
  // it cannot use. The key fields are separate for the same reason — laya-api
  // rejects an absent key outright, so "no key" is a SKIP, not a degraded call.
  jevUrl: z.string().description('JEV judge base URL, no path. Leave EMPTY: JEV cannot currently be registered, so the hop would only ever be skipped. Add it (and jev to the hop order) when registration opens.').volatile(),
  jevKey: z.string().description('Bearer key for the JEV judge. Empty = the jev hop is skipped (never sent, so no 401 round trip).').volatile(),
  jevModel: z.string().description('Model name sent in the request body.').volatile(),
  layaUrl: z.string().description('Laya judge base URL. The sidecar serves 8000; 7789 is a different tool and will not answer.').volatile(),
  layaKey: z.string().description('Bearer key for the Laya judge. REQUIRED: laya-api has no anonymous branch, so a keyless call is a guaranteed 401.').volatile(),
  layaModel: z.string().description('Model name sent to the Laya judge.').volatile(),
  judgePrefer: z.string().description('Judgement hop order, comma separated. Defaults to "laya,rule" because JEV cannot currently be registered. Unknown names are dropped; the terminal refusal hop cannot be removed.').volatile(),
  jevChunkSize: z.number().min(1).max(255).step(1).description('Candidate ceiling per judgement round. Bound to the probability threshold bucket, so raising it also tightens the gate.').volatile(),
  jevMaxImageBytes: z.number().min(0).step(1024).description('Frame byte budget. 0 = unbounded, which is the measured default: a full-page JPEG was 137 KiB, so chunking for bytes alone slices static pages for nothing.').volatile(),
  jevHistoryLimit: z.number().min(0).max(20).step(1).description('How many recent steps the judge is shown. Recency beats completeness in a loop.').volatile(),
  jevArchiveImage: z.boolean().description('Embed the base64 screenshot in the archived Laya bundle. Off by default: a bundle that always carries hundreds of KiB is a bundle nobody keeps.').volatile(),
  jevEvaluate: z.boolean().description('After every action, ask the judge whether the step actually advanced: inprogress / done / fail. inprogress continues silently; done is checked against successCriteria; fail hands back to the model for recovery (reload, re-capture, ...). Costs one judgement call per action.').volatile(),
  jevStepBudget: z.number().min(1).max(200).step(1).description('Judgement rounds allowed in one bcdp_jev_run before it stops as exhausted.').volatile(),
  jevWallMs: z.number().min(1000).max(3600000).step(1000).description('Wall-clock ceiling for one bcdp_jev_run, in ms.').volatile(),
})

// ── 0.1.7 volatile live refs ────────────────────────────────────────────────
/**
 * Structural shape of a live volatile config reference (cosmokit
 * `createVolatile`): the loader hands `apply()` one of these for every
 * `.volatile()` Config field, and `.get()` returns the current immutable
 * snapshot. Never cache the ref's value across operations — keep the ref and
 * re-read, or capture a fresh snapshot per operation.
 */
export type VolatileRef<T = unknown> = Volatile<T>

/** True when the value is a live volatile reference rather than plain data. */
export function isVolatileRef(value: unknown): value is VolatileRef {
  return typeof value === 'object' && value !== null && typeof (value as VolatileRef).get === 'function'
}

/**
 * Shallow-copy a raw config entry, replacing every live volatile reference
 * with its current snapshot. 0.1.7 delivers volatile-only changes as ref
 * updates (no plugin remount), so every read path must deref before the
 * plain-value `typeof` gates in `resolveConfig` can see real data.
 */
export function derefVolatileConfig(config: RawConfig): RawConfig {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    out[key] = isVolatileRef(value) ? value.get() : value
  }
  return out as RawConfig
}

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

const finiteIn = (value: unknown, min: number, max: number): value is number =>  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * A non-string (undefined, null, a number from a hand-edited row) becomes ''.
 *
 * Trimmed as well, because these values come from a settings panel that a user
 * pastes URLs into, and `" http://…"` is a URL that fails to parse while looking
 * perfectly fine in the field.
 */
const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * Pick out the judge-facing settings.
 *
 * `prefer` is passed through UNFILTERED on purpose, matching how `runtimeArgs`
 * is handled: a saved preference is stored raw and filtered at the call site, so
 * a later change to the legal hop list cannot retroactively mangle what the user
 * typed. The filtering (and the rule that the terminal refusal hop cannot be
 * removed) lives in `src/jev/client.ts`, where it is unit-tested.
 */
export function judgeSettingsOf(config: ResolvedConfig): JudgeSettings {
  return {
    jevUrl: config.jevUrl,
    jevKey: config.jevKey,
    jevModel: config.jevModel,
    layaUrl: config.layaUrl,
    layaKey: config.layaKey,
    layaModel: config.layaModel,
    prefer: config.judgePrefer,
    chunkSize: config.jevChunkSize,
    maxImageBytes: config.jevMaxImageBytes,
    historyLimit: config.jevHistoryLimit,
    archiveImage: config.jevArchiveImage,
    evaluate: config.jevEvaluate,
    stepBudget: config.jevStepBudget,
    wallMs: config.jevWallMs,
  }
}

export function resolveConfig(config: RawConfig = {}): ResolvedConfig {
  // 0.1.7: volatile fields arrive as live refs in the composition entry —
  // deref them once here so the whole resolution below sees plain data.
  config = derefVolatileConfig(config)
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
    // Connection sequence (R1/R7): every entry is sanitized (unusable rows
    // dropped, the ego-cli singleton enforced) and probe state normalized so a
    // partially written row cannot leave the panel rendering `undefined`.
    //
    // v0.17.0 rename: cdpTargets -> links. The old key is read one version back
    // and its rows are indistinguishable from `kind:'cdp'` links, which is
    // exactly what coerceLink() defaults them to.
    links: sanitizeLinks(
      config.links ?? (config as Record<string, unknown>).cdpTargets,
    ).links.map(normalizeProbeState),
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
    // ── 阶段 10: JEV/Laya judge ───────────────────────────────────────────
    // `layaUrl` defaults to the sidecar's real port. JevLoop ships 7789 here,
    // which is a DIFFERENT tool's port — copying that default produces a
    // connection error that reads like "laya is down".
    jevUrl: trimmed(config.jevUrl),
    jevKey: trimmed(config.jevKey),
    jevModel: trimmed(config.jevModel) === '' ? 'jev' : trimmed(config.jevModel),
    layaUrl: trimmed(config.layaUrl) === '' ? 'http://127.0.0.1:8000' : trimmed(config.layaUrl),
    layaKey: trimmed(config.layaKey),
    layaModel: trimmed(config.layaModel) === '' ? 'laya' : trimmed(config.layaModel),
    // LAYA FIRST, and jev not named at all.
    //
    // JEV cannot be registered at the moment, so making it the first hop means
    // every run spends a skipped hop's worth of reasoning on a service nobody
    // can sign up for. `laya,rule` is the chain that actually works today;
    // re-adding `jev` to this string is the whole opt-in once it is available.
    judgePrefer: trimmed(config.judgePrefer) === '' ? 'laya,rule' : trimmed(config.judgePrefer),
    jevChunkSize: finiteIn(config.jevChunkSize, 1, 255) ? config.jevChunkSize : 20,
    // 0 = unbounded is the DEFAULT, not a fallback: A.9 measured 136.9 KiB for a
    // real full page against any sane budget, so a byte budget that nobody asked
    // for would slice static pages for nothing.
    jevMaxImageBytes: finiteIn(config.jevMaxImageBytes, 0, 512 * 1024 * 1024) ? config.jevMaxImageBytes : 0,
    jevHistoryLimit: finiteIn(config.jevHistoryLimit, 0, 20) ? config.jevHistoryLimit : 5,
    jevArchiveImage: config.jevArchiveImage === undefined ? false : Boolean(config.jevArchiveImage),
    // ON by default, and the cost is stated rather than hidden: one extra
    // judgement call per action. Without it the loop can only notice failure
    // indirectly (an action error, or a run of unclear answers), which misses
    // the most common case of all — the action succeeded and changed nothing.
    jevEvaluate: config.jevEvaluate === undefined ? true : Boolean(config.jevEvaluate),
    jevStepBudget: finiteIn(config.jevStepBudget, 1, 200) ? config.jevStepBudget : 20,
    jevWallMs: finiteIn(config.jevWallMs, 1000, 3600000) ? config.jevWallMs : 120_000,
  }
}

/**
 * Fill the per-link probe fields so downstream code (panel badge, doctor
 * output) can read them without a null-check ladder. Generic over the link
 * union so the discriminating `kind` (and every kind-specific field) survives.
 */
export function normalizeProbeState<T extends LinkBase>(link: T): T {
  return {
    ...link,
    probeStatus: link.probeStatus === 'ok' || link.probeStatus === 'error' ? link.probeStatus : 'unknown',
    probeLatencyMs: typeof link.probeLatencyMs === 'number' && Number.isFinite(link.probeLatencyMs) ? link.probeLatencyMs : 0,
    probeError: typeof link.probeError === 'string' ? link.probeError : '',
    probeCode: typeof link.probeCode === 'string' ? link.probeCode : '',
    probeAt: typeof link.probeAt === 'number' && Number.isFinite(link.probeAt) ? link.probeAt : 0,
  }
}
