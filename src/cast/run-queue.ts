/**
 * src/cast/run-queue.ts — the single spawn gate per backend.
 *
 * Why this exists (measured, not guessed): the tabbit inventory tick allowed a
 * 10 s grace against a 3 s period, so up to four `tabs` processes could stack on
 * one executor; the frame tick fires every 3 s and can take 2.6 s (75 s worst
 * case) per tab; and neither of them took the ego lock, so a tool call arriving
 * mid-capture ran concurrently against the same browser.
 *
 * Two priorities, one serial chain per key:
 *   run()      — must happen, FIFO. A tool call or a panel action may never be
 *                dropped, so it queues behind whatever is running.
 *   latest()   — may be dropped. Frames and inventories are idempotent snapshots:
 *                if one is already pending, the newer request REPLACES it; if a
 *                job is running, the request is dropped rather than queued. That
 *                is what keeps "panel lags a little" from becoming "panel never
 *                moves" (a queue of stale frames rendering forever behind).
 *
 * Deliberately small and pure: no timers, no host imports, injectable clock and
 * logger, so the ordering rules are unit-testable.
 */

export type JobPriority = 'must-run' | 'opportunistic'

export interface QueueJob<T> {
  /** Which backend this work belongs to. Same key = strictly serial. */
  key: string
  /** Optional hard deadline; the job's signal aborts and the lane moves on. */
  deadlineMs?: number
  run(signal: AbortSignal): Promise<T>
}

interface Pending {
  run(signal: AbortSignal): Promise<unknown>
  resolve(value: unknown): void
  reject(error: unknown): void
  deadlineMs?: number
}

interface Lane {
  /** must-run jobs, FIFO. */
  queue: Pending[]
  /** at most one opportunistic job waiting behind the running one. */
  latest: Pending | null
  busy: boolean
  running: Pending | null
}

export interface RunQueueOptions {
  now?: () => number
  logger?: { warn?: (message: string) => void }
  /** Observability hook: enqueued / ran / replaced / dropped-busy / aborted. */
  onEvent?: (key: string, event: 'enqueued' | 'ran' | 'replaced' | 'dropped-busy' | 'aborted' | 'failed') => void
}

export interface RunQueue {
  /** Must-run: FIFO per key, never dropped. */
  run<T>(job: QueueJob<T>): Promise<T>
  /** Opportunistic: replaces a pending job, dropped when one is already running. */
  latest<T>(job: QueueJob<T>): Promise<T | null>
  /** True while a job for this key is executing. */
  isBusy(key: string): boolean
  /** Queue depth for a key (running job excluded). */
  depth(key?: string): number
}

export function createRunQueue(options: RunQueueOptions = {}): RunQueue {
  const lanes = new Map<string, Lane>()
  const emit = (key: string, event: Parameters<NonNullable<RunQueueOptions['onEvent']>>[1]): void => {
    options.onEvent?.(key, event)
  }

  const lane = (key: string): Lane => {
    const existing = lanes.get(key)
    if (existing) return existing
    const created: Lane = { queue: [], latest: null, busy: false, running: null }
    lanes.set(key, created)
    return created
  }

  const pumpLater = (key: string): void => {
    // Start on a microtask, not synchronously: a burst of `latest()` calls in
    // the same tick (poll + panel + focus event) must collapse into ONE job.
    // Running the first synchronously would leave the rest to be dropped as
    // "busy", which is the behaviour this coalescing exists to avoid.
    queueMicrotask(() => { pump(key) })
  }

  const pump = (key: string): void => {
    const target = lane(key)
    if (target.busy) return
    target.busy = true
    void (async () => {
      try {
        while (target.queue.length > 0 || target.latest !== null) {
          // A must-run job always wins the slot: dropping a tool call to render
          // one more frame would be the wrong trade every time.
          const next = target.queue.shift() ?? target.latest
          if (next === null) break
          if (next === target.latest) target.latest = null
          target.running = next
          const controller = new AbortController()
          let timer: ReturnType<typeof setTimeout> | null = null
          if (next.deadlineMs !== undefined && next.deadlineMs > 0) {
            timer = setTimeout(() => {
              emit(key, 'aborted')
              try { controller.abort() } catch { /* ignore */ }
            }, next.deadlineMs)
          }
          let outcome: { ok: true; value: unknown } | { ok: false; error: unknown }
          try {
            outcome = { ok: true, value: await next.run(controller.signal) }
          } catch (error) {
            outcome = { ok: false, error }
          }
          if (timer !== null) clearTimeout(timer)
          // Clear the lane BEFORE waking the caller: `await queue.run(...)`
          // must never resume while `isBusy()` still says true.
          target.running = null
          if (outcome.ok) {
            emit(key, 'ran')
            next.resolve(outcome.value)
          } else {
            emit(key, 'failed')
            next.reject(outcome.error)
          }
        }
      } finally {
        target.running = null
        target.busy = false
        // A job may have arrived between the loop exit and the flag reset.
        if (target.queue.length > 0 || target.latest !== null) pump(key)
      }
    })()
  }

  const submit = <T>(job: QueueJob<T>, priority: JobPriority): Promise<T | null> => {
    const target = lane(job.key)
    const deferred = (resolve: (value: T | null) => void, reject: (error: unknown) => void): Pending => ({
      run: job.run as Pending['run'],
      resolve: (value) => resolve(value as T),
      reject,
      ...(job.deadlineMs === undefined ? {} : { deadlineMs: job.deadlineMs }),
    })
    if (priority === 'must-run') {
      return new Promise<T | null>((resolve, reject) => {
        target.queue.push(deferred(resolve, reject))
        emit(job.key, 'enqueued')
        pump(job.key)
      })
    }
    // opportunistic: a job already running means this frame is stale by the
    // time it would run, so drop it instead of queueing behind it.
    if (target.busy) {
      emit(job.key, 'dropped-busy')
      return Promise.resolve(null)
    }
    return new Promise<T | null>((resolve, reject) => {
      if (target.latest !== null) {
        // Coalescing: only the newest snapshot is worth rendering.
        emit(job.key, 'replaced')
        target.latest.resolve(null)
      }
      target.latest = deferred(resolve, reject)
      emit(job.key, 'enqueued')
      pumpLater(job.key)
    })
  }

  return {
    run: <T>(job: QueueJob<T>) => submit(job, 'must-run') as Promise<T>,
    latest: <T>(job: QueueJob<T>) => submit(job, 'opportunistic'),
    isBusy: (key) => lanes.get(key)?.running != null,
    depth: (key) => {
      if (key === undefined) {
        let total = 0
        for (const value of lanes.values()) total += value.queue.length + (value.latest === null ? 0 : 1)
        return total
      }
      const value = lanes.get(key)
      return value === undefined ? 0 : value.queue.length + (value.latest === null ? 0 : 1)
    },
  }
}