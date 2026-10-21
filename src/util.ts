/**
 * src/util.ts — shared small helpers (sentinel / type coercion / JSON helpers).
 *
 * Factored out of index.ts for reuse by other modules. No ctx/cfg dependency,
 * no side effects.
 */
export const SENTINEL = '@@DSH_RESULT@@'

export const j = (v: unknown): string => JSON.stringify(v)

export const str = <T extends string | number>(v: unknown, fallback: T): string | T =>
  typeof v === 'string' && v !== '' ? v : fallback

export const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

export const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback

/** Inline helper making arbitrary helper results JSON-safe for the payload. */
export const SAFE_FN =
  'function safe(v){try{return JSON.parse(JSON.stringify(v))}catch{return String(v)}}\n'

/**
 * Build an IN-PAGE wrapper that resolves a JS expression to a value that is
 * already safe to cross the CDP boundary.
 *
 * WHY in-page, not outer: `page.evaluate` / `page.waitForFunction` serialize
 * their result INSIDE the runtime's `handleMessage` (ego SDK index.js:539 — a
 * hard reject, not a catchable throw), so a deeply-cyclic global like
 * `window.top` kills the whole subprocess with "Object reference chain is too
 * long" before any outer `safe()` could see the value. Doing the stringify/
 * toString degradation inside the page (where the object graph actually lives)
 * is the only place the reference chain can be bounded.
 *
 * Semantics preserved per-call:
 *  - primitives and plain (non-cyclic) objects round-trip UNCHANGED;
 *  - cyclic/DOM/global handles degrade to `Object.prototype.toString` or a
 *    `<tagName>` hint;
 *  - with `preserveFalsy`, a falsy result is returned as-is (the waitForFunction
 *    truthiness contract depends on falsy meaning "not satisfied yet"), and a
 *    truthy handle is always degraded to a TRUTHY string so the wait still
 *    resolves.
 *
 * @internal exported for tests
 */
export function safeEvalWrap(expr: string, preserveFalsy = false): string {
  const guard = preserveFalsy ? 'if (!__v) return __v;\n' : ''
  return `(() => {\n` +
    `const __v = (${expr});\n` +
    `${guard}` +
    `if (__v === null || typeof __v !== 'object') return __v;\n` +
    `try { const __s = JSON.stringify(__v); return __s === undefined ? Object.prototype.toString.call(__v) : JSON.parse(__s); }\n` +
    `catch { try { if (__v.tagName) return '<' + String(__v.tagName).toLowerCase() + '>' + (typeof __v.getAttribute === 'function' && __v.getAttribute('id') ? '#' + __v.getAttribute('id') : ''); return Object.prototype.toString.call(__v); } catch { return String(__v); } }\n` +
    `})()`
}


export interface CollectReaderLike {
  readFrom(offset: number): { text: string; nextOffset: number; lossy: boolean; spillPath?: string }
}

/** Read an entire subprocess reader's buffered output. */
export function readAll(reader: CollectReaderLike | undefined | null): string {
  if (!reader) return ''
  return reader.readFrom(0).text
}
