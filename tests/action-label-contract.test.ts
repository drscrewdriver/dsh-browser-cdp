/**
 * 面板活动药丸的 host→client 契约闸。
 *
 * 为什么要测：药丸依赖一条**跨进程**的隐式契约——host 在每个 bcdp_* 调用顶部
 * 推一条带 `label` 的 `tool-call` SSE 事件，客户端按当前语言取一个词来显示。
 * 这条链上的任何一环坏掉都不会报错，只会"面板什么都不显示"，是最难发现的形态：
 *   host 没传工具名 → label 缺失 → 客户端静默 return；
 *   词表里没有该工具 → label 缺失 → 同上；
 *   词表两边各写一份 → 漂移（所以只准 host 有）。
 */
import { describe, it, expect } from 'vitest'
import { TOOL_ACTION_LABELS } from '../src/cast-server.ts'

describe('TOOL_ACTION_LABELS：host 侧唯一真源', () => {
  it('覆盖所有"会碰页面"的工具（缺一个就等于那个动作永远不显示）', () => {
    const must = [
      'bcdp_snapshot', 'bcdp_click', 'bcdp_fill', 'bcdp_js', 'bcdp_script',
      'bcdp_navigate', 'bcdp_screenshot', 'bcdp_scroll', 'bcdp_key',
      'bcdp_tab', 'bcdp_wait', 'bcdp_select', 'bcdp_check', 'bcdp_drag',
      'bcdp_upload', 'bcdp_download', 'bcdp_page_info', 'bcdp_hover',
    ]
    for (const name of must) expect(TOOL_ACTION_LABELS[name], name).toBeDefined()
  })

  it('元工具不在表里：它们不碰页面，"正在读取页面"对它们是假话', () => {
    for (const name of ['bcdp_status', 'bcdp_help', 'bcdp_doctor']) {
      expect(TOOL_ACTION_LABELS[name], name).toBeUndefined()
    }
  })

  it('每个词都同时有 zh 与 en —— 少一个就有语言会显示空白', () => {
    for (const [name, label] of Object.entries(TOOL_ACTION_LABELS)) {
      expect(label.zh, name).toBeTruthy()
      expect(label.en, name).toBeTruthy()
    }
  })

  it('文案短（药丸是 10.5px 的窄标签，长了会把标题挤掉）', () => {
    for (const [name, label] of Object.entries(TOOL_ACTION_LABELS)) {
      expect(label.zh.length, name).toBeLessThanOrEqual(10)
      expect(label.en.length, name).toBeLessThanOrEqual(18)
    }
  })
})
