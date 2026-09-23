import { describe, it, expect } from "vitest";
import {
  normalizeEndpoint,
  sanitizeTargets,
  findTarget,
  activeTarget,
  upsertTarget,
  removeTarget,
  moveTarget,
  probeEndpoint,
  decideAttach,
  refreshAttach,
  createAttachCache,
} from "../src/cdp-targets.ts";

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
    expect(out[1]!.endpoint).toBe("ws://127.0.0.1:9222/x");
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

describe("target helpers", () => {
  const targets = [
    { id: "a", label: "Alpha", endpoint: "http://a:1", enabled: true, note: "" },
    { id: "b", label: "Beta", endpoint: "http://b:2", enabled: false, note: "" },
  ];

  it("findTarget returns null for empty id", () => {
    expect(findTarget(targets, "")).toBeNull();
    expect(findTarget(targets, "a")!.label).toBe("Alpha");
  });

  it("activeTarget ignores disabled entries even when pointed at", () => {
    expect(activeTarget(targets, "b")).toBeNull();
    expect(activeTarget(targets, "a")!.id).toBe("a");
  });

  it("upsertTarget appends a new entry and replaces an existing one", () => {
    const added = upsertTarget(targets, { endpoint: "http://c:3", enabled: true });
    expect(added).toHaveLength(3);
    const replaced = upsertTarget(targets, { id: "a", endpoint: "http://a:999", enabled: true });
    expect(replaced.find((t) => t.id === "a")!.endpoint).toBe("http://a:999");
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
    const targets = [{ id: "a", label: "A", endpoint: "http://a:1", enabled: true, note: "" }];
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
      targets: [{ id: "a", label: "A", endpoint: "http://a:1", enabled: true, note: "" }],
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
      targets: [{ id: "a", label: "A", endpoint: "http://a:1", enabled: true, note: "" }],
      activeTargetId: "a",
      mode: "local",
      cache,
      now: () => 0,
    });
    expect(out.status).toBe("local");
    expect(out.wsUrl).toBe("");
  });
});
