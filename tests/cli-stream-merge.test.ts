import { describe, it, expect } from "vitest";
import { mergeCliOutput } from "../src/cdp/cli-link.ts";
import { parseSentinel } from "../src/index.ts";

// R4 — the ego CLI on Windows writes the embedded runtime's output to stderr.
// These tests pin the merge order (stdout first) and the "last sentinel wins"
// rule that keeps a stale stdout payload from shadowing a fresh stderr one.
describe("mergeCliOutput (R4)", () => {
  it("returns stderr when stdout is empty", () => {
    expect(mergeCliOutput({ stdout: "", stderr: "x" })).toBe("x");
  });

  it("returns stdout when stderr is empty", () => {
    expect(mergeCliOutput({ stdout: "x", stderr: "" })).toBe("x");
  });

  it("keeps stdout before stderr when both are present", () => {
    expect(mergeCliOutput({ stdout: "a", stderr: "b" })).toBe("a\nb");
  });

  it("returns an empty string when both streams are empty", () => {
    expect(mergeCliOutput({ stdout: "", stderr: "" })).toBe("");
  });
});

describe("parseSentinel over merged output (R4)", () => {
  it("finds the payload when it only exists on stderr", () => {
    const merged = mergeCliOutput({
      stdout: "",
      stderr: 'noise\n@@DSH_RESULT@@{"ok":true,"n":1}\n',
    });
    expect(parseSentinel(merged)).toEqual({ ok: true, n: 1 });
  });

  it("finds the payload when it only exists on stdout", () => {
    const merged = mergeCliOutput({
      stdout: '@@DSH_RESULT@@{"ok":true,"n":1}\n',
      stderr: "",
    });
    expect(parseSentinel(merged)).toEqual({ ok: true, n: 1 });
  });

  it("prefers the last sentinel line (stderr wins over an earlier stdout value)", () => {
    const merged = mergeCliOutput({
      stdout: '@@DSH_RESULT@@{"ok":true,"n":1}\n',
      stderr: '@@DSH_RESULT@@{"ok":true,"n":2}\n',
    });
    expect(parseSentinel(merged)).toEqual({ ok: true, n: 2 });
  });

  it("tolerates a REPL prompt prefixing the sentinel line", () => {
    const merged = mergeCliOutput({
      stdout: "",
      stderr: 'repl> @@DSH_RESULT@@{"ok":true}\n',
    });
    expect(parseSentinel(merged)).toEqual({ ok: true });
  });

  it("returns undefined when neither stream carries the sentinel", () => {
    expect(parseSentinel(mergeCliOutput({ stdout: "a", stderr: "b" }))).toBeUndefined();
  });
});

// 1.3.1 — both tool descriptions told the model to "end with
// console.log(JSON.stringify(...))", i.e. WITHOUT the sentinel prefix. Such a
// script ran fine and was still reported as a failure, so a bare JSON object
// line now counts as a payload too.
describe("parseSentinel bare-JSON fallback (1.3.1)", () => {
  it("accepts a bare JSON object line when no sentinel is present", () => {
    const merged = mergeCliOutput({
      stdout: "",
      stderr: '{"ok":true,"title":"百度一下，你就知道"}\r\n\r\n',
    });
    expect(parseSentinel(merged)).toEqual({ ok: true, title: "百度一下，你就知道" });
  });

  it("still prefers the sentinel over a later bare JSON line", () => {
    const merged = mergeCliOutput({
      stdout: '@@DSH_RESULT@@{"ok":true,"src":"sentinel"}\n{"ok":true,"src":"bare"}\n',
      stderr: "",
    });
    expect(parseSentinel(merged)).toMatchObject({ src: "sentinel" });
  });

  it("takes the LAST bare JSON object, not the first", () => {
    const merged = mergeCliOutput({
      stdout: "",
      stderr: '{"n":1}\nnoise\n{"n":2}\n',
    });
    expect(parseSentinel(merged)).toEqual({ n: 2 });
  });

  it("ignores JSON arrays, bare scalars, and prose", () => {
    expect(parseSentinel("[1,2,3]")).toBeUndefined();
    expect(parseSentinel("42")).toBeUndefined();
    expect(parseSentinel('the result was {"ok":true} inline')).toBeUndefined();
  });

  it("is a no-op for the structured tools (they always emit the sentinel)", () => {
    expect(parseSentinel('@@DSH_RESULT@@{"ok":true}')).toEqual({ ok: true });
  });
});
