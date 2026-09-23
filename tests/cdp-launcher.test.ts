import { describe, expect, it } from 'vitest'
import { buildLaunchArgs, discoverChromeBinary, launchLocalBrowser, stopLocalBrowser } from '../src/cdp/launcher.ts'

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

  it('reports launch-exited when chrome dies before the port answers', async () => {
    const f = fakeIo({ port: 9444, pid: 4242 })
    const io = { ...f.io, isAlive: () => false }
    const out = await launchLocalBrowser({ chromePath: 'C:/x/chrome.exe', statePath: 'C:/fake/launcher.json' }, io)
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
