import { describe, expect, it } from 'vitest'
import { capabilitiesFor, capabilitiesForBrowser, capabilitiesFromEnvValue, engineOf } from '../src/cdp/capabilities.ts'

/**
 * Lightpanda backend acceptance: `engineOf` recognizes engines from the
 * `/json/version` `Browser` field, and `capabilitiesFor` projects per engine.
 * Regression red line: `chrome` / `unknown` project FULL capabilities —
 * bit-for-bit today's behavior for every endpoint we cannot positively
 * identify as Lightpanda.
 */

describe('engineOf — /json/version Browser field prefixes', () => {
  it('recognizes Lightpanda by its prefix', () => {
    expect(engineOf('Lightpanda/0.4.1')).toBe('lightpanda')
    expect(engineOf('Lightpanda/nightly+6fbbeee')).toBe('lightpanda')
    expect(engineOf('  Lightpanda/0.4.1  ')).toBe('lightpanda') // tolerant of padding
  })

  it('recognizes the Chrome family', () => {
    expect(engineOf('Chrome/153.0.0.0')).toBe('chrome')
    expect(engineOf('Chromium/120.0')).toBe('chrome')
    expect(engineOf('Edg/153.0.0.0')).toBe('chrome')
    expect(engineOf('Microsoft Edge 153.0.0.0')).toBe('chrome')
  })

  it('returns unknown for empty, non-string, forged, and foreign values', () => {
    expect(engineOf('')).toBe('unknown')
    expect(engineOf('   ')).toBe('unknown')
    expect(engineOf(undefined as unknown as string)).toBe('unknown')
    expect(engineOf('LightpandaImpostor/1.0')).toBe('unknown') // prefix must include the slash
    expect(engineOf('Firefox/130.0')).toBe('unknown')
    expect(engineOf('WebKit/610.1')).toBe('unknown')
  })
})

describe('capabilitiesFor — projection matrix', () => {
  it('projects lightpanda with every degraded bit off and png', () => {
    const caps = capabilitiesFor('lightpanda')
    expect(caps).toEqual({
      engine: 'lightpanda',
      screencast: false,
      overlay: false,
      bindingCalled: false,
      imageFormat: 'png',
      loadEvent: false,
      downloadEvents: false,
      browserClose: false,
    })
  })

  it('projects FULL capabilities for chrome AND unknown (regression red line)', () => {
    const full = {
      screencast: true,
      overlay: true,
      bindingCalled: true,
      imageFormat: 'jpeg',
      loadEvent: true,
      downloadEvents: true,
      browserClose: true,
    }
    expect(capabilitiesFor('chrome')).toEqual({ engine: 'chrome', ...full })
    expect(capabilitiesFor('unknown')).toEqual({ engine: 'unknown', ...full })
  })

  it('keeps the engine field in sync when projected from a Browser string', () => {
    expect(capabilitiesForBrowser('Lightpanda/0.4.1').engine).toBe('lightpanda')
    expect(capabilitiesForBrowser('Lightpanda/0.4.1').imageFormat).toBe('png')
    expect(capabilitiesForBrowser('Chrome/153').imageFormat).toBe('jpeg')
    expect(capabilitiesForBrowser('').engine).toBe('unknown')
    expect(capabilitiesForBrowser('').screencast).toBe(true) // unknown = full, never conservative
  })
})

describe('capabilitiesFromEnvValue — spawn-env projection', () => {
  it('projects lightpanda only for the exact engine id; everything else is full', () => {
    expect(capabilitiesFromEnvValue('lightpanda').imageFormat).toBe('png')
    expect(capabilitiesFromEnvValue('lightpanda').screencast).toBe(false)
    expect(capabilitiesFromEnvValue('chrome')).toEqual(capabilitiesFor('unknown'))
    expect(capabilitiesFromEnvValue('Chrome/153')).toEqual(capabilitiesFor('unknown')) // env is an id, not a Browser field
    expect(capabilitiesFromEnvValue(undefined)).toEqual(capabilitiesFor('unknown'))
  })
})
