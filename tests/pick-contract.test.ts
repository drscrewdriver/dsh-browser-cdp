import { describe, expect, it } from 'vitest'
import { classifyPickError, PICK_ERROR_CLASSES } from '../src/worker/pick-contract.ts'

/**
 * T5.2 — every failure code the picker can produce lands in exactly one of
 * the five classes, and the four T5.8 fixture classes (hit / blank /
 * unresolvable / cross-domain iframe) all map to a classified failure rather
 * than a bare string.
 */
describe('T5.2 pick error contract', () => {
  it('defines exactly five classes, none empty, none overlapping', () => {
    const classes = Object.keys(PICK_ERROR_CLASSES)
    expect(classes).toEqual(['connection', 'target', 'arming', 'hit', 'describe'])
    const seen = new Set<string>()
    for (const codes of Object.values(PICK_ERROR_CLASSES)) {
      expect(codes.length).toBeGreaterThan(0)
      for (const code of codes) expect(seen.has(code)).toBe(false)
      for (const code of codes) seen.add(code)
    }
  })

  it('classifies every code into its class', () => {
    expect(classifyPickError('browser-disconnected')).toBe('connection')
    expect(classifyPickError('worker-unavailable')).toBe('connection')
    expect(classifyPickError('target-required')).toBe('target')
    expect(classifyPickError('no-active-session')).toBe('target')
    expect(classifyPickError('enable-failed')).toBe('arming')
    expect(classifyPickError('domain-split')).toBe('arming')
    expect(classifyPickError('no-node-at-point')).toBe('hit')
    expect(classifyPickError('invalid-point')).toBe('hit')
    expect(classifyPickError('describe-failed')).toBe('describe')
    expect(classifyPickError('phase-not-plain')).toBe('target')
    expect(classifyPickError('deliver-failed')).toBe('describe')
  })

  it('leaves truly unknown codes as unknown instead of guessing', () => {
    expect(classifyPickError('something-novel')).toBe('unknown')
  })
})
