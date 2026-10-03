import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Lightpanda backend — the Browser.close invariant.
 *
 * The plugin must NEVER send `Browser.close` to the TARGET (attached/remote)
 * browser: on a remote attach it would KILL the user's browser, and the
 * managed path stops via killTree instead. The one legitimate call site is
 * login-import's LOCALLY spawned temp Chrome (reading the source profile),
 * whose cleanup must stay unconditional regardless of the target engine.
 *
 * Enforced as a source scan: cheap, dependency-free, and it fails loudly the
 * moment anyone adds a new call site without thinking about the engine.
 */

const SRC = join(import.meta.dirname, '..', 'src')
const ALLOWED_FILES = new Set(['login-import.ts'])

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full))
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

describe('Browser.close invariant (Lightpanda backend)', () => {
  it('is sent only to the local temp Chrome in login-import, never to the target', () => {
    const offenders: string[] = []
    for (const file of listTsFiles(SRC)) {
      const rel = file.replaceAll('\\', '/').split('/src/')[1] ?? file
      const source = readFileSync(file, 'utf8')
      // Matches actual dispatches (.call('Browser.close') …), not comments.
      if (/\.call\(\s*['"`]Browser\.close['"`]/.test(source) && !ALLOWED_FILES.has(rel)) {
        offenders.push(rel)
      }
    }
    expect(offenders, `Browser.close must stay local to login-import; found in: ${offenders.join(', ')}`).toEqual([])
  })
})
