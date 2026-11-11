import { describe, it, expect } from "vitest";
import { rowsWithPrimaryActive } from "../src/index.ts";
import { CLI_FRAME_HOLD_MAX_AGE_MS, cliFrameHoldDue, isCliCaptureChannel } from "../src/cast-server.ts";

// 观察窗闪跳的两条修复都锚在这里：
//  1. 广播给面板的行必须把「本轮真拍到的 tab」标成 active——客户端仅激活模式下
//     只保留 active 行，并拿这份名单淘汰 frameCache；active 是浏览器 MRU tab 时
//     刚拍到的帧会被当场逐出，视图切到没拍过的行 → 每轮画/空交替。
//  2. 心跳缓冲必须有明确上限：真实捕获节奏 3–6s，缓冲用来跨过这个间隙；超过
//     窗口还一直重播，等于把已经死掉的捕获路径伪装成活着。

const row = (targetId: string, active = false) => ({
  targetId,
  url: `https://example.com/${targetId}`,
  title: `t${targetId}`,
  active,
  lastActive: 1000,
})

describe("rowsWithPrimaryActive", () => {
  it("marks the captured tab active and clears the rest", () => {
    const rows = [row("11", true), row("12"), row("13")]
    const out = rowsWithPrimaryActive(rows, "12")
    expect(out.map((r) => [r.targetId, r.active])).toEqual([["11", false], ["12", true], ["13", false]])
  });

  it("keeps every other field and does not mutate the input", () => {
    const rows = [row("11", true), row("12")]
    const out = rowsWithPrimaryActive(rows, "12")
    expect(out[1]).toEqual({ ...rows[1], active: true })
    expect(rows[0].active).toBe(true)
    expect(out[0].url).toBe("https://example.com/11")
    expect(out).not.toBe(rows)
  });

  it("leaves the rows alone when there is no captured tab to promote", () => {
    const rows = [row("11", true), row("12")]
    expect(rowsWithPrimaryActive(rows, "")).toEqual(rows)
    // 主拍 tab 不在名单里（例如刚被关掉）→ 不凭空造一个 active。
    expect(rowsWithPrimaryActive(rows, "99")).toEqual(rows)
  });

  it("still yields exactly one active row for the 仅激活 filter", () => {
    const rows = [row("11", true), row("12"), row("13")]
    const kept = rowsWithPrimaryActive(rows, "13").filter((r) => r.active === true)
    expect(kept.length).toBe(1)
    expect(kept[0].targetId).toBe("13")
  });
});

describe("isCliCaptureChannel (CDP worker 的通道门禁)", () => {
  // 这个门禁的存在理由：非 CDP 通道上 worker 永远 attach 不上，却会每 ~1s 往同一条
  // SSE 推 `spaces: []`，把 CLI 轮询的真帧抹掉（面板“显示一秒后回空”）。
  const link = (id: string, kind: string): any => ({ id, kind, label: kind, enabled: true })

  it("gates the CDP worker off on the CLI channels", () => {
    expect(isCliCaptureChannel({ links: [link("t1", "tabbit-cli")], activeTargetId: "t1" })).toBe(true)
    expect(isCliCaptureChannel({ links: [link("e1", "ego-cli")], activeTargetId: "e1" })).toBe(true)
  });

  it("keeps the worker on for CDP-capable channels", () => {
    expect(isCliCaptureChannel({ links: [link("c1", "cdp")], activeTargetId: "c1" })).toBe(false)
    expect(isCliCaptureChannel({ links: [link("l1", "lightpanda")], activeTargetId: "l1" })).toBe(false)
  });

  it("treats nothing-activated as worker-owned (cdpMode=local 不能被误关)", () => {
    expect(isCliCaptureChannel({ links: [], activeTargetId: "" })).toBe(false)
  });
});

describe("cliFrameHoldDue (the 4s buffer window)", () => {
  const T0 = 1_700_000_000_000

  it("does nothing before the first real capture", () => {
    expect(cliFrameHoldDue(T0, 0, 0)).toBe(false)
  });

  it("replays once per second inside the buffer window", () => {
    expect(cliFrameHoldDue(T0 + 1000, T0, T0)).toBe(true)
    expect(cliFrameHoldDue(T0 + 2000, T0, T0 + 1000)).toBe(true)
    expect(cliFrameHoldDue(T0 + 3000, T0, T0 + 2000)).toBe(true)
  });

  it("does not spam faster than 1s", () => {
    expect(cliFrameHoldDue(T0 + 500, T0, T0)).toBe(false)
  });

  it("stops once the frame is older than the declared window", () => {
    expect(cliFrameHoldDue(T0 + CLI_FRAME_HOLD_MAX_AGE_MS, T0, T0 + 3000)).toBe(true)
    expect(cliFrameHoldDue(T0 + CLI_FRAME_HOLD_MAX_AGE_MS + 1, T0, T0 + 4000)).toBe(false)
    // 陈旧帧无限重播正是被禁掉的那种「看起来还活着」。
    expect(cliFrameHoldDue(T0 + 60_000, T0, T0 + 59_000)).toBe(false)
  });

  it("the window is at least one slow capture cycle beyond the 3s cadence", () => {
    expect(CLI_FRAME_HOLD_MAX_AGE_MS).toBeGreaterThanOrEqual(4000)
    expect(CLI_FRAME_HOLD_MAX_AGE_MS).toBeLessThan(10_000)
  });
});
