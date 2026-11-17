import { describe, it, expect } from 'vitest'
import {
  parseBcdpArgs,
  clip,
  renderLines,
  runBcdpCommand,
  registerBcdpCommand,
  type BcdpCommandDeps,
} from '../src/tui-command.ts'

/** 纯 deps 桩：不碰 host、不碰 subprocess —— 命令层单测不打真实通道。 */
function deps(overrides: Partial<BcdpCommandDeps> = {}): BcdpCommandDeps {
  return {
    attach: () => ({
      status: 'ready',
      mode: 'cdp',
      targetId: 'browser-1',
      endpoint: 'http://127.0.0.1:9222',
      wsUrl: 'ws://127.0.0.1:9222/devtools/browser/x',
      code: '',
      message: '',
      latencyMs: 42,
      resolvedAt: 1,
      cliPath: '/usr/local/bin/ego-browser',
    }) as never,
    link: () => ({ id: 'local', kind: 'ego-cli' }) as never,
    links: () => [
      { id: 'local', kind: 'ego-cli', active: true },
      { id: 'chrome', kind: 'attach', active: false },
    ],
    surface: () => ({ live: ['bcdp_status', 'bcdp_click'], sealed: ['bcdp_cdp'] }),
    config: () => ({
      egoBin: 'ego-browser',
      toolInjection: 'lazy',
      activeSpace: 'demo',
      toolBrowse: true,
      toolExtended: false,
      toolEscape: false,
      toolJudge: true,
      judgeConfigured: true,
    }),
    poll: () => ({ running: true, lastFrameAgeMs: 1200, frameSeq: 7 }),
    watch: () => ({ calls: 3, refused: 1 }),
    runTool: async (name) => {
      if (name === 'bcdp_tab') {
        return {
          ok: true,
          tabs: [
            { targetId: 't1', title: 'Example', url: 'https://example.com', active: true, index: 0 },
            { targetId: 't2', title: 'Docs', url: 'https://example.com/docs', active: false, index: 1 },
          ],
        }
      }
      if (name === 'bcdp_screenshot') return { ok: true, path: '/tmp/shot.png' }
      if (name === 'bcdp_navigate') return { ok: true, page: { url: 'https://example.com', title: 'Example' } }
      throw new Error(`unexpected tool ${name}`)
    },
    setActiveTarget: async () => ({ ok: true }),
    localBrowser: {
      status: () => ({ running: false, policy: 'on-demand', power: 'auto', endpoint: null }),
      start: async () => ({ ok: true }),
      stop: async () => ({ ok: true }),
    },
    ...overrides,
  }
}

describe('parseBcdpArgs', () => {
  it('空输入默认 status，且默认 dry', () => {
    const parsed = parseBcdpArgs('')
    expect(parsed.argv).toEqual([])
    expect(parsed.json).toBe(false)
    expect(parsed.dry).toBe(true)
  })

  it('识别 --json / --yes / 子命令', () => {
    const parsed = parseBcdpArgs('  status  --json --yes ')
    expect(parsed.argv).toEqual(['status'])
    expect(parsed.json).toBe(true)
    expect(parsed.yes).toBe(true)
    expect(parsed.dry).toBe(false)
  })
})

describe('renderLines / clip', () => {
  it('单行超过宽度上限被裁断（当前 80，契约上限 100）', () => {
    const clipped = clip('x'.repeat(140))
    expect(clipped.length).toBe(80)
    expect(clipped.endsWith('…')).toBe(true)
  })

  it('超过 40 行时给 --all 提示', () => {
    const text = renderLines(Array.from({ length: 50 }, (_, i) => `line ${i}`))
    const lines = text.split('\n')
    expect(lines.length).toBe(40)
    expect(lines[lines.length - 1]).toContain('--all')
  })

  it('40 行以内不插提示', () => {
    expect(renderLines(['a', 'b'])).toBe('a\nb')
  })

  it('两空格对齐不被折叠', () => {
    expect(renderLines(['  tools     live 2'])).toBe('  tools     live 2')
  })
})

describe('runBcdpCommand', () => {
  it('默认输出 status，含通道/工具面/帧三行', async () => {
    const result = await runBcdpCommand('', deps())
    expect(result.kind).toBe('success')
    expect(result.text).toContain('bcdp status — ready')
    expect(result.text).toContain('tools     live 2 / sealed 1')
    expect(result.text).toContain('frames    polling')
  })

  it('/bcdp browser 默认走 status，只读且展示三层状态', async () => {
    const result = await runBcdpCommand('browser', deps())
    expect(result.kind).toBe('success')
    expect(result.text).toContain('bcdp browser — stopped')
    expect(result.text).toContain('policy   on-demand')
    expect(result.text).toContain('power    auto')
  })

  it('/bcdp browser status 只读：不调 start 也不调 stop', async () => {
    const calls: string[] = []
    const d = deps({
      localBrowser: {
        status: () => ({ running: false, policy: 'on-demand', power: 'auto', endpoint: null }),
        start: async () => { calls.push('start'); return { ok: true } },
        stop: async () => { calls.push('stop'); return { ok: true } },
      },
    })
    await runBcdpCommand('browser status', d)
    expect(calls).toEqual([])
  })

  it('/bcdp browser off 调 stop 并提示恢复方式', async () => {
    const calls: string[] = []
    const d = deps({
      localBrowser: {
        status: () => ({ running: true, policy: 'on-demand', power: 'auto', endpoint: 'http://127.0.0.1:1' }),
        start: async () => { calls.push('start'); return { ok: true } },
        stop: async () => { calls.push('stop'); return { ok: true } },
      },
    })
    const result = await runBcdpCommand('browser off', d)
    expect(calls).toEqual(['stop'])
    expect(result.kind).toBe('success')
    expect(result.text).toContain('/bcdp browser on')
  })

  it('/bcdp browser on 与 start 都调 start', async () => {
    const calls: string[] = []
    const d = deps({
      localBrowser: {
        status: () => ({ running: false, policy: 'manual', power: 'off', endpoint: null }),
        start: async () => { calls.push('start'); return { ok: true } },
        stop: async () => { calls.push('stop'); return { ok: true } },
      },
    })
    await runBcdpCommand('browser on', d)
    await runBcdpCommand('browser start', d)
    expect(calls).toEqual(['start', 'start'])
  })

  it('/bcdp browser 失败时给出下一步而不是静默成功', async () => {
    const d = deps({
      localBrowser: {
        status: () => ({ running: false, policy: 'manual', power: 'auto', endpoint: null }),
        start: async () => ({ ok: false, reason: 'chrome-not-found' }),
        stop: async () => ({ ok: false, reason: 'stop-timeout' }),
      },
    })
    const started = await runBcdpCommand('browser start', d)
    expect(started.kind).toBe('error')
    expect(started.text).toContain('chrome-not-found')
    const stopped = await runBcdpCommand('browser off', d)
    expect(stopped.kind).toBe('error')
    expect(stopped.text).toContain('stop-timeout')
  })

  it('/bcdp browser 未知子命令报错并列可选项', async () => {
    const result = await runBcdpCommand('browser toggle', deps())
    expect(result.kind).toBe('error')
    expect(result.text).toContain('[on|off|start|status]')
  })

  it('未知子命令走 error 并给下一步', async () => {
    const result = await runBcdpCommand('nope', deps())
    expect(result.kind).toBe('error')
    expect(result.text.split('\n')[0]).toContain('未知子命令')
    expect(result.text).toContain('/bcdp help')
  })

  it('--json 输出单行合法 JSON', async () => {
    const result = await runBcdpCommand('status --json', deps())
    expect(result.text.includes('\n')).toBe(false)
    const payload = JSON.parse(result.text)
    expect(payload.ok).toBe(true)
    expect(payload.cmd).toBe('bcdp')
    expect(payload.data.face).toEqual({ live: 2, sealed: 1 })
    expect(payload.data.frames.seq).toBe(7)
  })

  it('通道未就绪时给可执行的下一步', async () => {
    const notReady = deps({
      attach: () => ({
        status: 'no-active',
        mode: 'cdp',
        targetId: '',
        endpoint: '',
        wsUrl: '',
        code: 'NO_ACTIVE',
        message: 'no active browser',
        latencyMs: 0,
        resolvedAt: 0,
      }) as never,
    })
    const result = await runBcdpCommand('status', notReady)
    expect(result.text).toContain('next')
    expect(result.text).toContain('bcdp_')
  })

  it('doctor 逐项给 PASS/WARN', async () => {
    const result = await runBcdpCommand('doctor', deps())
    expect(result.text).toContain('PASS  attach ready')
    expect(result.text).toContain('4/4 pass')
  })

  it('tabs 复用 bcdp_tab op=list 并标出 active 行', async () => {
    const result = await runBcdpCommand('tabs', deps())
    expect(result.kind).toBe('success')
    expect(result.text).toContain('bcdp tabs — 2 个')
    expect(result.text).toContain('* 0  Example')
    expect(result.text).toContain('https://example.com/docs')
  })

  it('tabs 在工具返回 ok:false 时给原因', async () => {
    const broken = deps({ runTool: async () => ({ ok: false, reason: 'browser listTabs failed' }) })
    const result = await runBcdpCommand('tabs', broken)
    expect(result.kind).toBe('error')
    expect(result.text).toContain('browser listTabs failed')
  })

  it('shot 复用 bcdp_screenshot 并回路径', async () => {
    const result = await runBcdpCommand('shot /tmp/x.png', deps())
    expect(result.kind).toBe('success')
    expect(result.text).toContain('/tmp/shot.png')
  })

  it('shot 工具缺失时走 error 并指向 doctor', async () => {
    const broken = deps({
      runTool: async () => {
        throw new Error('tool bcdp_screenshot 未注册')
      },
    })
    const result = await runBcdpCommand('shot', broken)
    expect(result.kind).toBe('error')
    expect(result.text).toContain('/bcdp doctor')
  })

  it('nav 复用 bcdp_navigate 并回显页面', async () => {
    const result = await runBcdpCommand('nav https://example.com', deps())
    expect(result.kind).toBe('success')
    expect(result.text).toContain('bcdp nav')
    expect(result.text).toContain('Example')
  })

  it('attach 无参列出连接项', async () => {
    const result = await runBcdpCommand('attach', deps())
    expect(result.text).toContain('连接项')
    expect(result.text).toContain('local')
  })

  it('attach 已激活项直接回执', async () => {
    const result = await runBcdpCommand('attach local', deps())
    expect(result.text).toContain('已是激活项')
  })

  it('attach 默认 dry，--yes 才切换', async () => {
    const calls: Array<{ id: string; dry: boolean }> = []
    const probe = deps({ setActiveTarget: async (id, dry) => { calls.push({ id, dry }); return { ok: true } } })
    const dry = await runBcdpCommand('attach chrome', probe)
    expect(dry.text).toContain('dry run')
    expect(calls[0]).toEqual({ id: 'chrome', dry: true })
    await runBcdpCommand('attach chrome --yes', probe)
    expect(calls[1]).toEqual({ id: 'chrome', dry: false })
  })

  it('attach 未知 id 走 error', async () => {
    const result = await runBcdpCommand('attach nope', deps())
    expect(result.kind).toBe('error')
    expect(result.text).toContain('/bcdp link')
  })
})

describe('registerBcdpCommand', () => {
  it('向宿主命令表注册 bcdp，并可被 /bcdp status 直接执行', async () => {
    const registered: Array<Record<string, unknown>> = []
    const fakeCtx = {
      commands: { register: (definition: unknown) => { registered.push(definition as Record<string, unknown>); return () => {} } },
    }
    registerBcdpCommand(fakeCtx as never, deps())
    expect(registered).toHaveLength(1)
    const [definition] = registered
    expect(definition.name).toBe('bcdp')
    expect(String(definition.input && (definition.input as { hint?: string }).hint)).toContain('status')
    const handler = definition.handler as (invocation: { rawInput?: string }) => Promise<{ kind: string; text: string }>
    const result = await handler({ rawInput: 'status' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('bcdp status')
  })

  it('宿主没有 commands 服务时静默跳过', () => {
    expect(() => registerBcdpCommand({} as never, deps())).not.toThrow()
  })
})
