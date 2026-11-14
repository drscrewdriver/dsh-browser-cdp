import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  FAILURE_CODES,
  FAILURE_HINTS,
  FAILURE_PROPS,
  MUTATING_TOOLS,
  classifyFailure,
  normalizeFailure,
  retryAdvice,
} from '../src/errors.ts'

describe('classifyFailure', () => {
  const cases: Array<[string, string]> = [
    ['this op is not supported on tabbit backend', 'BACKEND_UNSUPPORTED'],
    ['locator l-12 not found in the current snapshot', 'LOCATOR_NOT_FOUND'],
    ['page.waitForSelector timed out after 5000ms', 'TIMEOUT'],
    ['a native dialog is blocking the page', 'DIALOG_BLOCKING'],
    ['captcha detected, hand off to a human', 'CAPTCHA'],
    ['the user is controlling this space (handoff)', 'USER_CONTROLLING'],
    ['stale space: the task space was reset', 'SPACE_STALE'],
    ['browser is not reachable: CDP channel is closed', 'BROWSER_DOWN'],
    ['navigation failed: net::ERR_NAME_NOT_RESOLVED', 'NAVIGATION_FAILED'],
    ['panel action produced no result (sentinel missing)', 'NO_PAYLOAD'],
    ['url is required for op=response', 'INVALID_ARGS'],
    ['something nobody has seen before', 'UNKNOWN'],
  ]

  it.each(cases)('maps %j to %s', (message, expected) => {
    expect(classifyFailure(message)).toBe(expected)
  })

  it('covers every declared code', () => {
    const produced = new Set(cases.map(([, code]) => code))
    expect([...produced].sort()).toEqual([...FAILURE_CODES].sort())
  })
})

describe('retryAdvice', () => {
  it('marks the four terminal codes never', () => {
    for (const code of ['CAPTCHA', 'USER_CONTROLLING', 'BACKEND_UNSUPPORTED', 'INVALID_ARGS'] as const) {
      expect(retryAdvice(code)).toBe('never')
    }
  })

  it('asks for a fresh observation when the old locator/state is suspect', () => {
    for (const code of ['TIMEOUT', 'LOCATOR_NOT_FOUND', 'NO_PAYLOAD'] as const) {
      expect(retryAdvice(code)).toBe('reobserve')
    }
  })

  it('keeps retry for transient transport failures', () => {
    for (const code of ['BROWSER_DOWN', 'NAVIGATION_FAILED', 'SPACE_STALE', 'DIALOG_BLOCKING', 'UNKNOWN'] as const) {
      expect(retryAdvice(code)).toBe('retry')
    }
  })
})

describe('FAILURE_HINTS', () => {
  it('has one actionable hint per code, short enough to read', () => {
    for (const code of FAILURE_CODES) {
      const hint = FAILURE_HINTS[code]
      expect(typeof hint).toBe('string')
      expect(hint.length).toBeGreaterThan(4)
      expect(hint.length).toBeLessThanOrEqual(60)
    }
  })
})

describe('normalizeFailure', () => {
  it('leaves a success value byte-identical', () => {
    const ok = { ok: true, text: 'done' }
    expect(normalizeFailure('bcdp_click', ok)).toBe(ok)
  })

  it('leaves non-objects alone', () => {
    expect(normalizeFailure('bcdp_click', 'boom')).toBe('boom')
    expect(normalizeFailure('bcdp_click', null)).toBe(null)
  })

  it('adds the four fields to an action failure', () => {
    const value = normalizeFailure('bcdp_click', { ok: false, error: 'locator #go not found' })
    expect(value).toMatchObject({
      ok: false,
      code: 'LOCATOR_NOT_FOUND',
      retry: 'reobserve',
      actionSent: true,
      hint: FAILURE_HINTS.LOCATOR_NOT_FOUND,
    })
  })

  it('keeps actionSent false for observers', () => {
    const value = normalizeFailure('bcdp_snapshot', { ok: false, text: 'browser is not reachable' })
    expect(value).toMatchObject({ code: 'BROWSER_DOWN', actionSent: false })
  })

  it('is idempotent once a code is present', () => {
    const explicit = { ok: false, error: 'x', code: 'TIMEOUT', retry: 'never', actionSent: false, hint: 'h' }
    expect(normalizeFailure('bcdp_click', explicit)).toBe(explicit)
  })

  it('treats every mutating tool name as actionSent-capable', () => {
    for (const tool of MUTATING_TOOLS) {
      const value = normalizeFailure(tool, { ok: false, error: 'timed out' }) as {
        actionSent: boolean
      }
      expect(value.actionSent).toBe(true)
    }
  })
})

describe('output schema wiring', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8')

  it('registers the four failure props on every strict tool schema', () => {
    // 12 single/top-level tool schemas spread FAILURE_PROPS; the nested
    // additionalProperties:false objects (live / taskSpaces / ...) do not.
    const spreads = (source.match(/\.\.\.FAILURE_PROPS/g) ?? []).length
    expect(spreads).toBeGreaterThanOrEqual(12)
  })

  it('declares the same four keys in the shared fragment', () => {
    expect(Object.keys(FAILURE_PROPS).sort()).toEqual(['actionSent', 'code', 'hint', 'retry'])
  })

  it('never marks a failure field as required (success results omit them)', () => {
    for (const fragment of Object.values(FAILURE_PROPS)) {
      expect(fragment).not.toHaveProperty('required')
    }
  })
})
