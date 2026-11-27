/**
 * src/cdp/launcher.ts — M0.9 local browser launcher (stage 2b, T2.12–T2.15).
 *
 * Launches a locally installed Chrome/Chromium with an explicit debugging
 * port and a MANAGED profile directory, records the instance in
 * `launcher.json`, and reuses only instances it started itself (T2.13).
 * Everything side-effecting (fs / process / network / clock) is injectable,
 * so the unit tests run without a real Chrome (T2.17 fixtures).
 *
 * Design notes:
 * - The port is allocated up front with `net` (listen(0) → close → reuse),
 *   NOT `--remote-debugging-port=0` + DevToolsActivePort: T2.11 left the
 *   port-file mechanism unverified on Windows, and the design's documented
 *   fallback is an explicit port (design-cdp-local-launch.md §9).
 * - Stop is kill-tree (taskkill /T /F on win32): Browser.close needs a WS
 *   client in the host process where global WebSocket is not guaranteed.
 *   A short grace poll reports the process is really gone (T2.14).
 * - No reverse fallback: `local` mode failures never reach out to a remote
 *   endpoint, and vice versa (T2.16).
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ── injectable IO ───────────────────────────────────────────────────────────

export interface LaunchIo {
  exists?: (path: string) => boolean
  readFile?: (path: string) => string
  writeFile?: (path: string, data: string) => void
  removeFile?: (path: string) => void
  isAlive?: (pid: number) => boolean
  killTree?: (pid: number) => void
  spawn?: (bin: string, args: readonly string[], env?: Record<string, string>) => { pid: number }
  fetchVersion?: (url: string) => Promise<{ ok: boolean }>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  makePort?: () => Promise<number>
  /** Effective UID of the current process. Injectable so the root/no-sandbox
   *  path (issue #22 M-A) is testable without actually being root. */
  euid?: () => number
  /** Environment snapshot. Injectable so the headless fallback (issue #22 M-B)
   *  is testable without touching the real process env. */
  env?: () => Record<string, string | undefined>
}

const defaultIo = (): Required<LaunchIo> => ({
  exists: (path) => existsSync(path),
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, data) => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, data, 'utf8')
  },
  removeFile: (path) => {
    try { rmSync(path) } catch { /* already gone */ }
  },
  isAlive: (pid) => {
    try { process.kill(pid, 0); return true } catch { return false }
  },
  killTree: (pid) => {
    if (process.platform === 'win32') {
      // taskkill with /T takes the whole Chrome child tree down (T2.14 ②).
      try { nodeSpawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* best-effort */ }
      return
    }
    try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
  },
  spawn: (bin, args, env) => {
    const child: ChildProcess = nodeSpawn(bin, args, {
      detached: true,
      stdio: 'ignore',
      ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    })
    child.unref()
    return { pid: child.pid ?? 0 }
  },
  fetchVersion: async (url) => {
    const res = await fetch(url)
    return { ok: res.ok }
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  euid: () => (typeof process.geteuid === 'function' ? process.geteuid() : -1),
  env: () => process.env,
  makePort: async () => {
    const server = createServer()
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('no port'))
      })
    })
    server.close()
    return port
  },
})

// ── binary discovery (T2.12) ────────────────────────────────────────────────

/**
 * Env-var-driven probe of the usual Windows install dirs — the ONE canonical
 * list, consumed by both the launcher (`discoverChromeBinary`) and the
 * doctor's `windowsChromeCandidates()` in index.ts, so the two can never
 * drift again. Issue #19: the launcher's hardcoded list only knew 64-bit
 * Edge, so a machine with just the 32-bit Edge (`Program Files (x86)`) got
 * "No Chrome/Chromium/Edge binary found" while `bcdp_doctor` happily
 * reported the very same binary.
 *
 * Issue #19 family, second pass: the same doctor-vs-launcher drift existed on
 * the other two platforms — the launcher knew exactly one macOS bundle
 * (Google Chrome in /Applications) and four fixed /usr/bin paths, while the
 * doctor probed Chromium/Edge/Brave bundles, `~/Applications`, bare PATH
 * names and /opt. The canonical darwin/posix lists now live HERE and the
 * doctor delegates, so "installed" means the same thing to both again.
 */
export function windowsEnvChromeCandidates(env: Record<string, string | undefined>): string[] {
  const pf = env.ProgramFiles
  const pfx86 = env['ProgramFiles(x86)']
  const local = env.LOCALAPPDATA
  const base = local || `${env.USERPROFILE || env.HOME || ''}\\AppData\\Local`
  const b = (p: string | undefined): string | undefined => (p ? p.replace(/\\+$/, '') : p)
  return [
    b(pf) + '\\Google\\Chrome\\Application\\chrome.exe',
    b(pfx86) + '\\Google\\Chrome\\Application\\chrome.exe',
    b(local) + '\\Google\\Chrome\\Application\\chrome.exe',
    b(pf) + '\\Microsoft\\Edge\\Application\\msedge.exe',
    b(pfx86) + '\\Microsoft\\Edge\\Application\\msedge.exe',
    b(local) + '\\Microsoft\\Edge\\Application\\msedge.exe',
    b(pfx86) + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    b(local) + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ].filter(Boolean) as string[]
}

/** Last-resort absolute paths for machines with a mangled environment. */
const WIN32_FALLBACK_CANDIDATES: readonly string[] = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]

/**
 * macOS Chrome-family `.app` bundles the doctor has always probed — Chrome
 * on macOS is never on PATH: the binary lives inside the bundle at
 * `<App>.app/Contents/MacOS/<binary>`. Canonical here so the launcher finds
 * the same installs the doctor reports (issue #19 family).
 */
export const DARWIN_CHROME_BUNDLES: readonly string[] = [
  'Google Chrome.app/Contents/MacOS/Google Chrome',
  'Chromium.app/Contents/MacOS/Chromium',
  'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'Brave Browser.app/Contents/MacOS/Brave Browser',
  'Tungsten Edge.app/Contents/MacOS/Tungsten Edge',
]

/** System-wide first, then per-user `/Applications` (matches the README). */
export function darwinChromeCandidates(env: Record<string, string | undefined> = process.env): string[] {
  const roots = ['/Applications']
  if (env.HOME) roots.push(`${env.HOME}/Applications`)
  const out: string[] = []
  for (const root of roots) {
    for (const bundle of DARWIN_CHROME_BUNDLES) {
      out.push(`${root}/${bundle}`)
    }
  }
  return out
}

/**
 * POSIX Chrome-family binaries — bare names are expanded over `PATH`
 * (name-major, so `google-chrome-stable` anywhere on PATH beats `google-chrome`
 * in the first dir, exactly the doctor's old walk), interleaved with the fixed
 * absolute locations. Canonical here so the launcher and the doctor agree.
 */
export const POSIX_CHROME_BINS: readonly string[] = [
  'google-chrome-stable',
  'google-chrome',
  'chromium',
  'chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/google-chrome',
]

export function posixChromeCandidates(env: Record<string, string | undefined> = process.env): string[] {
  const dirs = (env.PATH ?? '').split(':').filter(Boolean)
  const out: string[] = []
  for (const name of POSIX_CHROME_BINS) {
    if (name.includes('/')) {
      out.push(name)
      continue
    }
    for (const dir of dirs) out.push(`${dir}/${name}`)
  }
  return out
}

export function discoverChromeBinary(
  explicit: string,
  platform: string,
  exists: (path: string) => boolean,
  env: Record<string, string | undefined> = process.env,
): string {
  if (explicit !== '') return exists(explicit) ? explicit : ''
  const candidates = platform === 'win32'
    ? [...windowsEnvChromeCandidates(env), ...WIN32_FALLBACK_CANDIDATES]
    : platform === 'darwin'
      ? darwinChromeCandidates(env)
      : posixChromeCandidates(env)
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }
  return ''
}

// ── args assembly (T2.12) ───────────────────────────────────────────────────

/** Flags the user must never smuggle into the managed launch. */
const BLOCKED_ARGS = [
  '--user-data-dir', '--remote-debugging-port', '--remote-allow-origins',
  '--no-startup-window', '--proxy-server', '--headless',
]

export function buildLaunchArgs(options: {
  userDataDir: string
  port: number
  headless: boolean
  chromeArgs?: string
  /**
   * Issue #22 M-A: append `--no-sandbox`. Set when the local browser runs as
   * root (Linux containers / CI images), where Chromium refuses to start
   * without it ("Running as root without --no-sandbox is not supported").
   */
  addNoSandbox?: boolean
}): string[] {
  const userArgs = (options.chromeArgs ?? '')
    .split(/\s+/)
    .map((arg) => arg.trim())
    .filter((arg) => arg !== '')
    .filter((arg) => !BLOCKED_ARGS.some((blocked) => arg === blocked || arg.startsWith(`${blocked}=`) || arg.startsWith(`${blocked} `)))
  // Issue #22 M-A: `--no-sandbox` goes right before the headless flag, and is
  // de-duplicated against a user-supplied copy — the user may already put
  // `--no-sandbox` in chromeArgs, and Chromium would see it twice.
  const wantsNoSandbox = options.addNoSandbox === true
  const isNoSandbox = (arg: string) => arg === '--no-sandbox' || arg === '--no-sandbox=true'
  const userHasNoSandbox = userArgs.some(isNoSandbox)
  // Keep exactly one copy: if the user already wrote it, THEIR token survives
  // (argv stays what they wrote); we only fill it in when it is missing.
  let dedupedUserArgs = userArgs
  if (userHasNoSandbox) {
    let kept = false
    dedupedUserArgs = userArgs.filter((arg) => {
      if (!isNoSandbox(arg)) return true
      if (kept) return false
      kept = true
      return true
    })
  }
  return [
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${options.userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    // When the user already passed it, keep THEIR position (below) so the
    // argv stays exactly what they wrote; otherwise prepend before headless.
    ...(wantsNoSandbox && !userHasNoSandbox ? ['--no-sandbox'] : []),
    ...(options.headless ? ['--headless=new'] : []),
    ...dedupedUserArgs,
  ]
}

// ── Lightpanda serve engine (managed, per-OS) ───────────────────────────────

export type LaunchEngine = 'chrome' | 'lightpanda'

/** Flags the user must never smuggle into a managed `lightpanda serve`. */
const LP_BLOCKED_ARGS = ['--host', '--port', '--address']

/**
 * Assemble `lightpanda serve --host 127.0.0.1 --port <port>` + user args.
 * No profile/headless flags exist on the serve CLI — nothing to block there.
 */
export function buildServeArgs(options: { port: number; lightpandaArgs?: string }): string[] {
  const tokens = (options.lightpandaArgs ?? '')
    .split(/\s+/)
    .map((arg) => arg.trim())
    .filter((arg) => arg !== '')
  const userArgs: string[] = []
  let skipNext = false
  for (const arg of tokens) {
    if (skipNext) { skipNext = false; continue }
    const blocked = LP_BLOCKED_ARGS.find((b) => arg === b || arg.startsWith(`${b}=`))
    if (blocked !== undefined) {
      // A bare managed flag swallows its value too (`--port 9223`).
      if (arg === blocked) skipNext = true
      continue
    }
    userArgs.push(arg)
  }
  return ['serve', '--host', '127.0.0.1', '--port', String(options.port), ...userArgs]
}

/**
 * win32 sentinel returned by `discoverLightpandaBinary`: Lightpanda has no
 * native Windows build, so the launch argv goes through `wsl.exe --` and the
 * binary lives inside the WSL2 filesystem (host `exists()` cannot see it —
 * the readiness gate is the real check).
 */
export const WSL_LAUNCH = 'wsl'

/**
 * Lightpanda discovery. unix: explicit → common install roots (the official
 * installer targets `~/.local/bin`) → bare PATH name. win32: the WSL sentinel
 * when `wsl.exe` exists (the serve runs inside the default distro).
 */
export function discoverLightpandaBinary(explicit: string, platform: string, exists: (path: string) => boolean): string {
  if (platform === 'win32') {
    return exists('C:/Windows/System32/wsl.exe') ? WSL_LAUNCH : ''
  }
  if (explicit !== '') return explicit
  const home = homedir()
  for (const candidate of [
    `/usr/local/bin/lightpanda`,
    `/usr/bin/lightpanda`,
    join(home, '.local', 'bin', 'lightpanda'),
    join(home, '.dsh', 'cache', 'dsh-browser-cdp', 'bin', 'lightpanda'),
  ]) {
    if (exists(candidate)) return candidate
  }
  return 'lightpanda'
}

/** Spawn argv for one engine on one platform. */
export function buildEngineArgv(options: {
  engine: LaunchEngine
  platform: string
  bin: string
  serveArgs: readonly string[]
}): readonly string[] {
  if (options.engine === 'lightpanda' && options.platform === 'win32' && options.bin === WSL_LAUNCH) {
    return ['wsl.exe', '--', 'lightpanda', ...options.serveArgs]
  }
  return [options.bin, ...options.serveArgs]
}

/** Env handed to a managed Lightpanda serve (telemetry opt-out; WSLENV carries it into WSL). */
export function lightpandaSpawnEnv(platform: string): Record<string, string> {
  const env: Record<string, string> = { LIGHTPANDA_DISABLE_TELEMETRY: 'true' }
  if (platform === 'win32') env.WSLENV = 'LIGHTPANDA_DISABLE_TELEMETRY/u'
  return env
}

// ── registry (T2.13 singleton) ──────────────────────────────────────────────

export interface LauncherRecord {
  pid: number
  port: number
  userDataDir: string
  endpoint: string
  startedAt: number
  /** Lightpanda backend — which engine this record owns. Absent on pre-Lightpanda rows = 'chrome'. */
  engine?: LaunchEngine
}

export function defaultLauncherStatePath(): string {
  return join(homedir(), '.dsh', 'cache', 'dsh-browser-cdp', 'launcher.json')
}

export function defaultManagedProfileDir(): string {
  // T2.15: never the user's daily Chrome profile.
  return join(homedir(), '.dsh', 'cache', 'dsh-browser-cdp', 'chrome-profile')
}

function readRecord(path: string, io: ReturnType<typeof defaultIo>): LauncherRecord | null {
  if (!io.exists(path)) return null
  try {
    const parsed = JSON.parse(io.readFile(path)) as Partial<LauncherRecord>
    if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number') return null
    return {
      pid: parsed.pid,
      port: parsed.port,
      userDataDir: typeof parsed.userDataDir === 'string' ? parsed.userDataDir : '',
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : '',
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
      engine: parsed.engine === 'lightpanda' ? 'lightpanda' : 'chrome',
    }
  } catch {
    return null
  }
}

// ── launch / stop ───────────────────────────────────────────────────────────

export type LaunchOutcome =
  | { ok: true; reused: boolean; endpoint: string; pid: number; port: number }
  | { ok: false; code: 'chrome-not-found' | 'binary-not-found' | 'launch-exited' | 'not-ready' | 'spawn-failed'; message: string }

/**
 * Launch (or reuse) the managed local browser for ONE engine. The readiness
 * gate is the port-first check: `/json/version` returns 200 (a re-exec'ing
 * browser whose spawn pid died still counts as ready), with the spawn pid's
 * liveness only used to pick the failure code when the deadline expires.
 * `timeoutMs` bounds the readiness wait (default 20s).
 *
 * Engine exclusivity: the registry holds ONE managed instance — a record for
 * the OTHER engine is stopped first, so Chrome and Lightpanda never fight
 * over the singleton.
 */
/**
 * Issue #22 M-C: turn "chrome exited" into "do this".
 *
 * Both known cold-start failures on Linux are invisible in a bare exit code:
 * running as root without `--no-sandbox`, and having no X/Wayland display to
 * draw a window on. Report whichever applies (or both) so the user does not
 * have to guess — this only ADDS advice, it never changes what we launched.
 */
function chromeExitHint(platform: string, io: Required<LaunchIo>, headless: boolean): string {
  if (platform === 'win32' || platform === 'darwin') return ''
  const hints: string[] = []
  const env = io.env()
  const isRoot = io.euid() === 0
  const hasDisplay = (typeof env.DISPLAY === 'string' && env.DISPLAY.trim() !== '')
    || (typeof env.WAYLAND_DISPLAY === 'string' && env.WAYLAND_DISPLAY.trim() !== '')
  if (isRoot) {
    hints.push('running as root: Chromium needs `--no-sandbox` (this build adds it automatically; if you overrode chromeArgs, make sure it is still there)')
  }
  if (!hasDisplay && !headless) {
    hints.push('no DISPLAY/WAYLAND_DISPLAY: there is no desktop to open a window on — set `localHeadless: true` in the settings panel (or `--headless=new` via chromeArgs)')
  }
  if (hints.length === 0) {
    hints.push('check `bcdp_doctor` for the resolved chromePath/chromeArgs, then try again with `localHeadless: true`')
  }
  return ` — ${hints.join('; ')}`
}

export async function launchLocalBrowser(
  options: {
    engine?: LaunchEngine
    chromePath?: string
    chromeArgs?: string
    lightpandaPath?: string
    lightpandaArgs?: string
    localHeadless?: boolean
    userDataDir?: string
    statePath?: string
    timeoutMs?: number
    platform?: string
  },
  io?: LaunchIo,
): Promise<LaunchOutcome> {
  const ioImpl = { ...defaultIo(), ...(io ?? {}) }
  const now = ioImpl.now
  const sleep = ioImpl.sleep
  const statePath = options.statePath ?? defaultLauncherStatePath()
  const engine = options.engine === 'lightpanda' ? 'lightpanda' : 'chrome'
  const platform = options.platform ?? process.platform

  // T2.13 — reuse only OUR recorded instance, and only while it still answers
  // — and only when it is the SAME engine the caller asked for.
  const record = readRecord(statePath, ioImpl)
  if (record && record.engine !== engine && ioImpl.isAlive(record.pid)) {
    // Engine switch: the previous managed instance loses the singleton slot.
    ioImpl.killTree(record.pid)
    ioImpl.removeFile(statePath)
  }
  const live = readRecord(statePath, ioImpl)
  if (live && live.engine === engine && ioImpl.isAlive(live.pid) && (await ioImpl.fetchVersion(`http://127.0.0.1:${live.port}/json/version`)).ok) {
    return { ok: true, reused: true, endpoint: live.endpoint, pid: live.pid, port: live.port }
  }

  let bin: string
  let spawnEnv: Record<string, string> | undefined
  if (engine === 'lightpanda') {
    bin = discoverLightpandaBinary(options.lightpandaPath ?? '', platform, ioImpl.exists)
    if (bin === '') {
      return {
        ok: false,
        code: 'binary-not-found',
        message: 'wsl.exe not found — Lightpanda has no native Windows build. Install WSL2 (`wsl --install` as admin), then inside WSL: `curl -fsSL https://pkg.lightpanda.io/install.sh | bash`.',
      }
    }
    spawnEnv = lightpandaSpawnEnv(platform)
  } else {
    bin = discoverChromeBinary(options.chromePath ?? '', platform, ioImpl.exists)
    if (bin === '') {
      return { ok: false, code: 'chrome-not-found', message: 'No Chrome/Chromium/Edge binary found. Set chromePath in the settings panel.' }
    }
  }

  const userDataDir = options.userDataDir && options.userDataDir !== '' ? options.userDataDir : defaultManagedProfileDir()
  const port = await ioImpl.makePort()
  let spawnBin: string
  let args: readonly string[]
  if (engine === 'lightpanda') {
    // The port is only known after makePort — assemble the serve argv now.
    const full = buildEngineArgv({ engine, platform, bin, serveArgs: buildServeArgs({ port, lightpandaArgs: options.lightpandaArgs }) })
    spawnBin = full[0]!
    args = full.slice(1)
  } else {
    spawnBin = bin
    args = buildLaunchArgs({
      userDataDir,
      port,
      headless: options.localHeadless === true,
      chromeArgs: options.chromeArgs,
      // Issue #22 M-A: Chromium refuses to start as root without --no-sandbox
      // ("Running as root without --no-sandbox is not supported"). win32 has no
      // euid notion and never needs this, so the platform gate comes first.
      addNoSandbox: platform !== 'win32' && ioImpl.euid() === 0,
    })
  }

  let pid = 0
  try {
    pid = ioImpl.spawn(spawnBin, args as string[], spawnEnv).pid
  } catch (error) {
    return { ok: false, code: 'spawn-failed', message: String((error as Error).message ?? error) }
  }
  if (!pid) return { ok: false, code: 'spawn-failed', message: 'spawn returned no pid' }

  const endpoint = `http://127.0.0.1:${port}`
  const engineName = engine === 'lightpanda' ? 'lightpanda' : 'chrome'
  const deadline = now() + (options.timeoutMs ?? 20000)
  // Port probe FIRST, pid check second: Chromium builds that re-exec on
  // startup (Yandex Browser) orphan the spawn pid while the real browser
  // opens the SAME debugging port. The port answering `/json/version` IS
  // readiness, even when `isAlive(pid)` says our child is already gone
  // (issue #19). A dead pid with a silent port still keeps polling until
  // the deadline — the successor process may be about to bind it.
  let spawnPidGone = false
  for (;;) {
    let versionOk = false
    try { versionOk = (await ioImpl.fetchVersion(`${endpoint}/json/version`)).ok } catch { /* not up yet */ }
    if (versionOk) break
    if (!ioImpl.isAlive(pid)) spawnPidGone = true
    if (now() >= deadline) {
      if (spawnPidGone) {
        // Issue #22 M-C: a bare "exited before opening the debugging port" is
        // unactionable — the two real causes are (a) root without --no-sandbox
        // and (b) no display to draw a window on. Name the fix, not the symptom.
        const diagnosis = engine === 'chrome' ? chromeExitHint(platform, ioImpl, options.localHeadless === true) : ''
        return { ok: false, code: 'launch-exited', message: `${engineName} exited before opening the debugging port (pid ${pid})${engine === 'lightpanda' && platform === 'win32' ? ' — is lightpanda installed inside WSL? (`wsl` then `curl -fsSL https://pkg.lightpanda.io/install.sh | bash`)' : ''}${diagnosis}` }
      }
      ioImpl.killTree(pid)
      ioImpl.removeFile(statePath)
      return { ok: false, code: 'not-ready', message: `${engineName} did not answer ${endpoint}/json/version within the readiness window` }
    }
    await sleep(250)
  }

  ioImpl.writeFile(statePath, JSON.stringify({
    pid, port, userDataDir, endpoint, startedAt: now(),
    headless: options.localHeadless === true,
    engine,
  } satisfies LauncherRecord & { headless: boolean }, null, 2))
  return { ok: true, reused: false, endpoint, pid, port }
}

/**
 * Stop the managed instance: kill-tree, wait for the pid to disappear, drop
 * the registry entry. T2.14 — the reaper and plugin unmount both call this.
 * Lightpanda on win32 rides `wsl.exe`, and taskkill /T does not reach the
 * Linux-side process — add a targeted pkill of OUR serve argv as backstop.
 */
export async function stopLocalBrowser(
  options: { statePath?: string; graceMs?: number } = {},
  io?: LaunchIo,
): Promise<{ ok: boolean; code: string }> {
  const ioImpl = { ...defaultIo(), ...(io ?? {}) }
  const statePath = options.statePath ?? defaultLauncherStatePath()
  const record = readRecord(statePath, ioImpl)
  if (!record) return { ok: true, code: 'not-running' }
  if (ioImpl.isAlive(record.pid)) {
    ioImpl.killTree(record.pid)
    if (record.engine === 'lightpanda' && process.platform === 'win32') {
      try {
        nodeSpawn('wsl.exe', ['--', 'sh', '-c', `pkill -f 'lightpanda serve --host 127.0.0.1 --port ${record.port}' || true`], { stdio: 'ignore' }).unref()
      } catch { /* best-effort */ }
    }
    const deadline = ioImpl.now() + (options.graceMs ?? 5000)
    while (ioImpl.isAlive(record.pid) && ioImpl.now() < deadline) {
      await ioImpl.sleep(100)
    }
    if (ioImpl.isAlive(record.pid)) return { ok: false, code: 'stop-timeout' }
  }
  ioImpl.removeFile(statePath)
  return { ok: true, code: 'stopped' }
}

/** Is a managed local browser alive right now? (reaper + doctor helper) */
export function localBrowserInfo(statePath?: string, io?: LaunchIo): { endpoint: string; pid: number } | null {
  const ioImpl = { ...defaultIo(), ...(io ?? {}) }
  const record = readRecord(statePath ?? defaultLauncherStatePath(), ioImpl)
  if (!record || !ioImpl.isAlive(record.pid)) return null
  return { endpoint: record.endpoint, pid: record.pid }
}
