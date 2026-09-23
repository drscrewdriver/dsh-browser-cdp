import { describe, expect, it } from 'vitest'
import {
  DomainAffinity,
  EventDispatcher,
  domainOf,
  enableDomains,
  enableMethod,
  isEnableGated,
  orderEnableMethods,
  type EventSource,
} from '../src/cdp/events.ts'

/**
 * M0.3 acceptance (decomposition.md): events dispatch by domain; a stateful
 * domain is pinned to ONE connection (F10: a different process gets
 * `Overlay must be enabled before a tool can be shown`); `enable()` guarantees
 * `DOM.enable` precedes `Overlay.enable`.
 *
 * Pure module, so nothing here needs a socket or a clock.
 */

describe('M0.3 domain naming and enable order', () => {
  it('extracts the domain from a method', () => {
    expect(domainOf('DOM.enable')).toBe('DOM')
    expect(domainOf('Overlay.inspectNodeRequested')).toBe('Overlay')
    expect(domainOf('nonsense')).toBe('')
  })

  it('puts DOM before Overlay regardless of input order', () => {
    expect(orderEnableMethods(['Overlay', 'DOM'])).toEqual(['DOM.enable', 'Overlay.enable'])
    expect(orderEnableMethods(['DOM', 'Overlay'])).toEqual(['DOM.enable', 'Overlay.enable'])
  })

  it('deduplicates, drops non-gated domains, and ignores input order', () => {
    const forward = orderEnableMethods(['Overlay', 'DOM', 'Overlay', 'Input', 'Page'])
    const reversed = orderEnableMethods(['Page', 'Input', 'DOM', 'Overlay', 'Overlay'])
    expect(forward).toEqual(reversed)
    expect(forward).toEqual(['Page.enable', 'DOM.enable', 'Overlay.enable'])
    expect(forward).not.toContain('Input.enable')
  })

  it('knows which domains are enable-gated', () => {
    expect(isEnableGated('Overlay')).toBe(true)
    expect(isEnableGated('Input')).toBe(false)
    expect(enableMethod('Runtime')).toBe('Runtime.enable')
  })

  it('returns an empty sequence for an empty or fully unlisted set', () => {
    expect(orderEnableMethods([])).toEqual([])
    expect(orderEnableMethods(['Input', 'Nope'])).toEqual([])
  })
})

describe('M0.3 DomainAffinity', () => {
  it('pins a (target, domain) pair to the first connection that claims it', () => {
    const affinity = new DomainAffinity()
    expect(affinity.bind('T1', 'DOM', 'conn-a')).toEqual({ ok: true, connectionId: 'conn-a', fresh: true })
    expect(affinity.bind('T1', 'DOM', 'conn-a')).toEqual({ ok: true, connectionId: 'conn-a', fresh: false })
    expect(affinity.ownerOf('T1', 'DOM')).toBe('conn-a')
  })

  it('refuses to hand the same pair to a second connection', () => {
    const affinity = new DomainAffinity()
    affinity.bind('T1', 'Overlay', 'conn-a')
    const split = affinity.bind('T1', 'Overlay', 'conn-b')
    expect(split).toMatchObject({ ok: false, code: 'domain-split', owner: 'conn-a' })
    expect(split.ok === false && split.message).toContain('conn-a')
  })

  it('keeps different targets and different domains independent', () => {
    const affinity = new DomainAffinity()
    affinity.bind('T1', 'DOM', 'conn-a')
    expect(affinity.bind('T1', 'Overlay', 'conn-b').ok).toBe(true)
    expect(affinity.bind('T2', 'DOM', 'conn-b').ok).toBe(true)
    expect(affinity.size).toBe(3)
  })

  it('reports the domains pinned for a target, in insertion order', () => {
    const affinity = new DomainAffinity()
    affinity.bind('T1', 'DOM', 'conn-a')
    affinity.bind('T1', 'Overlay', 'conn-a')
    affinity.bind('T2', 'DOM', 'conn-a')
    expect(affinity.domainsOf('T1')).toEqual(['DOM', 'Overlay'])
    expect(affinity.domainsOf('T9')).toEqual([])
  })

  it('releases everything a dead connection held, so the next one can claim it', () => {
    const affinity = new DomainAffinity()
    affinity.bind('T1', 'DOM', 'conn-a')
    affinity.bind('T1', 'Overlay', 'conn-a')
    affinity.bind('T1', 'Page', 'conn-b')
    expect(affinity.release('conn-a')).toBe(2)
    expect(affinity.ownerOf('T1', 'DOM')).toBe('')
    expect(affinity.bind('T1', 'DOM', 'conn-c').ok).toBe(true)
    expect(affinity.ownerOf('T1', 'Page')).toBe('conn-b')
  })

  it('never returns an empty owner for an unbound pair (no falsy confusion)', () => {
    const affinity = new DomainAffinity()
    expect(affinity.ownerOf('nope', 'nope')).toBe('')
    affinity.clear()
    expect(affinity.size).toBe(0)
  })
})

describe('M0.3 EventDispatcher', () => {
  it('routes by exact method and by whole domain', () => {
    const dispatcher = new EventDispatcher()
    const exact: string[] = []
    const domain: string[] = []
    dispatcher.onMethod('Overlay.inspectNodeRequested', (params) => exact.push(JSON.stringify(params)))
    dispatcher.onDomain('Overlay', (_params, sessionId, method) => domain.push(`${method}@${sessionId}`))

    const reached = dispatcher.dispatch('Overlay.inspectNodeRequested', { backendNodeId: 7 }, 'S-1')
    expect(reached).toBe(2)
    expect(exact).toEqual(['{"backendNodeId":7}'])
    expect(domain).toEqual(['Overlay.inspectNodeRequested@S-1'])
    expect(dispatcher.received).toBe(1)
  })

  it('does not route a different domain to a domain subscriber', () => {
    const dispatcher = new EventDispatcher()
    const seen: string[] = []
    dispatcher.onDomain('Overlay', () => seen.push('overlay'))
    dispatcher.dispatch('DOM.documentUpdated', {}, undefined)
    expect(seen).toEqual([])
  })

  it('isolates a throwing consumer from the others', () => {
    const dispatcher = new EventDispatcher()
    const seen: string[] = []
    dispatcher.onDomain('Runtime', () => {
      throw new Error('consumer blew up')
    })
    dispatcher.onDomain('Runtime', () => seen.push('survived'))
    expect(dispatcher.dispatch('Runtime.bindingCalled', { name: 'dsh' }, undefined)).toBe(2)
    expect(seen).toEqual(['survived'])
  })

  it('unsubscribes cleanly', () => {
    const dispatcher = new EventDispatcher()
    let hits = 0
    const off = dispatcher.onMethod('Page.loadEventFired', () => {
      hits += 1
    })
    dispatcher.dispatch('Page.loadEventFired', {})
    off()
    dispatcher.dispatch('Page.loadEventFired', {})
    expect(hits).toBe(1)
  })

  it('wires a wildcard source so every event lands in the dispatcher', () => {
    const dispatched: string[] = []
    const dispatcher = new EventDispatcher()
    dispatcher.onDomain('Overlay', (_params, _sessionId, method) => dispatched.push(method ?? ''))
    const source: EventSource = {
      on: (method, handler) => {
        expect(method).toBe('*') // the catch-all the session provides
        handler({ backendNodeId: 1 }, undefined, 'Overlay.inspectNodeRequested')
        return () => {}
      },
    }
    const off = dispatcher.wire(source)
    expect(dispatched).toEqual(['Overlay.inspectNodeRequested'])
    expect(typeof off).toBe('function')
  })
})

describe('M0.3 enableDomains', () => {
  const noop = async (): Promise<unknown> => ({})

  it('issues the enables in canonical order and pins the domains', async () => {
    const issued: string[] = []
    const affinity = new DomainAffinity()
    const result = await enableDomains(
      async (method) => {
        issued.push(method)
        return {}
      },
      'S-1',
      ['Overlay', 'DOM'],
      affinity,
      'T1',
      'conn-a',
    )
    expect(issued).toEqual(['DOM.enable', 'Overlay.enable'])
    expect(result.order).toEqual(['DOM.enable', 'Overlay.enable'])
    expect(result.failures).toEqual([])
    expect(affinity.ownerOf('T1', 'DOM')).toBe('conn-a')
    expect(affinity.ownerOf('T1', 'Overlay')).toBe('conn-a')
  })

  it('records a domain that will not enable, and keeps going', async () => {
    const affinity = new DomainAffinity()
    const result = await enableDomains(
      async (method) => {
        if (method === 'DOM.enable') throw new Error('DOM is not available')
        return {}
      },
      undefined,
      ['DOM', 'Overlay'],
      affinity,
      'T1',
      'conn-a',
    )
    expect(result.failures).toEqual([{ method: 'DOM.enable', message: 'DOM is not available' }])
    expect(affinity.ownerOf('T1', 'DOM')).toBe('') // not pinned on failure
    expect(affinity.ownerOf('T1', 'Overlay')).toBe('conn-a')
  })

  it('surfaces a domain split as a failure instead of silently re-pinning', async () => {
    const affinity = new DomainAffinity()
    affinity.bind('T1', 'Overlay', 'conn-a')
    const result = await enableDomains(noop, undefined, ['Overlay'], affinity, 'T1', 'conn-b')
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.method).toBe('Overlay.enable')
    expect(result.failures[0]!.message).toContain('conn-a') // names the owning connection
    expect(affinity.ownerOf('T1', 'Overlay')).toBe('conn-a')
  })

  it('omits sessionId entirely for browser-level enables', async () => {
    const seen: Array<{ sessionId?: string }> = []
    await enableDomains(
      async (_method, _params, options) => {
        seen.push({ ...(options?.sessionId === undefined ? {} : { sessionId: options.sessionId }) })
        return {}
      },
      undefined,
      ['Page'],
      new DomainAffinity(),
      'browser',
      'conn-a',
    )
    expect(seen).toEqual([{}])
  })
})
