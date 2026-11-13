import { describe, expect, it } from 'vitest'
import { allRuntimes, runtimeOf } from '../src/runtime/backend-runtime.ts'

/**
 * Frame source by channel — the table the host half now reads instead of
 * comparing kinds. Written as a table because the failure it guards against is
 * "a new channel says it has frames but nobody produces them": every row must
 * name exactly one producer, and `usesCdpWorker` must agree with it (the worker
 * gate `isCliCaptureChannel` is derived from that flag, so a mismatch either
 * starts a worker that can never attach or leaves the panel with no source).
 */
const EXPECTED = [
  { kind: 'cdp', frames: 'cdp-worker', worker: true, inventory: false, egoRuntime: true, panelActions: false },
  { kind: 'ego-cli', frames: 'ego-cli-poll', worker: false, inventory: false, egoRuntime: true, panelActions: true },
  { kind: 'lightpanda', frames: 'cdp-worker', worker: true, inventory: false, egoRuntime: true, panelActions: false },
  { kind: 'tabbit-cli', frames: 'tabbit-poll', worker: false, inventory: true, egoRuntime: false, panelActions: false },
] as const

describe('frame source table', () => {
  for (const row of EXPECTED) {
    it(`${row.kind} declares ${row.frames} and a consistent worker gate`, () => {
      const runtime = runtimeOf(row.kind)
      expect(runtime, `no runtime registered for ${row.kind}`).not.toBeNull()
      expect(runtime!.channel.frames).toBe(row.frames)
      expect(runtime!.channel.tabbitInventory).toBe(row.inventory)
      expect(runtime!.channel.egoRuntime).toBe(row.egoRuntime)
      expect(runtime!.channel.panelActions).toBe(row.panelActions)
      // The worker gate is `usesCdpWorker === false` → CLI poller. It must be
      // the same statement as "frames come from the worker".
      expect(runtime!.usesCdpWorker).toBe(row.worker)
      expect(runtime!.usesCdpWorker).toBe(row.frames === 'cdp-worker')
    })
  }

  it('every registered runtime appears in the table', () => {
    expect(allRuntimes().map((runtime) => runtime.kind).sort()).toEqual(EXPECTED.map((row) => row.kind).sort())
  })
})