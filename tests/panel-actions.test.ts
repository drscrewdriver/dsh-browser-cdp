import { describe, it, expect } from 'vitest'
import {
  PANEL_SENTINEL,
  parsePanelResult,
  buildEgoWindowSizeScript,
  buildEgoNavigateScript,
} from '../src/cast/panel-actions.ts'
import { MAX_VIEWPORT_WIDTH, MIN_VIEWPORT_HEIGHT, MIN_VIEWPORT_WIDTH } from '../src/worker/window-size.ts'

describe('parsePanelResult', () => {
  it('parses the newest sentinel line', () => {
    const out = `noise\n${PANEL_SENTINEL}{"ok":true,"viewport":{"width":1280,"height":720}}\n`
    expect(parsePanelResult(out)).toEqual({ ok: true, viewport: { width: 1280, height: 720 } })
  })
  it('prefers the LAST sentinel line when several exist', () => {
    const out = `${PANEL_SENTINEL}{"ok":false,"error":"first"}\n${PANEL_SENTINEL}{"ok":true,"windowId":7}\n`
    expect(parsePanelResult(out)).toEqual({ ok: true, windowId: 7 })
  })
  it('coerces a non-boolean ok to false', () => {
    expect(parsePanelResult(`${PANEL_SENTINEL}{"error":"x"}`)).toEqual({ error: 'x', ok: false })
  })
  it('returns null without a sentinel', () => {
    expect(parsePanelResult('plain output\n')).toBeNull()
  })
  it('returns null for malformed JSON', () => {
    expect(parsePanelResult(`${PANEL_SENTINEL}{not json`)).toBeNull()
  })
  it('ignores an empty payload and falls back to an earlier line', () => {
    const out = `${PANEL_SENTINEL}{"ok":true}\n${PANEL_SENTINEL}\n`
    expect(parsePanelResult(out)).toEqual({ ok: true })
  })
})

describe('buildEgoWindowSizeScript', () => {
  const script = buildEgoWindowSizeScript(JSON.stringify('agent-space'), {
    width: 1280,
    delta: 40,
    dy: -10,
    aspect: '16:9',
    maximize: false,
    url: 'https://evil.example', // not part of the window-size contract
  })

  it('uses the runtime facade + raw CDP passthrough', () => {
    expect(script).toContain("taskSpaces.useOrCreate(\"agent-space\")")
    expect(script).toContain('browser.currentTab()')
    expect(script).toContain('page.info()')
    expect(script).toContain("cdp('Browser.getWindowForTarget'")
    expect(script).toContain("cdp('Browser.setWindowBounds'")
  })

  it('falls back to a session-less getWindowForTarget when targetId is rejected', () => {
    expect(script).toContain("catch { __win = await cdp('Browser.getWindowForTarget', {}) }")
  })

  it('restores a non-normal window state before sizing', () => {
    expect(script).toContain("__b.windowState !== 'normal'")
    expect(script).toContain("bounds: { windowState: 'normal' }")
  })

  it('inlines the shared clamp bounds and aspect table', () => {
    expect(script).toContain(`const __bcdpClampW = (w) => Math.min(${MAX_VIEWPORT_WIDTH}, Math.max(${MIN_VIEWPORT_WIDTH}, Math.round(w)))`)
    expect(script).toContain('__bcdpClampH')
    expect(script).toContain('"16:9":0.5625')
  })

  it('drops fields outside the window-size contract', () => {
    expect(script).not.toContain('evil.example')
  })

  it('reports failure through the sentinel instead of throwing', () => {
    expect(script).toContain(`catch (__bcdpErr)`)
    expect(script).toContain(PANEL_SENTINEL)
  })

  it('embeds U+2028 escaped (never a raw line separator in source)', () => {
    const withSep = buildEgoWindowSizeScript(JSON.stringify('s'), { url: 'a\u2028b' } as Record<string, unknown>)
    expect(withSep).not.toContain('\u2028')
  })
})

describe('buildEgoNavigateScript', () => {
  it('reloads through page.reload', () => {
    const script = buildEgoNavigateScript(JSON.stringify('agent-space'), { reload: true, ignoreCache: true })
    expect(script).toContain('await page.reload({ ignoreCache: __bcdpReq.ignoreCache === true })')
    expect(script).toContain('reloaded: true')
  })
  it('navigates through page.goto and rejects an empty url', () => {
    const script = buildEgoNavigateScript(JSON.stringify('agent-space'), { url: '  https://example.com  ' })
    expect(script).toContain('await page.goto(__target)')
    expect(script).toContain('"url":"https://example.com"')
    expect(script).toContain("throw new Error('url required')")
  })
  it('omits an empty url entirely', () => {
    const script = buildEgoNavigateScript(JSON.stringify('s'), { url: '   ' })
    expect(script).toContain('const __bcdpReq = {}')
  })
  it('caps an absurd url length', () => {
    const long = 'https://example.com/' + 'a'.repeat(9000)
    const script = buildEgoNavigateScript(JSON.stringify('s'), { url: long })
    expect(script.length).toBeLessThan(long.length)
  })
  it('skips unknown fields', () => {
    const script = buildEgoNavigateScript(JSON.stringify('s'), { url: 'https://a.example', targetId: 'secret' })
    expect(script).not.toContain('secret')
  })
  it('keeps the minimum-height constant wired for size scripts only', () => {
    expect(buildEgoNavigateScript(JSON.stringify('s'), { reload: true })).not.toContain(String(MIN_VIEWPORT_HEIGHT))
  })
})
