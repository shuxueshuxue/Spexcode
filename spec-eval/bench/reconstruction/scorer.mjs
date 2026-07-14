// spec-reconstruction-bench external acceptance scorer ([[spec-reconstruction-bench]]).
//
// The MAIN outcome is a REAL behavioural test run on the HOST (outside the sandbox), over the executor's
// produced source — never a regex over the diff. For the spec-lint leaf the frozen future task is: make
// coverage enumerate GIT-TRACKED source (not an fs walk) and exclude test globs. The scorer builds a
// synthetic git fixture (tracked-governed / tracked-ungoverned / UNTRACKED / *.test.* source + .spec
// nodes), runs the produced lint.ts against it, and observes the coverage findings:
//   • an UNTRACKED source file must NOT be reported (tracked-only enumeration),
//   • a *.test.* file must NOT be reported (testGlobs exclusion),
//   • a tracked ungoverned file MUST be reported (sanity — coverage still fires).
// Positive control = the real post-episode lint.ts (passes). Negative controls = the pre-state lint.ts
// AND any no-op/unchanged tree (an fs-walk lint flags the untracked + test file → the scorer REJECTS it).
// That discrimination is what makes the score trustworthy; scoreControls() proves it and must exit 0
// BEFORE any paid run.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const NODE = process.execPath
const TSX_BIN = join(dirname(fileURLToPath(import.meta.url)), '../../..', 'node_modules/.bin/tsx')
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')          // repo root — where tsx's own deps resolve from

// build a throwaway git repo exercising tracked/untracked/test/governed source + a couple .spec nodes
function buildFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'srb-lintfix-'))
  const w = (rel, body) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body) }
  w('spexcode.json', JSON.stringify({ lint: { governedRoots: ['src'], sourceExtensions: ['ts'], testGlobs: ['**/*.test.*'] } }, null, 2))
  w('src/governed.ts', 'export const a = 1\n')
  w('src/ungoverned.ts', 'export const b = 2\n')     // tracked, no spec → MUST be flagged
  w('src/untracked.ts', 'export const c = 3\n')       // NOT git-added → must NOT be flagged (tracked-only)
  w('src/thing.test.ts', 'export const t = 4\n')      // test → must NOT be flagged (testGlobs)
  w('.spec/root/spec.md', '---\ntitle: root\ndesc: root\n---\nroot node body long enough to be a real contract statement for the fixture.\n')
  w('.spec/root/governed-node/spec.md', '---\ntitle: governed\ndesc: governs governed.ts\ncode:\n  - src/governed.ts\n---\nGoverns the governed source file; a real contract body for the fixture node.\n')
  const g = (args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' })
  g(['init', '-q']); g(['config', 'user.email', 'srb@example.com']); g(['config', 'user.name', 'srb'])
  // stage everything EXCEPT the untracked file
  g(['add', 'spexcode.json', 'src/governed.ts', 'src/ungoverned.ts', 'src/thing.test.ts', '.spec'])
  g(['commit', '-q', '-m', 'fixture', '--no-verify'])
  return dir
}

// run a given lint.ts (with its sibling git.ts/specs.ts) against the fixture cwd; return coverage findings.
// The tsx binary resolves its own deps from ROOT/node_modules regardless of cwd, so we run with
// cwd=fixture — repoRoot()/loadSpecs then resolve the FIXTURE tree (not the real repo).
function runLint(lintDir, fixtureDir) {
  const driver = join(fixtureDir, '.srb-driver.mjs')
  writeFileSync(driver, `
import { specLint } from ${JSON.stringify(join(lintDir, 'lint.ts'))}
const findings = await specLint()
process.stdout.write(JSON.stringify(findings))
`)
  const out = execFileSync(TSX_BIN, [driver], { cwd: fixtureDir, encoding: 'utf8', timeout: 60_000 })
  rmSync(driver, { force: true })
  return JSON.parse(out)
}

// score a produced spec-cli/src tree (the arm's workspace) behaviourally
export function scoreSpecLint(workspaceSrcDir) {
  const fixture = buildFixture()
  try {
    const findings = runLint(workspaceSrcDir, fixture)
    const cov = findings.filter((f) => f.rule === 'coverage' && f.file)
    const flagged = new Set(cov.map((f) => f.file))
    const checks = [
      { name: 'untracked-not-flagged', ok: !flagged.has('src/untracked.ts'), evidence: [...flagged].join(',') },
      { name: 'testfile-not-flagged', ok: !flagged.has('src/thing.test.ts'), evidence: [...flagged].join(',') },
      { name: 'ungoverned-tracked-flagged', ok: flagged.has('src/ungoverned.ts'), evidence: [...flagged].join(',') },
    ]
    return { scorer: 'behavioral:spec-lint-fixture-run', checks, passed: checks.filter((c) => c.ok).length, total: checks.length, coverageFindings: cov }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

// controls: prove the scorer PASSES the real post-episode lint and REJECTS the pre-state (fs-walk) lint.
// materialises each lint.ts + its sibling deps from git into a temp dir, then scores. Exit 0 iff the
// scorer discriminates. Must be run (rc0) and archived BEFORE any paid run.
export function scoreControls(repoRoot, positiveSha, negativeSha) {
  const materialize = (sha) => {
    const d = mkdtempSync(join(tmpdir(), 'srb-lintsrc-'))
    for (const f of ['lint.ts', 'git.ts', 'specs.ts']) {
      let body = ''
      try { body = execFileSync('git', ['-C', repoRoot, 'show', `${sha}:spec-cli/src/${f}`], { encoding: 'utf8' }) } catch {}
      if (body) writeFileSync(join(d, f), body)
    }
    return d
  }
  const posDir = materialize(positiveSha), negDir = materialize(negativeSha)
  try {
    const pos = scoreSpecLint(posDir)
    const neg = scoreSpecLint(negDir)
    const posPass = pos.passed === pos.total
    const negReject = neg.passed < neg.total   // the fs-walk lint must FAIL at least one behavioural check
    return {
      discriminates: posPass && negReject,
      positive: { sha: positiveSha, passed: pos.passed, total: pos.total, checks: pos.checks },
      negative: { sha: negativeSha, passed: neg.passed, total: neg.total, checks: neg.checks },
    }
  } finally {
    rmSync(posDir, { recursive: true, force: true }); rmSync(negDir, { recursive: true, force: true })
  }
}
