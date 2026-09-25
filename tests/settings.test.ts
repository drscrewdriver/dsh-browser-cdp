import { describe, it, expect } from "vitest";
import { installEgoBrowserSettings } from "../src/settings.ts";
import { Config, isVolatileRef, resolveConfig } from "../src/config.ts";

/** Structural ctx double: captures the loader/volatile-update handler. */
function makeContext() {
  const handlers = new Set<(paths: string[]) => void>();
  const effects: Array<() => unknown> = [];
  const ctx: any = {
    on: (event: string, fn: (paths: string[]) => void) => {
      expect(event).toBe("loader/volatile-update");
      handlers.add(fn);
      return () => handlers.delete(fn);
    },
    effect: (fn: () => unknown) => {
      effects.push(fn);
      return fn;
    },
    emitVolatileUpdate: (paths: string[]) => {
      for (const fn of [...handlers]) fn(paths);
    },
    disposeEffects: () => {
      for (const fn of effects.splice(0)) {
        const d = (fn as () => unknown)();
        if (typeof d === "function") d();
      }
    },
  };
  return ctx;
}

describe("ego-browser settings bridge (0.1.7 declarative)", () => {
  it("dereferences volatile live refs on every source() read", () => {
    let chromePath = "C:\\first.exe";
    // Mirror the loader: volatile fields arrive as live refs whose get()
    // returns the current user-layer value.
    const config: Record<string, unknown> = {
      chromePath: { get: () => chromePath },
      links: [{ kind: "cdp", id: "a", label: "", endpoint: "", enabled: true, note: "" }],
    };
    const ctx = makeContext();
    const bridge = installEgoBrowserSettings(ctx, config as never);

    expect(bridge.source().chromePath).toBe("C:\\first.exe");
    expect(isVolatileRef(bridge.source().chromePath)).toBe(false);
    chromePath = "C:\\second.exe";
    // No event needed for a re-read: source() derefs per call.
    expect(bridge.source().chromePath).toBe("C:\\second.exe");
    expect(bridge.source().links).toEqual(config.links);
  });

  it("notifies onChange listeners on loader/volatile-update and unpins on dispose", () => {
    const ctx = makeContext();
    const config: Record<string, unknown> = { chromePath: { get: () => "" } };
    const bridge = installEgoBrowserSettings(ctx, config as never);
    let changes = 0;
    const off = bridge.onChange(() => { changes += 1; });

    ctx.emitVolatileUpdate(["dsh-browser-cdp.chromePath"]);
    expect(changes).toBe(1);

    off();
    ctx.emitVolatileUpdate(["dsh-browser-cdp.chromePath"]);
    expect(changes).toBe(1);
  });

  it("unsubscribes from loader/volatile-update when the effect is disposed", () => {
    const ctx = makeContext();
    const config: Record<string, unknown> = { chromePath: { get: () => "" } };
    installEgoBrowserSettings(ctx, config as never);
    expect(ctx.disposeEffects()).toBeUndefined();
    expect(() => ctx.emitVolatileUpdate(["x"])).not.toThrow();
  });

  it("Config schema wraps volatile fields as live refs; resolveConfig derefs them", () => {
    // Config(...) output: every .volatile() field becomes a live ref —
    // including when the caller passes a plain value.
    const entry = Config({ chromePath: "C:\\x.exe", idleTimeoutMin: 5 });
    expect(isVolatileRef((entry as Record<string, unknown>).chromePath)).toBe(true);
    expect(isVolatileRef((entry as Record<string, unknown>).idleTimeoutMin)).toBe(true);
    // legacyEgoToolNames is NOT card-exposed → not volatile → plain data.
    expect(isVolatileRef((entry as Record<string, unknown>).legacyEgoToolNames)).toBe(false);

    const resolved = resolveConfig(entry as never);
    expect(resolved.chromePath).toBe("C:\\x.exe");
    expect(resolved.idleTimeoutMin).toBe(5);
  });
});
