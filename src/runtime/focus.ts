/**
 * src/runtime/focus.ts — who owns "the current tab" (R2).
 *
 * Three writers used to fight over one field, and that is why "click a tab in
 * the panel and the highlight does not follow" was reproducible:
 *
 *   - the capture lease   (`currentStatus.targetId` in the worker)  — what is
 *                         being SCREENCAST, not what the user picked
 *   - `/json/list` order  — the OS-foreground tab; LOCAL launches only, and a
 *                         remote attach has no such endpoint at all
 *   - the panel's own `selectedTabId`
 *
 * This store is the single host-side owner of the OPERATION focus: the tab the
 * next tool call drives. The view focus stays in the panel (it may pin any tab
 * without touching the operation path), and the capture focus stays in the
 * worker's lease. Each has exactly one writer, so no reconciliation is needed.
 *
 * In-memory on purpose: a target id is a runtime handle that dies with the
 * browser. Persisting it would create a second source of truth next to
 * `activeTargetId` and rot on the next restart (see cdp-targets.ts §1).
 */

export type FocusSource = 'agent' | 'operator'

export interface TargetFocus {
  targetId: string
  source: FocusSource
  /** When the focus was written (ms). Used only for staleness reports. */
  at: number
}

type Listener = (focus: TargetFocus | null) => void

export interface FocusStore {
  get(): TargetFocus | null
  /** Record the tab the operation side now owns. Empty id clears the focus. */
  set(targetId: string, source: FocusSource, at?: number): TargetFocus | null
  /** Drop the focus — used when the worker reports the tab is gone. */
  clear(): void
  /**
   * True when a remembered focus is no longer in `known`. The caller decides
   * what to do (usually: clear + ask the worker for a fresh list), which keeps
   * this module free of any transport.
   */
  isStale(known: readonly string[]): boolean
  onChange(listener: Listener): () => void
}

export function createFocusStore(now: () => number = () => Date.now()): FocusStore {
  let focus: TargetFocus | null = null
  const listeners = new Set<Listener>()
  const emit = (): void => { for (const listener of listeners) listener(focus) }
  return {
    get: () => focus,
    set(targetId, source, at) {
      const id = String(targetId ?? '').trim()
      if (id === '') {
        if (focus === null) return null
        focus = null
        emit()
        return null
      }
      // Re-writing the same id/source is a no-op: a poll loop must not emit an
      // event per tick.
      if (focus !== null && focus.targetId === id && focus.source === source) {
        focus = { ...focus, at: at ?? now() }
        return focus
      }
      focus = { targetId: id, source, at: at ?? now() }
      emit()
      return focus
    },
    clear() {
      if (focus === null) return
      focus = null
      emit()
    },
    isStale(known) {
      if (focus === null) return false
      return !known.includes(focus.targetId)
    },
    onChange(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/** Process-wide focus, mirroring `defaultAttachCache`'s lifetime. */
export const defaultFocusStore: FocusStore = createFocusStore()

/**
 * Pull a target id out of a tool result, if it carries one.
 *
 * The operation face already knows which tab it just drove (`page.info()` and
 * `bcdp_tab` both report it); without this the panel would keep highlighting the
 * previous tab until the next spaces poll and the next click. Deliberately
 * forgiving: any of the three known shapes, or nothing — a tool that does not
 * report a tab simply does not move the focus.
 */
export function focusIdFrom(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const candidates = [
    (record.page as Record<string, unknown> | undefined)?.targetId,
    (record.tab as Record<string, unknown> | undefined)?.targetId,
    record.targetId,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
  }
  return null
}