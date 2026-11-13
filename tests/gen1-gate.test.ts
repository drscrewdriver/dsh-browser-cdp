import { describe, it, expect } from "vitest";
import { shouldShowGen1SettingsGear } from "../src/client/gen1-gate.ts";

// Gen-1 齿轮代际门控真值表（见 src/client/gen1-gate.ts）。
// 纪律：仅 0.1.0/0.1.1（configForms 缺 + openSettingsDocument 缺）显示；
// 任一原生设置页信号存在（gen-2 的 openSettingsDocument / gen-3 的 configForms）
// 即隐藏，宁可少挂也不与原生页重复。
describe("shouldShowGen1SettingsGear", () => {
  it("shows only on Gen-1: neither configForms nor openSettingsDocument present", () => {
    expect(shouldShowGen1SettingsGear(false, false)).toBe(true);
  });

  it("hides on Gen-3: configForms present (with or without openSettingsDocument)", () => {
    expect(shouldShowGen1SettingsGear(true, false)).toBe(false);
    expect(shouldShowGen1SettingsGear(true, true)).toBe(false);
  });

  it("hides on Gen-2: openSettingsDocument present, configForms absent", () => {
    expect(shouldShowGen1SettingsGear(false, true)).toBe(false);
  });
});
