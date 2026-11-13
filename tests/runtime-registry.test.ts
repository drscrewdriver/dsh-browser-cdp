import { describe, expect, it } from 'vitest'
import { allRuntimes, runtimeOf, runtimeOfLink } from '../src/runtime/backend-runtime.ts'
import { createAttachCache, emptyAttachState } from '../src/cdp-targets.ts'

/**
 * The registry replaced five separate `kind ===` ladders, so its shape is now
 * load-bearing: a missing runtime means an activated link silently stops being
 * probed, and a wrong capability flag means the host takes the wrong branch
 * (remote switch gating a local CLI, `--stop` sent to someone's own browser,
 * frames expected from a worker that was intentionally never started).
 */
describe('backend runtime registry', () => {
  it('covers every link kind exactly once', () => {
    const kinds = allRuntimes().map((runtime) => runtime.kind)
    expect(kinds).toEqual(['cdp', 'ego-cli', 'lightpanda', 'tabbit-cli'])
    expect(new Set(kinds).size).toBe(kinds.length)
  })

  it('resolves by kind and by link, and answers null for anything unknown', () => {
    expect(runtimeOf('cdp')?.kind).toBe('cdp')
    expect(runtimeOf('tabbit-cli')?.kind).toBe('tabbit-cli')
    expect(runtimeOf('nope')).toBeNull()
    expect(runtimeOf(undefined)).toBeNull()
    expect(runtimeOfLink(null)).toBeNull()
    expect(runtimeOfLink({ id: 'x', kind: 'lightpanda', label: 'lp', enabled: true, note: '', servePath: '' })?.kind).toBe('lightpanda')
  })

  it('keeps the capability flags honest', () => {
    const byKind = new Map(allRuntimes().map((runtime) => [runtime.kind, runtime]))
    // A browser-owning channel must never be `--stop`ped and never gated by the
    // REMOTE switch. tabbit additionally drives no ego runtime at all.
    expect(byKind.get('ego-cli')).toMatchObject({ localOnly: true, ownsUserBrowser: true, injectsEndpoint: false })
    expect(byKind.get('tabbit-cli')).toMatchObject({ localOnly: true, ownsUserBrowser: true, injectsEndpoint: false })
    expect(byKind.get('tabbit-cli')?.channel).toMatchObject({ egoRuntime: false, tabbitInventory: true, frames: 'tabbit-poll' })
    // lightpanda owns its serve but DOES hand over a wsUrl — the distinction the
    // old ladders kept re-deriving as "LP is special".
    expect(byKind.get('lightpanda')).toMatchObject({ localOnly: true, ownsUserBrowser: false, injectsEndpoint: true, usesCdpWorker: true })
    expect(byKind.get('cdp')).toMatchObject({ localOnly: false, ownsUserBrowser: false, injectsEndpoint: true })
    // Exactly one kind feeds frames from a CDP worker per CLI poller family, so
    // `isCliCaptureChannel` stays a real discriminator.
    expect(allRuntimes().filter((runtime) => !runtime.usesCdpWorker).map((runtime) => runtime.kind)).toEqual(['ego-cli', 'tabbit-cli'])
  })

  it('refuses a link of the wrong kind instead of probing it', async () => {
    const cache = createAttachCache()
    const out = await runtimeOf('cdp')!.probe({
      input: { targets: [], activeTargetId: '', mode: 'auto', cache },
      cache,
      suggested: { ...emptyAttachState(), mode: 'auto', status: 'idle' },
      link: { id: 'tb', kind: 'tabbit-cli', label: 'Tabbit', enabled: true, note: '', cliPath: '' },
      now: () => 1,
    })
    expect(out).toMatchObject({ status: 'unreachable', code: 'runtime-kind-mismatch' })
  })
})