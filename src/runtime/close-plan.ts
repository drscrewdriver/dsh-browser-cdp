/**
 * Which task should close a tab.
 *
 * Tabbit ownership is per task: `nodejs --tab <id>` acquires the tab under the
 * task it runs as, and a tab owned by `dsh-<session>` (created by a tool call)
 * cannot be acquired by the panel's `dsh-panel` task. Closing from the wrong task
 * therefore fails — which is exactly why the panel's × looked dead.
 *
 * Order: the diagnostic owner first (authoritative), then whatever task this host
 * last used, then the scratch name used by on-demand captures.
 */
export interface CloseTaskCandidate {
  taskName: string
  ownedTabIds: readonly number[]
}

export const CLOSE_SCRATCH_TASK = 'dsh-panel-shot'

export function planCloseTasks(
  tasks: readonly CloseTaskCandidate[],
  tabId: number,
  lastTaskName: string,
): string[] {
  const owner = tasks.find((task) => task.ownedTabIds.includes(tabId))?.taskName ?? ''
  const ordered = [owner, lastTaskName, CLOSE_SCRATCH_TASK]
    .map((name) => name.trim())
    .filter((name) => name !== '')
  return [...new Set(ordered)]
}
