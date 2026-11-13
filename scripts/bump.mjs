#!/usr/bin/env node
/**
 * One command to move the version, in the three places it must agree.
 *
 * Learned the hard way: `CLIENT_BUILD` used to be a hand-edited literal, and when
 * it drifted the panel advertised a build the host was not serving — which made
 * "did my fix ship?" unanswerable. The host now exposes `clientBuild` from the same
 * constant, so a single writer is the whole point.
 *
 * Usage: node scripts/bump.mjs 1.9.28
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const next = process.argv[2]
if (!next || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(next)) {
  console.error('usage: node scripts/bump.mjs <semver>   e.g. 1.9.28')
  process.exit(2)
}

const patchJson = (rel, apply) => {
  const path = join(root, rel)
  const before = readFileSync(path, 'utf8')
  const after = apply(before)
  if (after === before) {
    console.log(`  ${rel}: unchanged`)
    return
  }
  writeFileSync(path, after)
  console.log(`  ${rel}: updated`)
}

patchJson('package.json', (text) => text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`))
patchJson('dsh-plugin.json', (text) => text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`))
patchJson('src/client/build.ts', (text) => text.replace(/(export const CLIENT_BUILD = ')[^']+(')/, `$1${next}$2`))

console.log(`bumped to ${next}`)
