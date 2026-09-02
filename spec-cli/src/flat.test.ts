import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FLAT_AGENT_CHOICES, confirmProfile, flatNew, galleryIndexHtml, gallerySlug, gatePassed, profileFiles, readGate, type FlatGate } from './flat.js'
import { HARNESSES, harnessById } from './harness.js'

const SPEX_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'spex.mjs')

const gitAvailable = () => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}

const git = (repo: string, args: string[]) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, SPEXCODE_ALLOW_MAIN: '1' } }).trim()

function initializedLocalRepo() {
  const root = mkdtempSync(join(tmpdir(), 'flat-local-'))
  const repo = join(root, 'app')
  const bin = join(root, 'bin')
  mkdirSync(repo, { recursive: true })
  mkdirSync(bin)
  git(repo, ['init', '-q', '-b', 'main'])
  git(repo, ['config', 'user.name', 'Flat test'])
  git(repo, ['config', 'user.email', 'flat-test@example.invalid'])
  writeFileSync(join(repo, 'src-one.ts'), 'export const answer = 42\n')
  writeFileSync(join(repo, 'src-two.ts'), 'export const second = 24\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'source'])
  execFileSync(process.execPath, [SPEX_BIN, 'init', '.', '--harness', 'codex'], {
    cwd: repo,
    stdio: 'ignore',
    env: { ...process.env, SPEXCODE_HOME: join(root, 'spex-home'), CODEX_HOME: join(root, 'codex-home') },
  })
  mkdirSync(join(repo, '.spec', 'project', 'source-one'), { recursive: true })
  mkdirSync(join(repo, '.spec', 'project', 'source-two'), { recursive: true })
  writeFileSync(join(repo, '.spec', 'project', 'source-one', 'spec.md'), `---\ntitle: source one\nstatus: active\nhue: 165\ndesc: Exposes the first fixture value.\ncode:\n  - src-one.ts\n---\n# source one\n\nThe source module exposes the first fixture value.\n`)
  writeFileSync(join(repo, '.spec', 'project', 'source-two', 'spec.md'), `---\ntitle: source two\nstatus: active\nhue: 165\ndesc: Exposes the second fixture value.\ncode:\n  - src-two.ts\n---\n# source two\n\nThe source module exposes the second fixture value.\n`)
  const config = JSON.parse(readFileSync(join(repo, '.spec/spexcode.json'), 'utf8'))
  config.sessions = { launchers: { local: { harness: 'codex', cmd: join(bin, 'codex') } }, defaultLauncher: 'local' }
  config.lint = { governedRoots: ['.'], sourceExtensions: ['ts'] }
  writeFileSync(join(repo, '.spec/spexcode.json'), `${JSON.stringify(config, null, 2)}\n`)
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\n[ "$1" = "exec" ] && [ "$2" = "-" ] || exit 64\ncat >/dev/null\n')
  execFileSync('chmod', ['+x', join(bin, 'codex')])
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'initialized'])
  return { root, repo, config: readFileSync(join(repo, '.spec/spexcode.json'), 'utf8') }
}

test('profiling governs tracked source and ignores what no spec could claim', () => {
  const profile = profileFiles([
    'src/index.ts', 'src/app.tsx', 'src/util.ts',
    'server/main.py', 'server/db.py',
    'README.md', 'package-lock.json', 'LICENSE', '.gitignore', 'Makefile',
    'vendor/left-pad/index.js', 'dist/bundle.js', 'node_modules/x/y.js',
  ])
  assert.deepEqual(profile.sourceExtensions, ['py', 'ts', 'tsx'])
  assert.deepEqual(profile.governedRoots, ['server', 'src'])
  assert.deepEqual(profile.languages, ['Python', 'TypeScript'])
  assert.equal(profile.fileCount, 5)
})

test('a repository with no recognised source profiles to nothing rather than to everything', () => {
  // The gate reads coverage over governed files. If an unrecognised repository profiled to a NON-empty
  // governed set of files no spec can describe, the loop could never close; if it profiled to an empty set,
  // coverage would be vacuously complete. Both are wrong, so this reports zero and the caller refuses.
  const profile = profileFiles(['README.md', 'docs/guide.md', 'assets/logo.svg', 'Cargo.lock'])
  assert.equal(profile.fileCount, 0)
  assert.deepEqual(profile.governedRoots, [])
  assert.deepEqual(profile.sourceExtensions, [])
})

test('a repository whose source really is at the top level governs the root', () => {
  const profile = profileFiles(['main.go', 'helper.go', 'go.mod'])
  assert.deepEqual(profile.governedRoots, ['.'])
})

test('one top-level packaging script does not drag the whole repository into the governed set', () => {
  // Measured on psf/requests: src=19, tests=15, docs=2, and a lone setup.py at the root. A root that
  // qualifies subsumes every sibling, so letting setup.py qualify it would silently govern all 37 files.
  const profile = profileFiles([
    ...Array.from({ length: 19 }, (_, n) => `src/requests/m${n}.py`),
    ...Array.from({ length: 15 }, (_, n) => `tests/test_${n}.py`),
    'docs/conf.py', 'docs/build.py',
    'setup.py',
    'README.md', 'pyproject.toml',
  ])
  assert.ok(!profile.governedRoots.includes('.'), 'setup.py qualified the repository root')
  assert.deepEqual(profile.governedRoots, ['docs', 'src', 'tests'])
})

test('the proposed governed set is narrowed to what lint actually keeps', () => {
  // Measured on psf/requests: the file tree proposes docs, src and tests, but the product's source policy
  // drops `tests/**` wholesale, so lint governs 21 files, not 36. Leaving the proposal uncorrected wrote a
  // root into the config that the gate ignores and printed a count the gate's own denominator contradicted.
  const proposed = profileFiles([
    ...Array.from({ length: 19 }, (_, n) => `src/requests/m${n}.py`),
    ...Array.from({ length: 15 }, (_, n) => `tests/test_${n}.py`),
    'docs/conf.py', 'docs/build.py',
  ])
  assert.deepEqual(proposed.governedRoots, ['docs', 'src', 'tests'])
  const lintKeeps = [
    ...Array.from({ length: 19 }, (_, n) => `src/requests/m${n}.py`),
    'docs/conf.py', 'docs/build.py',
  ]
  const confirmed = confirmProfile(proposed, lintKeeps)
  assert.deepEqual(confirmed.governedRoots, ['docs', 'src'])
  assert.equal(confirmed.fileCount, 21)
  assert.deepEqual(confirmed.sourceExtensions, proposed.sourceExtensions)
})

test('confirming keeps a repository-root governed set whole', () => {
  const proposed = profileFiles(['main.go', 'helper.go'])
  assert.deepEqual(confirmProfile(proposed, ['main.go', 'helper.go']).governedRoots, ['.'])
})

test('the gate reads coverage and errors out of the real lint report shape', () => {
  const gate = readGate(JSON.stringify({
    projection: 'spex.spec-lint.report',
    schemaVersion: 1,
    sourceFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
    findings: [
      { level: 'warn', rule: 'coverage', file: 'd.ts', msg: 'd.ts is governed by no spec' },
      { level: 'warn', rule: 'drift', file: 'a.ts', msg: 'a.ts is 2 commit(s) ahead' },
      { level: 'error', rule: 'integrity', spec: 'x', file: 'gone.ts', msg: "code path 'gone.ts' does not exist" },
    ],
  }))
  assert.equal(gate.governed, 4)
  assert.equal(gate.uncovered, 1)
  assert.equal(gate.coverage, 75)
  assert.equal(gate.errors, 1)
  assert.deepEqual(gate.uncoveredFiles, ['d.ts'])
  assert.match(gate.errorFindings[0], /^integrity: /)
})

test('drift and other warnings never block convergence — only errors and coverage do', () => {
  const drifty = readGate(JSON.stringify({
    sourceFiles: ['a.ts', 'b.ts'],
    findings: [
      { level: 'warn', rule: 'drift', file: 'a.ts', msg: 'stale' },
      { level: 'warn', rule: 'owners', file: 'b.ts', msg: 'no owner' },
    ],
  }))
  assert.equal(drifty.coverage, 100)
  assert.equal(drifty.errors, 0)
  assert.equal(gatePassed(drifty, 90), true)
})

test('an empty governed set never passes, however clean the report looks', () => {
  // The vacuous pass this exists to refuse: no source files, no findings, therefore "no problems".
  const vacuous = readGate(JSON.stringify({ sourceFiles: [], findings: [] }))
  assert.equal(vacuous.governed, 0)
  assert.equal(vacuous.errors, 0)
  assert.equal(gatePassed(vacuous, 0), false)
})

test('convergence needs both halves — a clean tree that is thin does not pass', () => {
  const thin: FlatGate = { errors: 0, governed: 100, uncovered: 40, coverage: 60, errorFindings: [], uncoveredFiles: [], sourceFiles: [] }
  const broken: FlatGate = { errors: 3, governed: 100, uncovered: 0, coverage: 100, errorFindings: ['x'], uncoveredFiles: [], sourceFiles: [] }
  const done: FlatGate = { errors: 0, governed: 100, uncovered: 5, coverage: 95, errorFindings: [], uncoveredFiles: [], sourceFiles: [] }
  assert.equal(gatePassed(thin, 90), false)
  assert.equal(gatePassed(broken, 90), false)
  assert.equal(gatePassed(done, 90), true)
  assert.equal(gatePassed(done, 100), false)
})

test('an unparseable lint report is a failure, never a silent zero', () => {
  assert.throws(() => readGate('this is not json'))
})

test('a gallery slug comes from the source, so the same repository always lands in the same place', () => {
  assert.equal(gallerySlug('https://github.com/psf/requests'), 'psf/requests')
  assert.equal(gallerySlug('https://github.com/psf/requests.git'), 'psf/requests')
  assert.equal(gallerySlug('git@github.com:charmbracelet/lipgloss.git'), 'charmbracelet/lipgloss')
  assert.equal(gallerySlug('https://dev.aminer.cn/codegeex/z-code.git'), 'codegeex/z-code')
  // A local path has no owner, so it slugs to its own name — the --out directory never decides.
  assert.equal(gallerySlug('/home/someone/My Project/'), 'my-project')
})

test('a slug can never escape the gallery root', () => {
  // The slug becomes a path on a public host. A source that walks upward, hides a segment, or names an
  // absolute location must not be able to write outside <out>/ or serve from somewhere it was not given.
  for (const hostile of [
    'https://evil.test/../../etc/passwd',
    'https://evil.test/a/../../b',
    '/../../../etc/shadow',
    'https://evil.test/%2e%2e/x',
    'https://evil.test/.ssh/authorized_keys',
  ]) {
    const slug = gallerySlug(hostile)
    assert.ok(!slug.split('/').includes('..'), `${hostile} produced a traversing slug: ${slug}`)
    assert.ok(!slug.startsWith('/'), `${hostile} produced an absolute slug: ${slug}`)
    assert.match(slug, /^[a-z0-9][a-z0-9/_-]*$/, `${hostile} produced an unsafe slug: ${slug}`)
    assert.ok(!slug.includes('//'), `${hostile} produced an empty segment: ${slug}`)
  }
  // The traversal segments are dropped, not merely rewritten into something that still looks like a path.
  assert.equal(gallerySlug('https://evil.test/../../etc/passwd'), 'etc/passwd')
})

test('the gallery index escapes what it prints and links relatively', () => {
  // Every string a flat contributes comes from the repository it read, so all of it is hostile input. The
  // card prints the slug and the language names; the full source URL is deliberately NOT on this page (the
  // flat's own About panel carries provenance), and this asserts that staying true rather than assuming it.
  const html = galleryIndexHtml([
    { slug: 'psf/requests', source: 'https://evil.test/"><script>alert(1)</script>', revision: 'abcdef0123456789', coverage: 100, governed: 21, nodes: 46, passed: true, languages: ['Python'], lang: 'zh' },
    { slug: 'x/y', source: 'https://github.com/x/y', revision: 'deadbeefcafe', coverage: 62, governed: 80, nodes: 9, passed: false, languages: ['<img src=x onerror=1>'], lang: 'en' },
  ])
  assert.ok(html.includes('href="./psf/requests/"'), 'entry link must be relative — the gallery itself may sit under a prefix')
  assert.ok(!html.includes('<script>alert(1)</script>') && !html.includes('evil.test'), 'the source string reached the page')
  assert.ok(!html.includes('<img src=x onerror=1>'), 'a language name reached the page unescaped')
  assert.ok(html.includes('&lt;img'), 'the language name is present but escaped')
  // A flat that did not converge must say so where someone choosing what to read can see it.
  assert.ok(html.includes('partial'))
  assert.ok(html.includes('abcdef012345') && !html.includes('abcdef0123456789'), 'revision is shown short')
  // An unknown language gets the neutral dot rather than an invented colour.
  assert.ok(html.includes('#3178c6') === false && html.includes('#3572a5'), 'known languages carry their own colour')
  assert.ok(html.includes('#6b7280'), 'an unlisted language falls back to neutral')
})

test('the gallery gives a fresh visitor the install, agent, and clone-init path', () => {
  const html = galleryIndexHtml([])
  assert.match(html, /npm i -g spexcode/, 'the one-time CLI installation is visible')
  assert.match(html, /<select id="agent"/, 'the visitor can choose the conversion agent')
  for (const choice of FLAT_AGENT_CHOICES) {
    assert.match(html, new RegExp(`<option value="${choice.name}">${choice.label}</option>`), `${choice.label} is selectable`)
  }
  assert.match(html, /spex flat new https:\/\/github\.com\/owner\/repo --launcher claude/, 'the displayed run names an agent')
  assert.match(html, /\.agent-select select \{[\s\S]*appearance: none/, 'the agent selector uses the gallery control style')
  assert.match(html, /class="agent-select"/, 'the agent selector has a styled wrapper')
  assert.match(html, /src="\.\/flatcode-banner\.webp"/, 'the gallery references its packaged banner relatively')
  assert.match(html, /仓库 URL 会被克隆并初始化；本地仓库则直接补全 \.spec/, 'the page distinguishes URL cloning from local continuation')
})

test('an initialized local repository is continued in place with only its .spec committed', { skip: !gitAvailable() && 'git not available' }, async () => {
  const { root, repo, config } = initializedLocalRepo()
  const result = await flatNew({ target: repo, rounds: 1, coverage: 100 }, () => {})
  assert.equal(result.repo, repo, 'the source repository is the flat repository')
  assert.equal(result.rounds, 0, 'a fully covered existing spec does not invoke the agent')
  assert.equal(result.passed, true)
  assert.equal(readFileSync(join(repo, '.spec/spexcode.json'), 'utf8'), config, 'the existing project configuration stays byte-identical')
  assert.ok(existsSync(join(root, 'app.flat', 'flat.json')), 'the reading lives beside the source repository')
  assert.equal(existsSync(join(root, 'app.flat', 'repo')), false, 'a local repository is never cloned into its flat record')
  assert.equal(git(repo, ['status', '--porcelain']), '', 'the completed repository is clean')
  await flatNew({ target: repo, rounds: 1, coverage: 100 }, () => {})
  assert.equal(git(repo, ['status', '--porcelain']), '', 're-running refreshes the same reading without changing the repository')
})

test('a local flat site reads the source repository named in its record', { skip: !gitAvailable() && 'git not available' }, async () => {
  const { repo } = initializedLocalRepo()
  const result = await flatNew({ target: repo, rounds: 1, coverage: 100 }, () => {})
  const { flatSite } = await import('./flat.js')
  const site = await flatSite(result.out, () => {})
  assert.equal(site.nodes, 3)
  assert.ok(existsSync(join(result.out, 'site', 'public-graph.json')))
})

test('a local conversion uses its configured runner and commits only .spec', { skip: !gitAvailable() && 'git not available' }, async () => {
  const { root, repo, config } = initializedLocalRepo()
  writeFileSync(join(repo, '.spec', 'project', 'source-one', 'spec.md'), `---\ntitle: source one\nstatus: active\nhue: 165\ndesc: Exposes the first fixture value.\n---\n# source one\n\nThe source module exposes the first fixture value.\n`)
  git(repo, ['add', '.spec'])
  git(repo, ['commit', '-qm', 'remove coverage'])
  const runner = join(root, 'bin', 'codex')
  writeFileSync(runner, `#!/bin/sh
[ "$1" = "exec" ] && [ "$2" = "-" ] || exit 64
cat >/dev/null
mkdir -p .spec/project/source-one
cat > .spec/project/source-one/spec.md <<'SPEC'
---
title: source one
status: active
hue: 165
desc: Exposes the first fixture value.
code:
  - src-one.ts
---
# source one

The source module exposes the first fixture value.
SPEC
git -c user.name=Agent -c user.email=agent@example.invalid add .spec
git -c user.name=Agent -c user.email=agent@example.invalid commit --no-verify -qm 'agent spec draft'
`)
  execFileSync('chmod', ['+x', runner])
  const result = await flatNew({ target: repo, rounds: 1, coverage: 100 }, () => {})
  assert.equal(result.rounds, 1)
  assert.equal(result.passed, true)
  assert.equal(readFileSync(join(repo, '.spec/spexcode.json'), 'utf8'), config, 'the selected local launcher configuration is preserved')
  assert.deepEqual(git(repo, ['show', '--format=', '--name-only', 'HEAD']).split('\n').filter(Boolean), ['.spec/project/source-one/spec.md'])
  assert.equal(git(repo, ['log', '-1', '--format=%an']), 'Flatcode', 'Flatcode owns the committed measurement')
  assert.equal(git(repo, ['status', '--porcelain']), '')
})

test('a local conversion discards agent source changes rather than committing them', { skip: !gitAvailable() && 'git not available' }, async () => {
  const { root, repo } = initializedLocalRepo()
  writeFileSync(join(repo, '.spec', 'project', 'source-one', 'spec.md'), `---\ntitle: source one\nstatus: active\nhue: 165\ndesc: Exposes the first fixture value.\n---\n# source one\n\nThe source module exposes the first fixture value.\n`)
  git(repo, ['add', '.spec'])
  git(repo, ['commit', '-qm', 'remove coverage'])
  const runner = join(root, 'bin', 'codex')
  writeFileSync(runner, '#!/bin/sh\n[ "$1" = "exec" ] && [ "$2" = "-" ] || exit 64\ncat >/dev/null\nprintf "export const answer = 0\\n" > src-one.ts\n')
  execFileSync('chmod', ['+x', runner])
  await assert.rejects(flatNew({ target: repo, rounds: 1, coverage: 100 }, () => {}), /outside \.spec/)
  assert.equal(readFileSync(join(repo, 'src-one.ts'), 'utf8'), 'export const answer = 42\n', 'the source file is restored')
  assert.equal(git(repo, ['status', '--porcelain']), '', 'the rejected local round leaves no source change behind')
})

test('every harness declaring a one-shot turn carries the prompt exactly one way', () => {
  const capable = HARNESSES.filter((harness) => harness.oneShotTurn)
  assert.ok(capable.length > 0, 'no harness can run a conversion round')
  for (const harness of capable) {
    const turn = harness.oneShotTurn!('PROMPT-BODY', undefined)
    assert.ok(turn.command.length > 0, `${harness.id} produced an empty command`)
    // Either the prompt is on stdin and absent from the command, or it is in the command and stdin is empty.
    // A prompt in both places would deliver the instruction twice.
    const inCommand = turn.command.includes('PROMPT-BODY')
    assert.equal(inCommand, turn.stdin === '', `${harness.id} carries the prompt ambiguously`)
  }
})

test('the launcher command is what actually runs the turn', () => {
  const claude = harnessById('claude')
  assert.equal(claude.oneShotTurn!('p', '/abs/path/reclaude --dangerously-skip-permissions').command,
    '/abs/path/reclaude --dangerously-skip-permissions -p')
  const codex = harnessById('codex')
  assert.equal(codex.oneShotTurn!('p', 'codex --yolo').command, 'codex --yolo exec -')
})

test('headless variants inherit the one-shot turn from their native family', () => {
  // They are built by object composition, so a family that can run a turn keeps that ability when the
  // resident half is swapped out. Losing it silently would refuse a launcher that in fact works.
  for (const id of ['claude-headless', 'codex-headless', 'opencode-headless']) {
    assert.ok(harnessById(id).oneShotTurn, `${id} lost its family's non-interactive turn`)
  }
})
