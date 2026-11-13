/**
 * src/runtime/cdp-runtime.ts — a plain CDP endpoint (local port, remote proxy,
 * or anything that answers `/json/version`).
 *
 * Behaviour moved verbatim out of `refreshAttach`: probe the endpoint, and on
 * failure take the local launcher ONLY when the operator explicitly enabled
 * `allowLocalFallback`. The reverse path (local → remote) does not exist.
 */

import type { AttachState } from '../cdp-targets.ts'
import { probeEndpoint } from '../cdp-targets.ts'
import { launchLocalBrowser, stopLocalBrowser } from '../cdp/launcher.ts'
import type { BackendRuntime, ProbeContext } from './backend-runtime.ts'

async function probe({ input, cache, suggested, link, now }: ProbeContext): Promise<AttachState> {
  if (link.kind !== 'cdp') {
    // Unreachable by construction (the registry keys on kind); failing loudly
    // beats silently probing the wrong shape.
    return cache.patch({ ...suggested, status: 'unreachable', code: 'runtime-kind-mismatch', message: 'cdp runtime received a non-cdp link', resolvedAt: now() })
  }
  const previous = cache.get()
  const sameTarget = previous.targetId === link.id && previous.endpoint === link.endpoint
  const suggestedProbe: AttachState = {
    ...suggested,
    targetId: link.id,
    endpoint: link.endpoint,
    status: 'probing',
    code: '',
    message: '',
    wsUrl: sameTarget ? previous.wsUrl : '',
    latencyMs: sameTarget ? previous.latencyMs : 0,
    ownsBrowser: false,
  }
  cache.patch(suggestedProbe)
  const outcome = await probeEndpoint(link.endpoint, {
    timeoutMs: input.timeoutMs,
    now,
    ...(input.fetchVersion ? { fetchVersion: input.fetchVersion } : {}),
  })
  if (outcome.ok && outcome.wsUrl) {
    return cache.patch({
      status: 'ready',
      wsUrl: outcome.wsUrl,
      engine: outcome.engine,
      endpointSource: 'remote',
      code: '',
      message: '',
      latencyMs: outcome.latencyMs,
      resolvedAt: now(),
    })
  }
  // The ONLY path from a dead remote endpoint to a local browser: explicit
  // allowLocalFallback AND a working launcher. Mark the source so the panel and
  // the doctor can say 「本地启动（远端不可达）」 instead of pretending the
  // endpoint answered.
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
          engine: localProbe.engine,
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
        engine: undefined,
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
    engine: outcome.ok ? outcome.engine : undefined,
    code: outcome.code,
    message: outcome.message,
    latencyMs: outcome.latencyMs,
    resolvedAt: now(),
  })
}

export const cdpRuntime: BackendRuntime = {
  kind: 'cdp',
  probe,
  localOnly: false,
  ownsUserBrowser: false,
  usesCdpWorker: true,
  injectsEndpoint: true,
  channel: { frames: 'cdp-worker', tabbitInventory: false, egoRuntime: true, panelActions: false },
}