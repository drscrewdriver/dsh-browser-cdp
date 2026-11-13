/**
 * src/runtime/backend-runtime.ts — the object a "link" becomes once activated.
 *
 * Before this file, ONE question ("is the activated backend usable, and how does
 * a call attach to it") was answered by five separate `kind ===` ladders: the
 * attach probe, the attach decision, the tool dispatcher, the capture-channel
 * gate, and each poller. Every new channel had to be added in all five, and
 * missing one produced a silent half-working channel (tabbit reported `ready`
 * without ever looking at the CLI; the remote CDP worker returned a capture
 * lease as if it were the foreground tab).
 *
 * The runtime is a thin, uniform face over those differences:
 *
 *   probe()    — publish readiness into the attach cache. The ONLY place that
 *                may touch the backend with side effects, which is why the
 *                cold-start gate lives here (see spec "冷启动分级表").
 *   ...capability flags — what the caller may assume without switching on kind.
 *
 * Deliberately a plain object, not a class hierarchy: the four implementations
 * share no state, and a registry lookup is easier to reason about than
 * prototype chains in a hot path that also runs inside tests.
 *
 * Import direction: runtimes import `../cdp-targets.ts` for types and pure
 * helpers; `cdp-targets.ts` imports this module only to dispatch. The cycle that
 * creates is safe because nothing here is dereferenced at module-init time —
 * `kind` and the flags are literals, and the imported helpers are called later.
 */

import type { AttachCache, AttachState, RefreshInput } from '../cdp-targets.ts'
import type { BrowserLink, BrowserLinkKind } from '../types.ts'
import { cdpRuntime } from './cdp-runtime.ts'
import { egoCliRuntime } from './ego-cli-runtime.ts'
import { lightpandaRuntime } from './lightpanda-runtime.ts'
import { tabbitRuntime } from './tabbit-runtime.ts'

/** One tool invocation routed through a runtime's own protocol. */
export interface ExecRequest {
  /** Tool name without transport concerns (e.g. `bcdp_snapshot`). */
  tool: string
  args: Record<string, unknown>
  /**
   * Ownership token for backends that scope resources per task (tabbit). The
   * caller derives it from the session; the runtime never invents one.
   */
  task: string
}

/** Everything one probe pass needs. Mirrors the old free-function signature. */
export interface ProbeContext {
  input: RefreshInput
  cache: AttachCache
  /** The clean per-pass base (see the reset rules in refreshAttach). */
  suggested: AttachState
  link: BrowserLink
  now: () => number
}

export interface BackendRuntime {
  readonly kind: BrowserLinkKind
  /** Publish readiness for `ctx.link`. May have side effects (launch/probe). */
  probe(ctx: ProbeContext): Promise<AttachState>
  /**
   * OPERATION face: run one tool against this backend.
   *
   * Only channels that do not go through the ego runtime implement it; the
   * others return null so the caller falls through to the shared tool path.
   * The body is injected by the host (`setTabbitExecutor`) because it needs the
   * calling session, the subprocess service and the snippet builders — what
   * matters structurally is that the CALLER asks the runtime instead of naming
   * a vendor, so adding a channel does not add a branch at every call site.
   */
  exec?(req: ExecRequest): Promise<unknown | null>
  /**
   * True for channels that are NOT a network endpoint the user could reach
   * from another machine (local CLI / managed serve). `remoteEnabled` is a
   * REMOTE switch and must not gate them.
   */
  readonly localOnly: boolean
  /** The backend owns the user's own daily browser: never send `--stop`. */
  readonly ownsUserBrowser: boolean
  /** Frames come from the CDP screencast worker (false = host-side poller). */
  readonly usesCdpWorker: boolean
  /** A resolved wsUrl must be injected as EGO_LINUX_CDP_URL for tool runs. */
  readonly injectsEndpoint: boolean
  /**
   * WHICH MECHANISM this channel needs, so callers can act without naming a
   * vendor. This is the one object the host half is allowed to branch on; it is
   * a capability descriptor, not a kind: two channels can share a mechanism and
   * a new channel only has to declare the same facts.
   */
  readonly channel: {
    /** Where panel frames come from. */
    frames: 'cdp-worker' | 'ego-cli-poll' | 'tabbit-poll'
    /** Needs the tabbit tab-inventory poller (ownership is per task). */
    tabbitInventory: boolean
    /** Spawns the vendored ego runtime for tool calls. */
    egoRuntime: boolean
    /** Panel raise/switch goes through the injected panelActions runner. */
    panelActions: boolean
  }
}

const RUNTIMES: readonly BackendRuntime[] = [cdpRuntime, egoCliRuntime, lightpandaRuntime, tabbitRuntime]

/** The runtime for a link kind, or null for an unknown kind (never throws). */
export function runtimeOf(kind: BrowserLinkKind | string | undefined): BackendRuntime | null {
  if (kind === undefined) return null
  return RUNTIMES.find((runtime) => runtime.kind === kind) ?? null
}

/**
 * The runtime for a link, or null. Callers that already hold a link should use
 * this instead of naming a kind, so the type check still applies.
 */
export function runtimeOfLink(link: BrowserLink | null | undefined): BackendRuntime | null {
  return link ? runtimeOf(link.kind) : null
}

/** Every runtime, for doctors/tests that must stay exhaustive. */
export function allRuntimes(): readonly BackendRuntime[] {
  return RUNTIMES
}