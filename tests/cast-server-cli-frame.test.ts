import { describe, it, expect } from "vitest";
import { initCastServer, EGO_SPACES_ROUTE, EGO_CLI_FRAME_ROUTE, CLI_FRAME_TARGET_ID } from "../src/cast-server.ts";
import type { CliFramePoller } from "../src/cast/cli-frame-poller.ts"

// Integration evidence for the ego-cli degraded frame source: drives the real
// initCastServer with a fake webServer (captures the trust-fence-guarded
// handlers) + a controlled poller, then invokes the two new behaviours — the
// cli-frame route (200 PNG / 204) and the /spaces cliFrameMode synthesis.
// subprocess.spawn throws so ensureWorker resolves null fast (no 8s deadline).

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const TRUST = { headers: { cookie: "dsh-auth-abc=1" } } as any
const UNTRUST = { headers: { cookie: "" } } as any

class MockRes {
  statusCode = 0
  headers: Record<string, unknown> = {}
  body: unknown = null
  ended = false
  writeHead(code: number, hs?: Record<string, unknown>) { this.statusCode = code; Object.assign(this.headers, hs ?? {}); return this }
  setHeader(k: string, v: unknown) { this.headers[k] = v }
  end(chunk?: unknown) { this.ended = true; if (chunk !== undefined) this.body = chunk }
  json() { return JSON.parse(String(this.body)) as Record<string, unknown> }
}

interface Handlers { [path: string]: (req: unknown, res: unknown) => Promise<void> }
function mount(poller: CliFramePoller | null): Handlers {
  const handlers: Handlers = {}
  const webServer = {
    register: (opts: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => {
      handlers[opts.path] = opts.handler
      return () => {}
    },
  }
  const ctx = {
    get: (name: string) => (name === "webServer" ? webServer : undefined),
    subprocess: { spawn: () => { throw new Error("no subprocess under test") } },
    effect: () => {},
    logger: { info: () => {}, warn: () => {} },
  } as any
  const cfg = { captureBackend: "auto", streamProfile: "balanced" } as any
  const bridge = { onChange: () => () => {}, source: () => ({}) } as any
  initCastServer(ctx, cfg, bridge, null, undefined, undefined, poller)
  return handlers
}

const framePoller = {
  isRunning: () => true,
  getFrame: () => ({ png: PNG, url: "https://agent.test/page", title: "Agent Page", seq: 7, updatedAt: 1234 }),
} as unknown as CliFramePoller
const emptyPoller = { isRunning: () => true, getFrame: () => null } as unknown as CliFramePoller
const offPoller = { isRunning: () => false, getFrame: () => ({ png: PNG, url: "", title: "", seq: 1, updatedAt: 1 }) } as unknown as CliFramePoller

describe("cli-frame route (ego-cli degraded source)", () => {
  it("serves the newest frame as image/png", async () => {
    const h = mount(framePoller)
    const res = new MockRes()
    await h[EGO_CLI_FRAME_ROUTE](TRUST, res)
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("image/png")
    expect(res.headers["cache-control"]).toBe("no-store")
    expect(res.headers["x-cli-frame-seq"]).toBe("7")
    expect((res.body as Buffer).equals(PNG)).toBe(true)
  })

  it("returns 204 when the running poller has no frame yet", async () => {
    const h = mount(emptyPoller)
    const res = new MockRes()
    await h[EGO_CLI_FRAME_ROUTE](TRUST, res)
    expect(res.statusCode).toBe(204)
    expect(res.body).toBeNull()
  })

  it("returns 204 when the poller is not running (switch off / cdp link)", async () => {
    const h = mount(offPoller)
    const res = new MockRes()
    await h[EGO_CLI_FRAME_ROUTE](TRUST, res)
    expect(res.statusCode).toBe(204)
  })

  it("trust fence rejects an unauthenticated frame request", async () => {
    const h = mount(framePoller)
    const res = new MockRes()
    await h[EGO_CLI_FRAME_ROUTE](UNTRUST, res)
    expect(res.statusCode).toBe(401)
  })
})

describe("spaces cliFrameMode synthesis", () => {
  it("synthesizes one synthetic space when no worker but the poller has a frame", async () => {
    const h = mount(framePoller)
    const res = new MockRes()
    await h[EGO_SPACES_ROUTE](TRUST, res)
    const data = res.json()
    expect(data.ok).toBe(true)
    expect(data.cliFrameMode).toBe(true)
    expect(data.cliFrameIntervalMs).toBe(5000)
    const spaces = data.spaces as Array<Record<string, unknown>>
    expect(spaces).toHaveLength(1)
    expect(spaces[0].targetId).toBe(CLI_FRAME_TARGET_ID)
    expect(spaces[0].url).toBe("https://agent.test/page")
    expect(spaces[0].title).toBe("Agent Page")
    expect(spaces[0].active).toBe(true)
  })

  it("falls back to the empty 'no live agent browser' state when the poller has no frame", async () => {
    const h = mount(emptyPoller)
    const res = new MockRes()
    await h[EGO_SPACES_ROUTE](TRUST, res)
    const data = res.json()
    expect(data.ok).toBe(false)
    expect(data.cliFrameMode).toBeUndefined()
    expect(data.spaces).toEqual([])
    expect(data.reason).toBe("no live agent browser")
  })
})
