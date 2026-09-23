import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { createSubprocessCliIo, probeCliLink } from '../../src/cdp/cli-link.ts'
import type { SpawnSpec, SubprocessService } from '../../src/types.ts'

/**
 * R7 — the local `ego-cli` link probe, against the REAL bundled runtime.
 *
 * Manual, evidence-producing run — skipped unless asked for, so the default
 * `vitest run` never spawns a browser:
 *
 *   BCDP_CLI_PROBE=1 node node_modules/vitest/vitest.mjs run tests/cli-probe/local.probe.test.ts
 *
 * WHY IT IS GATED (measured, not assumed): the readiness heredoc goes through
 * `ego-browser nodejs`, and the port's `createEgoShim()` calls
 * `ensureBrowser()` EAGERLY (runtime/ego-linux/src/shim.mjs:18). So a probe is
 * NOT free — it cold-starts the backing browser (2–4 s, ~400 MB) on the first
 * run. This fixture therefore forces `EGO_LINUX_HEADLESS=1` (no window appears
 * on the desktop) and `--stop`s the browser again at the end.
 */

const BUNDLED = fileURLToPath(new URL('../../runtime/ego-linux/bin/ego-browser.mjs', import.meta.url))

/**
 * The port's Chrome discovery is Linux-named only
 * (`google-chrome`, `chromium`, `brave-browser`, …), so on Windows it finds
 * nothing and every heredoc dies in `resolveBinary`. Measured here as:
 *   "no Chrome/Chromium binary found (tried: google-chrome, …" — set
 * `EGO_LINUX_CHROME` to an absolute path to give it one.
 */
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

/** Point the port at a real browser when the platform cannot be guessed. */
function ensureChromeForPort(): string {
  if (process.env.EGO_LINUX_CHROME) return process.env.EGO_LINUX_CHROME
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) {
      process.env.EGO_LINUX_CHROME = candidate
      return candidate
    }
  }
  return ''
}

/** Minimal SubprocessService over child_process, for the real spawn path. */
function realSubprocess(): SubprocessService {
  return {
    spawn(spec: SpawnSpec) {
      const child = spawn(spec.argv[0]!, spec.argv.slice(1), {
        cwd: spec.cwd,
        env: spec.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let out = ''
      let err = ''
      child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8') })
      child.stderr.on('data', (c: Buffer) => { err += c.toString('utf8') })
      child.stdin.end(spec.stdio.stdin.data)
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ exitCode: null, signal: 'SIGKILL' }) }, spec.graceMs)
        child.on('close', (exitCode, signal) => { clearTimeout(timer); resolve({ exitCode, signal }) })
      })
      const reader = (text: () => string) => ({ readFrom: () => ({ text: text(), nextOffset: text().length, lossy: false }) })
      return { done, collected: { stdout: reader(() => out), stderr: reader(() => err) } }
    },
  }
}

const enabled = process.env.BCDP_CLI_PROBE === '1'

describe.skipIf(!enabled)('R7 local ego-cli probe (real subprocess)', () => {
  it('resolves and probes the bundled runtime, then stops what it started', async () => {
    // Never let a probe put a window on someone's desktop.
    process.env.EGO_LINUX_HEADLESS = '1'
    const chrome = ensureChromeForPort()
    const subprocess = realSubprocess()
    const io = createSubprocessCliIo(subprocess)

    console.log('[cli-probe] env:', JSON.stringify({
      platform: io.platform, bundledExists: existsSync(BUNDLED), chrome: chrome || '(none found)',
    }))

    const started = Date.now()
    const result = await probeCliLink({ bundled: BUNDLED, timeoutMs: 90_000 }, io)
    const wallMs = Date.now() - started
    console.log('[cli-probe] result:', JSON.stringify({ ...result, wallMs }))

    // Resolution and shape are environment-independent and must always hold.
    expect(result.origin).toBe('bundled')
    expect(result.shape).toBe('node')
    // The readiness outcome depends on a browser existing on this machine, so
    // assert the CONTRACT rather than success: either we reach the sentinel, or
    // we come back with a classified, actionable failure — never a crash and
    // never a silent "idle".
    if (result.ok) {
      console.log(`[cli-probe] READY in ${wallMs}ms (running=${String(result.running)})`)
    } else {
      expect(['cli-probe-failed', 'cli-probe-timeout']).toContain(result.code)
      expect(result.message.length).toBeGreaterThan(20)
      console.log(`[cli-probe] classified failure ${result.code}: ${result.message.slice(0, 160)}`)
    }

    // Clean up the browser the probe cold-started, so the fixture leaves no
    // orphan behind (measured: --stop exits 0 whether or not one was running).
    const stop = await io.run({ argv: [process.execPath, BUNDLED, '--stop'], stdin: '', timeoutMs: 30_000 })
    console.log('[cli-probe] stop:', JSON.stringify({ exitCode: stop.exitCode, stdout: stop.stdout.trim().slice(0, 200) }))
  }, 180_000)
})
