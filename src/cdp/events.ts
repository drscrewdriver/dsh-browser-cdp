/**
 * src/cdp/events.ts — M0.3: domain dispatch, stateful-domain affinity, enable order.
 *
 * Two facts from the findings drive this module:
 *
 *  1. **A CDP domain's enabled state lives on the CONNECTION, not in the page.**
 *     `Overlay.highlightNode` through one process and `Overlay.enable` through
 *     another gives `Overlay must be enabled before a tool can be shown` (F10),
 *     and each `ego_cdp` call is a fresh process. So the same (target, domain)
 *     pair must always be served by the SAME connection — affinity is enforced
 *     here rather than trusted to callers.
 *  2. **Enable order matters.** `Overlay` resolves node ids that `DOM` hands
 *     out, so `DOM.enable` must precede `Overlay.enable`. Ordering is a
 *     function of the domain set, not of the order a caller happened to list
 *     them in.
 *
 * Pure and host-free: it holds no socket and performs no I/O, which is what
 * makes the affinity rule unit-testable without a browser.
 */

/** Domains whose `X.enable` must be called before their commands are valid. */
export const ENABLE_GATED_DOMAINS = [
  'Target',
  'Page',
  'Runtime',
  'DOM',
  'CSS',
  'Accessibility',
  'Overlay',
  'Network',
  'Log',
] as const

export type EnableGatedDomain = (typeof ENABLE_GATED_DOMAINS)[number]

/**
 * Canonical precedence. Anything not listed sorts after these, alphabetically —
 * so the result is total and deterministic for any input set, and
 * `DOM` always precedes `Overlay`.
 */
export const DOMAIN_PRECEDENCE: readonly string[] = ENABLE_GATED_DOMAINS

export function domainOf(method: string): string {
  const dot = method.indexOf('.')
  return dot === -1 ? '' : method.slice(0, dot)
}

export function enableMethod(domain: string): string {
  return `${domain}.enable`
}

export function isEnableGated(domain: string): boolean {
  return (ENABLE_GATED_DOMAINS as readonly string[]).includes(domain)
}

/**
 * Deduplicate a set of domains and return their `X.enable` methods in canonical
 * order. Input order never leaks into the output.
 */
export function orderEnableMethods(domains: readonly string[]): string[] {
  const unique = [...new Set(domains)].filter(isEnableGated)
  unique.sort((a, b) => {
    const rankA = DOMAIN_PRECEDENCE.indexOf(a)
    const rankB = DOMAIN_PRECEDENCE.indexOf(b)
    const sortA = rankA === -1 ? Number.MAX_SAFE_INTEGER : rankA
    const sortB = rankB === -1 ? Number.MAX_SAFE_INTEGER : rankB
    if (sortA !== sortB) return sortA - sortB
    return a < b ? -1 : a > b ? 1 : 0
  })
  return unique.map(enableMethod)
}

// ── stateful-domain affinity ────────────────────────────────────────────────

export interface DomainBound {
  ok: true
  connectionId: string
  /** False when the pair was already owned by this same connection. */
  fresh: boolean
}

export interface DomainSplit {
  ok: false
  code: 'domain-split'
  message: string
  /** The connection that already owns this (target, domain) pair. */
  owner: string
}

export type BindResult = DomainBound | DomainSplit

const pairKey = (targetId: string, domain: string): string => `${targetId}\u0000${domain}`

/**
 * Remembers which connection owns each (target, domain) pair.
 *
 * `bind` is the enforcement point: asking to serve an already-owned pair from a
 * DIFFERENT connection returns a structured `domain-split` error instead of
 * silently splitting the domain's state (which is the failure mode F10 records).
 */
export class DomainAffinity {
  #owners = new Map<string, string>()

  bind(targetId: string, domain: string, connectionId: string): BindResult {
    const key = pairKey(targetId, domain)
    const owner = this.#owners.get(key)
    if (owner === undefined) {
      this.#owners.set(key, connectionId)
      return { ok: true, connectionId, fresh: true }
    }
    if (owner === connectionId) return { ok: true, connectionId, fresh: false }
    return {
      ok: false,
      code: 'domain-split',
      owner,
      message:
        `${targetId}/${domain} is already served by connection "${owner}"; ` +
        `routing it through "${connectionId}" would split the domain's enabled state`,
    }
  }

  ownerOf(targetId: string, domain: string): string {
    return this.#owners.get(pairKey(targetId, domain)) ?? ''
  }

  /** Domains currently pinned for a target, in insertion order. */
  domainsOf(targetId: string): string[] {
    const prefix = `${targetId}\u0000`
    const out: string[] = []
    for (const key of this.#owners.keys()) {
      if (key.startsWith(prefix)) out.push(key.slice(prefix.length))
    }
    return out
  }

  /** Drop every pin held by a connection (it died, or was closed). */
  release(connectionId: string): number {
    let removed = 0
    for (const [key, owner] of [...this.#owners.entries()]) {
      if (owner === connectionId) {
        this.#owners.delete(key)
        removed += 1
      }
    }
    return removed
  }

  clear(): void {
    this.#owners.clear()
  }

  get size(): number {
    return this.#owners.size
  }
}

// ── event dispatch ──────────────────────────────────────────────────────────

export type EventDispatchHandler = (params: unknown, sessionId?: string, method?: string) => void

/** Whatever can deliver CDP events; `CdpSession` satisfies it structurally. */
export interface EventSource {
  on(method: string, handler: EventDispatchHandler): () => void
}

/**
 * Routes events by exact method or by whole domain.
 *
 * Domain routing is what lets the Overlay/Runtime consumers subscribe to
 * `Overlay.*` / `Runtime.*` without enumerating every event name, and a
 * throwing consumer is isolated so it cannot break the others.
 */
export class EventDispatcher {
  #byMethod = new Map<string, Set<EventDispatchHandler>>()
  #byDomain = new Map<string, Set<EventDispatchHandler>>()
  /** Events seen, for diagnostics and tests. */
  received = 0

  onMethod(method: string, handler: EventDispatchHandler): () => void {
    return subscribe(this.#byMethod, method, handler)
  }

  onDomain(domain: string, handler: EventDispatchHandler): () => void {
    return subscribe(this.#byDomain, domain, handler)
  }

  /** Feed one event in. Returns how many handlers were reached. */
  dispatch(method: string, params: unknown, sessionId?: string): number {
    this.received += 1
    const handlers = [
      ...(this.#byMethod.get(method) ?? []),
      ...(this.#byDomain.get(domainOf(method)) ?? []),
    ]
    for (const handler of handlers) {
      try {
        handler(params, sessionId, method)
      } catch {
        // Isolation: one consumer's bug is not the others' outage.
      }
    }
    return handlers.length
  }

  /** Subscribe this dispatcher to every event a session delivers. */
  wire(source: EventSource): () => void {
    return source.on('*', (params, sessionId, method) => {
      this.dispatch(method ?? '', params, sessionId)
    })
  }
}

function subscribe(
  registry: Map<string, Set<EventDispatchHandler>>,
  key: string,
  handler: EventDispatchHandler,
): () => void {
  if (!registry.has(key)) registry.set(key, new Set())
  registry.get(key)!.add(handler)
  return () => {
    registry.get(key)?.delete(handler)
  }
}

// ── ordered enable + affinity commit ────────────────────────────────────────

export interface EnableFailure {
  method: string
  message: string
}

export interface EnableResult {
  /** The exact sequence that was issued — hand it to `session.setReplay`. */
  order: string[]
  failures: EnableFailure[]
}

export type EnableCall = (
  method: string,
  params: unknown,
  options?: { sessionId?: string; timeoutMs?: number },
) => Promise<unknown>

/**
 * Enable a set of domains on one connection, in canonical order, and pin each
 * domain to that connection.
 *
 * Failures (a domain that will not enable, or a pair already owned elsewhere)
 * are RETURNED, never swallowed: the caller decides whether to abort, and the
 * `order` it gets back is exactly what the session should replay after a
 * reconnect.
 */
export async function enableDomains(
  call: EnableCall,
  sessionId: string | undefined,
  domains: readonly string[],
  affinity: DomainAffinity,
  targetId: string,
  connectionId: string,
): Promise<EnableResult> {
  const order = orderEnableMethods(domains)
  const failures: EnableFailure[] = []
  for (const method of order) {
    try {
      await call(method, {}, sessionId === undefined ? {} : { sessionId })
    } catch (error) {
      failures.push({ method, message: error instanceof Error ? error.message : String(error) })
      continue
    }
    const bound = affinity.bind(targetId, domainOf(method), connectionId)
    if (!bound.ok) failures.push({ method, message: bound.message })
  }
  return { order, failures }
}
