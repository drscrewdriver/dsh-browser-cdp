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

import type { BrowserLink, BrowserLinkKind, CdpLink, CdpMode, EgoCliLink, LightpandaLink } from './types.ts'
import { discoverWebSocketUrl, normalizeEndpoint, type CdpErrorCode } from './cdp/endpoint.ts'
import { engineOf, type EngineId } from './cdp/capabilities.ts'
import { launchLocalBrowser } from './cdp/launcher.ts'
import type { CliLinkIo } from './cdp/cli-link.ts'
// Runtime registry (R1): the per-kind readiness logic lives behind this lookup,
// so this module keeps exactly ONE place that knows a link kind can differ.
import { runtimeOf } from './runtime/backend-runtime.ts'
// Re-exported so hosts/tests can ask the same registry this module dispatches
// through, without importing the runtime layer directly.
export { runtimeOf, runtimeOfLink, allRuntimes } from './runtime/backend-runtime.ts'

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

/**
 * Tabbit CLI backend (P0-3/P0-4, cdp-tabbit-bridge).
 * Same singleton + never-stop rules as ego-cli: Tabbit owns its browser lifecycle.
 */
export const TABBIT_CLI_KIND = 'tabbit-cli'

/** Default panel label for a tabbit-cli link. */
export const TABBIT_CLI_LABEL = 'Tabbit 浏览器'

/**
 * Lightpanda backend — the managed-serve link kind (headless quick-trial
 * engine; headed kinds are the manual-fallback backstop). Local-only
 * singleton, same rules as `ego-cli`.
 */
export const LP_KIND = 'lightpanda'

/** Default panel label for a lightpanda link. */
export const LP_LABEL = 'Lightpanda（受管）'

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
      // ALWAYS ON (v1.7.1-rc.5): the native ego CLI has no `taskSpaces`
      // facade, so without the bundled harness every bcdp_* call dies on
      // line 1 (`taskSpaces is not defined`) — an OFF state with no valid
      // outcome. The field stays in the row shape for read-compat with old
      // profiles, but a stored `false` is healed to `true` here; CLIs that
      // reject `--sdk-path` are still auto-detected by the probe (R-1 guard
      // drops the injection with a warning), so nothing needs opting out of.
      useSdkPath: true,
    }
  }
  if (rec.kind === LP_KIND) {
    const servePath = typeof rec.servePath === 'string' ? rec.servePath.trim() : ''
    return {
      ...base,
      kind: LP_KIND,
      label: label === '' ? LP_LABEL : label,
      servePath,
    }
  }
  if (rec.kind === TABBIT_CLI_KIND) {
    const cliPath = typeof rec.cliPath === 'string' ? rec.cliPath.trim() : ''
    return {
      ...base,
      kind: TABBIT_CLI_KIND,
      label: label === '' ? TABBIT_CLI_LABEL : label,
      cliPath,
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
  /** Lightpanda backend — extra `lightpanda` rows dropped to honour the local-only singleton. */
  droppedLightpanda: number
  /** Tabbit bridge — extra `tabbit-cli` rows dropped to honour the local-only singleton. */
  droppedTabbitCli: number
  /** Entries dropped because they carried no usable identity at all. */
  droppedInvalid: number
}

/**
 * Sanitize the persisted sequence. Dirty data is expected here (a hand-edited
 * profile config on the settings page, older schema, unknown keys) so the rule
 * is DROP, never throw: every surviving entry is usable, duplicate ids get
 * fresh ones so ordering/activation stay unambiguous, and the `ego-cli` /
 * `lightpanda` singletons keep the FIRST entry of their kind (dropping the
 * rest and counting them for the doctor).
 */
export function sanitizeLinks(raw: unknown, max: number = MAX_TARGETS): SanitizeLinksResult {
  if (!Array.isArray(raw)) return { links: [], droppedEgoCli: 0, droppedLightpanda: 0, droppedTabbitCli: 0, droppedInvalid: 0 }
  const out: BrowserLink[] = []
  const seen = new Set<string>()
  let droppedEgoCli = 0
  let droppedLightpanda = 0
  let droppedTabbitCli = 0
  let droppedInvalid = 0
  let sawEgoCli = false
  let sawLightpanda = false
  let sawTabbitCli = false
  for (const entry of raw) {
    const link = coerceLink(entry)
    if (!link) { droppedInvalid += 1; continue }
    if (link.kind === EGO_CLI_KIND) {
      // Local-only singleton: the machine has exactly one local ego browser, so a
      // second entry could only fight the first over the same backend.
      if (sawEgoCli) { droppedEgoCli += 1; continue }
      sawEgoCli = true
    }
    if (link.kind === LP_KIND) {
      // Same local-only singleton rule: one machine, one managed Lightpanda.
      if (sawLightpanda) { droppedLightpanda += 1; continue }
      sawLightpanda = true
    }
    if (link.kind === TABBIT_CLI_KIND) {
      // Local-only singleton: one machine, one Tabbit browser.
      if (sawTabbitCli) { droppedTabbitCli += 1; continue }
      sawTabbitCli = true
    }
    if (seen.has(link.id)) link.id = newTargetId()
    seen.add(link.id)
    out.push(link)
    if (out.length >= max) break
  }
  return { links: out, droppedEgoCli, droppedLightpanda, droppedTabbitCli, droppedInvalid }
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
  // Defensive: an absent/empty link list means "nothing resolves", never a
  // crash. `resolveEffectiveLink` now runs on every tool call and on the frame
  // poller, so a partial config (or a test mock without `links`) must degrade to
  // null instead of throwing inside `.find`.
  if (!Array.isArray(links) || links.length === 0) return null
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

export interface EffectiveLink {
  link: BrowserLink
  /**
   * Why this link owns routing. `priority-fallback` is surfaced by the owner
   * log and the doctor so a takeover is visible, never silent.
   */
  reason: 'activated' | 'priority-fallback'
  /** The activated entry the fallback stepped over (disabled or removed). */
  demotedId?: string
}

/**
 * The link that owns routing RIGHT NOW — re-derived on every links event
 * (enable/activation toggle, reorder, add, remove).
 *
 * Activation wins while it is usable. The moment an event leaves
 * `activeTargetId` pointing at a disabled or missing entry, the FIRST enabled
 * link in sequence order takes over — the sequence order IS the priority
 * order. An EMPTY activation stays "nothing activated" (explicit off) instead
 * of silently adopting a link the user never activated.
 */
export function resolveEffectiveLink(links: readonly BrowserLink[], activeTargetId: string): EffectiveLink | null {
  if (activeTargetId === '') return null
  // Same defensive rule as findLink: no link list means no routing decision to
  // make. This runs on every tool call and on the frame poller now, so a partial
  // config must not throw out of the tool path.
  if (!Array.isArray(links) || links.length === 0) return null
  const activated = findLink(links, activeTargetId)
  if (activated && activated.enabled) return { link: activated, reason: 'activated' }
  const fallback = links.find((link) => link.enabled)
  if (!fallback) return null
  return { link: fallback, reason: 'priority-fallback', demotedId: activeTargetId }
}

/**
 * True when an attach cache row describes THIS link (same id, and for a cdp
 * link the same endpoint string). After a links event the async refresh may
 * still be probing the new owner; a cache row describing the PREVIOUS owner
 * must not leak its linkKind/cliPath/wsUrl into the new channel's decisions —
 * that leak is how a deactivated ego-cli kept driving every bcdp_* call.
 */
export function attachMatchesLink(attach: AttachState, link: BrowserLink): boolean {
  if (attach.targetId !== link.id) return false
  return link.kind !== 'cdp' || attach.endpoint === link.endpoint
}

/** Why an upsert was refused. Refusals are structured, never silent. */
export type UpsertRefusalCode = 'ego-cli-already-exists' | 'lightpanda-already-exists' | 'link-limit-reached' | 'unusable-row'

export type UpsertLinkResult =
  | { ok: true; links: BrowserLink[]; link: BrowserLink }
  | { ok: false; code: UpsertRefusalCode; message: string }

/**
 * Insert or replace one entry. Existing fields survive when the patch omits
 * them, so the UI can push a single-field edit without resending the row.
 *
 * Refusals are structured rather than silent (R7):
 *  - adding a SECOND `ego-cli` / `lightpanda` entry (local-only singletons);
 *  - exceeding `MAX_TARGETS` (`link-limit-reached`).
 */
export function upsertLink(
  links: readonly BrowserLink[],
  // `kind` is taken from the union explicitly: intersecting the two Partial
  // shapes collapses it to `never`, which would make it impossible to add a
  // link at all.
  patch: Omit<Partial<CdpLink>, 'kind'> & Omit<Partial<EgoCliLink>, 'kind'> & Omit<Partial<LightpandaLink>, 'kind'> & { id?: string; kind?: BrowserLinkKind },
): UpsertLinkResult {
  const id = typeof patch.id === 'string' && patch.id !== '' ? patch.id : newTargetId()
  const existing = findLink(links, id)
  const merged = coerceLink({ ...(existing ?? {}), ...patch, id })
  if (!merged) {
    return { ok: false, code: 'unusable-row', message: 'row carries neither a usable CDP endpoint nor a singleton kind' }
  }
  if (!existing) {
    if (merged.kind === EGO_CLI_KIND && links.some((link) => link.kind === EGO_CLI_KIND)) {
      return {
        ok: false,
        code: 'ego-cli-already-exists',
        message: 'the local ego CLI link already exists — at most one is allowed per machine',
      }
    }
    if (merged.kind === LP_KIND && links.some((link) => link.kind === LP_KIND)) {
      return {
        ok: false,
        code: 'lightpanda-already-exists',
        message: 'the Lightpanda link already exists — at most one managed serve is allowed per machine',
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
  if (merged.kind === LP_KIND && links.some((link) => link.kind === LP_KIND && link.id !== id)) {
    return {
      ok: false,
      code: 'lightpanda-already-exists',
      message: 'the Lightpanda link already exists — at most one managed serve is allowed per machine',
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
  /** Lightpanda backend — engine recognized from the discovery `Browser` field, success only. */
  engine?: EngineId
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
 * page's per-target probe already speaks — its codes are contract, so they are
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
  return { ok: true, code: 'ok', message: '', wsUrl: result.wsUrl, engine: engineOf(result.browser), latencyMs: result.latencyMs }
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
  endpointSource?: 'remote' | 'local' | 'local-launch' | 'local-fallback' | 'cli' | 'cli-launch'
  /** R7 — which kind the activated entry is, so the sync decision table knows. */
  linkKind?: BrowserLinkKind
  /**
   * True when this channel owns its browser (local CLI, managed serve). The
   * attach decision uses it instead of comparing kinds: "owns the browser" is
   * the property that changes the answer, and it is the runtime's to declare.
   */
  ownsBrowser?: boolean
  /** Lightpanda backend — engine of the attached endpoint (badge + doctor + worker env). Absent = unrecognized. */
  engine?: EngineId
  /** R7 — `ego-cli` only: the resolved CLI path / spawn shape, for the doctor. */
  cliPath?: string
  cliShape?: string
  /**
   * R1 — `ego-cli` only: the harness path to inject with `--sdk-path` on every
   * tool run. `''`/absent = do not inject (vendored runtime or a CLI that
   * rejected the flag during probing). See the guard in `refreshCliAttach`.
   */
  sdkPath?: string
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
  /**
   * Runtime facts about the activated link (never a link kind). `ownsBrowser`
   * plus `injectsEndpoint` is enough to answer every branch below, which is why
   * this table no longer compares kinds.
   */
  ownsBrowser?: boolean
  /** The channel hands over a wsUrl for injection (cdp / managed serve). */
  injectsEndpoint?: boolean
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
  // `remote` names a NETWORK endpoint literally, so a browser-owning channel
  // under that mode is a configuration mismatch. Refusing is better than
  // quietly driving a different browser than the mode promises.
  if (input.mode === 'remote' && input.ownsBrowser === true) {
    return {
      kind: 'error',
      code: 'mode-kind-mismatch',
      message: 'cdpMode=remote requires a CDP endpoint link, but the activated link owns its browser (a CLI or a managed serve). Activate a CDP link, or switch cdpMode to auto.',
    }
  }
  // A browser-owning channel that hands over NOTHING to inject: the CLI drives
  // its own browser, so `remoteEnabled` (a REMOTE switch) does not apply to it.
  if (input.hasActive && input.ownsBrowser === true && input.injectsEndpoint !== true) {
    if (input.status === 'ready') return { kind: 'cli', message: input.message || 'the activated CLI link is ready' }
    if (input.status === 'idle' || input.status === 'probing') {
      return {
        kind: 'error',
        code: 'endpoint-unresolved',
        message: 'The activated CLI link has not been probed yet. Wait for the probe to finish and retry the call.',
      }
    }
    return {
      kind: 'error',
      code: input.code === '' ? 'cli-probe-failed' : input.code,
      message: input.message === '' ? 'the activated CLI link is not available' : input.message,
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
  /**
   * Config gate `allowProbeColdStart` (default false): when false the ego-cli
   * probe must not cold-start the backing browser — the heredoc round-trip is
   * skipped unless `--status` proved the browser already up. Undefined = the
   * probe decides (and its own default allows the cold start, keeping the
   * fixtures' historical behaviour).
   */
  cliProbeColdStart?: boolean
  /** Lightpanda backend — extra `lightpanda serve` args (config knob), filtered by the launcher. */
  lightpandaArgs?: string
  /**
   * Tabbit bridge — how the host answers "is the tabbit CLI usable right now".
   *
   * Injected rather than imported so this module stays host-free: resolving the
   * CLI touches the filesystem/PATH, which is the host's business. The probe is
   * **existence-only on purpose** — `tabbit-cli diagnose` may cold-start the
   * backing browser (its spawn comment says so), so it must not run on mount.
   * Absent callback = legacy behaviour (assume ready), which keeps fixtures that
   * never configure a tabbit link unchanged.
   */
  tabbitProbe?: (link: Extract<BrowserLink, { kind: typeof TABBIT_CLI_KIND }>) => {
    ok: boolean
    cliPath?: string
    code?: string
    message?: string
  }
}

/*
 * The per-kind probe bodies (ego-cli / lightpanda / tabbit) used to live here.
 * They now live in src/runtime/<kind>-runtime.ts and are reached through
 * `runtimeOf(kind)` below — this module no longer switches on a link kind.
 */

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
  // Clean base per pass: every routing field (linkKind / cliPath / cliShape /
  // sdkPath / endpointSource / engine) is re-derived from the link that wins
  // THIS pass. Spreading `previous` here is how a deactivated ego-cli poisoned
  // every later attach — its kind fields stuck until the next remount.
  // The resets are OWN KEYS set to undefined/'' on purpose: cache.patch()
  // MERGES into the live state, so an absent key would let the previous
  // owner's value survive the patch.
  const suggested: AttachState = {
    ...emptyAttachState(),
    mode: input.mode,
    status: input.mode === 'local' ? 'local' : 'idle',
    linkKind: undefined,
    cliPath: undefined,
    cliShape: undefined,
    sdkPath: '',
    endpointSource: undefined,
    engine: undefined,
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
            engine: localProbe.engine,
            code: '',
            message: launch.reused ? 'local mode: reused managed browser' : 'local mode: managed browser launched',
            latencyMs: localProbe.latencyMs,
            endpointSource: 'local',
          })
        }
        return cache.patch({
          ...suggested,
          status: 'unreachable',
          engine: undefined,
          code: 'local-launch-not-ready',
          message: `managed local browser launched but its endpoint did not answer: ${localProbe.message}`,
        })
      }
      return cache.patch({
        ...suggested,
        status: 'unreachable',
        engine: undefined,
        code: `local-${launch.code}`,
        message: launch.message,
      })
    }
    return cache.patch(suggested)
  }
  const effective = resolveEffectiveLink(input.targets, input.activeTargetId)
  const target = effective?.link ?? null
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
        : input.activeTargetId === ''
          ? 'no activated target in the sequence'
          : 'the activated entry is disabled or gone and no enabled link can take over; enable a link, activate one, or set cdpMode=local',
      resolvedAt: now(),
    })
  }
  // One lookup replaces the kind ladder that used to live here. The remote
  // switch gates NETWORK endpoints only: a local CLI or a managed serve is not
  // a remote connection and has nothing to probe over the wire — that rule now
  // rides on the runtime's `localOnly` flag instead of a `kind` comparison.
  const runtime = runtimeOf(target.kind)
  if (!runtime) {
    return cache.patch({
      ...suggested,
      status: 'unreachable',
      targetId: target.id,
      endpoint: '',
      wsUrl: '',
      code: 'unknown-link-kind',
      message: `no runtime is registered for link kind "${String(target.kind)}"`,
      resolvedAt: now(),
    })
  }
  if (input.remoteEnabled === false && !runtime.localOnly) {
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
  return runtime.probe({ input, cache, suggested, link: target, now })
}
