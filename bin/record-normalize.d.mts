/**
 * Type declarations for `record-normalize.mjs`.
 *
 * The normalizer is authored as plain ESM (`.mjs`) because the render worker
 * imports it directly at runtime and is NOT compiled by tsdown. This companion
 * declaration gives the TS test (and any TS consumer) types without pulling the
 * worker into the build. Keep the shapes in sync with `record-normalize.mjs`.
 */

export interface ActedRecord {
  /** Lowercased tag, e.g. "span". */
  tagName: string
  /** Page classes only — inspector-chrome tokens pruned. */
  className: string
  /** The element's own text, truncated to a byte budget. */
  text: string
  /** The full normalized outer HTML — the faithful record. Class preserved. */
  outerHTML: string
  backendNodeId: number
  /** True when text/outerHTML were truncated to fit the budget. */
  truncated: boolean
}

/** Class tokens that are inspector chrome, not page content. Pruned, never kept. */
export const CHROME_CLASS_TOKENS: Set<string>
/** Attribute prefixes that are inspector chrome. Dropped entirely. */
export const CHROME_ATTR_PREFIXES: string[]

export function normalizeRecordedElement(
  html: string,
  backendNodeId: number,
): ActedRecord | null
