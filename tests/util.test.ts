// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { safeEvalWrap } from "../src/util.ts";

// E: safeEvalWrap generates an IN-PAGE IIFE whose job is to bound the result
// that crosses the CDP/handleMessage serialization (the ego SDK hard-rejects a
// cyclic/window graph with "Object reference chain is too long" before any
// outer safe() can see it). We reproduce the in-page context by eval'ing the
// wrapper inside jsdom, where a real cyclic `window` graph exists.

describe("safeEvalWrap (E: bounded result serialization)", () => {
  it("passes primitives and plain (non-cyclic) objects through unchanged", () => {
    expect(eval(safeEvalWrap("1 + 1"))).toBe(2);
    expect(eval(safeEvalWrap("'a' + 'b'"))).toBe("ab");
    expect(eval(safeEvalWrap("({ x: 1, y: [2, 3] })"))).toEqual({ x: 1, y: [2, 3] });
  });

  it("degrades a cyclic object to a toString string instead of throwing", () => {
    const cyc: Record<string, unknown> = { a: 1 };
    cyc.self = cyc; // self-reference -> JSON.stringify throws
    ;(globalThis as Record<string, unknown>).__cyc = cyc;
    const degraded = eval(safeEvalWrap("globalThis.__cyc"));
    expect(typeof degraded).toBe("string");
    expect(degraded).toBe("[object Object]");
  });

  it("degrades the window global (canonical too-long-chain payload) to a bounded string", () => {
    const out = eval(safeEvalWrap("window"));
    // The exact [object <tag>] differs across hosts (jsdom -> [object global],
    // a real page -> [object Window]); the contract is only that it degrades to
    // a small string instead of throwing "Object reference chain is too long".
    expect(typeof out).toBe("string");
    expect(out).toMatch(/^\[object \w+\]$/);
  });

  it("degrades an element-like cyclic handle with a <tag>#id hint", () => {
    const el: Record<string, unknown> = {
      tagName: "DIV",
      getAttribute: (k: string) => (k === "id" ? "probe" : null),
    };
    el.self = el; // force JSON.stringify to throw -> catch branch runs
    ;(globalThis as Record<string, unknown>).__el = el;
    const out = eval(safeEvalWrap("globalThis.__el"));
    expect(out).toBe("<div>#probe");
  });

  it("preserveFalsy returns falsy as-is and degrades a truthy handle to a non-empty string", () => {
    expect(eval(safeEvalWrap("false", true))).toBe(false);
    expect(eval(safeEvalWrap("null", true))).toBe(null);
    expect(eval(safeEvalWrap("0", true))).toBe(0);
    const truthy = eval(safeEvalWrap("window", true));
    // cyclic window -> bounded toString form (host-dependent tag); still a
    // truthy value, which is the point of preserveFalsy in op=function: the
    // waitForFunction predicate sees a non-falsy value and resolves "satisfied"
    // instead of hanging.
    expect(typeof truthy).toBe("string");
    expect(truthy).toMatch(/^\[object \w+\]$/);
    expect(Boolean(truthy)).toBe(true);
  });
});
