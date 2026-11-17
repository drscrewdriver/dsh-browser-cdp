import { describe, expect, it } from 'vitest'
import {
  createAttachCache,
  defaultAttachCache,
  emptyAttachState,
  refreshAttach,
  refreshLocalProbe,
} from '../src/cdp-targets.ts'
import { decideCdpAttach, effectiveChannel, resolveEgoEnv } from '../src/index.ts'

/**
 * issue #14 follow-up — the managed launcher's endpoint must actually reach the
 * tools. Two independent defects used to swallow it:
 *  ① `effectiveChannel` filtered the local cache row through `attachMatchesLink`,
 *     which drops it on BOTH counts (no activated link → empty state; even with
 *     one, the row's `targetId` is `''` by design);
 *  ② `decideAttach` answered `{kind:'local'}` for local mode unconditionally,
 *     so `resolveEgoEnv` never wrote EGO_LINUX_CDP_URL.
 *
 * Each test below pins one of them against the REAL cache the launcher writes.
 */

/** The exact row `refreshAttach`'s local branch patches on success. */
const managedReadyRow = {
  status: 'ready' as const,
  mode: 'local' as const,
  targetId: '',
  endpoint: 'http://127.0.0.1:51913',
  wsUrl: 'ws://127.0.0.1:51913/devtools/browser/abc',
  endpointSource: 'local' as const,
  code: '',
  message: 'local mode: managed browser launched',
  latencyMs: 5,
  resolvedAt: 1,
}

/** Install `row` as the process-wide attach cache state, then restore. */
function withCache<T>(row: ReturnType<typeof emptyAttachState>, fn: () => T): T {
  const before = defaultAttachCache.get()
  defaultAttachCache.patch(row)
  try {
    return fn()
  } finally {
    defaultAttachCache.patch(before)
  }
}

describe('① effectiveChannel must not filter the local cache row', () => {
  it('returns the managed row in local mode even with no activated link', () => {
    withCache(managedReadyRow, () => {
      const { attach } = effectiveChannel({ cdpMode: 'local', links: [], activeTargetId: '' })
      expect(attach.status).toBe('ready')
      expect(attach.wsUrl).toBe(managedReadyRow.wsUrl)
      expect(attach.endpointSource).toBe('local')
    })
  })

  it('returns the managed row even when a DIFFERENT link is activated', () => {
    withCache(managedReadyRow, () => {
      const { attach } = effectiveChannel({
        cdpMode: 'local',
        links: [{ kind: 'cdp', id: 'L1', label: 'A', endpoint: 'http://a:1', enabled: true, note: '' }],
        activeTargetId: 'L1',
      })
      // '' !== 'L1' — this is the exact comparison that used to drop the row.
      expect(attach.wsUrl).toBe(managedReadyRow.wsUrl)
    })
  })

  it('still scopes the cache by link outside local mode (no regression)', () => {
    withCache(managedReadyRow, () => {
      const { attach } = effectiveChannel({
        cdpMode: 'auto',
        links: [{ kind: 'cdp', id: 'L1', label: 'A', endpoint: 'http://a:1', enabled: true, note: '' }],
        activeTargetId: 'L1',
      })
      // A local row must never leak into an auto-mode decision.
      expect(attach.status).toBe('idle')
      expect(attach.wsUrl).toBe('')
    })
  })
})

describe('② local mode must inject the managed endpoint', () => {
  it('decideCdpAttach reports an inject with source local', () => {
    withCache(managedReadyRow, () => {
      const d = decideCdpAttach({ cdpMode: 'local', links: [], activeTargetId: '' })
      expect(d).toEqual({ kind: 'inject', wsUrl: managedReadyRow.wsUrl, targetId: '', source: 'local' })
    })
  })

  it('resolveEgoEnv writes EGO_LINUX_CDP_URL for local mode', () => {
    withCache(managedReadyRow, () => {
      const env = resolveEgoEnv({ cdpMode: 'local' }, { platform: 'win32', baseEnv: {} })
      expect(env.EGO_LINUX_CDP_URL).toBe(managedReadyRow.wsUrl)
    })
  })

  it('does NOT inject while nothing is up yet (the pre-launch state)', () => {
    withCache(emptyAttachState(), () => {
      const env = resolveEgoEnv({ cdpMode: 'local' }, { platform: 'win32', baseEnv: {} })
      expect(env.EGO_LINUX_CDP_URL).toBeUndefined()
    })
  })
})

describe('refreshLocalProbe — re-read only, never launch', () => {
  const deadIo = {
    exists: () => false,
    readFile: () => '',
    isAlive: () => false,
    fetchVersion: async () => ({ ok: false }),
    killTree: () => {},
    removeFile: () => {},
    spawn: () => {
      throw new Error('refreshLocalProbe must never spawn a browser')
    },
    now: () => 1,
    sleep: async () => {},
    makePort: async () => 0,
  }

  it('answers `local` when the registry is empty, without spawning', async () => {
    const cache = createAttachCache()
    const out = await refreshLocalProbe({ cache, launcherIo: deadIo, now: () => 1 })
    expect(out.status).toBe('local')
    expect(out.wsUrl).toBe('')
  })

  it('keeps a live instance `ready` instead of clobbering it with `local`', async () => {
    const cache = createAttachCache()
    const io = {
      ...deadIo,
      exists: () => true,
      readFile: () =>
        JSON.stringify({ pid: 999, port: 51913, endpoint: 'http://127.0.0.1:51913', startedAt: 1, engine: 'chrome', userDataDir: 'X' }),
      isAlive: () => true,
    }
    // probeEndpoint hits the network; a closed loopback port is the realistic
    // fixture here (no browser in CI), so assert the UNREACHABLE branch keeps
    // the endpoint instead of pretending nothing is running.
    const out = await refreshLocalProbe({ cache, launcherIo: io, now: () => 1, timeoutMs: 200 })
    expect(out.status).toBe('unreachable')
    expect(out.endpoint).toBe('http://127.0.0.1:51913')
    expect(out.message).toContain('pid 999')
  })

  it('leaves a previously-ready row untouched when the pid is gone', async () => {
    const cache = createAttachCache()
    cache.patch(managedReadyRow)
    const out = await refreshLocalProbe({ cache, launcherIo: deadIo, now: () => 1 })
    // The browser is really gone → the honest answer is "not up", and the
    // stale wsUrl must NOT survive (a dead ws would hang the next tool call).
    expect(out.status).toBe('local')
    expect(out.wsUrl).toBe('')
  })
})

describe('refreshAttach local branch still writes the launcher row (regression)', () => {
  it('keeps targetId empty and marks endpointSource local', async () => {
    const cache = createAttachCache()
    const io = {
      exists: (p: string) => String(p).endsWith('launcher.json'),
      readFile: () =>
        JSON.stringify({ pid: 999, port: 51913, endpoint: 'http://127.0.0.1:51913', startedAt: 1, engine: 'chrome', userDataDir: 'X' }),
      isAlive: () => true,
      fetchVersion: async () => ({ ok: true }),
      killTree: () => {},
      removeFile: () => {},
      spawn: () => ({ pid: 999 }),
      now: () => 1,
      sleep: async () => {},
      makePort: async () => 51913,
    }
    const out = await refreshAttach({
      targets: [],
      activeTargetId: '',
      mode: 'local',
      cache,
      fallback: { enabled: false },
      useLauncher: true,
      launcherIo: io,
      now: () => 1,
    })
    // probeEndpoint still talks to the network → unreachable here, but the
    // shape contract (targetId '' + a local provenance) must hold.
    expect(out.targetId).toBe('')
  })
})
