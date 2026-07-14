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
import { pinMountDigest } from './sandbox.mjs'

const NODE = process.execPath
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
// (B) the produced lint.ts is UNTRUSTED agent code — never run it on the host. Execute it inside
// `docker --network none` (no egress), with node+git+tsx from a pinned image, the produced source
// mounted READ-ONLY, and only the throwaway fixture writable. This image has git 2.39 + node 24 + we
// mount tsx from node_modules. Resolved to an immutable image ID at first use.
const SANDBOX_IMAGE = 'zcode-registry.tencentcloudcr.com/sandbox/zcode-e2e:lean'
// (6) provenance re-verified on EVERY score run: re-inspect each call, must still match the first-pinned
// immutable ID — a tag swapped mid-batch is fail-loud, never silently used.
let SANDBOX_IMAGE_ID = null
function sandboxImageId() {
  const id = execFileSync('docker', ['image', 'inspect', SANDBOX_IMAGE, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim()
  if (!SANDBOX_IMAGE_ID) SANDBOX_IMAGE_ID = id
  else if (id !== SANDBOX_IMAGE_ID) throw new Error(`sandbox image ${SANDBOX_IMAGE} changed since pin (${id} != ${SANDBOX_IMAGE_ID}) — refusing to score`)
  return SANDBOX_IMAGE_ID
}
const NM = (() => { try { return execFileSync('readlink', ['-f', join(ROOT, 'node_modules')], { encoding: 'utf8' }).trim() } catch { return join(ROOT, 'node_modules') } })()

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
  g(['add', 'spexcode.json', 'src/governed.ts', 'src/ungoverned.ts', 'src/thing.test.ts', '.spec'])  // NOT untracked.ts
  g(['commit', '-q', '-m', 'fixture', '--no-verify'])
  return dir
}

// run a given lint.ts (with its sibling git.ts/specs.ts) against the fixture, INSIDE a no-network
// container. produced source is ro at /opt/lint; the fixture (a throwaway git repo) is the only writable
// mount at /work; tsx resolves from the mounted node_modules via NODE_PATH. Returns coverage findings.
function runLint(lintDir, fixtureDir) {
  writeFileSync(join(fixtureDir, '.srb-driver.mjs'), `
import { specLint } from '/opt/lint/lint.ts'
const findings = await specLint()
process.stdout.write('SRBJSON:' + JSON.stringify(findings))
`)
  const out = execFileSync('timeout', ['90', 'docker', 'run', '--rm', '--network', 'none',
    '--user', '1000:1000', '-e', 'HOME=/tmp',
    '-v', `${lintDir}:/opt/lint:ro`, '-v', `${fixtureDir}:/work`, '-v', `${NM}:/work/node_modules:ro`,
    '-w', '/work', sandboxImageId(), 'node', '--import', 'tsx', '/work/.srb-driver.mjs'],
    { encoding: 'utf8', timeout: 120_000 })
  const line = out.split('\n').find((l) => l.startsWith('SRBJSON:'))
  if (!line) throw new Error('sandboxed lint produced no findings JSON: ' + out.slice(-200))
  return JSON.parse(line.slice('SRBJSON:'.length))
}

// score a produced spec-cli/src tree (the arm's workspace) behaviourally. (6) the mounted node_modules
// (the only mutable ro mount besides the SUBJECT lint source) is content-digested per launch and re-
// verified against its first pin; the subject itself is deliberately NOT pinned — it varies per arm.
export function scoreSpecLint(workspaceSrcDir) {
  const fixture = buildFixture()
  const mounts = { nodeModules: pinMountDigest('spec-lint:node_modules', NM) }
  try {
    const findings = runLint(workspaceSrcDir, fixture)
    const cov = findings.filter((f) => f.rule === 'coverage' && f.file)
    const flagged = new Set(cov.map((f) => f.file))
    const checks = [
      { name: 'untracked-not-flagged', ok: !flagged.has('src/untracked.ts'), evidence: [...flagged].join(',') },
      { name: 'testfile-not-flagged', ok: !flagged.has('src/thing.test.ts'), evidence: [...flagged].join(',') },
      { name: 'ungoverned-tracked-flagged', ok: flagged.has('src/ungoverned.ts'), evidence: [...flagged].join(',') },
    ]
    return { scorer: 'behavioral:spec-lint-fixture-run', provenance: { image: SANDBOX_IMAGE, imageId: sandboxImageId(), mounts }, checks, passed: checks.filter((c) => c.ok).length, total: checks.length, coverageFindings: cov }
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
      provenance: pos.provenance,   // image id + mount digests — recorded by pilot check, re-bound by the phase
      positive: { sha: positiveSha, passed: pos.passed, total: pos.total, checks: pos.checks },
      negative: { sha: negativeSha, passed: neg.passed, total: neg.total, checks: neg.checks },
    }
  } finally {
    rmSync(posDir, { recursive: true, force: true }); rmSync(negDir, { recursive: true, force: true })
  }
}
