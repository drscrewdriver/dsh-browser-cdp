/**
 * src/runtime/stats.ts — process-local counters for the AUTOMATIC sources.
 *
 * The panel's failure mode is never "a tool returned an error"; it is "nothing
 * happens and nobody can say why". Every automatic source (attach probes, tab
 * inventory ticks, frame captures) therefore records HOW MANY times it was
 * scheduled and WHY the ones that did not run were skipped — the invariant
 * `scheduled === ran + dropped` is the cheapest possible alarm for a timer that
 * quietly stopped working.
 *
 * Pure and host-free: no ctx, no fs, no timers. Callers bump, the doctor/route
 * read a snapshot. Process-local by design — these numbers describe THIS mount
 * and reset with it, so nothing here may be persisted (see the attach-cache
 * contract in cdp-targets.ts §1).
 */

/** One counter: how many times, split by reason, plus the last hit. */
interface Bucket {
  total: number
  byReason: Record<string, number>
  lastAt: number
}

const makeBucket = (): Bucket => ({ total: 0, byReason: {}, lastAt: 0 })

/** Latency buckets in ms; last one is the overflow. Cover 300ms probes and 2.6s frames. */
const LATENCY_EDGES = [50, 150, 300, 800, 2000, 5000] as const

interface StatsState {
  startedAt: number
  probe: Bucket
  tick: Bucket
  frame: Bucket
  queue: Bucket
  lastProbeLatencyMs: number
  probeLatency: number[]
  lastError: string
}

const fresh = (): StatsState => ({
  startedAt: Date.now(),
  probe: makeBucket(),
  tick: makeBucket(),
  frame: makeBucket(),
  queue: makeBucket(),
  lastProbeLatencyMs: 0,
  probeLatency: LATENCY_EDGES.map(() => 0).concat(0),
  lastError: '',
})

let state: StatsState = fresh()

function bump(bucket: Bucket, reason: string): void {
  bucket.total += 1
  bucket.byReason[reason] = (bucket.byReason[reason] ?? 0) + 1
  bucket.lastAt = Date.now()
}

/**
 * An attach probe pass. `latencyMs` is optional so a caller that only knows
 * "this happened" still counts; the pass-level helper in index.ts passes it.
 */
export function bumpProbe(reason: 'run' | 'error', latencyMs?: number): void {
  bump(state.probe, reason)
  if (typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0) {
    state.lastProbeLatencyMs = Math.round(latencyMs)
    let index = LATENCY_EDGES.findIndex((edge) => latencyMs <= edge)
    if (index === -1) index = LATENCY_EDGES.length
    state.probeLatency[index] = (state.probeLatency[index] ?? 0) + 1
  }
}

/**
 * One scheduler tick. Call `bumpTick('scheduled')` when the timer fires, then
 * exactly one terminal reason (`ran` / any skip reason) — that pairing is what
 * makes the dropped-vs-ran invariant meaningful.
 */
export function bumpTick(reason: string): void {
  bump(state.tick, reason)
}

/** One frame landed (`ok`) or was skipped for `reason`. */
export function bumpFrame(reason: string): void {
  bump(state.frame, reason)
}

/** One queue decision: `enqueued` / `replaced` / `rejected`. */
export function bumpQueue(reason: string): void {
  bump(state.queue, reason)
}

/** Remember the newest failure so the doctor can quote it verbatim. */
export function noteStatsError(message: string): void {
  state.lastError = String(message).slice(0, 300)
}

/** Shape of the read-only view, so callers do not have to cast `unknown`. */
export interface StatsSnapshot {
  startedAt: number
  uptimeMs: number
  probe: {
    passes: number
    byReason: Record<string, number>
    lastAt: number
    lastLatencyMs: number
    latencyBuckets: { edges: readonly number[]; counts: number[] }
  }
  tick: {
    scheduled: number
    ran: number
    dropped: number
    byReason: Record<string, number>
    lastAt: number
    consistent: boolean
  }
  frame: { total: number; byReason: Record<string, number>; lastAt: number }
  queue: { total: number; byReason: Record<string, number>; lastAt: number }
  lastError: string | null
}

/**
 * Read-only view. `tick.dropped` is derived (`total - ran`) rather than counted
 * separately, so a caller that forgets a terminal reason shows up as an
 * inconsistency instead of a plausible-looking zero.
 */
export function snapshotStats(): StatsSnapshot {
  // `scheduled` is a REASON, not `total`: every tick records `scheduled` plus one
  // terminal reason, so the invariant is `scheduled === ran + dropped` where
  // dropped is derived. Deriving instead of counting means a timer that forgets
  // its terminal reason shows up as `consistent: false` rather than a tidy zero.
  const tickScheduled = state.tick.byReason.scheduled ?? 0
  const tickRan = state.tick.byReason.ran ?? 0
  const tickDropped = Math.max(0, tickScheduled - tickRan)
  return {
    startedAt: state.startedAt,
    uptimeMs: Date.now() - state.startedAt,
    probe: {
      passes: state.probe.total,
      byReason: { ...state.probe.byReason },
      lastAt: state.probe.lastAt,
      lastLatencyMs: state.lastProbeLatencyMs,
      // Bucketed latency: index i means "<= LATENCY_EDGES[i]", the tail is overflow.
      latencyBuckets: {
        edges: LATENCY_EDGES,
        counts: [...state.probeLatency],
      },
    },
    tick: {
      scheduled: tickScheduled,
      ran: tickRan,
      dropped: tickDropped,
      byReason: { ...state.tick.byReason },
      lastAt: state.tick.lastAt,
      // More runs than schedules means a caller bumped `ran` without a tick.
      consistent: tickRan <= tickScheduled,
    },
    frame: { total: state.frame.total, byReason: { ...state.frame.byReason }, lastAt: state.frame.lastAt },
    queue: { total: state.queue.total, byReason: { ...state.queue.byReason }, lastAt: state.queue.lastAt },
    lastError: state.lastError,
  }
}

/** Drop everything (tests, and a fresh mount after dispose). */
export function resetStats(): void {
  state = fresh()
}