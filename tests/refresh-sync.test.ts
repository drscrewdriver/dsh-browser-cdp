import { describe, expect, it, vi } from 'vitest'
import { planRefreshSync, runRefreshSync } from '../src/runtime/refresh-sync.ts'

describe('planRefreshSync', () => {
  it('routes the CDP channel to the worker attach path', () => {
    const plan = planRefreshSync({ kind: 'cdp', hasTask: false, allowColdStart: false })
    expect(plan).toEqual({ list: false, frame: false, adopt: false, reason: 'worker-attach' })
  })

  it('lists tabbit tabs without a task, and never adopts under a guessed name', () => {
    for (const allowColdStart of [false, true]) {
      const plan = planRefreshSync({ kind: 'tabbit-cli', hasTask: false, allowColdStart })
      expect(plan.list).toBe(true)
      expect(plan.frame).toBe(false)
      expect(plan.adopt).toBe(false)
      expect(plan.reason).toBe('list-only-needs-task')
    }
  })

  it('frames on refresh whenever a live task already exists', () => {
    const plan = planRefreshSync({ kind: 'tabbit-cli', hasTask: true, allowColdStart: false })
    expect(plan).toEqual({ list: true, frame: true, adopt: false, reason: 'task-live' })
  })

  it('keeps ego-cli / lightpanda at probe-only (their frames come from the runtime)', () => {
    for (const kind of ['ego-cli', 'lightpanda'] as const) {
      const plan = planRefreshSync({ kind, hasTask: false, allowColdStart: true })
      expect(plan).toEqual({ list: false, frame: false, adopt: false, reason: 'probe-only' })
    }
  })

  it('is a no-op without an active link', () => {
    expect(planRefreshSync({ kind: '', hasTask: false, allowColdStart: true }).reason).toBe('no-active-link')
  })
})

describe('runRefreshSync', () => {
  const makeDeps = (overrides: Partial<Parameters<typeof runRefreshSync>[1]> = {}) => {
    const calls: string[] = []
    const deps = {
      listTabs: vi.fn(async () => {
        calls.push('list')
        return { tabs: [{ tabId: 11, active: false }, { tabId: 22, active: true }], total: 2 }
      }),
      captureFrame: vi.fn(async (tabId: number) => {
        calls.push(`frame:${tabId}`)
        return { ok: true, bytes: 1024 }
      }),
      rememberTask: vi.fn(() => { calls.push('remember') }),
      publish: vi.fn((rows: Array<{ targetId: string; active: boolean }>) => { calls.push(`publish:${rows.length}`) }),
      pickActive: vi.fn((rows: Array<{ targetId: string; active: boolean }>) => rows.find((r) => r.active)?.targetId ?? null),
      ...overrides,
    }
    return { deps, calls }
  }

  it('publishes the rows BEFORE capturing, so the strip appears even if the frame fails', async () => {
    const { deps, calls } = makeDeps({ captureFrame: vi.fn(async () => ({ ok: false, bytes: 0 })) })
    const out = await runRefreshSync(planRefreshSync({ kind: 'tabbit-cli', hasTask: true, allowColdStart: false }), deps)
    expect(calls[0]).toBe('list')
    expect(calls[1]).toBe('publish:2')
    expect(out).toEqual({ listed: 2, framed: false, adopted: false, reason: 'frame-failed' })
  })

  it('captures the ACTIVE row, not the first one', async () => {
    const { deps, calls } = makeDeps()
    const out = await runRefreshSync(planRefreshSync({ kind: 'tabbit-cli', hasTask: true, allowColdStart: false }), deps)
    expect(calls).toContain('frame:22')
    expect(out.framed).toBe(true)
    expect(out.adopted).toBe(false)
  })

  it('remembers the task name only on an adopting plan (none today, kept for the seam)', async () => {
    const adopting = makeDeps()
    await runRefreshSync({ list: true, frame: true, adopt: true, reason: 'adopt-test' }, adopting.deps)
    expect(adopting.deps.rememberTask).toHaveBeenCalledTimes(1)

    const plain = makeDeps()
    await runRefreshSync(planRefreshSync({ kind: 'tabbit-cli', hasTask: true, allowColdStart: true }), plain.deps)
    expect(plain.deps.rememberTask).not.toHaveBeenCalled()
  })

  it('list-only runs never touch the capture path', async () => {
    const { deps } = makeDeps()
    const out = await runRefreshSync(planRefreshSync({ kind: 'tabbit-cli', hasTask: false, allowColdStart: false }), deps)
    expect(deps.captureFrame).not.toHaveBeenCalled()
    expect(out).toEqual({ listed: 2, framed: false, adopted: false, reason: 'list-only-needs-task' })
  })

  it('reports no-tabs instead of publishing an empty strip', async () => {
    const { deps } = makeDeps({ listTabs: vi.fn(async () => ({ tabs: [], total: 0 })) })
    const out = await runRefreshSync(planRefreshSync({ kind: 'tabbit-cli', hasTask: false, allowColdStart: false }), deps)
    expect(deps.publish).not.toHaveBeenCalled()
    expect(out.reason).toBe('no-tabs')
  })

  it('does nothing at all for channels without a list step', async () => {
    const { deps } = makeDeps()
    const out = await runRefreshSync(planRefreshSync({ kind: 'cdp', hasTask: true, allowColdStart: true }), deps)
    expect(deps.listTabs).not.toHaveBeenCalled()
    expect(out).toEqual({ listed: 0, framed: false, adopted: false, reason: 'worker-attach' })
  })
})
