import { describe, expect, it } from 'vitest'
import {
  notStartedMessage,
  shouldLaunchOnCall,
  shouldLaunchOnMount,
  toolTouchesPage,
  type LocalBrowserPower,
  type LocalLaunchPolicy,
} from '../src/local-launch.ts'

/** 非页面工具：调用它们不得触发启动（issue #14 的验收 1）。 */
describe('toolTouchesPage — non-page tools', () => {
  it('never touches a page for the read-only tools', () => {
    for (const name of ['bcdp_status', 'bcdp_help', 'bcdp_doctor', 'bcdp_jev_status']) {
      expect(toolTouchesPage(name, {})).toBe(false)
    }
  })

  it('treats legacy ego_* aliases as the same tool', () => {
    expect(toolTouchesPage('ego_status', {})).toBe(false)
    expect(toolTouchesPage('ego_navigate', { url: 'https://x' })).toBe(true)
  })

  it('treats read-only ops as not touching a page', () => {
    expect(toolTouchesPage('bcdp_tab', { op: 'list' })).toBe(false)
    expect(toolTouchesPage('bcdp_space', { op: 'list' })).toBe(false)
    expect(toolTouchesPage('bcdp_space', { op: 'close' })).toBe(false)
  })

  it('treats every other op as touching a page', () => {
    expect(toolTouchesPage('bcdp_tab', { op: 'new' })).toBe(true)
    expect(toolTouchesPage('bcdp_tab', { op: 'switch' })).toBe(true)
    expect(toolTouchesPage('bcdp_space', { op: 'open' })).toBe(true)
  })

  it('bcdp_tab defaults to list (its own default) when op is absent', () => {
    expect(toolTouchesPage('bcdp_tab', {})).toBe(false)
  })

  it('an unparsable op on bcdp_space is NOT optimistically treated as read-only', () => {
    // bcdp_space 的默认 op 是 open —— 取不到字符串时按碰页面处理。
    expect(toolTouchesPage('bcdp_space', { op: 123 })).toBe(true)
    expect(toolTouchesPage('bcdp_space', {})).toBe(true)
  })

  it('defaults unknown tools to touching a page (fail toward launching)', () => {
    expect(toolTouchesPage('bcdp_navigate', { url: 'https://x' })).toBe(true)
    expect(toolTouchesPage('bcdp_script', { code: '1' })).toBe(true)
    expect(toolTouchesPage('bcdp_brand_new_tool', {})).toBe(true)
  })
})

/** 挂载闸门矩阵（spec 的 (policy × power) 表）。 */
describe('shouldLaunchOnMount', () => {
  const cases: Array<[LocalLaunchPolicy, LocalBrowserPower, boolean]> = [
    ['eager', 'auto', true],
    ['on-demand', 'auto', false],
    ['manual', 'auto', false],
    ['on-demand', 'off', false],
    ['eager', 'off', false],
    ['on-demand', 'on', true],
    ['manual', 'on', true],
    ['eager', 'on', true],
  ]
  for (const [policy, power, want] of cases) {
    it(`${policy} + ${power} -> ${want}`, () => {
      expect(shouldLaunchOnMount(policy, power)).toBe(want)
    })
  }

  it('off always wins, even over eager', () => {
    expect(shouldLaunchOnMount('eager', 'off')).toBe(false)
  })
})

/** 调用闸门：on-demand 放行、manual 拒绝、非页面工具恒拒绝。 */
describe('shouldLaunchOnCall', () => {
  it('lets on-demand start on a real page tool', () => {
    expect(shouldLaunchOnCall('on-demand', 'auto', 'bcdp_navigate', { url: 'https://x' })).toBe(true)
  })

  it('refuses manual even for a real page tool', () => {
    expect(shouldLaunchOnCall('manual', 'auto', 'bcdp_navigate', { url: 'https://x' })).toBe(false)
  })

  it('never starts for a non-page tool, under any policy', () => {
    for (const policy of ['eager', 'on-demand', 'manual'] as const) {
      expect(shouldLaunchOnCall(policy, 'auto', 'bcdp_status', {})).toBe(false)
    }
  })

  it('power=off refuses everything', () => {
    expect(shouldLaunchOnCall('eager', 'off', 'bcdp_navigate', { url: 'https://x' })).toBe(false)
  })

  it('power=on overrides manual for a page tool', () => {
    expect(shouldLaunchOnCall('manual', 'on', 'bcdp_navigate', { url: 'https://x' })).toBe(true)
  })

  it('power=on still does not start for a read-only tool', () => {
    expect(shouldLaunchOnCall('eager', 'on', 'bcdp_tab', { op: 'list' })).toBe(false)
  })
})

/** 文案必须可执行：每条分支都要给出下一步命令。 */
describe('notStartedMessage', () => {
  it('names the command to re-enable a switched-off session', () => {
    expect(notStartedMessage('on-demand', 'off')).toContain('/bcdp browser on')
  })

  it('names the command for manual policy', () => {
    expect(notStartedMessage('manual', 'auto')).toContain('/bcdp browser start')
  })

  it('never says "try again later" (not actionable)', () => {
    for (const [policy, power] of [['eager', 'off'], ['manual', 'auto'], ['on-demand', 'auto']] as const) {
      expect(notStartedMessage(policy, power)).not.toMatch(/try again|later/i)
    }
  })
})
