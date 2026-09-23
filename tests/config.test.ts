import { describe, it, expect } from "vitest";
import { resolveConfig, judgeSettingsOf, tokenizeArgs, filterArgs, EGO_CLI_BLOCKED, CHROME_BLOCKED } from "../src/config.ts";

describe("dual capture config", () => {
  it("returns canonical defaults", () => {
    expect(resolveConfig({})).toEqual({
      chromePath: "", captureBackend: "auto", streamProfile: "balanced",
      cdpFps: 20, cdpQuality: 55, cdpMaxWidth: 960, cdpBackstopIntervalMs: 3000,
      ffmpegFps: 20, ffmpegMaxWidth: 1280, ffmpegBitrateKbps: 4000, ffmpegEncoder: "auto", ffmpegPath: "", githubMirror: "",
      runtimeArgs: "", chromeArgs: "", isolateSpaces: false, idleTimeoutMin: 0,
      links: [], activeTargetId: "", cdpMode: "auto", cdpProbeTimeoutMs: 3000,
      cursorHud: true, cursorName: "DeepSeek", allowLocalFallback: false, localHeadless: false, localUserDataDir: "", legacyEgoToolNames: false, remoteEnabled: true,
      // 阶段 10 judge defaults. layaUrl defaults to the REAL sidecar port:/n      // 7789 (JevLoop’s value) is a different tool and yields a confusing
      // connection error that reads like "laya is down".
      jevUrl: "", jevKey: "", jevModel: "jev",
      layaUrl: "http://127.0.0.1:8000", layaKey: "", layaModel: "laya",
      judgePrefer: "jev,laya,rule", jevChunkSize: 20, jevMaxImageBytes: 0,
      jevHistoryLimit: 5, jevArchiveImage: false, jevStepBudget: 20, jevWallMs: 120000,
    });
  });

  it("migrates legacy CDP fields and lets canonical fields win", () => {
    expect(resolveConfig({ castFpsCap: 60, screencastQuality: 70, screencastMaxWidth: 1200, backstopIntervalMs: 5000 })).toEqual({
      chromePath: "", captureBackend: "auto", streamProfile: "balanced",
      cdpFps: 30, cdpQuality: 70, cdpMaxWidth: 1200, cdpBackstopIntervalMs: 5000,
      ffmpegFps: 20, ffmpegMaxWidth: 1280, ffmpegBitrateKbps: 4000, ffmpegEncoder: "auto", ffmpegPath: "", githubMirror: "",
      runtimeArgs: "", chromeArgs: "", isolateSpaces: false, idleTimeoutMin: 0,
      links: [], activeTargetId: "", cdpMode: "auto", cdpProbeTimeoutMs: 3000,
      cursorHud: true, cursorName: "DeepSeek", allowLocalFallback: false, localHeadless: false, localUserDataDir: "", legacyEgoToolNames: false, remoteEnabled: true,
      // 阶段 10 judge defaults. layaUrl defaults to the REAL sidecar port:/n      // 7789 (JevLoop’s value) is a different tool and yields a confusing
      // connection error that reads like "laya is down".
      jevUrl: "", jevKey: "", jevModel: "jev",
      layaUrl: "http://127.0.0.1:8000", layaKey: "", layaModel: "laya",
      judgePrefer: "jev,laya,rule", jevChunkSize: 20, jevMaxImageBytes: 0,
      jevHistoryLimit: 5, jevArchiveImage: false, jevStepBudget: 20, jevWallMs: 120000,
    });
    expect(resolveConfig({ cdpFps: 15, castFpsCap: 30 }).cdpFps).toBe(15);
  });

  it("falls back for invalid enums and numbers", () => {
    const config = resolveConfig({ captureBackend: "bad", cdpFps: 99, ffmpegEncoder: "bad" } as any);
    expect(config.captureBackend).toBe("auto");
    expect(config.cdpFps).toBe(20);
    expect(config.ffmpegEncoder).toBe("auto");
  });

  it("applies stream profiles unless advanced FFmpeg fields override them", () => {
    expect(resolveConfig({ streamProfile: "low" }).ffmpegFps).toBe(15);
    expect(resolveConfig({ streamProfile: "high" }).ffmpegMaxWidth).toBe(1600);
    expect(resolveConfig({ streamProfile: "low" }).ffmpegBitrateKbps).toBe(2000);
    expect(resolveConfig({ streamProfile: "high" }).ffmpegBitrateKbps).toBe(8000);
    expect(resolveConfig({ streamProfile: "high", ffmpegBitrateKbps: 6000 }).ffmpegBitrateKbps).toBe(6000);
    expect(resolveConfig({ streamProfile: "high", ffmpegFps: 12 }).ffmpegFps).toBe(12);
    expect(resolveConfig({ backstopIntervalMs: 200 }).cdpBackstopIntervalMs).toBe(1000);
  });
});

// ── user-defined extra CLI args (runtimeArgs / chromeArgs) ───────────────────

describe("user-defined extra CLI args", () => {
  it("resolveConfig defaults runtimeArgs / chromeArgs to empty strings", () => {
    const c = resolveConfig({});
    expect(c.runtimeArgs).toBe("");
    expect(c.chromeArgs).toBe("");
  });

  it("resolveConfig passes through non-string as empty string", () => {
    const c = resolveConfig({ runtimeArgs: 123, chromeArgs: null } as any);
    expect(c.runtimeArgs).toBe("");
    expect(c.chromeArgs).toBe("");
  });

  it("resolveConfig preserves the raw string (filtering happens at call site)", () => {
    const c = resolveConfig({ runtimeArgs: "--status --sdk-path /x", chromeArgs: "--headless --proxy-server=bad" });
    // Stored raw; blocklist is applied by filterArgs at spawn time so a saved
    // value is not silently mutated by a later blocklist change.
    expect(c.runtimeArgs).toBe("--status --sdk-path /x");
    expect(c.chromeArgs).toBe("--headless --proxy-server=bad");
  });
});

describe("tokenizeArgs", () => {
  it("returns [] for empty / whitespace-only input", () => {
    expect(tokenizeArgs("")).toEqual([]);
    expect(tokenizeArgs("   ")).toEqual([]);
    expect(tokenizeArgs("\t\n")).toEqual([]);
    expect(tokenizeArgs(undefined)).toEqual([]);
    expect(tokenizeArgs(null)).toEqual([]);
  });

  it("splits on bare whitespace", () => {
    expect(tokenizeArgs("--a --b c")).toEqual(["--a", "--b", "c"]);
  });

  it("preserves quoted tokens as single args", () => {
    expect(tokenizeArgs('"--a value" --b')).toEqual(["--a value", "--b"]);
    expect(tokenizeArgs("'path with spaces' --b")).toEqual(["path with spaces", "--b"]);
  });

  it("handles backslash escapes", () => {
    expect(tokenizeArgs('a\\ b c')).toEqual(["a b", "c"]);
    expect(tokenizeArgs('"a\\"b"')).toEqual(['a"b']);
  });

  it("keeps = attached to its flag", () => {
    expect(tokenizeArgs("--proxy-server=http://host:7890 --x")).toEqual(["--proxy-server=http://host:7890", "--x"]);
  });
});

describe("filterArgs", () => {
  it("drops blocked bare flags and their value when value is non-flag", () => {
    // --status is blocked and would exit before the heredoc; drop it.
    const out = filterArgs("--status --sdk-path /x", EGO_CLI_BLOCKED);
    expect(out).toEqual(["--sdk-path", "/x"]);
  });

  it("drops blocked =-form flags without consuming a value", () => {
    const out = filterArgs("--headless=new --keep-me", CHROME_BLOCKED);
    expect(out).toEqual(["--keep-me"]);
  });

  it("does not drop a value that happens to start with - after a blocked bare flag", () => {
    // --headless is blocked; next token starts with -, so it is NOT its value.
    const out = filterArgs("--headless --other", CHROME_BLOCKED);
    expect(out).toEqual(["--other"]);
  });

  it("drops --proxy-server and its value (use EGO_LINUX_PROXY instead)", () => {
    const out = filterArgs("--proxy-server=http://x --keep", CHROME_BLOCKED);
    expect(out).toEqual(["--keep"]);
  });

  it("drops a bare --proxy-server plus its separate value", () => {
    const out = filterArgs("--proxy-server http://x --keep", CHROME_BLOCKED);
    expect(out).toEqual(["--keep"]);
  });

  it("preserves allowed args verbatim (order + quoting collapsed by tokenizer)", () => {
    const out = filterArgs("--disable-features=Translate --window-size=800,600", CHROME_BLOCKED);
    expect(out).toEqual(["--disable-features=Translate", "--window-size=800,600"]);
  });

  it("returns [] when all args are blocked", () => {
    expect(filterArgs("--status --stop --help", EGO_CLI_BLOCKED)).toEqual([]);
  });
});

// ── R7: heterogeneous connection sequence ──────────────────────────────────

describe("R7 connection sequence", () => {
  it("reads the legacy cdpTargets key as kind=cdp links (A22: zero loss)", () => {
    const config = resolveConfig({
      cdpTargets: [{ id: "old", label: "Legacy", endpoint: "http://legacy:9222", enabled: true, note: "" }],
    } as never);
    expect(config.links).toHaveLength(1);
    expect(config.links[0]).toMatchObject({ id: "old", kind: "cdp", endpoint: "http://legacy:9222" });
    expect(config.links[0]!.probeStatus).toBe("unknown");
  });

  it("prefers links over the legacy key when both are present", () => {
    const config = resolveConfig({
      links: [{ kind: "cdp", id: "new", label: "", endpoint: "http://new:1", enabled: true, note: "" }],
      cdpTargets: [{ id: "old", label: "", endpoint: "http://old:1", enabled: true, note: "" }],
    } as never);
    expect(config.links.map((l) => l.id)).toEqual(["new"]);
  });

  it("keeps at most ONE local ego CLI link, dropping the extras (A17)", () => {
    const config = resolveConfig({
      links: [
        { kind: "ego-cli", id: "cli-1", label: "", cliPath: "/usr/local/bin/ego-browser", enabled: true, note: "" },
        { kind: "ego-cli", id: "cli-2", label: "", cliPath: "/other/ego-browser", enabled: true, note: "" },
        { kind: "cdp", id: "cdp-1", label: "", endpoint: "http://a:1", enabled: true, note: "" },
      ],
    } as never);
    expect(config.links.map((l) => l.id)).toEqual(["cli-1", "cdp-1"]);
    expect(config.links[0]).toMatchObject({ kind: "ego-cli", cliPath: "/usr/local/bin/ego-browser" });
  });

  it("keeps sequence order intact across both kinds (priority is untouched)", () => {
    const config = resolveConfig({
      links: [
        { kind: "ego-cli", id: "z", label: "", cliPath: "", enabled: true, note: "" },
        { kind: "cdp", id: "y", label: "", endpoint: "http://y:1", enabled: true, note: "" },
        { kind: "cdp", id: "x", label: "", endpoint: "http://x:1", enabled: true, note: "" },
      ],
    } as never);
    expect(config.links.map((l) => l.id)).toEqual(["z", "y", "x"]);
  });

  it("still fills probe state on an ego-cli link so the panel has no undefined badges", () => {
    const config = resolveConfig({
      links: [{ kind: "ego-cli", id: "c", label: "", cliPath: "" }],
    } as never);
    expect(config.links[0]).toMatchObject({ probeStatus: "unknown", probeLatencyMs: 0, probeError: "", probeCode: "", probeAt: 0 });
  });
});

describe("阶段 10 judge config", () => {
  it("defaults the laya URL to port 8000, never JevLoop's 7789", () => {
    expect(resolveConfig({}).layaUrl).toBe("http://127.0.0.1:8000");
  });

  it("leaves the jev hop absent by default so nothing calls it", () => {
    const config = resolveConfig({});
    expect(config.jevUrl).toBe("");
    expect(config.jevKey).toBe("");
  });

  it("defaults the image budget to UNBOUNDED, not to a round number", () => {
    // Measured: a full-page JPEG was 136.9 KiB. A byte budget nobody asked for
    // would slice static pages for nothing, so 0 (unbounded) is the default and
    // the CANDIDATE count is what drives chunking.
    expect(resolveConfig({}).jevMaxImageBytes).toBe(0);
  });

  it("keeps an unusable legacy value from hiding a default", () => {
    const config = resolveConfig({ jevChunkSize: "twenty" as never, jevStepBudget: -3 as never, jevWallMs: 0 as never });
    expect(config.jevChunkSize).toBe(20);
    expect(config.jevStepBudget).toBe(20);
    expect(config.jevWallMs).toBe(120000);
  });

  it("trims a pasted URL, because a leading space is a URL that fails to parse", () => {
    expect(resolveConfig({ layaUrl: "  http://127.0.0.1:8000  " } as never).layaUrl).toBe("http://127.0.0.1:8000");
  });

  it("substitutes a model name when the value is blank", () => {
    expect(resolveConfig({ jevModel: "   " } as never).jevModel).toBe("jev");
    expect(resolveConfig({ layaModel: "" } as never).layaModel).toBe("laya");
  });

  it("stores the preference string RAW, filtering at the call site", () => {
    // Same convention as runtimeArgs: a later change to the legal hop list must
    // not retroactively mangle what the user typed.
    expect(resolveConfig({ judgePrefer: "laya, bogus, jev" } as never).judgePrefer).toBe("laya, bogus, jev");
  });

  it("coerces jevArchiveImage to a real boolean", () => {
    expect(resolveConfig({}).jevArchiveImage).toBe(false);
    expect(resolveConfig({ jevArchiveImage: true } as never).jevArchiveImage).toBe(true);
  });

  it("projects the judge subset through judgeSettingsOf", () => {
    const settings = judgeSettingsOf(resolveConfig({ jevUrl: "https://j", layaKey: "k" } as never));
    expect(settings.jevUrl).toBe("https://j");
    expect(settings.layaKey).toBe("k");
    // `prefer` is renamed on the way out, and that mapping is exactly the kind
    // of thing that silently breaks when duplicated in three layers.
    expect(settings.prefer).toBe("jev,laya,rule");
    expect(Object.keys(settings).sort()).toEqual([
      "archiveImage", "chunkSize", "historyLimit", "jevKey", "jevModel", "jevUrl",
      "layaKey", "layaModel", "layaUrl", "maxImageBytes", "prefer", "stepBudget", "wallMs",
    ]);
  });
});
