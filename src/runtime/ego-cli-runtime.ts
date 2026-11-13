/**
 * src/runtime/ego-cli-runtime.ts — the LOCAL ego CLI, which owns its browser.
 *
 * Nothing is injected and there is no endpoint to probe: readiness is "can the
 * CLI be launched and driven". A CLI that answers while its backing browser is
 * down still counts as ready — the first real call cold-starts the browser,
 * which is normal for this kind — and is tagged `cli-launch` so the panel says
 * so instead of claiming a live browser.
 */

import type { AttachState } from '../cdp-targets.ts'
import { probeCliLink } from '../cdp/cli-link.ts'
import type { BackendRuntime, ProbeContext } from './backend-runtime.ts'

async function probe({ input, cache, suggested, link, now }: ProbeContext): Promise<AttachState> {
  if (link.kind !== 'ego-cli') {
    return cache.patch({ ...suggested, status: 'unreachable', code: 'runtime-kind-mismatch', message: 'ego-cli runtime received a non-ego-cli link', resolvedAt: now() })
  }
  const base: AttachState = {
    ...suggested,
    targetId: link.id,
    endpoint: '',
    wsUrl: '',
    linkKind: 'ego-cli',
    ownsBrowser: true,
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
  const probeResult = await probeCliLink({
    cliPath: link.cliPath,
    bundled: input.bundledCli ?? '',
    useSdkPath: link.useSdkPath === true,
    sdkPath: input.sdkPath ?? '',
    timeoutMs: input.timeoutMs,
    coldStart: input.cliProbeColdStart,
  }, io)
  if (!probeResult.ok) {
    return cache.patch({
      ...base,
      status: 'unreachable',
      code: probeResult.code,
      message: probeResult.message,
      cliPath: probeResult.cliPath,
      cliShape: probeResult.shape,
      latencyMs: probeResult.latencyMs,
      resolvedAt: now(),
    })
  }
  const coldStart = probeResult.running === false
  return cache.patch({
    ...base,
    status: 'ready',
    endpointSource: coldStart ? 'cli-launch' : 'cli',
    code: '',
    message: probeResult.warning ?? (coldStart
      ? 'local ego CLI reachable; the backing browser is not running yet and will start on the first call'
      : probeResult.heredocSkipped === true
        ? 'local ego CLI ready; heredoc probe skipped (allowProbeColdStart off) — the SDK harness check runs with the first call'
        : 'local ego CLI ready'),
    cliPath: probeResult.cliPath,
    cliShape: probeResult.shape,
    // Only record the SDK path when the probe actually used it. A CLI that
    // rejected `--sdk-path` was retried by the probe with its own harness and
    // carries a `warning`; tool execution has no such retry, so injecting the
    // flag then would crash every call.
    sdkPath: link.useSdkPath === true && probeResult.warning === undefined
      ? (input.sdkPath ?? '')
      : '',
    latencyMs: probeResult.latencyMs,
    resolvedAt: now(),
  })
}

export const egoCliRuntime: BackendRuntime = {
  kind: 'ego-cli',
  probe,
  localOnly: true,
  ownsUserBrowser: true,
  usesCdpWorker: false,
  injectsEndpoint: false,
  channel: { frames: 'ego-cli-poll', tabbitInventory: false, egoRuntime: true, panelActions: true },
}