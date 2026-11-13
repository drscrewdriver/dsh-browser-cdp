import { describe, expect, it } from 'vitest'
import { parseTabbitTasks } from '../src/cdp/tabbit-cli-link.ts'

/**
 * `diagnose` is the ONLY map from task → owned tab ids, and the panel needs it to
 * close a tab under the task that actually owns it (a tab owned by
 * `dsh-<session>` cannot be acquired by the panel's `dsh-panel`).
 */
describe('parseTabbitTasks', () => {
  it('extracts task name and owned tab ids', () => {
    const raw = [
      'TABBIT_PLAYWRIGHT_INSTANCE=ABC',
      '{"browser":"Tabbit Browser","ok":true,"tasks":[{"taskName":"dsh-panel","taskId":"task-1","ownedTabIds":[11,22],"ownedPageCount":2}]}',
    ].join('\n')
    expect(parseTabbitTasks(raw)).toEqual([
      { taskName: 'dsh-panel', taskId: 'task-1', ownedTabIds: [11, 22] },
    ])
  })

  it('uses the LAST json line when the CLI prints several', () => {
    const raw = [
      '{"tasks":[{"taskName":"stale","ownedTabIds":[1]}]}',
      '{"tasks":[{"taskName":"fresh","ownedTabIds":[2]}]}',
    ].join('\n')
    expect(parseTabbitTasks(raw)[0].taskName).toBe('fresh')
  })

  it('tolerates missing / malformed fields instead of throwing', () => {
    const raw = '{"tasks":[{"ownedTabIds":["not-a-number",3]},{},{"taskName":""},{"taskName":"ok"}]}'
    expect(parseTabbitTasks(raw)).toEqual([{ taskName: 'ok', taskId: '', ownedTabIds: [] }])
  })

  it('returns [] for empty or non-JSON output (browser down)', () => {
    expect(parseTabbitTasks('')).toEqual([])
    expect(parseTabbitTasks('not json at all')).toEqual([])
    expect(parseTabbitTasks('{"ok":false}')).toEqual([])
  })
})
