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

  it("the managed-local row is explicit and mode-synced", () => {
    expect(source).toMatch(/wt\('linksLocalRow'\)/);
    expect(source).toMatch(/void scope\.set\('cdpMode', 'local'\)/);
    expect(source).toMatch(/if \(cdpMode === 'local'\) \{ void scope\.set\('cdpMode', 'auto'\) \}/);
    expect(source).toMatch(/void scope\.set\('allowLocalFallback'/);
  });

  it("the first target added to an empty sequence activates itself", () => {
    expect(source).toMatch(/activeId === ''/);
  });
  it("the cast worker state file is plugin-namespaced (upstream ego-cast.json coexistence)", async () => {
    expect(source).toMatch(/void scope\.set\('cdpMode', 'local'\)/);
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
