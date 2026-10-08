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

// ── 设置 webServer 桥（老线数据臂；session-guard settings-bridge 同式）────
// ≤0.1.5 宿主无 configForms 服务（input-traffic 代际切分：configForms 是
// rc.1+ 代），client 设置卡的原生数据臂坐死；卡改走本桥 describe/mutate 两
// 端点读写宿主 settings 服务：读 = svc.describe 取自家 ns 描述符（ns 已由
// installSettingsAuto 的 installSection 注册）；写 = svc.mutate 转发 ops 落
// 宿主（不落第二份状态），成功即 describe 回填。POST-only + 256KB。
// 路由必须与 client 侧 makeBridgeScope 的 BRIDGE_ROUTES 逐字符一致。
const SETTINGS_BRIDGE_NS = 'dsh-browser-cdp'

function bridgeSendJson(res: any, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
  res.end(JSON.stringify(body))
}

function bridgeReadJson(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = []
    let size = 0
    req.on('data', (chunk: any) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.length
      if (size > 256 * 1024) {
        reject(new Error('bridge body too large'))
        if (typeof req.resume === 'function') req.resume()
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
    req.on('error', reject)
  })
}

function bridgeDescribeNs(svc: any, ns: string): any {
  return svc.describe({ redactSecrets: true }).find((d: any) => d.ns === ns)
}

/**
 * 注册 /api/dsh-browser-cdp/settings/{describe,mutate} 两端点（kind:'exact'）。
 * 宿主 settings 服务经惰性 ctx.get 取（cordis get 永不 throw；服务未解析时
 * describe 回 settings-unavailable，client 桥按瞬态重试）。webServer 缺席的
 * 宿主（TUI/headless）整段 no-op。
 */
export function registerSettingsBridge(wctx: unknown, ctx: unknown): void {
  const ws = wctx as { register?: (route: unknown) => unknown } | undefined
  if (!ws || typeof ws.register !== 'function') return
  const c = ctx as { get?: (name: string) => unknown } | undefined
  const getSettingsSvc = (): any => {
    try {
      return typeof c?.get === 'function' ? c.get('settings') : undefined
    } catch {
      return undefined
    }
  }
  ws.register({
    kind: 'exact',
    path: `/api/${SETTINGS_BRIDGE_NS}/settings/describe`,
    handler: (req: any, res: any) => {
      if (req.method !== 'POST') {
        bridgeSendJson(res, 405, { ok: false, code: 'method-not-allowed' })
        return
      }
      const svc = getSettingsSvc()
      if (!svc || typeof svc.describe !== 'function') {
        bridgeSendJson(res, 200, { ok: false, code: 'settings-unavailable', message: 'settings service not resolved yet' })
        return
      }
      try {
        const descriptor = bridgeDescribeNs(svc, SETTINGS_BRIDGE_NS)
        if (descriptor === undefined) {
          bridgeSendJson(res, 200, { ok: false, code: 'ns-not-registered', message: `settings namespace "${SETTINGS_BRIDGE_NS}" is not registered` })
          return
        }
        bridgeSendJson(res, 200, { ok: true, value: { descriptor, writable: svc.writable !== false } })
      } catch (e) {
        bridgeSendJson(res, 200, { ok: false, code: 'internal', message: e instanceof Error ? e.message : String(e) })
      }
    },
  })
  ws.register({
    kind: 'exact',
    path: `/api/${SETTINGS_BRIDGE_NS}/settings/mutate`,
    handler: (req: any, res: any) => {
      if (req.method !== 'POST') {
        bridgeSendJson(res, 405, { ok: false, code: 'method-not-allowed' })
        return
      }
      const svc = getSettingsSvc()
      if (!svc || typeof svc.mutate !== 'function') {
        bridgeSendJson(res, 200, { ok: false, code: 'settings-unavailable', message: 'settings service mutate not available' })
        return
      }
      bridgeReadJson(req).then((body: any) => {
        const ops = body?.ops
        const valid = Array.isArray(ops) && ops.every((op: any) => op !== null && typeof op === 'object' && (op.op === 'set' || op.op === 'unset'))
        if (!valid) {
          bridgeSendJson(res, 200, { ok: false, code: 'settings-rejected', message: 'malformed bridge mutate ops' })
          return
        }
        const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
        Promise.resolve(svc.mutate(SETTINGS_BRIDGE_NS, ops, expectedRevision)).then(() => {
          const descriptor = bridgeDescribeNs(svc, SETTINGS_BRIDGE_NS)
          if (descriptor === undefined) {
            bridgeSendJson(res, 200, { ok: false, code: 'internal', message: `namespace "${SETTINGS_BRIDGE_NS}" disposed after mutate` })
            return
          }
          bridgeSendJson(res, 200, { ok: true, value: { descriptor } })
        }).catch((e) => {
          const msg = e instanceof Error ? e.message : String(e)
          const conflict = e instanceof Error && /conflict|revision/i.test(msg)
          bridgeSendJson(res, 200, conflict ? { ok: false, code: 'settings-conflict', message: msg } : { ok: false, code: 'internal', message: msg })
        })
      }).catch((e) => {
        bridgeSendJson(res, 200, { ok: false, code: 'bad-request', message: e instanceof Error ? e.message : String(e) })
      })
    },
  })
}
