import { describe, it, expect } from "vitest";
import {
  buildClickSnippet,
  buildFillSnippet,
  buildFrameCaptureSnippet,
  buildScreenshotSnippet,
  parseTabbitReceipt,
  runTabbitSnippet,
  translateLocator,
  TABBIT_CAPTURE_DEADLINE_MS,
  TABBIT_FRAME_JPEG_QUALITY,
  TABBIT_MAX_TIMEOUT_MS,
  TABBIT_MIN_TIMEOUT_MS,
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
    expect(buildFrameCaptureSnippet(OUT)).toMatch(/try \{ await c\.detach\(\); \} catch \{\}/);
  });

  it("bounds the capture with a race so a stuck send cannot hang the task", () => {
    // Live evidence: the same tab that answers in 132 ms can also never answer.
    // An unanswered send blocks the evaluation until the CLI's hard deadline and
    // takes the whole task executor down with it.
    const js = buildFrameCaptureSnippet(OUT);
    expect(js).toContain("Promise.race");
    expect(js).toContain(`capture-deadline`);
    expect(js).toContain(String(TABBIT_CAPTURE_DEADLINE_MS));
    // And the timeout must resolve into a marker, not an unhandled rejection.
    expect(js).toContain('skipped: "capture-timeout"');
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

// The CLI rejects the WHOLE request when --timeout-ms is outside 60000..180000:
//
//   "--timeout-ms must be from 60000 through 180000; the default is 60000, so
//    omit it unless the program needs longer"
//
// The 3 s frame poller used to pass 10000/15000, so it never ran a single
// snippet — and the rejection arrives as an ordinary failed receipt, which is
// why it looked like a silent capture failure rather than a usage error.
describe("runTabbitSnippet --timeout-ms contract", () => {
  async function captureArgv(timeoutMs?: number): Promise<string[]> {
    const argv: string[] = [];
    const subprocess = {
      spawn: (opts: { argv: string[] }) => {
        argv.push(...opts.argv);
        return {
          done: Promise.resolve({ exitCode: 0 }),
          collected: {
            stdout: { readFrom: () => ({ text: '{"status":"succeeded","result":{"value":{"ok":true}}}' }) },
            stderr: { readFrom: () => ({ text: "" }) },
          },
        };
      },
    } as unknown as Parameters<typeof runTabbitSnippet>[0];
    await runTabbitSnippet(subprocess, "return {ok:true};", {
      cliPath: "C:\\fake\\tabbit-cli.exe",
      taskName: "t",
      requestId: "r",
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    return argv;
  }

  const timeoutValue = (argv: string[]): string | undefined => {
    const i = argv.indexOf("--timeout-ms");
    return i === -1 ? undefined : argv[i + 1];
  };

  it("omits the flag entirely when no timeout is requested", async () => {
    expect(timeoutValue(await captureArgv())).toBeUndefined();
  });

  it("lifts a too-small timeout up to the CLI minimum", async () => {
    // 15000 was the poller's value: it made the CLI refuse the request outright.
    expect(timeoutValue(await captureArgv(15000))).toBe(String(TABBIT_MIN_TIMEOUT_MS));
    expect(timeoutValue(await captureArgv(10000))).toBe(String(TABBIT_MIN_TIMEOUT_MS));
  });

  it("clamps an oversized timeout down to the CLI maximum", async () => {
    expect(timeoutValue(await captureArgv(999999))).toBe(String(TABBIT_MAX_TIMEOUT_MS));
  });

  it("passes a valid timeout through untouched", async () => {
    expect(timeoutValue(await captureArgv(120000))).toBe("120000");
  });
});

describe("tabbit locator translation", () => {
  // 快照 ref 曾被猜成 [data-ref="N"] 属性——绝大多数页面不存在该属性，
  // 等于 ref 永远点不中。Tabbit 的原生定位器是 aria-ref=eN，且必须 normalize。
  it("maps snapshot refs to the native aria-ref locator with normalize", () => {
    for (const sel of ["@e3", "e3", "@3", "3", "ref=3", "ref=e3"]) {
      expect(translateLocator(sel)).toEqual({ expr: 'page.locator("aria-ref=e3")', normalize: true });
    }
  });

  it("keeps the pre-existing selector forms byte-identical", () => {
    expect(translateLocator('loc=role:button[name="Save"]')).toEqual({
      expr: 'page.getByRole("button", {name: "Save", exact: true})',
      normalize: false,
    });
    expect(translateLocator("loc=css:.btn")).toEqual({ expr: 'page.locator(".btn")', normalize: false });
    expect(translateLocator("loc=href:/x")).toEqual({
      expr: `page.locator(${JSON.stringify('a[href="/x"]')})`,
      normalize: false,
    });
    expect(translateLocator("div > p")).toEqual({ expr: 'page.locator("div > p")', normalize: false });
  });

  it("reads loc=css:3 as a CSS selector, never as a ref", () => {
    expect(translateLocator("loc=css:3")).toEqual({ expr: 'page.locator("3")', normalize: false });
  });

  it("passes xpath= through to Playwright, which understands it natively", () => {
    expect(translateLocator("xpath=//a")).toEqual({ expr: 'page.locator("xpath=//a")', normalize: false });
  });

  it("returns null for input it cannot resolve", () => {
    expect(translateLocator("")).toBeNull();
    expect(translateLocator("@e")).toBeNull();
    expect(translateLocator("@3x")).toBeNull();
  });

  it("normalizes before acting when the plan says so", () => {
    const click = buildClickSnippet({ expr: 'page.locator("aria-ref=e3")', normalize: true });
    expect(click.split("\n")[0]).toBe('const el = await page.locator("aria-ref=e3").normalize();');
    expect(click).toContain("await el.click();");
    expect(click).toContain("normalized: true");

    const fill = buildFillSnippet({ expr: 'page.locator(".x")', normalize: false }, "v");
    expect(fill.split("\n")[0]).toBe('const el = page.locator(".x");');
    expect(fill).toContain('await el.fill("v");');
    expect(fill).toContain("normalized: false");
  });

  it("escapes the fill value instead of interpolating it raw", () => {
    const fill = buildFillSnippet({ expr: 'page.locator(".x")', normalize: false }, 'a"b\\c');
    expect(fill).toContain(JSON.stringify('a"b\\c'));
  });
});
