import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initCastServer, EGO_SPACES_ROUTE } from "../src/cast-server.ts";
import type { CliFramePoller } from "../src/cast/cli-frame-poller.ts"

// Issue #21: the /api/bcdp/* trust fence must ASK THE HOST rather than sniff a
// `dsh-auth-*` cookie. These tests pin the three verdicts the host may return,
// plus the two degraded shapes (no connection service on old engines, and a
// fence that throws) so the carry-over can never silently become "open".
process.env.EGO_LINUX_STATE_DIR = join(tmpdir(), `bcdp-trust-fence-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)

const AUTHED = { headers: { cookie: "dsh-auth-abc=1" } } as any
const ANON = { headers: { cookie: "" } } as any

class MockRes {
  statusCode = 0
  headers: Record<string, unknown> = {}
  body: unknown = null
  writeHead(code: number, hs?: Record<string, unknown>) { this.statusCode = code; Object.assign(this.headers, hs ?? {}); return this }
  setHeader(k: string, v: unknown) { this.headers[k] = v }
  end(chunk?: unknown) { if (chunk !== undefined) this.body = chunk }
  json() { return JSON.parse(String(this.body)) as Record<string, unknown> }
}

interface Handlers { [path: string]: (req: unknown, res: unknown) => Promise<void> }

const offPoller = { isRunning: () => false, getFrame: () => null } as unknown as CliFramePoller

/** Mount with a host `connection` service getter (the issue-#21 seam). */
function mount(connection: unknown | (() => unknown)): Handlers {
  const handlers: Handlers = {}
  const connectionOf = typeof connection === "function" ? connection as () => unknown : () => connection
  const webServer = {
    register: (opts: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => {
      handlers[opts.path] = opts.handler
      return () => {}
    },
  }
  const ctx = {
    get: (name: string) => {
      if (name === "webServer") return webServer
      if (name === "connection") return connectionOf()
      return undefined
    },
    subprocess: { spawn: () => { throw new Error("no subprocess under test") } },
    effect: () => {},
    logger: { info: () => {}, warn: () => {} },
  } as any
  initCastServer(ctx, { captureBackend: "auto", streamProfile: "balanced" } as any,
    { onChange: () => () => {}, source: () => ({}) } as any, null, undefined, undefined, offPoller)
  return handlers
}

/** A host connection service whose fence always answers `verdict`. */
function fence(verdict: 401 | 403 | undefined) {
  return { requestRejection: () => verdict }
}

describe("cast-server trust fence asks the host connection service (#21)", () => {
  it("lets an unauthenticated-cookie request through when the host authorises it", async () => {
    // The @iasiv5/dsh-skip-browser-auth shape: trust fence passes, no dsh-auth-*
    // cookie was ever minted. The panel must reach the route anyway.
    const h = mount(fence(undefined))
    const res = new MockRes()
    await h[EGO_SPACES_ROUTE](ANON, res)
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(false) // no live browser — but NOT 401
  })

  it("passes the host's 401 through, even for a forged dsh-auth cookie", async () => {
    // Stricter than the old cookie sniff: presence is not authentication.
    const h = mount(fence(401))
    const res = new MockRes()
    await h[EGO_SPACES_ROUTE](AUTHED, res)
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe("unauthorized")
  })

  it("passes the host's 403 through with a forbidden body", async () => {
    // Host/Origin fence failure (cross-site / DNS rebinding).
    const h = mount(fence(403))
    const res = new MockRes()
    await h[EGO_SPACES_ROUTE](ANON, res)
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe("forbidden")
  })

  it("falls back to the cookie carry-over when the engine has no connection service", async () => {
    const h = mount(undefined)
    const denied = new MockRes()
    await h[EGO_SPACES_ROUTE](ANON, denied)
    expect(denied.statusCode).toBe(401)
    const allowed = new MockRes()
    await h[EGO_SPACES_ROUTE](AUTHED, allowed)
    expect(allowed.statusCode).toBe(200)
  })

  it("falls back to the cookie carry-over when the host fence throws", async () => {
    const h = mount({ requestRejection: () => { throw new Error("host generation mismatch") } })
    const denied = new MockRes()
    await h[EGO_SPACES_ROUTE](ANON, denied)
    expect(denied.statusCode).toBe(401)
    const allowed = new MockRes()
    await h[EGO_SPACES_ROUTE](AUTHED, allowed)
    expect(allowed.statusCode).toBe(200)
  })

  it("picks the host service up when it mounts after this plugin", async () => {
    // Load order must not freeze the legacy path: ctx.get answers undefined
    // until the connection plugin exists, so the lookup is per-request.
    let host: unknown
    const h = mount(() => host)
    const before = new MockRes()
    await h[EGO_SPACES_ROUTE](ANON, before)
    expect(before.statusCode).toBe(401) // no service yet → carry-over refuses
    host = fence(undefined) // connection mounts later
    const after = new MockRes()
    await h[EGO_SPACES_ROUTE](ANON, after)
    expect(after.statusCode).toBe(200) // host verdict now wins
  })
})
