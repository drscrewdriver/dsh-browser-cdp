import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'

/**
 * The mount-time promise is "changing settings does not pop a browser window"
 * (client copy: 「设置面板改完即生效，不弹窗」). That promise is about WHICH
 * command the attach probe spawns, so this test records every spawn instead of
 * looking at the resulting state:
 *
 *   allowProbeColdStart = false (default) → only the side-effect-free `--status`
 *                                            form; never a `nodejs` heredoc.
 *   allowProbeColdStart = true             → the heredoc is allowed (that is
 *                                            what the switch names).
 *
 * It is the unit-level equivalent of "挂载后 10 s 内没有新窗口" — a real window
 * cannot be observed from a test, but the command that would create one can.
 */
const mountEgoCli = (over: Record<string, unknown> = {}) => {
  const spawns: string[][] = []
  const teardown: Array<() => void> = []
  const handles = new Map<string, any>()
  const ctx: any = {
    tools: {
      register: (tool: { name?: string }) => {
        if (typeof tool?.name === 'string') handles.set(tool.name, tool)
        return () => { handles.delete(tool.name as string) }
      },
    },
    subprocess: {
      spawn: (req: { argv?: string[] }) => {
        spawns.push([...(req.argv ?? [])])
        // Fail fast: a probe that "succeeds" would start the pollers and make the
        // assertion noisy. The argv is what we are checking.
        return {
          done: Promise.resolve({ exitCode: 1, signal: null }),
          collected: {
            stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
            stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
          },
        }
      },
    },
    on: () => () => {},
    effect: (fn: () => unknown) => {
      try {
        const dispose = fn()
        if (typeof dispose === 'function') teardown.push(dispose as () => void)
      } catch { /* headless host: a sub-module may not mount */ }
    },
    logger: { info() {}, warn() {}, error() {} },
  }
  apply(ctx, {
    links: [{ id: 'cli', kind: 'ego-cli', label: 'ego', enabled: true, cliPath: '' }],
    activeTargetId: 'cli',
    ...over,
  } as never)
  return { spawns, teardown, handles }
}

describe('mount-time attach probe (cold-start gate)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('spawns no heredoc when allowProbeColdStart is off (the default)', async () => {
    const { spawns, teardown } = mountEgoCli({ allowProbeColdStart: false })
    await vi.advanceTimersByTimeAsync(1500)
    const commands = spawns.map((argv) => argv.join(' '))
    expect(commands.some((command) => command.includes('--status')), `expected a --status probe, saw: ${JSON.stringify(commands)}`).toBe(true)
    expect(commands.some((command) => command.includes('nodejs')), `no heredoc may run on mount, saw: ${JSON.stringify(commands)}`).toBe(false)
    for (const dispose of teardown) dispose()
  })

  it('allows the heredoc only when the switch is explicitly on', async () => {
    const { spawns, teardown } = mountEgoCli({ allowProbeColdStart: true })
    await vi.advanceTimersByTimeAsync(1500)
    const commands = spawns.map((argv) => argv.join(' '))
    expect(commands.some((command) => command.includes('nodejs')), `expected the cold-start heredoc, saw: ${JSON.stringify(commands)}`).toBe(true)
    for (const dispose of teardown) dispose()
  })

  it('never probes a tabbit link with `diagnose` on mount', async () => {
    const { spawns, teardown } = mountEgoCli({
      links: [{ id: 'tb', kind: 'tabbit-cli', label: 'Tabbit', enabled: true, cliPath: '' }],
      activeTargetId: 'tb',
    })
    await vi.advanceTimersByTimeAsync(1500)
    // Measured: `tabbit-cli diagnose` starts the browser (5 processes) — a mount
    // probe must never do that, so the tabbit runtime only checks the CLI path.
    expect(spawns.map((argv) => argv.join(' ')).some((command) => command.includes('diagnose'))).toBe(false)
    for (const dispose of teardown) dispose()
  })

  it('spends no subprocess in a minute when nobody is watching the panel', async () => {
    // The measured incident: the frame poller alone burned the Tabbit 1024-receipt
    // budget in ~51 minutes (one nodejs per 3 s). With no panel subscriber there
    // is nothing to render, so the automatic sources must spawn NOTHING — this is
    // the ≥80% spawn reduction, taken to 100% for the idle case.
    const { spawns, teardown } = mountEgoCli({
      links: [{ id: 'tb', kind: 'tabbit-cli', label: 'Tabbit', enabled: true, cliPath: '' }],
      activeTargetId: 'tb',
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(spawns.map((argv) => argv.join(' '))).toEqual([])
    for (const dispose of teardown) dispose()
  })

  it('the doctor explains the automatic sources (else a still panel is unexplainable)', async () => {
    const mounted = mountEgoCli({ allowProbeColdStart: false })
    await vi.advanceTimersByTimeAsync(1500)
    // One pulse opens the act tier, which is where bcdp_doctor lives.
    await mounted.handles.get('bcdp_status').execute({}, {})
    const doctor = mounted.handles.get('bcdp_doctor')
    expect(doctor, 'bcdp_doctor should be registered after one pulse').toBeDefined()
    const value = await doctor.execute({}, {})
    const report = String(value.report ?? '')
    expect(report).toContain('auto sources:')
    expect(report).toMatch(/probe=\d+/)
    expect(report).toMatch(/ticks \d+\/\d+/)
    expect(report).toContain('tabbit receipts:')
    for (const dispose of mounted.teardown) dispose()
  })
})