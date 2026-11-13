import { beforeEach, describe, expect, it } from 'vitest'
import { bumpFrame, bumpProbe, bumpQueue, bumpTick, noteStatsError, resetStats, snapshotStats } from '../src/runtime/stats.ts'

/**
 * The counters exist to answer "is the automatic machinery still working" when
 * the panel is simply still. The property that makes them trustworthy is the
 * tick invariant: every tick records `scheduled` and exactly one terminal
 * reason, so `scheduled === ran + dropped` — a timer that silently stops calling
 * one of them shows up as `consistent: false` instead of a plausible zero.
 */
describe('stats snapshot', () => {
  beforeEach(() => { resetStats() })

  it('keeps the tick invariant while every tick reports a terminal reason', () => {
    bumpTick('scheduled'); bumpTick('scheduled'); bumpTick('scheduled')
    bumpTick('ran')
    bumpTick('dropped-busy'); bumpTick('no-owner')
    const tick = snapshotStats().tick as { scheduled: number; ran: number; dropped: number; consistent: boolean }
    expect(tick).toMatchObject({ scheduled: 3, ran: 1, dropped: 2, consistent: true })
  })

  it('flags a run that was never scheduled instead of hiding it', () => {
    bumpTick('scheduled')
    bumpTick('ran'); bumpTick('ran')
    const tick = snapshotStats().tick as { ran: number; dropped: number; consistent: boolean }
    expect(tick.ran).toBe(2)
    expect(tick.dropped).toBe(0)
    expect(tick.consistent).toBe(false)
  })

  it('buckets probe latency and remembers the last failure', () => {
    bumpProbe('run', 120)
    bumpProbe('run', 9000)
    bumpProbe('error', 40)
    noteStatsError('boom')
    const stats = snapshotStats() as {
      probe: { passes: number; lastLatencyMs: number; latencyBuckets: { counts: number[] } }
      lastError: string
    }
    expect(stats.probe.passes).toBe(3)
    expect(stats.probe.lastLatencyMs).toBe(40)
    // 120 → the 150ms bucket (index 1); 9000 → overflow tail; 40 → 50ms bucket.
    expect(stats.probe.latencyBuckets.counts[1]).toBe(1)
    expect(stats.probe.latencyBuckets.counts[0]).toBe(1)
    expect(stats.probe.latencyBuckets.counts.at(-1)).toBe(1)
    expect(stats.lastError).toBe('boom')
  })

  it('counts frames and queue decisions by reason', () => {
    bumpFrame('ok'); bumpFrame('dropped-busy')
    bumpQueue('enqueued'); bumpQueue('dropped-busy'); bumpQueue('replaced')
    const stats = snapshotStats() as {
      frame: { total: number; byReason: Record<string, number> }
      queue: { byReason: Record<string, number> }
    }
    expect(stats.frame).toMatchObject({ total: 2 })
    expect(stats.frame.byReason['ok']).toBe(1)
    expect(stats.queue.byReason).toMatchObject({ enqueued: 1, 'dropped-busy': 1, replaced: 1 })
  })

  it('reset clears everything for a fresh mount', () => {
    bumpTick('scheduled')
    resetStats()
    const tick = snapshotStats().tick as { scheduled: number; consistent: boolean }
    expect(tick.scheduled).toBe(0)
    expect(tick.consistent).toBe(true)
  })
})