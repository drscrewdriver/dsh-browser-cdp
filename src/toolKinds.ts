/**
 * src/toolKinds.ts — 按连接类型（link.kind）收窄工具注入面的纯函数表。
 *
 * 与 src/cdp/capabilities.ts 的分工（两者叠加使用，绝不合并）：
 *  - 本文件回答「这个通道根本翻译不了这个工具」——结构性事实，设置里就能判定，
 *    冷启动即可收窄；
 *  - `capabilitiesFor(engine)` 回答「连上了但某个 CDP 域不可达」——运行时事实，
 *    要 probe/attach 之后才知道。
 * 合并会让「通道不支持」与「引擎降级」再也分不清归因。
 *
 * 首版只收窄 `tabbit-cli`：`cdp` / `ego-cli` / `lightpanda` / 未激活 一律 `'all'`，
 * 保证与改造前行为逐字一致（回归断言见 tests/tool-kinds.test.ts）。
 *
 * kind 名不靠字面量自证：类型直接取 `BrowserLinkKind`（type-only import，零运行
 * 时依赖、不成环），因此宿主新增一种 kind 时本表的 `Record` 会编译报错，强制登记。
 */
import type { BrowserLinkKind } from './types.ts'

export type BackendKind = BrowserLinkKind | 'none'

/**
 * tabbit-cli 通道能翻译的工具（13 项）。
 *
 * 排除项与理由：
 *  - `bcdp_cdp`：snippet 运行时没有 `cdp()` 形参，且 Tabbit 拒绝 `Browser.*`/`Target.*`
 *  - `bcdp_captcha` / `wait_for_human` / `auth_flush` / `login_import`：待 P1 接入
 *  - `bcdp_upload` / `download` / `dialog`：依赖 Playwright 事件，Tabbit 连接模式不提供
 *  - `bcdp_jev_*`：需评审 Key
 *  - `bcdp_key` / `hover` / `select` / `check` / `drag` / `scroll` / `wait`：待 P1；
 *    期间由 `bcdp_js` 兜底（见 bcdp_status 的迁移指引）
 *
 * 与 src/index.ts 的 `tryTabbitExecute` case 集合必须保持同向：表是子集上界，
 * 测试断言"case 集合 ⊆ 表"，漏登记会让工具被误封。
 */
const TABBIT_CLI_TOOLS = [
  'bcdp_status',
  'bcdp_help',
  'bcdp_doctor',
  'bcdp_space',
  'bcdp_navigate',
  'bcdp_snapshot',
  'bcdp_click',
  'bcdp_fill',
  'bcdp_screenshot',
  'bcdp_tab',
  'bcdp_js',
  'bcdp_http',
  'bcdp_script',
] as const

/**
 * 通道 → 工具支持面。`'all'` = 该通道不按 kind 收窄（历史行为，零变化）。
 * 未激活（`none`）同样全开：用户刚装、还没连任何链路时不该被封印。
 */
export const KIND_TOOL_SUPPORT: Record<BackendKind, ReadonlySet<string> | 'all'> = {
  cdp: 'all',
  'ego-cli': 'all',
  lightpanda: 'all',
  none: 'all',
  'tabbit-cli': new Set<string>(TABBIT_CLI_TOOLS),
}

/** tabbit-cli 支持面（只读清单；测试、`bcdp_status`、`bcdp_help` 共用同一真值）。 */
export const TABBIT_CLI_SUPPORTED: readonly string[] = TABBIT_CLI_TOOLS

/** 该通道能否翻译这个工具。`'all'` 通道恒真。 */
export const kindSupportsTool = (name: string, kind: BackendKind): boolean => {
  const support = KIND_TOOL_SUPPORT[kind]
  return support === 'all' ? true : support.has(name)
}

/**
 * 从激活链路的 `kind` 派生通道类型。
 * 未知 kind 一律按 `'cdp'`（全开）——宁可多给不可误封；缺省/空串 = 未激活。
 */
const KNOWN_KINDS: readonly BrowserLinkKind[] = ['cdp', 'ego-cli', 'lightpanda', 'tabbit-cli']

export const backendKindOf = (linkKind: string | null | undefined): BackendKind => {
  if (linkKind === null || linkKind === undefined || linkKind === '') return 'none'
  const found = KNOWN_KINDS.find((k) => k === linkKind)
  return found ?? 'cdp'
}
