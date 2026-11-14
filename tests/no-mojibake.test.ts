import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guard against a repeat of the 2026-11 incident: `src/index.ts` shipped 145
 * U+FFFD replacement characters, because an em dash written as UTF-8 had been
 * read back through a legacy code page. It stayed invisible in code review and
 * leaked into live tool output (bcdp_help's unknown-topic branch, doctor lines).
 *
 * U+FFFD is irreversible — the original character is gone — so the only safe
 * policy is "never let one in again".
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCAN = [
  { dir: join(ROOT, 'src'), ext: ['.ts', '.tsx'] },
  { dir: join(ROOT, 'skills'), ext: ['.md'] },
  { dir: join(ROOT, 'locale'), ext: ['.json', '.ts', '.md'] },
]
const REPLACEMENT = '\uFFFD'

function walk(dir: string, ext: string[], out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out // optional directory (locale/ may be absent)
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, ext, out)
    } else if (ext.some((suffix) => entry.endsWith(suffix))) {
      out.push(full)
    }
  }
  return out
}

describe('source files are free of mojibake', () => {
  const offenders: string[] = []

  for (const { dir, ext } of SCAN) {
    for (const file of walk(dir, ext)) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((line, index) => {
        if (!line.includes(REPLACEMENT)) return
        const at = line.indexOf(REPLACEMENT)
        const context = line.slice(Math.max(0, at - 20), at + 20).trim()
        offenders.push(`${relative(ROOT, file)}:${index + 1}  ${context}`)
      })
    }
  }

  it('contains no U+FFFD replacement characters', () => {
    expect(offenders, `mojibake found (rewrite the text, do not paste it back):\n${offenders.join('\n')}`).toEqual(
      [],
    )
  })
})
