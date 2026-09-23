/**
 * ego-browser — shared host-side types.
 *
 * Self-contained structural types for the DSH host services the plugin uses
 * (tools / subprocess / settings / webServer). We deliberately do NOT import
 * from `@deepseek-ai/cordis` here: the ctx shape is matched structurally so
 * the package typechecks without a cordis install, mirroring the original
 * hand-written `lib/index.d.ts`.
 */

/** Result payload emitted by every bcdp_* tool (parsed from the sentinel line). */
export interface EgoResult {
  ok: boolean
  /** Free-form payload; tools put their structured data here. */
  [key: string]: unknown
}

/** Reader over a subprocess' collected stdout/stderr buffer. */
export interface CollectReader {
  readFrom(offset: number): { text: string; nextOffset: number; lossy: boolean; spillPath?: string }
}

/** Handle returned by `ctx.subprocess.spawn`. */
export interface SubprocessHandle {
  readonly done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
  readonly collected: { stdout?: CollectReader; stderr?: CollectReader }
}

/** Structural subset of the dsh-subprocess `SubprocessSpawnSpec`. */
export interface SpawnSpec {
  argv: readonly string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdio: {
    stdin: { data: string }
    stdout: { maxBytes: number; spill?: { maxBytes: number } }
    stderr: { maxBytes: number; spill?: { maxBytes: number } }
  }
  graceMs: number
  signal?: AbortSignal
}

export interface SubprocessService {
  spawn(spec: SpawnSpec): SubprocessHandle
}

export interface ToolExec {
  readonly callId: string
  readonly name: string
  readonly arguments: Readonly<Record<string, unknown>>
  readonly signal: AbortSignal
  readonly agent?: unknown
  readonly token?: unknown
}

export type ToolExecute = (args: Record<string, unknown>, exec: ToolExec) => Promise<unknown> | unknown

export interface ToolRegistrar {
  register(tool: unknown): unknown
}

export interface LoggerLike {
  /** cordis loggers are also callable with a scope name to get a child logger. */
  (id: string): LoggerLike | undefined
  info(message: unknown, ...args: unknown[]): void
  warn(message: unknown, ...args: unknown[]): void
  error(message: unknown, ...args: unknown[]): void
}

export interface RouteHandler {
  (req: unknown, res: unknown): void
}

export interface RegisterRouteOptions {
  kind: string
  path: string
  handler: (req: unknown, res: unknown) => void | Promise<void>
}

export interface WebServerLike {
  get?(path: string, handler: RouteHandler): unknown
  post?(path: string, handler: RouteHandler): unknown
  route?(path: string, handler: RouteHandler): unknown
  use?(path: string, handler: RouteHandler): unknown
  register?(opts: RegisterRouteOptions): () => void
}

export interface HttpServerLike {
  get?(path: string, handler: RouteHandler): unknown
  post?(path: string, handler: RouteHandler): unknown
  route?(path: string, handler: RouteHandler): unknown
  use?(path: string, handler: RouteHandler): unknown
  register?(opts: RegisterRouteOptions): () => void
}

export interface SettingsScope {
  get(): Record<string, unknown>
  watch(cb: () => void): () => void
}

export interface SettingsService {
  register(namespace: string, schema: unknown, opts?: { base?: Record<string, unknown> }): SettingsScope
  update?(namespace: string, patch: Record<string, unknown>): Promise<void>
}

/** Host context shape the plugin consumes (structural; not imported from cordis). */
export interface EgoContext {
  tools: ToolRegistrar
  subprocess: SubprocessService
  logger?: LoggerLike
  webServer?: WebServerLike
  httpServer?: HttpServerLike
  get?(name: string): unknown
  effect?(fn: () => unknown, label?: string): unknown
  inject?(services: readonly string[], fn: (sctx: EgoContext) => void): void
  on?(event: string, fn: (...args: unknown[]) => unknown): () => void
  settings?: SettingsService
  fiber?: { state?: number }
}

/**
 * R7 — the connection sequence is HETEROGENEOUS. Every entry is discriminated
 * by `kind`:
 *
 *  - `cdp`      a CDP endpoint the runtime is pointed at via EGO_LINUX_CDP_URL
 *  - `ego-cli`  the LOCAL ego CLI drives its own browser (no endpoint injected)
 *
 * `ego-cli` is local-only by definition, so at most ONE such entry may exist
 * (enforced in `sanitizeLinks` / `upsertLink` / the panel). Array order is the
 * priority order and is unchanged by this widening.
 */
export type BrowserLinkKind = 'cdp' | 'ego-cli'

/** Fields every sequence entry shares. */
export interface LinkBase {
  /** Stable id; never changes as the list is reordered. */
  id: string
  /** Display name; falls back to the endpoint / cliPath / kind default. */
  label: string
  /** Disabled entries stay in the sequence but can never be activated. */
  enabled: boolean
  note: string
  /** Probe results (written back so the panel can show them after a restart). */
  probeStatus?: 'unknown' | 'ok' | 'error'
  probeLatencyMs?: number
  probeError?: string
  probeCode?: string
  probeAt?: number
}

/** `kind: 'cdp'` — exactly what R1 shipped. */
export interface CdpLink extends LinkBase {
  kind: 'cdp'
  /** Exactly what the user typed: `http(s)://host:port` or `ws(s)://…`. */
  endpoint: string
}

/**
 * `kind: 'ego-cli'` — drive the LOCAL ego-lite browser through the ego CLI
 * itself, instead of pointing a runtime at a CDP endpoint.
 *
 * Activating this kind means `EGO_LINUX_CDP_URL` is NOT injected: the CLI owns
 * its browser. That env var is a property of the bundled Linux port only, so
 * the native macOS `ego-browser` (which drives the real ego-lite app) ignores
 * it — this kind is the only way to reach that browser.
 */
export interface EgoCliLink extends LinkBase {
  kind: 'ego-cli'
  /** '' = auto-resolve (host PATH → darwin app bundle → bundled runtime). */
  cliPath: string
  /** Opt-in: pass `--sdk-path <bundled harness>` so OUR patched harness runs. */
  useSdkPath?: boolean
}

/** One slot of the user's ordered connection sequence. */
export type BrowserLink = CdpLink | EgoCliLink

/** @deprecated R7 renamed this to `CdpLink`; kept so R1-era imports still resolve. */
export type CdpTarget = CdpLink

/** How the plugin decides which browser the bcdp_* tools drive. */
export type CdpMode = 'auto' | 'local' | 'remote'

/** Resolved (post-defaults) runtime config — the canonical key set. */
export interface ResolvedConfig {
  isolateSpaces: boolean
  /** Minutes without an bcdp_* call before the backing browser is auto-stopped. 0 = off. */
  idleTimeoutMin: number
  chromePath: string
  captureBackend: 'auto' | 'cdp' | 'ffmpeg'
  streamProfile: 'low' | 'balanced' | 'high'
  cdpFps: number
  cdpQuality: number
  cdpMaxWidth: number
  cdpBackstopIntervalMs: number
  ffmpegFps: number
  ffmpegMaxWidth: number
  ffmpegBitrateKbps: number
  ffmpegEncoder: 'auto' | 'software' | 'h264_mf' | 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'h264_videotoolbox' | 'h264_vaapi'
  ffmpegPath: string
  githubMirror: string
  runtimeArgs: string
  remoteEnabled: boolean
  legacyEgoToolNames: boolean
  chromeArgs: string
  // ── R1/R7: connection sequence + activation ─────────────────────────────
  /**
   * Ordered connection sequence; index order IS the priority order. R7 widened
   * the element type to `BrowserLink` (cdp | ego-cli); the legacy `cdpTargets`
   * key is read one version back and always yields `kind='cdp'` entries.
   */
  links: BrowserLink[]
  /** Id of the single activated entry; '' = nothing activated. */
  activeTargetId: string
  cdpMode: CdpMode
  cdpProbeTimeoutMs: number
  // ── R4: screenshot material toggles ─────────────────────────────────────
  cursorHud: boolean
  cursorName: string
  // ── M0.9 local launcher (optional; see design-cdp-local-launch.md) ──────
  allowLocalFallback: boolean
  localHeadless: boolean
  localUserDataDir: string
}

/** Raw composition-layer config (may contain legacy / extra keys). */
export interface RawConfig extends Partial<ResolvedConfig> {
  /** R1 key, superseded by `links` in R7 (read one version back). */
  cdpTargets?: unknown
  castFpsCap?: number
  screencastQuality?: number
  screencastMaxWidth?: number
  backstopIntervalMs?: number
  [key: string]: unknown
}
