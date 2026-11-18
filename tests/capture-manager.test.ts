import { describe, it, expect } from "vitest";
import { CaptureManager } from "../src/worker/capture-manager.ts";

describe("CaptureManager", () => {
  it("keeps both targets watched across a second lease (#15)", async () => {
    const events: string[] = [];
    let gen = 0;
    const live = new Set<string>();
    const factory = () => {
      gen += 1;
      const myGen = gen;
      return {
        start: async ({ targetId }: { targetId: string }) => { events.push(`start-${targetId}`); live.add(targetId); },
        stop: async (reason: string) => { events.push(`stop-${reason}`); live.clear(); },
        stopTarget: async (targetId: string) => { events.push(`stopTarget-${targetId}`); live.delete(targetId); },
        targetIds: () => [...live],
        generation: myGen,
        updateConfig: async () => {},
      };
    };
    const manager = new CaptureManager({ backendFactories: { cdp: factory }, getConfig: () => ({ captureBackend: "cdp" }), onStatus: () => {}, leaseTtlMs: 60000 });
    await manager.startWatch({ clientId: "one", targetId: "a" });
    await manager.startWatch({ clientId: "two", targetId: "b" });
    // Both stay watched — no backend stop between the two leases.
    expect(events.filter((event) => event.startsWith("stop"))).toEqual([]);
    expect(manager.status().targetIds).toEqual(["a", "b"]);
    // Remove one lease: only that target's screencast stops.
    await manager.stopWatch({ clientId: "one" });
    expect(events).toContain("stopTarget-a");
    expect(manager.status().targetIds).toEqual(["b"]);
    await manager.dispose();
  });

  it("does not restart an unchanged target when another lease joins it (#15 D7)", async () => {
    const starts: string[] = [];
    const stops: string[] = [];
    const live = new Set<string>();
    const factory = () => ({
      start: async ({ targetId }: { targetId: string }) => { starts.push(targetId); live.add(targetId); },
      stop: async (reason: string) => { stops.push(reason); live.clear(); },
      stopTarget: async (targetId: string) => { stops.push(`target:${targetId}`); live.delete(targetId); },
      targetIds: () => [...live],
      updateConfig: async () => {},
    });
    const manager = new CaptureManager({ backendFactories: { cdp: factory }, getConfig: () => ({ captureBackend: "cdp" }), onStatus: () => {}, leaseTtlMs: 60000 });
    await manager.startWatch({ clientId: "one", targetId: "a" });
    await manager.startWatch({ clientId: "two", targetId: "a" });
    // Same target twice: exactly one start, zero stops.
    expect(starts).toEqual(["a"]);
    expect(stops).toEqual([]);
    // One of the two leases leaves: the target must KEEP streaming (other lease alive).
    await manager.stopWatch({ clientId: "two" });
    expect(starts).toEqual(["a"]);
    expect(stops).toEqual([]);
    await manager.dispose();
  });

  it("diffs the whole set: a batch with both additions and removals leaks nothing (#15 D7)", async () => {
    const starts: string[] = [];
    const stops: string[] = [];
    const live = new Set<string>();
    const factory = () => ({
      start: async ({ targetId }: { targetId: string }) => { starts.push(targetId); live.add(targetId); },
      stop: async (reason: string) => { stops.push(`all:${reason}`); live.clear(); },
      stopTarget: async (targetId: string) => { stops.push(`target:${targetId}`); live.delete(targetId); },
      targetIds: () => [...live],
      updateConfig: async () => {},
    });
    const manager = new CaptureManager({ backendFactories: { cdp: factory }, getConfig: () => ({ captureBackend: "cdp" }), onStatus: () => {}, leaseTtlMs: 60000 });
    await manager.startWatch({ clientId: "one", targetId: "a" });
    await manager.startWatch({ clientId: "two", targetId: "b" });
    // one switches a→c while two stays on b: add c, remove a, keep b.
    await manager.switchWatch({ clientId: "one", targetId: "c" });
    expect(starts).toEqual(["a", "b", "c"]);
    expect(stops).toEqual(["target:a"]);
    expect((manager.status().targetIds as string[]).sort()).toEqual(["b", "c"]);
    await manager.dispose();
  });

  it("marks the ffmpeg single-stream boundary when multiple targets are watched (C1)", async () => {
    const live = new Set<string>();
    const factory = () => ({
      start: async ({ targetId }: { targetId: string }) => { live.add(targetId); },
      stop: async () => { live.clear(); },
      stopTarget: async (targetId: string) => { live.delete(targetId); },
      targetIds: () => [...live],
      updateConfig: async () => {},
    });
    const manager = new CaptureManager({ backendFactories: { ffmpeg: factory }, getConfig: () => ({ captureBackend: "ffmpeg" }), onStatus: () => {}, leaseTtlMs: 60000 });
    await manager.startWatch({ clientId: "one", targetId: "a" });
    await manager.startWatch({ clientId: "two", targetId: "b" });
    const status = manager.status();
    expect(status.singleStream).toBe(true);
    expect(status.targetIds).toEqual(["b"]); // newest watched target only
    await manager.dispose();
  });

  it("stops the whole backend only after the LAST lease is gone (idle grace intact)", async () => {
    const stops: string[] = [];
    const factory = () => ({
      start: async () => {},
      stop: async (reason: string) => { stops.push(reason); },
      stopTarget: async () => {},
      targetIds: () => ["a"],
      updateConfig: async () => {},
    });
    const manager = new CaptureManager({ backendFactories: { cdp: factory }, getConfig: () => ({ captureBackend: "cdp" }), onStatus: () => {}, leaseTtlMs: 60000, idleGraceMs: 10 });
    await manager.startWatch({ clientId: "one", targetId: "a" });
    await manager.startWatch({ clientId: "two", targetId: "b" });
    await manager.stopWatch({ clientId: "one" });
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    // one lease still alive → no global stop despite the grace window elapsing.
    expect(stops).toEqual([]);
    await manager.stopWatch({ clientId: "two" });
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(stops).toEqual(["no-watchers"]);
    await manager.dispose();
  });

  it("keeps leases alive across background timer throttling", async () => {
    const now = 1000;
    const manager = new CaptureManager({ backendFactories: {}, getConfig: () => ({ captureBackend: "cdp" }), onStatus: () => {}, now: () => now, leaseTtlMs: 120000 });
    await manager.startWatch({ clientId: "one", targetId: "a" });
    expect(manager.leases.get("one")!.expiresAt).toBe(now + 120000);
    await manager.dispose();
  });

  it("runs one backend and keeps it alive across a target switch (#15)", async () => {
    const events: [string, string][] = [];
    const live = new Set<string>();
    const factory = () => ({
      start: async ({ targetId }: { targetId: string }) => { events.push(["start", targetId]); live.add(targetId); },
      stop: async (reason: string) => { events.push(["stop", reason]); live.clear(); },
      stopTarget: async (targetId: string) => { events.push(["stopTarget", targetId]); live.delete(targetId); },
      targetIds: () => [...live],
      updateConfig: async () => {},
    });
    const manager = new CaptureManager({ backendFactories: { cdp: factory }, getConfig: () => ({ captureBackend: "cdp" }), onStatus: () => {}, leaseTtlMs: 60000 });
    await manager.startWatch({ clientId: "one", targetId: "a" });
    await manager.switchWatch({ clientId: "one", targetId: "b" });
    // One lease switching a→b: add b, remove a, backend NEVER torn down.
    expect(events).toEqual([["start", "a"], ["start", "b"], ["stopTarget", "a"]]);
    expect(manager.status().targetId).toBe("b");
    expect(manager.status().targetIds).toEqual(["b"]);
    await manager.dispose();
  });

  it("falls back to CDP with a visible reason when FFmpeg is unavailable", async () => {
    const manager = new CaptureManager({ backendFactories: { cdp: () => ({ start: async () => {}, stop: async () => {}, updateConfig: async () => {} }) }, getConfig: () => ({ captureBackend: "ffmpeg" }), onStatus: () => {}, leaseTtlMs: 60000 });
    await manager.startWatch({ clientId: "one", backend: "ffmpeg", targetId: "a" });
    expect(manager.status().backend).toBe("cdp");
    expect(manager.status().code).toBe("ffmpeg-fallback-cdp");
    expect(manager.status().message).toMatch(/FFmpeg unavailable/);
    await manager.dispose();
  });

  it("does not claim a successful fallback when CDP also fails", async () => {
    const failing = (message: string) => () => ({ start: async () => { throw new Error(message); }, stop: async () => {}, dispose: async () => {} });
    const manager = new CaptureManager({ backendFactories: { ffmpeg: failing("ffmpeg failed"), cdp: failing("cdp failed") }, getConfig: () => ({ captureBackend: "ffmpeg" }), onStatus: () => {}, leaseTtlMs: 60000 });
    await manager.startWatch({ clientId: "one", backend: "ffmpeg", targetId: "a" });
    expect(manager.status().state).toBe("failed");
    expect(manager.status().message).toBe("cdp failed");
    expect(manager.status().code).not.toBe("ffmpeg-fallback-cdp");
    await manager.dispose();
  });

  it("publishes the configured backend while capture is idle", async () => {
    let configured = "cdp";
    const manager = new CaptureManager({ backendFactories: {}, getConfig: () => ({ captureBackend: configured }), onStatus: () => {}, leaseTtlMs: 60000 });
    configured = "ffmpeg";
    await manager.updateConfig();
    expect(manager.status().backend).toBe("ffmpeg");
    expect(manager.status().state).toBe("idle");
    await manager.dispose();
  });

  it("retries a failed backend for an existing lease", async () => {
    let attempts = 0;
    const factory = () => ({
      start: async () => { attempts += 1; if (attempts === 1) throw new Error("transient"); },
      stop: async () => {}, dispose: async () => {}, updateConfig: async () => {},
    });
    const manager = new CaptureManager({ backendFactories: { ffmpeg: factory }, getConfig: () => ({ captureBackend: "ffmpeg" }), onStatus: () => {}, leaseTtlMs: 60000 });
    await manager.startWatch({ clientId: "one", targetId: "a" });
    expect(manager.status().state).toBe("failed");
    await manager.startWatch({ clientId: "one", targetId: "a" });
    expect(attempts).toBe(2);
    expect(manager.backend).toBeTruthy();
    await manager.dispose();
  });

  it("renews an existing lease without stealing the shared target", async () => {
    const starts: string[] = [];
    const live = new Set<string>();
    const factory = () => ({
      start: async ({ targetId }: { targetId: string }) => { starts.push(targetId); live.add(targetId); },
      stop: async () => { live.clear(); },
      stopTarget: async (targetId: string) => { live.delete(targetId); },
      targetIds: () => [...live],
      updateConfig: async () => {},
    });
    const manager = new CaptureManager({ backendFactories: { cdp: factory }, getConfig: () => ({ captureBackend: "cdp" }), onStatus: () => {}, leaseTtlMs: 60000 });
    await manager.startWatch({ clientId: "one", targetId: "a" });
    await manager.startWatch({ clientId: "two", targetId: "b" });
    await manager.startWatch({ clientId: "one", targetId: "a" });
    // Renewal of an already-watched target adds nothing new (D7 derived set).
    expect(starts).toEqual(["a", "b"]);
    await manager.dispose();
  });

  it("serializes overlapping activations (#15: no backend stop between two leases)", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let gen = 0;
    const live = new Set<string>();
    const factory = () => {
      gen += 1;
      const myGen = gen;
      return {
        start: async ({ targetId }: { targetId: string }) => { events.push(`start-${targetId}`); live.add(targetId); if (myGen === 1) await firstGate; events.push(`finish-${targetId}`); },
        stop: async (reason: string) => { events.push(`stop-${reason}`); live.clear(); },
        stopTarget: async (targetId: string) => { events.push(`stopTarget-${targetId}`); live.delete(targetId); },
        targetIds: () => [...live],
        updateConfig: async () => {},
      };
    };
    const manager = new CaptureManager({ backendFactories: { cdp: factory }, getConfig: () => ({ captureBackend: "cdp" }), onStatus: () => {}, leaseTtlMs: 60000 });
    const first = manager.startWatch({ clientId: "one", targetId: "a" });
    const second = manager.startWatch({ clientId: "two", targetId: "b" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["start-a"]);
    releaseFirst();
    await Promise.all([first, second]);
    // Serialized after start-a completes; then diff adds b — NO stop of a.
    expect(events).toEqual(["start-a", "finish-a", "start-b", "finish-b"]);
    expect((manager.status().targetIds as string[]).sort()).toEqual(["a", "b"]);
    await manager.dispose();
  });

  it("ignores late status from an obsolete backend and cleans failed starts", async () => {
    const statusCallbacks: ((status: any) => void)[] = [];
    let disposed = 0;
    let attempt = 0;
    const factory = ({ onStatus }: { onStatus: (status: any) => void }) => {
      statusCallbacks.push(onStatus);
      attempt += 1;
      return {
        start: async () => { if (attempt === 1) { const error = new Error("boom") as Error & { code: string }; error.code = "probe-failed"; throw error; } },
        stop: async () => {}, dispose: async () => { disposed += 1; }, updateConfig: async () => {},
      };
    };
    const manager = new CaptureManager({ backendFactories: { cdp: factory }, getConfig: () => ({ captureBackend: "cdp" }), onStatus: () => {}, leaseTtlMs: 60000 });
    await manager.startWatch({ clientId: "one", targetId: "a" });
    expect(disposed).toBe(1);
    expect(manager.status().code).toBe("probe-failed");
    await manager.switchWatch({ clientId: "one", targetId: "b" });
    expect(manager.status().code).toBe(null);
    statusCallbacks[0]({ backend: "cdp", state: "failed", message: "late" });
    expect(manager.status().targetId).toBe("b");
    expect(manager.status().message).not.toBe("late");
    await manager.dispose();
  });

  it("refuses to start a capture loop on an engine without pixels (Lightpanda)", async () => {
    const events: string[] = [];
    const factory = () => ({ start: async () => { events.push("start"); }, stop: async () => { events.push("stop"); }, updateConfig: async () => {} });
    const manager = new CaptureManager({ backendFactories: { cdp: factory, ffmpeg: factory }, getConfig: () => ({ captureBackend: "cdp" }), onStatus: () => {}, screencastSupported: false, leaseTtlMs: 60000 });
    const status = await manager.startWatch({ clientId: "one", targetId: "a" });
    expect(events).toEqual([]); // no loop, not even one start attempt
    expect(status.state).toBe("unsupported");
    expect(status.code).toBe("engine-unsupported");
    expect(status.engineUnsupported).toBe(true);
    expect(manager.status().engineUnsupported).toBe(true); // visible on /api/health too
    await manager.dispose();
  });
});
