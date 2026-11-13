import { describe, expect, it } from 'vitest'
import { CLOSE_SCRATCH_TASK, planCloseTasks } from '../src/runtime/close-plan.ts'

/**
 * The panel's × was dead because the close ran under the wrong task: tabbit
 * ownership is per task, so a tab owned by `dsh-<session>` refuses acquisition by
 * `dsh-panel`. The candidate order below is what makes the close land.
 */
describe('planCloseTasks', () => {
  it('puts the diagnostic owner first', () => {
    const tasks = [
      { taskName: 'dsh-panel', ownedTabIds: [1, 2] },
      { taskName: 'dsh-abc', ownedTabIds: [3] },
    ]
    expect(planCloseTasks(tasks, 3, 'dsh-panel')).toEqual(['dsh-abc', 'dsh-panel', CLOSE_SCRATCH_TASK])
  })

  it('falls back to the last task, then the scratch name, when nobody owns it', () => {
    expect(planCloseTasks([], 99, 'dsh-panel')).toEqual(['dsh-panel', CLOSE_SCRATCH_TASK])
    expect(planCloseTasks([], 99, '')).toEqual([CLOSE_SCRATCH_TASK])
  })

  it('never repeats a name and never emits an empty one', () => {
    const tasks = [{ taskName: 'dsh-panel', ownedTabIds: [7] }]
    expect(planCloseTasks(tasks, 7, 'dsh-panel')).toEqual(['dsh-panel', CLOSE_SCRATCH_TASK])
    expect(planCloseTasks([{ taskName: '  ', ownedTabIds: [7] }], 7, ' ')).toEqual([CLOSE_SCRATCH_TASK])
  })

  it('ignores tabs owned by several tasks in favour of the first match', () => {
    const tasks = [
      { taskName: 'first', ownedTabIds: [5] },
      { taskName: 'second', ownedTabIds: [5] },
    ]
    expect(planCloseTasks(tasks, 5, '')).toEqual(['first', CLOSE_SCRATCH_TASK])
  })
})
