/**
 * Regression (issue #16): the host must not discard a capture the worker
 * already produced just because the `connect` step failed.
 *
 * The worker's steps attach LAZILY — capture/navigate re-run attachPage when
 * no session is held, and the capture step's params carry no targetId, so the
 * worker auto-picks an http(s) page. A failed connect therefore does not imply
 * a failed step; `makeJudgeEffects` must judge by the step itself.
 */
import { describe, expect, it } from 'vitest'
import type { SpawnSpec, SubprocessHandle, SubprocessService } from '../src/types.ts'
import { makeJudgeEffects, type EffectsDeps } from '../src/jev/effects.ts'
import type { JudgeRuntime } from '../src/jev/client.ts'

function fakeSpawn(stdout: string, stderr = '', exitCode = 0) {
  const specs: SpawnSpec[] = []
  const service: SubprocessService = {
    spawn(spec: SpawnSpec): SubprocessHandle {
      specs.push(spec)
      return {
        done: Promise.resolve({ exitCode, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) },
          stderr: { readFrom: () => ({ text: stderr, nextOffset: stderr.length, lossy: false }) },
        },
      }
    },
  }
  return { service, specs }
}

const reply = (id: number, result: unknown): string => JSON.stringify({ v: 1, id, ok: true, result })
const fail = (id: number, message: string): string =>
  JSON.stringify({ v: 1, id, ok: false, error: { code: 'call-failed', message } })

/** The issue #16 shape: connect failed, but the requested step succeeded. */
const connectFailCaptureOk = [
  fail(1, 'no page target matches targetId cdp-local-chrome'),
  reply(2, {
    data: 'aGk=',
    bytes: 2,
    quality: null,
    overBudget: false,
    attempts: 1,
    marks: [],
    viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    targetId: '0123abcd0123abcd0123abcd0123abcd',
    targetUrl: 'https://example.test/',
    sessionId: 'S1',
  }),
].join('\n') + '\n'

const deps = (service: SubprocessService): EffectsDeps => ({
  subprocess: service,
  workerPath: 'w.mjs',
  wsUrl: 'ws://127.0.0.1:9222/devtools/browser/zzz',
  judge: {} as unknown as JudgeRuntime,
  maxImageBytes: 0,
  candidateLimit: 20,
  now: () => 0,
  sleep: async () => {},
})

describe('jev effects · a usable step result beats a failed connect', () => {
  it('capture returns the frame the worker already produced', async () => {
    const { service } = fakeSpawn(connectFailCaptureOk)
    const effects = makeJudgeEffects(deps(service))
    const { frame } = await effects.capture()
    expect(frame.target.targetId).toBe('0123abcd0123abcd0123abcd0123abcd')
    expect(frame.target.url).toBe('https://example.test/')
    expect(frame.image?.dataBase64).toBe('aGk=')
    expect(effects.frames()).toHaveLength(1)
  })

  it('navigate reports ok when its own step succeeded', async () => {
    const stdout = [fail(1, 'connect timed out'), reply(2, { url: 'https://example.test/after', loaded: true })].join('\n') + '\n'
    const { service } = fakeSpawn(stdout)
    const effects = makeJudgeEffects(deps(service))
    const out = await effects.navigate('https://example.test/after')
    expect(out).toEqual({ ok: true, url: 'https://example.test/after', loaded: true })
  })

  it('a failed step still fails, preferring the step\u2019s own error', async () => {
    const stdout = [fail(1, 'connect timed out'), fail(2, 'Page.captureScreenshot failed')].join('\n') + '\n'
    const { service } = fakeSpawn(stdout)
    const effects = makeJudgeEffects(deps(service))
    await expect(effects.capture()).rejects.toThrow('Page.captureScreenshot failed')
  })

  it('a missing step reply fails with the materialized step error (step.error preferred)', async () => {
    // runRenderCall materializes a missing reply as an explicit step failure,
    // so the step\u2019s own error wins over the connect-failure message — the
    // attach message only surfaces when the step carried no error at all.
    const { service } = fakeSpawn('')
    const effects = makeJudgeEffects(deps(service))
    await expect(effects.capture()).rejects.toThrow('the worker returned no reply for capture')
  })
})
