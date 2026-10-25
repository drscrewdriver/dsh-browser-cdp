/**
 * Regression (stale ego-cli routing): decideCdpAttach must derive the channel
 * from the CURRENT config (activation first, sequence-order fallback) and
 * scope the attach cache to that link. Previously it trusted the cache's
 * linkKind, so after an ego-cli link was disabled/deactivated every bcdp_*
 * call still spawned the ego CLI and the activated CDP endpoint never
 * received an attach.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { decideCdpAttach, effectiveChannel } from "../src/index.ts";
import { defaultAttachCache, emptyAttachState } from "../src/cdp-targets.ts";
import type { BrowserLink, ResolvedConfig } from "../src/types.ts";

const links = (egoEnabled: boolean): BrowserLink[] => [
  { kind: "ego-cli", id: "cli", label: "Local CLI", cliPath: "C:\\ego\\ego-browser.exe", enabled: egoEnabled, note: "" },
  { kind: "cdp", id: "a", label: "a", endpoint: "http://127.0.0.1:9222", enabled: true, note: "" },
];

const cfgOf = (ls: BrowserLink[], activeTargetId: string): Partial<ResolvedConfig> => ({
  links: ls,
  activeTargetId,
  cdpMode: "auto",
  remoteEnabled: true,
});

/** A cache row describing a READY ego-cli owner (what the old code trusted). */
const egoReadyRow = {
  ...emptyAttachState(),
  status: "ready" as const,
  targetId: "cli",
  linkKind: "ego-cli" as const,
  cliPath: "C:\\ego\\ego-browser.exe",
  cliShape: "direct" as const,
  message: "local ego CLI ready",
};

describe("decideCdpAttach re-confirms the channel after links events", () => {
  beforeEach(() => {
    defaultAttachCache.reset();
  });

  it("a stale ego-cli cache row must not route to the CLI once ego is disabled", () => {
    // Simulates the in-flight window: the cache still describes the ego-cli
    // owner while the settings already disabled it and activated the CDP link.
    defaultAttachCache.patch(egoReadyRow);
    const decision = decideCdpAttach(cfgOf(links(false), "a"));
    expect(decision.kind).not.toBe("cli");
    // Until the re-probe lands, the call waits — it never silently uses ego.
    expect(decision).toMatchObject({ kind: "error", code: "endpoint-unresolved" });
  });

  it("once the cache describes the CDP owner, the decision injects its ws", () => {
    defaultAttachCache.patch({
      ...emptyAttachState(),
      status: "ready",
      targetId: "a",
      endpoint: "http://127.0.0.1:9222",
      wsUrl: "ws://127.0.0.1:9222/devtools/browser/zzz",
    });
    const decision = decideCdpAttach(cfgOf(links(false), "a"));
    expect(decision).toMatchObject({ kind: "inject", wsUrl: "ws://127.0.0.1:9222/devtools/browser/zzz" });
  });

  it("an enabled ego-cli activation still routes to the CLI (unchanged)", () => {
    defaultAttachCache.patch(egoReadyRow);
    const decision = decideCdpAttach(cfgOf(links(true), "cli"));
    expect(decision.kind).toBe("cli");
  });

  it("dangling activation falls back to the first enabled link in order", () => {
    // ego disabled, activation still points at it → the cdp link takes over.
    defaultAttachCache.patch({
      ...emptyAttachState(),
      status: "ready",
      targetId: "a",
      endpoint: "http://127.0.0.1:9222",
      wsUrl: "ws://127.0.0.1:9222/devtools/browser/zzz",
    });
    const { effective } = effectiveChannel(cfgOf(links(false), "cli"));
    expect(effective?.link.id).toBe("a");
    expect(effective?.reason).toBe("priority-fallback");
    expect(decideCdpAttach(cfgOf(links(false), "cli")).kind).toBe("inject");
  });

  it("empty activation with a stale cache is still no-active, never ego", () => {
    defaultAttachCache.patch(egoReadyRow);
    const decision = decideCdpAttach(cfgOf(links(true), ""));
    expect(decision).toMatchObject({ kind: "error", code: "no-active-target" });
  });
});
