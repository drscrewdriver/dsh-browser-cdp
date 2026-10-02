/**
 * Pure link-sequence operations behind the settings card's 连接目标 editor.
 *
 * The client bundle cannot reach `src/cdp-targets.ts` (its import graph drags
 * node-side modules into the browser build), so the small rules the card needs
 * live here — deliberately the SAME rules the host enforces on read
 * (`sanitizeLinks`/`coerceLink`): ego-cli singleton, MAX cap, unusable-row
 * rejection. The card writes the WHOLE `links` array in one `scope.set`
 * (row-level volatile writes don't exist), which BYPASSES the host's
 * `upsertLink` rejections — these prechecks are therefore the only guard, and
 * the tests pin them to the host semantics.
 *
 * Two hard invariants (see plan `compat-0.2.0-dsh-browser-cdp` / findings
 * Agent C §3):
 * - a stored row's keys are all optional at runtime; edits must spread the
 *   original row (`{...row, ...patch}`) so probe state survives — a rebuilt
 *   thin row loses badges, and a bad `probeStatus` enum gets the WHOLE write
 *   rejected by the settings layer;
 * - a cdp row with an empty/invalid endpoint is silently dropped by the host's
 *   `coerceLink` on next resolve — the card must refuse to persist one.
 *
 * No react import: this module is unit-tested directly under vitest's node
 * environment (the client entry's `require('react')` makes index.ts
 * un-importable there).
 */

/** Hard ceiling on the sequence length — mirrors host `MAX_TARGETS`. */
export const MAX_LINKS = 32

/** Local ego CLI singleton default label — mirrors host `EGO_CLI_LABEL`. */
export const EGO_CLI_LABEL = '本机 ego CLI'

/**
 * Loose view of one stored row. Every field is optional because the settings
 * union's keys are runtime-optional and rows may predate a field; rows we
 * WRITE are always full-field (see the builders below).
 */
export interface FamLinkRow {
	kind?: string
	id?: string
	label?: string
	endpoint?: string
	cliPath?: string
	useSdkPath?: boolean
	enabled?: boolean
	note?: string
	probeStatus?: 'unknown' | 'ok' | 'error'
	probeLatencyMs?: number
	probeError?: string
	probeCode?: string
	probeAt?: number
}

/** Structured rejection codes — mirror the host `upsertLink` vocabulary. */
export type FamAddErrorCode = 'ego-cli-already-exists' | 'link-limit-reached' | 'unusable-row'

/** Flat add result: `code` present = rejected (mirror of upsertLink's `{ok,code}`). */
export interface FamAddResult {
	links: FamLinkRow[]
	code?: FamAddErrorCode
}

/** Fresh id, same shape as the host `newTargetId()` (uuid, `t-` fallback). */
export function newLinkId(): string {
	const cryptoObj = globalThis.crypto as Crypto | undefined
	if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID()
	return `t-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

/**
 * The card-side gate for persisting a cdp endpoint: non-empty and explicitly
 * scheme-qualified. Anything else would pass the settings write and then be
 * dropped by the host's `coerceLink` on the next resolve — invisible loss.
 */
export function isValidEndpoint(value: unknown): boolean {
	if (typeof value !== 'string') return false
	const v = value.trim()
	if (v === '') return false
	return /^(https?|wss?):\/\//i.test(v)
}

function trimmed(value: string | undefined): string {
	return typeof value === 'string' ? value.trim() : ''
}

/** Full-field cdp row: probe five-piece defaults so the write passes the union. */
export function buildCdpRow(input: { label?: string; endpoint: string }): FamLinkRow {
	const endpoint = trimmed(input.endpoint)
	return {
		kind: 'cdp',
		id: newLinkId(),
		label: trimmed(input.label) || endpoint,
		endpoint,
		enabled: true,
		note: '',
		probeStatus: 'unknown',
		probeLatencyMs: 0,
		probeError: '',
		probeCode: '',
		probeAt: 0,
	}
}

/** Full-field ego-cli row (`cliPath` '' = host auto-resolve chain). */
export function buildCliRow(input: { label?: string; cliPath?: string }): FamLinkRow {
	const cliPath = trimmed(input.cliPath)
	return {
		kind: 'ego-cli',
		id: newLinkId(),
		label: trimmed(input.label) || cliPath || EGO_CLI_LABEL,
		cliPath,
		useSdkPath: false,
		enabled: true,
		note: '',
		probeStatus: 'unknown',
		probeLatencyMs: 0,
		probeError: '',
		probeCode: '',
		probeAt: 0,
	}
}

/** Second ego-cli anywhere in the array would be silently dropped on read. */
export function hasCliLink(links: FamLinkRow[]): boolean {
	return links.some(function (row) { return row.kind === 'ego-cli' })
}

export function isFull(links: FamLinkRow[]): boolean {
	return links.length >= MAX_LINKS
}

/**
 * Append a pre-built row behind the host's structured rejections: the card
 * bypasses `upsertLink`, so the singleton and cap checks here are the only
 * guard before the write.
 */
export function addRow(links: FamLinkRow[], row: FamLinkRow): FamAddResult {
	if (row.kind === 'ego-cli' && hasCliLink(links)) return { links, code: 'ego-cli-already-exists' }
	if (links.length >= MAX_LINKS) return { links, code: 'link-limit-reached' }
	if (row.kind === 'cdp' && !isValidEndpoint(row.endpoint)) return { links, code: 'unusable-row' }
	return { links: links.concat([row]) }
}

/**
 * Patch one row by id, spreading the ORIGINAL row so probe state and any
 * field the patch omits survive verbatim. Unknown id → array returned
 * unchanged (new reference only if the map ran; callers treat it as no-op).
 */
export function updateRow(links: FamLinkRow[], id: string, patch: FamLinkRow): FamLinkRow[] {
	return links.map(function (row) {
		return row.id === id ? Object.assign({}, row, patch) : row
	})
}

/**
 * Filter one row out. Returns the removed row so the caller can clear
 * `activeTargetId` when it was the activated one (clear, never advance —
 * re-pointing every bcdp_* call at another browser is the host's job to
 * refuse, not the card's to decide).
 */
export function removeRow(links: FamLinkRow[], id: string): { links: FamLinkRow[]; removed: FamLinkRow | undefined } {
	const removed = links.find(function (row) { return row.id === id })
	return { links: links.filter(function (row) { return row.id !== id }), removed }
}

/** ±1 neighbour swap; out-of-range leaves the order untouched. */
export function moveRow(links: FamLinkRow[], id: string, delta: -1 | 1): FamLinkRow[] {
	const index = links.findIndex(function (row) { return row.id === id })
	const target = index + delta
	if (index < 0 || target < 0 || target >= links.length) return links
	const next = links.slice()
	const tmp = next[index]
	next[index] = next[target]
	next[target] = tmp
	return next
}

/** Write one probe outcome back into its row (spread-safe, full fields kept). */
export function applyProbe(
	links: FamLinkRow[],
	id: string,
	outcome: { ok: boolean; code?: string; message?: string; latencyMs?: number },
	at: number,
): FamLinkRow[] {
	return updateRow(links, id, {
		probeStatus: outcome.ok ? 'ok' : 'error',
		probeLatencyMs: typeof outcome.latencyMs === 'number' ? outcome.latencyMs : 0,
		probeError: outcome.ok ? '' : (outcome.message || ''),
		probeCode: outcome.ok ? '' : (outcome.code || ''),
		probeAt: at,
	})
}
