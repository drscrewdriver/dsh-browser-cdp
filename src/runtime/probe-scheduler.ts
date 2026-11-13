/**
 * src/runtime/probe-scheduler.ts — when an attach probe pass is allowed to run.
 *
 * The attach probe can spawn a CLI subprocess (and, for the managed channels, a
 * browser), so three rules matter and each of them was missing at some point:
 *
 *   1. DEBOUNCE — the settings form emits one change per keystroke/drag. A burst
 *      must collapse into one pass, not N (the old code re-ran a queued pass for
 *      every event that landed while one was in flight).
 *   2. MIN INTERVAL — a slow pass (up to 3 s) must not be immediately re-entered
 *      by the next change; a floor keeps the machine from being pinned.
 *   3. SHARED RESULT — everyone who asked during the debounce window or while a
 *      pass was in flight gets the answer of that SAME pass. Ten callers must
 *      never mean ten probes.
 *
 * Trailing `latest-wins`: at most ONE extra pass is queued, so a storm cannot
 * build a backlog of stale probes behind a slow one.
 *
 * Pure: no host imports, injectable clock. The caller decides what a pass does
 * and how its outcome is observed.
 */

export interface ProbeSchedulerOptions {
  /** Quiet period before a pass starts (ms). */
  debounceMs?: number
  /** Floor between two pass starts (ms). */
  minIntervalMs?: number
  now?: () => number
  /** Called after every pass with its wall-clock duration. */
  onPass?: (latencyMs: number) => void
  /** Called when a pass throws (the pass itself is expected to swallow). */
  onError?: (error: unknown, latencyMs: number) => void
}

export type ProbeScheduler = (() => Promise<boolean>) & {
  /** Drop a pending pass and answer everyone parked with `false`. */
  dispose: () => void
  /** True while a pass is executing (tests/diagnostics). */
  isRunning: () => boolean
}

export function createProbeScheduler(
  run: () => Promise<boolean>,
  options: ProbeSchedulerOptions = {},
): ProbeScheduler {
  const debounceMs = options.debounceMs ?? 300
  const minIntervalMs = options.minIntervalMs ?? 1000
  const now = options.now ?? (() => Date.now())

  let running: Promise<boolean> | null = null
  let waiters: Array<(value: boolean) => void> = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let queued = false
  let lastStartedAt = 0

  /** Run exactly one pass and answer everyone who queued up for it. */
  const fire = async (): Promise<void> => {
    const mine = waiters
    waiters = []
    lastStartedAt = now()
    const startedAt = now()
    running = run()
    let result = false
    try {
      result = await running
      options.onPass?.(now() - startedAt)
    } catch (error) {
      // A pass is supposed to swallow its own failures; reaching here means one
      // escaped, so count it instead of letting it vanish.
      options.onError?.(error, now() - startedAt)
    } finally {
      running = null
    }
    for (const resolve of mine) resolve(result)
    // Latest-wins: at most one trailing pass, never a backlog.
    if (queued) {
      queued = false
      void trigger()
    }
  }

  const trigger = (): Promise<boolean> => {
    // Sharing the in-flight promise is what makes "10 events" one probe.
    if (running !== null) {
      queued = true
      return running
    }
    const settled = new Promise<boolean>((resolve) => { waiters.push(resolve) })
    if (timer === null) {
      const wait = Math.max(0, debounceMs, minIntervalMs - (now() - lastStartedAt))
      timer = setTimeout(() => {
        timer = null
        void fire()
      }, wait)
    }
    return settled
  }
  ;(trigger as ProbeScheduler).dispose = (): void => {
    if (timer !== null) { clearTimeout(timer); timer = null }
    const parked = waiters
    waiters = []
    for (const resolve of parked) resolve(false)
  }
  ;(trigger as ProbeScheduler).isRunning = (): boolean => running !== null
  return trigger as ProbeScheduler
}