/**
 * src/cdp/tabbit-receipts.ts — the per-task receipt budget, tracked locally.
 *
 * Measured incident (2026-11-13): a Tabbit task accepts 1024 receipts and, once
 * full, EVERY `nodejs` call answers with no stdout. The plugin used to burn them
 * on the frame poller — one `frame-<ts>-<tab>` receipt every 3 s, ~51 minutes
 * per tab — so the WATCH PANEL starved the TOOL PATH: `bcdp_*` all died with
 * "tabbit-cli produced no stdout" and nothing could self-heal (the CLI keeps
 * receipts; there is no delete).
 *
 * Two consequences shape this module:
 *
 *   1. Receipts must be COUNTED where they are created, not asked for later.
 *      We create exactly one per `nodejs` run, so a local counter is exact and
 *      free; asking the CLI would cost another subprocess per tick.
 *   2. The budget must be recycled BEFORE it is empty, because the failure mode
 *      is total and opaque. `finish --task X` hands the task back and the next
 *      `nodejs` run recreates it on demand (measured: acquisition recycle works),
 *      which is why recycling at 80% is a no-op for the caller.
 *
 * Pure and host-free: the caller decides how to finish/recreate.
 */

/** Receipts a single Tabbit task accepts (measured on tabbit-cli 1.21.21). */
export const TABBIT_RECEIPT_QUOTA = 1024

/** Recycle before the wall, leaving headroom for the finish + retry round trip. */
export const TABBIT_RECYCLE_AT = Math.floor(TABBIT_RECEIPT_QUOTA * 0.8)

export interface ReceiptLedger {
  /** How many receipts this process has created for `task`. */
  count(task: string): number
  /** Record one `nodejs` run; returns the new count. */
  note(task: string): number
  /** Forget a task (after finish/recreate). */
  reset(task: string): void
  /** True once the task is close enough to the wall to recycle proactively. */
  needsRecycle(task: string, at?: number): boolean
  /** Receipts left before the hard wall (never negative). */
  remaining(task: string): number
  /** Recycle counter, for the doctor. */
  recycles(): number
  noteRecycle(): number
}

export function createReceiptLedger(quota: number = TABBIT_RECEIPT_QUOTA): ReceiptLedger {
  const used = new Map<string, number>()
  let recycleCount = 0
  return {
    count: (task) => used.get(task) ?? 0,
    note(task) {
      const next = (used.get(task) ?? 0) + 1
      used.set(task, next)
      return next
    },
    reset(task) { used.delete(task) },
    needsRecycle(task, at) {
      const threshold = at ?? TABBIT_RECYCLE_AT
      return (used.get(task) ?? 0) >= threshold
    },
    remaining: (task) => Math.max(0, quota - (used.get(task) ?? 0)),
    recycles: () => recycleCount,
    noteRecycle() { recycleCount += 1; return recycleCount },
  }
}

/** One row of `tabbit-cli tabs` that the window choice needs. */
export interface TabbitWindowTab {
  tabId: number
  windowId?: number
}

/**
 * Which browser window the panel should show.
 *
 * Tabbit reports EVERY tab of EVERY window, so two windows holding the same two
 * pages rendered as duplicated pills (“全模式双重” bug). The panel follows the
 * window the agent works in:
 *
 *   1. the window of the tab the agent last drove  (authoritative)
 *   2. else the browser's focused window
 *   3. else the first tab's window
 *   4. else 0 = unscoped
 *
 * `||`, never `??`: `focusedWindowId` comes back as null on this CLI build and
 * is normalised to 0, and 0 is not nullish — a `??` chain would stop there and
 * silently leave the strip unscoped (that is how the bug survived one round).
 */
export function chooseTabbitWindow(
  tabs: readonly TabbitWindowTab[],
  lastActiveTabId: number | null,
  focusedWindowId: number,
): number {
  const agentTab = lastActiveTabId === null
    ? undefined
    : tabs.find((tab) => tab.tabId === lastActiveTabId)
  return agentTab?.windowId || focusedWindowId || tabs[0]?.windowId || 0
}

/**
 * One-line state for the doctor: how close this task is to the wall, and how
 * many times we already recycled. Deliberately terse — it lives in `bcdp_doctor`
 * output, not in the always-resident schema.
 */
export function describeReceipts(ledger: ReceiptLedger, task: string, quota: number = TABBIT_RECEIPT_QUOTA): string {
  if (task === '') return 'none yet (no tabbit task established)'
  return `${ledger.count(task)}/${quota} used, ${ledger.remaining(task)} left, recycles=${ledger.recycles()}`
}