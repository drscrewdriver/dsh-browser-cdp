// src/toolTiers.ts — 工具分级注入策略（纯函数，无宿主依赖）
//
// 动机：插件挂载时一次性注册 38 个 bcdp_* 工具，每个会话每一轮都要为它们付
// schema 成本（实测 description+parameters 源文本 ≈ 25.6K 字符 ≈ 5–7K token），
// 而绝大多数会话根本不碰浏览器。这里把「哪些工具在什么条件下允许出现在模型面
// 前」收成一处策略，注册时机交给 index.ts 的控制器执行。
//
// 四级（rank 越小越常驻）：
//   core      常驻：探测/诊断/指南 + 最小可用闭环（打开空间 → 导航 → 读页面）。
//             永不封印，否则 lazy 模式下模型连「解锁」的入口都没有。
//   browse    基础操作：一次浏览器活动之后注入。
//   extended  扩展能力：拖拽/上传/下载/对话框/裸 CDP/脚本逃生舱/登录搬运。
//   judge     评审链（bcdp_jev_*）：除解锁外还要求评审**已配置**——没配 key
//             时这五个工具只能回答「未配置」，白占上下文。
//
// 旋钮（全 volatile，且带 schema `.default()`——表单描述符与生效值必须同源，
// 否则面板显示一个值、运行时用另一个值）：
//   toolInjection  'lazy'（默认）| 'always'（历史行为：挂载即全量）
//   toolBrowse / toolExtended / toolJudge   一级一个开关，ON = 开放注册、
//                  OFF = 封印（从模型工具列表移除）——与 prime-memory 的
//                  「工具封印」同一形状。`core` 级不参与封印，无开关。
// judge 级除开关外还要求配了 Key（否则只能回答「未配置」）。
const CORE = [
  'bcdp_status',
  'bcdp_doctor',
  'bcdp_help',
  'bcdp_space_open',
  'bcdp_navigate',
  'bcdp_snapshot',
] as const
const BROWSE = [
  'bcdp_space_close',
  'bcdp_click',
  'bcdp_fill',
  'bcdp_key',
  'bcdp_hover',
  'bcdp_scroll',
  'bcdp_select',
  'bcdp_check',
  'bcdp_screenshot',
  'bcdp_page_info',
  'bcdp_read_element',
  'bcdp_js',
  'bcdp_wait',
  'bcdp_wait_for_selector',
] as const
const EXTENDED = [
  'bcdp_drag',
  'bcdp_upload',
  'bcdp_download',
  'bcdp_dialog',
  'bcdp_cdp',
  'bcdp_http',
  'bcdp_cli',
  'bcdp_script',
  'bcdp_captcha',
  'bcdp_auth_flush',
  'bcdp_login_import',
  'bcdp_wait_for_url',
  'bcdp_wait_for_response',
] as const
const JUDGE = [
  'bcdp_jev_status',
  'bcdp_jev_ask',
  'bcdp_jev_frame',
  'bcdp_jev_run',
  'bcdp_jev_attempt',
] as const

export type ToolTier = 'core' | 'browse' | 'extended' | 'judge'
export type ToolInjection = 'always' | 'lazy'

/** 工具名 → 分级。`ego_*` 旧名（legacyEgoToolNames 别名）与 bcdp_* 同名同组。 */
export const TIER_OF_TOOL: ReadonlyMap<string, ToolTier> = new Map<string, ToolTier>(
  ([['core', CORE], ['browse', BROWSE], ['extended', EXTENDED], ['judge', JUDGE]] as const)
    .flatMap(([tier, names]) => names.map((n) => [n, tier] as const)),
)

/** 分级成员表（测试与文档用）。 */
export const TIER_MEMBERS: Readonly<Record<ToolTier, readonly string[]>> = {
  core: CORE, browse: BROWSE, extended: EXTENDED, judge: JUDGE,
}

/** 去掉 `bcdp_`/`ego_` 前缀后的裸名，便于策略表保持前缀无关。 */
export const bareToolName = (name: string): string => name.replace(/^(?:bcdp|ego)_/, '')

/**
 * 工具所属分级。未登记的名字落到 `extended`（最严的一档：宁可等活动解锁，
 * 也不让新工具悄悄回到常驻面）；调用方应当在启动时打一条 warn，见
 * `unknownTieredTools`。分级表漂移由 `tests/tool-tiers.test.ts` 的覆盖率断言
 * 兜住，这里只是运行期兜底。
 */
export function tierOfTool(name: string): ToolTier {
  const bare = bareToolName(name)
  for (const [known, tier] of TIER_OF_TOOL) {
    if (bareToolName(known) === bare) return tier
  }
  return 'extended'
}

/** 名单里所有查不到分级登记的工具名（启动自检 / 测试用）。 */
export const unknownTieredTools = (names: readonly string[]): string[] =>
  names.filter((n) => !([...TIER_OF_TOOL.keys()].some((k) => bareToolName(k) === bareToolName(n))))

/**
 * 评审链是否「已配置」：至少有一个可用的 key。`layaUrl` 有默认值（sidecar
 * 本机 8000），所以 URL 非空说明不了任何事——只有 key 才是配置证据。
 * 两个 hop 独立可达，任一有 key 就算配置（见 config.ts 的 jev/laya 分离说明）。
 */
export const judgeConfigured = (c: { jevKey?: string; layaKey?: string }): boolean =>
  (c.jevKey ?? '').trim() !== '' || (c.layaKey ?? '').trim() !== ''

/** 注入策略的一次读取快照（全部来自 volatile 活引用，每次重读）。 */
export interface TierPolicy {
  injection: ToolInjection
  /** 各级开关：true = 开放注册，false = 封印。`core` 级不在此列（不可封印）。 */
  toolBrowse: boolean
  toolExtended: boolean
  toolJudge: boolean
  judgeConfigured: boolean
  /** 本插件挂载以来是否发生过浏览器活动（bcdp_* 调用）。 */
  active: boolean
}

/** 某级开关的当前极性；`core` 恒开放。 */
export const tierOpen = (tier: ToolTier, p: TierPolicy): boolean => {
  switch (tier) {
    case 'browse': return p.toolBrowse
    case 'extended': return p.toolExtended
    case 'judge': return p.toolJudge
    default: return true
  }
}

/**
 * 该分级此刻是否允许注册。
 *
 * 三条独立闸，任一不过即封印：
 * ① 本级开关（一级一个，ON = 开放）；
 * ② 评审级额外要求已配 Key（没 Key 的 `bcdp_jev_*` 只能回「未配置」）；
 * ③ 注入模式：`lazy` 下非 core 级要等活动，`always` 下不设时机闸。
 */
export function tierAllowed(tier: ToolTier, p: TierPolicy): boolean {
  if (!tierOpen(tier, p)) return false
  if (tier === 'judge' && !p.judgeConfigured) return false
  if (tier === 'core') return true
  return p.injection === 'always' || p.active
}

/** 某工具此刻是否允许注册（名字 → 分级 → 策略）。 */
export const toolAllowed = (name: string, p: TierPolicy): boolean => tierAllowed(tierOfTool(name), p)

// ── 注入控制器 ──────────────────────────────────────────────────────────────
//
// 与 prime-memory 的工具组封印同式：**封印 = 从模型工具列表消失（反注册），
// 不是执行期拒绝**。注册面变化即时生效（宿主每轮重新装配工具表），所以设置页
// 翻开关或一次浏览器活动都能当场扩大/收窄面，无需重启插件。
//
// 控制器不认识宿主：`register` 由调用方注入（返回 disposer），策略经 `policy()`
// 每次重读活引用。这让它能脱离 Cordis 单测。

/** 一个已定义的工具句柄（`defineTool` 产物）；这里只读它的 `name`。 */
export interface TierToolLike {
  name?: unknown
}

export interface TierInjectorOptions {
  /** 真正交给宿主的注册调用；返回反注册的 disposer。 */
  register(tool: TierToolLike): () => void
  /** 当前策略快照（每次 reapply 重读，绝不缓存）。 */
  policy(): TierPolicy
  logger?: { info?: (m: string) => void; warn?: (m: string) => void }
  /** 日志前缀，默认 `dsh-browser-cdp`。 */
  label?: string
}

export interface TierInjector {
  /** 登记一个工具并按当前策略尝试注册（不允许则挂着，等 reapply）。 */
  offer(tool: TierToolLike): void
  /** 策略变了（设置热更 / 活动解锁 / 闲置回收）：补齐该注册的、收回该封印的。幂等。 */
  reapply(): void
  /** 当前注入面（测试与 doctor 用）。 */
  surface(): { live: string[]; sealed: string[] };
}

export function createTierInjector(o: TierInjectorOptions): TierInjector {
  const label = o.label ?? 'dsh-browser-cdp'
  /** 全部已登记工具，插入序。 */
  const all = new Map<string, TierToolLike>()
  /** 此刻注册在宿主上的工具 → disposer。 */
  const live = new Map<string, () => void>()
  /** 无名字的工具（不该出现，兜底直注不误伤既有行为）。 */
  let anon = 0

  const reapply = (): void => {
    const p = o.policy()
    const added: string[] = []
    const removed: string[] = []
    for (const [name, tool] of all) {
      const allowed = toolAllowed(name, p)
      if (allowed && !live.has(name)) {
        live.set(name, o.register(tool))
        added.push(name)
      } else if (!allowed && live.has(name)) {
        live.get(name)?.()
        live.delete(name)
        removed.push(name)
      }
    }
    if (added.length > 0) o.logger?.info?.(`${label}: 工具注入 +${added.length} (${added.join(' ')})`)
    if (removed.length > 0) o.logger?.warn?.(`${label}: 工具封印 -${removed.length} (${removed.join(' ')})`)
  }

  return {
    offer(tool) {
      const name = typeof tool?.name === 'string' ? tool.name : ''
      if (name === '') {
        anon += 1
        live.set(`#anon${anon}`, o.register(tool))
        return
      }
      all.set(name, tool)
      reapply()
    },
    reapply,
    surface() {
      return { live: [...live.keys()], sealed: [...all.keys()].filter((n) => !live.has(n)) }
    },
  }
}
