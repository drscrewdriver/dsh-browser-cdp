import { describe, expect, it } from 'vitest'
import {
  chooseTabbitWindow,
  createReceiptLedger,
  describeReceipts,
  TABBIT_RECEIPT_QUOTA,
  TABBIT_RECYCLE_AT,
} from '../src/cdp/tabbit-receipts.ts'

/**
 * Measured incident (tabbit-cli 1.21.21): a task accepts 1024 receipts, and once
 * full EVERY `nodejs` run answers with no stdout — the tool path dies with an
 * opaque "produced no stdout". The frame poller alone reached that wall in
 * ~51 minutes (one `frame-<ts>-<tab>` receipt every 3 s), so the budget has to
 * be counted locally and recycled BEFORE it is empty.
 */
describe('tabbit receipt ledger', () => {
  it('counts per task and never mixes tasks', () => {
    const ledger = createReceiptLedger()
    ledger.note('dsh-a'); ledger.note('dsh-a'); ledger.note('dsh-b')
    expect(ledger.count('dsh-a')).toBe(2)
    expect(ledger.count('dsh-b')).toBe(1)
    expect(ledger.count('dsh-c')).toBe(0)
  })

  it('recycles at 80% of the quota, not at the wall', () => {
    const ledger = createReceiptLedger()
    expect(TABBIT_RECYCLE_AT).toBe(Math.floor(TABBIT_RECEIPT_QUOTA * 0.8))
    for (let i = 0; i < TABBIT_RECYCLE_AT - 1; i += 1) ledger.note('t')
    expect(ledger.needsRecycle('t')).toBe(false)
    ledger.note('t')
    expect(ledger.needsRecycle('t')).toBe(true)
    // There must still be headroom left when we decide to recycle: the finish +
    // retry round trip needs it.
    expect(ledger.remaining('t')).toBeGreaterThan(0)
  })

  it('reset forgets a task (finish/recreate) and clamps remaining at zero', () => {
    const ledger = createReceiptLedger(10)
    for (let i = 0; i < 12; i += 1) ledger.note('t')
    expect(ledger.remaining('t')).toBe(0)
    ledger.reset('t')
    expect(ledger.count('t')).toBe(0)
    expect(ledger.remaining('t')).toBe(10)
  })

  it('counts recycles for the doctor', () => {
    const ledger = createReceiptLedger()
    expect(ledger.recycles()).toBe(0)
    ledger.noteRecycle()
    ledger.noteRecycle()
    expect(ledger.recycles()).toBe(2)
  })

  it('describes the state in one doctor-sized line', () => {
    const ledger = createReceiptLedger()
    ledger.note('dsh-1'); ledger.note('dsh-1'); ledger.noteRecycle()
    expect(describeReceipts(ledger, 'dsh-1')).toBe(`2/${TABBIT_RECEIPT_QUOTA} used, ${TABBIT_RECEIPT_QUOTA - 2} left, recycles=1`)
    // No task yet is a normal state, not an empty string.
    expect(describeReceipts(ledger, '')).toContain('no tabbit task')
  })
})

/**
 * The "全模式双重 tab" bug: Tabbit reports every tab of every window, so two
 * windows with the same two pages looked like duplicated pills. The panel must
 * follow the window the agent works in — and the field bug survived one round
 * because `focusedWindowId` is null on this CLI build (normalised to 0) and 0 is
 * not nullish, so a `??` chain stopped there and never scoped anything.
 */
describe('chooseTabbitWindow', () => {
  const tabs = [
    { tabId: 1, windowId: 100 }, // other window: newtab
    { tabId: 2, windowId: 100 }, // other window: baidu
    { tabId: 3, windowId: 200 }, // agent window: newtab
    { tabId: 4, windowId: 200 }, // agent window: baidu
  ]

  it('follows the window of the tab the agent last drove', () => {
    expect(chooseTabbitWindow(tabs, 4, 100)).toBe(200)
  })

  it('falls back to the focused window when the agent tab is unknown', () => {
    expect(chooseTabbitWindow(tabs, null, 100)).toBe(100)
    // A tab id that no longer exists (closed / recycled) must not win either.
    expect(chooseTabbitWindow(tabs, 999, 200)).toBe(200)
  })

  it('falls through 0 instead of stopping there (the regression)', () => {
    // This CLI build reports focusedWindowId: null → parsed as 0.
    expect(chooseTabbitWindow(tabs, null, 0)).toBe(100)
  })

  it('returns 0 (unscoped) only when nothing is known', () => {
    expect(chooseTabbitWindow([], null, 0)).toBe(0)
    expect(chooseTabbitWindow([{ tabId: 1 }], null, 0)).toBe(0)
  })
})