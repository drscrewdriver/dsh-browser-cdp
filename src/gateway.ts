// src/gateway.ts — host-side HTTP gateway exposing the `ego-browser` config
// to the browser through a self-hosted `/bcdp/api` route.
//
// The DSH typertGateway `/api` RPC dispatch was the original channel
// (TypertRemoteService + @Remote), but the host's SRC discovery
// (ctx.reflect.props enumeration) is not claiming plugin-owned service
// endpoints on the current dsh snapshot. The self-hosted HTTP route
// mirrors the better-sidebar / dsh-plugin-interpreters pattern:
// `ctx.webServer.register` claims a prefix route, the handler reads/writes
// the settings seam in-process (no wire-layer allowlist gate), and the
// browser reaches it through `fetch('/bcdp/api/<method>')`.
//
// Route shape:
//   POST /bcdp/api/get  → { ok: true, value: { config: ResolvedConfig } }
//   POST /bcdp/api/set  body: { patch: Partial<Config> }
//                        → { ok: true, value: { config: ResolvedConfig } }
// Errors carry { ok: false, error: { code, message } }.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolveConfig } from './config.ts'
import { SETTINGS_NAMESPACE } from './settings.ts'
import { rewriteGithubUrl } from './ffmpeg-manifest.ts'
import type { EgoContext, SettingsService, WebServerLike } from './types.ts'
import type { FfmpegInstallationManager, FfmpegStatus } from './ffmpeg-installation.ts'
import type { RawConfig, ResolvedConfig } from './types.ts'
import {
  defaultAttachCache,
  refreshAttach,
  probeEndpoint,
} from './cdp-targets.ts'
import { setAttachEndpoint, recycleWorker } from './cast-server.ts'

export interface SettingsBridge {
  source(): Record<string, unknown>
  onChange(cb: () => void): () => void
}

/** HTTP route prefix owning every ego-browser API request. */
const API_PREFIX = '/bcdp/api'

/** Config keys the `set` endpoint accepts (allow-list; unknown keys are dropped). */
const ALLOWED_KEYS = new Set<string>([
  'isolateSpaces', 'idleTimeoutMin',
  'chromePath', 'captureBackend', 'streamProfile', 'cdpFps', 'cdpQuality',
  'cdpMaxWidth', 'cdpBackstopIntervalMs', 'ffmpegFps', 'ffmpegMaxWidth', 'ffmpegBitrateKbps',
  'ffmpegEncoder', 'ffmpegPath', 'githubMirror', 'runtimeArgs', 'chromeArgs',
  // ── R1: CDP sequence + activation ───────────────────────────────────────
  'cdpTargets', 'activeTargetId', 'cdpMode', 'cdpProbeTimeoutMs',
  'cursorHud', 'cursorName', 'allowLocalFallback', 'localHeadless', 'localUserDataDir',
])

interface EnvelopeOk<T> { ok: true; value: T }
interface EnvelopeError { ok: false; error: { code: string; message: string } }
type Envelope<T> = EnvelopeOk<T> | EnvelopeError

interface SetResult {
  config: ResolvedConfig
  ffmpegStatus: FfmpegStatus | null
}

interface GetResult {
  config: ResolvedConfig
  ffmpegStatus: FfmpegStatus | null
}

interface CodedErrorLike extends Error {
  code?: string
}

/**
 * Register the `/bcdp/api` HTTP route on the host's web server.
 *
 * The route reads/writes the `ego-browser` settings namespace in-process
 * through the bridge + `ctx.settings`. The settings service is optional:
 * when absent, `get` degrades to the entry source and `set` returns a
 * clear error.
 */
export function registerEgoBrowserGateway(
  ctx: EgoContext,
  bridge: SettingsBridge,
  ffmpegManager: FfmpegInstallationManager | null,
): void {
  let settings: SettingsService | undefined
  ctx.inject?.(['settings'], (sctx) => {
    settings = sctx.settings
    return () => {
      settings = undefined
    }
  })
  ctx.effect?.(() => {
    const webServer = (ctx as EgoContext).get?.('webServer') as WebServerLike | undefined
    if (!webServer || typeof webServer.register !== 'function') return
    return webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (reqRaw: unknown, resRaw: unknown) => {
        const req = reqRaw as IncomingMessage
        const res = resRaw as ServerResponse
        if (req.method !== 'POST') {
          writeJson(res, 405, envelopeError('method-not-allowed', 'POST only'))
          return
        }
        const origin = req.headers.origin
        if (origin) {
          let originHost: string
          try {
            originHost = new URL(origin).host
          } catch {
            writeJson(res, 400, envelopeError('invalid-origin', 'invalid Origin header'))
            return
          }
          if (!req.headers.host || originHost !== req.headers.host) {
            writeJson(res, 403, envelopeError('origin-not-allowed', 'same-origin requests only'))
            return
          }
        }
        if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          writeJson(res, 415, envelopeError('content-type-not-supported', 'application/json required'))
          return
        }
        const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
        const method = pathname.startsWith(`${API_PREFIX}/`)
          ? pathname.slice(`${API_PREFIX}/`.length)
          : undefined
        if (method === undefined || method.includes('/')) {
          writeJson(res, 404, envelopeError('not-found', 'unknown ego-browser API method'))
          return
        }
        try {
          const body = await readJsonBody(req)
          if (method === 'get') {
            const config = resolveConfig(bridge.source() as RawConfig)
            const ffmpegStatus = ffmpegManager ? await ffmpegManager.check({ configuredPath: config.ffmpegPath, requestedEncoder: config.ffmpegEncoder }) : null
            writeJson(res, 200, envelopeOk<GetResult>({ config, ffmpegStatus }))
          } else if (method === 'set') {
            const result = await handleSet(body, settings, bridge, ffmpegManager)
            writeJson(res, 200, envelopeOk<SetResult>(result))
          } else if (method === 'ffmpeg-status') {
            writeJson(res, 200, envelopeOk({ ffmpegStatus: ffmpegManager?.status() || null }))
          } else if (method === 'ffmpeg-check') {
            const config = resolveConfig(bridge.source() as RawConfig)
            const ffmpegStatus = await ffmpegManager?.check({ configuredPath: config.ffmpegPath, requestedEncoder: config.ffmpegEncoder })
            writeJson(res, 200, envelopeOk({ ffmpegStatus: ffmpegStatus || null }))
          } else if (method === 'ffmpeg-install') {
            const config = resolveConfig(bridge.source() as RawConfig)
            const githubMirror = typeof body.githubMirror === 'string' ? body.githubMirror : config.githubMirror
            const ffmpegStatus = ffmpegManager?.startInstall({ githubMirror, configuredPath: config.ffmpegPath, requestedEncoder: config.ffmpegEncoder })
            writeJson(res, 200, envelopeOk({ ffmpegStatus: ffmpegStatus || null }))
          } else if (method === 'cdp-status') {
            // Live attach state for the panel badge (read-only; no re-probe).
            writeJson(res, 200, envelopeOk({ attach: defaultAttachCache.get() }))
          } else if (method === 'cdp-refresh') {
            // Re-probe the ACTIVATED target and push the outcome into the attach
            // cache + cast worker. Mirror of triggerCdpRefresh() in index.ts so
            // a manual refresh from the panel has the same effect as a settings
            // change.
            const cfg = resolveConfig(bridge.source() as RawConfig)
            const attach = await refreshAttach({
              targets: cfg.cdpTargets,
              activeTargetId: cfg.activeTargetId,
              mode: cfg.cdpMode,
              timeoutMs: cfg.cdpProbeTimeoutMs,
              cache: defaultAttachCache,
            })
            const ws = attach.status === 'ready' && attach.wsUrl !== '' ? attach.wsUrl : null
            if (setAttachEndpoint(ws)) {
              void recycleWorker('cdp manual refresh').catch(() => null)
            }
            writeJson(res, 200, envelopeOk({ attach }))
          } else if (method === 'cdp-probe') {
            // One-shot probe of an arbitrary endpoint (used by the per-target
            // "probe" button). Returns the raw outcome; the panel writes it back
            // into the target's probe* fields and persists on save.
            const endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
            if (endpoint === '') {
              writeJson(res, 400, envelopeError('invalid-endpoint', 'endpoint is required'))
              return
            }
            const timeoutMs = typeof body.timeoutMs === 'number' && Number.isFinite(body.timeoutMs) ? body.timeoutMs : undefined
            const outcome = await probeEndpoint(endpoint, { timeoutMs })
            writeJson(res, 200, envelopeOk({ outcome }))
          } else {
            writeJson(res, 404, envelopeError('not-found', `unknown ego-browser API method "${method}"`))
          }
        } catch (error) {
          const e = error as CodedErrorLike
          const message = e instanceof Error ? e.message : String(error)
          const status = e?.code === 'ffmpeg-unavailable' ? 409 : e?.code === 'ffmpeg-mirror-invalid' ? 400 : 500
          writeJson(res, status, envelopeError(e?.code || 'internal', message))
        }
      },
    })
  }, 'ego-browser: /bcdp/api routes')
}

/**
 * Handle the `set` method: validate the patch, write the user layer, return
 * the new resolved config.
 */
async function handleSet(
  body: Record<string, unknown>,
  settings: SettingsService | undefined,
  bridge: SettingsBridge,
  ffmpegManager: FfmpegInstallationManager | null,
): Promise<SetResult> {
  const patch = extractPatch(body)
  if (Object.keys(patch).length === 0) {
    return { config: resolveConfig(bridge.source() as RawConfig), ffmpegStatus: ffmpegManager?.status() || null }
  }
  if (settings === undefined || !settings.update) {
    throw new Error(
      'ego-browser: settings service is unavailable — configuration cannot be written',
    )
  }
  const current = resolveConfig(bridge.source() as RawConfig)
  const next = resolveConfig({ ...current, ...patch } as RawConfig)
  if (patch.githubMirror) rewriteGithubUrl('https://github.com/example/repo/releases/download/tag/file', patch.githubMirror as string)
  const mustValidateFfmpeg = patch.captureBackend === 'ffmpeg' || ((Object.hasOwn(patch, 'ffmpegPath') || Object.hasOwn(patch, 'ffmpegEncoder')) && next.captureBackend === 'ffmpeg')
  if (mustValidateFfmpeg && ffmpegManager) {
    const status = await ffmpegManager.check({ configuredPath: next.ffmpegPath, requestedEncoder: next.ffmpegEncoder })
    if (!status.canSelectFfmpeg) {
      const error = new Error(status.reason || 'FFmpeg is not installed or does not satisfy capture requirements') as CodedErrorLike
      error.code = 'ffmpeg-unavailable'
      throw error
    }
  }
  await settings.update(SETTINGS_NAMESPACE, patch)
  const ffmpegStatus = Object.hasOwn(patch, 'ffmpegPath') && ffmpegManager
    ? await ffmpegManager.check({ configuredPath: next.ffmpegPath, requestedEncoder: next.ffmpegEncoder })
    : ffmpegManager?.status() || null
  return { config: resolveConfig(bridge.source() as RawConfig), ffmpegStatus }
}

/**
 * Extract and validate the patch from the request body.
 *
 * JSON wire boundary: null = "delete" (filtered), undefined never crosses
 * JSON. Unknown keys are dropped (the settings service is non-strict and
 * would otherwise store them). String keys (chromePath) are accepted.
 */
function extractPatch(body: unknown): Record<string, unknown> {
  if (!isObject(body)) return {}
  const raw = Reflect.get(body as object, 'patch')
  if (!isObject(raw)) return {}
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALLOWED_KEYS.has(key)) continue
    if (value === null || value === undefined) continue
    if (typeof value === 'string') {
      normalized[key] = value
    } else if (typeof value === 'boolean') {
      normalized[key] = value
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      normalized[key] = value
    } else if (Array.isArray(value)) {
      // CDP target sequence (and any other array field) is persisted verbatim
      // after a JSON-safety pass so a hand-corrupted row cannot inject a
      // function/class into the settings layer.
      const safe = sanitizeJsonArray(value)
      if (safe !== null) normalized[key] = safe
    }
  }
  return normalized
}

/**
 * Keep only JSON-safe primitives (string/number/boolean), arrays, and plain
 * objects. Anything else (functions, undefined, class instances) is dropped so
 * the value is safe to hand to the settings service. Returns null for a value
 * that could not be made safe.
 */
function sanitizeJsonArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null
  const out: unknown[] = []
  for (const item of value) {
    if (item === null || item === undefined) {
      out.push(null)
    } else if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      out.push(item)
    } else if (Array.isArray(item)) {
      const inner = sanitizeJsonArray(item)
      if (inner === null) return null
      out.push(inner)
    } else if (isObject(item)) {
      const obj: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(item)) {
        if (v === null || v === undefined) {
          obj[k] = null
        } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          obj[k] = v
        } else if (Array.isArray(v)) {
          const inner = sanitizeJsonArray(v)
          if (inner === null) return null
          obj[k] = inner
        } else if (isObject(v)) {
          const innerObj = sanitizeJsonArray([v])
          if (innerObj === null) return null
          obj[k] = innerObj[0]
        } else {
          // drop unsafe leaf (function, etc.)
          obj[k] = null
        }
      }
      out.push(obj)
    } else {
      return null
    }
  }
  return out
}

/** Read and parse a JSON body from a node:http request. */
async function readJsonBody(req: IncomingMessage, maxBytes = 16384): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    bytes += buffer.length
    if (bytes > maxBytes) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  return JSON.parse(text) as Record<string, unknown>
}

/** Write a JSON response envelope. */
function writeJson(res: ServerResponse, status: number, body: Envelope<unknown>): void {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(json)
}

/** Build a success envelope. */
function envelopeOk<T>(value: T): EnvelopeOk<T> {
  return { ok: true, value }
}

/** Build an error envelope. */
function envelopeError(code: string, message: string): EnvelopeError {
  return { ok: false, error: { code, message } }
}

/** Narrow unknown to a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
