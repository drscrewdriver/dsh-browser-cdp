import { describe, it, expect } from 'vitest'
import { apply } from '../src/index.ts'

/**
 * 宿主侧冒烟：用最小 ctx 把插件真跑一遍 apply()，验证
 *   1) `ctx.inject(['commands'])` 门控真的触发命令注册
 *   2) 注册出来的 handler 能在不碰模型/子进程的情况下返回契约文本
 *
 * 这不是替代 dsh-tui 端到端（那需要 token 鉴权），而是把「apply → 注册 → 执行」
 * 这一段在进程内跑实，避免只靠静态 grep 证明产物里有字符串。
 */
function makeHost() {
  const registrations: Array<Record<string, unknown>> = []
  const commands = {
    register: (definition: unknown) => {
      registrations.push(definition as Record<string, unknown>)
      return () => {}
    },
    list: () => registrations,
  }
  const settingsStore = { value: {} as Record<string, unknown>, revision: 1 }
  const ctx: Record<string, unknown> = {
    tools: { register: (tool: unknown) => tool, restrict: () => {} },
    subprocess: {
      spawn: () => {
        throw new Error('host-smoke: 子进程在冒烟里被禁止')
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    get: (name: string) => {
      if (name === 'settings') return { describe: () => [{ ns: 'dsh-browser-cdp', value: settingsStore.value, revision: settingsStore.revision }] }
      return undefined
    },
    on: () => () => {},
    effect: (fn: () => unknown) => {
      const disposer = fn()
      return () => { if (typeof disposer === 'function') (disposer as () => void)() }
    },
    inject: (deps: string[], callback: (forked: unknown) => void) => {
      if (!deps.includes('commands')) return
      callback({ ...ctx, commands })
    },
  }
  return { ctx, registrations }
}

describe('browser-cdp host smoke', () => {
  it('apply() 在最小宿主上注册 /bcdp，且 status 子命令可执行', async () => {
    const { ctx, registrations } = makeHost()
    apply(ctx as never, {})
    const bcdp = registrations.find((entry) => entry.name === 'bcdp')
    expect(bcdp, 'apply() 应通过 ctx.inject([commands]) 注册 /bcdp').toBeTruthy()
    expect(String((bcdp!.input as { hint?: string }).hint)).toContain('status')

    const handler = bcdp!.handler as (invocation: { rawInput?: string }) => Promise<{ kind: string; text: string }>
    const result = await handler({ rawInput: 'status' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('bcdp status')
    expect(result.text.split('\n').length).toBeLessThanOrEqual(40)
    for (const line of result.text.split('\n')) expect(line.length).toBeLessThanOrEqual(80)

    const help = await handler({ rawInput: 'help' })
    expect(help.text).toContain('/bcdp tabs')
  })
})
