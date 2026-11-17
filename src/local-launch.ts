/**
 * src/local-launch.ts — 受管本地浏览器「什么时候可以起」的三层判定。
 *
 * 与 `toolTiers.ts` 的分工（绝不合并）：
 *  - `toolTiers.ts` 回答**注册期**问题：「这个工具在这个会话里要不要注入给模型」
 *    （分级解锁，`tiers.pulse` 是它的信号）；
 *  - 本文件回答**执行期**问题：「这一次调用会不会真的 spawn 运行时并碰页面」。
 * 拿分级信号当启动闸门是 issue #14 正文点名的错误 —— `markEgoToolCall` 只更新
 * 活动时间与 SSE，两者都不是「是否碰页面」的判据。
 *
 * 三层隔离（spec 决策记录）：
 *  配置轴  localLaunchPolicy  —— 持久，跨重启（eager / on-demand / manual）
 *  运行期  localBrowserPower  —— 本会话，不落盘（auto / on / off）
 *  谓词    本文件的纯函数     —— 无状态，被上面两层驱动
 *
 * 全部是纯函数、零 IO：启动时机是静态策略，不该含时间变量或副作用。
 */

/** 配置轴：挂载期是否预启动受管浏览器。 */
export type LocalLaunchPolicy = 'eager' | 'on-demand' | 'manual'

/**
 * 运行期开关：本会话的临时覆盖，不持久化。
 * `auto` = 听配置轴；`on` = 无视 on-demand 立即允许；`off` = 本会话一律不起。
 */
export type LocalBrowserPower = 'auto' | 'on' | 'off'

/**
 * 不碰页面的工具：调用它们永不触发启动。
 *
 * 显式白名单而非黑名单：新增工具默认归「碰页面」，宁可多起一次浏览器，
 * 也不让一个真正要页面的工具静默失败（失败面朝安全方向）。
 */
const NON_PAGE_TOOLS: ReadonlySet<string> = new Set([
  'bcdp_status',
  'bcdp_help',
  'bcdp_doctor',
  'bcdp_jev_status',
])

/**
 * 只读 op：同名工具在特定 op 下不碰页面。
 *
 * `bcdp_tab op=list` 只列举、`bcdp_space op=list` 只读表 —— 它们若走 heredoc
 * 会顺带冷启动浏览器（issue #14 的「/bcdp tabs 不是只读子命令」）。列进这里
 * 之后它们改走缓存/worker，不再需要浏览器。
 */
const NON_PAGE_OPS: Readonly<Record<string, readonly string[]>> = {
  bcdp_tab: ['list'],
  bcdp_space: ['list', 'close'],
}

/** 归一化工具名：`ego_navigate` 与 `bcdp_navigate` 视为同一个（legacy 别名）。 */
const canonicalToolName = (name: string): string =>
  `bcdp_${String(name ?? '').replace(/^(?:bcdp|ego)_/, '')}`

/**
 * 执行期谓词：这次调用会不会真的碰页面。
 *
 * @param name 工具名（`bcdp_*` 或 legacy `ego_*`）
 * @param args 本次调用的实参（用于判只读 op）
 */
export function toolTouchesPage(name: string, args: Record<string, unknown> = {}): boolean {
  const canonical = canonicalToolName(name)
  if (NON_PAGE_TOOLS.has(canonical)) return false
  const readonlyOps = NON_PAGE_OPS[canonical]
  if (readonlyOps !== undefined) {
    // 缺省 op 按各工具自己的默认走：bcdp_tab 默认 list、bcdp_space 默认 open。
    // 取不到字符串就按「碰页面」处理，不做乐观假设。
    const raw = args['op']
    if (typeof raw !== 'string') return canonical !== 'bcdp_tab'
    return !readonlyOps.includes(raw)
  }
  return true
}

/**
 * 挂载 / 设置变更时是否允许 launcher 起浏览器。
 *
 * `off` 优先于 `on`：运行期关闭是本会话最强的意图，不能被配置轴的 eager 覆盖。
 */
export function shouldLaunchOnMount(policy: LocalLaunchPolicy, power: LocalBrowserPower): boolean {
  if (power === 'off') return false
  if (power === 'on') return true
  return policy === 'eager'
}

/**
 * 一次工具调用前是否允许起浏览器。
 *
 * 与挂载判定的差别：`on-demand` 在这里放行（调用方已经过 `toolTouchesPage`），
 * `manual` 在这里仍拒绝 —— manual 的语义是「只有显式命令能起」。
 */
export function shouldLaunchOnCall(
  policy: LocalLaunchPolicy,
  power: LocalBrowserPower,
  name: string,
  args: Record<string, unknown> = {},
): boolean {
  if (!toolTouchesPage(name, args)) return false
  if (power === 'off') return false
  if (power === 'on') return true
  return policy !== 'manual'
}

/**
 * 拒绝启动时的可行动文案。
 *
 * 三条分支各自给出**下一步命令**，不用「稍后再试」这种无法执行的措辞：
 * 模型读到它应当能直接决定是调 `/bcdp browser on` 还是改配置。
 */
export function notStartedMessage(policy: LocalLaunchPolicy, power: LocalBrowserPower): string {
  if (power === 'off') {
    return 'local browser is switched OFF for this session: run `/bcdp browser on` to re-enable it, or restart DSH (the switch is not persisted).'
  }
  if (policy === 'manual') {
    return 'local browser launch is set to manual: run `/bcdp browser start`, or set localLaunchPolicy to eager/on-demand in the plugin settings.'
  }
  return 'local browser is not started yet.'
}
