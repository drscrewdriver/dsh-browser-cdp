/**
 * Tabbit close path — regression guard for the panel × on the tabbit channel.
 *
 * The four defects this pins down (all measured on tabbit-cli 1.21.21):
 *  B1 the _closeInFlight guard was released BEFORE the close was fired, so the
 *     3 s inventory poller immediately took the executor and the close receipt
 *     queued behind it (observed: 80 s, tab still open);
 *  B2 `owned` tabs were finished as TABBIT_PANEL_TASK no matter who really held
 *     them, so a tab owned by `dsh-<session>` could never be closed;
 *  B4 finishing a task left `_tabbitLastTaskName` pointing at a dead task, and
 *     the poller then ran against it (EMPTY_OUTPUT / pointless recycle);
 *  B5 `lastClose` was written twice — a synchronous "dispatched / stillThere"
 *     record, then overwritten async — so stats showed a fake terminal state.
 *
 * The assertions are source-level because the behaviour needs a live tabbit
 * CLI; the pure decision logic is covered by tests/close-plan.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const HOST = readFileSync(join(here, '..', 'src', 'index.ts'), 'utf8')

/** The tabbit close branch only (stops before the panel-action handler). */
function closeSegment(): string {
  const start = HOST.indexOf("async (targetId: string): Promise<{ ok: boolean; reason: string }> => {")
  const end = HOST.indexOf('// Tab activation', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  return HOST.slice(start, end)
}

describe('tabbit close: B1 inflight guard covers the close itself', () => {
  it('releases through a closure, not a bare flag reset in finally', () => {
    const seg = closeSegment()
    expect(seg).toContain('const release =')
    // the guard must be released at the END of the async chain
    const finallyIdx = seg.indexOf('.finally(')
    const fireIdx = seg.indexOf('runTabbitSnippet(')
    expect(finallyIdx).toBeGreaterThan(fireIdx)
    expect(seg.slice(finallyIdx, finallyIdx + 200)).toContain('release()')
  })

  it('has a watchdog so a snippet that never resolves cannot stall the poller forever', () => {
    const seg = closeSegment()
    expect(HOST).toContain('CLOSE_INFLIGHT_MAX_MS')
    expect(seg).toContain('setTimeout(release')
    expect(seg).toContain('clearTimeout')
  })
})

describe('tabbit close: B2/B3 ownership comes from planCloseTasks', () => {
  it('uses the shared candidate planner instead of ad-hoc branching', () => {
    const seg = closeSegment()
    expect(seg).toContain('planCloseTasks(')
    expect(seg).toContain('parseTabbitTasks(')
  })

  it('never finishes the panel task unconditionally', () => {
    const seg = closeSegment()
    expect(seg).not.toContain('tabbitFinishTask(ctx.subprocess, cli.cliPath, TABBIT_PANEL_TASK, false)')
    expect(seg).toContain('tabbitFinishTask(ctx.subprocess, cli.cliPath, owner')
  })

  it('falls back to the last used task, then the scratch task', () => {
    const seg = closeSegment()
    expect(seg).toContain('_tabbitLastTaskName')
    expect(seg).toContain('CLOSE_SCRATCH_TASK')
  })
})

describe('tabbit close: B4 finishing a task forgets its state', () => {
  it('calls forgetTabbitTaskState and clears the stale task name', () => {
    const seg = closeSegment()
    expect(seg).toContain('forgetTabbitTaskState()')
    expect(seg).toContain('_tabbitLastTaskName =')
  })
})

describe('tabbit close: B5 lastClose is written once, at the end of the chain', () => {
  it('has no synchronous dispatched record before the return', () => {
    const seg = closeSegment()
    const retIdx = seg.lastIndexOf('return { ok: true, reason:')
    const before = seg.slice(0, retIdx)
    expect(before).not.toContain('status: "dispatched"')
    expect(before).not.toContain("status: 'dispatched'")
  })

  it('records both the success and the failure terminal states', () => {
    const seg = closeSegment()
    const writes = (seg.match(/lastClose = \{/g) ?? []).length
    expect(writes).toBe(2)
  })
})

describe('tabbit close: B6 refuses to close the last tab', () => {
  it('answers last-tab instead of emptying the space', () => {
    const seg = closeSegment()
    expect(seg).toContain("reason: 'last-tab'")
    expect(seg).toContain('tabs.length <= 1')
  })
})
