import { describe, expect, it } from 'vitest'
import { normalizeRecordedElement } from '../bin/record-normalize.mjs'

/**
 * The locked rule (2026-09-24): rewriting rules ARE allowed, but LOCATING
 * features such as `class` MUST be preserved. These tests pin that down so a
 * later edit cannot silently drop `class` or keep inspector chrome.
 */

describe('normalizeRecordedElement — class is a locating feature', () => {
  it('keeps page classes verbatim', () => {
    const r = normalizeRecordedElement('<span class="title-content-title">高端酒水为何卖不动了</span>', 7)
    expect(r).not.toBeNull()
    expect(r!.className).toBe('title-content-title')
    expect(r!.tagName).toBe('span')
    expect(r!.text).toBe('高端酒水为何卖不动了')
    // inner content preserved in the full record
    expect(r!.outerHTML).toContain('高端酒水为何卖不动了')
  })

  it('prunes ONLY the known inspector-chrome token, keeps the page class', () => {
    const r = normalizeRecordedElement(
      '<span class="title-content-title trae-browser-inspect-draggable">高端酒水为何卖不动了</span>',
      7,
    )
    expect(r!.className).toBe('title-content-title')
    expect(r!.outerHTML).not.toContain('trae-browser-inspect-draggable')
    expect(r!.outerHTML).toContain('title-content-title')
  })

  it('preserves locating/semantic attributes (id, role, aria-*, data-testid)', () => {
    const r = normalizeRecordedElement(
      '<button id="pay" role="button" class="btn primary" aria-label="付款" data-testid="pay-btn" data-trae-foo="x" style="color:red" onclick="evil()">Pay</button>',
      3,
    )
    expect(r!.className).toBe('btn primary') // class preserved
    expect(r!.outerHTML).toContain('id="pay"')
    expect(r!.outerHTML).toContain('role="button"')
    expect(r!.outerHTML).toContain('aria-label="付款"')
    expect(r!.outerHTML).toContain('data-testid="pay-btn"')
    // transient / chrome dropped
    expect(r!.outerHTML).not.toContain('style=')
    expect(r!.outerHTML).not.toContain('data-trae-foo')
    expect(r!.outerHTML).not.toContain('onclick')
  })

  it('never drops the class attribute even when its value is the only chrome token', () => {
    const r = normalizeRecordedElement('<div class="trae-browser-inspect-draggable">x</div>', 1)
    // class had only chrome -> attribute is omitted (not "class=" with nothing)
    expect(r!.outerHTML).not.toContain('class=')
    expect(r!.text).toBe('x')
  })

  it('returns null on empty / non-element input', () => {
    expect(normalizeRecordedElement('', 1)).toBeNull()
    expect(normalizeRecordedElement('   ', 1)).toBeNull()
  })

  it('passes through the backendNodeId and flags truncation on a huge subtree', () => {
    const big = `<div class="x">${'z'.repeat(5000)}</div>`
    const r = normalizeRecordedElement(big, 42)
    expect(r!.backendNodeId).toBe(42)
    expect(r!.truncated).toBe(true)
    expect(r!.outerHTML.length).toBeLessThan(big.length)
  })
})
