#!/usr/bin/env node
// Codemod: turn `noImplicitAny` errors in src/client/index.ts into explicit
// `: any` annotations. Position-exact (uses tsc line/col), inserted right-to-left
// per line so earlier edits don't shift later ones. Type-annotation-only: zero
// runtime effect. Run: node scripts/fix-implicit-any.mjs  (idempotent-ish; re-run
// after each tsc pass until 0 errors)
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const FILE = 'src/client/index.ts'
let out = ''
try {
  out = execSync('npx tsc -p tsconfig.client.json --noImplicitAny 2>&1', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (err) {
  out = String(err.stdout ?? '') + String(err.stderr ?? '')
}
const errors = out.split('\n').filter((l) => l.includes('error TS')).map((l) => {
  const m = l.match(/\((\d+),(\d+)\): error (TS\d+): (.*)/)
  return m && { line: +m[1], col: +m[2], code: m[3], msg: m[4] }
}).filter(Boolean)

const lines = readFileSync(FILE, 'utf8').split('\n')
const byLine = new Map()
for (const e of errors) {
  if (!['TS7006', 'TS7034', 'TS7011'].includes(e.code)) continue
  if (!byLine.has(e.line)) byLine.set(e.line, [])
  byLine.get(e.line).push(e)
}

let edits = 0
for (const [lineNo, errs] of byLine) {
  const text = lines[lineNo - 1]
  errs.sort((a, b) => b.col - a.col)
  for (const e of errs) {
    const i = e.col - 1
    if (e.code === 'TS7011') {
      // function expression at col i: find its param-list parens (balanced), insert ': any' after ')'
      let open = text.indexOf('(', i)
      if (open === -1) { console.log(`SKIP TS7011 @${lineNo}:${e.col} (no parens on line)`); continue }
      let depth = 0, close = -1
      for (let j = open; j < text.length; j++) {
        if (text[j] === '(') depth++
        else if (text[j] === ')') { depth--; if (depth === 0) { close = j; break } }
      }
      if (close === -1) { console.log(`SKIP TS7011 @${lineNo}:${e.col} (unbalanced parens)`); continue }
      lines[lineNo - 1] = text.slice(0, close + 1) + ': any' + text.slice(close + 1)
      edits++
      continue
    }
    if (!/[A-Za-z0-9_$]/.test(text[i] ?? '')) { console.log(`SKIP ${e.code} @${lineNo}:${e.col} (col not identifier)`); continue }
    let end = i
    while (end < text.length && /[A-Za-z0-9_$]/.test(text[end])) end++
    const isRest = /(^|[^.\w])\.\.\.[ \t]*$/.test(text.slice(0, i))
    const ann = e.code === 'TS7006' ? (isRest ? ': any[]' : ': any') : (e.msg.includes("'any[]'") ? ': any[]' : ': any')
    lines[lineNo - 1] = text.slice(0, end) + ann + text.slice(end)
    edits++
  }
}
writeFileSync(FILE, lines.join('\n'))
console.log(`applied ${edits} annotations across ${byLine.size} lines; remaining unhandled: ${errors.length - errors.filter((e) => ['TS7006', 'TS7034'].includes(e.code)).length}`)
