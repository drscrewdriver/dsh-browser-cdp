import { describe, it, expect, vi } from "vitest";
import { commitField } from "../src/client/fam-write.ts";

/** 记录每次调用的假 scope；`results` 依次给出每次 `set` 的结果或抛错。 */
const fakeScope = (results: Array<boolean | Error>) => {
  const calls: Array<{ field: string; value: unknown }> = [];
  return {
    calls,
    set(field: string, value: unknown) {
      const i = calls.length;
      calls.push({ field, value });
      const r = results[Math.min(i, results.length - 1)];
      if (r instanceof Error) throw r;
      return Promise.resolve(r);
    },
  };
};

const noWait = { sleep: () => Promise.resolve(), retryMs: 0 };

describe("commitField（乐观锁写入的重试预算）", () => {
  it("宿主接受时恰好一次调用，参数原样透传", async () => {
    const scope = fakeScope([true]);
    await expect(commitField(scope, "toolExtended", false, noWait)).resolves.toBe(true);
    expect(scope.calls).toEqual([{ field: "toolExtended", value: false }]);
  });

  it("被拒（revision 冲突）后重试，第二次成功即返回 true", async () => {
    const scope = fakeScope([false, true]);
    await expect(commitField(scope, "toolBrowse", true, noWait)).resolves.toBe(true);
    expect(scope.calls.length).toBe(2);
  });

  it("预算用尽返回 false，不会无限重试", async () => {
    const scope = fakeScope([false]);
    await expect(commitField(scope, "chromePath", "x", noWait)).resolves.toBe(false);
    expect(scope.calls.length).toBe(3); // 默认 3 次尝试
  });

  it("attempts=1 时不重试（调用方要立刻拿到失败）", async () => {
    const scope = fakeScope([false]);
    await expect(commitField(scope, "toolJudge", false, { ...noWait, attempts: 1 })).resolves.toBe(false);
    expect(scope.calls.length).toBe(1);
  });

  it("set 同步抛错按一次失败尝试处理，不外泄异常", async () => {
    const scope = fakeScope([new Error("boom"), true]);
    await expect(commitField(scope, "cdpMode", "local", noWait)).resolves.toBe(true);
    expect(scope.calls.length).toBe(2);
  });

  it("重试之间等待 retryMs（给桥轨的恢复读落地时间）", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const scope = fakeScope([false, true]);
    await commitField(scope, "toolExtended", true, { sleep, retryMs: 250 });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(250);
  });
});
