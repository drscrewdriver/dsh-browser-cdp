/**
 * The tab-inventory heredoc that keeps the panel's strip honest after a close.
 */
import { describe, expect, it } from 'vitest'
import { PANEL_SENTINEL, buildEgoListTabsScript } from '../src/cast/panel-actions.ts'

describe('buildEgoListTabsScript', () => {
  const script = buildEgoListTabsScript('"space-a"')

  it('reads the inventory from the runtime facade', () => {
    expect(script).toContain('await taskSpaces.useOrCreate("space-a")')
    expect(script).toContain('await browser.listTabs()')
  })

  it('returns rows shaped for the panel strip', () => {
    expect(script).toContain('targetId: String(t.targetId')
    expect(script).toContain('active: t.active === true')
  })

  it('always prints the sentinel, on success and on failure', () => {
    expect(script).toContain(PANEL_SENTINEL)
    expect(script).toContain('ok: true, tabs: __rows')
    expect(script).toContain('ok: false, error:')
  })
})
