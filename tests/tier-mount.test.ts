import { describe, it, expect } from "vitest";
import { apply } from "../src/index.ts";
import { TIER_MEMBERS } from "../src/toolTiers.ts";

/**
 * 分级注入的挂载级验证：真的走一遍 `apply()`，用最小宿主替身观察注册面。
 *
 * 只喂 `apply()` 用到的面：`tools.register` / `subprocess.spawn` / `on` /
 * `effect` / `logger`。刻意不提供 `inject`，让 cast server 与网关整段走
 * 宿主缺席的 no-op 分支（TUI/headless 同形），测试就不会碰到 SSE/worker。
 */
const mount = (config: Record<string, unknown> = {}) => {
  const live: string[] = [];
  /** 已注册工具句柄，按名字取回以便直接调用 execute。 */
  const handles = new Map<string, any>();
  const volatileHandlers = new Set<(paths: string[]) => void>();
  const teardown: Array<() => void> = [];
  const ctx: any = {
    tools: {
      register: (tool: any) => {
        live.push(tool.name);
        handles.set(tool.name, tool);
        return () => {
          const i = live.indexOf(tool.name);
          if (i >= 0) live.splice(i, 1);
        };
      },
    },
    subprocess: {
      // 永不落地的 spawn：任何探测/拉起都停在 await 上，不产生副作用。
      spawn: () => ({
        done: new Promise(() => {}),
        collected: {
          stdout: { readFrom: () => ({ text: "", nextOffset: 0, lossy: false }) },
          stderr: { readFrom: () => ({ text: "", nextOffset: 0, lossy: false }) },
        },
      }),
    },
    on: (_event: string, fn: (paths: string[]) => void) => {
      volatileHandlers.add(fn);
      return () => volatileHandlers.delete(fn);
    },
    effect: (fn: () => unknown) => {
      try {
        const d = fn();
        // cordis 语义：立刻执行 fn，把返回的 disposer 留到卸载时——不能当场调用，
        // 否则刚注册的工具会被立即反注册。
        if (typeof d === "function") teardown.push(d as () => void);
      } catch {
        /* 替身不为难子模块的挂载失败 */
      }
    },
    logger: { info() {}, warn() {}, error() {} },
  };
  apply(ctx, config as never);
  return {
    live,
    handles,
    /** 插件卸载：跑掉所有 effect disposer（工具应全部反注册）。 */
    unmount: () => { for (const d of teardown.splice(0)) d(); },
    /** 模拟设置页 volatile 热更（loader/volatile-update）。 */
    emitVolatileUpdate: () => {
      for (const fn of [...volatileHandlers]) fn(["dsh-browser-cdp.toolDepth"]);
    },
  };
};

const sorted = (names: readonly string[]) => [...names].sort();

describe("tool tier injection at mount", () => {
  it("the shipped default is lazy: only the resident core tier at mount", () => {
    const { live } = mount();
    expect(sorted(live)).toEqual(sorted(TIER_MEMBERS.core));
  });

  it("always mode restores the historical timing (minus the keyless judge tier)", () => {
    const { live } = mount({ toolInjection: "always" });
    expect(sorted(live)).toEqual(sorted([...TIER_MEMBERS.core, ...TIER_MEMBERS.browse, ...TIER_MEMBERS.extended]));
    expect(live).not.toContain("bcdp_jev_run");
  });

  it("always + a configured judge key = all 38 on the surface", () => {
    const { live } = mount({ toolInjection: "always", layaKey: "k" });
    expect(live.length).toBe(38);
    expect(sorted(live)).toEqual(sorted([
      ...TIER_MEMBERS.core, ...TIER_MEMBERS.browse, ...TIER_MEMBERS.extended, ...TIER_MEMBERS.judge,
    ]));
  });

  it("the first core-tier call widens the surface (bcdp_help needs no browser)", async () => {
    const m = mount();
    expect(m.live.length).toBe(TIER_MEMBERS.core.length);
    await m.handles.get("bcdp_help").execute({ topic: "navigate" }, {});
    expect(sorted(m.live)).toEqual(sorted([
      ...TIER_MEMBERS.core, ...TIER_MEMBERS.browse, ...TIER_MEMBERS.extended,
    ]));
    // 活动之后仍未配 Key：评审级依旧不来。
    expect(m.live).not.toContain("bcdp_jev_ask");
  });

  it("one tier can be sealed alone, live, without touching the others", async () => {
    const config: Record<string, unknown> = { toolInjection: "lazy" };
    const m = mount(config);
    const report = await m.handles.get("bcdp_doctor").execute({}, {});
    expect(m.live.length).toBe(33);
    // 开关状态必须在 doctor 里可见，否则用户不知道自己被封印了什么。
    expect(String(report.report)).toMatch(/tool injection: mode=lazy browse=open extended=open judge=open/);
    config.toolExtended = false;
    m.emitVolatileUpdate();
    // extended 被收，browse 仍在——一级一个开关。
    expect(sorted(m.live)).toEqual(sorted([...TIER_MEMBERS.core, ...TIER_MEMBERS.browse]));
    expect(m.live).toContain("bcdp_click");
    expect(m.live).not.toContain("bcdp_drag");
  });

  it("judge tools appear the moment a key is configured (volatile reapply, no remount)", () => {
    const config: Record<string, unknown> = { toolInjection: "always", layaKey: "" };
    const m = mount(config);
    expect(m.live).not.toContain("bcdp_jev_run");
    config.layaKey = "k";
    m.emitVolatileUpdate();
    expect(m.live).toContain("bcdp_jev_run");
  });

  it("the legacy ego_* alias follows its bcdp_* twin's tier", () => {
    const { live } = mount({ legacyEgoToolNames: true });
    expect(live).toContain("ego_status");
    expect(live).not.toContain("ego_click");
  });

  it("unmounting the plugin unregisters everything that is live", async () => {
    const m = mount();
    await m.handles.get("bcdp_help").execute({}, {});
    expect(m.live.length).toBeGreaterThan(0);
    m.unmount();
    expect(m.live).toEqual([]);
  });
});
