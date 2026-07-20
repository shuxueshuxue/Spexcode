import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildProjection, projectionDiff } from './sync-init-plugins.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const CANONICAL_PLUGINS = buildProjection()
const FORBIDDEN_ADOPTER_TEXT = [
  '.spec/spexcode',
  'deploying the fleet',
  'spexcode-ops',
  'bj01.ezfrp.com',
  '/home/jeffry',
  'rocket delta',
  'reclaude',
  'gugu',
  'z-code',
  'ci-gate',
]

const LANGUAGES = [
  {
    id: 'python',
    tracked: 'src/app.py',
    untracked: 'src/local_only.py',
    source: 'def answer() -> int:\n    return 42\n',
  },
  {
    id: 'typescript',
    tracked: 'src/index.ts',
    untracked: 'src/local-only.ts',
    source: 'export const answer: number = 42\n',
  },
]

const HARNESSES = [
  {
    id: 'claude',
    contract: 'CLAUDE.md',
    shim: '.claude/settings.json',
    skill: '.claude/skills/distill/SKILL.md',
    absent: ['AGENTS.md', '.codex'],
    receiptKinds: ['hook manifest', 'contract', 'shim', 'skill'],
  },
  {
    id: 'codex',
    contract: 'AGENTS.md',
    shim: '.codex/hooks.json',
    skill: '.codex/skills/distill/SKILL.md',
    absent: ['CLAUDE.md', '.claude'],
    receiptKinds: ['hook manifest', 'contract', 'shim', 'trust', 'skill'],
  },
]

const CASES = LANGUAGES.flatMap((language) =>
  HARNESSES.map((harness) => ({ language, harness, name: `${language.id}/${harness.id}` })))

function run(file, args, { cwd = ROOT, env = process.env, label = `${file} ${args.join(' ')}` } = {}) {
  const result = spawnSync(file, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  })
  if (result.error) throw new Error(`${label} failed to start: ${result.error.message}`)
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.status !== 0) {
    throw new Error(`${label} exited ${result.status}${result.signal ? ` (${result.signal})` : ''}\n${output}`)
  }
  return output
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function walkFiles(dir) {
  if (!existsSync(dir)) return []
  const paths = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) paths.push(...walkFiles(path))
    else if (entry.isFile()) paths.push(path)
  }
  return paths.sort()
}

function parseReceipt(output, caseName) {
  const match = output.match(/materialized harness artifacts \(([^\n]*)\)/)
  assert.ok(match, `[${caseName}] init printed its materialization receipt`)
  return match[1].split(', ').map((item) => {
    const split = item.indexOf(': ')
    assert.notEqual(split, -1, `[${caseName}] receipt entry has a kind and path: ${item}`)
    return { kind: item.slice(0, split), path: item.slice(split + 2) }
  })
}

function assertReceipt({ entries, initOutput, project, codexHome, harness, caseName }) {
  assert.deepEqual(entries.map((entry) => entry.kind), harness.receiptKinds,
    `[${caseName}] receipt has exactly the selected harness artifact kinds`)

  for (const entry of entries) {
    const path = isAbsolute(entry.path) ? entry.path : join(project, entry.path)
    assert.ok(existsSync(path), `[${caseName}] receipt is truthful: ${entry.kind} exists at ${entry.path}`)
  }

  for (const [kind, path] of [
    ['contract', harness.contract],
    ['shim', harness.shim],
    ['skill', harness.skill],
  ]) {
    assert.ok(entries.some((entry) => entry.kind === kind && entry.path === path),
      `[${caseName}] receipt names selected ${kind} ${path}`)
  }

  const trust = entries.find((entry) => entry.kind === 'trust')
  if (harness.id === 'codex') {
    assert.equal(trust?.path, join(codexHome, 'config.toml'), `[${caseName}] receipt names isolated Codex trust`)
  } else {
    assert.equal(trust, undefined, `[${caseName}] Claude-only receipt makes no Codex trust claim`)
  }

  for (const absent of harness.absent) {
    assert.ok(!initOutput.includes(absent), `[${caseName}] receipt/output does not claim unselected ${absent}`)
  }
}

function assertNoProjectLeak(project, caseName) {
  const heldBack = [
    '.spec/project/.plugins/prompts/deploy-runbook',
    '.spec/project/.plugins/review',
    '.spec/project/.plugins/skills/e2e-review',
    '.spec/project/.plugins/skills/taste',
  ]
  for (const path of heldBack) {
    assert.ok(!existsSync(join(project, path)), `[${caseName}] held-back plugin is absent: ${path}`)
  }

  const outputs = walkFiles(project)
    .filter((path) => !path.startsWith(join(project, '.git')))
    .map((path) => ({ path: relative(project, path), content: readFileSync(path, 'utf8').toLowerCase() }))
  for (const marker of FORBIDDEN_ADOPTER_TEXT) {
    const leaked = outputs.find((file) => file.content.includes(marker.toLowerCase()))
    assert.ok(leaked === undefined,
      `[${caseName}] adopter output excludes private/project marker "${marker}"${leaked ? ` in ${leaked.path}` : ''}`)
  }
  const sourceLeak = outputs.find((file) => file.content.includes(ROOT.toLowerCase()))
  assert.ok(sourceLeak === undefined,
    `[${caseName}] adopter output does not reference the source checkout${sourceLeak ? ` in ${sourceLeak.path}` : ''}`)
}

function runCase({ language, harness, name }, spex, suiteRoot) {
  const caseRoot = join(suiteRoot, name.replace('/', '-'))
  const project = join(caseRoot, 'project')
  const home = join(caseRoot, 'home')
  const codexHome = join(caseRoot, 'codex-home')
  const globalGitConfig = join(caseRoot, 'global.gitconfig')
  mkdirSync(project, { recursive: true })
  mkdirSync(home, { recursive: true })
  mkdirSync(codexHome, { recursive: true })
  writeFileSync(globalGitConfig, '')

  const env = {
    ...process.env,
    CI: '1',
    HOME: home,
    CODEX_HOME: codexHome,
    SPEXCODE_HOME: join(home, '.spexcode'),
    SPEXCODE_PI_AGENT_DIR: join(home, '.pi', 'agent'),
    GIT_CONFIG_GLOBAL: globalGitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
  }
  const git = (...args) => run('git', ['-C', project, ...args], { env, label: `[${name}] git ${args.join(' ')}` })

  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'smoke@example.invalid')
  git('config', 'user.name', 'Spex Smoke')
  write(join(project, language.tracked), language.source)
  git('add', language.tracked)
  git('commit', '-qm', `seed ${language.id}`)
  write(join(project, language.untracked), language.source)

  assert.deepEqual(git('ls-files').trim().split('\n'), [language.tracked], `[${name}] fixture has one tracked source`)

  const initOutput = run(spex, ['init', '.', '--harness', harness.id], {
    cwd: project,
    env,
    label: `[${name}] spex init`,
  })
  assert.ok(!initOutput.includes('materialize skipped'), `[${name}] init materialization did not degrade`)
  assert.ok(initOutput.includes(`harnesses ["${harness.id}"], launchers ["${harness.id}"]`),
    `[${name}] init reports the selected harness and launcher`)

  const config = JSON.parse(readFileSync(join(project, 'spexcode.json'), 'utf8'))
  assert.deepEqual(config.harnesses, [harness.id], `[${name}] selection persists as one harness`)
  assert.deepEqual(config.sessions, {
    launchers: { [harness.id]: { harness: harness.id, cmd: harness.id } },
    defaultLauncher: harness.id,
  }, `[${name}] init seeds one plain launcher command`)
  assert.doesNotMatch(JSON.stringify(config.sessions), /dangerously-skip-permissions|--yolo|--auto|login/i,
    `[${name}] launcher grants no permissions and performs no login`)

  const receipt = parseReceipt(initOutput, name)
  assertReceipt({ entries: receipt, initOutput, project, codexHome, harness, caseName: name })

  const materializeOutput = run(spex, ['materialize'], {
    cwd: project,
    env,
    label: `[${name}] spex materialize`,
  })
  assert.match(materializeOutput, /materialized[^\n]*content-hash [0-9a-f]{64}/,
    `[${name}] explicit materialize reports a deterministic content hash`)

  for (const path of [harness.contract, harness.shim, harness.skill]) {
    assert.ok(existsSync(join(project, path)), `[${name}] selected artifact exists: ${path}`)
  }
  for (const path of harness.absent) {
    assert.ok(!existsSync(join(project, path)), `[${name}] unselected artifact is absent: ${path}`)
  }
  if (harness.id === 'claude') {
    assert.ok(!existsSync(join(codexHome, 'config.toml')), `[${name}] Claude-only materialize writes no Codex trust`)
  }

  assert.deepEqual(
    projectionDiff(CANONICAL_PLUGINS, join(project, '.spec', 'project', '.plugins')),
    [],
    `[${name}] initialized plugins equal the canonical projection byte-for-byte and mode-for-mode`,
  )
  assertNoProjectLeak(project, name)

  const lintOutput = run(spex, ['spec', 'lint'], { cwd: project, env, label: `[${name}] spex spec lint` })
  assert.ok(lintOutput.includes(`coverage: no spec governs: ${language.tracked}`),
    `[${name}] coverage sees the git-tracked source`)
  assert.ok(!lintOutput.includes(language.untracked), `[${name}] coverage ignores untracked source`)
  assert.match(lintOutput, /spex spec lint: 0 error\(s\), \d+ warning\(s\)/, `[${name}] lint has zero errors`)

  console.log(`clean-init smoke: ${name} ok`)
}

function main() {
  const suiteRoot = mkdtempSync(join(tmpdir(), 'spex-clean-init-'))
  try {
    const packDir = join(suiteRoot, 'pack')
    const consumer = join(suiteRoot, 'consumer')
    mkdirSync(packDir)
    mkdirSync(consumer)

    run(NPM, ['pack', '--silent', '--pack-destination', packDir], { label: 'npm pack' })
    const tarballs = readdirSync(packDir).filter((name) => /^spexcode-.*\.tgz$/.test(name))
    assert.equal(tarballs.length, 1, `npm pack produced one tarball, got: ${tarballs.join(', ')}`)
    const tarball = join(packDir, tarballs[0])

    run(NPM, ['init', '-y', '--silent'], { cwd: consumer, label: 'npm init consumer' })
    run(NPM, ['install', '--offline', '--no-audit', '--no-fund', '--silent', tarball], {
      cwd: consumer,
      label: 'offline install of packed spexcode',
    })

    const spex = join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'spex.cmd' : 'spex')
    assert.ok(existsSync(spex), 'packed install exposes the spex executable')
    run(spex, ['--help'], { cwd: consumer, label: 'installed spex --help' })

    for (const smokeCase of CASES) runCase(smokeCase, spex, suiteRoot)
    console.log(`clean-init smoke: ${CASES.length} production cases passed without launching a harness or using network`)
  } finally {
    rmSync(suiteRoot, { recursive: true, force: true })
  }
}

main()
