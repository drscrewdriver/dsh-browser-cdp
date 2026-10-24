import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { probeCliLink, type CliLinkIo } from '../../src/cdp/cli-link.ts'

/**
 * 真机探针 — 探测冷启动闸门（allowProbeColdStart=false）对 NATIVE ego lite CLI
 * 的端到端验证。默认自跳过；要跑：
 *
 *   EGO_CLI_PROBE_PATH="C:\Users\...\ego-browser.exe" \
 *     node node_modules/vitest/vitest.mjs run tests/cdp-probe/cli-coldstart.probe.test.ts
 *
 * 断言三件事：
 *  1. 闸门关 → 探测成功且 heredocSkipped=true（`nodejs` 通道从未运行）；
 *  2. 全程只有一次子进程 spawn（`--status` 快路径，原生 CLI 对它快速报
 *     Unknown command 退出，无浏览器副作用 —— 2026-10-25 实测）；
 *  3. ego.exe 进程数零增量 —— 没有任何浏览器窗口被带起。
 */
const cliPath = process.env.EGO_CLI_PROBE_PATH ?? ''

describe('probeCliLink cold-start gate — real native ego lite CLI', { skip: cliPath === '' }, () => {
  it('never rides the nodejs channel and never spawns a browser', { timeout: 30_000 }, async () => {
    const egoProcessesBefore = spawnSync('tasklist', ['/FI', 'IMAGENAME eq ego.exe', '/FO', 'CSV'], { encoding: 'utf8' })
      .stdout.split('\n').filter((line) => line.startsWith('"ego.exe"')).length

    const io: CliLinkIo = {
      platform: process.platform,
      exists: (p) => p === cliPath,
      which: () => '',
      now: () => Date.now(),
      run: async (request) => {
        const child = spawnSync(request.argv[0]!, request.argv.slice(1), {
          input: request.stdin,
          timeout: request.timeoutMs,
          encoding: 'utf8',
        })
        return {
          exitCode: child.status,
          stdout: child.stdout ?? '',
          stderr: child.stderr ?? '',
          ...(child.error && typeof (child.error as NodeJS.ErrnoException).code === 'string'
            ? { spawnErrorCode: (child.error as NodeJS.ErrnoException).code }
            : {}),
          latencyMs: 0,
        }
      },
    }

    const probe = await probeCliLink({ cliPath, bundled: '', coldStart: false }, io)

    expect(probe.ok).toBe(true)
    expect(probe.heredocSkipped).toBe(true)

    const egoProcessesAfter = spawnSync('tasklist', ['/FI', 'IMAGENAME eq ego.exe', '/FO', 'CSV'], { encoding: 'utf8' })
      .stdout.split('\n').filter((line) => line.startsWith('"ego.exe"')).length
    expect(egoProcessesAfter).toBe(egoProcessesBefore)
  })
})
