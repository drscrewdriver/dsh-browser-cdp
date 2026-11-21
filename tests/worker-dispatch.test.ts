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

describe('render worker nodeContains document contract', () => {
  const fn = source.slice(source.indexOf('async function nodeContains'), source.indexOf('async function actOnCandidate'))

  it('requests the document before pushing backend ids (issue #17)', () => {
    // `DOM.pushNodesByBackendIdsToFrontend` answers -32000 "Document needs to
    // be requested first" until `DOM.getDocument` has been called. Nothing
    // else in the worker requests one, so without this the push threw on every
    // invocation, the ancestor/descendant tolerance was dead code, and an
    // <a> wrapping an <img> was misreported as click-missed.
    const getDocAt = fn.indexOf("call('DOM.getDocument'")
    const pushAt = fn.indexOf("call('DOM.pushNodesByBackendIdsToFrontend'")
    expect(getDocAt, 'nodeContains never requests a DOM document').toBeGreaterThan(-1)
    expect(pushAt, 'nodeContains lost its pushNodesByBackendIdsToFrontend call').toBeGreaterThan(-1)
    expect(getDocAt).toBeLessThan(pushAt)
  })
})

describe('render worker hit-missing guard contract', () => {
  const act = source.slice(source.indexOf('async function actOnCandidate'), source.indexOf('/** A current box model'))

  it('treats an unmapped hit-test point as unverified, not as a miss (issue #18)', () => {
    // `Number(undefined)` is NaN and `NaN !== x` is always true, so the old
    // `Number(hit?.backendNodeId) !== backendNodeId` shape turned "the point
    // resolves to no node" into a guaranteed click-missed — an unknown answer
    // folded into a definite miss, in the pre-check blocking the click and in
    // the post-check triggering a caller retry that double-clicks.
    const preAt = act.indexOf('const hitMissing')
    const postAt = act.indexOf('const afterMissing')
    expect(preAt, 'pre-check lost its hitMissing guard').toBeGreaterThan(-1)
    expect(postAt, 'post-check lost its afterMissing guard').toBeGreaterThan(-1)
    expect(act).not.toMatch(/Number\(hit\?\.backendNodeId\) !== backendNodeId/)
    expect(act).not.toMatch(/Number\(after\?\.backendNodeId\) !== backendNodeId/)
    // Guards must decide BEFORE nodeContains is consulted.
    const preGuardAt = act.indexOf('if (!hitMissing &&')
    const postGuardAt = act.indexOf('if (!afterMissing &&')
    const preContainsAt = act.indexOf('await nodeContains(backendNodeId, hitId)')
    const postContainsAt = act.indexOf('await nodeContains(backendNodeId, afterId)')
    expect(preGuardAt).toBeLessThan(preContainsAt)
    expect(postGuardAt).toBeLessThan(postContainsAt)
  })
})

describe('render worker scroll honesty contract', () => {
  const act = source.slice(source.indexOf('async function actOnCandidate'), source.indexOf('/** A current box model'))

  it('decides scroll BEFORE the candidate guard — the loop sends backendNodeId 0', () => {
    // Scroll is a page-level action like reload; the judge loop sends
    // backendNodeId 0 for it. Behind the `backendNodeId <= 0` guard every
    // loop-driven scroll would die as `no-candidate` — dead code through the
    // only caller that exists.
    const scrollAt = act.indexOf("action === 'scroll'")
    const guardAt = act.indexOf('Number.isFinite(backendNodeId)')
    expect(scrollAt).toBeGreaterThan(-1)
    expect(guardAt).toBeGreaterThan(-1)
    expect(scrollAt).toBeLessThan(guardAt)
  })

  it('reads the offset before and after the wheel event, and reports moved (upstream #109 parallel)', () => {
    // The wheel dispatch is fire-and-forget: reading only AFTER it would
    // report the PREVIOUS scroll position as this one's result, and a page
    // that cannot scroll would still claim success. before/after + moved is
    // the honest contract; the post-dispatch read is a STABILITY POLL (two
    // consecutive equal reads, bounded) because a single fixed settle can
    // read before the renderer applies the wheel.
    const scrollFn = act.slice(act.indexOf("action === 'scroll'"), act.indexOf("action === 'fill'"))
    const dispatchAt = scrollFn.indexOf("type: 'mouseWheel'")
    expect(scrollFn.indexOf('const before = await readScroll()')).toBeGreaterThan(-1)
    expect(scrollFn.indexOf('const before = await readScroll()')).toBeLessThan(dispatchAt)
    const pollAt = scrollFn.indexOf('let after = await readScroll()')
    expect(pollAt).toBeGreaterThan(dispatchAt)
    expect(scrollFn).toContain('stable = next.x === after.x && next.y === after.y ? stable + 1 : 0')
    expect(scrollFn).toContain('moved')
  })
})

describe('render worker dialog visibility contract', () => {
  it('tracks the JavaScript dialog lifecycle from the event stream (upstream #104 parallel)', () => {
    // The worker's message loop otherwise ignores events. Page.enable is
    // already on, so javascriptDialogOpening/Closed are flowing — recording
    // them is what lets a frozen step say "a dialog is open" instead of a
    // bare timeout.
    expect(source).toContain("message.method === 'Page.javascriptDialogOpening'")
    expect(source).toContain("message.method === 'Page.javascriptDialogClosed'")
    expect(source).toContain('state.dialog = null')
  })

  it('surfaces the open dialog on failed steps and page-facing replies', () => {
    const chain = source.slice(source.indexOf("rl.on('line'"))
    // The failure note names the dismissal command, so the agent can act on it.
    expect(chain).toContain('Page.handleJavaScriptDialog')
    expect(chain).toContain('state.dialog')
    // Successful page-facing replies carry the dialog state, not silently drop it.
    expect(chain).toContain('{ ...result, dialog: state.dialog }')
  })
})
