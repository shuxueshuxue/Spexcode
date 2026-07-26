import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const [repoArg, goldenArg, baselineArg, baselineSha, candidateArg, candidateSha] = process.argv.slice(2)
if (!candidateSha) {
  console.error('usage: node --import tsx scripts/anchor-drift-golden-proof.mjs <repo> <golden.json> <baseline-cli> <baseline-sha> <candidate-cli> <candidate-sha>')
  process.exit(2)
}

const repo = realpathSync(repoArg)
const golden = JSON.parse(readFileSync(goldenArg, 'utf8'))
const driftRules = new Set(['anchor-drift', 'drift', 'related-drift'])
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 }).trim()

function immutableCli(pathArg, expectedSha, label) {
  const path = realpathSync(pathArg)
  const root = git(dirname(path), ['rev-parse', '--show-toplevel'])
  const head = git(root, ['rev-parse', 'HEAD'])
  assert.equal(head, expectedSha, `${label} checkout HEAD is ${head}, expected ${expectedSha}`)
  const rel = relative(root, path)
  git(root, ['ls-files', '--error-unmatch', '--', rel])
  assert.equal(spawnSync('git', ['-C', root, 'diff', '--quiet']).status, 0, `${label} checkout has unstaged tracked changes`)
  assert.equal(spawnSync('git', ['-C', root, 'diff', '--cached', '--quiet']).status, 0, `${label} checkout has staged changes`)
  return { path, root, sha: head }
}

const baseline = immutableCli(baselineArg, baselineSha, 'baseline')
const candidate = immutableCli(candidateArg, candidateSha, 'candidate')
const roots = []
const freshHome = (label) => { const path = mkdtempSync(join(tmpdir(), `spex-cli-oracle-${label}-`)); roots.push(path); return path }
const baselineHome = freshHome('baseline')
const candidateHome = freshHome('candidate')

function normalizedFindings(text) {
  const rows = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim()
    const match = line.match(/^[✗•]\s*([a-z-]+):\s*(.*)$/)
    if (!match || !driftRules.has(match[1])) continue
    const rule = match[1], rest = match[2]
    const object = rest.match(/^(\S+)/)?.[1] ?? ''
    const node = rest.match(/(?:spec |\()'([^']+)'/)?.[1] ?? ''
    const count = Number(rest.match(/(?:by |is )(\d+) commit/)?.[1] ?? rest.match(/^(\d+) related file/)?.[1] ?? 0)
    const commits = (rest.match(/\[([0-9a-f, ]+)\]/)?.[1] ?? '').split(/,\s*/).filter(Boolean).sort()
    const selectorText = rule === 'anchor-drift' ? rest.match(/^(.+?) was changed by/)?.[1] ?? '' : ''
    const hash = selectorText.indexOf('#')
    const path = hash < 0 ? object : selectorText.slice(0, hash)
    const selectors = hash < 0 ? [] : selectorText.slice(hash + 1).split(/,\s*#/).sort()
    rows.push({ rule, node, object, path, selectors, count, commits })
  }
  return rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

function cliRun(cli, home, root, tip = 'HEAD') {
  const env = { ...process.env, HOME: home }
  for (const name of ['SPEXCODE_HOME', 'SPEX_FOLD_FAST', 'SPEXCODE_SKIP_LINT']) delete env[name]
  const result = spawnSync(process.execPath, [cli.path, 'spec', 'lint', '--pending', tip], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    env,
  })
  assert.equal(result.error, undefined, `${cli.path} failed to start: ${result.error?.message}`)
  assert.equal(result.signal, null, `${cli.path} died by ${result.signal}`)
  assert.ok(result.status === 0 || result.status === 1, `${cli.path} exited ${result.status}: ${result.stderr}`)
  const text = `${result.stdout || ''}${result.stderr || ''}`
  return { status: result.status, rows: normalizedFindings(text), text }
}

function rowKey(row) { return JSON.stringify(row) }
function difference(left, right) {
  const other = new Set(right.map(rowKey))
  return left.filter((row) => !other.has(rowKey(row)))
}
const coarse = (rows) => [...new Set(rows.map((row) => `${row.rule}|${row.node}|${row.object}`))].sort()
const distribution = (rows) => Object.fromEntries([...driftRules].map((rule) => [rule, rows.filter((row) => row.rule === rule).length]))

function buildPositiveControl() {
  const root = mkdtempSync(join(tmpdir(), 'spex-cli-oracle-positive-'))
  roots.push(root)
  mkdirSync(join(root, '.spec', 'project'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, '.spec', 'project', 'spec.md'), '---\ntitle: project\n---\n# project\n')
  writeFileSync(join(root, 'spexcode.json'), '{"lint":{"governedRoots":["src"]}}\n')
  for (let index = 1; index <= 13; index++) {
    const id = `calc-${String(index).padStart(2, '0')}`
    mkdirSync(join(root, '.spec', 'project', id), { recursive: true })
    writeFileSync(join(root, '.spec', 'project', id, 'spec.md'), `---\ntitle: ${id}\ncode:\n  - src/${id}.py#apply_rate\n---\n# ${id}\n`)
    writeFileSync(join(root, 'src', `${id}.py`), 'def apply_rate(x):\n    return x\n\ndef helper():\n    return 0\n')
  }
  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.email', 'oracle@example.com'])
  git(root, ['config', 'user.name', 'oracle'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'version'])
  for (let index = 1; index <= 13; index++) {
    const id = `calc-${String(index).padStart(2, '0')}`
    writeFileSync(join(root, 'src', `${id}.py`), 'def apply_rate(x):\n    return x + 1\n\ndef helper():\n    return 0\n')
  }
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'known anchor debt'])
  return { root, hit: git(root, ['rev-parse', 'HEAD']).slice(0, 8) }
}

async function fetchLayer(repo, tips) {
  const lintUrl = pathToFileURL(join(candidate.root, 'spec-cli', 'src', 'lint.ts')).href
  const anchorsUrl = pathToFileURL(join(candidate.root, 'spec-cli', 'src', 'anchors.ts')).href
  const [{ specLint }, { extractors }] = await Promise.all([import(lintUrl), import(anchorsUrl)])
  const failures = []
  for (const tip of tips) {
    const fast = await specLint(repo, extractors(repo), { tip })
    const full = await specLint(repo, extractors(repo), { tip, fullOracle: true })
    const encode = (rows) => rows.map((row) => JSON.stringify(row)).sort()
    if (JSON.stringify(encode(fast)) !== JSON.stringify(encode(full))) failures.push(tip)
  }
  return { points: tips.length, passed: tips.length - failures.length, failures }
}

try {
  const positive = buildPositiveControl()
  const positiveBaseline = cliRun(baseline, baselineHome, positive.root)
  const positiveCandidate = cliRun(candidate, candidateHome, positive.root)
  for (const [label, result] of [['baseline', positiveBaseline], ['candidate', positiveCandidate]]) {
    const anchors = result.rows.filter((row) => row.rule === 'anchor-drift')
    assert.equal(result.status, 1, `${label} positive control did not block`)
    assert.equal(anchors.length, 13, `${label} positive control saw ${anchors.length} anchor rows`)
    assert.ok(anchors.every((row) => row.commits.length === 1 && row.commits[0] === positive.hit), `${label} positive control named the wrong hit`)
  }
  assert.deepEqual(positiveCandidate.rows, positiveBaseline.rows, 'positive-control implementations disagree')
  const removed = positiveCandidate.rows.find((row) => row.rule === 'anchor-drift')
  const mutated = positiveCandidate.rows.filter((row) => row !== removed)
  assert.deepEqual(difference(positiveBaseline.rows, mutated), [removed], 'mutation control did not report the exact removed anchor key')

  const failures = []
  const coverage = { baseline: {}, candidate: {} }
  for (const point of golden) {
    const a = cliRun(baseline, baselineHome, repo, point.commit)
    const b = cliRun(candidate, candidateHome, repo, point.commit)
    coverage.baseline[point.commit] = distribution(a.rows)
    coverage.candidate[point.commit] = distribution(b.rows)
    const onlyBaseline = difference(a.rows, b.rows)
    const onlyCandidate = difference(b.rows, a.rows)
    const stored = point.findings.filter((finding) => driftRules.has(finding.split('|')[0])).sort()
    const storedMissing = stored.filter((finding) => !coarse(b.rows).includes(finding))
    const storedExtra = coarse(b.rows).filter((finding) => !stored.includes(finding))
    if (onlyBaseline.length || onlyCandidate.length || storedMissing.length || storedExtra.length)
      failures.push({ commit: point.commit, onlyBaseline, onlyCandidate, storedMissing, storedExtra })
    console.error(`${point.commit.slice(0, 8)} depth=${point.depth} ${failures.at(-1)?.commit === point.commit ? 'FAIL' : 'pass'} ${JSON.stringify(distribution(b.rows))}`)
  }
  const fetch = await fetchLayer(repo, golden.map((point) => point.commit))
  const result = {
    baseline: { sha: baseline.sha, cli: baseline.path },
    candidate: { sha: candidate.sha, cli: candidate.path },
    positiveControl: { anchors: 13, hit: positive.hit, mutationMissing: removed, pass: true },
    independentCli: { points: golden.length, passed: golden.length - failures.length, failures, coverage },
    fetchLayer: fetch,
  }
  console.log(JSON.stringify(result, null, 2))
  if (failures.length || fetch.failures.length) process.exitCode = 1
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}
