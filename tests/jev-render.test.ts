import { describe, expect, it } from 'vitest'
import type { SpawnSpec, SubprocessHandle, SubprocessService } from '../src/types.ts'
import {
  DEFAULT_RENDER_TUNING,
  buildWorkerScript,
  parseWorkerReplies,
  runRenderCall,
} from '../src/jev/render.ts'

/**
 * Render-adapter acceptance. The adapter exists because the host's spawn
 * contract takes a FIXED stdin string, so a session-shaped worker is driven as
 * one script per call. Two claims matter and are tested as claims:
 *
 *   1. The script is emitted in the order the worker needs — `connect` FIRST,
 *      with ids that let replies be matched by id rather than position.
 *   2. A worker-level failure is DATA, not an exception. `parseWorkerReplies`
 *      tolerates noise, and a missing reply becomes an explicit step failure
 *      rather than an `undefined` that reads like an empty result.
 *
 * No process is ever spawned: the fake `SubprocessService` returns whatever
 * stdout the test dictates.
 */

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
const fail = (id: number, message: string): string => JSON.stringify({ v: 1, id, ok: false, error: { code: 'call-failed', message } })

const connectOk = { targetId: 'T1', targetUrl: 'https://example.test/', sessionId: 'S1' }

describe('jev render · the worker script', () => {
  it('puts connect first and numbers every line from 1', () => {
    const script = buildWorkerScript({
      wsUrl: 'ws://127.0.0.1:9223/devtools/browser/abc',
      steps: [{ method: 'capture', params: { format: 'jpeg' } }, { method: 'interactive' }],
    })
    const lines = script.trim().split('\n')
    expect(lines).toHaveLength(3)
    const first = JSON.parse(lines[0]!) as { id: number; method: string; params: { wsUrl: string } }
    expect(first.id).toBe(1)
    expect(first.method).toBe('connect')
    expect(first.params.wsUrl).toBe('ws://127.0.0.1:9223/devtools/browser/abc')
    expect((JSON.parse(lines[1]!) as { id: number }).id).toBe(2)
    expect((JSON.parse(lines[2]!) as { id: number }).id).toBe(3)
  })

  it('omits targetId when it is empty, so the worker auto-picks a page', () => {
    const script = buildWorkerScript({ wsUrl: 'ws://x', targetId: '', steps: [] })
    const first = JSON.parse(script.trim()) as { params: Record<string, unknown> }
    expect('targetId' in first.params).toBe(false)
  })

  it('terminates every line, including the last', () => {
    // A missing final newline leaves the worker waiting on a partial line.
    const script = buildWorkerScript({ wsUrl: 'ws://x', steps: [{ method: 'ping' }] })
    expect(script.endsWith('\n')).toBe(true)
    expect(script.split('\n').filter((line) => line !== '')).toHaveLength(2)
  })
})

describe('jev render · reply parsing tolerates noise', () => {
  it('reads replies when they are interleaved with log lines', () => {
    const stdout = [
      'some banner the worker printed',
      reply(1, connectOk),
      '[cdp-render] doing a thing',
      reply(2, { bytes: 100 }),
    ].join('\n')
    const replies = parseWorkerReplies(stdout)
    expect(replies.size).toBe(2)
    expect(replies.get(2)?.result).toEqual({ bytes: 100 })
  })

  it('skips a truncated final line instead of losing the earlier replies', () => {
    const stdout = `${reply(1, connectOk)}\n{"id":2,"ok":true,"resu`
    const replies = parseWorkerReplies(stdout)
    expect(replies.has(1)).toBe(true)
    expect(replies.has(2)).toBe(false)
  })

  it('ignores a JSON object with no numeric id (an unsolicited log)', () => {
    expect(parseWorkerReplies('{"level":"info","msg":"hi"}').size).toBe(0)
  })

  it('returns an empty map for empty output rather than throwing', () => {
    expect(parseWorkerReplies('').size).toBe(0)
  })
})

describe('jev render · one call, connect + steps', () => {
  it('runs connect then the steps and reports each one', async () => {
    const stdout = [reply(1, connectOk), reply(2, { data: 'AAAA', bytes: 3 }), reply(3, { candidates: [] })].join('\n')
    const { service, specs } = fakeSpawn(stdout)
    const result = await runRenderCall(service, {
      workerPath: 'C:/repo/bin/cdp-render-worker.mjs',
      wsUrl: 'ws://127.0.0.1:9223/devtools/browser/abc',
      steps: [{ method: 'capture', params: { format: 'jpeg' } }, { method: 'interactive' }],
    })
    expect(result.connected).toEqual(connectOk)
    expect(result.steps.map((step) => step.ok)).toEqual([true, true])
    expect(result.steps[0]?.method).toBe('capture')
    expect(result.exitCode).toBe(0)
    expect(specs).toHaveLength(1)
    // The worker path is the script argument, not baked into a shell string —
    // a path with spaces must survive.
    expect(specs[0]?.argv[1]).toBe('C:/repo/bin/cdp-render-worker.mjs')
  })

  it('turns a missing step reply into an explicit failure, not undefined', async () => {
    // The failure this prevents: `result.steps[0].result` being undefined and
    // reading downstream as "the page had no candidates".
    const { service } = fakeSpawn(reply(1, connectOk))
    const result = await runRenderCall(service, {
      workerPath: 'w.mjs',
      wsUrl: 'ws://x',
      steps: [{ method: 'capture' }],
    })
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]?.ok).toBe(false)
    expect(result.steps[0]?.error).toContain('no reply for capture')
  })

  it('carries a worker-level error message through verbatim', async () => {
    const stdout = [reply(1, connectOk), fail(2, "'Accessibility.getFullAXTree' wasn't found")].join('\n')
    const { service } = fakeSpawn(stdout)
    const result = await runRenderCall(service, { workerPath: 'w.mjs', wsUrl: 'ws://x', steps: [{ method: 'interactive' }] })
    // The exact message from the browser-level-endpoint defect is preserved:
    // it is the clue that identifies the cause.
    expect(result.steps[0]?.error).toContain("wasn't found")
  })

  it('reports a failed connect as null rather than throwing', async () => {
    const { service } = fakeSpawn(fail(1, 'connect timed out after 8000ms'))
    const result = await runRenderCall(service, { workerPath: 'w.mjs', wsUrl: 'ws://x', steps: [{ method: 'ping' }] })
    expect(result.connected).toBeNull()
    expect(result.steps[0]?.ok).toBe(false)
  })

  it('still returns the worker log when the call failed', async () => {
    const { service } = fakeSpawn('', '[cdp-render] boom', 1)
    const result = await runRenderCall(service, { workerPath: 'w.mjs', wsUrl: 'ws://x', steps: [] })
    expect(result.log).toContain('boom')
    expect(result.exitCode).toBe(1)
  })

  it('budgets stdout for a base64 image, not for a log line', async () => {
    // Measured: 140,220 bytes -> ~187 K base64 chars on one line. A small
    // ceiling would truncate exactly the payload the call exists to fetch.
    expect(DEFAULT_RENDER_TUNING.stdoutMaxBytes).toBeGreaterThan(1024 * 1024)
  })

  it('passes cwd and env through only when supplied', async () => {
    const { service, specs } = fakeSpawn(reply(1, connectOk))
    await runRenderCall(service, { workerPath: 'w.mjs', wsUrl: 'ws://x', steps: [] })
    expect(specs[0]?.cwd).toBeUndefined()
    expect(specs[0]?.env).toBeUndefined()

    const second = fakeSpawn(reply(1, connectOk))
    await runRenderCall(second.service, {
      workerPath: 'w.mjs',
      wsUrl: 'ws://x',
      steps: [],
      cwd: 'C:/repo',
      env: { PATH: '/usr/bin' },
    })
    expect(second.specs[0]?.cwd).toBe('C:/repo')
    expect(second.specs[0]?.env).toEqual({ PATH: '/usr/bin' })
  })

  it('honours a tuning override for the host-side grace', async () => {
    const { service, specs } = fakeSpawn(reply(1, connectOk))
    await runRenderCall(service, { workerPath: 'w.mjs', wsUrl: 'ws://x', steps: [], tuning: { graceMs: 1234 } })
    expect(specs[0]?.graceMs).toBe(1234)
  })

  it('returns an empty step list when nothing was asked of it', async () => {
    const { service } = fakeSpawn(reply(1, connectOk))
    const result = await runRenderCall(service, { workerPath: 'w.mjs', wsUrl: 'ws://x', steps: [] })
    expect(result.connected).toEqual(connectOk)
    expect(result.steps).toEqual([])
  })
})
