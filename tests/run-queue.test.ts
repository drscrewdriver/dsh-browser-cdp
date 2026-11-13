import { describe, expect, it } from 'vitest'
import { createRunQueue } from '../src/cast/run-queue.ts'

/**
 * The ordering rules are the whole value of this module, so they are pinned
 * directly: a must-run job may never be dropped or reordered, an opportunistic
 * job may never make the panel lag behind reality, and one key can never run
 * two jobs at once (that was the process-stacking bug).
 */
const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

describe('RunQueue', () => {
  it('serializes must-run jobs per key and keeps FIFO order', async () => {
    const queue = createRunQueue()
    const order: string[] = []
    let running = 0
    let maxRunning = 0
    const job = (name: string) => queue.run({
      key: 'b1',
      run: async () => {
        running += 1
        maxRunning = Math.max(maxRunning, running)
        await tick()
        order.push(name)
        running -= 1
        return name
      },
    })
    const results = await Promise.all([job('a'), job('b'), job('c')])
    expect(order).toEqual(['a', 'b', 'c'])
    expect(results).toEqual(['a', 'b', 'c'])
    expect(maxRunning).toBe(1)
  })

  it('runs different keys in parallel', async () => {
    const queue = createRunQueue()
    let running = 0
    let maxRunning = 0
    const job = (key: string) => queue.run({
      key,
      run: async () => {
        running += 1
        maxRunning = Math.max(maxRunning, running)
        await tick()
        running -= 1
      },
    })
    await Promise.all([job('a'), job('b')])
    expect(maxRunning).toBe(2)
  })

  it('replaces a pending opportunistic job instead of queueing behind it', async () => {
    const queue = createRunQueue()
    const events: string[] = []
    const slow = queue.run({ key: 'k', run: async () => { await tick(); return 'slow' } })
    // While `slow` runs, a frame request is dropped (it would be stale anyway).
    const dropped = await queue.latest({ key: 'k', run: async () => { events.push('frame-1'); return 'frame-1' } })
    expect(dropped).toBeNull()
    expect(events).toEqual([])
    await slow
  })

  it('a newer opportunistic job replaces an older waiting one', async () => {
    const queue = createRunQueue()
    const ran: string[] = []
    const first = queue.latest({ key: 'k', run: async () => { ran.push('first'); return 'first' } })
    const second = queue.latest({ key: 'k', run: async () => { ran.push('second'); return 'second' } })
    expect(await first).toBeNull()
    expect(await second).toBe('second')
    expect(ran).toEqual(['second'])
  })

  it('must-run jobs jump ahead of a pending opportunistic job', async () => {
    const queue = createRunQueue()
    const order: string[] = []
    // The frame is accepted but not started yet (it waits for the microtask).
    const frame = queue.latest({ key: 'k', run: async () => { order.push('frame'); return 'frame' } })
    const action = queue.run({ key: 'k', run: async () => { order.push('action'); return 'action' } })
    await Promise.all([frame, action])
    expect(order).toEqual(['action', 'frame'])
  })

  it('aborts a job that overruns its deadline and moves on', async () => {
    const queue = createRunQueue()
    const events: string[] = []
    const hung = queue.run({
      key: 'k',
      deadlineMs: 10,
      run: (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
    })
    await expect(hung).rejects.toThrow('aborted')
    // The lane is free again: a later job still runs.
    const after = await queue.run({ key: 'k', run: async () => { events.push('after'); return 'ok' } })
    expect(after).toBe('ok')
    expect(events).toEqual(['after'])
  })

  it('reports depth and busy per key', async () => {
    const queue = createRunQueue()
    const blocker = queue.run({ key: 'k', run: async () => { await tick() } })
    await Promise.resolve()
    expect(queue.isBusy('k')).toBe(true)
    const queued = queue.run({ key: 'k', run: async () => 'q' })
    expect(queue.depth('k')).toBe(1)
    await Promise.all([blocker, queued])
    expect(queue.isBusy('k')).toBe(false)
    expect(queue.depth('k')).toBe(0)
  })
})