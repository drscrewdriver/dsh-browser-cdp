import { describe, it, expect } from 'vitest'
import { apply, pageOverlayExpr } from '../src/index.ts'
import { SENTINEL } from '../src/util.ts'

/**
 * 页面内覆盖层（CDP 通道）的静态闸。
 *
 * 为什么要测：覆盖层是**注入到用户页面**的东西，坏了的形态不是报错而是
 * 「污染 agent 自己的读取面」（innerText 里多一行、AX 树里多一个可点元素、
 * 点击被挡住）。这些性质无法靠截图发现，只能靠断言钉住。
 */
const mountCapturing = (config: Record<string, unknown> = {}) => {
  config = { toolInjection: 'always', ...config }
  let lastScript = ''
  const handles = new Map<string, any>()
  const reader = (text: string) => ({ readFrom: () => ({ text, nextOffset: text.length, lossy: false }) })
  const ctx: any = {
    tools: { register: (tool: any) => { handles.set(tool.name, tool); return () => {} } },
    subprocess: {
      spawn: (req: any) => {
        lastScript = req?.stdio?.stdin?.data ?? ''
        const text = SENTINEL + JSON.stringify({ ok: true })
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: { stdout: reader(text), stderr: reader('') },
        }
      },
    },
    on: () => () => {},
    effect: (fn: () => unknown) => { try { fn() } catch { /* 替身不为难子模块 */ } },
    logger: { info() {}, warn() {}, error() {} },
  }
  apply(ctx, config as never)
  const run = async (name: string, args: Record<string, unknown>) => {
    await handles.get(name).execute(args, {})
    return lastScript
  }
  return { run, handles }
}

describe('pageOverlayExpr：注入到页面的那坨代码自身的性质', () => {
  const expr = pageOverlayExpr('正在点击', 'Clicking')

  it('closed shadow DOM —— 页面 innerText / 正文抽取看不到角标文字', () => {
    expect(expr).toContain("attachShadow({ mode: 'closed' })")
  })

  it('aria-hidden + pointer-events:none —— 不进 AX 树、不挡点击', () => {
    expect(expr).toContain("setAttribute('aria-hidden', 'true')")
    expect(expr).toContain('pointer-events:none')
  })

  it('单一宿主 id 常量复用 —— 多次调用不会在 DOM 里堆一摞角标', () => {
    expect(expr).toContain("getElementById('__dsh_overlay__')")
  })

  it('自带 4s 淡出与异常兜底 —— 失败不抛到工具链路上', () => {
    expect(expr).toContain('setTimeout')
    expect(expr).toContain('catch (e) {}')
  })

  it('取词按 navigator.language —— 中文环境显示中文，其余英文', () => {
    expect(expr).toContain("indexOf('zh') === 0")
    expect(expr).toContain('正在点击')
    expect(expr).toContain('Clicking')
  })
})

describe('覆盖层接线：哪些工具带前缀、哪些刻意不带', () => {
  it('bcdp_click 的脚本带覆盖层前缀', async () => {
    const { run } = mountCapturing()
    const script = await run('bcdp_click', { selector: '#go' })
    expect(script).toContain('__dsh_overlay__')
    expect(script).toContain('正在点击')
  })

  it('页面侧与面板侧的词表是同一个（host 单一真源），排除只发生在页面侧', async () => {
    const { TOOL_ACTION_LABELS } = await import('../src/cast-server.ts')
    // 药丸词表必须有 wait：面板说「正在等待」，页面不说。
    expect(TOOL_ACTION_LABELS.bcdp_wait).toEqual({ zh: '正在等待', en: 'Waiting' })
    // 元工具不在表里：它们不改页面，「正在读取页面」对它们是假话。
    expect(TOOL_ACTION_LABELS.bcdp_status).toBeUndefined()
    expect(TOOL_ACTION_LABELS.bcdp_help).toBeUndefined()
  })

  it('bcdp_snapshot（只看不改）也带前缀 —— 「查看」同样要让人看见', async () => {
    const { run } = mountCapturing()
    const script = await run('bcdp_snapshot', {})
    expect(script).toContain('__dsh_overlay__')
    expect(script).toContain('正在读取页面')
  })

  it('bcdp_wait 刻意不带：waitForFunction 必须在最外层（对象链问题），加 try 前缀会毁掉它', async () => {
    // 词表（host 的 TOOL_ACTION_LABELS）里**有** bcdp_wait——面板药丸要显示
    // 「正在等待」；页面侧被 PAGE_OVERLAY_EXCLUDED 排除。两处口径不同是刻意的：
    // 面板不往页面塞脚本，所以不受 waitForFunction 的对象链约束。
    const { run } = mountCapturing()
    const script = await run('bcdp_wait', { op: 'function', expression: '1===1' })
    expect(script).not.toContain('__dsh_overlay__')
    expect(script).not.toMatch(/try\s*\{[\s\S]*waitForFunction/)
  })
})
