/**
 * tui-command.ts — `/bcdp`：bcdp 的 dsh-tui 终端面（宿主斜杠命令）。
 *
 * 为什么需要它：dsh-tui 不加载插件 client 半边（watch 面板/侧栏/设置卡全部不执行），
 * 也调不到插件 RPC，工具调用只显示一行摘要。人要看「通道通不通、工具面开了多少、
 * 帧有没有在走」，只剩宿主命令这一条路 —— TUI 把 `/bcdp status` 发给 host，
 * handler 返回 { kind, text }，文本落到 notice 单块。
 *
 * 契约（.agents/plans/dsh-tui-faces/spec.md §3）：单行 <=100、总行 <=40、无 ANSI、
 * 危险动作默认 dry + --yes、--json 出单行 JSON。
 *
 * 取数一律走 deps（由 index.ts 的 apply 注入，复用 effectiveChannel / tiers /
 * cast-server 的既有读数），本文件只做解析与排版 —— 不新增探测逻辑，避免与面板漂移。
 */

import type { AttachState, EffectiveLink } from './cdp-targets.ts'
import type { EgoContext } from './types.ts'
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

export type CommandKind = 'success' | 'error'
export interface CommandResult { kind: CommandKind; text: string }

/** 命令层需要的最小取数面；全部由 apply() 侧的既有闭包提供。 */
export interface BcdpCommandDeps {
  attach(): AttachState
  /** 当前激活链路（resolveEffectiveLink(...)?.link）；无激活项时为 null。 */
  link(): EffectiveLink['link'] | null
  links(): Array<{ id: string; kind: string; active: boolean }>
  surface(): { live: string[]; sealed: string[] }
  config(): {
    egoBin: string
    toolInjection: string
    activeSpace: string
    toolBrowse: boolean
    toolExtended: boolean
    toolEscape: boolean
    toolJudge: boolean
    judgeConfigured: boolean
  }
  poll(): { running: boolean; lastFrameAgeMs: number | null; frameSeq: number }
  watch(): { calls: number; refused: number }
  /** 直接跑已注册的 bcdp_* 工具（同一实现，不另写探测脚本、不过模型工具面）。 */
  runTool(name: string, args: Record<string, unknown>): Promise<unknown>
  /** 切换激活连接项（写设置节的 activeTargetId；默认 dry，--yes 才落盘）。 */
  setActiveTarget(targetId: string, dry: boolean): Promise<{ ok: boolean; reason?: string }>
}

const MAX_LINES = 40
// 80 列终端下也不横向溢出：契约上限是 100，这里取更严的 80。
const MAX_WIDTH = 80

interface Parsed {
  argv: string[]
  json: boolean
  yes: boolean
  all: boolean
  dry: boolean
}

/** 解析 `sub arg --flag --json --yes --all`（命令层不接 --key=value，够用即可）。 */
export function parseBcdpArgs(rawInput: string): Parsed {
  const argv: string[] = []
  let json = false
  let yes = false
  let all = false
  for (const token of String(rawInput ?? '').trim().split(/\s+/).filter(Boolean)) {
    if (!token.startsWith('--')) { argv.push(token); continue }
    if (token === '--json') json = true
    else if (token === '--yes') yes = true
    else if (token === '--all') all = true
  }
  return { argv, json, yes, all, dry: !yes }
}

/** 单行裁剪：notice 是单块文本，横向撑爆会折行错位。
 *  注意只折叠换行、不折叠内部空格 —— 两空格对齐是输出契约的一部分。 */
export function clip(text: string, width = MAX_WIDTH): string {
  // 保留行首缩进与内部多空格（对齐是契约），只去行尾空白
  const value = String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+$/, '')
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`
}

/** 行裁剪 + 溢出提示。 */
export function renderLines(lines: string[], limit = MAX_LINES): string {
  const clipped = lines.map((line) => clip(line))
  if (clipped.length <= limit) return clipped.join('\n')
  const kept = clipped.slice(0, limit - 1)
  return [...kept, `… 还有 ${clipped.length - kept.length} 行，加 --all 查看`].join('\n')
}

const ok = (lines: string[]): CommandResult => ({ kind: 'success', text: renderLines(lines) })
const fail = (reason: string, next?: string): CommandResult =>
  ({ kind: 'error', text: renderLines([reason, ...(next ? [`  ${next}`] : [])]) })

function ageLabel(ms: number | null): string {
  if (ms === null) return 'none'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m`
}

/** status — 通道 / 工具面 / 帧轮询 / watch 计数，全部读缓存，不 spawn。 */
function statusCommand(deps: BcdpCommandDeps): CommandResult {
  const attach = deps.attach()
  const link = deps.link()
  const face = deps.surface()
  const cfg = deps.config()
  const poll = deps.poll()
  const watch = deps.watch()
  const status = attach.status || 'unknown'
  const lines = [
    `bcdp status — ${status}${attach.message ? `: ${clip(attach.message, 48)}` : ''}`,
    `  channel   mode=${attach.mode || '—'}  backend=${link?.kind ?? 'none'}  target=${attach.targetId || '—'}`,
    `  endpoint  ${attach.endpoint || '—'}${attach.endpointSource ? `  (${attach.endpointSource})` : ''}`,
    `  cli       ${attach.cliPath || cfg.egoBin || '—'}${attach.latencyMs ? `  ${attach.latencyMs}ms` : ''}`,
    `  tools     live ${face.live.length} / sealed ${face.sealed.length}  injection=${cfg.toolInjection}`,
    `  frames    ${poll.running ? 'polling' : 'idle'}  age=${ageLabel(poll.lastFrameAgeMs)}  seq=${poll.frameSeq}`,
    `  watch     calls ${watch.calls}  refused ${watch.refused}`,
  ]
  if (status !== 'ready') {
    lines.push(`  next      浏览器侧未就绪：先跑任意 bcdp_* 工具唤醒通道（或 bcdp_status refresh），再回来看这里`)
  }
  if (face.sealed.length > 0) {
    lines.push(`  sealed    ${clip(face.sealed.slice(0, 8).join(' '), 80)}${face.sealed.length > 8 ? ' …' : ''}`)
  }
  return ok(lines)
}

/** config — 注入面开关与空间；不含任何密钥明文。 */
function configCommand(deps: BcdpCommandDeps): CommandResult {
  const cfg = deps.config()
  const face = deps.surface()
  const flags = [
    `browse=${cfg.toolBrowse ? 'open' : 'sealed'}`,
    `extended=${cfg.toolExtended ? 'open' : 'sealed'}`,
    `escape=${cfg.toolEscape ? 'open' : 'sealed'}`,
    `judge=${cfg.toolJudge ? 'open' : 'sealed'}${cfg.judgeConfigured ? '' : ' (key missing)'}`,
  ]
  return ok([
    `bcdp config — injection=${cfg.toolInjection}`,
    `  switches  ${flags.join('  ')}`,
    `  space     ${cfg.activeSpace || '—'}`,
    `  face      live ${face.live.length} / sealed ${face.sealed.length}`,
    `  note      改开关走插件设置（Desktop 设置页 / profile 配置），命令层只读`,
  ])
}

/** link — 已配置链路与激活项。 */
function linkCommand(deps: BcdpCommandDeps): CommandResult {
  const rows = deps.links()
  const active = deps.link()
  if (rows.length === 0) {
    return ok([
      'bcdp link — 未配置链路',
      '  next      默认走内置 ego 运行时；要接管本机 Chrome/Edge 请在设置里加连接项',
    ])
  }
  const lines = [`bcdp link — ${rows.length} 条链路，active=${active?.id ?? '—'} (${active?.kind ?? 'none'})`]
  for (const row of rows.slice(0, 12)) {
    lines.push(`  ${row.active ? '*' : ' '} ${row.id}  kind=${row.kind}`)
  }
  if (rows.length > 12) lines.push(`  … 还有 ${rows.length - 12} 条`)
  return ok(lines)
}

/** doctor — 静态体检（不 spawn）：通道、CLI、注入面、帧轮询逐项给 pass/warn。 */
function doctorCommand(deps: BcdpCommandDeps): CommandResult {
  const attach = deps.attach()
  const cfg = deps.config()
  const face = deps.surface()
  const poll = deps.poll()
  const checks: Array<[string, boolean, string]> = [
    ['attach ready', attach.status === 'ready', `status=${attach.status}${attach.code ? ` code=${attach.code}` : ''}`],
    ['cli resolvable', Boolean(attach.cliPath || cfg.egoBin), attach.cliPath || cfg.egoBin || 'no path'],
    ['tool face open', face.live.length > 0, `live ${face.live.length} / sealed ${face.sealed.length}`],
    ['frame poller', poll.running, poll.running ? `age=${ageLabel(poll.lastFrameAgeMs)}` : 'idle（无 GUI 时正常）'],
  ]
  const bad = checks.filter(([, pass]) => !pass)
  const lines = [`bcdp doctor — ${checks.length - bad.length}/${checks.length} pass（静态检查，未 spawn 探测）`]
  for (const [name, pass, detail] of checks) lines.push(`  ${pass ? 'PASS' : 'WARN'}  ${name.padEnd(14)} ${detail}`)
  if (bad.length > 0) {
    lines.push('  next      通道未就绪时先跑 bcdp_status 唤醒；仍失败用 bcdp_doctor 工具看完整探测')
  }
  return ok(lines)
}

const HELP_LINES = [
  'bcdp — CDP 浏览器的终端面（宿主命令；Desktop 命令面板同样可见）',
  '  /bcdp                 等同 status',
  '  /bcdp status          通道状态、工具面、帧轮询（读缓存，不 spawn）',
  '  /bcdp tabs            已开标签页（走 bcdp_tab op=list）',
  '  /bcdp shot [path]     截图落盘，默认 <cwd>/.dsh-tui/shots/<ts>.png',
  '  /bcdp nav <url>       在当前 space 打开页面（走 bcdp_navigate）',
  '  /bcdp attach <id>     切换激活连接项（默认 dry，--yes 写 activeTargetId）',
  '  /bcdp config          注入面开关与当前空间（只读）',
  '  /bcdp link            已配置链路与激活项',
  '  /bcdp doctor          静态体检（attach / cli / 工具面 / 帧轮询）',
  '  flags                 --json 单行 JSON 输出',
  '  note                  其它页面动作仍走 bcdp_* 工具',
]

interface TabRow { targetId?: string; title?: string; url?: string; active?: boolean; index?: number }

/** tabs — 复用 `bcdp_tab op=list`（同一 buildScript，不另造探测）。 */
async function tabsCommand(deps: BcdpCommandDeps): Promise<CommandResult> {
  let value: unknown
  try {
    value = await deps.runTool('bcdp_tab', { op: 'list' })
  } catch (error) {
    return fail(`bcdp tabs: 调用 bcdp_tab 失败：${(error as Error).message}`, 'next: /bcdp doctor')
  }
  const payload = (value ?? {}) as { ok?: boolean; tabs?: TabRow[]; reason?: string; error?: string }
  if (payload.ok === false) {
    return fail(`bcdp tabs: ${clip(payload.reason || payload.error || 'bcdp_tab 返回失败', 80)}`, 'next: /bcdp status')
  }
  const tabs = Array.isArray(payload.tabs) ? payload.tabs : []
  if (tabs.length === 0) return ok(['bcdp tabs — 没有已开标签页', '  next 用 bcdp_navigate 打开一个页面'])
  const lines = [`bcdp tabs — ${tabs.length} 个`]
  for (const tab of tabs.slice(0, 12)) {
    const mark = tab.active ? '*' : ' '
    const idx = String(tab.index ?? '').padStart(2, ' ')
    lines.push(`  ${mark}${idx}  ${clip(tab.title || '(untitled)', 40)}  ${clip(tab.url || '', 55)}`)
  }
  if (tabs.length > 12) lines.push(`  … 还有 ${tabs.length - 12} 个，加 --all 查看`)
  return ok(lines)
}

/** shot — 复用 `bcdp_screenshot`；默认落到工作区内 `.dsh-tui/shots/`。 */
async function shotCommand(deps: BcdpCommandDeps, target: string): Promise<CommandResult> {
  const path = target.trim() === ''
    ? join(process.cwd(), '.dsh-tui', 'shots', `${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
    : (isAbsolute(target.trim()) ? target.trim() : join(process.cwd(), target.trim()))
  try {
    mkdirSync(dirname(path), { recursive: true })
    const value = await deps.runTool('bcdp_screenshot', { path }) as { ok?: boolean; path?: string; reason?: string } | undefined
    if (value && value.ok === false) {
      return fail(`bcdp shot: ${clip(value.reason || '截图失败', 80)}`, 'next: /bcdp status')
    }
    const saved = value?.path ?? path
    return ok([`bcdp shot — 已保存`, `  ${saved}`, '  用图像工具读取该 PNG；本命令不再回传像素'])
  } catch (error) {
    return fail(`bcdp shot: ${(error as Error).message}`, 'next: /bcdp doctor')
  }
}

/** nav — 复用 `bcdp_navigate`。 */
async function navCommand(deps: BcdpCommandDeps, url: string): Promise<CommandResult> {
  const target = url.trim()
  if (target === '') return fail('bcdp nav: 缺少 URL', 'next: /bcdp nav https://example.com')
  try {
    const value = await deps.runTool('bcdp_navigate', { url: target }) as { ok?: boolean; reason?: string; page?: { url?: string; title?: string } } | undefined
    if (value && value.ok === false) return fail(`bcdp nav: ${clip(value.reason || '导航失败', 80)}`, 'next: /bcdp status')
    const page = value?.page
    return ok([
      `bcdp nav — 已打开`,
      `  url        ${clip(page?.url ?? target, 70)}`,
      `  title      ${clip(page?.title ?? '(untitled)', 60)}`,
    ])
  } catch (error) {
    return fail(`bcdp nav: ${(error as Error).message}`, 'next: /bcdp doctor')
  }
}

/** attach — 切换激活连接项（写设置节 activeTargetId）。 */
async function attachCommand(deps: BcdpCommandDeps, target: string, yes: boolean): Promise<CommandResult> {
  const wanted = target.trim()
  const links = deps.links()
  if (wanted === '') {
    const lines = [`bcdp attach — 需要指定连接项 id${links.length === 0 ? '（当前没有任何连接项）' : ''}`]
    for (const row of links.slice(0, 10)) lines.push(`  ${row.active ? '*' : ' '} ${row.id}  kind=${row.kind}`)
    lines.push('  next  /bcdp attach <id>   （默认 dry；加 --yes 才切换）')
    return ok(lines)
  }
  const hit = links.find((row) => row.id === wanted)
  if (hit === undefined) {
    return fail(`bcdp attach: 没有 id="${wanted}" 的连接项`, 'next: /bcdp link')
  }
  if (hit.active) return ok([`bcdp attach — ${wanted} 已是激活项`])
  const outcome = await deps.setActiveTarget(hit.id, !yes)
  if (!outcome.ok) {
    return fail(`bcdp attach: ${outcome.reason ?? '写入失败'}`, 'next: 在 Desktop 设置里切换连接项')
  }
  return yes
    ? ok([`bcdp attach — 已切换到 ${hit.id}`, '  next /bcdp status 看通道是否就绪'])
    : ok([`bcdp attach — dry run：将切换到 ${hit.id}（当前 ${links.find((row) => row.active)?.id ?? '—'}）`, '  确认后加 --yes 执行'])
}

/** 纯函数入口：单测直接打这里，不挂 cordis。tabs/shot/nav/attach 走异步 runTool。 */
export async function runBcdpCommand(rawInput: string, deps: BcdpCommandDeps): Promise<CommandResult> {
  const parsed = parseBcdpArgs(rawInput)
  const sub = (parsed.argv[0] ?? 'status').toLowerCase()
  let result: CommandResult
  switch (sub) {
    case 'status':
      result = statusCommand(deps)
      break
    case 'tabs':
    case 'tab':
      result = await tabsCommand(deps)
      break
    case 'shot':
    case 'screenshot':
      result = await shotCommand(deps, parsed.argv.slice(1).join(' '))
      break
    case 'nav':
    case 'navigate':
    case 'goto':
      result = await navCommand(deps, parsed.argv.slice(1).join(' '))
      break
    case 'attach':
      result = await attachCommand(deps, parsed.argv.slice(1).join(' '), parsed.yes)
      break
    case 'config':
      result = configCommand(deps)
      break
    case 'link':
    case 'links':
      result = linkCommand(deps)
      break
    case 'doctor':
      result = doctorCommand(deps)
      break
    case 'help':
    case '?':
      result = ok(HELP_LINES)
      break
    default:
      result = fail(`bcdp: 未知子命令 "${sub}"`, 'next: /bcdp help')
  }
  if (!parsed.json) return result
  const attach = deps.attach()
  const face = deps.surface()
  const polls = deps.poll()
  const payload = result.kind === 'error'
    ? { ok: false, cmd: 'bcdp', sub, error: { message: result.text.split('\n')[0] ?? result.text } }
    : {
        ok: true,
        cmd: 'bcdp',
        sub,
        data: {
          attach: { status: attach.status, mode: attach.mode, targetId: attach.targetId, code: attach.code, message: attach.message },
          link: deps.link() ? { id: deps.link()!.id, kind: deps.link()!.kind } : null,
          face: { live: face.live.length, sealed: face.sealed.length },
          frames: { running: polls.running, ageMs: polls.lastFrameAgeMs, seq: polls.frameSeq },
        },
      }
  return { kind: result.kind, text: JSON.stringify(payload) }
}

/**
 * 注册 `/bcdp`。调用侧保证 commands 服务存在（ctx.inject(['commands'])），
 * 老线没有该服务时不会走到这里 —— 也就不需要 try/catch。
 */
export function registerBcdpCommand(ctx: EgoContext, deps: BcdpCommandDeps): void {
  const registry = (ctx as unknown as { commands?: { register(definition: unknown): unknown } }).commands
  if (!registry || typeof registry.register !== 'function') return
  registry.register({
    definitionId: 'dsh-browser-cdp',
    name: 'bcdp',
    description: 'CDP browser console: status / config / link / doctor (read-only; page actions stay in bcdp_* tools)',
    input: { hint: '[status|tabs|shot <path>|nav <url>|attach <id>|config|link|doctor] [--json] [--yes]' },
    handler: (invocation: { rawInput?: string }) => runBcdpCommand(invocation?.rawInput ?? '', deps),
  })
}
