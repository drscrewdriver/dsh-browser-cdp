import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProbeScheduler } from '../src/runtime/probe-scheduler.ts'

/**
 * These four rules are why the scheduler exists; before it they were inline in
 * `apply()` and untestable. The expensive failure they prevent is a probe storm:
 * every pass can spawn a CLI subprocess (and, on the managed channels, a
 * browser), so "one pass per settings drag" is a correctness property, not an
 * optimisation.
 */
describe('createProbeScheduler', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('collapses a burst into one pass and answers every caller with its result', async () => {
    let passes = 0
    const schedule = createProbeScheduler(async () => { passes += 1; return true }, { debounceMs: 300, minIntervalMs: 0 })
    const callers = Array.from({ length: 10 }, () => schedule())
    await vi.advanceTimersByTimeAsync(300)
    const results = await Promise.all(callers)
    expect(passes).toBe(1)
    expect(results).toEqual(Array.from({ length: 10 }, () => true))
  })

  it('keeps a floor between two pass starts', async () => {
    let passes = 0
    const schedule = createProbeScheduler(async () => { passes += 1; return true }, { debounceMs: 0, minIntervalMs: 1000 })
    const first = schedule()
    await vi.advanceTimersByTimeAsync(0)
    expect(passes).toBe(1)
    const second = schedule()
    await vi.advanceTimersByTimeAsync(500)
    expect(passes).toBe(1) // still inside the floor
    await vi.advanceTimersByTimeAsync(600)
    expect(passes).toBe(2)
    expect(await first).toBe(true)
    expect(await second).toBe(true)
  })

  it('shares the in-flight pass and runs at most ONE trailing pass', async () => {
    let passes = 0
    const schedule = createProbeScheduler(async () => {
      passes += 1
      await new Promise((resolve) => setTimeout(resolve, 100))
      return true
    }, { debounceMs: 0, minIntervalMs: 0 })
    const first = schedule()
    await vi.advanceTimersByTimeAsync(0)
    const shared = [schedule(), schedule(), schedule()]
    await vi.advanceTimersByTimeAsync(300)
    const results = await Promise.all(shared)
    // They shared the IN-FLIGHT pass, so they get its result, not a fresh probe.
    expect(results).toEqual([true, true, true])
    await first
    // 1 in flight + exactly 1 trailing, never 4.
    expect(passes).toBe(2)
  })

  it('dispose cancels the pending pass and answers parked callers with false', async () => {
    let passes = 0
    const schedule = createProbeScheduler(async () => { passes += 1; return true }, { debounceMs: 300, minIntervalMs: 0 })
    const parked = schedule()
    schedule.dispose()
    await vi.advanceTimersByTimeAsync(500)
    expect(await parked).toBe(false)
    expect(passes).toBe(0)
  })

  it('reports pass latency and escaped errors', async () => {
    const seen: number[] = []
    const errors: string[] = []
    let clock = 0
    const schedule = createProbeScheduler(async () => {
      clock += 42
      throw new Error('boom')
    }, { debounceMs: 0, minIntervalMs: 0, now: () => clock, onPass: (ms) => seen.push(ms), onError: (error) => errors.push(String(error)) })
    const p = schedule()
    await vi.advanceTimersByTimeAsync(0)
    expect(await p).toBe(false)
    expect(seen).toEqual([])
    expect(errors).toEqual(['Error: boom'])
  })
})