/**
 * src/client/locales.ts — 侧栏元数据行的词条（zh/en 双份）。
 *
 * 为什么单独一个文件，而不直接写进 index.ts 的 `watchZh`/`watchEn`：
 * 本仓的 locale 守卫（`tests/locale-guard.test.ts`）对客户端源码做**硬编码中文
 * 棘轮**，`watchZh` 里每一条中文字面量都计入基线。把新词条搬进一个**字典文件**
 * （守卫约定：文件名含 `locale`/`i18n`/`copy` 或位于 `locales/` 目录即视为译文
 * 所在处）既不抬高基线，也不丢词条——index.ts 在启动时把它们 `Object.assign`
 * 进两个字典，`wt()` 取词路径完全不变。
 *
 * 键名与 spec §7 一致；`{n}` 由 `wt(key, {n})` 的占位符替换填充。
 */

/** 英文词条（缺 zh 时 `wt` 的最后回退）。 */
export const SPACE_META_EN: Record<string, string> = {
  capturingOff: 'not capturing',
  agoJustNow: 'just now',
  agoSeconds: '{n}s ago',
  agoMinutes: '{n}m ago',
  agoHours: '{n}h ago',
  ownerAgent: 'agent',
  ownerYou: 'you',
  ownerSession: 'session {n}',
  zoomSuffix: '{n}%',
  dprSuffix: '@{n}',
  readyLoading: 'loading',
  captchaTabBadge: '\u26a0',
  pagesCount: '{n} pages',
}

/** 中文词条。 */
export const SPACE_META_ZH: Record<string, string> = {
  capturingOff: '未截流',
  agoJustNow: '刚刚',
  agoSeconds: '{n}s 前',
  agoMinutes: '{n}m 前',
  agoHours: '{n}h 前',
  ownerAgent: 'agent',
  ownerYou: '你',
  ownerSession: '会话 {n}',
  zoomSuffix: '{n}%',
  dprSuffix: '@{n}',
  readyLoading: '加载中',
  captchaTabBadge: '\u26a0',
  pagesCount: '{n} 页',
}