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

import type { BrowserLink, BrowserLinkKind, CdpLink, CdpMode, EgoCliLink } from './types.ts'
import { discoverWebSocketUrl, normalizeEndpoint, type CdpErrorCode } from './cdp/endpoint.ts'
import { launchLocalBrowser, stopLocalBrowser } from './cdp/launcher.ts'
import { probeCliLink, type CliLinkIo } from './cdp/cli-link.ts'

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

/**
 * R7 — the local-only link kind. Its VALUE is a discriminator, not an
 * identifier: nothing in our surface is named after it (the upstream plugin
 * owns `ego_*` tool names, `ego_browser_settings`, `/api/ego/*`, …).
 */
export const EGO_CLI_KIND = 'ego-cli'

/** Default panel label for an ego-cli link (no endpoint to fall back to). */
export const EGO_CLI_LABEL = '本机 ego CLI'

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

/** Coerce one unknown-shaped sequence entry into a `BrowserLink`, or null when unusable. */
export function coerceLink(raw: unknown): BrowserLink | null {
  if (typeof raw !== 'object' || raw === null) return null
  const rec = raw as Record<string, unknown>
  const base = {
    id: typeof rec.id === 'string' && rec.id.trim() !== '' ? rec.id.trim() : newTargetId(),
    enabled: rec.enabled === undefined ? true : Boolean(rec.enabled),
    note: typeof rec.note === 'string' ? rec.note : '',
  }
  const label = typeof rec.label === 'string' ? rec.label.trim() : ''

  // Non-CDP kinds are recognized BEFORE the endpoint check, because they
  // legitimately have no endpoint at all.
  if (rec.kind === EGO_CLI_KIND) {
    const cliPath = typeof rec.cliPath === 'string' ? rec.cliPath.trim() : ''
    return {
      ...base,
      kind: EGO_CLI_KIND,
      label: label === '' ? EGO_CLI_LABEL : label,
      cliPath,
      ...(rec.useSdkPath === undefined ? {} : { useSdkPath: Boolean(rec.useSdkPath) }),
    }
  }

  const endpoint = normalizeEndpoint(rec.endpoint)
  if (!endpoint.ok) return null
  // `kind` is optional on read: the legacy `cdpTargets` key had no discriminator,
  // and forcing every stored row to carry one would reject all pre-R7 data.
  return {
    ...base,
    kind: 'cdp',
    label: label === '' ? endpoint.endpoint : label,
    endpoint: endpoint.endpoint,
  }
}

/** Result of folding a raw sequence into a usable one. */
export interface SanitizeLinksResult {
  links: BrowserLink[]
  /** Extra `ego-cli` entries that were dropped to honour the local-only singleton. */
  droppedEgoCli: number
  /** Entries dropped because they carried no usable identity at all. */
  droppedInvalid: number
}

/**
 * Sanitize the persisted sequence. Dirty data is expected here (hand-edited
 * `settings.yaml`, older schema, unknown keys) so the rule is DROP, never
 * throw: every surviving entry is usable, duplicate ids get fresh ones so
 * ordering/activation stay unambiguous, and the `ego-cli` singleton keeps the
 * FIRST entry (dropping the rest and counting them for the doctor).
 */
export function sanitizeLinks(raw: unknown, max: number = MAX_TARGETS): SanitizeLinksResult {
  if (!Array.isArray(raw)) return { links: [], droppedEgoCli: 0, droppedInvalid: 0 }
  const out: BrowserLink[] = []
  const seen = new Set<string>()
  let droppedEgoCli = 0
  let droppedInvalid = 0
  let sawEgoCli = false
  for (const entry of raw) {
    const link = coerceLink(entry)
    if (!link) { droppedInvalid += 1; continue }
    if (link.kind === EGO_CLI_KIND) {
      // Local-only singleton: the machine has exactly one local ego-lite, so a
      // second entry could only fight the first over the same backend.
      if (sawEgoCli) { droppedEgoCli += 1; continue }
      sawEgoCli = true
    }
    if (seen.has(link.id)) link.id = newTargetId()
    seen.add(link.id)
    out.push(link)
    if (out.length >= max) break
  }
  return { links: out, droppedEgoCli, droppedInvalid }
}

/**
 * @deprecated R7 replaced this with `sanitizeLinks`, which also reports what it
 * dropped. Kept as a thin adapter so the R1-era tests keep asserting the same
 * list behaviour without edits.
 */
export function sanitizeTargets(raw: unknown, max: number = MAX_TARGETS): BrowserLink[] {
  return sanitizeLinks(raw, max).links
}

export function findLink(links: readonly BrowserLink[], id: string): BrowserLink | null {
  if (id === '') return null
  return links.find((link) => link.id === id) ?? null
}

/** @deprecated R7 alias of `findLink`. */
export const findTarget = findLink

/**
 * The link that currently owns the tools. A disabled entry never wins even if
 * it is still pointed at by `activeTargetId` — its id may be reactivated later
 * without being removed from the sequence.
 */
export function activeLink(links: readonly BrowserLink[], activeTargetId: string): BrowserLink | null {
  const link = findLink(links, activeTargetId)
  return link && link.enabled ? link : null
}

/** @deprecated R7 alias of `activeLink`. */
export const activeTarget = activeLink

/** Why an upsert was refused. Refusals are structured, never silent. */
export type UpsertRefusalCode = 'ego-cli-already-exists' | 'link-limit-reached' | 'unusable-row'

export type UpsertLinkResult =
  | { ok: true; links: BrowserLink[]; link: BrowserLink }
  | { ok: false; code: UpsertRefusalCode; message: string }

/**
 * Insert or replace one entry. Existing fields survive when the patch omits
 * them, so the UI can push a single-field edit without resending the row.
 *
 * Two refusals are structured rather than silent (R7):
 *  - adding a SECOND `ego-cli` entry (`ego-cli-already-exists`);
 *  - exceeding `MAX_TARGETS` (`link-limit-reached`).
 */
export function upsertLink(
  links: readonly BrowserLink[],
  // `kind` is taken from the union explicitly: intersecting the two Partial
  // shapes collapses it to `never`, which would make it impossible to add a
  // link at all.
  patch: Omit<Partial<CdpLink>, 'kind'> & Omit<Partial<EgoCliLink>, 'kind'> & { id?: string; kind?: BrowserLinkKind },
): UpsertLinkResult {
  const id = typeof patch.id === 'string' && patch.id !== '' ? patch.id : newTargetId()
  const existing = findLink(links, id)
  const merged = coerceLink({ ...(existing ?? {}), ...patch, id })
  if (!merged) {
    return { ok: false, code: 'unusable-row', message: 'row carries neither a usable CDP endpoint nor an ego-cli kind' }
  }
  if (!existing) {
    if (merged.kind === EGO_CLI_KIND && links.some((link) => link.kind === EGO_CLI_KIND)) {
      return {
        ok: false,
        code: 'ego-cli-already-exists',
        message: 'the local ego CLI link already exists — at most one is allowed per machine',
      }
    }
    if (links.length >= MAX_TARGETS) {
      return { ok: false, code: 'link-limit-reached', message: `the sequence is capped at ${MAX_TARGETS} entries` }
    }
    return { ok: true, links: [...links, merged], link: merged }
  }
  // A replaced row must not turn one kind into a second singleton either.
  if (merged.kind === EGO_CLI_KIND && links.some((link) => link.kind === EGO_CLI_KIND && link.id !== id)) {
    return {
      ok: false,
      code: 'ego-cli-already-exists',
      message: 'the local ego CLI link already exists — at most one is allowed per machine',
    }
  }
  return { ok: true, links: links.map((link) => (link.id === id ? merged : link)), link: merged }
}

export function removeTarget(links: readonly BrowserLink[], id: string): BrowserLink[] {
  return links.filter((link) => link.id !== id)
}

/**
 * Move an entry within the sequence. `delta` of -1 moves one slot up, +1 one
 * slot down; out-of-range and unknown ids return the input unchanged (the UI
 * disables those buttons, this is the second line of defense).
 */
export function moveTarget(links: readonly BrowserLink[], id: string, delta: number): BrowserLink[] {
  const index = links.findIndex((entry) => entry.id === id)
  if (index === -1) return [...links]
  const wanted = index + delta
  if (wanted < 0 || wanted >= links.length) return [...links]
  const copy = [...links]
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
  /** T2.16 — how the attach came to be, shown by the panel badge + doctor. */
  endpointSource?: 'remote' | 'local' | 'local-fallback' | 'cli' | 'cli-launch'
  /** R7 — which kind the activated entry is, so the sync decision table knows. */
  linkKind?: BrowserLinkKind
  /** R7 — `ego-cli` only: the resolved CLI path / spawn shape, for the doctor. */
  cliPath?: string
  cliShape?: string
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
  /** R7 — the CLI owns its browser; the runtime needs no endpoint. */
  | { kind: 'cli'; message: string }
  | { kind: 'error'; code: string; message: string }

export interface DecideInput {
  mode: CdpMode
  /** T2.18 — the remote switch is off (sequence preserved). */
  remoteDisabled?: boolean
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
  /** R7 — kind of the activated entry, when one is activated. */
  linkKind?: BrowserLinkKind
}

/**
 * Decide how the next `bcdp_*` call attaches.
 *
 * The rules are deliberately narrow and each branch is a VISIBLE outcome:
 *
 * - `mode=local`  → hand back to local control (explicit user choice).
 * - `ego-cli`     → the CLI owns its browser; inject nothing.
 * - no activation → error, never a silent local cold start (spec §3.2).
 * - resolved      → inject the ws URL.
 * - not resolved  → error. The ONLY path to a local browser from here is an
 *                   explicit `allowLocalFallback` AND a working launcher.
 */
export function decideAttach(input: DecideInput): AttachDecision {
  if (input.mode === 'local') {
    return { kind: 'local', message: 'local mode: using local browser control' }
  }
  // R7 — `remote` names a CDP endpoint literally, so a local CLI link under
  // that mode is a configuration mismatch. Refusing is better than quietly
  // driving a different browser than the mode promises.
  if (input.mode === 'remote' && input.linkKind === EGO_CLI_KIND) {
    return {
      kind: 'error',
      code: 'mode-kind-mismatch',
      message:
        'cdpMode=remote requires a CDP endpoint link, but the activated link is the local ego CLI. Activate a CDP link, or switch cdpMode to auto.',
    }
  }
  // R7 — an activated CLI link bypasses the endpoint table entirely: the CLI
  // resolves its own browser, and remoteEnabled (a REMOTE switch) does not
  // apply to it.
  if (input.hasActive && input.linkKind === EGO_CLI_KIND) {
    if (input.status === 'ready') return { kind: 'cli', message: input.message || 'local ego CLI ready' }
    if (input.status === 'idle' || input.status === 'probing') {
      return {
        kind: 'error',
        code: 'endpoint-unresolved',
        message: 'The local ego CLI has not been probed yet. Wait for the probe to finish and retry the call.',
      }
    }
    return {
      kind: 'error',
      code: input.code === '' ? 'cli-probe-failed' : input.code,
      message: input.message === '' ? 'the local ego CLI is not available' : input.message,
    }
  }
  if (input.remoteDisabled) {
    return {
      kind: 'error',
      code: 'remote-disabled',
      message:
        'Remote CDP is disabled by the remoteEnabled switch (the target sequence is preserved). Flip the switch back on, or set cdpMode=local to use a local browser.',
    }
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
  targets: readonly BrowserLink[]
  activeTargetId: string
  mode: CdpMode
  timeoutMs?: number
  cache?: AttachCache
  now?: () => number
  fetchVersion?: ProbeOptions['fetchVersion']
  localLauncherReady?: boolean
  /** T2.15/T2.16 — explicit local fallback (launcher M0.9). */
  fallback?: {
    enabled: boolean
    chromePath?: string
    chromeArgs?: string
    localHeadless?: boolean
    userDataDir?: string
  }
  /** T2.18 — master switch: remote attach off WITHOUT deleting the sequence. */
  remoteEnabled?: boolean
  /** Gate: only the host turns the launcher on (tests keep the short-circuit). */
  useLauncher?: boolean
  /** Injectable launcher IO for fixtures. */
  launcherIo?: unknown
  /** R7 — injectable IO for the `ego-cli` probe; the host passes the real one. */
  cliIo?: CliLinkIo
  /** R7 — ours to inject with `--sdk-path` when the link opts in. */
  sdkPath?: string
  /** R7 — bundled port used as the last-resort CLI ('' disables the fallback). */
  bundledCli?: string
}

/**
 * R7 — publish the readiness of an `ego-cli` link.
 *
 * There is no endpoint here and nothing is injected: the CLI owns its browser,
 * so the only question is whether the CLI itself can be launched and driven.
 * A CLI that answers while its backing browser is down still counts as ready —
 * the first real call cold-starts the browser, which is normal for this kind —
 * and is tagged `cli-launch` so the panel can say so instead of claiming a
 * live browser.
 */
async function refreshCliAttach(
  input: RefreshInput,
  cache: AttachCache,
  suggested: AttachState,
  link: EgoCliLink,
  now: () => number,
): Promise<AttachState> {
  const base: AttachState = {
    ...suggested,
    targetId: link.id,
    endpoint: '',
    wsUrl: '',
    linkKind: EGO_CLI_KIND,
  }
  const io = input.cliIo
  if (!io) {
    // Explicit, not silent: a host that forgot to hand over the IO must not
    // look like an unreachable browser.
    return cache.patch({
      ...base,
      status: 'unreachable',
      code: 'cli-io-missing',
      message: 'the host did not provide CLI IO for the local ego CLI link',
      resolvedAt: now(),
    })
  }
  const probe = await probeCliLink({
    cliPath: link.cliPath,
    bundled: input.bundledCli ?? '',
    useSdkPath: link.useSdkPath === true,
    sdkPath: input.sdkPath ?? '',
    timeoutMs: input.timeoutMs,
  }, io)
  if (!probe.ok) {
    return cache.patch({
      ...base,
      status: 'unreachable',
      code: probe.code,
      message: probe.message,
      cliPath: probe.cliPath,
      cliShape: probe.shape,
      latencyMs: probe.latencyMs,
      resolvedAt: now(),
    })
  }
  const coldStart = probe.running === false
  return cache.patch({
    ...base,
    status: 'ready',
    endpointSource: coldStart ? 'cli-launch' : 'cli',
    code: '',
    message: probe.warning ?? (coldStart
      ? 'local ego CLI reachable; the backing browser is not running yet and will start on the first call'
      : 'local ego CLI ready'),
    cliPath: probe.cliPath,
    cliShape: probe.shape,
    latencyMs: probe.latencyMs,
    resolvedAt: now(),
  })
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
    // 2b completion (T2.12): local mode uses the MANAGED launcher — the
    // vendored runtime then ATTACHES to it instead of cold-starting its own.
    if (input.useLauncher) {
      const launch = await launchLocalBrowser({
        chromePath: input.fallback?.chromePath,
        chromeArgs: input.fallback?.chromeArgs,
        localHeadless: input.fallback?.localHeadless,
        userDataDir: input.fallback?.userDataDir,
      }, input.launcherIo as never)
      if (launch.ok) {
        const localProbe = await probeEndpoint(launch.endpoint, { timeoutMs: input.timeoutMs, now })
        if (localProbe.ok && localProbe.wsUrl) {
          return cache.patch({
            ...suggested,
            status: 'ready',
            endpoint: launch.endpoint,
            wsUrl: localProbe.wsUrl,
            code: '',
            message: launch.reused ? 'local mode: reused managed browser' : 'local mode: managed browser launched',
            latencyMs: localProbe.latencyMs,
            endpointSource: 'local',
          })
        }
        return cache.patch({
          ...suggested,
          status: 'unreachable',
          code: 'local-launch-not-ready',
          message: `managed local browser launched but its endpoint did not answer: ${localProbe.message}`,
        })
      }
      return cache.patch({
        ...suggested,
        status: 'unreachable',
        code: `local-${launch.code}`,
        message: launch.message,
      })
    }
    return cache.patch(suggested)
  }
  const target = activeLink(input.targets, input.activeTargetId)
  if (!target) {
    // T2.18 vs R7 — with the remote switch off AND nothing activated, saying
    // "remote is disabled" is the more actionable of the two truths; the
    // sequence is intact and flipping the switch back is the fix.
    return cache.patch({
      ...suggested,
      status: 'no-active',
      targetId: input.activeTargetId,
      endpoint: '',
      wsUrl: '',
      code: input.remoteEnabled === false ? 'remote-disabled' : 'no-active-target',
      message: input.remoteEnabled === false
        ? 'remote CDP is disabled by the remoteEnabled switch; the target sequence is preserved and can be re-enabled at any time'
        : 'no activated target in the sequence',
      resolvedAt: now(),
    })
  }
  // T2.18 — the remote switch is off: the sequence is INERT but preserved.
  // R7 — it gates REMOTE attach only, so a local `ego-cli` link is unaffected:
  // it is not a remote connection and has nothing to probe over the network.
  if (input.remoteEnabled === false && target.kind !== EGO_CLI_KIND) {
    return cache.patch({
      ...suggested,
      status: 'no-active',
      targetId: input.activeTargetId,
      endpoint: '',
      wsUrl: '',
      code: 'remote-disabled',
      message: 'remote CDP is disabled by the remoteEnabled switch; the target sequence is preserved and can be re-enabled at any time',
      resolvedAt: now(),
    })
  }

  // ── R7: `ego-cli` has no endpoint to probe ──────────────────────────────
  // Readiness comes from the CLI itself, and nothing is injected: the CLI owns
  // its browser. Handled before the endpoint path so the two kinds never share
  // a probe branch.
  if (target.kind === EGO_CLI_KIND) {
    return refreshCliAttach(input, cache, suggested, target, now)
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
  // T2.16 — the ONLY path from a dead remote endpoint to a local browser:
  // explicit allowLocalFallback AND the M0.9 launcher. Launch, then probe the
  // local endpoint like any other; mark the source so the panel/doctor can
  // show 「本地启动（远端不可达）」. Reverse fallback is forbidden by design.
  if (input.fallback?.enabled) {
    const launch = await launchLocalBrowser({
      chromePath: input.fallback.chromePath,
      chromeArgs: input.fallback.chromeArgs,
      localHeadless: input.fallback.localHeadless,
      userDataDir: input.fallback.userDataDir,
    })
    if (launch.ok) {
      const localProbe = await probeEndpoint(launch.endpoint, { timeoutMs: input.timeoutMs, now })
      if (localProbe.ok && localProbe.wsUrl) {
        return cache.patch({
          status: 'ready',
          wsUrl: localProbe.wsUrl,
          endpoint: launch.endpoint,
          code: '',
          message: 'local fallback launched (activated endpoint unreachable)',
          latencyMs: localProbe.latencyMs,
          resolvedAt: now(),
          endpointSource: 'local-fallback',
        })
      }
      await stopLocalBrowser()
      return cache.patch({
        status: 'unreachable',
        wsUrl: '',
        code: 'local-launch-not-ready',
        message: `local fallback browser launched but its endpoint did not answer: ${localProbe.message}`,
        latencyMs: outcome.latencyMs,
        resolvedAt: now(),
      })
    }
    return cache.patch({
      status: 'unreachable',
      wsUrl: '',
      code: `local-${launch.code}`,
      message: launch.message,
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
