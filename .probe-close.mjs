import { execFileSync } from 'node:child_process'

const cli = process.env.LOCALAPPDATA + '\\Tabbit\\LocalAgent\\bin\\tabbit-cli.exe'
const run = (args, input) => {
  try {
    return execFileSync(cli, args, { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (e) {
    return String(e.stdout || '') + String(e.stderr || '')
  }
}
const lastJson = (s) => {
  const lines = s.trim().split(/\r?\n/).filter((l) => l.startsWith('{'))
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]) } catch { /* keep looking */ }
  }
  return null
}

run(['finish', '--task', 'dsh-close-probe'])
const created = lastJson(run(['create', '--task', 'dsh-close-probe']))
const owned = (created?.tabs ?? []).filter((t) => t.state === 'owned' || t.state === 'claimed').map((t) => t.tabId)
console.log('created tabs:', (created?.tabs ?? []).length, 'owned:', JSON.stringify(owned))
const target = owned[0] ?? created?.tabs?.[0]?.tabId
if (!target) { console.log('no probe tab'); process.exit(1) }

// Release ownership: the tab stays open but becomes "available" (unowned).
const fin = lastJson(run(['finish', '--task', 'dsh-close-probe']))
console.log('finish keep=', fin?.keep, 'closedTabIds=', JSON.stringify(fin?.closedTabIds ?? []))

const inv = lastJson(run(['tabs', '--task', 'dsh-close-probe']))
const row = (inv?.tabs ?? []).find((t) => t.tabId === target)
console.log('probe tab state after finish:', row?.state, '| url:', row?.url)

const t0 = Date.now()
const receipt = lastJson(run(
  ['nodejs', '--task', 'dsh-panel', '--request-id', 'close-' + Date.now(), '--tab', String(target)],
  'await page.close(); return { ok: true, closed: page.isClosed() };',
))
console.log('close receipt:', JSON.stringify({ status: receipt?.status, code: receipt?.result?.errorCode, value: receipt?.result?.value, ms: Date.now() - t0 }))

const after = lastJson(run(['tabs', '--task', 'dsh-close-probe']))
const still = (after?.tabs ?? []).some((t) => t.tabId === target)
console.log('tabs after:', (after?.tabs ?? []).length, '| target still present:', still)
run(['finish', '--task', 'dsh-close-probe'])
