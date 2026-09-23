/**
 * src/jev/prompt.ts — 阶段 10: the intent injector.
 *
 * This is the "DOM + screenshot + intent" half of the user's request. It turns
 * (frame, intent, history) into the `state` a judge reads, and — just as
 * importantly — into the `questions` it must answer.
 *
 * ── The one rule that shapes everything here ───────────────────────────────
 *
 * The judge is given NUMBERS and asked for a NUMBER. It never sees a selector
 * to copy and never returns one, so a hallucinated selector is not a risk this
 * design tolerates, it is a shape the design cannot express (design-jev-loop
 * §1.2). That is why the candidate list is emitted as `n. role "name"` lines and
 * why `# HISTORY` carries an `excluded` set: a candidate the judge already ruled
 * out must not reappear, or the loop re-tries it forever.
 *
 * ── The three segments, and why the order is fixed ─────────────────────────
 *
 *   # INTENT   what we are trying to do, and what "done" means
 *   # FRAME    what is on screen right now, as numbers
 *   # HISTORY  what has been tried, and what is ruled out
 *
 * Intent first because a model that reads the goal after the page anchors on
 * the page. History last because it is the longest and the least important per
 * token — and because a model that reads history before the frame starts
 * pattern-matching on past actions instead of the current screen.
 *
 * ── What is NOT in here ────────────────────────────────────────────────────
 *
 * No image bytes. The screenshot travels as a separate attachment, not as text
 * in the prompt: base64 in a prompt costs tokens proportional to the image and
 * buys nothing over sending it as an image. `buildIntentState` returns the TEXT
 * only, and the caller pairs it with `frame.image`.
 */

import { type ChoiceQuestion, type NoulQuestion, type Question, choice, noul } from './wire.ts'
import type { Frame, FrameChunk, FrameNode } from './frame.ts'

/**
 * Where the intent came from. Recorded so a misjudgement can be attributed
 * after the fact — an intent the user typed and an intent a rule inferred are
 * not equally trustworthy, and without this field that distinction is lost.
 */
export type IntentSource = 'user' | 'rule' | 'choice' | 'text-llm'

export interface IntentSpec {
  /** The goal in the user's own words. Never paraphrased — see the header. */
  goal: string
  kind: 'navigate' | 'extract' | 'fill' | 'click' | 'verify' | 'other'
  /** Free-text hints. Hints only: a hint must never be a selector (see header). */
  targetHints: string[]
  /** Observable conditions that mean the goal is met. */
  successCriteria: string[]
  /** Conditions that mean stop and report rather than keep trying. */
  stopConditions: string[]
  source: IntentSource
}

/** One step of the loop so far. Deliberately small — see HISTORY note. */
export interface HistoryStep {
  /** The action that was taken: `click` / `fill` / `scroll` / `none`. */
  action: string
  /** The frame number acted on, or 0 for a non-element action. */
  n: number
  ok: boolean
  /** A short observation, not a transcript. */
  note: string
}

export interface IntentStateInput {
  intent: IntentSpec
  frame: Frame
  /** The chunk being judged. Absent = judge the whole frame as one unit. */
  chunk?: FrameChunk | null
  history?: readonly HistoryStep[]
  /** Frame numbers already ruled out. These are removed from the candidate list. */
  excluded?: readonly number[]
  /** How many history steps to keep. Recency beats completeness for a loop. */
  historyLimit?: number
}

const DEFAULT_HISTORY_LIMIT = 5

/**
 * Assemble the `state` string handed to a judge.
 *
 * Deterministic: same inputs, same string, byte for byte. That matters more
 * than it looks — a prompt that varies run to run makes a judge's change of
 * mind unattributable, and this pipeline is judged on being debuggable.
 */
export function buildIntentState(input: IntentStateInput): string {
  const limit = input.historyLimit ?? DEFAULT_HISTORY_LIMIT
  const excluded = new Set(input.excluded ?? [])
  const sections: string[] = []

  sections.push(buildIntentSection(input.intent))
  sections.push(buildFrameSection(input))

  const history = buildHistorySection(input.history ?? [], limit, excluded)
  if (history !== '') sections.push(history)

  return sections.join('\n\n')
}

function buildIntentSection(intent: IntentSpec): string {
  const lines: string[] = ['# INTENT', `goal: ${intent.goal}`, `kind: ${intent.kind}`, `source: ${intent.source}`]
  if (intent.targetHints.length > 0) {
    lines.push('targets:')
    for (const hint of intent.targetHints) lines.push(`  - ${hint}`)
  }
  if (intent.successCriteria.length > 0) {
    lines.push('done when:')
    for (const criterion of intent.successCriteria) lines.push(`  - ${criterion}`)
  }
  if (intent.stopConditions.length > 0) {
    lines.push('stop when:')
    for (const condition of intent.stopConditions) lines.push(`  - ${condition}`)
  }
  return lines.join('\n')
}

function buildFrameSection(input: IntentStateInput): string {
  const { frame } = input
  const chunk = input.chunk ?? null
  const lines: string[] = [
    '# FRAME',
    `frameId: ${frame.frameId}`,
    `url: ${frame.target.url}`,
    frame.target.title === '' ? '' : `title: ${frame.target.title}`,
    `viewport: ${frame.viewport.width}x${frame.viewport.height} @${frame.viewport.devicePixelRatio}x scroll(${frame.viewport.scrollX},${frame.viewport.scrollY})`,
    // Saying "no screenshot" out loud matters: a judge told nothing about the
    // image will assume it has one and describe what it cannot see.
    frame.image === null ? 'screenshot: none (judge from the list below)' : `screenshot: attached (${frame.image.format})`,
    `candidates: ${frame.dom.total}${frame.dom.truncated ? ' (TRUNCATED — more exist than are listed)' : ''}`,
  ]
  if (chunk !== null) {
    lines.push(`chunk: ${chunk.chunkIndex}/${chunk.chunkTotal} (${chunk.itemCount} items, mostly in ${chunk.containerHint})`)
  }

  const nodes = chunk === null ? frame.dom.nodes : chunk.nodes
  lines.push('', ...nodes.map(formatNode))
  return lines.filter((line) => line !== '').join('\n')
}

/**
 * One candidate line: `7. button "Sign in" [nav] (disabled)`.
 *
 * Field order is fixed and role precedes name because that is how a screen
 * reader announces it — the same order a model has seen millions of times.
 */
function formatNode(node: FrameNode): string {
  const flags: string[] = []
  if (node.state.disabled) flags.push('disabled')
  if (node.state.checked) flags.push('checked')
  if (node.state.expanded) flags.push('expanded')
  const suffix = flags.length === 0 ? '' : ` (${flags.join(', ')})`
  return `${node.n}. ${node.role} "${node.name}" [${node.container}]${suffix}`
}

/**
 * Render the HISTORY section, or `''` when there is nothing to say.
 *
 * Returning `''` for the empty case is deliberate rather than tidiness: a judge
 * shown an empty `# HISTORY` header on the very first frame is being told the
 * loop has a past when it does not, and "excluded:" with nothing after it reads
 * as "everything is excluded" to a careless reader. Nothing is omitted that
 * would change a decision.
 */
function buildHistorySection(history: readonly HistoryStep[], limit: number, excluded: Set<number>): string {
  const recent = history.slice(-limit)
  if (recent.length === 0 && excluded.size === 0) return ''
  const lines: string[] = ['# HISTORY']
  if (recent.length === 0) {
    lines.push('(no actions taken yet — this is the first judgement on this frame)')
  } else {
    for (const step of recent) {
      const target = step.n === 0 ? '' : ` n=${step.n}`
      lines.push(`- ${step.action}${target} ${step.ok ? 'ok' : 'FAILED'}: ${step.note}`)
    }
  }
  if (excluded.size > 0) {
    // This line is not decoration. Without it the judge re-proposes a candidate
    // that was already ruled out, and the loop oscillates between two options
    // until the step budget runs out.
    const ids = [...excluded].sort((a, b) => a - b)
    lines.push(`excluded (do not propose these): ${ids.join(', ')}`)
  }
  return lines.join('\n')
}

// ── the questions this pipeline asks ───────────────────────────────────────

/** The fixed control question. Exactly 5 options — it anchors a threshold bucket. */
export const CONTROL_CHOICE_ID = 'control'
export const CONTROL_OPTIONS = ['done', 'act', 'scroll', 'wait', 'blocked'] as const

/**
 * The control question: what should happen next, at the coarsest granularity.
 *
 * Five options is not arbitrary. It is the smallest set that covers the five
 * real outcomes (we are finished / act on something visible / look elsewhere /
 * wait for a change / cannot proceed), and staying at five keeps it in the
 * loosest threshold bucket — a 20-way question needs a much higher bar.
 *
 * `blocked` is separate from `done` on purpose. "Finished" and "stuck" both mean
 * stop, but conflating them turns an unrecoverable stuck state into a success.
 */
export function controlQuestion(canScroll: boolean): ChoiceQuestion {
  const criteria: Record<string, string> = {
    done: 'the intent is already satisfied by what is on screen; no further action is needed',
    act: 'an element in the candidate list should be clicked or filled to make progress',
    wait: 'the page is mid-transition or loading; the same frame should be looked at again shortly',
    blocked: 'the intent cannot be progressed from this state — a login wall, a hard error, or a missing precondition',
  }
  if (canScroll) {
    criteria.scroll = 'the needed element is not in this list but the page can be scrolled to reveal more'
  }
  return choice(
    'Decide the next step towards the intent. Pick exactly one option.',
    criteria,
  )
}

/** The in-chunk question: which numbered candidate to act on. */
export function pickQuestion(nodes: readonly FrameNode[]): ChoiceQuestion {
  if (nodes.length === 0) {
    // Callers must not build this question for an empty list: the server
    // rejects an empty criteria table, and that rejection looks like a model
    // failure rather than an empty page. Validate before constructing.
    throw new Error('pickQuestion needs at least one candidate — an empty table is not a valid question')
  }
  const criteria: Record<string, string> = {}
  for (const node of nodes) {
    criteria[String(node.n)] = `act on ${node.role} "${node.name}"${node.state.disabled ? ' (currently disabled)' : ''}`
  }
  return choice(
    'Pick the single candidate to act on next. Answer with its number.',
    criteria,
  )
}

/** The completion gate. A `noul` because it is a yes/no, not a choice. */
export function doneQuestion(successCriteria: readonly string[]): NoulQuestion {
  const done = successCriteria.length === 0 ? 'the intent is satisfied' : `all of: ${successCriteria.join('; ')}`
  return noul('Is the intent satisfied by the current frame alone, with no further action?', {
    true: done,
    false: 'at least one condition is not yet observable on screen',
  })
}

/** The danger `score` question. 5 levels — the protocol allows 10, accuracy does not. */
export const DANGER_LEVELS = [
  'harmless — reading or navigating only',
  'minor — reversible, no data changed',
  'moderate — changes page state but is undoable',
  'serious — submits data or changes an account setting',
  'irreversible — deletes, pays, or publishes',
] as const

export function dangerQuestion(): Question {
  return {
    type: 'score',
    instructions: 'How risky is acting on the chosen candidate? Choose the level.',
    criteria: [...DANGER_LEVELS],
  }
}

/**
 * Ask the control question alone.
 *
 * The first round is always control-only. Asking "which of these 20 elements"
 * before knowing whether we should act at all is how a loop clicks things on a
 * page it was supposed to leave alone.
 */
export function controlQuestions(canScroll: boolean): Record<string, Question> {
  return { [CONTROL_CHOICE_ID]: controlQuestion(canScroll) }
}

/** The full second-round question set: an element to act on, and how risky it is. */
export function pickQuestions(nodes: readonly FrameNode[]): Record<string, Question> {
  return { candidate: pickQuestion(nodes), danger: dangerQuestion() }
}

/** Can this frame scroll — i.e. is "scroll" a meaningful control option? */
export function canScroll(frame: Frame): boolean {
  // A viewport shorter than the document, or a non-zero scroll offset already
  // established, both mean scrolling is possible. The second condition covers a
  // page whose scrollHeight is unknown but which has clearly moved.
  return frame.viewport.scrollY > 0 || frame.viewport.scrollX > 0 || frame.dom.total === 0
}
