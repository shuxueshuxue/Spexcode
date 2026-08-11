import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HARNESSES, defaultLauncher, harnessById, resolveLauncher, type Harness } from './harness.js'

const PKG = fileURLToPath(new URL('..', import.meta.url))
const SPEX = join(PKG, 'bin', 'spex.mjs')

// The branch Flatcode commits the spec tree onto inside its OWN clone. Never pushed: the flat is a reading of
// the repository, not a change to it, and a user who wants it upstream opens that as their own change.
export const FLAT_BRANCH = 'flatcode'
const DEFAULT_ROUNDS = 6
const DEFAULT_COVERAGE = 90

// @@@ source extensions are an allowlist, never a guess - an unknown extension is ignored rather than
// governed. Governing a file nobody can spec (a lockfile, a minified vendor bundle, a fixture) manufactures
// permanent coverage debt that no round can ever pay off, so the gate would never close. Under-claiming costs
// a user one edit to the emitted config; over-claiming costs an unbounded loop.
const SOURCE_EXTENSIONS: Readonly<Record<string, string>> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript',
  py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', swift: 'Swift',
  c: 'C', h: 'C', cc: 'C++', cpp: 'C++', hpp: 'C++', cs: 'C#', php: 'PHP', scala: 'Scala',
  ex: 'Elixir', exs: 'Elixir', erl: 'Erlang', hs: 'Haskell', ml: 'OCaml', clj: 'Clojure',
  lua: 'Lua', dart: 'Dart', vue: 'Vue', svelte: 'Svelte', sh: 'Shell', zig: 'Zig',
}
// Tracked directories that are somebody else's code or a build product. They are real source by extension,
// which is exactly why they must be named: governing them buys nothing and drowns the real tree.
const NON_SOURCE_DIRS = new Set([
  'node_modules', 'vendor', 'third_party', 'thirdparty', 'dist', 'build', 'out', 'target',
  'generated', 'gen', '.venv', 'venv', 'site-packages', 'testdata', 'fixtures', '__pycache__',
])

export type FlatGate = {
  errors: number
  governed: number
  uncovered: number
  coverage: number
  errorFindings: readonly string[]
  uncoveredFiles: readonly string[]
}

export type FlatProfile = {
  sourceExtensions: readonly string[]
  governedRoots: readonly string[]
  languages: readonly string[]
  fileCount: number
}

type Run = { code: number; stdout: string; stderr: string }

function run(command: string, args: readonly string[], cwd: string, stdin = ''): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => done({ code: 127, stdout, stderr: `${stderr}${(error as Error).message}` }))
    child.on('close', (code) => done({ code: code ?? 1, stdout, stderr }))
    child.stdin.end(stdin)
  })
}

// One agent turn, streamed to the operator's terminal as it happens. A conversion round takes minutes; a
// silent pipe would read as a hang, and the turn's own narration is the only progress there is to show.
function runTurn(turn: { command: string; stdin: string }, cwd: string): Promise<number> {
  return new Promise((done) => {
    const child = spawn('sh', ['-c', turn.command], { cwd, stdio: ['pipe', 'inherit', 'inherit'] })
    child.on('error', () => done(127))
    child.on('close', (code) => done(code ?? 1))
    child.stdin.end(turn.stdin)
  })
}

const spex = (args: readonly string[], cwd: string, env: Record<string, string> = {}) =>
  new Promise<Run>((done) => {
    const child = spawn(process.execPath, [SPEX, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => done({ code: 127, stdout, stderr: (error as Error).message }))
    child.on('close', (code) => done({ code: code ?? 1, stdout, stderr }))
  })

// @@@ profile - derive what counts as this repository's source from what it actually tracks. `git ls-files`
// is the enumeration because it already answers "tracked, not ignored" exactly; walking the tree would have to
// re-implement .gitignore and would sweep in build output the repository deliberately ignores.
export function profileFiles(files: readonly string[]): FlatProfile {
  const byExtension = new Map<string, number>()
  const byRoot = new Map<string, number>()
  let fileCount = 0
  for (const file of files) {
    const segments = file.split('/')
    if (segments.some((segment) => NON_SOURCE_DIRS.has(segment))) continue
    const leaf = segments[segments.length - 1]
    const dot = leaf.lastIndexOf('.')
    if (dot <= 0) continue                                   // no extension at all, or a dotfile (.gitignore)
    const extension = leaf.slice(dot + 1).toLowerCase()
    if (!(extension in SOURCE_EXTENSIONS)) continue
    fileCount += 1
    byExtension.set(extension, (byExtension.get(extension) ?? 0) + 1)
    // A file at the repository top level makes the repository root the governed root; there is no dir to name.
    const root = segments.length > 1 ? segments[0] : '.'
    byRoot.set(root, (byRoot.get(root) ?? 0) + 1)
  }
  const sourceExtensions = [...byExtension.keys()].sort()
  const languages = [...new Set(sourceExtensions.map((extension) => SOURCE_EXTENSIONS[extension]))].sort()
  // A root earns governance by holding a real share of the source. The threshold keeps one stray script in
  // `scripts/` from widening the governed set to the whole repository.
  const floor = Math.max(1, Math.floor(fileCount * 0.02))
  const governedRoots = [...byRoot.entries()]
    .filter(([, count]) => count >= floor)
    .map(([root]) => root)
    .sort()
  return { sourceExtensions, governedRoots: governedRoots.includes('.') ? ['.'] : governedRoots, languages, fileCount }
}

// The gate reading. `spex spec lint --json` exits non-zero when it found errors — that IS the reading, not a
// crash, so only an unparseable payload is a failure.
export function readGate(payload: string): FlatGate {
  const report = JSON.parse(payload) as {
    sourceFiles?: string[]
    findings?: { level: string; rule: string; spec?: string; file?: string; msg: string }[]
  }
  const findings = report.findings ?? []
  const governed = (report.sourceFiles ?? []).length
  const uncoveredFiles = findings.filter((f) => f.rule === 'coverage').map((f) => f.file ?? f.msg)
  const errorFindings = findings.filter((f) => f.level === 'error').map((f) => `${f.rule}: ${f.msg}`)
  return {
    errors: errorFindings.length,
    governed,
    uncovered: uncoveredFiles.length,
    coverage: governed ? Math.round(((governed - uncoveredFiles.length) / governed) * 100) : 0,
    errorFindings,
    uncoveredFiles,
  }
}

export const gatePassed = (gate: FlatGate, coverageFloor: number) =>
  gate.errors === 0 && gate.governed > 0 && gate.coverage >= coverageFloor

function surveyPrompt(profile: FlatProfile, coverageFloor: number): string {
  return [
    `You are flattening this repository into a SpexCode .spec tree. This is the whole task; there is no other work.`,
    ``,
    `FIRST, read the authoring format — it is the authority, not this message:`,
    `  spex guide spec`,
    ``,
    `The repository is ${profile.languages.join(', ')} (${profile.fileCount} governed source files under ${profile.governedRoots.join(', ')}).`,
    ``,
    `Write .spec nodes until every governed source file is claimed by exactly one node's \`code:\` list.`,
    `Shape the tree the way the SYSTEM is shaped — one node per real responsibility, nesting where a`,
    `responsibility genuinely contains sub-responsibilities. Do not mirror the directory layout for its own sake.`,
    ``,
    `A node body states INTENT, INVARIANTS, and CONTRACTS: what this part guarantees, what it refuses, what`,
    `would be a bug. It is not a paraphrase of the code — a reader who has the source already gets nothing`,
    `from prose that restates it. Write what the source CANNOT tell them: why this shape, what it must never do.`,
    ``,
    `You will be measured, and you will be told what failed:`,
    `  - \`spex spec lint\` must report ZERO errors.`,
    `  - Coverage must reach ${coverageFloor}% of governed source files.`,
    `  - \`spex doctor\` must not find nodes that dumped mechanics instead of stating intent.`,
    ``,
    `Run those yourself as you go. Commit nothing; the driver commits.`,
  ].join('\n')
}

function repairPrompt(gate: FlatGate, doctor: string, coverageFloor: number): string {
  const lines = [
    `Continue flattening this repository. The gate was measured and it did NOT pass. Fix exactly what follows.`,
    ``,
    `Coverage: ${gate.coverage}% of ${gate.governed} governed files (floor ${coverageFloor}%). Lint errors: ${gate.errors}.`,
  ]
  if (gate.errorFindings.length) {
    lines.push(``, `LINT ERRORS — these are structural and block everything:`)
    for (const finding of gate.errorFindings.slice(0, 40)) lines.push(`  - ${finding}`)
  }
  if (gate.uncoveredFiles.length) {
    lines.push(``, `UNCLAIMED SOURCE FILES — each needs a node whose \`code:\` claims it:`)
    for (const file of gate.uncoveredFiles.slice(0, 60)) lines.push(`  - ${file}`)
    if (gate.uncoveredFiles.length > 60) lines.push(`  … and ${gate.uncoveredFiles.length - 60} more; run \`spex spec lint\` for the rest.`)
  }
  if (doctor.trim()) {
    lines.push(``, `SPEC HEALTH — nodes reading as mechanics dumps rather than intent, and parents fanned too wide:`, ``, doctor.trim())
  }
  lines.push(``, `Commit nothing; the driver commits.`)
  return lines.join('\n')
}

// The launcher IS the choice, exactly as it is for a session ([[launcher-select]]) — same config, same
// fail-loud resolution, same wording. Flatcode adds one requirement on top: the resolved harness must be able
// to run a turn that ends.
function resolveTurnHarness(launcher: string | undefined, root: string): { harness: Harness; cmd: string; name: string } {
  const name = launcher ?? defaultLauncher(root)
  const chosen = resolveLauncher(name, root)
  const harness = harnessById(chosen.harness)
  if (!harness.oneShotTurn) {
    const capable = HARNESSES.filter((candidate) => candidate.oneShotTurn).map((candidate) => candidate.id).join(', ')
    throw new Error(
      `spex flat: launcher '${name}' runs harness '${harness.id}', which has no non-interactive turn, so it ` +
      `cannot run a conversion round. Harnesses that can: ${capable}. Pick a launcher on one of those with --launcher.`,
    )
  }
  return { harness, cmd: chosen.cmd, name }
}

async function git(args: readonly string[], cwd: string): Promise<Run> {
  return run('git', args, cwd)
}

async function gitOrThrow(args: readonly string[], cwd: string, what: string): Promise<string> {
  const result = await git(args, cwd)
  if (result.code !== 0) throw new Error(`spex flat: ${what} failed — ${result.stderr.trim() || result.stdout.trim()}`)
  return result.stdout.trim()
}

const isUrl = (target: string) => /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(target)

export type FlatOptions = {
  target: string
  out?: string
  launcher?: string
  rounds?: number
  coverage?: number
}

export type FlatResult = {
  out: string
  repo: string
  source: string
  revision: string
  rounds: number
  gate: FlatGate
  passed: boolean
  profile: FlatProfile
}

export async function flatNew(options: FlatOptions, log: (line: string) => void = console.log): Promise<FlatResult> {
  const rounds = options.rounds ?? DEFAULT_ROUNDS
  const coverageFloor = options.coverage ?? DEFAULT_COVERAGE
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error('spex flat: --rounds must be a positive integer')
  if (!Number.isFinite(coverageFloor) || coverageFloor < 0 || coverageFloor > 100) throw new Error('spex flat: --coverage must be between 0 and 100')

  const name = basename(options.target.replace(/\.git$/, '').replace(/\/+$/, '')) || 'flat'
  const out = resolve(options.out ?? `${name}.flat`)
  const repo = join(out, 'repo')
  if (existsSync(repo)) throw new Error(`spex flat: ${repo} already exists — name a different --out or remove it`)
  mkdirSync(out, { recursive: true })

  // --- acquire -------------------------------------------------------------------------------------------
  let source = options.target
  if (isUrl(options.target)) {
    log(`cloning ${options.target}`)
    const clone = await run('git', ['clone', '--quiet', options.target, repo], out)
    if (clone.code !== 0) throw new Error(`spex flat: clone failed — ${clone.stderr.trim()}`)
  } else {
    const local = resolve(options.target)
    if (!existsSync(join(local, '.git'))) throw new Error(`spex flat: ${local} is not a git repository`)
    const dirty = await gitOrThrow(['status', '--porcelain'], local, 'reading the working tree')
    if (dirty) throw new Error(`spex flat: ${local} has uncommitted changes — Flatcode commits a spec tree and will not mix it with work it did not write`)
    log(`cloning local ${local}`)
    const clone = await run('git', ['clone', '--quiet', local, repo], out)
    if (clone.code !== 0) throw new Error(`spex flat: local clone failed — ${clone.stderr.trim()}`)
    source = local
  }
  const revision = await gitOrThrow(['rev-parse', 'HEAD'], repo, 'reading the cloned revision')
  await gitOrThrow(['checkout', '--quiet', '-b', FLAT_BRANCH], repo, `creating the ${FLAT_BRANCH} branch`)

  // --- profile -------------------------------------------------------------------------------------------
  const tracked = (await gitOrThrow(['ls-files'], repo, 'listing tracked files')).split('\n').filter(Boolean)
  const profile = profileFiles(tracked)
  if (!profile.fileCount) {
    throw new Error(
      `spex flat: no recognised source files in ${source}. Flatcode governs a fixed allowlist of source ` +
      `extensions; a repository outside it would gate on an empty governed set, which passes vacuously.`,
    )
  }
  log(`profiled ${profile.fileCount} source files · ${profile.languages.join(', ')} · roots ${profile.governedRoots.join(', ')}`)
  const configPath = join(repo, 'spexcode.json')
  const existing = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {}
  writeFileSync(configPath, `${JSON.stringify({
    ...existing,
    lint: { ...(existing.lint ?? {}), governedRoots: profile.governedRoots, sourceExtensions: profile.sourceExtensions },
  }, null, 2)}\n`)

  // --- seed ----------------------------------------------------------------------------------------------
  const { harness, cmd, name: launcherName } = resolveTurnHarness(options.launcher, process.cwd())
  const init = await spex(['init', '--harness', harness.dispatchId], repo)
  if (init.code !== 0) throw new Error(`spex flat: seeding .spec failed — ${init.stderr.trim() || init.stdout.trim()}`)
  await commit(repo, 'flatcode: profile and seed .spec')
  log(`seeded .spec · launcher ${launcherName} (${harness.id})`)

  // --- converge ------------------------------------------------------------------------------------------
  let gate = await gateOf(repo)
  let round = 0
  while (round < rounds && !gatePassed(gate, coverageFloor)) {
    round += 1
    const doctor = round === 1 ? '' : (await spex(['doctor'], repo)).stdout
    const prompt = round === 1 ? surveyPrompt(profile, coverageFloor) : repairPrompt(gate, doctor, coverageFloor)
    log(`round ${round}/${rounds} — coverage ${gate.coverage}% · ${gate.errors} lint error(s)`)
    const code = await runTurn(harness.oneShotTurn!(prompt, cmd), repo)
    if (code !== 0) log(`round ${round}: the agent turn exited ${code}; measuring anyway`)
    await commit(repo, `flatcode: round ${round}`)
    gate = await gateOf(repo)
  }

  const passed = gatePassed(gate, coverageFloor)
  const result: FlatResult = { out, repo, source, revision, rounds: round, gate, passed, profile }
  writeFileSync(join(out, 'flat.json'), `${JSON.stringify({
    schema: 'spexcode.flat/v1',
    source, revision, branch: FLAT_BRANCH, launcher: launcherName, harness: harness.id,
    rounds: round, roundBudget: rounds, coverageFloor, passed,
    gate: { errors: gate.errors, governed: gate.governed, uncovered: gate.uncovered, coverage: gate.coverage },
    profile,
  }, null, 2)}\n`)
  return result
}

export async function runFlat(argv: readonly string[]): Promise<number> {
  const sub = argv[0]
  const { commandHelp } = await import('./help.js')
  if (sub === undefined || sub === '--help' || sub === '-h') { console.log(commandHelp('flat')); return sub === undefined ? 0 : 0 }
  if (sub !== 'new') {
    console.error(`spex flat: unknown subcommand "${sub}". Run \`spex flat\` for the command map.`)
    return 2
  }
  const known = new Set(['out', 'launcher', 'rounds', 'coverage'])
  const flags = new Map<string, string>()
  const positional: string[] = []
  const rest = argv.slice(1)
  for (let at = 0; at < rest.length; at += 1) {
    const token = rest[at]
    if (!token.startsWith('--')) { positional.push(token); continue }
    const name = token.slice(2)
    if (!known.has(name)) { console.error(`spex flat new: unknown flag --${name} (known: ${[...known].map((k) => `--${k}`).join(', ')})`); return 2 }
    const value = rest[at + 1]
    if (value === undefined || value.startsWith('--')) { console.error(`spex flat new: --${name} expects a value`); return 2 }
    flags.set(name, value)
    at += 1
  }
  if (positional.length !== 1) {
    console.error('usage: spex flat new <repo-url|path> [--out <dir>] [--launcher <name>] [--rounds <n>] [--coverage <pct>]')
    return 2
  }
  const number = (name: string): number | undefined => {
    const raw = flags.get(name)
    if (raw === undefined) return undefined
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error(`spex flat: --${name} expects a number, got ${JSON.stringify(raw)}`)
    return value
  }
  try {
    const result = await flatNew({
      target: positional[0],
      out: flags.get('out'),
      launcher: flags.get('launcher'),
      rounds: number('rounds'),
      coverage: number('coverage'),
    })
    const { gate } = result
    console.log('')
    console.log(`${result.passed ? 'converged' : 'PARTIAL'} after ${result.rounds} round(s)`)
    console.log(`  coverage  ${gate.coverage}% of ${gate.governed} governed source files`)
    console.log(`  lint      ${gate.errors} error(s)`)
    console.log(`  flat      ${result.out}`)
    if (!result.passed) {
      // A partial flat reports what still fails and exits non-zero. Reporting a converged tree we did not
      // measure would make the gate decorative.
      console.log('')
      console.log('still failing:')
      for (const finding of gate.errorFindings.slice(0, 10)) console.log(`  ${finding}`)
      if (gate.uncovered) console.log(`  ${gate.uncovered} source file(s) still unclaimed by any node`)
      console.log('')
      console.log('Raise --rounds to keep going, or lower --coverage if this repository has files no spec should claim.')
      return 1
    }
    return 0
  } catch (error) {
    console.error((error as Error).message)
    return 1
  }
}

async function gateOf(repo: string): Promise<FlatGate> {
  const lint = await spex(['spec', 'lint', '--json'], repo)
  if (!lint.stdout.trim()) throw new Error(`spex flat: spec lint produced no report — ${lint.stderr.trim()}`)
  return readGate(lint.stdout)
}

// Flatcode's own commits bypass the lint hook on purpose: an intermediate round is EXPECTED to be incomplete,
// and a hook that refused it would strand the round's work uncommitted where the next round cannot see it.
// The gate reading, not the commit hook, is what decides whether this flat converged.
async function commit(repo: string, message: string): Promise<void> {
  await git(['add', '-A'], repo)
  const staged = await git(['diff', '--cached', '--quiet'], repo)
  if (staged.code === 0) return
  const result = await run('git', ['-c', 'user.name=Flatcode', '-c', 'user.email=flatcode@spexcode.invalid', 'commit', '--quiet', '--no-verify', '-m', message], repo)
  if (result.code !== 0) throw new Error(`spex flat: committing "${message}" failed — ${result.stderr.trim()}`)
}
