/**
 * src/worker/pick-channel.ts — M1.4 / T5.1c: the resident CDP pick channel.
 *
 * This is the first PRODUCTION consumer of the M0.x base, and it closes the
 * gap T5.1c names: mode-style commands (`Overlay.setInspectMode`) and event
 * subscriptions must run on a connection that STAYS OPEN. The cast worker
 * already is such a process — `active.cdp` is one long-lived browser
 * connection and `active.sessions` owns the per-target page sessions — so the
 * pick channel rides that instead of opening anything new.
 *
 * What it borrows from the M0.x layer rather than re-deriving:
 *  - `orderEnableMethods` / `enableDomains` → `DOM.enable` before `Overlay.enable`
 *    no matter what order the caller lists, with failures RETURNED not swallowed;
 *  - `DomainAffinity` → a (target, domain) pair already owned elsewhere is a
 *    structured `domain-split`, because a split Overlay is dead (F10);
 *  - `setInspectMode` → `highlightConfig` is mandatory, enforced in-process.
 *
 * T5.13 is honoured here: a pick EXITS inspect mode immediately, otherwise the
 * picker keeps swallowing the left button and the floating bar cannot be
 * clicked.
 */

import type { CdpClient } from './cdp-client.ts'
import type { TargetSessions } from './capture-cdp.ts'
import { DomainAffinity, enableDomains } from '../cdp/events.ts'
import {
  DISABLED_HIGHLIGHT_CONFIG,
  NEUTRAL_HIGHLIGHT_CONFIG,
  readScrollOffset,
  setInspectMode,
  type PageCall,
} from '../cdp/page.ts'
import { boxModel, describeNode, flattenAxTree, accessibilityTree } from '../cdp/dom.ts'

/** The rich identity R6 serialises and the panel draws a frame around. */
export interface PickElement {
  backendNodeId: number
  tag: string
  id: string
  role: string
  name: string
  keyboardFocusable: boolean
  /** VIEWPORT-space rect (scroll already subtracted). Null when unmeasurable. */
  rect: { x: number; y: number; width: number; height: number } | null
  /** Document-space rect, kept for diagnostics. */
  documentRect: { x: number; y: number; width: number; height: number } | null
  /** Single-line serialisation fed to the conversation. */
  describe: string
}

export interface PickState {
  enabled: boolean
  targetId: string
  code: string
  message: string
  lastPick: PickElement | null
  picks: number
  /** Domains successfully enabled on this pick session, in issue order. */
  enabledDomains: string[]
}

export interface PickChannelOptions {
  cdp: CdpClient
  sessions: TargetSessions
  onPick?: (element: PickElement) => void
  onError?: (code: string, message: string) => void
}

const CONNECTION_ID = 'cast-worker'

export function describeElement(semantics: { tag: string; id: string; role: string; name: string; keyboardFocusable: boolean }): string {
  const parts = [semantics.tag || 'node']
  if (semantics.id !== '') parts.push(`#${semantics.id}`)
  if (semantics.role !== '') parts.push(`role=${semantics.role}`)
  parts.push(`name="${semantics.name}"`)
  parts.push(semantics.keyboardFocusable ? 'focusable' : 'not-focusable')
  return parts.join(' ')
}

export class PickChannel {
  #cdp: CdpClient
  #sessions: TargetSessions
  #onPick?: (element: PickElement) => void
  #onError?: (code: string, message: string) => void
  #affinity = new DomainAffinity()
  #state: PickState = {
    enabled: false,
    targetId: '',
    code: 'idle',
    message: '',
    lastPick: null,
    picks: 0,
    enabledDomains: [],
  }
  #detachPick: (() => void) | null = null

  constructor(options: PickChannelOptions) {
    this.#cdp = options.cdp
    this.#sessions = options.sessions
    this.#onPick = options.onPick
    this.#onError = options.onError
  }

  state(): PickState {
    return { ...this.#state, lastPick: this.#state.lastPick === null ? null : { ...this.#state.lastPick } }
  }

  /**
   * Turn inspect mode on or off for one target.
   *
   * Turning it on enables `DOM` + `Overlay` in canonical order, pins them to
   * this connection, and only then enters inspect mode — so a failure at any
   * step leaves `enabled: false` with the reason, never a half-armed picker.
   */
  async setEnabled(enabled: boolean, targetId: string): Promise<PickState> {
    if (!enabled) return this.#disable(targetId)
    if (targetId === '') return this.#fail('target-required', 'a targetId is required to start picking')

    const session = await this.#sessions.ensure(targetId)
    const call: PageCall = (method, params, options) =>
      this.#sessions.call(targetId, method, params, options?.timeoutMs ?? 6000)

    const enabledDomains = await enableDomains(
      call,
      session.sessionId,
      ['Overlay', 'DOM'], // out of order on purpose: DOM must win
      this.#affinity,
      targetId,
      CONNECTION_ID,
    )
    if (enabledDomains.failures.length > 0) {
      const first = enabledDomains.failures[0]!
      return this.#fail('enable-failed', `${first.method}: ${first.message}`)
    }

    const armed = await setInspectMode(call, {
      mode: 'searchForNode',
      config: NEUTRAL_HIGHLIGHT_CONFIG,
      sessionId: session.sessionId,
    })
    if (!armed.ok) return this.#fail(armed.code, armed.message)

    this.#subscribePick(session.sessionId)
    this.#state = {
      ...this.#state,
      enabled: true,
      targetId,
      code: 'picking',
      message: '',
      enabledDomains: enabledDomains.order,
    }
    return this.state()
  }

  /**
   * Leave inspect mode and drop the event subscription. Safe to call when
   * already disabled — the panel calls it on unmount, tab switches and
   * target changes, and none of those should have to check first.
   */
  async #disable(targetId: string): Promise<PickState> {
    const effectiveTarget = targetId !== '' ? targetId : this.#state.targetId
    this.#detachPick?.()
    this.#detachPick = null
    if (effectiveTarget !== '') {
      const session = this.#sessions.get(effectiveTarget)
      if (session !== null) {
        const call: PageCall = (method, params, options) =>
          this.#sessions.call(effectiveTarget, method, params, options?.timeoutMs ?? 6000)
        const off = await setInspectMode(call, {
          mode: 'none',
          config: DISABLED_HIGHLIGHT_CONFIG,
          sessionId: session.sessionId,
        })
        if (!off.ok) {
          this.#onError?.(off.code, off.message)
        }
      }
    }
    this.#state = { ...this.#state, enabled: false, code: 'idle', message: '' }
    return this.state()
  }

  #subscribePick(sessionId: string): void {
    this.#detachPick?.()
    this.#detachPick = this.#cdp.on('Overlay.inspectNodeRequested', (params, eventSessionId) => {
      // Events from other targets' sessions must not steer this picker.
      if (!this.#state.enabled || eventSessionId !== sessionId) return
      const backendNodeId = (params as { backendNodeId?: unknown })?.backendNodeId
      if (typeof backendNodeId !== 'number') return
      void this.#handlePick(sessionId, backendNodeId)
    })
  }

  async #handlePick(sessionId: string, backendNodeId: number): Promise<void> {
    const targetId = this.#state.targetId
    const call: PageCall = (method, params, options) =>
      this.#sessions.call(targetId, method, params, options?.timeoutMs ?? 6000)

    // T5.13: exit inspect mode the instant something is picked, or the picker
    // keeps eating the left button and the UI we draw cannot be clicked.
    this.#detachPick?.()
    this.#detachPick = null
    await setInspectMode(call, { mode: 'none', config: DISABLED_HIGHLIGHT_CONFIG, sessionId })
    this.#state = { ...this.#state, enabled: false, code: 'picked', message: '' }

    const scroll = await readScrollOffset(call, sessionId)
    const scrollOffset = scroll.ok ? { x: scroll.x, y: scroll.y } : { x: 0, y: 0 }
    if (!scroll.ok) this.#onError?.(scroll.code, scroll.message)

    const semantics = await describeNode(call, sessionId, { backendNodeId })
    if (!semantics.ok) {
      // G7: a pick without a resolved node description is NOT a pick.
      this.#fail(semantics.code, semantics.message)
      return
    }
    const box = await boxModel(call, sessionId, { backendNodeId }, { scroll: scrollOffset })

    const element: PickElement = {
      backendNodeId,
      tag: semantics.tag,
      id: semantics.id,
      role: semantics.role,
      name: semantics.name,
      keyboardFocusable: semantics.keyboardFocusable,
      rect: box.ok ? box.rect : null,
      documentRect: box.ok ? box.documentRect : null,
      describe: describeElement(semantics),
    }
    this.#state = { ...this.#state, lastPick: element, picks: this.#state.picks + 1 }
    this.#onPick?.(element)
  }

  /** Semantic candidates from the accessibility tree; used by the R5 loop later. */
  async candidates(limit = 200): Promise<ReturnType<typeof flattenAxTree>> {
    const targetId = this.#state.targetId
    if (targetId === '') return []
    const session = this.#sessions.get(targetId)
    if (session === null) return []
    const call: PageCall = (method, params, options) =>
      this.#sessions.call(targetId, method, params, options?.timeoutMs ?? 6000)
    const tree = await accessibilityTree(call, session.sessionId)
    if (!tree.ok) return []
    return tree.nodes.filter((node) => !node.ignored).slice(0, limit)
  }

  #fail(code: string, message: string): PickState {
    this.#state = { ...this.#state, enabled: false, code, message }
    this.#onError?.(code, message)
    return this.state()
  }

  dispose(): void {
    this.#detachPick?.()
    this.#detachPick = null
    this.#affinity.clear()
  }
}
