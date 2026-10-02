import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/client/index.ts", import.meta.url), "utf8");

describe("watch panel input and capture status", () => {
  it("provides local keyboard proxies for floating and sidebar views", () => {
    expect(source).toMatch(/function createKeyboardProxy\(send: any\)/);
    expect(source).toMatch(/compositionend/);
    expect(source).toMatch(/send\([^,]+, 'insertText'/);
    expect((source.match(/keyboardProxy\.focusAt\(e,/g) || []).length).toBe(2);
  });

  it("does not gate control input on stream state or default missing status to CDP", () => {
    expect(source).not.toMatch(/status\.backend \|\| 'cdp'/);
    expect(source).not.toMatch(/targetValid[^\n]+streamState !== 'streaming'/);
  });

  it("0.2.0: settings gateway is gone; the panel reads live capture status instead", () => {
    // The old settings card's ffmpeg install UI rode the /bcdp/api gateway,
    // which declarative settings replaced with the auto-generated form.
    // The watch panel must keep reading its capture status from the watch route,
    // and the client must NOT reference the retired CONFIG pair (get/set —
    // writes belong to the declarative settings form via configForms). Runtime
    // capability routes on the same prefix stay legal: cdp-probe was restored
    // by 67dabb8 precisely for the per-target probe button.
    expect(source).not.toMatch(/\/bcdp\/api\/(get|set)/);
    expect(source).toMatch(/WATCH_STATUS_ROUTE/);
    expect(source).toMatch(/applyCaptureStatus/);
  });
});
