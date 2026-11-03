import { describe, it, expect } from "vitest";
import {
  buildFrameCaptureSnippet,
  buildScreenshotSnippet,
  parseTabbitReceipt,
  TABBIT_FRAME_JPEG_QUALITY,
  type TabbitTab,
} from "../src/cdp/tabbit-cli-link.ts";

// Regression cover for the two tabbit-backend defects found on a live session:
//
//  1. The watch panel stayed EMPTY while every tool call reported success.
//     The frame snippet returned the raw base64 in the receipt; any value above
//     tabbit-cli's inline threshold is demoted to a `resource`
//     ({type, resourceId, byteLength} — no `value`), so `receipt.data.base64`
//     was undefined, nothing was broadcast, and because `status` was still
//     `succeeded` not even a warning was logged.
//  2. `bcdp_screenshot` answered `base64: "[object Object]"` for the same
//     reason — it handed the whole demoted result object back as `base64`.
//
// Both now write their bytes to a scratch file and send back only the path.

describe("tabbit frame-capture snippet", () => {
  const OUT = "C:\\Temp\\frame-1.jpg";

  it("returns the scratch path instead of the image bytes", () => {
    const js = buildFrameCaptureSnippet(OUT);
    expect(js).toContain("fs.writeFileSync");
    // The value travelling back must be the path, never the payload: a base64
    // field here is what got demoted to a resource and silently dropped.
    expect(js).toMatch(/return \{path:/);
    expect(js).not.toMatch(/return \{[^}]*base64/);
  });

  it("captures through a page-scoped CDP session, not page.screenshot()", () => {
    const js = buildFrameCaptureSnippet(OUT);
    expect(js).toContain("context.newCDPSession(page)");
    expect(js).toContain("Page.captureScreenshot");
    // page.screenshot() blocks on font loading in this runtime (30 s timeout).
    expect(js).not.toContain("page.screenshot");
  });

  it("encodes JPEG so a 3 s cadence keeps up", () => {
    const js = buildFrameCaptureSnippet(OUT);
    expect(js).toContain('format: "jpeg"');
    expect(js).toContain(`quality: ${TABBIT_FRAME_JPEG_QUALITY}`);
  });

  it("skips a blank page before spending a capture on it", () => {
    // Capturing about:blank hangs the CLI to its hard deadline (60 s observed),
    // and a blank frame carries nothing for the panel anyway.
    const js = buildFrameCaptureSnippet(OUT);
    const blankGuard = js.indexOf('skipped: "blank"');
    expect(blankGuard).toBeGreaterThan(-1);
    expect(blankGuard).toBeLessThan(js.indexOf("Page.captureScreenshot"));
  });

  it("always detaches the CDP session, even when the capture throws", () => {
    expect(buildFrameCaptureSnippet(OUT)).toContain("await c.detach()");
    expect(buildFrameCaptureSnippet(OUT)).toMatch(/finally \{ try \{ await c\.detach\(\); \}/);
  });

  it("escapes the output path instead of interpolating it raw", () => {
    const weird = 'C:\\a"b\\frame.jpg';
    const js = buildFrameCaptureSnippet(weird);
    expect(js).toContain(JSON.stringify(weird));
  });
});

describe("tabbit screenshot snippet", () => {
  const OUT = "C:\\Temp\\shot.png";

  it("writes the PNG to the path and reports the path", () => {
    const js = buildScreenshotSnippet(OUT);
    expect(js).toContain(JSON.stringify(OUT));
    expect(js).toContain("fs.writeFileSync");
    expect(js).toMatch(/return \{path:/);
    expect(js).not.toMatch(/return \{[^}]*base64/);
  });

  it("uses CDP capture because page.screenshot() dies on font loading", () => {
    const js = buildScreenshotSnippet(OUT);
    expect(js).toContain("Page.captureScreenshot");
    expect(js).not.toContain("page.screenshot");
  });

  it("requests PNG for the tool's image contract", () => {
    expect(buildScreenshotSnippet(OUT)).toContain('format: "png"');
  });
});

describe("parseTabbitReceipt", () => {
  const succeeded = (result: Record<string, unknown>) =>
    JSON.stringify({ taskId: "task-1", requestId: "req-1", status: "succeeded", result });

  it("lifts the acquired tab ids out of result.acquisition", () => {
    // `data` only carries result.value, so acquisition has to be read separately
    // or the frame poller cannot know which tab the tools drove.
    const r = parseTabbitReceipt(succeeded({
      acquisition: { entryTabId: 305297576, status: "acquired", tabIds: [305297576, 305297579] },
      value: { url: "https://www.baidu.com/" },
    }));
    expect(r.ok).toBe(true);
    expect(r.tabIds).toEqual([305297576, 305297579]);
    expect(r.data).toEqual({ url: "https://www.baidu.com/" });
  });

  it("omits tabIds when the receipt has no acquisition block", () => {
    const r = parseTabbitReceipt(succeeded({ value: { url: "https://example.com/" } }));
    expect(r.ok).toBe(true);
    expect(r.tabIds).toBeUndefined();
  });

  it("surfaces the resource-demotion shape as data WITHOUT a value field", () => {
    // This is the exact receipt that used to look like a success while carrying
    // no image: `data` is the resource descriptor, so `data.base64` is undefined.
    const r = parseTabbitReceipt(succeeded({
      type: "resource",
      resourceId: "result-58e6e0bb",
      byteLength: 1329226,
    }));
    expect(r.ok).toBe(true);
    expect((r.data as Record<string, unknown>).type).toBe("resource");
    expect((r.data as Record<string, unknown>).base64).toBeUndefined();
  });

  it("keeps tabIds on a failed receipt too (a tab may still have been acquired)", () => {
    const r = parseTabbitReceipt(JSON.stringify({
      status: "failed",
      result: { error: "page.screenshot: Timeout 30000ms exceeded", acquisition: { tabIds: [305297576] } },
    }));
    expect(r.ok).toBe(false);
    expect(r.tabIds).toEqual([305297576]);
  });
});

describe("TabbitTab", () => {
  it("names the identifier and current-tab marker the CLI actually emits", () => {
    // The type used to declare `id` and drop `active`, so callers reached through
    // `any` to find the tab they wanted.
    const t: TabbitTab = {
      tabId: 305297576,
      title: "百度一下，你就知道",
      url: "https://www.baidu.com/",
      state: "available",
      active: true,
      index: 3,
      windowId: 305297549,
    };
    expect(t.tabId).toBe(305297576);
    expect(t.active).toBe(true);
  });
});
