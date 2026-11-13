/**
 * Refresh-time sync — "click ⟳ and see the active browser object NOW".
 *
 * Background: after a host restart the panel is empty for two different reasons,
 * and only one of them used to be fixable without a tool call:
 *
 *  - CDP channels: the worker knows nothing until an attach probe runs.
 *  - CLI channels (tabbit): the frame poller refuses to run without a task
 *    owner (`no-owner`), and the task is only created by a tool call.
 *
 * Measured on tabbit-cli 1.21.21 (see tasks.md 附录 D):
 *
 *  - `tabs --task <any name>` is READ-ONLY. It lists every tab with `state`,
 *    `active` and `windowId` even when that task was never created, and it does
 *    not launch the browser if it is closed. So the tab strip can be synced with
 *    ZERO side effects.
 *  - `nodejs --task <new name> --tab <id>` auto-creates the task AND acquires
 *    exactly that tab (`acquisition.tabIds:[<id>]`, 158 ms), i.e. one call gets a
 *    live frame of the active object. Tempting on refresh, but the task name is
 *    `dsh-<sessionToken>` and the refresh handler has no session id, so adopting
 *    under a guessed name would fork ownership (panel task owns the tab, the next
 *    tool task cannot acquire it). So adoption is NOT offered on refresh: the
 *    picture arrives with the first tool call, which uses the right task.
 *
 * Net: refresh syncs the OBJECT LIST with zero side effects, and captures a frame
 * whenever a task already exists.
 */

export type RefreshSyncKind = 'cdp' | 'ego-cli' | 'lightpanda' | 'tabbit-cli' | ''

export interface RefreshSyncInput {
  kind: RefreshSyncKind
  /** Is there a live task owner already (i.e. a tool call established one)? */
  hasTask: boolean
  /**
   * Config `allowProbeColdStart`. Kept in the signature because the caller has it
   * and future channels may use it; the tabbit branch does not adopt on refresh
   * for the ownership reason above.
   */
  allowColdStart: boolean
}

export interface RefreshSyncPlan {
  /** Read the tab inventory (no side effects). */
  list: boolean
  /** Capture one frame of the active object (acquires it if needed). */
  frame: boolean
  /** True when the frame step has to create the task first. */
  adopt: boolean
  reason: string
}

export function planRefreshSync(input: RefreshSyncInput): RefreshSyncPlan {
  const { kind, hasTask, allowColdStart } = input
  if (kind === 'cdp') {
    // The worker owns this path: re-probe the endpoint and re-read spaces.
    return { list: false, frame: false, adopt: false, reason: 'worker-attach' }
  }
  if (kind === 'tabbit-cli') {
    if (hasTask) return { list: true, frame: true, adopt: false, reason: 'task-live' }
    // No task: the list is free, the frame has to wait for a tool call to name the
    // task correctly (see the ownership note at the top).
    return { list: true, frame: false, adopt: false, reason: 'list-only-needs-task' }
  }
  if (kind === 'ego-cli' || kind === 'lightpanda') {
    // Their frames come from the ego runtime / worker, not from a read-only list;
    // the only safe refresh action is re-probing readiness.
    return { list: false, frame: false, adopt: false, reason: 'probe-only' }
  }
  return { list: false, frame: false, adopt: false, reason: 'no-active-link' }
}

export interface RefreshSyncDeps {
  /** Read-only inventory. */
  listTabs: () => Promise<{ tabs: Array<{ tabId: number; active?: boolean; windowId?: number }>; total: number } | null>
  /** Capture one frame of `tabId`, acquiring the tab if the task does not exist. */
  captureFrame: (tabId: number) => Promise<{ ok: boolean; bytes: number }>
  /** Remember the task name so later polls reuse it instead of re-acquiring. */
  rememberTask: () => void
  /** Publish the rows to the panel. */
  publish: (rows: Array<{ targetId: string; active: boolean }>) => void
  /** Which tab the user is looking at: explicit focus first, then the active row. */
  pickActive: (rows: Array<{ targetId: string; active: boolean }>) => string | null
}

export interface RefreshSyncResult {
  listed: number
  framed: boolean
  adopted: boolean
  reason: string
}

/**
 * Run the plan. Kept dependency-injected so the ordering (list → pick → frame →
 * publish, never publish-then-frame) is testable without a browser.
 */
export async function runRefreshSync(
  plan: RefreshSyncPlan,
  deps: RefreshSyncDeps,
): Promise<RefreshSyncResult> {
  if (!plan.list) return { listed: 0, framed: false, adopted: false, reason: plan.reason }
  const inv = await deps.listTabs()
  if (inv === null || inv.tabs.length === 0) {
    return { listed: 0, framed: false, adopted: false, reason: 'no-tabs' }
  }
  const rows = inv.tabs.map((tab) => ({ targetId: String(tab.tabId), active: tab.active === true }))
  // Publish FIRST: the strip should appear even if the frame step is skipped or
  // fails — that is the whole point of "sync on refresh".
  deps.publish(rows)
  if (!plan.frame) return { listed: rows.length, framed: false, adopted: false, reason: plan.reason }

  const activeId = deps.pickActive(rows)
  if (activeId === null) return { listed: rows.length, framed: false, adopted: false, reason: 'no-active-row' }
  const tabId = Number(activeId)
  if (!Number.isFinite(tabId) || tabId <= 0) {
    return { listed: rows.length, framed: false, adopted: false, reason: 'bad-active-id' }
  }
  if (plan.adopt) deps.rememberTask()
  const framed = await deps.captureFrame(tabId)
  return {
    listed: rows.length,
    framed: framed.ok,
    adopted: plan.adopt && framed.ok,
    reason: framed.ok ? (plan.adopt ? 'adopted-and-framed' : 'framed') : 'frame-failed',
  }
}
