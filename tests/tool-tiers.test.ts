import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import {
  BATCH_ORDER,
  TIER_MEMBERS,
  TIER_OF_TOOL,
  bareToolName,
  batchOfTool,
  createTierInjector,
  judgeConfigured,
  tierAllowed,
  tierOfTool,
  toolAllowed,
  unknownTieredTools,
  type TierPolicy,
} from "../src/toolTiers.ts";

/** src/index.ts 里真实注册的全部 bcdp_* 工具名（分级表的对照源）。 */
const registeredNames = async (): Promise<string[]> => {
  const src = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  return [...new Set([...src.matchAll(/name: '(bcdp_[a-z0-9_]+)'/g)].map((m) => m[1]))];
};

const P = (over: Partial<TierPolicy> = {}): TierPolicy => ({
  injection: "lazy", toolBrowse: true, toolExtended: true, toolJudge: true, judgeConfigured: true, active: false, ...over,
});

describe("tier table coverage", () => {
  it("the table covers every registered bcdp_* tool, with no stale entries", async () => {
    const names = await registeredNames();
    const listed = Object.values(TIER_MEMBERS).flat();
    // 双向对齐：源码里注册的每个名字都在表上，表上每个名字都还在源码里。
    expect(names.slice().sort()).toEqual(listed.slice().sort());
    expect(names.length).toBe(38);
    expect(unknownTieredTools(names)).toEqual([]);
  });

  it("tiers are disjoint and core is exactly the resident entry set", () => {
    const all = Object.values(TIER_MEMBERS).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(TIER_MEMBERS.core).toEqual([
      "bcdp_status", "bcdp_doctor", "bcdp_help", "bcdp_space_open", "bcdp_space_close", "bcdp_navigate", "bcdp_snapshot",
    ]);
  });

  it("the core tier is the only one allowed in the shipped default configuration", () => {
    const p = P();
    for (const [tier, names] of Object.entries(TIER_MEMBERS)) {
      const allowed = names.every((n) => toolAllowed(n, p));
      expect(allowed).toBe(tier === "core");
    }
  });
});

describe("tierOfTool", () => {
  it("is prefix-agnostic: the legacy ego_* alias follows its bcdp_* twin", () => {
    expect(bareToolName("bcdp_click")).toBe("click");
    expect(bareToolName("ego_click")).toBe("click");
    expect(tierOfTool("ego_click")).toBe(tierOfTool("bcdp_click"));
    expect(tierOfTool("ego_status")).toBe("core");
  });

  it("an unregistered name falls to the strictest tier instead of sneaking onto the resident surface", () => {
    expect(tierOfTool("bcdp_not_in_the_table")).toBe("extended");
    expect(unknownTieredTools(["bcdp_click", "bcdp_nope"])).toEqual(["bcdp_nope"]);
  });
});

describe("tierAllowed policy gates", () => {
  it("core is never sealable — lazy mode must keep its own unlock entry", () => {
    for (const p of [P(), P({ injection: "always" }), P({ toolBrowse: false, toolExtended: false, toolJudge: false })]) {
      expect(tierAllowed("core", p)).toBe(true);
    }
  });

  it("a tier switch is a hard lock: activity cannot open a sealed tier", () => {
    const active = P({ active: true });
    expect(tierAllowed("browse", { ...active, toolBrowse: false })).toBe(false);
    expect(tierAllowed("extended", { ...active, toolExtended: false })).toBe(false);
    expect(tierAllowed("browse", active)).toBe(true);
    expect(tierAllowed("extended", active)).toBe(true);
    // 封一级不波及另一级：一级一个开关，不是全局深度锁。
    expect(tierAllowed("extended", { ...active, toolBrowse: false })).toBe(true);
  });

  it("lazy mode holds everything above core until the first browser activity", () => {
    const sealed = P({ active: false });
    const open = { ...sealed, active: true };
    for (const tier of ["browse", "extended", "judge"] as const) {
      expect(tierAllowed(tier, sealed)).toBe(false);
      expect(tierAllowed(tier, open)).toBe(true);
    }
  });

  it("always mode ignores the activity flag (historical timing)", () => {
    for (const tier of ["browse", "extended", "judge"] as const) {
      expect(tierAllowed(tier, P({ injection: "always", active: false }))).toBe(true);
    }
  });

  it("the judge tier needs BOTH its switch open and a configured key", () => {
    expect(tierAllowed("judge", P({ toolJudge: false, active: true }))).toBe(false);
    expect(tierAllowed("judge", P({ judgeConfigured: false, active: true }))).toBe(false);
    expect(tierAllowed("judge", P({ active: true }))).toBe(true);
  });

  it("judgeConfigured reads keys, not URLs (layaUrl has a non-empty default)", () => {
    expect(judgeConfigured({ jevKey: "", layaKey: "" })).toBe(false);
    expect(judgeConfigured({ jevKey: "  ", layaKey: "" })).toBe(false);
    expect(judgeConfigured({ layaKey: "k" })).toBe(true);
    expect(judgeConfigured({ jevKey: "k" })).toBe(true);
    expect(judgeConfigured({})).toBe(false);
  });
});

describe("tier injector controller", () => {
  /** 假宿主：记录注册/反注册，disposer 可观察。 */
  const harness = (initial: TierPolicy) => {
    let policy = initial;
    const live: string[] = [];
    const disposals: string[] = [];
    const injector = createTierInjector({
      register: (tool) => {
        const name = String(tool.name);
        live.push(name);
        return () => {
          disposals.push(name);
          live.splice(live.indexOf(name), 1);
        };
      },
      policy: () => policy,
    });
    return {
      injector,
      live,
      disposals,
      setPolicy: (next: TierPolicy) => { policy = next; },
      offer: (name: string) => injector.offer({ name }),
    };
  };

  it("lazy mount registers only the resident core tier and keeps the rest pending", () => {
    const h = harness(P({ active: false }));
    for (const n of [...TIER_MEMBERS.core, ...TIER_MEMBERS.browse]) h.offer(n);
    expect(h.injector.surface().live.slice().sort()).toEqual(TIER_MEMBERS.core.slice().sort());
    expect(h.injector.surface().sealed).toContain("bcdp_click");
  });

  it("activity widens the surface; re-sealing narrows it again (dispose, not refuse)", () => {
    const h = harness(P({ active: false }));
    for (const n of [...TIER_MEMBERS.core, ...TIER_MEMBERS.browse]) h.offer(n);
    h.setPolicy(P({ active: true }));
    h.injector.reapply();
    expect(h.live).toContain("bcdp_click");
    h.setPolicy(P({ active: false }));
    h.injector.reapply();
    expect(h.live.slice().sort()).toEqual(TIER_MEMBERS.core.slice().sort());
    expect(h.disposals).toContain("bcdp_click");
  });

  it("reapply is idempotent — no double registration, no orphan disposer", () => {
    const h = harness(P({ injection: "always" }));
    h.offer("bcdp_click");
    h.injector.reapply();
    h.injector.reapply();
    expect(h.live.filter((n) => n === "bcdp_click")).toEqual(["bcdp_click"]);
    expect(h.disposals).toEqual([]);
  });

  it("a settings flip seals one tier live, leaving the others open", () => {
    const h = harness(P({ active: true }));
    for (const n of [...TIER_MEMBERS.core, ...TIER_MEMBERS.browse, ...TIER_MEMBERS.extended]) h.offer(n);
    expect(h.live).toContain("bcdp_drag");
    h.setPolicy(P({ active: true, toolExtended: false }));
    h.injector.reapply();
    // extended 被收，browse 仍在——一级一个开关。
    expect(sorted0(h.live)).toEqual(sorted0([...TIER_MEMBERS.core, ...TIER_MEMBERS.browse]));
  });

  it("an unconfigured judge tier never registers, even at mount in always mode", () => {
    const h = harness(P({ injection: "always", judgeConfigured: false }));
    for (const n of TIER_MEMBERS.judge) h.offer(n);
    expect(h.live).toEqual([]);
    h.setPolicy(P({ injection: "always", judgeConfigured: true }));
    h.injector.reapply();
    expect(h.live.slice().sort()).toEqual(TIER_MEMBERS.judge.slice().sort());
  });

  it("every table entry is reachable under the widest policy", () => {
    const h = harness(P({ injection: "always" }));
    for (const n of [...TIER_OF_TOOL.keys()]) h.offer(n);
    expect(h.injector.surface().sealed).toEqual([]);
    expect(h.live.length).toBe(TIER_OF_TOOL.size);
  });
});

describe("browse injection batches (act → observe → wait)", () => {
  it("releases browse in batch order as activity depth grows", () => {
    const at = (batchDepth: number) => P({ active: true, batchDepth });
    // depth 0: nothing above core, even though activity is on.
    expect(toolAllowed("bcdp_click", at(0))).toBe(false);
    // depth 1: act only.
    expect(toolAllowed("bcdp_click", at(1))).toBe(true);
    expect(toolAllowed("bcdp_screenshot", at(1))).toBe(false);
    expect(toolAllowed("bcdp_wait", at(1))).toBe(false);
    // depth 2: + observe.
    expect(toolAllowed("bcdp_screenshot", at(2))).toBe(true);
    expect(toolAllowed("bcdp_read_element", at(2))).toBe(true);
    expect(toolAllowed("bcdp_wait", at(2))).toBe(false);
    // depth 3: + wait.
    expect(toolAllowed("bcdp_wait", at(3))).toBe(true);
    expect(toolAllowed("bcdp_wait_for_selector", at(3))).toBe(true);
  });

  it("leaves core and extended untouched by the browse batch gate", () => {
    const shallow = P({ active: true, batchDepth: 1, toolExtended: true });
    expect(toolAllowed("bcdp_status", shallow)).toBe(true);
    expect(toolAllowed("bcdp_drag", shallow)).toBe(true);
  });

  it("always mode ignores batch depth (historical mount-all semantics)", () => {
    const p = P({ injection: "always", active: false, batchDepth: 0 });
    expect(toolAllowed("bcdp_wait", p)).toBe(true);
  });

  it("batchOfTool is prefix-agnostic and defaults unknown names to act", () => {
    expect(batchOfTool("bcdp_click")).toBe("act");
    expect(batchOfTool("ego_click")).toBe("act");
    expect(batchOfTool("bcdp_screenshot")).toBe("observe");
    expect(batchOfTool("bcdp_wait_for_selector")).toBe("wait");
    expect(batchOfTool("bcdp_unlisted")).toBe("act");
  });
});

const sorted0 = (names: readonly string[]) => [...names].sort();
