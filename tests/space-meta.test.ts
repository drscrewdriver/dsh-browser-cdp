/**
 * 侧栏元数据行的契约闸（M1–M8）。
 *
 * 为什么这些看起来"只是格式化"的东西值得一整个测试文件：
 *   - 这些字段**全部来自另一个进程**（worker / host），缺席是正常工况而不是异常。
 *     一个 `undefined` 处理错就会在面板上印出 `undefined×undefined` 或 `0s 前`；
 *   - `lastActive=0` 必须**不显示**（worker 没采到帧），而不是显示 1970 年——
 *     这正是"时间格式化"类代码最常见的错法；
 *   - 距今文案是最容易被"每隔一秒重算一次"带偏的地方，档位边界必须钉死；
 *   - 浮窗（vanilla DOM）与侧栏 Tab（React）共用同一份字符串，任何一边自己拼
 *     都会漂移，所以这里既测分段也测整行。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSpacesCoalescer,
  formatElapsed,
  formatOwner,
  formatPageCount,
  formatReadyState,
  formatSpaceMeta,
  formatViewport,
  formatZoom,
  joinMeta,
  metaText,
  truncateLastActive,
} from '../src/client/space-meta.ts'
import { SPACE_META_EN, SPACE_META_ZH } from '../src/client/locales.ts'

const zh = metaText(SPACE_META_ZH, SPACE_META_EN)
const en = metaText(SPACE_META_EN)

describe('formatElapsed：四档距今 + 0 判空', () => {
  const now = 1_000_000_000

  it('lastActive=0 / 缺失 / 负数 → null（不得显示 1970）', () => {
    expect(formatElapsed(0, now, zh)).toBeNull()
    expect(formatElapsed(undefined, now, zh)).toBeNull()
    expect(formatElapsed(null, now, zh)).toBeNull()
    expect(formatElapsed(-1, now, zh)).toBeNull()
    expect(formatElapsed(Number.NaN, now, zh)).toBeNull()
  })

  it('刚刚 / Ns 前 / Nm 前 / Nh 前 四档', () => {
    expect(formatElapsed(now - 500, now, zh)).toBe('刚刚')
    expect(formatElapsed(now - 3_000, now, zh)).toBe('3s 前')
    expect(formatElapsed(now - 59_000, now, zh)).toBe('59s 前')
    expect(formatElapsed(now - 60_000, now, zh)).toBe('1m 前')
    expect(formatElapsed(now - 12 * 60_000, now, zh)).toBe('12m 前')
    expect(formatElapsed(now - 3_600_000, now, zh)).toBe('1h 前')
    expect(formatElapsed(now - 2 * 3_600_000, now, zh)).toBe('2h 前')
  })

  it('时钟回拨（lastActive 在未来）夹到「刚刚」，不出现负数', () => {
    expect(formatElapsed(now + 5_000, now, zh)).toBe('刚刚')
  })

  it('切语言后同一时刻换一套词', () => {
    expect(formatElapsed(now - 42_000, now, en)).toBe('42s ago')
  })
})

describe('formatViewport / formatZoom / formatReadyState', () => {
  it('viewport 只认两个正整数', () => {
    expect(formatViewport({ viewportW: 1280, viewportH: 720 })).toBe('1280×720')
    expect(formatViewport({ viewportW: 1280 })).toBeNull()
    expect(formatViewport({ viewportW: 0, viewportH: 720 })).toBeNull()
    expect(formatViewport({ viewportW: Number.NaN, viewportH: 720 })).toBeNull()
    expect(formatViewport(null)).toBeNull()
  })

  it('zoom=100 与 dpr=1 都不显示（默认态不占位）', () => {
    expect(formatZoom(1, 100, zh)).toBeNull()
    expect(formatZoom(undefined, undefined, zh)).toBeNull()
    expect(formatZoom(1, null, zh)).toBeNull()
  })

  it('非 100% 缩放与非 1 的 DPR', () => {
    expect(formatZoom(undefined, 80, zh)).toBe('80%')
    expect(formatZoom(1.25, undefined, zh)).toBe('@1.25')
    expect(formatZoom(1.25, 80, zh)).toBe('@1.25 · 80%')
    expect(formatZoom(2, 100, zh)).toBe('@2')
  })

  it('readyState：只有 loading 出现', () => {
    expect(formatReadyState('loading', zh)).toBe('加载中')
    expect(formatReadyState('interactive', zh)).toBeNull()
    expect(formatReadyState('complete', zh)).toBeNull()
    expect(formatReadyState(undefined, zh)).toBeNull()
  })
})

describe('formatOwner：ownership + 会话归属', () => {
  it('agent / 你 / 未知', () => {
    expect(formatOwner({ source: 'agent' }, zh)).toBe('agent')
    expect(formatOwner({ source: 'operator' }, zh)).toBe('你')
    expect(formatOwner({ source: 'agent' }, en)).toBe('agent')
    expect(formatOwner({ source: 'operator' }, en)).toBe('you')
  })

  it('没有 focus 事件时整段缺席', () => {
    expect(formatOwner(null, zh)).toBeNull()
    expect(formatOwner(undefined, zh)).toBeNull()
    expect(formatOwner({}, zh)).toBeNull()
    expect(formatOwner({ sessionId: '   ' }, zh)).toBeNull()
  })

  it('会话只取前 4 位，且与 owner 同行', () => {
    expect(formatOwner({ source: 'agent', sessionId: 'a1b2c3d4' }, zh)).toBe('agent · 会话 a1b2')
    expect(formatOwner({ source: 'agent', sessionId: 'a1b2c3d4' }, en)).toBe('agent · session a1b2')
    expect(formatOwner({ sessionId: 'a1b2c3d4' }, zh)).toBe('会话 a1b2')
  })
})

describe('formatSpaceMeta：整行顺序与缺席', () => {
  const now = 1_700_000_000_000

  it('验收口径：1200×800 · 3s 前 · agent · 会话 a1b2', () => {
    const line = joinMeta(formatSpaceMeta({
      row: { viewportW: 1200, viewportH: 800, lastActive: now - 3_000 },
      owner: { source: 'agent', sessionId: 'a1b2ff' },
    }, now, zh))
    expect(line).toBe('1200×800 · 3s 前 · agent · 会话 a1b2')
  })

  it('capturing=false 追加「未截流」；true/undefined 不出现', () => {
    const base = { viewportW: 1200, viewportH: 800, lastActive: now - 1_000 }
    expect(joinMeta(formatSpaceMeta({ row: { ...base, capturing: false } }, now, zh))).toBe('1200×800 · 刚刚 · 未截流')
    expect(joinMeta(formatSpaceMeta({ row: { ...base, capturing: true } }, now, zh))).toBe('1200×800 · 刚刚')
    expect(joinMeta(formatSpaceMeta({ row: base }, now, zh))).toBe('1200×800 · 刚刚')
  })

  it('加载态在时间后面、owner 永远最后', () => {
    const line = joinMeta(formatSpaceMeta({
      row: { viewportW: 1200, viewportH: 800, lastActive: now - 30_000, readyState: 'loading', capturing: false },
      owner: { source: 'operator' },
    }, now, zh))
    expect(line).toBe('1200×800 · 30s 前 · 加载中 · 未截流 · 你')
  })

  it('老 worker 什么都不推：这一行是空的，不是一堆占位符', () => {
    expect(formatSpaceMeta({ row: {}, owner: null }, now, zh)).toEqual([])
    expect(formatSpaceMeta({ row: null, owner: null }, now, zh)).toEqual([])
    expect(formatSpaceMeta({}, now, zh)).toEqual([])
  })

  it('分段带 key：渲染层可以单独取某一段做角标', () => {
    const segments = formatSpaceMeta({
      row: { viewportW: 800, viewportH: 600, zoom: 80, dpr: 2, lastActive: now - 1_000 },
      owner: { source: 'agent' },
    }, now, zh)
    expect(segments.map((s) => s.key)).toEqual(['viewport', 'device', 'elapsed', 'owner'])
    expect(segments[1]?.text).toBe('@2 · 80%')
  })
})

describe('formatPageCount / truncateLastActive', () => {
  it('页数：0 不显示', () => {
    expect(formatPageCount(3, zh)).toBe('3 页')
    expect(formatPageCount(3, en)).toBe('3 pages')
    expect(formatPageCount(0, zh)).toBeNull()
    expect(formatPageCount(undefined, zh)).toBeNull()
  })

  it('lastActive 截断到秒，0/非法值归 0', () => {
    const rows = truncateLastActive([
      { lastActive: 1_700_000_000_987 },
      { lastActive: 0 },
      {},
      { lastActive: Number.NaN },
    ])
    expect(rows[0]?.lastActive).toBe(1_700_000_000_000)
    expect(rows[1]?.lastActive).toBe(0)
    expect(rows[2]?.lastActive).toBe(0)
    expect(rows[3]?.lastActive).toBe(0)
  })

  it('截断后同一秒内的两条 spaces 得到同一个值（渲染层因此不会误判变化）', () => {
    const a = truncateLastActive([{ lastActive: 1_700_000_000_120 }])[0]
    const b = truncateLastActive([{ lastActive: 1_700_000_000_860 }])[0]
    expect(a.lastActive).toBe(b.lastActive)
  })
})

describe('spaces 尾部合并：连推压成一次', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('连推 5 条相同内容 → 只 flush 1 次（验收：store.update ≤2）', () => {
    const flush = vi.fn()
    const coalescer = createSpacesCoalescer<any[]>(flush)
    for (let i = 0; i < 5; i += 1) coalescer.push([{ targetId: 't-1' }])
    expect(flush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith([{ targetId: 't-1' }])
  })

  it('最后一条赢：中间态被丢弃，尾部一定到达', () => {
    const flush = vi.fn()
    const coalescer = createSpacesCoalescer<any[]>(flush)
    coalescer.push([{ targetId: 'a' }])
    coalescer.push([{ targetId: 'b' }])
    vi.advanceTimersByTime(300)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush.mock.calls[0]?.[0]).toEqual([{ targetId: 'b' }])
  })

  it('静默 300ms 之后的新一条会重新开窗（不是永久吞掉）', () => {
    const flush = vi.fn()
    const coalescer = createSpacesCoalescer<any[]>(flush)
    coalescer.push([{ targetId: 'a' }])
    vi.advanceTimersByTime(300)
    coalescer.push([{ targetId: 'b' }])
    vi.advanceTimersByTime(300)
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('cancel 丢弃未 flush 的一份（面板卸载时不触发渲染）', () => {
    const flush = vi.fn()
    const coalescer = createSpacesCoalescer<any[]>(flush)
    coalescer.push([{ targetId: 'a' }])
    coalescer.cancel()
    vi.advanceTimersByTime(1000)
    expect(flush).not.toHaveBeenCalled()
  })

  it('空列表也要 flush —— "没有页"是一次真实的状态变化', () => {
    const flush = vi.fn()
    const coalescer = createSpacesCoalescer<any[]>(flush)
    coalescer.push([])
    vi.advanceTimersByTime(300)
    expect(flush).toHaveBeenCalledWith([])
  })
})

describe('locales：新增词条 zh/en 必须成对', () => {
  it('两个字典键集完全一致（少一个就有语言显示键名）', () => {
    expect(Object.keys(SPACE_META_ZH).sort()).toEqual(Object.keys(SPACE_META_EN).sort())
  })

  it('没有空串词条', () => {
    for (const [key, value] of Object.entries(SPACE_META_ZH)) expect(value.trim(), key).not.toBe('')
    for (const [key, value] of Object.entries(SPACE_META_EN)) expect(value.trim(), key).not.toBe('')
  })

  it('占位符两侧一致（{n} 只在两边都出现，才不会出现 "{n} 前" 与 "ago"）', () => {
    for (const key of Object.keys(SPACE_META_ZH)) {
      const zhHasN = (SPACE_META_ZH[key] ?? '').includes('{n}')
      const enHasN = (SPACE_META_EN[key] ?? '').includes('{n}')
      expect(zhHasN, key).toBe(enHasN)
    }
  })
})