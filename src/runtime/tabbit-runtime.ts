/**
 * src/runtime/tabbit-runtime.ts — the Tabbit CLI backend.
 *
 * Two things are deliberately NOT done here:
 *   - no `tabbit-cli diagnose` on mount. Its spawn comment says it may
 *     cold-start the backing browser, so probing readiness with it would pop a
 *     window on a settings change. Readiness is "the CLI exists"; whether the
 *     browser is up is answered by an explicit `refresh:true`.
 *   - no task creation. Tab ownership is per task and the owner belongs to a
 *     session, which this layer does not have.
 *
 * NOTE: `exec` (the tabbit tool dispatcher) still lives in the host half
 * (`tryTabbitExecute` in index.ts) because it needs the calling session, the
 * subprocess service and the snippet builders. It is routed through
 * `runtimeOf(link.kind)` at the call site, so no new kind ladder is introduced;
 * moving the body here is the remaining step of P3 (tracked as t26).
 */

import type { AttachState } from '../cdp-targets.ts'
import type { BackendRuntime, ExecRequest, ProbeContext } from './backend-runtime.ts'

/**
 * The tool dispatcher body, injected by the host half.
 *
 * It needs the calling session, the subprocess service and the snippet builders,
 * none of which belong to a readiness layer — but keeping it behind the runtime
 * is what lets call sites ask "run this on the activated backend" instead of
 * "is the activated backend tabbit?".
 */
type TabbitExecutor = (req: ExecRequest) => Promise<unknown | null>
let executor: TabbitExecutor | null = null

/** Register (or clear, with null) the host's tabbit tool dispatcher. */
export function setTabbitExecutor(fn: TabbitExecutor | null): void {
  executor = fn
}

async function probe({ input, cache, suggested, link, now }: ProbeContext): Promise<AttachState> {
  if (link.kind !== 'tabbit-cli') {
    return cache.patch({ ...suggested, status: 'unreachable', code: 'runtime-kind-mismatch', message: 'tabbit runtime received a non-tabbit link', resolvedAt: now() })
  }
  const base: AttachState = {
    ...suggested,
    targetId: link.id,
    linkKind: 'tabbit-cli',
    ownsBrowser: true,
  }
  const probeResult = input.tabbitProbe?.(link)
  if (probeResult === undefined) {
    // No host callback (fixtures, or a host build that predates the seam): keep
    // the historical assumption instead of inventing a failure.
    cache.patch({ ...base, status: 'ready', code: '', message: 'tabbit-cli ready', resolvedAt: now() })
    return cache.get()
  }
  return cache.patch({
    ...base,
    status: probeResult.ok ? 'ready' : 'unreachable',
    code: probeResult.ok ? '' : probeResult.code ?? 'tabbit-cli-missing',
    message: probeResult.ok ? 'tabbit-cli ready' : probeResult.message ?? 'the tabbit CLI is not available',
    cliPath: probeResult.cliPath,
    endpointSource: probeResult.ok ? 'cli' : undefined,
    resolvedAt: now(),
  })
}

export const tabbitRuntime: BackendRuntime = {
  kind: 'tabbit-cli',
  probe,
  exec: (req) => (executor === null ? Promise.resolve(null) : executor(req)),
  localOnly: true,
  ownsUserBrowser: true,
  usesCdpWorker: false,
  injectsEndpoint: false,
  channel: { frames: 'tabbit-poll', tabbitInventory: true, egoRuntime: false, panelActions: false },
}