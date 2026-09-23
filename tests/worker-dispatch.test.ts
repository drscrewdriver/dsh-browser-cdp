import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guard the render worker's dispatch table against MISSING FUNCTIONS.
 *
 * Why this exists: `node --check` validates syntax only. A `case 'act': return
 * actOnCandidate(params)` whose function body was accidentally deleted by a
 * later edit passes `--check`, passes typecheck (the worker is plain .mjs, not
 * in the TS program), and passes every unit test — because no unit test
 * dispatches `act`. It fails only at runtime, on a machine with a browser
 * attached, in the middle of a loop.
 *
 * That already happened once (see findings A.13). This test is the cheap net:
 * every method the worker advertises must resolve to a function that exists.
 */

const workerPath = fileURLToPath(new URL('../bin/cdp-render-worker.mjs', import.meta.url))
const source = readFileSync(workerPath, 'utf8')

/** Function names declared at the top level. */
function declaredFunctions(src: string): Set<string> {
  const names = new Set<string>()
  const re = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm
  for (let match = re.exec(src); match !== null; match = re.exec(src)) names.add(match[1])
  return names
}

/** Arrow/const function declarations too, since the worker mixes styles. */
function declaredConsts(src: string): Set<string> {
  const names = new Set<string>()
  const re = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm
  for (let match = re.exec(src); match !== null; match = re.exec(src)) names.add(match[1])
  return names
}

/** `case '<method>':` labels in the request switch. */
function dispatchedMethods(src: string): string[] {
  const methods: string[] = []
  const re = /case\s+'([a-zA-Z][\w-]*)'\s*:/g
  for (let match = re.exec(src); match !== null; match = re.exec(src)) methods.push(match[1])
  return methods
}

/**
 * Every identifier called as `X(params)` or `X(request)` — i.e. the worker's own
 * handlers, distinguished from CDP commands by taking no string literal first
 * argument.
 */
function calledHandlers(src: string): Set<string> {
  const names = new Set<string>()
  const re = /\b(?:return\s+|await\s+)([a-z][\w$]*)\((?:params|request|msg|input)\)/g
  for (let match = re.exec(src); match !== null; match = re.exec(src)) names.add(match[1])
  return names
}

const declared = new Set([...declaredFunctions(source), ...declaredConsts(source)])

describe('render worker dispatch table', () => {
  it('defines every handler it dispatches to', () => {
    const missing = [...calledHandlers(source)].filter((name) => !declared.has(name))
    // The failure message names the function, because "something is undefined"
    // at runtime is the least actionable possible version of this bug.
    expect(missing, `worker dispatches to undefined function(s): ${missing.join(', ')}`).toEqual([])
  })

  it('resolves `act`, the one method a whole loop depends on', () => {
    // Called out separately: this is the exact function that went missing. A
    // generic "all handlers defined" assertion would have caught it too, but the
    // specific one fails with a message that says what broke.
    expect(declared.has('actOnCandidate')).toBe(true)
  })

  it('advertises the methods the plugin side calls', () => {
    const methods = dispatchedMethods(source)
    for (const expected of ['hello', 'connect', 'interactive', 'capture', 'act', 'ping']) {
      expect(methods, `worker is missing a '${expected}' method`).toContain(expected)
    }
  })
})

describe('render worker reload recovery', () => {
  it('handles reload before requiring a candidate', () => {
    // `reload` is a page-level action. If the backendNodeId guard ran first, the
    // one recovery most likely to rescue a failed step would be the one that
    // cannot be requested. Asserted on order, not just presence.
    const fn = source.slice(source.indexOf('async function actOnCandidate'))
    const reloadAt = fn.indexOf("action === 'reload'")
    const guardAt = fn.indexOf('Number.isFinite(backendNodeId)')
    expect(reloadAt).toBeGreaterThan(-1)
    expect(guardAt).toBeGreaterThan(-1)
    expect(reloadAt).toBeLessThan(guardAt)
  })

  it('waits for the document instead of listening for an event that already fired', () => {
    // Page.loadEventFired may land between the reload ack and the listener, so a
    // listener added after the fact waits forever. Polling readyState is bounded.
    expect(declared.has('waitForLoad')).toBe(true)
    expect(source).toContain('document.readyState')
    expect(source).toMatch(/waitForLoad\(\s*\d+\s*\)/)
  })

  it('adds the scroll offset back when converting a box to a click point', () => {
    // CDP boxes are document space; input coordinates are viewport space. The
    // bug this guards only appears on a scrolled page — i.e. never in a smoke
    // test on a static page.
    const measure = source.slice(source.indexOf('async function measure'))
    expect(measure).toContain('rect.x - scroll.x')
    expect(measure).toContain('rect.y - scroll.y')
  })
})
