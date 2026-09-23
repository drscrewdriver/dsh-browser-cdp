import { describe, it, expect } from "vitest";
import {
  normalizeEndpoint,
  sanitizeTargets,
  sanitizeLinks,
  EGO_CLI_KIND,
  findLink,
  findTarget,
  activeLink,
  activeTarget,
  upsertLink,
  removeTarget,
  moveTarget,
  probeEndpoint,
  decideAttach,
  refreshAttach,
  createAttachCache,
} from "../src/cdp-targets.ts";
import type { BrowserLink, CdpLink, EgoCliLink } from "../src/types.ts";

/** Narrow to a cdp link, or fail loudly — the union must not be papered over. */
function asCdp(link: BrowserLink | undefined): CdpLink {
  if (!link || link.kind !== "cdp") throw new Error(`expected a cdp link, got ${JSON.stringify(link)}`);
  return link;
}
/** Narrow to an ego-cli link, or fail loudly. */
function asCli(link: BrowserLink | undefined): EgoCliLink {
  if (!link || link.kind !== EGO_CLI_KIND) throw new Error(`expected an ego-cli link, got ${JSON.stringify(link)}`);
  return link;
}

const cdp = (id: string, endpoint: string, enabled = true): CdpLink => ({
  kind: "cdp", id, label: id, endpoint, enabled, note: "",
});

describe("normalizeEndpoint", () => {
  it("accepts an http endpoint and strips the trailing slash", () => {
    const r = normalizeEndpoint("http://127.0.0.1:9222/");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.endpoint).toBe("http://127.0.0.1:9222");
      expect(r.scheme).toBe("http");
    }
  });

  it("accepts a direct ws endpoint", () => {
    const r = normalizeEndpoint("ws://127.0.0.1:9222/devtools/browser/abc");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scheme).toBe("ws");
  });

  it("rejects a bare host:port with an explicit code", () => {
    const r = normalizeEndpoint("127.0.0.1:9222");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid-endpoint");
  });

  it("rejects a non-http(s)/ws(s) scheme", () => {
    const r = normalizeEndpoint("ftp://127.0.0.1:9222");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid-scheme");
  });

  it("rejects an empty endpoint", () => {
    const r = normalizeEndpoint("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("empty-endpoint");
  });
});

describe("sanitizeTargets", () => {
  it("drops entries with unusable endpoints and keeps valid ones", () => {
    const out = sanitizeTargets([
      { id: "a", label: "", endpoint: "http://127.0.0.1:9222", enabled: true },
      { id: "b", label: "", endpoint: "not-a-url", enabled: true },
      { endpoint: "ws://127.0.0.1:9222/x" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe("a");
    // the third entry (no id) got a generated id, so it survived
    expect(asCdp(out[1]).endpoint).toBe("ws://127.0.0.1:9222/x");
  });

  it("freshly assigns a duplicate id so ordering stays unambiguous", () => {
    const out = sanitizeTargets([
      { id: "dup", endpoint: "http://a:1", enabled: true },
      { id: "dup", endpoint: "http://b:2", enabled: true },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe("dup");
    expect(out[1]!.id).not.toBe("dup");
  });

  it("returns an empty array for non-array input", () => {
    expect(sanitizeTargets(undefined)).toEqual([]);
    expect(sanitizeTargets("nope")).toEqual([]);
  });
});

describe("link helpers", () => {
  const targets: BrowserLink[] = [
    { kind: "cdp", id: "a", label: "Alpha", endpoint: "http://a:1", enabled: true, note: "" },
    { kind: "cdp", id: "b", label: "Beta", endpoint: "http://b:2", enabled: false, note: "" },
  ];

  it("findTarget returns null for empty id", () => {
    expect(findTarget(targets, "")).toBeNull();
    expect(findTarget(targets, "a")!.label).toBe("Alpha");
    expect(findLink(targets, "b")!.id).toBe("b");
  });

  it("activeTarget ignores disabled entries even when pointed at", () => {
    expect(activeTarget(targets, "b")).toBeNull();
    expect(activeTarget(targets, "a")!.id).toBe("a");
    expect(activeLink(targets, "a")!.id).toBe("a");
  });

  it("upsertLink appends a new entry and replaces an existing one", () => {
    const added = upsertLink(targets, { kind: "cdp" as const, endpoint: "http://c:3", enabled: true });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.links).toHaveLength(3);
    const replaced = upsertLink(targets, { id: "a", endpoint: "http://a:999", enabled: true });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(asCdp(replaced.links.find((t) => t.id === "a")).endpoint).toBe("http://a:999");
  });

  it("removeTarget drops by id", () => {
    expect(removeTarget(targets, "a")).toHaveLength(1);
  });

  it("moveTarget reorders within bounds", () => {
    const moved = moveTarget(targets, "b", -1);
    expect(moved[0]!.id).toBe("b");
    // out-of-range move is a no-op
    expect(moveTarget(targets, "a", -1)[0]!.id).toBe("a");
  });
});

describe("probeEndpoint (injectable fetch)", () => {
  const fakeFetch = (json: unknown, status = 200) =>
    async (_url: string, _init: { signal: AbortSignal }) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
    });

  it("resolves a ws endpoint directly without a network call", async () => {
    const out = await probeEndpoint("ws://127.0.0.1:9222/x", { fetchVersion: fakeFetch({}) });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.code).toBe("ok");
  });

  it("discovers webSocketDebuggerUrl from /json/version", async () => {
    const out = await probeEndpoint("http://127.0.0.1:9222", {
      fetchVersion: fakeFetch({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/zzz" }),
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.wsUrl).toBe("ws://127.0.0.1:9222/devtools/browser/zzz");
  });

  it("reports http-status on a non-200 response", async () => {
    const out = await probeEndpoint("http://127.0.0.1:9222", { fetchVersion: fakeFetch({}, 404) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("http-status");
  });

  it("reports no-ws-url when the endpoint is not a DevTools endpoint", async () => {
    const out = await probeEndpoint("http://127.0.0.1:9222", { fetchVersion: fakeFetch({}) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("no-ws-url");
  });

  it("reports probe-timeout when the fetch rejects with a timeout", async () => {
    const timeout = new Error("timeout");
    timeout.name = "TimeoutError";
    const out = await probeEndpoint("http://127.0.0.1:9222", {
      timeoutMs: 50,
      fetchVersion: async () => {
        throw timeout;
      },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("probe-timeout");
  });

  it("never touches a wall clock (now is injected)", async () => {
    let nowCalls = 0;
    const out = await probeEndpoint("ws://127.0.0.1:9222/x", {
      now: () => {
        nowCalls++;
        return 1000;
      },
    });
    expect(out.ok).toBe(true);
    expect(nowCalls).toBeGreaterThan(0);
  });
});

describe("decideAttach", () => {
  const base = {
    mode: "auto" as const,
    hasActive: true,
    status: "ready" as const,
    wsUrl: "ws://x/y",
    code: "",
    message: "",
    allowLocalFallback: false,
    localLauncherReady: false,
  };

  it("injects the ws url when resolved and ready", () => {
    const d = decideAttach(base);
    expect(d.kind).toBe("inject");
  });

  it("never silently falls back — errors when no active target", () => {
    const d = decideAttach({ ...base, hasActive: false });
    expect(d.kind).toBe("error");
  });

  it("passes through to local control in local mode", () => {
    const d = decideAttach({ ...base, mode: "local" });
    expect(d.kind).toBe("local");
  });

  it("errors instead of local-launching when the endpoint is unreachable", () => {
    const d = decideAttach({
      ...base,
      status: "unreachable",
      code: "no-ws-url",
      message: "no webSocketDebuggerUrl",
      allowLocalFallback: true, // launcher still not ready → explicit error
    });
    expect(d.kind).toBe("error");
  });
});

describe("refreshAttach + cache", () => {
  it("probes the activated target and publishes ready state", async () => {
    const cache = createAttachCache();
    const targets: BrowserLink[] = [{ kind: "cdp", id: "a", label: "A", endpoint: "http://a:1", enabled: true, note: "" }];
    const out = await refreshAttach({
      targets,
      activeTargetId: "a",
      mode: "auto",
      cache,
      fetchVersion: async () => ({ ok: true, status: 200, json: async () => ({ webSocketDebuggerUrl: "ws://a:1/b" }) }),
      now: () => 0,
    });
    expect(out.status).toBe("ready");
    expect(out.wsUrl).toBe("ws://a:1/b");
    expect(cache.get().status).toBe("ready");
  });

  it("publishes no-active when nothing is activated", async () => {
    const cache = createAttachCache();
    const out = await refreshAttach({
      targets: [{ kind: "cdp" as const, id: "a", label: "A", endpoint: "http://a:1", enabled: true, note: "" }],
      activeTargetId: "",
      mode: "auto",
      cache,
      now: () => 0,
    });
    expect(out.status).toBe("no-active");
  });

  it("local mode short-circuits and clears any prior ws url", async () => {
    const cache = createAttachCache();
    cache.patch({ status: "ready", wsUrl: "ws://stale/b", targetId: "a", endpoint: "http://a:1" });
    const out = await refreshAttach({
      targets: [{ kind: "cdp" as const, id: "a", label: "A", endpoint: "http://a:1", enabled: true, note: "" }],
      activeTargetId: "a",
      mode: "local",
      cache,
      now: () => 0,
    });
    expect(out.status).toBe("local");
    expect(out.wsUrl).toBe("");
  });
});

// ── R7: the local ego CLI link kind ────────────────────────────────────────

const CLI_READY = "__BCDP_CLI_READY__";

/** Minimal injectable CLI IO: one CLI file, scripted run outcomes. */
function cliIo(options: {
  cliFile?: string;
  status?: string;
  heredoc?: { exitCode: number | null; stdout?: string; stderr?: string; spawnErrorCode?: string; timedOut?: boolean };
  spawnCode?: string;
} = {}) {
  const cliFile = options.cliFile ?? "/usr/local/bin/ego-browser";
  const calls: Array<{ argv: readonly string[]; stdin: string }> = [];
  const io = {
    platform: "linux" as NodeJS.Platform,
    exists: (path: string) => path === cliFile,
    which: (name: string) => (name === "ego-browser" ? cliFile : ""),
    now: (() => { let t = 0; return () => (t += 5) })(),
    run: async (request: { argv: readonly string[]; stdin: string; timeoutMs: number }) => {
      calls.push({ argv: request.argv, stdin: request.stdin });
      if (options.spawnCode !== undefined) {
        return { exitCode: null, stdout: "", stderr: "spawn refused", spawnErrorCode: options.spawnCode, latencyMs: 1 };
      }
      if (request.stdin === "") {
        return { exitCode: 0, stdout: options.status ?? JSON.stringify({ running: true }), stderr: "", latencyMs: 2 };
      }
      const h = options.heredoc ?? { exitCode: 0, stdout: `${CLI_READY}\n` };
      return { exitCode: h.exitCode, stdout: h.stdout ?? "", stderr: h.stderr ?? "", latencyMs: 3, ...(h.timedOut ? { timedOut: true } : {}), ...(h.spawnErrorCode ? { spawnErrorCode: h.spawnErrorCode } : {}) };
    },
  };
  return { io, calls };
}

const cliLink = (overrides: Partial<EgoCliLink> = {}): EgoCliLink => ({
  kind: "ego-cli", id: "cli", label: "Local CLI", cliPath: "", enabled: true, note: "", ...overrides,
});

describe("R7 refreshAttach — ego-cli link", () => {
  it("reports ready with endpointSource cli and injects no ws url (A19)", async () => {
    const cache = createAttachCache();
    const { io: ioImpl } = cliIo();
    const out = await refreshAttach({
      targets: [cliLink()], activeTargetId: "cli", mode: "auto", cache, cliIo: ioImpl as never, now: () => 0,
    });
    expect(out.status).toBe("ready");
    expect(out.endpointSource).toBe("cli");
    expect(out.linkKind).toBe(EGO_CLI_KIND);
    expect(out.wsUrl).toBe("");
    expect(out.endpoint).toBe("");
    expect(out.cliPath).toBe("/usr/local/bin/ego-browser");
    expect(out.cliShape).toBe("direct");
  });

  it("tags cli-launch when the CLI answers but its browser is down", async () => {
    const cache = createAttachCache();
    const { io: ioImpl } = cliIo({ status: JSON.stringify({ running: false }) });
    const out = await refreshAttach({
      targets: [cliLink()], activeTargetId: "cli", mode: "auto", cache, cliIo: ioImpl as never, now: () => 0,
    });
    expect(out.status).toBe("ready");
    expect(out.endpointSource).toBe("cli-launch");
    expect(out.message).toContain("first call");
  });

  it("does NOT fall back to a local browser when the CLI is missing (A21)", async () => {
    const cache = createAttachCache();
    // Nothing on disk at all: no explicit file, no PATH entry, no bundled port.
    const { io: ioImpl } = cliIo({ cliFile: "" });
    const out = await refreshAttach({
      targets: [cliLink({ cliPath: "/nope/ego-browser" })], activeTargetId: "cli", mode: "auto", cache,
      cliIo: ioImpl as never,
      // An authorized fallback must still not be taken: the launcher is for a
      // dead CDP endpoint, not for a broken CLI link.
      fallback: { enabled: true, chromePath: "/x/chrome" },
      useLauncher: true,
      now: () => 0,
    });
    expect(out.status).toBe("unreachable");
    expect(out.code).toBe("cli-not-found");
    expect(out.code).not.toContain("fallback");
  });

  it("surfaces a probe failure code verbatim", async () => {
    const cache = createAttachCache();
    const { io: ioImpl } = cliIo({ heredoc: { exitCode: 1, stderr: "boom" } });
    const out = await refreshAttach({
      targets: [cliLink()], activeTargetId: "cli", mode: "auto", cache, cliIo: ioImpl as never, now: () => 0,
    });
    expect(out).toMatchObject({ status: "unreachable", code: "cli-probe-failed" });
  });

  it("is NOT blocked by remoteEnabled=false — that switch is remote-only (A20)", async () => {
    const cache = createAttachCache();
    const { io: ioImpl } = cliIo();
    const out = await refreshAttach({
      targets: [cliLink()], activeTargetId: "cli", mode: "auto", cache,
      cliIo: ioImpl as never, remoteEnabled: false, now: () => 0,
    });
    expect(out.status).toBe("ready");
    expect(out.code).toBe("");
  });

  it("still blocks a cdp link under remoteEnabled=false (A20 control)", async () => {
    const cache = createAttachCache();
    const out = await refreshAttach({
      targets: [cdp("a", "http://a:1")], activeTargetId: "a", mode: "auto", cache,
      remoteEnabled: false, now: () => 0,
    });
    expect(out).toMatchObject({ status: "no-active", code: "remote-disabled" });
  });

  it("says so explicitly when the host forgot to pass CLI IO", async () => {
    const cache = createAttachCache();
    const out = await refreshAttach({
      targets: [cliLink()], activeTargetId: "cli", mode: "auto", cache, now: () => 0,
    });
    expect(out).toMatchObject({ status: "unreachable", code: "cli-io-missing" });
  });

  it("ignores a disabled ego-cli link (no probe is attempted)", async () => {
    const cache = createAttachCache();
    const { io: ioImpl, calls } = cliIo();
    const out = await refreshAttach({
      targets: [cliLink({ enabled: false })], activeTargetId: "cli", mode: "auto", cache, cliIo: ioImpl as never, now: () => 0,
    });
    expect(out).toMatchObject({ status: "no-active", code: "no-active-target" });
    expect(calls).toHaveLength(0);
  });
});

describe("R7 decideAttach", () => {
  const base = {
    mode: "auto" as const, hasActive: true, status: "ready" as const, wsUrl: "",
    code: "", message: "", allowLocalFallback: false, localLauncherReady: true,
  };

  it("hands a ready ego-cli link straight to the CLI", () => {
    const out = decideAttach({ ...base, linkKind: EGO_CLI_KIND, message: "local ego CLI ready" });
    expect(out).toEqual({ kind: "cli", message: "local ego CLI ready" });
  });

  it("refuses cdpMode=remote with an ego-cli link (A18)", () => {
    const out = decideAttach({ ...base, mode: "remote", linkKind: EGO_CLI_KIND });
    expect(out).toMatchObject({ kind: "error", code: "mode-kind-mismatch" });
  });

  it("reports the probe failure instead of pretending to be ready", () => {
    const out = decideAttach({ ...base, status: "unreachable", linkKind: EGO_CLI_KIND, code: "cli-not-found", message: "no CLI" });
    expect(out).toMatchObject({ kind: "error", code: "cli-not-found", message: "no CLI" });
  });

  it("keeps the cli link usable while remoteEnabled is off (A20)", () => {
    const out = decideAttach({ ...base, linkKind: EGO_CLI_KIND, remoteDisabled: true });
    expect(out.kind).toBe("cli");
  });

  it("leaves cdpMode=local in charge regardless of the active kind", () => {
    const out = decideAttach({ ...base, mode: "local", linkKind: EGO_CLI_KIND });
    expect(out.kind).toBe("local");
  });

  it("still demands an activation for cdp links", () => {
    const out = decideAttach({ ...base, linkKind: "cdp", hasActive: false });
    expect(out).toMatchObject({ kind: "error", code: "no-active-target" });
  });
});
