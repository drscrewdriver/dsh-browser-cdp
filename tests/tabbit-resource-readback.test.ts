import { describe, it, expect } from "vitest";
import {
  readTabbitResource,
  runTabbitSnippet,
  tabbitResourceRef,
  TABBIT_RESOURCE_PAGE_BYTES,
} from "../src/cdp/tabbit-cli-link.ts";

// 厂商运行时把超过 16 KiB 的返回值降级成资源：result 只剩 {resourceId, byteLength}
// 没有 value。旧代码把它当成值本身，于是 ok:true 而字段全空（大快照、大
// console.log 静默变空）。下面几条锁住读回链路与误判边界。

const reader = (text: string) => ({ readFrom: () => ({ text, nextOffset: text.length, lossy: false }) });

/** 按 argv 派发的假 subprocess：nodejs 回降级回执，resource 分页回数据。 */
const fakeCli = (opts: {
  nodejsStdout: string;
  pages: Array<{ data?: string; nextOffset?: number; eof?: boolean }>;
}) => {
  const calls: string[][] = [];
  let page = 0;
  return {
    calls,
    spawn: (req: any) => {
      const argv: string[] = req.argv;
      calls.push(argv);
      const verb = argv[1];
      if (verb === "nodejs") {
        return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: { stdout: reader(opts.nodejsStdout), stderr: reader("") } };
      }
      const chunk = opts.pages[page] ?? {};
      page += 1;
      return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: { stdout: reader(JSON.stringify(chunk)), stderr: reader("") } };
    },
  };
};

const demoted = (id: string, bytes: number) =>
  JSON.stringify({ status: "succeeded", result: { resourceId: id, byteLength: bytes, elapsedMs: 12, requestId: "r-1" } });

describe("tabbitResourceRef", () => {
  it("recognises the demoted payload shape", () => {
    expect(tabbitResourceRef({ resourceId: "result-1", byteLength: 40033 })).toEqual({ resourceId: "result-1", byteLength: 40033 });
  });

  it("does not treat a plain page value that happens to carry a resourceId as demotion", () => {
    // 页面代码真可能返回 {resourceId: "…"}；缺 byteLength / 带 value 都不算降级。
    expect(tabbitResourceRef({ resourceId: "abc" })).toBeNull();
    expect(tabbitResourceRef({ resourceId: "abc", byteLength: 3, value: { a: 1 } })).toBeNull();
    expect(tabbitResourceRef({ snapshot: "- heading" })).toBeNull();
    expect(tabbitResourceRef(null)).toBeNull();
    expect(tabbitResourceRef("text")).toBeNull();
  });
});

describe("runTabbitSnippet result readback", () => {
  it("reads a demoted result back and decodes the value", async () => {
    const value = { snapshot: "x".repeat(100), truncated: false };
    const sub = fakeCli({
      nodejsStdout: demoted("result-a", 40033),
      pages: [{ data: JSON.stringify(value), nextOffset: 40033, eof: true }],
    }) as any;
    const { receipt } = await runTabbitSnippet(sub, "return 1;", { cliPath: "cli", taskName: "t", requestId: "r-1" });
    expect(receipt.ok).toBe(true);
    expect(receipt.data).toEqual(value);
    expect(receipt.dataTruncated).toBeUndefined();
    const resourceCall = sub.calls.find((a: string[]) => a[1] === "resource");
    expect(resourceCall).toBeDefined();
    expect(resourceCall).toContain("--resource");
    expect(resourceCall).toContain(String(TABBIT_RESOURCE_PAGE_BYTES));
  });

  it("follows nextOffset across pages until eof", async () => {
    const sub = fakeCli({
      nodejsStdout: demoted("result-b", 12),
      pages: [
        { data: '{"a":', nextOffset: 5, eof: false },
        { data: "1}", nextOffset: 9, eof: true },
      ],
    }) as any;
    const { receipt } = await runTabbitSnippet(sub, "return 1;", { cliPath: "cli", taskName: "t", requestId: "r-1" });
    expect(receipt.data).toEqual({ a: 1 });
    expect(receipt.dataTruncated).toBeUndefined();
    const offsets = sub.calls.filter((a: string[]) => a[1] === "resource").map((a: string[]) => a[a.indexOf("--offset") + 1]);
    expect(offsets).toEqual(["0", "5"]);
  });

  it("flags truncation instead of silently returning nothing when the read stops early", async () => {
    const sub = fakeCli({
      nodejsStdout: demoted("result-c", 900000),
      // 第二块不前进（nextOffset 与 offset 相同）→ 判为没读完，绝不自旋。
      pages: [{ data: "partial", nextOffset: 7, eof: false }, { data: "partial", nextOffset: 7, eof: false }],
    }) as any;
    const { receipt } = await runTabbitSnippet(sub, "return 1;", { cliPath: "cli", taskName: "t", requestId: "r-1" });
    expect(receipt.dataTruncated).toBe(true);
    expect(receipt.dataByteLength).toBe(900000);
    expect(receipt.data).toBe("partial");
    const resourceCalls = sub.calls.filter((a: string[]) => a[1] === "resource");
    expect(resourceCalls.length).toBe(2);
  });

  it("never issues a resource read for an inline result", async () => {
    const sub = fakeCli({
      nodejsStdout: JSON.stringify({ status: "succeeded", result: { value: { ok: true, result: "Example Domain" } } }),
      pages: [],
    }) as any;
    const { receipt } = await runTabbitSnippet(sub, "return 1;", { cliPath: "cli", taskName: "t", requestId: "r-1" });
    expect(receipt.data).toEqual({ ok: true, result: "Example Domain" });
    expect(sub.calls.some((a: string[]) => a[1] === "resource")).toBe(false);
  });
});

describe("readTabbitResource guards", () => {
  it("gives up cleanly when the CLI errors", async () => {
    const sub = {
      spawn: () => ({ done: Promise.resolve({ exitCode: 1, signal: null }), collected: { stdout: reader(""), stderr: reader("boom") } }),
    } as any;
    const r = await readTabbitResource(sub, "cli", "t", "result-x");
    expect(r).toEqual({ text: "", complete: false });
  });

  it("stops at the byte cap without spinning", async () => {
    let n = 0;
    const sub = {
      spawn: () => {
        n += 1;
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: { stdout: reader(JSON.stringify({ data: "x".repeat(100), nextOffset: (n + 1) * 100, eof: false })), stderr: reader("") },
        };
      },
    } as any;
    const r = await readTabbitResource(sub, "cli", "t", "result-y", 250);
    expect(r.complete).toBe(false);
    expect(r.text.length).toBeLessThanOrEqual(400);
    expect(n).toBeLessThanOrEqual(4);
  });
});
