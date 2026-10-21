/**
 * issue #2 回归：family 兜底 ledger 的 uSES 快照契约。
 * 同一槽位版本内 getSnapshot 必须返回全等引用（否则宿主 bindSnapshotSelector
 * 无限重渲染 React #185）；版本递增后必须重投影；无 getVersion 的旧壳退回
 * 逐次投影（行为与修复前一致，不抛错）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimFamilyHostIfOrphaned,
  eqRows,
  FAMILY_CLAIM_DELAY_MS,
  projectLedger,
  type FamilyHostSlots,
  type FamilyTabEntry,
} from "../src/client/family-host";

interface FakeSlotsState {
  slots: FamilyHostSlots;
  options: Record<string, unknown>;
  bumpVersion: () => void;
  setEntries: (e: Record<string, unknown>[]) => void;
  fire: () => void;
}

function makeSlots(entries: Record<string, unknown>[], opts: { withGetVersion?: boolean } = {}): FakeSlotsState {
  let version = 0;
  let rows = entries;
  const listeners: (() => void)[] = [];
  let captured: Record<string, unknown> | undefined;
  const slots: FamilyHostSlots = {
    inject: () => undefined,
    register: (options: Record<string, unknown>) => {
      captured = options;
      return () => undefined;
    },
    entries: () => rows,
    subscribe: (_name: string, fn: () => void) => {
      listeners.push(fn);
      return () => undefined;
    },
  };
  if (opts.withGetVersion !== false) {
    slots.getVersion = () => version;
  }
  return {
    slots,
    get options() {
      return captured as Record<string, unknown>;
    },
    bumpVersion: () => {
      version += 1;
    },
    setEntries: (e) => {
      rows = e;
    },
    fire: () => listeners.forEach((l) => l()),
  };
}

/** 触发 claim（假定时器拨过分级时刻）并返回注册的 ledger 观测面。 */
function claimLedger(state: FakeSlotsState): { getSnapshot(): readonly FamilyTabEntry[]; subscribe: (fn: () => void) => () => void } {
  claimFamilyHostIfOrphaned(state.slots, () => false, () => "family", "[test]");
  vi.advanceTimersByTime(FAMILY_CLAIM_DELAY_MS + 10);
  const inject = state.options["inject"] as () => { hooks: { tabs: { getSnapshot(): readonly FamilyTabEntry[]; subscribe: (fn: () => void) => () => void } } };
  return inject().hooks.tabs;
}

describe("family-host ledger snapshot contract (issue #2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const oneRow = [{ options: { id: "dsh-browser-cdp", order: 35, label: "CDP" } }];

  it("returns the identical reference across calls within the same version", () => {
    const state = makeSlots(oneRow);
    const ledger = claimLedger(state);
    const a = ledger.getSnapshot();
    const b = ledger.getSnapshot();
    expect(a).toBe(b);
    expect(a).toHaveLength(1);
  });

  it("re-projects after the version bumps and reflects new entries", () => {
    const state = makeSlots(oneRow);
    const ledger = claimLedger(state);
    const before = ledger.getSnapshot();
    state.setEntries([...oneRow, { options: { id: "other", order: 40, label: "Other" } }]);
    state.bumpVersion();
    const after = ledger.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.map((r) => r.id)).toEqual(["dsh-browser-cdp", "other"]);
    expect(ledger.getSnapshot()).toBe(after);
  });

  it("empty ledger still yields a stable snapshot (empty crash repro)", () => {
    const state = makeSlots([]);
    const ledger = claimLedger(state);
    expect(ledger.getSnapshot()).toBe(ledger.getSnapshot());
    expect(ledger.getSnapshot()).toEqual([]);
  });

  it("without getVersion (old shell) falls back to per-call projection without throwing", () => {
    const state = makeSlots(oneRow, { withGetVersion: false });
    const ledger = claimLedger(state);
    // 行为不劣于修复前：每次新数组，但不抛错。
    expect(ledger.getSnapshot()).not.toBe(ledger.getSnapshot());
    expect(ledger.getSnapshot()).toHaveLength(1);
  });

  it("subscribe forwards to slots.subscribe and survives a missing surface", () => {
    const state = makeSlots(oneRow);
    const ledger = claimLedger(state);
    let fired = 0;
    const unsub = ledger.subscribe(() => {
      fired += 1;
    });
    state.fire();
    expect(fired).toBe(1);
    expect(typeof unsub).toBe("function");
    delete state.slots.subscribe;
    const state2 = makeSlots(oneRow);
    delete state2.slots.subscribe;
    claimFamilyHostIfOrphaned(state2.slots, () => false, () => "family", "[test]");
    vi.advanceTimersByTime(FAMILY_CLAIM_DELAY_MS + 10);
    const inject2 = state2.options["inject"] as () => { hooks: { tabs: { subscribe: (fn: () => void) => () => void } } };
    expect(typeof inject2().hooks.tabs.subscribe).toBe("function");
  });

  it("declare-or-withdraw: register throwing does not escape", () => {
    const slots: FamilyHostSlots = {
      inject: () => undefined,
      register: () => {
        throw new Error("already declared");
      },
      entries: () => [],
      getVersion: () => 0,
    };
    claimFamilyHostIfOrphaned(slots, () => false, () => "family", "[test]");
    expect(() => vi.advanceTimersByTime(FAMILY_CLAIM_DELAY_MS + 10)).not.toThrow();
  });
});

describe("projectLedger", () => {
  it("sorts by order and degrades label functions that throw", () => {
    const state = makeSlots([
      { options: { id: "b", order: 2, label: () => { throw new Error("x") } } },
      { options: { id: "a", order: 1, label: () => "Alpha" } },
      { options: { id: "c", order: 3, label: "Plain" } },
    ]);
    const rows = projectLedger(state.slots);
    expect(rows.map((r) => r.label)).toEqual(["Alpha", "b", "Plain"]);
  });
});

describe("eqRows", () => {
  const row = (id: string, order: number, label: string): FamilyTabEntry => ({ id, order, label });
  it("true for identical reference", () => {
    const a = [row("x", 1, "X")];
    expect(eqRows(a, a)).toBe(true);
  });
  it("true for equal content with different references", () => {
    expect(eqRows([row("x", 1, "X"), row("y", 2, "Y")], [row("x", 1, "X"), row("y", 2, "Y")])).toBe(true);
  });
  it("true for two empty arrays", () => {
    expect(eqRows([], [])).toBe(true);
  });
  it("false on length change", () => {
    expect(eqRows([row("x", 1, "X")], [])).toBe(false);
  });
  it("false on id / order / label drift", () => {
    expect(eqRows([row("x", 1, "X")], [row("z", 1, "X")])).toBe(false);
    expect(eqRows([row("x", 1, "X")], [row("x", 2, "X")])).toBe(false);
    expect(eqRows([row("x", 1, "X")], [row("x", 1, "Q")])).toBe(false);
  });
  it("false on order permutation", () => {
    expect(eqRows([row("a", 1, "A"), row("b", 2, "B")], [row("b", 2, "B"), row("a", 1, "A")])).toBe(false);
  });
});
