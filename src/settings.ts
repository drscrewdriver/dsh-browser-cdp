// src/settings.ts — host-side config bridge between the composition entry the
// loader hands `apply()` and the plugin's other halves (tool registration cfg
// getters + live reload).
//
// 0.1.7 model (declarative settings): there is NO imperative settings
// registration anymore — the `Config` schema in config.ts IS the settings
// form. The loader merges the active profile's entry into the composition
// config and hands it to `apply()`; fields marked `.volatile()` arrive as
// LIVE references whose `.get()` returns the current user-layer value, and a
// volatile-only change is delivered as one `loader/volatile-update` event
// instead of a plugin remount. A change to a plain (non-volatile) field still
// remounts the plugin, so a fresh `apply()` naturally rebuilds this bridge.
//
// The bridge exposes the same two faces as the pre-0.1.7 version: a
// `source()` thunk returning plain (dereferenced) config data, and an
// `onChange()` subscription that fires on `loader/volatile-update`.
import { derefVolatileConfig } from './config.ts'
import type { EgoContext, RawConfig } from './types.ts'

export interface SettingsBridge {
  source(): Record<string, unknown>
  onChange(cb: () => void): () => void
}

/**
 * Wrap the `apply()` composition entry into a live config source.
 *
 * `source()` dereferences volatile fields on EVERY call, so consumers that
 * re-read per operation (the `cfg` getters) always see the latest user-layer
 * values without any re-registration. `onChange()` listeners are notified
 * once per `loader/volatile-update`; the subscription is disposed with the
 * plugin fiber.
 */
export function installEgoBrowserSettings(ctx: EgoContext, config: RawConfig): SettingsBridge {
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }
  // 0.1.7+: volatile-only changes fire here (no remount, changed paths
  // attached); equal-value writes do not notify. The event contract is
  // host-declared, so the handler signature stays loose.
  const disposeUpdate = ctx.on?.('loader/volatile-update', () => notify())
  ctx.effect?.(() => () => {
    disposeUpdate?.()
  })
  return {
    source: () => derefVolatileConfig(config),
    onChange: (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}
