import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guard the client panel's live-frame flush against REGRESSION to the direct
 * swap (upstream dsh-ego-browser #82/#81).
 *
 * Both flush sites (floating panel + sidebar controller) feed a screencast
 * data URL into an <img>. A direct `img.src = frame` assignment drops the old
 * bitmap while the new frame decodes — the per-frame blank window upstream
 * measured as panel black-flash on headed macOS. The fix pre-decodes through
 * a detached Image (`decode()`) and only then swaps, falling back to the
 * direct swap when `decode` is unavailable. This file asserts the shape stays.
 */
const source = readFileSync(fileURLToPath(new URL('../src/client/index.ts', import.meta.url)), 'utf8')

describe('client live-frame flush contract', () => {
  it('both flush sites pre-decode before swapping, with a decode-less fallback', () => {
    // Exactly two flush sites exist (floating panel + sidebar controller);
    // each must route the swap through probe.decode().then(apply, apply).
    const decodeSwaps = source.match(/probe\.decode\(\)\.then\(apply, apply\)/g)?.length ?? 0
    expect(decodeSwaps, 'expected the pre-decode swap at both flush sites').toBe(2)
    // The fallback keeps decode-less runtimes no worse than before.
    expect(source).toContain("typeof probe.decode === 'function'")
    // And the swap itself must still exist inside `apply` — the probe replaces
    // the direct assignment, not the swap.
    expect(source).toContain('liveImg.src = frame')
    expect(source).toContain('self2.liveImg.src = frame')
  })
})
