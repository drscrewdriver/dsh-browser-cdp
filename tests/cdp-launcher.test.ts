import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildLaunchArgs, buildServeArgs, discoverChromeBinary, discoverLightpandaBinary, launchLocalBrowser, stopLocalBrowser, windowsEnvChromeCandidates, WSL_LAUNCH } from '../src/cdp/launcher.ts'

/** T2.12 — binary discovery is platform-table driven with explicit override. */
describe('launcher binary discovery', () => {
  const existsFor = (present: readonly string[]) => (p: string) => present.includes(p)
  it('prefers the explicit chromePath when it exists', () => {
    expect(discoverChromeBinary('C:/x/chrome.exe', 'win32', existsFor(['C:/x/chrome.exe']))).toBe('C:/x/chrome.exe')
  })
  it('returns empty when the explicit path does not exist (no silent guess)', () => {
    expect(discoverChromeBinary('C:/missing/chrome.exe', 'win32', existsFor([]))).toBe('')
  })
  it('walks the platform table in order', () => {
    expect(discoverChromeBinary('', 'linux', existsFor(['/usr/bin/chromium']))).toBe('/usr/bin/chromium')
    expect(discoverChromeBinary('', 'linux', existsFor([]))).toBe('')
  })
  it('finds 32-bit Edge via the env-driven list (issue #19: doctor saw it, launcher did not)', () => {
    const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }
    const edge32 = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    expect(discoverChromeBinary('', 'win32', existsFor([edge32]), env)).toBe(edge32)
  })
  it('env-driven list covers both Edge layouts, Brave, and per-user installs', () => {
    const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }
    const list = windowsEnvChromeCandidates(env)
    expect(list).toContain('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe')
    expect(list).toContain('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
    expect(list).toContain('C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe')
    expect(list).toContain('C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
  })
  it('falls back to the absolute table when the environment is mangled (issue #19)', () => {
    const fallbackEdge32 = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    expect(discoverChromeBinary('', 'win32', existsFor([fallbackEdge32]), {})).toBe(fallbackEdge32)
  })
})

/** Issue #19 family, second pass — darwin/posix canonical lists live in the launcher. */
describe('launcher doctor-shared darwin/posix lists', () => {
  const existsFor = (present: readonly string[]) => (p: string) => present.includes(p)
  it('finds Edge/Brave/Chromium bundles on darwin, not just Google Chrome', () => {
    const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    expect(discoverChromeBinary('', 'darwin', existsFor([edge]), { HOME: '/Users/u' })).toBe(edge)
  })
  it('probes the per-user /Applications root after the system one', () => {
    const perUser = '/Users/u/Applications/Chromium.app/Contents/MacOS/Chromium'
    expect(discoverChromeBinary('', 'darwin', existsFor([perUser]), { HOME: '/Users/u' })).toBe(perUser)
  })
  it('expands bare posix names over PATH dirs (doctor saw it, launcher did not)', () => {
    const local = '/usr/local/bin/chromium'
    expect(discoverChromeBinary('', 'linux', existsFor([local]), { PATH: '/usr/local/bin:/usr/bin' })).toBe(local)
  })
  it('keeps the doctor name-major walk order: google-chrome-stable anywhere beats google-chrome in the first dir', () => {
    expect(discoverChromeBinary('', 'linux', existsFor(['/d1/google-chrome', '/d2/google-chrome-stable']), { PATH: '/d1:/d2' }))
      .toBe('/d2/google-chrome-stable')
  })
  it('still finds the fixed /usr/bin paths with an empty PATH', () => {
    expect(discoverChromeBinary('', 'linux', existsFor(['/usr/bin/chromium']), {})).toBe('/usr/bin/chromium')
  })
})

/** T2.12 — the managed launch strips forbidden user flags. */
describe('launcher args assembly', () => {
  it('adds port/profile/base flags and filters BLOCKED user args', () => {
    const args = buildLaunchArgs({
      userDataDir: 'C:/profile', port: 9333, headless: false,
      chromeArgs: '--lang=zh --user-data-dir=C:/evil --remote-debugging-port=1 --headless --proxy-server=x --force-dark',
    })
    expect(args).toContain('--remote-debugging-port=9333')
    expect(args).toContain('--user-data-dir=C:/profile')
    expect(args).toContain('--no-first-run')
    expect(args).toContain('--force-dark')
    expect(args.join(' ')).not.toContain('--user-data-dir=C:/evil')
    expect(args.join(' ')).not.toContain('--remote-debugging-port=1 --')
    expect(args.join(' ')).not.toContain('--headless')
    expect(args.join(' ')).not.toContain('--proxy-server')
  })
  it('honours localHeadless with the modern flag', () => {
    const args = buildLaunchArgs({ userDataDir: 'p', port: 1, headless: true })
    expect(args).toContain('--headless=new')
  })
})

/** T2.12/T2.13 — launch readiness + singleton reuse, all IO injected. */
describe('launcher lifecycle', () => {
  function fakeIo(options: { port?: number; pid?: number; failFirstProbes?: number; bin?: string } = {}) {
    const bin = options.bin ?? 'C:/x/chrome.exe'
    let probes = 0
    const calls: string[] = []
    const spawned: Array<{ bin: string; args: readonly string[] }> = []
    const state: Record<string, string> = {}
    const alive = new Set<number>([])
    const io = {
      exists: (p: string) => p in state || p === bin,
      readFile: (p: string) => state[p],
      writeFile: (p: string, d: string) => { state[p] = d },
      removeFile: (p: string) => { delete state[p] },
      isAlive: (pid: number) => alive.has(pid),
      killTree: (pid: number) => { alive.delete(pid); calls.push(`kill:${pid}`) },
      spawn: (bin: string, args: readonly string[]) => {
        const pid = options.pid ?? 4242
        spawned.push({ bin, args }); alive.add(pid); calls.push(`spawn:${bin}`)
        return { pid }
      },
      fetchVersion: async (url: string) => {
        probes += 1
        if (probes <= (options.failFirstProbes ?? 0)) return { ok: false }
        if (url.includes(String(options.port))) return { ok: true }
        return { ok: false }
      },
      now: (() => { let t = 1000; return () => (t += 300) })(),
      sleep: async () => undefined,
      makePort: async () => options.port ?? 9444,
    }
    return { io, spawned, calls, state }
  }

  it('launches, becomes ready, and records the singleton', async () => {
    const f = fakeIo({ port: 9444, pid: 4242 })
    const out = await launchLocalBrowser({ chromePath: 'C:/x/chrome.exe', localHeadless: true, statePath: 'C:/fake/launcher.json' }, f.io)
    expect(out).toMatchObject({ ok: true, reused: false, pid: 4242, port: 9444 })
    expect(f.spawned[0]!.args.join(' ')).toContain('--headless=new')
    expect(f.state['C:/fake/launcher.json']).toContain('"pid": 4242')
  })

  it('reuses a live recorded instance instead of spawning again (T2.13)', async () => {
    const f = fakeIo({ port: 9444, pid: 4242 })
    const first = await launchLocalBrowser({ chromePath: 'C:/x/chrome.exe', statePath: 'C:/fake/launcher.json' }, f.io)
    expect(first.ok).toBe(true)
    const second = await launchLocalBrowser({ chromePath: 'C:/x/chrome.exe', statePath: 'C:/fake/launcher.json' }, f.io)
    expect(second).toMatchObject({ ok: true, reused: true, pid: 4242 })
    expect(f.spawned).toHaveLength(1)
  })

  it('treats an answered port as readiness even when the spawn pid died (Yandex re-exec, issue #19)', async () => {
    const f = fakeIo({ port: 9444, pid: 4242 })
    // The spawn pid exits immediately (re-exec); the successor browser opens
    // the SAME debugging port, which answers on the first probe.
    const io = { ...f.io, isAlive: () => false }
    const out = await launchLocalBrowser({ chromePath: 'C:/x/chrome.exe', statePath: 'C:/fake/launcher.json' }, io)
    expect(out).toMatchObject({ ok: true, reused: false, pid: 4242, port: 9444 })
  })
  it('reports launch-exited when the pid is gone AND the port never answers within the window', async () => {
    const f = fakeIo({ port: 9444, pid: 4242, failFirstProbes: 999 })
    const io = { ...f.io, isAlive: () => false }
    const out = await launchLocalBrowser({ chromePath: 'C:/x/chrome.exe', statePath: 'C:/fake/launcher.json', timeoutMs: 1 }, io)
    expect(out).toMatchObject({ ok: false, code: 'launch-exited' })
  })

  it('reports not-ready past the deadline and kills the half-started tree', async () => {
    const f = fakeIo({ port: 9444, pid: 4242, failFirstProbes: 999 })
    const out = await launchLocalBrowser({ chromePath: 'C:/x/chrome.exe', statePath: 'C:/fake/launcher.json', timeoutMs: 1 }, f.io)
    expect(out).toMatchObject({ ok: false, code: 'not-ready' })
    expect(f.calls).toContain('kill:4242')
  })

  it('stop kills the recorded tree and drops the registry (T2.14)', async () => {
    const f = fakeIo({ port: 9444, pid: 4242 })
    await launchLocalBrowser({ chromePath: 'C:/x/chrome.exe', statePath: 'C:/fake/launcher.json' }, f.io)
    f.io.isAlive = () => false
    const stop = await stopLocalBrowser({ statePath: 'C:/fake/launcher.json' }, f.io)
    expect(stop).toMatchObject({ ok: true, code: 'stopped' })
    expect(f.io.exists('C:/fake/launcher.json')).toBe(false)
  })
})

/** Lightpanda backend — serve engine: discovery / argv / launch / exclusivity. */
describe('lightpanda managed serve', () => {
  const existsFor = (present: readonly string[]) => (p: string) => present.includes(p)
  function lpIo(options: { platform: string; onSpawn?: (bin: string, args: readonly string[], env?: Record<string, string>) => void; onKill?: () => void } ) {
    const state: Record<string, string> = {}
    const alive = new Set<number>()
    let probes = 0
    const io = {
      exists: (p: string) => options.platform === 'win32' || p === 'C:/x/chrome.exe' || p.endsWith('.json'), // wsl.exe on win32 / chrome fixture / registry
      readFile: (p: string) => state[p],
      writeFile: (p: string, d: string) => { state[p] = d },
      removeFile: (p: string) => { delete state[p] },
      isAlive: (pid: number) => alive.has(pid),
      killTree: (pid: number) => { alive.delete(pid); options.onKill?.() },
      spawn: (bin: string, args: readonly string[], env?: Record<string, string>) => {
        const pid = 4242
        alive.add(pid)
        options.onSpawn?.(bin, args, env)
        return { pid }
      },
      fetchVersion: async () => {
        probes += 1
        return { ok: probes > 1 } // first read = stale-record check (miss), second = readiness (hit)
      },
      now: (() => { let t = 1000; return () => (t += 300) })(),
      sleep: async () => undefined,
      makePort: async () => 9222,
    }
    return { io, statePath: 'launcher.json', readState: () => state['launcher.json'] }
  }

  it('builds serve args with managed host/port and filters managed user flags', () => {
    const args = buildServeArgs({ port: 9222, lightpandaArgs: '--server-timeout 30 --port 1 --host evil --address x' })
    expect(args).toEqual(['serve', '--host', '127.0.0.1', '--port', '9222', '--server-timeout', '30'])
  })
  it('discovers via wsl sentinel on win32 and install roots on unix', () => {
    expect(discoverLightpandaBinary('', 'win32', existsFor(['C:/Windows/System32/wsl.exe']))).toBe(WSL_LAUNCH)
    expect(discoverLightpandaBinary('', 'win32', existsFor([]))).toBe('')
    expect(discoverLightpandaBinary('/opt/lp', 'linux', existsFor([]))).toBe('/opt/lp')
    expect(discoverLightpandaBinary('', 'linux', existsFor([join(homedir(), '.local', 'bin', 'lightpanda')]))).toBe(join(homedir(), '.local', 'bin', 'lightpanda'))
    expect(discoverLightpandaBinary('', 'linux', existsFor([]))).toBe('lightpanda') // last resort: PATH
  })
  it('launches through wsl.exe on win32 with telemetry env and records the engine', async () => {
    const spawned: Array<{ bin: string; args: readonly string[]; env?: Record<string, string> }> = []
    const h = lpIo({ platform: 'win32', onSpawn: (bin, args, env) => { spawned.push({ bin, args, env }) } })
    const out = await launchLocalBrowser({ engine: 'lightpanda', platform: 'win32', statePath: h.statePath }, h.io)
    expect(out.ok).toBe(true)
    expect(spawned[0]!.bin).toBe('wsl.exe')
    expect(spawned[0]!.args).toEqual(['--', 'lightpanda', 'serve', '--host', '127.0.0.1', '--port', String(out.ok ? out.port : 0)])
    expect(spawned[0]!.env!['LIGHTPANDA_DISABLE_TELEMETRY']).toBe('true')
    expect(spawned[0]!.env!['WSLENV']).toBe('LIGHTPANDA_DISABLE_TELEMETRY/u')
    expect(JSON.parse(h.readState()).engine).toBe('lightpanda')
  })
  it('keeps the engine singleton: a live chrome record is displaced by a lightpanda launch', async () => {
    const calls: string[] = []
    const h = lpIo({ platform: 'linux', onSpawn: () => { calls.push('spawn') }, onKill: () => { calls.push('kill') } })
    await launchLocalBrowser({ engine: 'chrome', platform: 'linux', chromePath: 'C:/x/chrome.exe', statePath: h.statePath }, h.io)
    const out = await launchLocalBrowser({ engine: 'lightpanda', platform: 'linux', statePath: h.statePath }, h.io)
    expect(out.ok).toBe(true)
    expect(calls).toEqual(['spawn', 'kill', 'spawn'])
    expect(JSON.parse(h.readState()).engine).toBe('lightpanda')
  })
})

/** Issue #22 M-A — root gets `--no-sandbox` automatically, non-root does not. */
describe('launcher root no-sandbox (issue #22 M-A)', () => {
  function nlIo(options: { euid: number; spawned: Array<{ args: readonly string[] }> }) {
    const state: Record<string, string> = {}
    const alive = new Set<number>()
    let probes = 0
    return {
      exists: (p: string) => p.endsWith('chrome.exe') || p in state,
      readFile: (p: string) => state[p],
      writeFile: (p: string, d: string) => { state[p] = d },
      removeFile: (p: string) => { delete state[p] },
      isAlive: (pid: number) => alive.has(pid),
      killTree: (pid: number) => { alive.delete(pid) },
      spawn: (_bin: string, args: readonly string[]) => {
        options.spawned.push({ args })
        alive.add(4242)
        return { pid: 4242 }
      },
      fetchVersion: async () => { probes += 1; return { ok: true } },
      now: (() => { let t = 1000; return () => (t += 300) })(),
      sleep: async () => undefined,
      makePort: async () => 9222,
      euid: () => options.euid,
    }
  }

  it('appends --no-sandbox when euid is 0 on a POSIX platform', async () => {
    const spawned: Array<{ args: readonly string[] }> = []
    const io = nlIo({ euid: 0, spawned })
    const out = await launchLocalBrowser({ platform: 'linux', chromePath: 'C:/x/chrome.exe', localHeadless: true, statePath: 'l.json', timeoutMs: 50 }, io)
    expect(out.ok).toBe(true)
    const argv = spawned[0]!.args as string[]
    expect(argv).toContain('--no-sandbox')
    // Order: the managed base flags, then --no-sandbox right before --headless=new.
    expect(argv.indexOf('--no-sandbox')).toBeLessThan(argv.indexOf('--headless=new'))
  })

  it('does not append --no-sandbox for a non-root user', async () => {
    const spawned: Array<{ args: readonly string[] }> = []
    const io = nlIo({ euid: 1000, spawned })
    await launchLocalBrowser({ platform: 'linux', chromePath: 'C:/x/chrome.exe', statePath: 'l.json', timeoutMs: 50 }, io)
    expect(spawned[0]!.args).not.toContain('--no-sandbox')
  })

  it('never appends --no-sandbox on win32 even when euid reports 0', async () => {
    const spawned: Array<{ args: readonly string[] }> = []
    const io = nlIo({ euid: 0, spawned })
    await launchLocalBrowser({ platform: 'win32', chromePath: 'C:/x/chrome.exe', statePath: 'l.json', timeoutMs: 50 }, io)
    expect(spawned[0]!.args).not.toContain('--no-sandbox')
  })

  it('de-duplicates when the user already passed --no-sandbox in chromeArgs', () => {
    const args = buildLaunchArgs({ userDataDir: 'p', port: 1, headless: true, addNoSandbox: true, chromeArgs: '--no-sandbox --force-dark' })
    expect(args.filter((a) => a === '--no-sandbox')).toHaveLength(1)
    expect(args).toContain('--force-dark')
    expect(args).toContain('--headless=new')
  })

  it('de-duplicates the =true spelling too', () => {
    const args = buildLaunchArgs({ userDataDir: 'p', port: 1, headless: false, addNoSandbox: true, chromeArgs: '--no-sandbox=true' })
    expect(args.filter((a) => a.startsWith('--no-sandbox'))).toHaveLength(1)
  })

  it('leaves a user-supplied --no-sandbox alone when we would not add one', () => {
    const args = buildLaunchArgs({ userDataDir: 'p', port: 1, headless: false, chromeArgs: '--no-sandbox' })
    expect(args).toContain('--no-sandbox')
  })
})

/** Issue #22 M-C — a cold-start failure must name the fix, not just the symptom. */
describe('launcher actionable cold-start errors (issue #22 M-C)', () => {
  function failingIo(options: { euid: number; env: Record<string, string | undefined> }) {
    const state: Record<string, string> = {}
    const alive = new Set<number>()
    return {
      exists: (p: string) => p.endsWith('chrome.exe') || p in state,
      readFile: (p: string) => state[p],
      writeFile: (p: string, d: string) => { state[p] = d },
      removeFile: (p: string) => { delete state[p] },
      isAlive: () => false,
      killTree: () => undefined,
      spawn: () => ({ pid: 4242 }),
      fetchVersion: async () => ({ ok: false }),
      now: (() => { let t = 1000; return () => (t += 400) })(),
      sleep: async () => undefined,
      makePort: async () => 9222,
      euid: () => options.euid,
      env: () => options.env,
    }
  }

  it('explains that root + no display needs localHeadless or --no-sandbox', async () => {
    const io = failingIo({ euid: 0, env: {} })
    const out = await launchLocalBrowser({ platform: 'linux', chromePath: 'C:/x/chrome.exe', statePath: 'l.json', timeoutMs: 1 }, io)
    expect(out).toMatchObject({ ok: false, code: 'launch-exited' })
    if (out.ok) throw new Error('unreachable')
    expect(out.message).toContain('localHeadless')
    expect(out.message).toContain('DISPLAY')
  })

  it('does not blame DISPLAY when one is present (root-only advice)', async () => {
    const io = failingIo({ euid: 0, env: { DISPLAY: ':0' } })
    const out = await launchLocalBrowser({ platform: 'linux', chromePath: 'C:/x/chrome.exe', statePath: 'l.json', timeoutMs: 1 }, io)
    if (out.ok) throw new Error('unreachable')
    expect(out.message).toContain('root')
    expect(out.message).not.toContain('no DISPLAY/WAYLAND_DISPLAY')
  })

  it('skips the linux diagnosis entirely on win32', async () => {
    const io = failingIo({ euid: 0, env: {} })
    const out = await launchLocalBrowser({ platform: 'win32', chromePath: 'C:/x/chrome.exe', statePath: 'l.json', timeoutMs: 1 }, io)
    if (out.ok) throw new Error('unreachable')
    expect(out.message).not.toContain('localHeadless')
  })
})
