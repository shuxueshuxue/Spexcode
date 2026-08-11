import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
  // SpexCode's own tree is never the subject of a flat. It is absent on the first pass (profiling runs before
  // the seed) but present on any re-profile, where counting it would shift the share threshold under roots
  // that qualified the first time.
  '.spec',
])

export type FlatGate = {
  errors: number
  governed: number
  uncovered: number
  coverage: number
  errorFindings: readonly string[]
  uncoveredFiles: readonly string[]
  sourceFiles: readonly string[]
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
    child.stdin.on('error', () => { /* see runTurn: the exit code is the verdict, not the stdin pipe */ })
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
    // @@@ the exit code is the verdict, not the pipe - a harness that takes the prompt and closes stdin, or
    // that exits before reading it at all (a rejected credential, a bad flag), makes this write EPIPE. That is
    // information about the pipe, not about the round: an unhandled EPIPE here would abort the whole flat and
    // throw away every converged round before it, where the exit code turns the same event into one reported
    // failed round the loop can measure and continue past.
    child.stdin.on('error', () => { /* handled by the close code above */ })
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
  // A root earns governance by holding a real SHARE of the source, and the repository root earns it the same
  // way as any other. Without that, one top-level packaging script (`setup.py`) qualifies the root, the root
  // subsumes every sibling, and a library flat silently takes on its whole test and docs tree. The share is
  // deliberately coarse — the emitted config is the user's to correct, and under-claiming costs one edit
  // while over-claiming costs rounds spent specifying files nobody wanted specified.
  const floor = Math.max(2, Math.ceil(fileCount * 0.05))
  const qualified = [...byRoot.entries()].filter(([, count]) => count >= floor).map(([root]) => root).sort()
  const governedRoots = qualified.includes('.') ? ['.'] : qualified
  // Report the count of what will actually BE governed, not of everything recognised: a file under a root that
  // did not qualify is never gated, and counting it here would put the report permanently at odds with the
  // gate's own denominator.
  const governedCount = governedRoots.includes('.')
    ? fileCount
    : governedRoots.reduce((total, root) => total + (byRoot.get(root) ?? 0), 0)
  return { sourceExtensions, governedRoots, languages, fileCount: governedCount }
}

// The gate reading. `spex spec lint --json` exits non-zero when it found errors — that IS the reading, not a
// crash, so only an unparseable payload is a failure.
export function readGate(payload: string): FlatGate {
  const report = JSON.parse(payload) as {
    sourceFiles?: string[]
    findings?: { level: string; rule: string; spec?: string; file?: string; msg: string }[]
  }
  const findings = report.findings ?? []
  const sourceFiles = report.sourceFiles ?? []
  const governed = sourceFiles.length
  const uncoveredFiles = findings.filter((f) => f.rule === 'coverage').map((f) => f.file ?? f.msg)
  const errorFindings = findings.filter((f) => f.level === 'error').map((f) => `${f.rule}: ${f.msg}`)
  return {
    errors: errorFindings.length,
    governed,
    uncovered: uncoveredFiles.length,
    coverage: governed ? Math.round(((governed - uncoveredFiles.length) / governed) * 100) : 0,
    errorFindings,
    uncoveredFiles,
    sourceFiles,
  }
}

export const gatePassed = (gate: FlatGate, coverageFloor: number) =>
  gate.errors === 0 && gate.governed > 0 && gate.coverage >= coverageFloor

// @@@ confirmProfile - narrow the PROPOSED governed set to the one lint actually keeps. The proposal is read
// off the file tree, but lint applies the product's own source policy on top (its testGlobs drop `tests/`,
// `test_*`, `*.test.*` wholesale), so a root can be proposed, written into the config, and then contribute
// nothing. Left uncorrected that root is a lie in two places at once: the emitted config lists a root the gate
// ignores, and the report prints a file count the gate's own denominator contradicts — measured on psf/requests
// as "37 source files across docs, src, tests" beside a gate reading of 21. The profile must be CONFIRMED
// against lint's accounting for the same reason convergence is: this file does not get to assert what is
// governed. Reimplementing the exclusion policy here instead would put a second copy of it in the tree, and the
// copies would drift.
export function confirmProfile(proposed: FlatProfile, sourceFiles: readonly string[]): FlatProfile {
  const kept = new Set(sourceFiles.map((file) => (file.includes('/') ? file.split('/')[0] : '.')))
  const governedRoots = proposed.governedRoots.filter((root) => root === '.' || kept.has(root))
  return { ...proposed, governedRoots, fileCount: sourceFiles.length }
}

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
    lines.push(
      ``,
      `SPEC HEALTH — nodes reading as mechanics dumps rather than intent, and parents fanned too wide:`,
      ``,
      doctor.trim(),
      ``,
      // `spex init` seeds .plugins with SpexCode's own workflow nodes, whose bodies ARE the prompt text that
      // gets materialized for the agent. Doctor measures them like any other node, so its findings name them —
      // and a round spent "fixing" them would trim live product behaviour and specify nothing about this
      // repository. The boundary belongs in the instruction, not in a fragile filter over doctor's prose.
      `IGNORE any finding under \`.spec/*/.plugins/\`. Those are SpexCode's own seeded workflow nodes, not`,
      `your work, and their bodies are prompt text that must not be trimmed. Fix only nodes you wrote.`,
    )
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

  // Resolve the agent BEFORE touching the network or the disk: a typo'd launcher name is knowable up front,
  // and discovering it after cloning would charge a fetch for a mistake that cost nothing to catch.
  const { harness, cmd, name: launcherName } = resolveTurnHarness(options.launcher, process.cwd())

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
  const proposed = profileFiles(tracked)
  if (!proposed.fileCount) {
    throw new Error(
      `spex flat: no recognised source files in ${source}. Flatcode governs a fixed allowlist of source ` +
      `extensions; a repository outside it would gate on an empty governed set, which passes vacuously.`,
    )
  }
  const configPath = join(repo, 'spexcode.json')
  const existing = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {}
  const writeConfig = (chosen: FlatProfile) => writeFileSync(configPath, `${JSON.stringify({
    ...existing,
    // Name the graph after the repository it reads, not after Flatcode's checkout directory — otherwise every
    // flat in the world renders under the title "repo".
    dashboard: { title: name, ...(existing.dashboard ?? {}) },
    lint: { ...(existing.lint ?? {}), governedRoots: chosen.governedRoots, sourceExtensions: chosen.sourceExtensions },
  }, null, 2)}\n`)
  writeConfig(proposed)

  // --- seed ----------------------------------------------------------------------------------------------
  const init = await spex(['init', '--harness', harness.dispatchId], repo)
  if (init.code !== 0) throw new Error(`spex flat: seeding .spec failed — ${init.stderr.trim() || init.stdout.trim()}`)
  log(`seeded .spec · launcher ${launcherName} (${harness.id})`)

  // --- confirm the governed set BEFORE anything is measured against it ------------------------------------
  // Commit the seed FIRST. Lint refuses to enumerate source while the spec tree it is asked about is
  // untracked, and it reports that refusal as an empty governed set — indistinguishable, to a caller reading
  // only the numbers, from a repository whose every root the source policy rejected. Reading before the commit
  // made a healthy two-file repository look vacuous.
  await commit(repo, 'flatcode: profile and seed .spec')
  let gate = await gateOf(repo)
  const profile = confirmProfile(proposed, gate.sourceFiles)
  const dropped = proposed.governedRoots.filter((root) => !profile.governedRoots.includes(root))
  if (dropped.length) {
    // Re-read rather than argue that the numbers cannot have moved. The first draft of this reasoned that
    // narrowing only removes roots contributing zero files, so the reading above must still stand — and that
    // reasoning is exactly the kind this command exists to refuse. The config that produced a reading is part
    // of the reading; change the config, measure again. One subprocess is cheaper than a report that is right
    // only as long as an assumption holds.
    writeConfig(profile)
    await commit(repo, `flatcode: narrow governed roots to ${profile.governedRoots.join(', ')}`)
    gate = await gateOf(repo)
    log(`dropped ${dropped.join(', ')} — lint's source policy governs nothing there`)
  }
  if (!gate.governed) {
    throw new Error(
      `spex flat: lint governs no source file in ${source}, so the gate would pass vacuously. The proposed ` +
      `roots were ${proposed.governedRoots.join(', ')}; the product's source policy kept none of them.`,
    )
  }
  log(`governing ${profile.fileCount} source files · ${profile.languages.join(', ')} · roots ${profile.governedRoots.join(', ')}`)

  // --- converge ------------------------------------------------------------------------------------------
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

// @@@ publicShellDir - the graph-only dashboard build, bundled-or-monorepo, mirroring gateway.ts's
// resolveDistDir. The shell is a build artifact of SpexCode and identical for every flat; only the payload
// beside it is per-repository. That split is why a flat renders with no backend and no build step of its own.
export function publicShellDir(): string {
  const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
  const bundled = join(pkgRoot, 'dashboard-public-dist')
  if (existsSync(join(bundled, 'index.html'))) return bundled
  return join(pkgRoot, '..', 'spec-dashboard', 'dist-public')
}

// The one spec-root directory under .spec. `spex init` names it for the project, so it is `project` in a
// fresh flat and `spexcode` in this repository — deriving it beats hardcoding either.
function specRoot(repo: string): string {
  const entries = readdirSync(join(repo, '.spec'), { withFileTypes: true }).filter((entry) => entry.isDirectory())
  if (entries.length !== 1) throw new Error(`spex flat site: expected exactly one spec root under .spec, found ${entries.length}`)
  return entries[0].name
}

export async function flatSite(flatDir: string, log: (line: string) => void = console.log): Promise<{ site: string; nodes: number }> {
  const out = resolve(flatDir)
  const recordPath = join(out, 'flat.json')
  if (!existsSync(recordPath)) throw new Error(`spex flat site: ${out} is not a flat — no flat.json. Run \`spex flat new\` first.`)
  const record = JSON.parse(readFileSync(recordPath, 'utf8')) as { source: string; revision: string; gate?: { coverage?: number; governed?: number } }
  const repo = join(out, 'repo')
  const site = join(out, 'site')

  const shell = publicShellDir()
  if (!existsSync(join(shell, 'index.html'))) {
    throw new Error(
      `spex flat site: no graph-only dashboard build at ${shell}. In a source checkout, build it once with ` +
      `\`npm run build:public\`; an installed spexcode ships it.`,
    )
  }
  mkdirSync(site, { recursive: true })
  cpSync(join(shell, 'index.html'), join(site, 'index.html'))
  cpSync(join(shell, 'assets'), join(site, 'assets'), { recursive: true })

  const graphPath = join(site, 'public-graph.json')
  const graph = await spex(['graph', '--public', '--out', graphPath, '--content-dir', join(site, 'specs')], repo)
  if (graph.code !== 0) throw new Error(`spex flat site: building the public graph failed — ${graph.stderr.trim() || graph.stdout.trim()}`)
  const root = specRoot(repo)

  // @@@ the publication is the repository's spec, not SpexCode's - `spex init` seeds .plugins with SpexCode's
  // own workflow nodes so the converting agent receives its contract. They are machinery, not a reading of the
  // target: measured on the first three published flats they were 38-48% of every graph, and their bodies ARE
  // the command prompt texts, so a visitor who came to read `requests` met SpexCode's `extract` prompt
  // presented as that repository's specification. The conversion needs them; the publication must not carry
  // them. Filtering here rather than at seed time keeps the agent's contract intact.
  const payload = JSON.parse(readFileSync(graphPath, 'utf8')) as {
    revision: string
    nodes: { id: string; path: string }[]
  }
  // The graph's `path` is repo-relative and includes `.spec/`, so the prefix has to as well.
  const seeded = `.spec/${root}/.plugins/`
  const published = payload.nodes.filter((node) => !node.path.startsWith(seeded))
  if (published.length === payload.nodes.length) {
    throw new Error(`spex flat site: nothing matched the seeded prefix ${seeded} — the publication would carry SpexCode's own workflow nodes as if they were this repository's spec`)
  }
  const dropped = payload.nodes.length - published.length
  if (dropped) {
    for (const node of payload.nodes) {
      if (published.includes(node)) continue
      rmSync(join(site, 'specs', `${node.id}.json`), { force: true })
    }
    writeFileSync(graphPath, `${JSON.stringify({ ...payload, nodes: published }, null, 2)}\n`)
    log(`  dropped ${dropped} seeded SpexCode workflow node(s) from the publication`)
  }

  const archiveName = `${root}.spec.zip`
  // The archive is the same publication, so it excludes the same subtree — a downloader who unzips it must
  // get what the graph showed, not the machinery the graph deliberately left out.
  const topLevel = readdirSync(join(repo, '.spec', root), { withFileTypes: true })
    .map((entry) => entry.name)
    .filter((name) => name !== '.plugins')
    .sort()
  const archive = await run('git', [
    'archive', '--format=zip', '--prefix=.spec/', `--output=${join(site, archiveName)}`,
    `${payload.revision}:.spec/${root}`, ...topLevel,
  ], repo)
  if (archive.code !== 0) throw new Error(`spex flat site: archiving the spec tree failed — ${archive.stderr.trim()}`)

  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  const asset = (path: string) => { const bytes = readFileSync(join(site, path)); return { path, bytes: bytes.byteLength, sha256: sha256(bytes) } }
  const graphAsset = asset('public-graph.json')
  const archiveAsset = { ...asset(archiveName), name: archiveName }
  const documents = readdirSync(join(site, 'specs')).filter((name) => name.endsWith('.json')).sort()

  // The About panel's facts are the flat's own reading. A visitor should be able to see, without leaving the
  // page, that this tree was produced by a measured conversion and how complete that conversion actually was —
  // publishing the graph while hiding its coverage would present a partial flat as a finished one.
  const metadata = {
    schema: 'spexcode.public-spec-site/v1',
    // A repository link is offered only when the source is one a browser can follow. A local path rendered as
    // a link would promise a destination that does not exist for anyone but the person who ran the flat.
    publication: { id: root, ...(isUrl(record.source) ? { repository: { url: record.source } } : {}) },
    about: {
      title: `About this flat`,
      summary: 'A static, read-only view of a specification graph produced by Flatcode from the repository named below. It exposes committed spec intent and relationships only; sessions, issues, evaluations, settings, and write routes are absent.',
      facts: [
        { label: 'Source', value: record.source },
        // The panel renders the release revision itself; a second one here would read as two different commits.
        { label: 'Source revision', value: record.revision.slice(0, 12) },
        { label: 'Coverage', value: `${record.gate?.coverage ?? 0}% of ${record.gate?.governed ?? 0} governed source files` },
      ],
    },
    release: { revision: payload.revision, graph: graphAsset, archive: archiveAsset },
  }
  const metadataBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`)
  writeFileSync(join(site, 'public-graph-meta.json'), metadataBytes)

  writeFileSync(join(site, 'public-spec-release.json'), `${JSON.stringify({
    schema: 'spexcode.public-spec-release/v1',
    revision: payload.revision,
    publication: metadata.publication,
    graph: graphAsset,
    metadata: { path: 'public-graph-meta.json', bytes: metadataBytes.byteLength, sha256: sha256(metadataBytes) },
    archive: archiveAsset,
    documents: documents.map((name) => asset(`specs/${name}`)),
  }, null, 2)}\n`)

  log(`site: ${published.length} nodes at ${payload.revision.slice(0, 12)} → ${site}`)
  return { site, nodes: published.length }
}

// @@@ gallerySlug - the path a flat is served at. Derived from the SOURCE the flat read, never from the
// directory Flatcode happened to write into: two people flattening the same repository must land on the same
// slug, and a local `--out` name is an accident of one machine.
export function gallerySlug(source: string): string {
  const url = source.replace(/\.git$/, '').replace(/\/+$/, '')
  const forge = /^(?:https?:\/\/|git@|ssh:\/\/|git:\/\/)[^/:]+[:/](.+)$/.exec(url)
  const raw = forge ? forge[1] : basename(url)
  // Sanitize per SEGMENT, not over the whole string. The slug becomes a directory under the gallery root and
  // a path on a public host, and the source it comes from is attacker-controllable; treating it as one string
  // turns `../../etc/passwd` into `/-/etc/passwd`, which is absolute. Splitting first means a traversal
  // segment cannot survive as one: `..` sanitizes to empty and is dropped, as is any empty or dot segment.
  const segments = raw.split('/')
    .map((segment) => segment.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter((segment) => segment && segment !== '.' && segment !== '..')
  return segments.join('/') || 'flat'
}

export type GalleryEntry = {
  slug: string
  source: string
  revision: string
  coverage: number
  governed: number
  nodes: number
  passed: boolean
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The index is hand-written rather than another dashboard build: it is a LIST, not a graph, and giving it the
// graph bundle would ship a megabyte of react-flow to render eight links. Self-contained and theme-aware for
// the same reason every published artifact here is — it must survive on a static host with no build step.
export function galleryIndexHtml(entries: readonly GalleryEntry[]): string {
  const cards = entries.map((entry) => `      <a class="card" href="./${escapeHtml(entry.slug)}/">
        <h2>${escapeHtml(entry.slug)}</h2>
        <p class="src">${escapeHtml(entry.source)}</p>
        <dl>
          <div><dt>coverage</dt><dd>${entry.coverage}%${entry.passed ? '' : ' <span class="partial">partial</span>'}</dd></div>
          <div><dt>governed</dt><dd>${entry.governed} files</dd></div>
          <div><dt>nodes</dt><dd>${entry.nodes}</dd></div>
          <div><dt>revision</dt><dd><code>${escapeHtml(entry.revision.slice(0, 12))}</code></dd></div>
        </dl>
      </a>`).join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flatcode — software flattened into specs</title>
<!-- Inlined, because a static host with no favicon answers a 404 on every single visit. The mark is the
     name: a solid body above, flattened to a line below. -->
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%232f6f4f'/%3E%3Crect x='8' y='7' width='16' height='9' rx='1.5' fill='%23fff' opacity='.9'/%3E%3Crect x='6' y='21' width='20' height='3' rx='1.5' fill='%23fff'/%3E%3C/svg%3E">
<style>
  :root {
    --bg: #f7f7f5; --fg: #1a1a19; --muted: #6b6b66; --line: #dedcd6; --card: #fff; --accent: #2f6f4f;
  }
  :root:not([data-theme="light"]) { }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg: #17181a; --fg: #e6e6e3; --muted: #9a9a94; --line: #2c2e31; --card: #1e1f22; --accent: #7fbf9a;
  } }
  :root[data-theme="dark"] {
    --bg: #17181a; --fg: #e6e6e3; --muted: #9a9a94; --line: #2c2e31; --card: #1e1f22; --accent: #7fbf9a;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
  main { max-width: 60rem; margin: 0 auto; padding: 3rem 1.25rem 5rem; }
  header h1 { font-size: 1.5rem; margin: 0 0 .35rem; letter-spacing: -.01em; }
  header p { color: var(--muted); margin: 0 0 2.5rem; max-width: 42rem; }
  .grid { display: grid; gap: .875rem; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); }
  .card { display: block; padding: 1rem 1.1rem; background: var(--card); border: 1px solid var(--line);
          border-radius: .5rem; color: inherit; text-decoration: none; }
  .card:hover { border-color: var(--accent); }
  .card h2 { font-size: .95rem; margin: 0 0 .2rem; color: var(--accent); }
  .src { color: var(--muted); font-size: .78rem; margin: 0 0 .8rem; overflow-wrap: anywhere; }
  dl { margin: 0; display: grid; gap: .15rem; }
  dl div { display: flex; justify-content: space-between; gap: 1rem; font-size: .78rem; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  .partial { color: #b3762f; }
  footer { margin-top: 3rem; color: var(--muted); font-size: .78rem; }
  footer a { color: var(--accent); }
</style>
</head>
<body>
  <main>
    <header>
      <h1>Flatcode</h1>
      <p>Software flattened into specifications. Each entry is a read-only projection of one repository's
         <code>.spec</code> tree, produced by an agent and held to a measured gate: zero lint errors and a
         coverage floor over the repository's governed source.</p>
    </header>
    <div class="grid">
${cards}
    </div>
    <footer>Built with <a href="https://github.com/shuxueshuxue/spexcode">SpexCode</a> — <code>spex flat new &lt;repo&gt;</code>.</footer>
  </main>
</body>
</html>
`
}

export async function flatGallery(out: string, flatDirs: readonly string[], log: (line: string) => void = console.log): Promise<GalleryEntry[]> {
  if (!flatDirs.length) throw new Error('spex flat gallery: name at least one flat directory')
  const target = resolve(out)
  mkdirSync(target, { recursive: true })
  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  const entries: GalleryEntry[] = []
  const receipts: { slug: string; release: string; sha256: string }[] = []
  for (const dir of flatDirs) {
    const flat = resolve(dir)
    const recordPath = join(flat, 'flat.json')
    if (!existsSync(recordPath)) throw new Error(`spex flat gallery: ${flat} is not a flat — no flat.json`)
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as {
      source: string; revision: string; passed?: boolean; gate?: { coverage?: number; governed?: number }
    }
    const site = join(flat, 'site')
    if (!existsSync(join(site, 'index.html'))) {
      throw new Error(`spex flat gallery: ${flat} has no site — run \`spex flat site ${dir}\` first`)
    }
    const slug = gallerySlug(record.source)
    const dest = join(target, slug)
    mkdirSync(dest, { recursive: true })
    cpSync(site, dest, { recursive: true })
    const graph = JSON.parse(readFileSync(join(dest, 'public-graph.json'), 'utf8')) as { nodes: unknown[] }
    entries.push({
      slug,
      source: record.source,
      revision: record.revision,
      coverage: record.gate?.coverage ?? 0,
      governed: record.gate?.governed ?? 0,
      nodes: graph.nodes.length,
      passed: record.passed === true,
    })
    const release = join(dest, 'public-spec-release.json')
    receipts.push({ slug, release: `${slug}/public-spec-release.json`, sha256: sha256(readFileSync(release)) })
    log(`  ${slug} — ${graph.nodes.length} nodes, ${record.gate?.coverage ?? 0}% of ${record.gate?.governed ?? 0} governed`)
  }
  entries.sort((a, b) => a.slug.localeCompare(b.slug))
  receipts.sort((a, b) => a.slug.localeCompare(b.slug))
  writeFileSync(join(target, 'index.html'), galleryIndexHtml(entries))
  // The manifest is what makes a publish auditable: it names every entry and hashes each flat's own release
  // manifest, so what landed on a host can be compared with what was built without trusting the transport.
  writeFileSync(join(target, 'gallery.json'), `${JSON.stringify({
    schema: 'spexcode.flat-gallery/v1',
    entries: entries.map((entry) => ({ ...entry })),
    releases: receipts,
  }, null, 2)}\n`)
  log(`gallery: ${entries.length} flat(s) → ${target}`)
  return entries
}

export async function runFlat(argv: readonly string[]): Promise<number> {
  const sub = argv[0]
  const { commandHelp } = await import('./help.js')
  if (sub === undefined || sub === '--help' || sub === '-h') { console.log(commandHelp('flat')); return sub === undefined ? 0 : 0 }
  if (sub === 'site') {
    const dir = argv[1]
    if (!dir || argv.length !== 2) { console.error('usage: spex flat site <flat-dir>'); return 2 }
    try {
      await flatSite(dir)
      return 0
    } catch (error) { console.error((error as Error).message); return 1 }
  }
  if (sub === 'gallery') {
    const rest = argv.slice(1)
    const at = rest.indexOf('--out')
    const out = at >= 0 ? rest[at + 1] : undefined
    const dirs = rest.filter((token, index) => token !== '--out' && !(at >= 0 && index === at + 1))
    if (!out || !dirs.length) { console.error('usage: spex flat gallery --out <dir> <flat-dir>…'); return 2 }
    try {
      await flatGallery(out, dirs)
      return 0
    } catch (error) { console.error((error as Error).message); return 1 }
  }
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
