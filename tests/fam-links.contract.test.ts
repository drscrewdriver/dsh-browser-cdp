import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/client/index.ts", import.meta.url), "utf8");

describe("FamLinks v2 write discipline (source contracts)", () => {
  it("removal clears the activation only AFTER the links write (clear, never advance)", () => {
    const start = source.indexOf("function removeOne");
    const end = source.indexOf("function probeOne");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fn = source.slice(start, end);
    const linksWrite = fn.indexOf("writeLinks(res.links)");
    const activeClear = fn.indexOf("commitField(scope, 'activeTargetId', '')");
    expect(linksWrite).toBeGreaterThan(-1);
    expect(activeClear).toBeGreaterThan(linksWrite);
  });

  it("row inputs commit on blur/Enter only — never per keystroke (each set is a host patch flush)", () => {
    const start = source.indexOf("function FamRowInput");
    const end = source.indexOf("// 连接目标（links）v2");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fn = source.slice(start, end);
    expect(fn).toMatch(/onBlur: commit/);
    expect(fn).toMatch(/onKeyDown: function \(e(?:: any)?\) \{ if \(e\.key === 'Enter'\) \{ commit\(\) \} \}/);
    expect(fn).not.toMatch(/scope\.set/);
  });

  it("the settings card mounts exactly once, as a top-level settings.section (no family tab, no plugin page card)", () => {
    // 唯一入口原则：一个顶层 settings.section 承载 FamilySettingsCard。
    const start = source.indexOf("function mountOwnSettingsSection");
    expect(start).toBeGreaterThan(-1);
    const fn = source.slice(start, source.indexOf("function mountSettingsSectionIcon"));
    expect(fn).toMatch(/ctx\.slots\.inject\('settings\.section'/);
    expect(fn).toMatch(/id: 'dsh-browser-cdp'/);
    expect(fn.indexOf("FamilySettingsCard")).toBeGreaterThan(-1);
    // 旧入口全部退出：家族 tab / 插件详情页卡 / Gen-2 item 卡都不再注册。
    expect(source).not.toMatch(/ctx\.slots\.inject\('dsh-family\.tab'/);
    expect(source).not.toMatch(/ctx\.slots\.inject\('plugins\.bundle\.config'/);
    expect(source).not.toMatch(/ctx\.slots\.inject\('settings\.plugin\.item'/);
    // 分节图标走 0.2.2 的独立槽位，id 必须等于分节 id（宿主按 id 寻址）。
    const iconStart = source.indexOf("function mountSettingsSectionIcon");
    const iconFn = source.slice(iconStart, source.indexOf("function SettingsSectionIcon"));
    expect(iconFn).toMatch(/ctx\.slots\.inject\('settings\.section\.icon'/);
    expect(iconFn).toMatch(/id: 'dsh-browser-cdp'/);
  });

  it("a rejected write surfaces instead of vanishing; user data never reaches innerHTML", () => {
    expect(source).toMatch(/ok === false\) setErrText\(wt\('linksWriteFailed'\)\)/);
    // The watch panel's constant SVG icons legitimately ride
    // dangerouslySetInnerHTML; the links editor region must not.
    const start = source.indexOf("function FamRowInput");
    const end = source.indexOf("function apply(ctx");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).not.toMatch(/innerHTML/);
  });

  it("the probe button rides the runtime capability route, not the retired config pair", () => {
    expect(source).toMatch(/postJson\('\/bcdp\/api\/cdp-probe'/);
  });

  it("the managed-local row is explicit and mode-synced", () => {
    expect(source).toMatch(/wt\('linksLocalRow'\)/);
    expect(source).toMatch(/void commitField\(scope, 'cdpMode', 'local'\)/);
    expect(source).toMatch(/if \(cdpMode === 'local'\) \{ void commitField\(scope, 'cdpMode', 'auto'\) \}/);
    expect(source).toMatch(/void commitField\(scope, 'allowLocalFallback'/);
  });

  it("the first target added to an empty sequence activates itself", () => {
    expect(source).toMatch(/activeId === ''/);
  });
  it("the cast worker state file is plugin-namespaced (upstream ego-cast.json coexistence)", async () => {
    expect(source).toMatch(/void commitField\(scope, 'cdpMode', 'local'\)/);
    const { readFile } = await import("node:fs/promises");
    const workerTs = await readFile(new URL("../src/worker/cdp-cast-worker.ts", import.meta.url), "utf8");
    const castServer = await readFile(new URL("../src/cast-server.ts", import.meta.url), "utf8");
    expect(workerTs).toContain("dsh-browser-cdp.cast.json");
    expect(castServer).toContain("dsh-browser-cdp.cast.json");
    // the shared upstream name must not appear as a quoted path in our code
    expect(workerTs).not.toMatch(/['"]ego-cast\.json['"]/);
    expect(castServer).not.toMatch(/['"]ego-cast\.json['"]/);
  });
  it("pick delivery derives the current session the host's way (list.current was removed in 0.1.6-alpha.2)", () => {
    expect(source).toMatch(/retainedBy\.mainView/);
    expect(source).not.toMatch(/getSnapshot\(\)\.current/);
  });
  it("the picks wrapper registers as a conversation.input.dock contributor (order 1000, priority 0)", () => {
    expect(source).toMatch(/ctx\.slots\.inject\('conversation\.input\.dock'/);
    expect(source).toMatch(/id: 'dsh-browser-cdp\.picks'/);
    expect(source).toMatch(/order: 0/);
    expect(source).not.toMatch(/priority: 0/);
    expect(source).not.toMatch(/__dshBrowserCdpDeco = \{ stage: 'rendered'/);
  });
});


describe("settings section layout: links first, judgement group folds", () => {
  it("the connection-target block renders BEFORE every field group", () => {
    const start = source.indexOf("function FamilySettingsCard");
    const end = source.indexOf("function FamGroup");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fn = source.slice(start, end);
    const linksAt = fn.indexOf("h(FamLinks");
    const groupsAt = fn.indexOf("FAM_FIELD_GROUPS.map");
    expect(linksAt).toBeGreaterThan(-1);
    expect(groupsAt).toBeGreaterThan(-1);
    // 顺序即语义：连接目标是分节第一性配置，必须排在所有分组之前。
    expect(linksAt).toBeLessThan(groupsAt);
    expect(fn).toMatch(/first: true/);
  });

  it("the first block drops its top divider so the section has no stray rule", () => {
    const start = source.indexOf("function FamLinks");
    const end = source.indexOf("function apply(ctx");
    expect(end).toBeGreaterThan(start);
    const fn = source.slice(start, end);
    expect(fn).toMatch(/props\.first === true/);
    expect(fn).toMatch(/linksHeadStyle/);
  });

  it("every configuration group folds, and its collapsed state never touches host config", () => {
    // 四个配置组全部可折叠：工具封印 / 基础 / 截图与推流 / 评审（JEV / Laya）。
    const groupsAt = source.indexOf("var FAM_FIELD_GROUPS");
    const groupsEnd = source.indexOf("function famText");
    const groups = source.slice(groupsAt, groupsEnd);
    for (const gk of ["gTools", "gBasic", "gCapture", "gJudge"]) {
      expect(groups).toMatch(new RegExp("gk: '" + gk + "', foldable: true"));
    }
    expect((groups.match(/foldable: true/g) || []).length).toBe(4);
    // 折叠 = 纯 UI 态：只写 localStorage，绝不 commitField。
    const start = source.indexOf("function FamGroup");
    const end = source.indexOf("function FamField");
    const fn = source.slice(start, end);
    expect(fn).toMatch(/aria-expanded/);
    expect(fn).toMatch(/readFold\(group\.gk\)/);
    expect(fn).toMatch(/writeFold\(group\.gk, next\)/);
    expect(fn).not.toMatch(/commitField/);
    expect(fn).not.toMatch(/scope\.set/);
    // 收起时不渲染字段行（不是 CSS 隐藏）。
    expect(fn).toMatch(/foldable && !open/);
    // 折叠态读写全程 try/catch：隐私模式/配额满不抛。
    const helpers = source.slice(source.indexOf("function foldKey"), groupsAt);
    expect((helpers.match(/try \{/g) || []).length).toBe(2);
    expect(helpers).toMatch(/bcdp\.settings\.fold\./);
  });
});
