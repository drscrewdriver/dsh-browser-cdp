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
  spawn?: (bin: string, args: readonly string[]) => { pid: number }
  fetchVersion?: (url: string) => Promise<{ ok: boolean }>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  makePort?: () => Promise<number>
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
  spawn: (bin, args) => {
    const child: ChildProcess = nodeSpawn(bin, args, { detached: true, stdio: 'ignore' })
    child.unref()
    return { pid: child.pid ?? 0 }
  },
  fetchVersion: async (url) => {
    const res = await fetch(url)
    return { ok: res.ok }
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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

const PLATFORM_CANDIDATES: Record<string, readonly string[]> = {
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
}

export function discoverChromeBinary(explicit: string, platform: string, exists: (path: string) => boolean): string {
  if (explicit !== '') return exists(explicit) ? explicit : ''
  for (const candidate of PLATFORM_CANDIDATES[platform] ?? []) {
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
}): string[] {
  const userArgs = (options.chromeArgs ?? '')
    .split(/\s+/)
    .map((arg) => arg.trim())
    .filter((arg) => arg !== '')
    .filter((arg) => !BLOCKED_ARGS.some((blocked) => arg === blocked || arg.startsWith(`${blocked}=`) || arg.startsWith(`${blocked} `)))
  return [
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${options.userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    ...(options.headless ? ['--headless=new'] : []),
    ...userArgs,
  ]
}

// ── registry (T2.13 singleton) ──────────────────────────────────────────────

export interface LauncherRecord {
  pid: number
  port: number
  userDataDir: string
  endpoint: string
  startedAt: number
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
    }
  } catch {
    return null
  }
}

// ── launch / stop ───────────────────────────────────────────────────────────

export type LaunchOutcome =
  | { ok: true; reused: boolean; endpoint: string; pid: number; port: number }
  | { ok: false; code: 'chrome-not-found' | 'launch-exited' | 'not-ready' | 'spawn-failed'; message: string }

/**
 * Launch (or reuse) the managed local browser. The readiness gate is the
 * three-step check from T2.12: process alive → port responds → `/json/version`
 * returns 200. `timeoutMs` bounds the readiness wait (default 20s).
 */
export async function launchLocalBrowser(
  options: {
    chromePath?: string
    chromeArgs?: string
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

  // T2.13 — reuse only OUR recorded instance, and only while it still answers.
  const record = readRecord(statePath, ioImpl)
  if (record && ioImpl.isAlive(record.pid) && (await ioImpl.fetchVersion(`http://127.0.0.1:${record.port}/json/version`)).ok) {
    return { ok: true, reused: true, endpoint: record.endpoint, pid: record.pid, port: record.port }
  }

  const platform = options.platform ?? process.platform
  const bin = discoverChromeBinary(options.chromePath ?? '', platform, ioImpl.exists)
  if (bin === '') {
    return { ok: false, code: 'chrome-not-found', message: 'No Chrome/Chromium/Edge binary found. Set chromePath in the settings panel.' }
  }
  const userDataDir = options.userDataDir && options.userDataDir !== '' ? options.userDataDir : defaultManagedProfileDir()
  const port = await ioImpl.makePort()
  const args = buildLaunchArgs({ userDataDir, port, headless: options.localHeadless === true, chromeArgs: options.chromeArgs })

  let pid = 0
  try {
    pid = ioImpl.spawn(bin, args).pid
  } catch (error) {
    return { ok: false, code: 'spawn-failed', message: String((error as Error).message ?? error) }
  }
  if (!pid) return { ok: false, code: 'spawn-failed', message: 'spawn returned no pid' }

  const endpoint = `http://127.0.0.1:${port}`
  const deadline = now() + (options.timeoutMs ?? 20000)
  for (;;) {
    if (!ioImpl.isAlive(pid)) {
      return { ok: false, code: 'launch-exited', message: `chrome exited before opening the debugging port (pid ${pid})` }
    }
    let versionOk = false
    try { versionOk = (await ioImpl.fetchVersion(`${endpoint}/json/version`)).ok } catch { /* not up yet */ }
    if (versionOk) break
    if (now() >= deadline) {
      ioImpl.killTree(pid)
      ioImpl.removeFile(statePath)
      return { ok: false, code: 'not-ready', message: `chrome did not answer ${endpoint}/json/version within the readiness window` }
    }
    await sleep(250)
  }

  ioImpl.writeFile(statePath, JSON.stringify({
    pid, port, userDataDir, endpoint, startedAt: now(),
    headless: options.localHeadless === true,
  } satisfies LauncherRecord & { headless: boolean }, null, 2))
  return { ok: true, reused: false, endpoint, pid, port }
}

/**
 * Stop the managed instance: kill-tree, wait for the pid to disappear, drop
 * the registry entry. T2.14 — the reaper and plugin unmount both call this.
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
