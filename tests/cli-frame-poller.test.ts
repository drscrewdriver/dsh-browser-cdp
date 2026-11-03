import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CliFramePoller,
  parseFrameSentinel,
  buildFrameScript,
  FRAME_SENTINEL,
} from "../src/cast/cli-frame-poller.ts";

// A minimal valid PNG-looking base64 payload (bytes need not be a real PNG —
// the poller treats them as opaque bytes and just round-trips base64).
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")

function frameLine(url = "https://example.com/", title = "Example"): string {
  return `${FRAME_SENTINEL}${JSON.stringify({ png: PNG_B64, url, title })}`
}

describe("parseFrameSentinel", () => {
  it("decodes a well-formed frame line", () => {
    const f = parseFrameSentinel(`noise\n${frameLine("https://a.test/", "A")}`, 1, 1000)
    expect(f).not.toBeNull()
    expect(f!.url).toBe("https://a.test/")
    expect(f!.title).toBe("A")
    expect(f!.seq).toBe(1)
    expect(f!.updatedAt).toBe(1000)
    expect(Buffer.isBuffer(f!.png)).toBe(true)
    expect(f!.png.toString("base64")).toBe(PNG_B64)
  })

  it("takes the LAST sentinel line when trailing noise or repeats exist", () => {
    const stdout = `${frameLine("https://old/", "old")}\nlog line\n${frameLine("https://new/", "new")}`
    const f = parseFrameSentinel(stdout, 7, 0)
    expect(f!.url).toBe("https://new/")
  })

  it("returns null when no sentinel is present", () => {
    expect(parseFrameSentinel("just some logs\nnothing here", 1, 0)).toBeNull()
  })

  it("returns null on malformed JSON payload", () => {
    expect(parseFrameSentinel(`${FRAME_SENTINEL}{not json`, 1, 0)).toBeNull()
  })

  it("returns null when png is empty or non-string", () => {
    expect(parseFrameSentinel(`${FRAME_SENTINEL}${JSON.stringify({ png: "", url: "u", title: "t" })}`, 1, 0)).toBeNull()
    expect(parseFrameSentinel(`${FRAME_SENTINEL}${JSON.stringify({ url: "u" })}`, 1, 0)).toBeNull()
  })

  it("tolerates missing url/title into empty strings", () => {
    const f = parseFrameSentinel(`${FRAME_SENTINEL}${JSON.stringify({ png: PNG_B64 })}`, 3, 0)
    expect(f!.url).toBe("")
    expect(f!.title).toBe("")
  })
})

describe("buildFrameScript", () => {
  it("binds the space and does NOT switch tabs (passive observer)", () => {
    const s = buildFrameScript('"dsh-agent-abc12345"')
    expect(s).toContain("taskSpaces.useOrCreate(\"dsh-agent-abc12345\")")
    expect(s).toContain("page.screenshot({ fullPage: false })")
    expect(s).toContain(FRAME_SENTINEL)
    // must not mutate the active tab
    expect(s).not.toContain("switchTab")
    expect(s).not.toContain("ensureRealTab")
  })
})

describe("CliFramePoller", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("captures a frame on start (immediate tick) and every interval", async () => {
    let calls = 0
    const poller = new CliFramePoller({
      intervalMs: 5000,
      capture: async () => { calls += 1; return frameLine(`https://c${calls}/`, `t${calls}`) },
    })
    poller.start()
    // immediate tick fires
    await vi.advanceTimersByTimeAsync(0)
    expect(poller.getFrame()!.url).toBe("https://c1/")
    await vi.advanceTimersByTimeAsync(5000)
    expect(poller.getFrame()!.url).toBe("https://c2/")
    await vi.advanceTimersByTimeAsync(5000)
    expect(poller.getFrame()!.url).toBe("https://c3/")
    poller.stop()
    expect(poller.isRunning()).toBe(false)
    expect(poller.getFrame()).toBeNull()
  })

  it("skips a tick when the lock is busy and keeps the previous frame", async () => {
    let busy = false
    let calls = 0
    const poller = new CliFramePoller({
      intervalMs: 5000,
      isBusy: () => busy,
      capture: async () => { calls += 1; return frameLine(`https://x${calls}/`) },
    })
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toBe(1)
    busy = true
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls).toBe(1) // no new capture while busy
    expect(poller.getFrame()!.url).toBe("https://x1/") // previous frame kept
    busy = false
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls).toBe(2)
    poller.stop()
  })

  it("keeps the last good frame when a capture has no sentinel", async () => {
    let calls = 0
    const poller = new CliFramePoller({
      intervalMs: 5000,
      capture: async () => {
        calls += 1
        return calls === 1 ? frameLine("https://good/") : "Error: no active tab"
      },
    })
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(poller.getFrame()!.url).toBe("https://good/")
    await vi.advanceTimersByTimeAsync(5000) // failed capture
    expect(poller.getFrame()!.url).toBe("https://good/") // unchanged
    poller.stop()
  })

  it("is idempotent on start and does not overlap slow captures", async () => {
    let calls = 0
    let release: () => void = () => {}
    const poller = new CliFramePoller({
      intervalMs: 1000,
      capture: () => {
        calls += 1
        return new Promise<string>((resolve) => {
          release = () => resolve(frameLine(`https://s${calls}/`))
        })
      },
    })
    poller.start()
    poller.start() // second start is a no-op (one timer)
    await vi.advanceTimersByTimeAsync(0) // tick 1 in flight (awaiting release)
    await vi.advanceTimersByTimeAsync(1000) // tick 2 skipped: inFlight
    expect(calls).toBe(1)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(poller.getFrame()!.url).toBe("https://s1/")
    poller.stop()
  })
})
