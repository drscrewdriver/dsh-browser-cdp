import { describe, it, expect } from "vitest";
import { CdpCaptureBackend, TargetSessions } from "../src/worker/capture-cdp.ts";
import type { CdpClient } from "../src/worker/cdp-client.ts";

class FakeCdp {
  handlers: Map<string, (params: any, sessionId?: string) => void>;
  calls: { method: string; params: any; sessionId?: string }[];
  constructor() { this.handlers = new Map(); this.calls = []; }
  on(method: string, handler: (params: any, sessionId?: string) => void) { this.handlers.set(method, handler); return () => this.handlers.delete(method); }
  async call(method: string, params: any, sessionId?: string) { this.calls.push({ method, params, sessionId }); return {}; }
  emit(method: string, params: any, sessionId?: string) { this.handlers.get(method)?.(params, sessionId); }
}

describe("CDP capture backend", () => {
  it("dispatches text, control keys, and modifiers", async () => {
    const calls: { targetId: string; method: string; params: any }[] = [];
    const sessions = { call: async (targetId: string, method: string, params: any) => calls.push({ targetId, method, params }) } as unknown as TargetSessions;
    await TargetSessions.prototype.sendInput.call(sessions, "target", { type: "insertText", text: "中文" });
    await TargetSessions.prototype.sendInput.call(sessions, "target", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
    await TargetSessions.prototype.sendInput.call(sessions, "target", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
    expect(calls.map((call) => call.method)).toEqual(["Input.insertText", "Input.dispatchKeyEvent", "Input.dispatchKeyEvent"]);
    expect(calls[0].params.text).toBe("中文");
    expect(calls[1].params.modifiers).toBe(2);
    expect(calls[1].params.windowsVirtualKeyCode).toBe(65);
  });

  it("ACKs with the frame id while routing on the flattened target session", async () => {
    const cdp = new FakeCdp();
    const session = { targetId: "target-1", sessionId: "target-session", viewportW: 800, viewportH: 600 };
    const sessions = { ensure: async () => session, get: () => session, updateViewport: async () => session } as unknown as TargetSessions;
    const frames: { data: string }[] = [];
    const backend = new CdpCaptureBackend({ cdp: cdp as unknown as CdpClient, sessions, getConfig: () => ({ cdpFps: 20, cdpQuality: 55, cdpMaxWidth: 960, cdpBackstopIntervalMs: 10000 }), onStatus: () => {}, onJpegFrame: (frame: { data: string }) => frames.push(frame) });
    await backend.start({ targetId: "target-1" });
    cdp.emit("Page.screencastFrame", { sessionId: 42, data: "jpeg", metadata: { visibleViewportWidth: 800, visibleViewportHeight: 600 } }, "target-session");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(cdp.calls.some((call) => call.method === "Page.screencastFrameAck" && call.params.sessionId === 42 && call.sessionId === "target-session")).toBeTruthy();
    expect(frames.at(-1)!.data).toBe("jpeg");
    await backend.stop();
  });

  it("keeps both targets streaming when a second one is watched (#15)", async () => {
    const cdp = new FakeCdp();
    const sessions = { ensure: async (targetId: string) => ({ targetId, sessionId: `session-${targetId}` }), get: () => null, updateViewport: async () => ({}) } as unknown as TargetSessions;
    const backend = new CdpCaptureBackend({ cdp: cdp as unknown as CdpClient, sessions, getConfig: () => ({ cdpFps: 20, cdpQuality: 55, cdpMaxWidth: 960, cdpBackstopIntervalMs: 10000 }), onStatus: () => {}, onJpegFrame: () => {} });
    await backend.start({ targetId: "a" });
    await backend.start({ targetId: "b" });
    // Both stay live: NO stop of a when b starts — that stop was the freeze.
    expect(cdp.calls.filter((call) => call.method === "Page.stopScreencast")).toHaveLength(0);
    expect(backend.targetIds().sort()).toEqual(["a", "b"]);
    await backend.stopTarget("a");
    // b still streaming: only a's screencast was stopped.
    expect(cdp.calls.filter((call) => call.method === "Page.stopScreencast").map((call) => call.sessionId)).toEqual(["session-a"]);
    expect(backend.targetIds()).toEqual(["b"]);
    await backend.stop();
  });

  it("is idempotent per target: a second start on the same id neither restarts nor stops", async () => {
    const cdp = new FakeCdp();
    const sessions = { ensure: async (targetId: string) => ({ targetId, sessionId: `session-${targetId}` }), get: () => null, updateViewport: async () => ({}) } as unknown as TargetSessions;
    const backend = new CdpCaptureBackend({ cdp: cdp as unknown as CdpClient, sessions, getConfig: () => ({ cdpFps: 20, cdpQuality: 55, cdpMaxWidth: 960, cdpBackstopIntervalMs: 10000 }), onStatus: () => {}, onJpegFrame: () => {} });
    await backend.start({ targetId: "a" });
    await backend.start({ targetId: "a" });
    expect(cdp.calls.filter((call) => call.method === "Page.startScreencast")).toHaveLength(1);
    expect(cdp.calls.filter((call) => call.method === "Page.stopScreencast")).toHaveLength(0);
    await backend.stop();
  });

  it("routes frames per flattened session and drops unknown sessions (#15)", async () => {
    const cdp = new FakeCdp();
    const sessions = { ensure: async (targetId: string) => ({ targetId, sessionId: `session-${targetId}` }), get: () => null, updateViewport: async () => ({}) } as unknown as TargetSessions;
    const frames: { targetId: string; data: string }[] = [];
    const backend = new CdpCaptureBackend({ cdp: cdp as unknown as CdpClient, sessions, getConfig: () => ({ cdpFps: 20, cdpQuality: 55, cdpMaxWidth: 960, cdpBackstopIntervalMs: 10000 }), onStatus: () => {}, onJpegFrame: (frame: { targetId: string; data: string }) => frames.push(frame) });
    await backend.start({ targetId: "a" });
    await backend.start({ targetId: "b" });
    cdp.emit("Page.screencastFrame", { sessionId: 1, data: "frame-a", metadata: {} }, "session-a");
    cdp.emit("Page.screencastFrame", { sessionId: 2, data: "frame-b", metadata: {} }, "session-b");
    cdp.emit("Page.screencastFrame", { sessionId: 3, data: "frame-x", metadata: {} }, "session-unknown");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const byTarget = Object.fromEntries(frames.map((frame) => [frame.targetId, frame.data]));
    expect(byTarget["a"]).toBe("frame-a");
    expect(byTarget["b"]).toBe("frame-b");
    expect(frames.some((frame) => frame.data === "frame-x")).toBe(false);
    await backend.stop();
  });

  it("projects the wire format: png (Lightpanda) drops quality, jpeg (default) keeps it", async () => {
    const cdp = new FakeCdp();
    const sessions = { ensure: async () => ({ targetId: "t", sessionId: "s" }), get: () => null, updateViewport: async () => ({}) } as unknown as TargetSessions;
    const make = (imageFormat?: "jpeg" | "png") => new CdpCaptureBackend({ cdp: cdp as unknown as CdpClient, sessions, getConfig: () => ({ cdpFps: 20, cdpQuality: 55, cdpMaxWidth: 960, cdpBackstopIntervalMs: 10000 }), onStatus: () => {}, onJpegFrame: () => {}, ...(imageFormat === undefined ? {} : { imageFormat }) });
    await make("png").start({ targetId: "t" });
    const pngParams = cdp.calls.find((call) => call.method === "Page.startScreencast")!.params;
    expect(pngParams.format).toBe("png");
    expect(pngParams).not.toHaveProperty("quality");
    await make().start({ targetId: "t" });
    const jpegParams = cdp.calls.filter((call) => call.method === "Page.startScreencast").at(-1)!.params;
    expect(jpegParams.format).toBe("jpeg");
    expect(jpegParams.quality).toBe(55);
  });
});
