/**
 * src/cdp-targets.ts — CDP endpoint **sequence + activation** (R1).
 *
 * The plugin treats an already-running browser reachable over the DevTools
 * Protocol as the primary target. Users keep an ORDERED list of endpoints
 * (`cdpTargets`, the sequence) and single out one of them (`activeTargetId`,
 * the activation); the activated endpoint is what every `ego_*` tool drives.
 *
 * Design contract (from spec.md §2 / §3):
 *
 *  1. Persistence stores ONLY what the user typed. The `ws://…/<uuid>` URL
 *     discovered from an HTTP endpoint is derived state: the uuid changes
 *     every time the remote browser restarts, so writing it back would rot
 *     immediately. Same rule for locally launched endpoints (Port 0 changes
 *     every cold start) — those are never persisted at all.
 *  2. Resolution is EXPLICIT. A failed probe surfaces a structured code +
 *     message; it never silently falls back to launching a local browser.
 *     Local fallback requires BOTH `mode=auto` AND `allowLocalFallback=true`,
 *     and even then the built-in launcher (M0.9) must be available.
 *  3. This module is pure/host-free apart from the `fetch` call inside
 *     `probeEndpoint`, which is injectable — the test fixtures use fixed data
 *     and never touch a real clock or network.
 */

import type { CdpMode, CdpTarget } from './types.ts'
import { discoverWebSocketUrl, normalizeEndpoint, type CdpErrorCode } from './cdp/endpoint.ts'

// M0.1 (endpoint resolution) now lives in `src/cdp/endpoint.ts` — the
// acceptance criterion for that module is that only `ws` leaves it. It is
// re-exported here so every existing import path (and the R1 tests) keep
// working unchanged.
export { normalizeEndpoint }
export type { EndpointScheme, EndpointOk, EndpointErr, EndpointCheck, CdpErrorCode } from './cdp/endpoint.ts'

/** Env var the vendored ego runtime reads to attach to an existing browser. */
export const EGO_LINUX_CDP_URL = 'EGO_LINUX_CDP_URL'

/** Hard ceiling on the sequence length (UI + payload sanity, not semantics). */
export const MAX_TARGETS = 32

// Endpoint validation + `/json/version` discovery moved to src/cdp/endpoint.ts
// (M0.1). Re-exported above; nothing is defined here any more.

/**
 * Build a stable target id. `randomUUID` is available on every supported
 * host (Node >= 22); the fallback exists only because cheap and steady beats
 * clever in a hot path that also runs inside tests.
 */
export function newTargetId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID()
  return `t-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

/** Coerce one unknown-shaped sequence entry into a `CdpTarget`, or null when unusable. */
export function coerceTarget(raw: unknown): CdpTarget | null {
  if (typeof raw !== 'object' || raw === null) return null
  const rec = raw as Record<string, unknown>
  const endpoint = normalizeEndpoint(rec.endpoint)
  if (!endpoint.ok) return null
  const label = typeof rec.label === 'string' ? rec.label.trim() : ''
  const id = typeof rec.id === 'string' && rec.id.trim() !== '' ? rec.id.trim() : newTargetId()
  return {
    id,
    label: label === '' ? endpoint.endpoint : label,
    endpoint: endpoint.endpoint,
    enabled: rec.enabled === undefined ? true : Boolean(rec.enabled),
    note: typeof rec.note === 'string' ? rec.note : '',
  }
}

/**
 * Sanitize the persisted sequence. Dirty data is expected here (hand-edited
 * `settings.yaml`, older schema, unknown keys) so the rule is DROP, never
 * throw: every surviving entry carries a usable endpoint, and duplicate ids
 * additionally get fresh ones so ordering/activation stay unambiguous.
 */
export function sanitizeTargets(raw: unknown, max: number = MAX_TARGETS): CdpTarget[] {
  if (!Array.isArray(raw)) return []
  const out: CdpTarget[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const target = coerceTarget(entry)
    if (!target) continue
    if (seen.has(target.id)) target.id = newTargetId()
    seen.add(target.id)
    out.push(target)
    if (out.length >= max) break
  }
  return out
}

export function findTarget(targets: readonly CdpTarget[], id: string): CdpTarget | null {
  if (id === '') return null
  return targets.find((target) => target.id === id) ?? null
}

/**
 * The target that currently owns the tools. A disabled entry never wins even
 * if it is still pointed at by `activeTargetId` — its id may be reactivated
 * later without being removed from the sequence.
 */
export function activeTarget(targets: readonly CdpTarget[], activeTargetId: string): CdpTarget | null {
  const target = findTarget(targets, activeTargetId)
  return target && target.enabled ? target : null
}

/**
 * Insert or replace one entry. Existing fields survive when the patch omits
 * them, so the UI can push a single-field edit without resending the row.
 * The sequence caps at `MAX_TARGETS`; a new id beyond the cap is a no-op.
 */
export function upsertTarget(targets: readonly CdpTarget[], patch: Partial<CdpTarget> & { endpoint: string }): CdpTarget[] {
  const id = typeof patch.id === 'string' && patch.id !== '' ? patch.id : newTargetId()
  const existing = findTarget(targets, id)
  const merged = sanitizeTargets([{ ...(existing ?? {}), ...patch, id }])[0]
  if (!merged) return [...targets]
  if (!existing) {
    if (targets.length >= MAX_TARGETS) return [...targets]
    return [...targets, merged]
  }
  return targets.map((entry) => (entry.id === id ? merged : entry))
}

export function removeTarget(targets: readonly CdpTarget[], id: string): CdpTarget[] {
  return targets.filter((entry) => entry.id !== id)
}

/**
 * Move an entry within the sequence. `delta` of -1 moves one slot up, +1 one
 * slot down; out-of-range and unknown ids return the input unchanged (the UI
 * disables those buttons, this is the second line of defense).
 */
export function moveTarget(targets: readonly CdpTarget[], id: string, delta: number): CdpTarget[] {
  const index = targets.findIndex((entry) => entry.id === id)
  if (index === -1) return [...targets]
  const wanted = index + delta
  if (wanted < 0 || wanted >= targets.length) return [...targets]
  const copy = [...targets]
  const moved = copy.splice(index, 1)[0]!
  copy.splice(wanted, 0, moved)
  return copy
}

// ── probing ────────────────────────────────────────────────────────────────

export interface ProbeOutcome {
  ok: boolean
  code: CdpErrorCode | 'ok'
  message: string
  /** Resolved browser websocket, present only on success. Never persisted. */
  wsUrl?: string
  latencyMs: number
}

export interface ProbeOptions {
  timeoutMs?: number
  /** Injectable for fixtures: must resolve `{ ok, json }` or throw. */
  fetchVersion?: (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>
  now?: () => number
}

/**
 * Resolve one endpoint to a browser websocket URL.
 *
 * Thin adapter over M0.1's `discoverWebSocketUrl`: the resolution logic lives
 * in `src/cdp/endpoint.ts`, while `ProbeOutcome` stays the shape the settings
 * panel and the gateway already speak — its codes are contract, so they are
 * mapped one-to-one rather than re-derived here.
 */
export async function probeEndpoint(endpoint: string, options: ProbeOptions = {}): Promise<ProbeOutcome> {
  const result = await discoverWebSocketUrl(endpoint, {
    timeoutMs: options.timeoutMs,
    fetchVersion: options.fetchVersion,
    now: options.now,
  })
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, latencyMs: result.latencyMs }
  }
  return { ok: true, code: 'ok', message: '', wsUrl: result.wsUrl, latencyMs: result.latencyMs }
}

// ── attach decision + cache ────────────────────────────────────────────────

export type AttachStatus = 'idle' | 'probing' | 'ready' | 'unreachable' | 'no-active' | 'local'

export interface AttachState {
  status: AttachStatus
  mode: CdpMode
  targetId: string
  endpoint: string
  wsUrl: string
  code: string
  message: string
  latencyMs: number
  resolvedAt: number
}

export function emptyAttachState(): AttachState {
  return {
    status: 'idle',
    mode: 'auto',
    targetId: '',
    endpoint: '',
    wsUrl: '',
    code: '',
    message: '',
    latencyMs: 0,
    resolvedAt: 0,
  }
}

export type AttachDecision =
  | { kind: 'inject'; wsUrl: string; targetId: string; source: 'remote' }
  | { kind: 'local'; message: string }
  | { kind: 'error'; code: string; message: string }

export interface DecideInput {
  mode: CdpMode
  /** Whether the sequence has an enabled activated entry at all. */
  hasActive: boolean
  status: AttachStatus
  /** Last successful ws URL, used only while status === 'ready'. */
  wsUrl: string
  code: string
  message: string
  allowLocalFallback: boolean
  /** True once the built-in local launcher (M0.9) is wired in. */
  localLauncherReady: boolean
}

/**
 * Decide how the next `ego_*` call attaches.
 *
 * The rules are deliberately narrow and each branch is a VISIBLE outcome:
 *
 * - `mode=local`  → hand back to local control (explicit user choice).
 * - no activation → error, never a silent local cold start (spec §3.2).
 * - resolved      → inject the ws URL.
 * - not resolved  → error. The ONLY path to a local browser from here is an
 *                   explicit `allowLocalFallback` AND a working launcher.
 */
export function decideAttach(input: DecideInput): AttachDecision {
  if (input.mode === 'local') {
    return { kind: 'local', message: 'local mode: using local browser control' }
  }
  if (!input.hasActive) {
    return {
      kind: 'error',
      code: 'no-active-target',
      message:
        'No activated CDP target. Configure a target sequence and activate one in the dsh-browser-cdp settings panel, or set cdpMode=local to use a local browser explicitly.',
    }
  }
  if (input.status === 'ready' && input.wsUrl !== '') {
    return { kind: 'inject', wsUrl: input.wsUrl, targetId: '', source: 'remote' }
  }
  if (input.status === 'idle' || input.status === 'probing') {
    return {
      kind: 'error',
      code: 'endpoint-unresolved',
      message: 'Activated CDP endpoint has not been probed yet. Wait for the probe to finish and retry the call.',
    }
  }
  const detail = input.message === '' ? input.code || 'unreachable' : `${input.code}: ${input.message}`.replace(/^:\s*/, '')
  if (input.allowLocalFallback && !input.localLauncherReady) {
    return {
      kind: 'error',
      code: 'local-launcher-unavailable',
      message: `Activated CDP endpoint is unreachable (${detail}) and local fallback is enabled, but the built-in local launcher is not available in this build. Fix the endpoint or set cdpMode=local.`,
    }
  }
  return {
    kind: 'error',
    code: input.mode === 'remote' ? 'remote-unreachable' : 'endpoint-unreachable',
    message:
      `Activated CDP endpoint is unreachable (${detail}). Not falling back to a local browser.` +
      ' Fix/replace the endpoint, pick another target, or enable allowLocalFallback to make the fallback explicit.',
  }
}

export interface AttachCache {
  get(): AttachState
  patch(next: Partial<AttachState>): AttachState
  reset(): void
}

export function createAttachCache(): AttachCache {
  let state = emptyAttachState()
  return {
    get: () => state,
    patch: (next) => {
      state = { ...state, ...next }
      return state
    },
    reset: () => {
      state = emptyAttachState()
    },
  }
}

/** Process-wide attach cache the host half reads synchronously at spawn time. */
export const defaultAttachCache: AttachCache = createAttachCache()

export interface RefreshInput {
  targets: readonly CdpTarget[]
  activeTargetId: string
  mode: CdpMode
  timeoutMs?: number
  cache?: AttachCache
  now?: () => number
  fetchVersion?: ProbeOptions['fetchVersion']
  localLauncherReady?: boolean
}

/**
 * Re-probe the activated target and publish the outcome into the cache.
 *
 * `local` mode short-circuits: there is nothing to probe and nothing to write,
 * which is exactly why switching to `local` must also invalidate any previously
 * injected remote (callers see a fresh state, not a stale one).
 */
export async function refreshAttach(input: RefreshInput): Promise<AttachState> {
  const cache = input.cache ?? defaultAttachCache
  const now = input.now ?? (() => Date.now())
  const previous = cache.get()
  const suggested: AttachState = {
    ...previous,
    mode: input.mode,
    status: input.mode === 'local' ? 'local' : 'idle',
    wsUrl: input.mode === 'local' ? '' : previous.wsUrl,
    code: '',
    message: '',
  }
  if (input.mode === 'local') {
    suggested.targetId = ''
    suggested.endpoint = ''
    suggested.resolvedAt = now()
    return cache.patch(suggested)
  }
  const target = activeTarget(input.targets, input.activeTargetId)
  if (!target) {
    return cache.patch({
      ...suggested,
      status: 'no-active',
      targetId: input.activeTargetId,
      endpoint: '',
      wsUrl: '',
      code: 'no-active-target',
      message: 'no activated target in the sequence',
      resolvedAt: now(),
    })
  }
  const sameTarget = previous.targetId === target.id && previous.endpoint === target.endpoint
  const suggestedProbe: AttachState = {
    ...suggested,
    targetId: target.id,
    endpoint: target.endpoint,
    status: 'probing',
    code: '',
    message: '',
    wsUrl: sameTarget ? previous.wsUrl : '',
    latencyMs: sameTarget ? previous.latencyMs : 0,
  }
  cache.patch(suggestedProbe)
  const outcome = await probeEndpoint(target.endpoint, {
    timeoutMs: input.timeoutMs,
    now,
    ...(input.fetchVersion ? { fetchVersion: input.fetchVersion } : {}),
  })
  if (outcome.ok && outcome.wsUrl) {
    return cache.patch({
      status: 'ready',
      wsUrl: outcome.wsUrl,
      code: '',
      message: '',
      latencyMs: outcome.latencyMs,
      resolvedAt: now(),
    })
  }
  return cache.patch({
    status: 'unreachable',
    wsUrl: '',
    code: outcome.code,
    message: outcome.message,
    latencyMs: outcome.latencyMs,
    resolvedAt: now(),
  })
}
