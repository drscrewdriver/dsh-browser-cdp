/**
 * ego-cli tab close — the panel's × must really close a tab.
 *
 * Regression guard for a dead button: `/api/bcdp/close` answered 409
 * `channel-cannot-close` on every ego-cli link because `closeCliTab` refused
 * anything whose `tabbitInventory` was not true. The runtime does expose
 * `browser.closeTab` (measured: 5 tabs → 3), so the refusal was wrong, not the
 * channel.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PANEL_SENTINEL, buildEgoCloseTabScript } from '../src/cast/panel-actions.ts'

const here = dirname(fileURLToPath(import.meta.url))
const HOST = readFileSync(join(here, '..', 'src', 'index.ts'), 'utf8')

describe('buildEgoCloseTabScript', () => {
  const script = buildEgoCloseTabScript('"space-a"', { targetId: 'ABC123' })

  it('enters the calling session space before touching tabs', () => {
    expect(script).toContain('await taskSpaces.useOrCreate("space-a")')
  })

  it('closes through the runtime facade, not raw CDP', () => {
    expect(script).toContain('await browser.closeTab(__bcdpTarget)')
    expect(script).not.toContain('Target.closeTarget')
  })

  it('refuses to close the last tab instead of emptying the space', () => {
    expect(script).toContain('__tabs.length <= 1')
    expect(script).toContain("reason: 'last-tab'")
  })

  it('reports a stale row as tab-not-found rather than throwing', () => {
    expect(script).toContain("reason: 'tab-not-found'")
  })

  it('verifies the tab is really gone and reports it', () => {
    expect(script).toContain('const __gone = !__left.some((t) => t.targetId === __bcdpTarget)')
    expect(script).toContain('closed: __gone')
  })

  it('always prints the sentinel so the host can parse an outcome', () => {
    expect(script).toContain(PANEL_SENTINEL)
    // three distinct outcome branches + the catch
    expect((script.match(/PANEL_SENTINEL|@@BCDP_PANEL@@/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  it('rejects an empty targetId before doing any work', () => {
    expect(script).toContain("throw new Error('targetId required')")
  })
})

describe('closeCliTab ego-cli branch', () => {
  it('routes an egoRuntime channel to the panel-action close instead of refusing', () => {
    expect(HOST).toContain('__ch?.egoRuntime === true')
    expect(HOST).toContain('panelActions.closeTab({ targetId })')
  })

  it('keeps channel-cannot-close only for channels with neither capability', () => {
    const i = HOST.indexOf("async (targetId: string): Promise<{ ok: boolean; reason: string }> => {")
    const seg = HOST.slice(i, HOST.indexOf('// Tab activation', i))
    // the ego branch returns before the refusal; the refusal stays as the fallback
    expect(seg.indexOf('__ch?.egoRuntime === true')).toBeLessThan(seg.indexOf("'channel-cannot-close'"))
  })

  it('shares one panel-action runner so the close serializes behind the same ego lock', () => {
    expect(HOST).toContain('const panelActions = makePanelActions(ctx, cfg)')
    expect(HOST).toContain('        panelActions,')
    // exactly one construction site
    expect((HOST.match(/makePanelActions\(ctx, cfg\)/g) ?? []).length).toBe(1)
  })
})

describe('ego close pushes the new inventory immediately', () => {
  it('broadcasts the strip after a successful close instead of waiting for a frame', () => {
    const i = HOST.indexOf("async (targetId: string): Promise<{ ok: boolean; reason: string }> => {")
    const seg = HOST.slice(i, HOST.indexOf('// Tab activation', i))
    // the ego branch must refresh the strip before returning 'closed'
    const egoIdx = seg.indexOf('__ch?.egoRuntime === true')
    const closedIdx = seg.indexOf("reason: 'closed'")
    expect(egoIdx).toBeGreaterThan(-1)
    expect(closedIdx).toBeGreaterThan(egoIdx)
    expect(seg.slice(egoIdx, closedIdx)).toContain('broadcastCliSpaces(')
    expect(seg.slice(egoIdx, closedIdx)).toContain('panelActions.listTabs()')
  })

  it('reads the inventory through the runtime facade', () => {
    expect(HOST).toContain('buildEgoListTabsScript')
    expect(HOST).toContain('listTabs: async () => {')
  })

  it('never blocks the close response on the broadcast', () => {
    const i = HOST.indexOf("async (targetId: string): Promise<{ ok: boolean; reason: string }> => {")
    const seg = HOST.slice(i, HOST.indexOf('// Tab activation', i))
    // fired and forgotten: the user's click must not wait on a second CLI hop
    expect(seg).toContain('void (async () => {')
  })
})
