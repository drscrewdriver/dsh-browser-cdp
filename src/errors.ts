/**
 * src/errors.ts — structured failure contract for the `bcdp_*` tools.
 *
 * Why this exists: the rules in `skills/bcdp-browser/SKILL.md` ("after a failure
 * verify state before retrying — a blind second run can turn one submit into
 * two") were unenforceable, because a failure used to return `{ ok: false,
 * error: "…" }` and nothing else. The model could not tell whether the action
 * had reached the page. Every failure now carries four machine-readable fields:
 *
 *   code        what kind of failure this is
 *   retry       what the caller should do next: reobserve | retry | never
 *   actionSent  whether the action may already have reached the page
 *   hint        one concrete next step (≤ 60 chars), never page text
 *
 * The whole contract is applied in ONE place — the `register` hook in
 * `src/index.ts` wraps every tool's `execute` with `normalizeFailure`. Do not
 * hand-roll these fields at individual failure sites.
 *
 * Order matters when wiring: register `FAILURE_PROPS` into every strict
 * `output.schema` BEFORE the wrapper goes live. A schema with
 * `additionalProperties: false` silently drops unregistered fields, which is
 * how `bcdp_status`/`bcdp_script` once shipped "the tool runs but its output is
 * judged unusable".
 */

export const FAILURE_CODES = [
  'TIMEOUT',
  'LOCATOR_NOT_FOUND',
  'NAVIGATION_FAILED',
  'DIALOG_BLOCKING',
  'CAPTCHA',
  'USER_CONTROLLING',
  'SPACE_STALE',
  'BROWSER_DOWN',
  'BACKEND_UNSUPPORTED',
  'NO_PAYLOAD',
  'INVALID_ARGS',
  'UNKNOWN',
] as const

export type FailureCode = (typeof FAILURE_CODES)[number]
export type RetryAdvice = 'reobserve' | 'retry' | 'never'

/** Schema fragment for the four fields; spread into strict output schemas. */
export const FAILURE_PROPS = {
  code: { type: 'string' },
  retry: { type: 'string' },
  actionSent: { type: 'boolean' },
  hint: { type: 'string' },
} as const

/**
 * Tools whose failure MAY have already changed the page.
 *
 * Deliberately conservative: a false `actionSent` invites a blind retry that
 * duplicates a submit/click, while a superfluous `true` only costs one extra
 * observation. Observers (snapshot / page_info / screenshot / read_element /
 * wait / help / doctor / http / jev_*) are absent on purpose.
 */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  'bcdp_navigate',
  'bcdp_click',
  'bcdp_fill',
  'bcdp_key',
  'bcdp_hover',
  'bcdp_select',
  'bcdp_check',
  'bcdp_drag',
  'bcdp_scroll',
  'bcdp_upload',
  'bcdp_download',
  'bcdp_dialog',
  'bcdp_space',
  'bcdp_tab',
  'bcdp_js',
  'bcdp_cdp',
  'bcdp_script',
  'bcdp_auth_flush',
  'bcdp_login_import',
  'bcdp_captcha',
])

/** Heuristic classification from the legacy `error` / `text` strings. */
export function classifyFailure(message: string): FailureCode {
  const m = message.toLowerCase()
  if (/not supported|unsupported|not available on|被拒/.test(m)) return 'BACKEND_UNSUPPORTED'
  if (/locator|not found|no such element|ref .*invalid|stale ref/.test(m)) return 'LOCATOR_NOT_FOUND'
  if (/timeout|timed out|etimedout/.test(m)) return 'TIMEOUT'
  if (/dialog/.test(m)) return 'DIALOG_BLOCKING'
  if (/captcha|人机验证/.test(m)) return 'CAPTCHA'
  if (/user .*control|handoff|taking over|用户.*控制/.test(m)) return 'USER_CONTROLLING'
  if (/space .*(stale|gone|expired)|stale space/.test(m)) return 'SPACE_STALE'
  if (/not reachable|channel is closed|econnrefused|econnreset|browser .*down|no agent browser page/.test(m)) {
    return 'BROWSER_DOWN'
  }
  if (/navigation|net::err|failed to load|err_name_not_resolved/.test(m)) return 'NAVIGATION_FAILED'
  if (/payload|no result|sentinel|no result from/.test(m)) return 'NO_PAYLOAD'
  if (/required|invalid arg|expected .*got|must be/.test(m)) return 'INVALID_ARGS'
  return 'UNKNOWN'
}

/** What the caller should do next. Four codes are terminal on purpose. */
export function retryAdvice(code: FailureCode): RetryAdvice {
  if (
    code === 'CAPTCHA' ||
    code === 'USER_CONTROLLING' ||
    code === 'BACKEND_UNSUPPORTED' ||
    code === 'INVALID_ARGS'
  ) {
    return 'never'
  }
  if (code === 'TIMEOUT' || code === 'LOCATOR_NOT_FOUND' || code === 'NO_PAYLOAD') return 'reobserve'
  return 'retry'
}

/**
 * One concrete next step per code. Generated from the code, never concatenated
 * from the error string: page content is untrusted data and must not end up in
 * the instruction position.
 */
export const FAILURE_HINTS: Record<FailureCode, string> = {
  TIMEOUT: '先 bcdp_snapshot 看当前状态，再决定是否重试。',
  LOCATOR_NOT_FOUND: '重新 bcdp_snapshot 取新的 loc=，不要复用旧 ref。',
  NAVIGATION_FAILED: '核对 URL 与网络；不要连续重试同一地址。',
  DIALOG_BLOCKING: '先 bcdp_dialog 处理对话框，再重跑本动作。',
  CAPTCHA: '交给人：bcdp_captcha 或 bcdp_wait_for_human。',
  USER_CONTROLLING: '停下等用户交还控制权（bcdp_space op=takeover）。',
  SPACE_STALE: '用 bcdp_space op=open 重建空间后重试一次。',
  BROWSER_DOWN: '跑 bcdp_doctor，确认通道与浏览器进程。',
  BACKEND_UNSUPPORTED: '读 references/recovery.md 换后端，不要重试。',
  NO_PAYLOAD: '先 bcdp_page_info 确认页面可读。',
  INVALID_ARGS: '按返回的字段要求修正参数。',
  UNKNOWN: '先 bcdp_page_info 观察，再决定。',
}

/** True when `value` already carries an explicit classification. */
function hasExplicitContract(v: Record<string, unknown>): boolean {
  return typeof v.code === 'string' && typeof v.retry === 'string'
}

/**
 * Add the failure contract to a tool result.
 *
 * Success values, non-objects and already-classified failures pass through
 * untouched — this is the zero-regression guarantee, and it also makes the
 * wrapper idempotent when a tool (or a legacy alias) was wrapped twice.
 */
export function normalizeFailure(toolName: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  const v = value as Record<string, unknown>
  if (v.ok !== false) return value
  if (hasExplicitContract(v)) return value
  const message = String(v.error ?? v.text ?? v.reason ?? '')
  const code = classifyFailure(message)
  return {
    ...v,
    code,
    retry: retryAdvice(code),
    actionSent: MUTATING_TOOLS.has(toolName),
    hint: FAILURE_HINTS[code],
  }
}
