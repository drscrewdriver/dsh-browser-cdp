import { describe, it, expect } from "vitest";
import { buildScriptSnippet } from "../src/cdp/tabbit-cli-link.ts";

// `bcdp_script` 的 description 承诺「可用 console.log(JSON.stringify(payload))
// 拿到 result」，而 Tabbit 通道默认丢弃 console 输出——包装层就是为了兑现这个
// 既有承诺，而不是静默改变工具语义。

describe("tabbit script snippet", () => {
  it("captures console.log into stdout", () => {
    const js = buildScriptSnippet("console.log('hi');");
    expect(js).toContain("console.log = (...a) =>");
    expect(js).toContain("__lines.push");
    expect(js).toContain('stdout: __lines.join("\\n")');
  });

  it("restores the original console.log on the way out", () => {
    const js = buildScriptSnippet("return 1;");
    expect(js).toContain("const __log = console.log;");
    expect(js).toContain("finally { console.log = __log; }");
  });

  it("forwards an explicit return value as result", () => {
    const js = buildScriptSnippet("return {a: 1};");
    expect(js).toContain("__ret = await (async () => { return {a: 1};");
    expect(js).toContain("result: __ret");
  });

  it("collects a thrown error into the payload instead of losing it", () => {
    const js = buildScriptSnippet("throw new Error('boom');");
    expect(js).toContain("catch (e) { __err = String((e && e.message) || e); }");
    expect(js).toContain("error: __err");
  });

  it("puts a newline between body and closer so a trailing // comment cannot eat it", () => {
    const js = buildScriptSnippet("return 1; // done");
    expect(js).toContain("return 1; // done\n })();");
  });

  it("keeps top-level await working inside the async wrapper", () => {
    const js = buildScriptSnippet("const t = await page.title();\nreturn t;");
    expect(js).toContain("__ret = await (async () => {");
    expect(js).toContain("const t = await page.title();");
  });

  it("emits exactly one return statement of its own, after the body", () => {
    const js = buildScriptSnippet("return 1;");
    const own = js.split("\n").filter((line) => line.startsWith("return { stdout:"));
    expect(own.length).toBe(1);
  });
});
