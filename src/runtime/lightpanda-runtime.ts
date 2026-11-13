/**
 * src/runtime/lightpanda-runtime.ts — the managed Lightpanda serve.
 *
 * The launcher owns launch/reuse/exclusivity (a live managed Chrome loses the
 * singleton slot to the serve and vice versa); `engine` is stamped from the ROW
 * — the source the user picked — and `/json/version`'s `Browser: Lightpanda/…`
 * merely re-confirms it. Unlike the CLIs, this channel DOES inject a wsUrl, so
 * the tool runtime reaches it like any other endpoint.
 */

import type { AttachState } from '../cdp-targets.ts'
import { probeEndpoint } from '../cdp-targets.ts'
import { launchLocalBrowser } from '../cdp/launcher.ts'
import type { BackendRuntime, ProbeContext } from './backend-runtime.ts'

async function probe({ input, cache, suggested, link, now }: ProbeContext): Promise<AttachState> {
  if (link.kind !== 'lightpanda') {
    return cache.patch({ ...suggested, status: 'unreachable', code: 'runtime-kind-mismatch', message: 'lightpanda runtime received a non-lightpanda link', resolvedAt: now() })
  }
  const base: AttachState = {
    ...suggested,
    targetId: link.id,
    endpoint: '',
    wsUrl: '',
    linkKind: 'lightpanda',
    ownsBrowser: true,
  }
  const launch = await launchLocalBrowser({
    engine: 'lightpanda',
    lightpandaPath: link.servePath ?? '',
    lightpandaArgs: input.lightpandaArgs,
  }, input.launcherIo as never)
  if (!launch.ok) {
    return cache.patch({
      ...base,
      status: 'unreachable',
      code: launch.code,
      message: launch.message,
      resolvedAt: now(),
    })
  }
  const probeResult = await probeEndpoint(launch.endpoint, { timeoutMs: input.timeoutMs, now })
  return cache.patch({
    ...base,
    status: probeResult.ok && probeResult.wsUrl ? 'ready' : 'unreachable',
    endpoint: launch.endpoint,
    wsUrl: probeResult.wsUrl ?? '',
    engine: 'lightpanda',
    code: probeResult.ok ? '' : probeResult.code,
    message: probeResult.ok
      ? launch.reused
        ? 'lightpanda serve reused'
        : 'lightpanda serve launched'
      : `lightpanda serve is up but its endpoint did not answer: ${probeResult.message}`,
    latencyMs: probeResult.latencyMs,
    resolvedAt: now(),
    endpointSource: launch.reused ? 'local' : 'local-launch',
  })
}

export const lightpandaRuntime: BackendRuntime = {
  kind: 'lightpanda',
  probe,
  // Local managed serve, but it DOES hand over a wsUrl for injection — which is
  // exactly the distinction the old `kind` ladders kept re-deriving.
  localOnly: true,
  ownsUserBrowser: false,
  usesCdpWorker: true,
  injectsEndpoint: true,
  channel: { frames: 'cdp-worker', tabbitInventory: false, egoRuntime: true, panelActions: false },
}