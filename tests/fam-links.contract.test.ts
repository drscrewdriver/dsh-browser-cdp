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
    const activeClear = fn.indexOf("scope.set('activeTargetId', '')");
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

  it("the same FamilySettingsCard also mounts on the plugins page (plugins.bundle.config, keyed by package)", () => {
    const start = source.indexOf("function mountPluginsPageCard");
    expect(start).toBeGreaterThan(-1);
    const fn = source.slice(start);
    expect(fn).toMatch(/ctx\.slots\.inject\('plugins\.bundle\.config'/);
    expect(fn).toMatch(/key: 'dsh-browser-cdp'/);
    expect(fn.indexOf("FamilySettingsCard")).toBeGreaterThan(-1);
    // one render source, two surfaces: the family tab keeps its own mount
    expect(source).toMatch(/ctx\.slots\.inject\('dsh-family\.tab'/);
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
});
