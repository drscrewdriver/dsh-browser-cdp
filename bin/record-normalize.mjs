/**
 * bin/record-normalize.mjs — turn a raw `DOM.getOuterHTML` string into the
 * faithful, bounded "acted element" record.
 *
 * THE RULE (locked with the user, 2026-09-24):
 *
 *   Rewriting rules ARE allowed — but LOCATING features such as `class` MUST be
 *   preserved.
 *
 * Concretely:
 *   - The `class` attribute is NEVER dropped. Only a small, explicit allowlist of
 *     known inspector-chrome class TOKENS (e.g. `trae-browser-inspect-draggable`)
 *     may be pruned from its value, and only when they are not page classes.
 *   - Other locating/semantic attributes (`id`, `role`, `name`, `href`, `type`,
 *     `value`, `placeholder`, `title`, `alt`, `aria-*`, `data-testid`, and any
 *     other `data-*`) are kept.
 *   - Transient / presentational attributes (`style`) are dropped — they are not
 *     locating features and they bloat the record.
 *   - Inner text is preserved verbatim, then truncated to a byte budget so a huge
 *     subtree cannot blow up the envelope. `truncated` tells the caller.
 *
 * This is the "package struct full record" the judge/loop keeps for the one
 * element it acted on. It is deliberately NOT applied to every candidate in the
 * frame: feeding full outerHTML for N candidates would defeat the count-bucketing
 * the whole narrowing design relies on. One element, fully recorded — that is the
 * right unit.
 */

/** Class tokens that are inspector chrome, not page content. Pruned, never kept. */
export const CHROME_CLASS_TOKENS = new Set([
  'trae-browser-inspect-draggable',
  'trae-browser-inspect',
])

/** Attribute prefixes that are inspector chrome. Dropped entirely. */
export const CHROME_ATTR_PREFIXES = ['data-trae-']

/** Attributes kept as-is (locating / semantic). Anything not listed and not
 * `data-*` / `aria-*` is dropped unless it is `class`. */
const KEEP_ATTR = new Set([
  'id',
  'role',
  'name',
  'href',
  'type',
  'value',
  'placeholder',
  'title',
  'alt',
  'tabindex',
  'for',
])

const MAX_TEXT_BYTES = 600
const MAX_OUTER_BYTES = 2400

function isKeepAttr(name) {
  if (KEEP_ATTR.has(name)) return true
  if (name.startsWith('aria-')) return true
  if (name === 'data-testid') return true
  // Other data-* are kept: they often carry test/locating ids the page relies on.
  if (name.startsWith('data-') && !CHROME_ATTR_PREFIXES.some((p) => name.startsWith(p))) return true
  return false
}

function normalizeClass(value) {
  const tokens = String(value)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t !== '' && !CHROME_CLASS_TOKENS.has(t))
  return tokens.join(' ')
}

/**
 * @param {string} html - raw outerHTML from `DOM.getOuterHTML`.
 * @param {number} backendNodeId - the node this record is for.
 * @returns {{ tagName: string, className: string, text: string, outerHTML: string, backendNodeId: number, truncated: boolean } | null}
 */
export function normalizeRecordedElement(html, backendNodeId) {
  if (typeof html !== 'string' || html.trim() === '') return null

  // Opening tag = up to the first `>` that is not inside a quoted attribute
  // value. Records are small elements, so a tolerant scan is enough.
  let end = -1
  let inQuote = ''
  for (let i = 1; i < html.length; i++) {
    const ch = html[i]
    if (inQuote) {
      if (ch === inQuote) inQuote = ''
      continue
    }
    if (ch === '"' || ch === "'") inQuote = ch
    else if (ch === '>') {
      end = i
      break
    }
  }
  if (end === -1) return null

  const open = html.slice(0, end)
  const rest = html.slice(end + 1) // includes children + closing tag

  const tagMatch = open.match(/^<\s*([a-zA-Z][\w-]*)/)
  if (!tagMatch) return null
  const tagName = tagMatch[1].toLowerCase()

  // Pull each attribute: name, optional ="value".
  const attrs = []
  const attrRe = /([a-zA-Z_][\w:-]*)(?:\s*=\s*"([^"]*)")?/g
  let m
  while ((m = attrRe.exec(open)) !== null) {
    const name = m[1]
    if (name.toLowerCase() === tagName) continue // the tag name itself
    const value = m[2]
    if (name === 'class') {
      const classNorm = normalizeClass(value ?? '')
      if (classNorm !== '') attrs.push(['class', classNorm])
      continue
    }
    if (name === 'style') continue // transient / presentational
    if (CHROME_ATTR_PREFIXES.some((p) => name.startsWith(p))) continue
    if (!isKeepAttr(name)) continue
    attrs.push([name, value ?? ''])
  }

  // Inner text (between opening and closing tag), for the compact citation.
  const closeIdx = rest.lastIndexOf(`</${tagName}>`)
  const inner = closeIdx >= 0 ? rest.slice(0, closeIdx) : rest
  let text = inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

  // Truncate text to a byte budget, then the whole outerHTML if still too big.
  let truncated = false
  if (text.length > MAX_TEXT_BYTES) {
    text = text.slice(0, MAX_TEXT_BYTES) + '…'
    truncated = true
  }

  const attrStr = attrs.map(([k, v]) => (v === '' ? k : `${k}="${v}"`)).join(' ')
  const rebuiltOpen = `<${tagName}${attrStr ? ' ' + attrStr : ''}>`
  let outerHTML = rebuiltOpen + rest

  if (outerHTML.length > MAX_OUTER_BYTES) {
    // Cut from the middle of the children, keep the opening tag intact.
    const keep = MAX_OUTER_BYTES - rebuiltOpen.length - 12
    if (keep > 40) {
      const head = rest.slice(0, Math.floor(keep / 2))
      const tail = rest.slice(rest.length - Math.floor(keep / 2))
      outerHTML = rebuiltOpen + head + '…(truncated)…' + tail
    } else {
      outerHTML = rebuiltOpen + '…(truncated)…'
    }
    truncated = true
  }

  return { tagName, className: attrs.find((a) => a[0] === 'class')?.[1] ?? '', text, outerHTML, backendNodeId: Number(backendNodeId), truncated }
}
