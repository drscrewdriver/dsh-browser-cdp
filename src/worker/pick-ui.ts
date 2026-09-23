/**
 * src/worker/pick-ui.ts — M1.5 / T5.10–T5.12: the injected selection UI.
 *
 * Drawn INTO the page through `Runtime.evaluate` — not with
 * `Overlay.highlightNode`, which F12.3 measured as unable to keep a highlight
 * alive alongside interaction. The UI is:
 *   - a 2px sky-blue frame at the picked element's viewport rect;
 *   - a floating action bar just below it (flipped above when out of bounds)
 *     with the two T5.11 actions; buttons and the Ctrl+J / Enter shortcuts
 *     report back through a `Runtime.addBinding` channel (T5.12), never by
 *     polling.
 *
 * Every entry point takes the page `call` face so tests can script CDP; the
 * expression is a single self-contained IIFE whose only external inputs are
 * JSON-serialised.
 */

import type { PageCall } from '../cdp/page.ts'
import type { PickElement } from './pick-channel.ts'

export const PICK_BINDING = '__dshPickAction'

/** The one page-bar action: everything is QUOTED into the draft — the user
 * sends it themselves (2026-09-23 revision: auto-submit removed). */
export type PickAction = 'quote'

export interface PickUiOutcome {
  ok: boolean
  code: string
  message: string
}

async function evaluate(call: PageCall, sessionId: string, expression: string): Promise<PickUiOutcome> {
  try {
    const result = (await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: false,
    }, { sessionId, timeoutMs: 6000 })) as { exceptionDetails?: { text?: string; exception?: { description?: string } } }
    if (result && typeof result === 'object' && result.exceptionDetails) {
      const detail = result.exceptionDetails
      return {
        ok: false,
        code: 'ui-eval-failed',
        message: detail.exception?.description || detail.text || 'Runtime.evaluate threw',
      }
    }
    return { ok: true, code: 'ok', message: '' }
  } catch (error) {
    const err = error as { code?: string; message?: string }
    return { ok: false, code: err?.code ?? 'ui-eval-failed', message: err?.message ?? String(error) }
  }
}

/**
 * The page-side program. Kept as one string so it survives `Runtime.evaluate`
 * with no bundler involved. Idempotent: re-running replaces the previous UI.
 */
function uiExpression(element: PickElement): string {
  const payload = JSON.stringify({
    rect: element.rect,
    describe: element.describe,
    binding: PICK_BINDING,
  })
  return `(() => {
const data = ${payload};
const ID_BOX = '__dsh-pick-box';
const ID_BAR = '__dsh-pick-bar';
const STYLE_ID = '__dsh-pick-style';
if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    '#' + ID_BOX + ' { position: fixed; pointer-events: none; z-index: 2147483646;',
    '  outline: 2px solid #38bdf8; outline-offset: 1px; }',
    '#' + ID_BAR + ' { position: fixed; z-index: 2147483647; display: flex; gap: 6px;',
    '  align-items: center; padding: 6px 8px; border-radius: 8px;',
    '  background: rgba(15, 23, 42, 0.92); color: #e2e8f0;',
    '  font: 12px/1.4 system-ui, sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,0.35); }',
    '#' + ID_BAR + ' button { cursor: pointer; border: 1px solid #475569; border-radius: 6px;',
    '  background: #1e293b; color: #e2e8f0; padding: 4px 10px; font: inherit; }',
    '#' + ID_BAR + ' button:hover { background: #334155; }',
    '#' + ID_BAR + ' .dsh-pick-desc { max-width: 320px; overflow: hidden;',
    '  text-overflow: ellipsis; white-space: nowrap; opacity: 0.85; }',
  ].join('\\n');
  (document.head || document.documentElement).appendChild(style);
}
const oldBox = document.getElementById(ID_BOX); if (oldBox) oldBox.remove();
const oldBar = document.getElementById(ID_BAR); if (oldBar) oldBar.remove();
if (!data.rect) { /* no measurable rect: bar only, anchored to viewport centre */ }
const rect = data.rect || { x: innerWidth / 2 - 60, y: innerHeight / 2 - 20, width: 120, height: 40 };
const box = document.createElement('div');
box.id = ID_BOX;
box.style.left = Math.max(0, rect.x - 2) + 'px';
box.style.top = Math.max(0, rect.y - 2) + 'px';
box.style.width = Math.max(8, rect.width + 4) + 'px';
box.style.height = Math.max(8, rect.height + 4) + 'px';
document.documentElement.appendChild(box);
const bar = document.createElement('div');
bar.id = ID_BAR;
const desc = document.createElement('span');
desc.className = 'dsh-pick-desc';
desc.textContent = data.describe;
const btnComment = document.createElement('button');
btnComment.textContent = '引用到对话 Ctrl+J';
bar.appendChild(desc); bar.appendChild(btnComment);
const below = rect.y + rect.height + 10;
const barH = 36;
const top = below + barH <= innerHeight ? below : Math.max(4, rect.y - barH - 10);
bar.style.left = Math.min(Math.max(4, rect.x), Math.max(4, innerWidth - 360)) + 'px';
bar.style.top = top + 'px';
document.documentElement.appendChild(bar);
let done = false;
function report(action) {
  if (done) return; done = true;
  try { window[data.binding] && window[data.binding](JSON.stringify({ action })); } catch (e) {}
}
btnComment.addEventListener('click', () => report('quote'));
window.addEventListener('keydown', function onKey(ev) {
  if (done) { window.removeEventListener('keydown', onKey); return; }
  if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'j' || ev.key === 'J')) { ev.preventDefault(); report('quote'); }
  else if (ev.key === 'Enter') { ev.preventDefault(); report('quote'); }
}, true);
window.__dshPickUiDone = () => done;
})()`
}

/** T5.11's "✓ 已传输到对话" confirm, collapsed in place after 2.5s. */
function confirmExpression(): string {
  return `(() => {
const bar = document.getElementById('__dsh-pick-bar');
if (bar) {
  bar.textContent = '✓ 已引用到输入框';
  setTimeout(() => { bar.remove(); }, 2500);
}
const box = document.getElementById('__dsh-pick-box');
if (box) setTimeout(() => { box.remove(); }, 2500);
})()`
}

function removeExpression(): string {
  return `(() => {
for (const id of ['__dsh-pick-box', '__dsh-pick-bar', '__dsh-pick-style']) {
  const el = document.getElementById(id); if (el) el.remove();
}
})()`
}

/** Draw the frame + bar and arm the binding that reports the chosen action. */
export async function showPickUi(call: PageCall, sessionId: string, element: PickElement): Promise<PickUiOutcome> {
  const arm = await armBinding(call, sessionId)
  if (!arm.ok) return arm
  return evaluate(call, sessionId, uiExpression(element))
}

/** Swap the bar to the quoted state; the page collapses it after 2.5s. */
export async function confirmPickUi(call: PageCall, sessionId: string): Promise<PickUiOutcome> {
  return evaluate(call, sessionId, confirmExpression())
}

/** Remove every trace of the picker UI (panel unmount / tab switch / disable). */
export async function removePickUi(call: PageCall, sessionId: string): Promise<PickUiOutcome> {
  return evaluate(call, sessionId, removeExpression())
}

export async function armBinding(call: PageCall, sessionId: string): Promise<PickUiOutcome> {
  try {
    await call('Runtime.addBinding', { name: PICK_BINDING }, { sessionId, timeoutMs: 6000 })
    return { ok: true, code: 'ok', message: '' }
  } catch (error) {
    const err = error as { code?: string; message?: string }
    return { ok: false, code: err?.code ?? 'binding-failed', message: err?.message ?? String(error) }
  }
}

/** Parse one binding payload. Anything malformed is refused, not guessed. */
export function parsePickAction(payload: string): { ok: true; action: PickAction } | { ok: false; code: string } {
  try {
    const parsed = JSON.parse(payload) as { action?: unknown }
    if (parsed.action === 'quote') return { ok: true, action: parsed.action }
    return { ok: false, code: 'bad-action' }
  } catch {
    return { ok: false, code: 'bad-payload' }
  }
}
