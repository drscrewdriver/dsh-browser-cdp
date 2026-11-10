import { describe, it, expect } from 'vitest'
import {
  clampViewportSize,
  widthWithDelta,
  computeWindowBounds,
  aspectHeight,
  ASPECT_RATIOS,
  MIN_VIEWPORT_WIDTH,
  MIN_VIEWPORT_HEIGHT,
  MAX_VIEWPORT_WIDTH,
  MAX_VIEWPORT_HEIGHT,
} from '../src/worker/window-size.ts'

describe('clampViewportSize', () => {
  it('passes through in-range values (rounded)', () => {
    expect(clampViewportSize(1280.4, 720.6)).toEqual({ width: 1280, height: 721 })
  })
  it('clamps below the minimum', () => {
    expect(clampViewportSize(10, 10)).toEqual({ width: MIN_VIEWPORT_WIDTH, height: MIN_VIEWPORT_HEIGHT })
  })
  it('clamps above the maximum', () => {
    expect(clampViewportSize(99999, 99999)).toEqual({ width: MAX_VIEWPORT_WIDTH, height: MAX_VIEWPORT_HEIGHT })
  })
})

describe('widthWithDelta', () => {
  it('adds a positive delta', () => {
    expect(widthWithDelta(1000, 200)).toBe(1200)
  })
  it('subtracts a negative delta', () => {
    expect(widthWithDelta(1000, -200)).toBe(800)
  })
  it('clamps the lower bound', () => {
    expect(widthWithDelta(400, -9999)).toBe(MIN_VIEWPORT_WIDTH)
  })
  it('clamps the upper bound', () => {
    expect(widthWithDelta(3000, 9999)).toBe(MAX_VIEWPORT_WIDTH)
  })
})

describe('computeWindowBounds', () => {
  it('adds the chrome frame to the viewport', () => {
    const b = computeWindowBounds({ width: 1200, height: 800 }, { width: 16, height: 90 }, { left: 100, top: 50 })
    expect(b.width).toBe(1216)
    expect(b.height).toBe(890)
    expect(b.left).toBe(100)
    expect(b.top).toBe(50)
    expect(b.windowState).toBe('normal')
  })
  it('omits left/top when unknown', () => {
    const b = computeWindowBounds({ width: 1200, height: 800 })
    expect('left' in b).toBe(false)
    expect('top' in b).toBe(false)
  })
  it('never below the minimum window size', () => {
    const b = computeWindowBounds({ width: 1, height: 1 }, { width: 0, height: 0 })
    expect(b.width).toBe(MIN_VIEWPORT_WIDTH)
    expect(b.height).toBe(MIN_VIEWPORT_HEIGHT)
  })
  it('treats negative chrome frame as zero', () => {
    const b = computeWindowBounds({ width: 1200, height: 800 }, { width: -50, height: -50 })
    expect(b.width).toBe(1200)
    expect(b.height).toBe(800)
  })
})

describe('aspectHeight / ASPECT_RATIOS', () => {
  it('exposes the five presets', () => {
    expect(Object.keys(ASPECT_RATIOS).sort()).toEqual(['16:9', '1:1', '21:9', '4:3', '9:16'].sort())
  })
  it('computes height from width', () => {
    expect(aspectHeight(1600, '16:9', 0)).toBe(900)
    expect(aspectHeight(1024, '4:3', 0)).toBe(768)
    expect(aspectHeight(1000, '1:1', 0)).toBe(1000)
    // 21:9 → 9/21 ≈ 0.4286
    expect(aspectHeight(2100, '21:9', 0)).toBe(900)
  })
  it('falls back to the given height for an unknown preset', () => {
    expect(aspectHeight(1600, '3:2', 777)).toBe(777)
  })
})
