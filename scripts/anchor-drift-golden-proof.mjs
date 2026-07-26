import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = process.argv[2]
const goldenPath = process.argv[3]
const spex = process.argv[4]
if (!repo || !goldenPath) {
  console.error('usage: node --import tsx scripts/anchor-drift-golden-proof.mjs <repo> <golden.json> [spex]')
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const proof = resolve(here, 'anchor-drift-fold-proof.mjs')
const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
const driftRules = new Set(['anchor-drift', 'drift', 'related-drift'])
const normalize = (text) => {
  const findings = new Set()
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim()
    const match = line.match(/^[✗•]\s*([a-z-]+):\s*(.*)$/)
    if (!match) continue
    const rule = match[1]
    const rest = match[2]
    const node = (rest.match(/'([^']+)'/) || [])[1] || ''
    const object = (rest.match(/^(\S+)/) || [])[1] || ''
    findings.add(`${rule}|${node}|${object}`)
  }
  return [...findings].sort()
}
let passed = 0
const failures = []
for (const point of golden) {
  const measured = JSON.parse(execFileSync(process.execPath, [
    '--import', 'tsx', proof, repo, point.commit,
  ], {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    env: { ...process.env, SPEX_FOLD_FAST: '1' },
  }))
  let expected = point.findings
  if (spex) {
    const oracle = spawnSync(process.execPath, [spex, 'spec', 'lint', '--pending', point.commit], {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 1 << 30,
    })
    expected = normalize(`${oracle.stdout || ''}${oracle.stderr || ''}`)
  }
  expected = expected.filter((finding) => driftRules.has(finding.split('|')[0])).sort()
  const actual = measured.findings
  if (measured.versionMismatches === 0 && JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push({
    commit: point.commit,
    depth: point.depth,
    versionMismatches: measured.versionMismatches,
    missing: expected.filter((finding) => !actual.includes(finding)),
    extra: actual.filter((finding) => !expected.includes(finding)),
  })
  console.error(`${point.commit.slice(0, 8)} depth=${point.depth} ${failures.at(-1)?.commit === point.commit ? 'FAIL' : 'pass'}`)
}

console.log(JSON.stringify({ points: golden.length, passed, failed: failures.length, failures }, null, 2))
if (failures.length) process.exitCode = 1
