/**
 * src/skill/index.ts — 随包 skill `bcdp-browser`：provider + 系统提示段。
 *
 * 为什么单独一个模块（而不是塞进 src/index.ts）：
 *  - 契约独立。skill 只读磁盘上的 skills/bcdp-browser/SKILL.md，和工具面无关；
 *    拆开后宿主可以用子路径（dsh-browser-cdp/skill）单独装载/卸载它。
 *  - 构建产物也是 lib/skill/index.js（保留一级目录），所以 `../../skills/` 在
 *    源码与产物下都指向包根，vitest 与运行时用同一条路径。不要照抄成 lib/skill.js
 *    + `../skills/` —— 那样单测与运行时会指向不同位置。
 *
 * 为什么 provider 里不 pulse：分级解锁是"会话级"的（pulse 需要调用方 sessionId，
 * 现有调用点都从 tool exec 拿）。provider 的 get(selected, options) 只有 signal，
 * 在这里 pulse 只能做成进程级，会把别的会话的工具面一起铺开。解锁链由常驻的
 * bcdp_help 承担 —— SKILL.md 里也明写了"加载 skill 后仍需调 bcdp_help"。
 *
 * 类型说明：dsh-skill / dsh-system-prompt 只做软依赖（ctx.inject），本文件不
 * import 它们的值或类型，避免在未安装该 peer 的宿主上加载失败。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import type { Context } from '@deepseek-ai/cordis'

/** skill 的运行时身份（系统提示与工具 description 里写死了这个名字，改这里不够）。 */
const SKILL_NAME = 'bcdp-browser'
const SKILL_PROVIDER_NAME = 'bcdp-browser-bundled-skill'
/* 宿主展示用路径；源码（src/skill/）与产物（lib/skill/）层级相同，都是两级。 */
const SKILL_URL = new URL('../../skills/bcdp-browser/SKILL.md', import.meta.url)
const SKILL_RESOURCE_BASE = {
  kind: 'directory',
  // references/*.md 的相对解析基准，必须指向 skill 目录本身。
  path: fileURLToPath(new URL('../../skills/bcdp-browser/', import.meta.url)),
} as const

/** 随包发布的 skill 用 rank 600（同名去重时 rank 小者胜，用户自建可覆盖）。 */
const BUNDLED_SKILL_RANK = 600
/* 模型可自主加载，用户也可用 /bcdp-browser 手动加载。 */
const SKILL_INVOCATION = { modelInvocable: true, userInvocable: true } as const
/* frontmatter 缺 description 时的兜底：宿主会拒收空描述候选，没兜底等于 skill 消失。 */
const SKILL_FALLBACK_DESCRIPTION =
  "Recipes for operating a visible agent browser through the bcdp_* tools. Load before non-trivial browser work."

/**
 * 拆 frontmatter：只认扁平 `key: value`（值可带引号），认不出的行跳过。
 * 开合分隔符按开头是 \n 还是 \r\n 定档、全程沿用同一种换行符——Windows
 * checkout（git autocrlf）产出 CRLF 时不能把 YAML 头当正文喂给模型。
 */
export function parseSkillDocument(source: string): {
  fields: Record<string, string | undefined>
  body: string
} {
  const newline = source.startsWith('---\r\n') ? '\r\n' : '\n'
  const opening = `---${newline}`
  if (!source.startsWith(opening)) return { fields: {}, body: source }
  const closing = `${newline}---${newline}`
  const end = source.indexOf(closing, opening.length)
  if (end === -1) return { fields: {}, body: source }
  const fields: Record<string, string | undefined> = {}
  for (const line of source.slice(opening.length, end).split(newline)) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/u.exec(line)
    if (match === null) continue
    const value = match[2].trim().replace(/^(['"])([\s\S]*)\1$/u, '$2')
    if (value !== '') fields[match[1]] = value
  }
  return { fields, body: source.slice(end + closing.length) }
}

/**
 * 每次现读盘：改 SKILL.md 下一次发现就生效，不用重装插件。
 * 读失败让它抛——宿主会 catch 并打 provider skipped 警告，比静默返回空目录好排查。
 */
async function loadSkillDocument(signal?: AbortSignal) {
  const source = await readFile(SKILL_URL, { encoding: 'utf8', ...(signal ? { signal } : {}) })
  const { fields, body } = parseSkillDocument(source)
  return {
    candidate: {
      name: SKILL_NAME,
      description: fields.description ?? SKILL_FALLBACK_DESCRIPTION,
      // whenToUse 是宿主的可选路由补充字段：frontmatter 写了才带上。
      ...(fields.whenToUse !== undefined ? { whenToUse: fields.whenToUse } : {}),
      invocation: SKILL_INVOCATION,
      provider: SKILL_PROVIDER_NAME,
      source: 'bundled',
      resourceBase: SKILL_RESOURCE_BASE,
      rank: BUNDLED_SKILL_RANK,
      locator: SKILL_URL,
      path: fileURLToPath(SKILL_URL),
      metadata: fields,
    },
    content: body,
  }
}

export const skillProvider = {
  name: SKILL_PROVIDER_NAME,
  async list(options: { signal?: AbortSignal } = {}) {
    const { candidate } = await loadSkillDocument(options.signal)
    return [candidate]
  },
  async get(selected: { name: string }, options: { signal?: AbortSignal } = {}) {
    if (selected.name !== SKILL_NAME) return undefined
    const { candidate, content } = await loadSkillDocument(options.signal)
    return { ...candidate, content }
  },
}

/*
 * 系统提示段：让模型一开始就知道"有这个东西"，而不是等看见工具列表才猜。
 * 只写两句：入口（先 help）+ 加载时机 + 安全底线。
 */
const PROMPT_SECTION = [
  'A visible agent browser is available through the bcdp_* tools.',
  'In lazy mode only bcdp_help is resident — call it first; it returns the live backend, task space and unlocked tool batches.',
  'Load the `bcdp-browser` skill before non-trivial browser work, and treat the user\'s browser, tabs and logins as their own.',
].join(' ')

export const name = 'bcdp-skill'
export const inject: string[] = []

export function apply(ctx: Context): void {
  // 软依赖 skills：服务缺席时本模块加载不受影响。
  ctx.inject(['skills'], (skillCtx) => {
    const skills = (
      skillCtx as unknown as { skills: { registerProvider(factory: () => unknown): void } }
    ).skills
    skills.registerProvider(() => skillProvider)
  })
  // 软依赖 systemPrompt：缺席时只是少一段引导。
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const prompt = (
      promptCtx as unknown as {
        systemPrompt: { section(section: { name: string; order: number; text: string }): void }
      }
    ).systemPrompt
    prompt.section({ name: 'bcdp-browser', order: 150, text: PROMPT_SECTION })
  })
}
