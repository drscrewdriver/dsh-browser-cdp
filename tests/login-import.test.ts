import { afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromiumCandidates,
  detectSystemBrowsers,
  profilesFromLocalState,
  cookieMatchesDomains,
  toCookieParam,
  parseDevToolsActivePort,
  resolveEgoStateDir,
  browserWsUrl,
  importLoginCookies,
} from "../src/login-import.ts";

describe("chromiumCandidates / detectSystemBrowsers", () => {
  it("builds Windows candidate paths from env", () => {
    const c = chromiumCandidates(
      { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local", ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" },
      "win32",
    );
    expect(c.length).toBeGreaterThanOrEqual(5);
    expect(c[0].exePath).toContain("chrome.exe");
    expect(c[0].userDataDir).toBe("C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\User Data");
    expect(c.some((b) => b.id === "edge")).toBe(true);
  });

  it("builds Linux candidate paths", () => {
    const c = chromiumCandidates({ HOME: "/home/u" }, "linux");
    expect(c[0].exePath).toBe("/usr/bin/google-chrome");
    expect(c[0].userDataDir).toBe("/home/u/.config/google-chrome");
  });

  it("detectSystemBrowsers filters out nonexistent installs", () => {
    // No fabricated env paths exist on disk → empty.
    const env = {
      LOCALAPPDATA: "Z:\\definitely\\not\\here",
      ProgramFiles: "Z:\\nope",
      "ProgramFiles(x86)": "Z:\\nope2",
    };
    expect(detectSystemBrowsers(env, "win32")).toEqual([]);
  });
});

describe("profilesFromLocalState", () => {
  it("reads profile.info_cache into dir/name pairs", () => {
    const json = JSON.stringify({
      profile: {
        info_cache: {
          Default: { name: "Person 1" },
          "Profile 1": { name: "Work" },
        },
      },
    });
    const profiles = profilesFromLocalState(json, "C:\\UD");
    expect(profiles).toHaveLength(2);
    expect(profiles[0]).toEqual({ dir: "C:\\UD\\Default", dirName: "Default", name: "Person 1" });
    expect(profiles[1].name).toBe("Work");
  });

  it("falls back to Default on garbage input", () => {
    const p = profilesFromLocalState("not json", "/ud");
    expect(p).toHaveLength(1);
    expect(p[0].dirName).toBe("Default");
    expect(p[0].name).toBe("Default");
  });

  it("falls back to Default when info_cache is empty", () => {
    expect(profilesFromLocalState("{}", "/ud")[0].dirName).toBe("Default");
  });
});

describe("cookieMatchesDomains", () => {
  it("matches exact and subdomain, case-insensitive, leading-dot tolerant", () => {
    expect(cookieMatchesDomains(".bilibili.com", ["bilibili.com"])).toBe(true);
    expect(cookieMatchesDomains("api.bilibili.com", ["Bilibili.com"])).toBe(true);
    expect(cookieMatchesDomains("bilibili.com", [".bilibili.com"])).toBe(true);
  });

  it("rejects unrelated and sibling domains", () => {
    expect(cookieMatchesDomains("notbilibili.com", ["bilibili.com"])).toBe(false);
    expect(cookieMatchesDomains("bilibili.com.evil.cn", ["bilibili.com"])).toBe(false);
    expect(cookieMatchesDomains("zhihu.com", ["bilibili.com"])).toBe(false);
  });

  it("empty domain list matches everything", () => {
    expect(cookieMatchesDomains("anything.example", [])).toBe(true);
  });
});

describe("toCookieParam", () => {
  it("keeps a full persistent cookie", () => {
    const p = toCookieParam({
      name: "SESSDATA", value: "abc", domain: ".bilibili.com", path: "/",
      expires: 1893456000, secure: true, httpOnly: true, sameSite: "Lax",
    });
    expect(p).toEqual({
      name: "SESSDATA", value: "abc", domain: ".bilibili.com", path: "/",
      secure: true, httpOnly: true, sameSite: "Lax", expires: 1893456000,
    });
  });

  it("drops expires on session cookies", () => {
    const p = toCookieParam({ name: "s", value: "v", domain: "x.com", path: "/", session: true, expires: 0 });
    expect(p).not.toHaveProperty("expires");
  });

  it("defaults path and omits invalid sameSite", () => {
    const p = toCookieParam({ name: "a", value: "b", domain: "x.com", path: "" });
    expect(p!.path).toBe("/");
    expect(p).not.toHaveProperty("sameSite");
  });

  it("rejects cookies without name or domain", () => {
    expect(toCookieParam({ name: "", value: "v", domain: "x.com", path: "/" })).toBeNull();
    expect(toCookieParam({ name: "n", value: "v", domain: "", path: "/" })).toBeNull();
    expect(toCookieParam(null as never)).toBeNull();
  });
});

describe("parseDevToolsActivePort", () => {
  it("parses the first line", () => {
    expect(parseDevToolsActivePort("51803\n/devtools/browser/abc-123")).toBe(51803);
  });
  it("rejects garbage", () => {
    expect(parseDevToolsActivePort("")).toBeNull();
    expect(parseDevToolsActivePort("abc\n")).toBeNull();
    expect(parseDevToolsActivePort("99999\n")).toBeNull();
    expect(parseDevToolsActivePort("-1\n")).toBeNull();
  });
});

describe("resolveEgoStateDir", () => {
  it("prefers EGO_LINUX_STATE_DIR", () => {
    expect(resolveEgoStateDir({ EGO_LINUX_STATE_DIR: "/custom" }, "linux")).toBe("/custom");
  });
  it("uses LOCALAPPDATA on win32", () => {
    expect(resolveEgoStateDir({ LOCALAPPDATA: "C:\\L" }, "win32")).toBe("C:\\L\\ego-lite-linux");
  });
  it("uses XDG_STATE_HOME / ~/.local/state on POSIX", () => {
    expect(resolveEgoStateDir({ HOME: "/h" }, "linux")).toBe("/h/.local/state/ego-lite-linux");
    expect(resolveEgoStateDir({ XDG_STATE_HOME: "/x", HOME: "/h" }, "linux")).toBe("/x/ego-lite-linux");
  });
});

// issue #1-②: undici collapses every connect failure into "fetch failed" —
// browserWsUrl must type the error and retry connect-level flakes.
describe("browserWsUrl error typing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("translates a persistent connect refusal into an unreachable message", async () => {
    const spy = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", spy);
    await expect(browserWsUrl(59999, 1)).rejects.toThrow(/unreachable on port 59999 after 2 attempts/);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("reports timeout distinctly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      const e = new Error("timed out");
      e.name = "TimeoutError";
      throw e;
    }));
    await expect(browserWsUrl(59998, 0)).rejects.toThrow(/timed out after 1 attempts/);
  });

  it("keeps HTTP status errors verbatim without retrying", async () => {
    const spy = vi.fn(async () => ({ ok: false, status: 500 }));
    vi.stubGlobal("fetch", spy);
    await expect(browserWsUrl(59997, 2)).rejects.toThrow("/json/version HTTP 500 on port 59997");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("recovers from a transient refusal via the retry loop", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      n += 1;
      if (n === 1) throw new TypeError("fetch failed");
      return { ok: true, json: async () => ({ webSocketDebuggerUrl: "ws://ok" }) };
    }));
    expect(await browserWsUrl(59996, 2)).toBe("ws://ok");
    expect(n).toBe(2);
  });
});

describe("importLoginCookies early-exit forensics (issue #1-②)", () => {
  it("reports exit code + stderr tail and skips the drain retry", async () => {
    const ud = mkdtempSync(join(tmpdir(), "bcdp-li-ud-"));
    const sd = mkdtempSync(join(tmpdir(), "bcdp-li-sd-"));
    try {
      writeFileSync(join(ud, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "P" } } } }));
      let spawnCount = 0;
      const deps = {
        subprocess: {
          spawn: (_spec: never) => {
            spawnCount += 1;
            return {
              done: Promise.resolve({ exitCode: 21, signal: null }),
              collected: {
                stderr: {
                  readFrom: (_o: number) => ({ text: "fake browser: existing instance swallowed the launch" }),
                },
              },
            };
          },
        },
      };
      const res = await importLoginCookies(
        {
          browserOverride: { id: "chrome", label: "Fake Browser", exePath: join(ud, "fake.exe"), userDataDir: ud },
          domains: ["x.example"],
          stateDir: sd,
          timeoutMs: 400,
        } as never,
        deps as never,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Fake Browser headless instance exited early \(code=21, signal=none\)/);
      expect(res.error).toContain("existing instance swallowed the launch");
      expect(spawnCount).toBe(1); // deterministic early exit → no second attempt
    } finally {
      rmSync(ud, { recursive: true, force: true });
      rmSync(sd, { recursive: true, force: true });
    }
  }, 20_000);
});
