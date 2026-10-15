import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/client/index.ts", import.meta.url), "utf8");

// 设置卡的开关形态与写路径守卫。客户端半是注入式 IIFE、没有 React 挂载面，
// 所以这里按本仓既有做法（client-input.test.ts）做源码级断言：形态与「写必须
// 走带重试的提交口」都是可 grep 的契约，改回裸 scope.set 会在这里红。
describe("settings card switch UI and write path", () => {
  it("every boolean setting renders as a capsule switch, not a raw checkbox", () => {
    expect(source).not.toMatch(/type:\s*'checkbox'/);
    expect(source).toMatch(/function FamSwitch\(props: any\)/);
    expect(source).toMatch(/role: 'switch'/);
    expect(source).toMatch(/'aria-checked': on/);
    // 旋钮位移只在 on 态发生，轨道用主题令牌上色
    expect(source).toMatch(/transform: on \? 'translateX\(16px\)' : 'translateX\(0\)'/);
  });

  it("the bool row is optimistic: pending state, rollback and a visible failure notice", () => {
    expect(source).toMatch(/function FamBoolRow\(props: any\)/);
    // 点下去先本地翻转，宿主快照追上来才清 pending
    expect(source).toMatch(/setPending\(next\)/);
    expect(source).toMatch(/if \(pending !== undefined && props\.value\[f\.k\] === pending\) setPending\(undefined\)/);
    // 预算用尽必须弹回并亮提示，绝不停在「看起来改了其实没改」
    expect(source).toMatch(/setPending\(undefined\)\s*\n\s*setFailed\(true\)/);
    expect(source).toMatch(/保存未成功（已重试）/);
  });

  it("no field write bypasses the retrying commit口", () => {
    // 桥轨的 set 定义在 makeBridgeScope 里（`set: function`），卡面与 links 一律
    // 走 commitField；出现裸 `scope.set(` 就说明有人绕过了乐观锁重试。
    expect(source).not.toMatch(/scope\.set\(/);
    expect(source).toMatch(/import \{ commitField \} from '\.\/fam-write'/);
    expect(source).toMatch(/commitField\(scope, 'links', next\)/);
  });

  it("the bridge track refreshes before reporting a refused write", () => {
    // 冲突时若不先把 describe 等到底，重试带出去的还是旧 revision —— 白重。
    expect(source).toMatch(/return Promise\.resolve\(refresh\(\)\)\.then\(function \(\) \{ return false \}, function \(\) \{ return false \}\)/);
  });
});
