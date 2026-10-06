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
import { createRequire } from 'node:module'
import { Config, derefVolatileConfig } from './config.ts'
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

// ── 跨版本入口(0.1.2-rc.1 → 0.2.0-rc.2)────────────────────────────────
// 按宿主 settings 服务的实际形态特性检测(不读版本号):
// - 0.1.2/0.1.5:服务实例带 installSection 方法 → 注册 section,base 必须
//   传解包后的普通值(loader 的字段级活引用会被 schema 校验拒掉),活值经
//   setSource 持续换绑;
// - 0.1.7+/0.2.0:声明式 settings,无注册调用,volatile 活引用由 loader 托管。
export function installSettingsAuto(ctx: EgoContext, config: RawConfig): SettingsBridge {
  const legacySettings = (ctx as unknown as { settings?: { installSection?: unknown } }).settings as
    | { installSection?: (owner: unknown, ns: string, schema: unknown, entry: unknown, hooks: unknown) => void }
    | undefined
  // 0.1.0/0.1.1:只剩模块级 installSettingsSection + settingsNamespace
  // (先于 Gen-A 检测无冲突:这三线的服务实例没有 installSection)。
  // createRequire + 字面量:TS 不解析该说明符(避免 devDep 拉宿主包跨线
  // peer 链冲突),运行时 Node 从宿主 node_modules 正常解析;宿主缺包时
  // 返回 undefined 落到 Gen-B。测试环境无宿主模块表,同样安全跳过。
  const legacyModule: any = ((): any => {
    try {
      return createRequire(import.meta.url)('@deepseek-ai/dsh-settings')
    } catch {
      return undefined
    }
  })()
  if (
    typeof legacyModule.installSettingsSection === 'function' &&
    typeof legacyModule.settingsNamespace === 'function'
  ) {
    const listeners = new Set<() => void>()
    let current = derefVolatileConfig(config)
    const notify = (): void => {
      for (const listener of [...listeners]) listener()
    }
    const ns = (
      legacyModule.settingsNamespace as (ns: string) => unknown
    )('dsh-browser-cdp')
    const hooks = {
      setSource: (source: unknown): void => {
        const value = typeof source === 'function' ? (source as () => unknown)() : source
        current = derefVolatileConfig((value ?? {}) as RawConfig)
      },
      onChange: (): void => {
        notify()
      },
    }
    ;(
      legacyModule.installSettingsSection as (
        owner: unknown,
        ns: unknown,
        schema: unknown,
        entry: unknown,
        hooks: unknown,
      ) => void
    )(ctx, ns, Config, current, hooks)
    return {
      source: (): Record<string, unknown> => current,
      onChange: (cb: () => void): (() => void) => {
        listeners.add(cb)
        return () => {
          listeners.delete(cb)
        }
      },
    }
  }
  if (legacySettings && typeof legacySettings.installSection === 'function') {
    const listeners = new Set<() => void>()
    let current = derefVolatileConfig(config)
    const notify = (): void => {
      for (const listener of [...listeners]) listener()
    }
    legacySettings.installSection(ctx, 'dsh-browser-cdp', Config, current, {
      setSource: (source: unknown): void => {
        const value = typeof source === 'function' ? (source as () => unknown)() : source
        current = derefVolatileConfig((value ?? {}) as RawConfig)
      },
      onChange: (): void => {
        notify()
      },
    })
    return {
      source: (): Record<string, unknown> => current,
      onChange: (cb: () => void): (() => void) => {
        listeners.add(cb)
        return () => {
          listeners.delete(cb)
        }
      },
    }
  }
  return installEgoBrowserSettings(ctx, config)
}
