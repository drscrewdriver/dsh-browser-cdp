/**
 * src/client/space-meta.ts — 侧栏「这页现在什么状态、谁在驱动」的一行元数据。
 *
 * 设计约束（改之前先看 ../../.agents/plans/sidebar-meta-surface/spec.md）：
 *  - **纯函数**：不读 DOM、不读时间、不取全局字典。`now` 与取词函数都从外面传，
 *    所以同一份逻辑能在 Tab（React）、浮窗（vanilla DOM）与单测里跑出同一串文字。
 *  - **不持有状态**：owner 映射、spaces 合并器都由调用方持有；本文件只提供
 *    「怎么写这一行」和「怎么把连推压成一次」两件工具。
 *  - 老 worker 不推新字段是**正常工况**，不是异常：缺字段就少一段，不出空段。
 *
 * 分工：本文件零中文（界面文案在 `locales.ts`，经 `MetaText` 注入）——本仓的
 * locale 守卫会把客户端源码里的中文字面量当缺陷计数，文案必须留在字典里。
 */

/** 一段元数据。`key` 只用于测试/排查，界面只拼 `text`。 */
export interface MetaSegment {
  key: string
  text: string
}

/** spaces 行里本模块关心的字段（`CliSpaceRow` 的子集，允许老 worker 缺席）。 */
export interface SpaceMetaRow {
  lastActive?: number
  capturing?: boolean
  viewportW?: number
  viewportH?: number
  dpr?: number | null
  zoom?: number | null
  readyState?: string
}

/** 谁在驱动这个 tab。operator 事件没有 sessionId（人没有会话）。 */
export interface SpaceOwner {
  source?: string
  sessionId?: string
}

export interface SpaceMetaInput {
  row?: SpaceMetaRow | null
  owner?: SpaceOwner | null
}

/**
 * 取词函数：`(key, params) => text`。生产传 `wt`，单测传 `metaText(locales.SPACE_META_ZH)`。
 * 参数用 `Record<string, string | number>` 而不是泛型，是为了让调用方不必为每个键
 * 生成字面量类型。
 */
export type MetaText = (key: string, params?: Record<string, string | number>) => string

/** 把一份字典包成 `MetaText`（`{n}` 占位符替换，与客户端 `wt` 同语义）。 */
export function metaText(table: Record<string, string>, fallback?: Record<string, string>): MetaText {
  return (key, params) => {
    let text = table[key] ?? fallback?.[key] ?? key
    if (params !== undefined) {
      for (const name of Object.keys(params)) {
        text = text.split('{' + name + '}').join(String(params[name]))
      }
    }
    return text
  }
}

/**
 * 「最后动作距今」。四档：<3s 刚刚｜<60s Ns 前｜<1h Nm 前｜其余 Nh 前。
 *
 * `lastActive <= 0` 返回 null：0 是「不知道」（worker 没采到帧），不是 1970 ——
 * 显示「54 年前」比不显示更糟。
 */
export function formatElapsed(lastActive: number | null | undefined, now: number, t: MetaText): string | null {
  const at = Number(lastActive)
  if (!Number.isFinite(at) || at <= 0) return null
  const seconds = Math.max(0, now - at) / 1000
  if (seconds < 3) return t('agoJustNow')
  if (seconds < 60) return t('agoSeconds', { n: Math.floor(seconds) })
  if (seconds < 3600) return t('agoMinutes', { n: Math.floor(seconds / 60) })
  return t('agoHours', { n: Math.floor(seconds / 3600) })
}

/** `1280×720`。两个值都得是正整数，否则这一段缺席（不显示 0×0）。 */
export function formatViewport(row: SpaceMetaRow | null | undefined): string | null {
  const w = Math.round(Number(row?.viewportW))
  const h = Math.round(Number(row?.viewportH))
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
  return w + '×' + h
}

/**
 * `@1.25 · 80%`（DPR 与 zoom，任一缺席就只出另一半）。
 *
 * 只报「非常规」：100% 缩放与 DPR=1 是默认态，写出来只是噪声。
 */
export function formatZoom(dpr: number | null | undefined, zoom: number | null | undefined, t: MetaText): string | null {
  const parts: string[] = []
  const ratio = Number(dpr)
  if (Number.isFinite(ratio) && ratio > 0 && Math.abs(ratio - 1) >= 0.005) {
    parts.push(t('dprSuffix', { n: Math.round(ratio * 100) / 100 }))
  }
  const percent = Number(zoom)
  if (Number.isFinite(percent) && percent > 0 && Math.round(percent) !== 100) {
    parts.push(t('zoomSuffix', { n: Math.round(percent) }))
  }
  return parts.length === 0 ? null : parts.join(' · ')
}

/** 加载态：只有 `loading` 值得说；interactive/complete 是正常态，不占位。 */
export function formatReadyState(state: string | null | undefined, t: MetaText): string | null {
  return state === 'loading' ? t('readyLoading') : null
}

/**
 * 谁在驱动：`agent` / `你`，带会话时追加 `· 会话 a1b2`（会话 id 只取前 4 位——
 * 全 id 会把这行撑爆，而侧栏要的是「是不是我刚发起的那轮」，不是可复制的句柄）。
 */
export function formatOwner(owner: SpaceOwner | null | undefined, t: MetaText): string | null {
  const source = owner?.source
  const who = source === 'agent' ? t('ownerAgent') : source === 'operator' ? t('ownerYou') : null
  const raw = typeof owner?.sessionId === 'string' ? owner.sessionId.trim() : ''
  const session = raw === '' ? null : t('ownerSession', { n: raw.slice(0, 4) })
  if (who === null && session === null) return null
  return [who, session].filter((part): part is string => part !== null).join(' · ')
}

/** 该 tab 是否在被截流：只有明确的 `false` 值得说（`true`/未知都是常态）。 */
export function formatCapturing(capturing: boolean | null | undefined, t: MetaText): string | null {
  return capturing === false ? t('capturingOff') : null
}

/**
 * 一整行：viewport · 设备 · 距今 · 加载态 · 未截流 · 谁在驱动。
 *
 * 顺序是刻意的：越靠左越是「这页是什么」，越靠右越是「谁在动它」；窄面板下
 * 尾部先被省略号吃掉，用户仍能读到尺寸与时间。
 */
export function formatSpaceMeta(input: SpaceMetaInput, now: number, t: MetaText): MetaSegment[] {
  const row = input.row ?? null
  const segments: MetaSegment[] = []
  const viewport = formatViewport(row)
  if (viewport !== null) segments.push({ key: 'viewport', text: viewport })
  const device = formatZoom(row?.dpr, row?.zoom, t)
  if (device !== null) segments.push({ key: 'device', text: device })
  const elapsed = formatElapsed(row?.lastActive, now, t)
  if (elapsed !== null) segments.push({ key: 'elapsed', text: elapsed })
  const ready = formatReadyState(row?.readyState, t)
  if (ready !== null) segments.push({ key: 'ready', text: ready })
  const capturing = formatCapturing(row?.capturing, t)
  if (capturing !== null) segments.push({ key: 'capturing', text: capturing })
  const owner = formatOwner(input.owner, t)
  if (owner !== null) segments.push({ key: 'owner', text: owner })
  return segments
}

/** 分段拼成一行（两处渲染共用，保证浮窗与 Tab 逐字一致）。 */
export function joinMeta(segments: MetaSegment[]): string {
  return segments.map((segment) => segment.text).filter((text) => text !== '').join(' · ')
}

/** tab 条尾部的 `N 页`。0 页时不显示（空态已经有自己的文案）。 */
export function formatPageCount(count: number | null | undefined, t: MetaText): string | null {
  const n = Math.floor(Number(count))
  if (!Number.isFinite(n) || n <= 0) return null
  return t('pagesCount', { n })
}

/** `lastActive` 归一化到秒：spaces 每 ~500ms 一推，毫秒尾数只会让渲染白白比出差异。 */
export function truncateLastActive<T extends { lastActive?: number }>(rows: T[]): T[] {
  for (const row of rows) {
    const value = Number(row?.lastActive)
    row.lastActive = Number.isFinite(value) && value > 0 ? Math.floor(value / 1000) * 1000 : 0
  }
  return rows
}

/**
 * spaces 尾部合并：**最后一条赢**，静默 `delayMs` 后统一 flush。
 *
 * 为什么需要：worker 每个 keepalive tick（~500ms）推一次全量 spaces，tab churn
 * 时更密；每一条都换一次 store 快照 = 每个 tick 一次 React 重渲染。合并后
 * 「连推 5 条」只落 1 次 update，且中间态本来就没人看得到。
 *
 * 尾部（而不是首部）合并是刻意的：spaces 是全量快照，丢掉中间态没有信息损失，
 * 但丢掉**最后**一条会让面板停在旧状态上。
 */
export interface SpacesCoalescer<T> {
  /** 记下最新一份，重置静默计时。 */
  push(rows: T): void
  /** 丢弃未 flush 的一份（面板卸载时用）。 */
  cancel(): void
}

export function createSpacesCoalescer<T>(flush: (rows: T) => void, delayMs = 300): SpacesCoalescer<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: T | null = null
  const stop = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  return {
    push(rows) {
      pending = rows
      stop()
      timer = setTimeout(() => {
        timer = null
        const next = pending
        pending = null
        if (next !== null) flush(next)
      }, delayMs)
    },
    cancel() {
      stop()
      pending = null
    },
  }
}