import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { HARNESSES, MISSING_DEFAULT_LAUNCHER_ERROR, defaultLauncher, harnessById, launcherList, resolveLauncher, type Harness } from './harness.js'

const PKG = fileURLToPath(new URL('..', import.meta.url))
const SPEX = join(PKG, 'bin', 'spex.mjs')

// The branch Flatcode commits the spec tree onto inside its OWN clone. Never pushed: the flat is a reading of
// the repository, not a change to it, and a user who wants it upstream opens that as their own change.
export const FLAT_BRANCH = 'flatcode'
const DEFAULT_ROUNDS = 6
const DEFAULT_COVERAGE = 90

// A Flatcode run begins outside the target repository, so an installed CLI cannot rely on that directory
// already having SpexCode launcher profiles. These are the regular local agent commands an operator can select
// at the boundary; an existing named launcher still wins and preserves its configured command.
export const FLAT_AGENT_CHOICES = [
  { name: 'claude', label: 'Claude Code', harness: 'claude', cmd: 'claude' },
  { name: 'codex', label: 'Codex', harness: 'codex', cmd: 'codex' },
  { name: 'opencode', label: 'OpenCode', harness: 'opencode', cmd: 'opencode' },
  { name: 'pi', label: 'Pi', harness: 'pi', cmd: 'pi' },
] as const

// @@@ prose language - a spec is written FOR the people who maintain the repository, and for most of the
// world that is not English. The language governs the prose only: node ids are directory names, which
// [[id-url-safe]] holds to a URL-safe ASCII form, so a tree written in Chinese still has ascii-kebab ids.
// Unlisted codes pass through verbatim, so `--lang "Brazilian Portuguese"` works without a table entry.
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  zh: '简体中文 (Simplified Chinese)', 'zh-cn': '简体中文 (Simplified Chinese)',
  'zh-tw': '繁體中文 (Traditional Chinese)', en: 'English', ja: '日本語 (Japanese)',
  ko: '한국어 (Korean)', fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese', ru: 'Russian',
}
export const languageName = (code: string) => LANGUAGE_NAMES[code.toLowerCase()] ?? code

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

// The prose language is stated as its own paragraph rather than folded into the task, because it applies to
// every node and the one thing it must NOT touch is the ids.
const languageClause = (lang: string | undefined): string[] => lang && lang.toLowerCase() !== 'en' ? [
  ``,
  `WRITE THE SPEC PROSE IN ${languageName(lang)}. That means every node's \`title\`, \`desc\` and body — the`,
  `whole tree reads in that language, not a translation layer over English.`,
  `Node IDS STAY lowercase ascii-kebab (they are directory names and part of URLs), and so do the file paths`,
  `in \`code:\`/\`related:\` and the \`[[id]]\` mentions that point at them.`,
] : []

function surveyPrompt(profile: FlatProfile, coverageFloor: number, lang?: string): string {
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
    ...languageClause(lang),
    ``,
    `You will be measured, and you will be told what failed:`,
    `  - \`spex spec lint\` must report ZERO errors.`,
    `  - Coverage must reach ${coverageFloor}% of governed source files.`,
    `  - \`spex doctor\` must not find nodes that dumped mechanics instead of stating intent.`,
    ``,
    `Run those yourself as you go. Commit nothing; the driver commits.`,
  ].join('\n')
}

function repairPrompt(gate: FlatGate, doctor: string, coverageFloor: number, lang?: string): string {
  const lines = [
    `Continue flattening this repository. The gate was measured and it did NOT pass. Fix exactly what follows.`,
    ...languageClause(lang),
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

type FlatTurnHarness = { harness: Harness; cmd: string; name: string; harnessId: string }

function configuredTurnHarness(name: string, root: string): FlatTurnHarness {
  const chosen = resolveLauncher(name, root)
  const harness = harnessById(chosen.harness)
  if (!harness.oneShotTurn) {
    const capable = HARNESSES.filter((candidate) => candidate.oneShotTurn).map((candidate) => candidate.id).join(', ')
    throw new Error(
      `spex flat: launcher '${name}' runs harness '${harness.id}', which has no non-interactive turn, so it ` +
      `cannot run a conversion round. Harnesses that can: ${capable}. Pick a launcher on one of those with --launcher.`,
    )
  }
  return { harness, cmd: chosen.cmd, name, harnessId: harness.id }
}

function builtinTurnHarness(name: string): FlatTurnHarness | null {
  const choice = FLAT_AGENT_CHOICES.find((candidate) => candidate.name === name)
  if (!choice) return null
  const harness = harnessById(choice.harness)
  if (!harness.oneShotTurn) return null
  return { harness, cmd: choice.cmd, name: choice.name, harnessId: choice.harness }
}

// The launcher IS the choice, exactly as it is for a session ([[launcher-select]]) when the caller has a
// project config. Flatcode also works as a global command from an unrelated directory, where no launcher
// registry exists yet: a regular agent name then names both its one-shot runner and the harness that init
// persists in the clone. There is no implicit fallback because a non-interactive run must never guess auth.
function resolveTurnHarness(launcher: string | undefined, root: string): FlatTurnHarness {
  if (launcher) {
    const configured = launcherList(root)
    if (configured.some((candidate) => candidate.name === launcher)) return configuredTurnHarness(launcher, root)
    const builtin = builtinTurnHarness(launcher)
    if (builtin) return builtin
    if (configured.length) return configuredTurnHarness(launcher, root)
    throw new Error(`spex flat: unknown launcher '${launcher}'. Choose one of: ${FLAT_AGENT_CHOICES.map((choice) => choice.name).join(', ')}.`)
  }
  return configuredTurnHarness(defaultLauncher(root), root)
}

async function chooseTurnHarness(root: string, stdin: NodeJS.ReadStream = process.stdin, stdout: NodeJS.WriteStream = process.stdout): Promise<FlatTurnHarness> {
  try {
    return resolveTurnHarness(undefined, root)
  } catch (error) {
    if ((error as Error).message !== MISSING_DEFAULT_LAUNCHER_ERROR) throw error
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(`spex flat: no configured launcher in ${root}. Pass --launcher <name> (${FLAT_AGENT_CHOICES.map((choice) => choice.name).join(', ')}).`)
  }
  stdout.write('Choose the agent that will convert this repository:\n')
  for (const [index, choice] of FLAT_AGENT_CHOICES.entries()) stdout.write(`  ${index + 1}. ${choice.label}\n`)
  const prompt = createInterface({ input: stdin, output: stdout })
  try {
    const answer = (await prompt.question('Agent [1]: ')).trim() || '1'
    const position = Number(answer)
    const choice = Number.isInteger(position) ? FLAT_AGENT_CHOICES[position - 1] : undefined
    if (!choice) throw new Error(`spex flat: expected a number from 1 to ${FLAT_AGENT_CHOICES.length}`)
    return builtinTurnHarness(choice.name)!
  } finally {
    prompt.close()
  }
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
  lang?: string
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

export async function flatNew(
  options: FlatOptions,
  log: (line: string) => void = console.log,
  choose: (root: string) => Promise<FlatTurnHarness> = chooseTurnHarness,
): Promise<FlatResult> {
  const rounds = options.rounds ?? DEFAULT_ROUNDS
  const coverageFloor = options.coverage ?? DEFAULT_COVERAGE
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error('spex flat: --rounds must be a positive integer')
  if (!Number.isFinite(coverageFloor) || coverageFloor < 0 || coverageFloor > 100) throw new Error('spex flat: --coverage must be between 0 and 100')

  const name = basename(options.target.replace(/\.git$/, '').replace(/\/+$/, '')) || 'flat'

  // --- acquire -------------------------------------------------------------------------------------------
  // A local repository IS the intended home for its .spec tree. Flatcode only adds that governed intent; it
  // never makes a throwaway copy of a repository the caller already has, and it refuses dirty state so its
  // commits cannot accidentally absorb unrelated work. A remote URL has no such home, so it remains isolated
  // in <out>/repo.
  let source = options.target
  let local: string | null = null
  if (!isUrl(options.target)) {
    local = resolve(options.target)
    if (!existsSync(join(local, '.git'))) throw new Error(`spex flat: ${local} is not a git repository`)
    const dirty = await gitOrThrow(['status', '--porcelain'], local, 'reading the working tree')
    if (dirty) throw new Error(`spex flat: ${local} has uncommitted changes — Flatcode commits a spec tree and will not mix it with work it did not write`)
    source = local
  }
  const out = resolve(options.out ?? (local ? join(dirname(local), `${basename(local)}.flat`) : `${name}.flat`))
  const outputInsideSource = local && (() => {
    const fromSource = relative(local, out)
    return !fromSource || (!fromSource.startsWith(`..${sep}`) && fromSource !== '..' && !isAbsolute(fromSource))
  })()
  if (outputInsideSource) throw new Error(`spex flat: ${out} is inside ${local}; Flatcode's reading must stay beside the source repository`)
  const repo = local ?? join(out, 'repo')
  const configPath = join(repo, 'spexcode.json')
  const initialized = Boolean(local && existsSync(join(repo, '.spec')) && existsSync(configPath))
  if (local && existsSync(out)) {
    const previous = join(out, 'flat.json')
    const recorded = existsSync(previous) ? JSON.parse(readFileSync(previous, 'utf8')) as { repo?: unknown } : null
    if (recorded?.repo !== local) throw new Error(`spex flat: ${out} already exists for another purpose — name a different --out`)
  }
  if (!local && existsSync(repo)) throw new Error(`spex flat: ${repo} already exists — name a different --out or remove it`)

  // An existing SpexCode project names its own local launcher. A new local repository and a remote conversion
  // inherit the launch boundary from the calling directory, whose configuration is the only one available yet.
  const launcherRoot = local && existsSync(configPath) ? local : process.cwd()
  const { harness, cmd, name: launcherName, harnessId } = options.launcher
    ? resolveTurnHarness(options.launcher, launcherRoot)
    : await choose(launcherRoot)

  if (local) {
    log(`using local ${local}`)
  } else {
    mkdirSync(out, { recursive: true })
    log(`cloning ${options.target}`)
    const clone = await run('git', ['clone', '--quiet', options.target, repo], out)
    if (clone.code !== 0) throw new Error(`spex flat: clone failed — ${clone.stderr.trim()}`)
    await gitOrThrow(['checkout', '--quiet', '-b', FLAT_BRANCH], repo, `creating the ${FLAT_BRANCH} branch`)
  }
  const revision = await gitOrThrow(['rev-parse', 'HEAD'], repo, 'reading the cloned revision')

  // --- profile -------------------------------------------------------------------------------------------
  const tracked = (await gitOrThrow(['ls-files'], repo, 'listing tracked files')).split('\n').filter(Boolean)
  const proposed = profileFiles(tracked)
  if (!proposed.fileCount) {
    throw new Error(
      `spex flat: no recognised source files in ${source}. Flatcode governs a fixed allowlist of source ` +
      `extensions; a repository outside it would gate on an empty governed set, which passes vacuously.`,
    )
  }
  // --- seed or resume ------------------------------------------------------------------------------------
  // An initialized local project already has a .spec tree, policy, and launcher choice. It is not a fresh
  // adopter merely because Flatcode has not run there: preserve those choices exactly and let the gate tell
  // the agent what remains. Every other target receives the ordinary adoption seed before its first turn.
  const writeConfig = (chosen: FlatProfile) => {
    const existing = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {}
    writeFileSync(configPath, `${JSON.stringify({
      ...existing,
      // Name the graph after the repository it reads, not after Flatcode's checkout directory — otherwise every
      // flat in the world renders under the title "repo".
      dashboard: { title: name, ...(existing.dashboard ?? {}) },
      lint: { ...(existing.lint ?? {}), governedRoots: chosen.governedRoots, sourceExtensions: chosen.sourceExtensions },
    }, null, 2)}\n`)
  }
  let gate: FlatGate
  let profile: FlatProfile
  if (initialized) {
    gate = await gateOf(repo)
    profile = profileFiles(gate.sourceFiles)
    log(`resuming existing .spec · launcher ${launcherName} (${harness.id})`)
  } else {
    const init = await spex(['init', '--harness', harnessId], repo)
    if (init.code !== 0) throw new Error(`spex flat: seeding .spec failed — ${init.stderr.trim() || init.stdout.trim()}`)
    log(`seeded .spec · launcher ${launcherName} (${harness.id})`)

    // Init must run before the profile write. A fresh clone has no config, and init is the one operation that
    // seeds the selected harness plus its matching named launcher. Writing a partial config first made init
    // preserve that file, leaving the clone with a harness target but no launcher profile for the agent it used.
    writeConfig(proposed)
    await commit(repo, 'flatcode: profile and seed .spec', ['.spec', 'spexcode.json'])
    gate = await gateOf(repo)
    profile = confirmProfile(proposed, gate.sourceFiles)
    const dropped = proposed.governedRoots.filter((root) => !profile.governedRoots.includes(root))
    if (dropped.length) {
      writeConfig(profile)
      await commit(repo, `flatcode: narrow governed roots to ${profile.governedRoots.join(', ')}`, ['spexcode.json'])
      gate = await gateOf(repo)
      log(`dropped ${dropped.join(', ')} — lint's source policy governs nothing there`)
    }
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
    const prompt = round === 1 ? surveyPrompt(profile, coverageFloor, options.lang) : repairPrompt(gate, doctor, coverageFloor, options.lang)
    log(`round ${round}/${rounds} — coverage ${gate.coverage}% · ${gate.errors} lint error(s)`)
    const before = await gitOrThrow(['rev-parse', 'HEAD'], repo, 'recording the round start')
    const beforeUntracked = new Set((await gitOrThrow(['ls-files', '--others', '--exclude-standard'], repo, 'recording untracked files')).split('\n').filter(Boolean))
    const code = await runTurn(harness.oneShotTurn!(prompt, cmd), repo)
    if (code !== 0) log(`round ${round}: the agent turn exited ${code}; measuring anyway`)
    const after = await gitOrThrow(['rev-parse', 'HEAD'], repo, 'reading the agent round')
    if (after !== before) await gitOrThrow(['reset', '--soft', before], repo, 'taking ownership of the agent commit')
    await assertOnlyFlatChanges(repo, before, beforeUntracked)
    await commit(repo, `flatcode: round ${round}`, ['.spec'])
    gate = await gateOf(repo)
  }

  const passed = gatePassed(gate, coverageFloor)
  mkdirSync(out, { recursive: true })
  const result: FlatResult = { out, repo, source, revision, rounds: round, gate, passed, profile }
  writeFileSync(join(out, 'flat.json'), `${JSON.stringify({
    schema: 'spexcode.flat/v1', repo,
    source, revision, branch: FLAT_BRANCH, launcher: launcherName, harness: harness.id,
    rounds: round, roundBudget: rounds, coverageFloor, passed, lang: options.lang ?? 'en',
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
  const record = JSON.parse(readFileSync(recordPath, 'utf8')) as { repo?: string; source: string; revision: string; gate?: { coverage?: number; governed?: number } }
  const repo = record.repo && existsSync(record.repo) ? record.repo : join(out, 'repo')
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
  languages: readonly string[]
  lang: string
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The colours developers already read a language by. Anything unlisted gets the neutral dot rather than a
// guessed hue — a wrong-but-confident colour is worse than none.
const LANGUAGE_DOT: Readonly<Record<string, string>> = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572a5', Go: '#00add8', Rust: '#dea584',
  Ruby: '#701516', Java: '#b07219', Kotlin: '#a97bff', Swift: '#f05138', C: '#555555', 'C++': '#f34b7d',
  'C#': '#178600', PHP: '#4f5d95', Scala: '#c22d40', Elixir: '#6e4a7e', Erlang: '#b83998',
  Haskell: '#5e5086', OCaml: '#ef7a08', Clojure: '#db5855', Lua: '#000080', Dart: '#00b4ab',
  Vue: '#41b883', Svelte: '#ff3e00', Shell: '#89e051', Zig: '#ec915c',
}

// The index is hand-written rather than another dashboard build: it is a LIST, not a graph, and giving it the
// graph bundle would ship a megabyte of react-flow to render eight links. Self-contained and theme-aware for
// the same reason every published artifact here is — it must survive on a static host with no build step.
export function galleryIndexHtml(entries: readonly GalleryEntry[]): string {
  const cards = entries.map((entry) => {
    const [owner, name] = entry.slug.includes('/') ? [entry.slug.split('/')[0], entry.slug.split('/').slice(1).join('/')] : ['', entry.slug]
    const langs = entry.languages.map((language) => `<span class="lang"><i style="background:${LANGUAGE_DOT[language] ?? '#6b7280'}"></i>${escapeHtml(language)}</span>`).join('')
    return `      <a class="card" href="./${escapeHtml(entry.slug)}/">
        <div class="card-top">
          <h3>${owner ? `<span class="owner">${escapeHtml(owner)}/</span>` : ''}${escapeHtml(name)}</h3>
          <svg class="go" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="langs">${langs}</div>
        <div class="stats">
          <span><b>${entry.nodes}</b> 个节点</span>
          <span><b>${entry.governed}</b> 个文件</span>
          <span class="${entry.passed ? 'ok' : 'partial'}">${entry.coverage}% 覆盖${entry.passed ? '' : '（部分）'}</span>
        </div>
        <div class="rev"><code>${escapeHtml(entry.revision.slice(0, 12))}</code></div>
      </a>`
  }).join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flatcode 软件二向箔 | 代码库说明</title>
<meta name="description" content="Flatcode 为代码库生成 .spec 说明，并检查说明的结构和源码覆盖情况。">
<!-- Inlined, because a static host with no favicon answers a 404 on every single visit. The mark is the
     name: a solid body above, flattened to a line below. -->
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2310b981'/%3E%3Crect x='8' y='7' width='16' height='9' rx='2' fill='%23041b12' opacity='.75'/%3E%3Crect x='6' y='21' width='20' height='3.5' rx='1.75' fill='%23041b12'/%3E%3C/svg%3E">
<style>
  /* Committed to dark on purpose: the graph pages a visitor clicks into are dark, and a light shell handing
     off to a dark app is the seam that makes a site feel assembled rather than made. Every colour is painted
     explicitly so nothing inherits the host's theme. */
  :root {
    --bg: #08090b; --panel: #0e1013; --line: #1c1f24; --line-hi: #2b3038;
    --fg: #f2f3f5; --muted: #9096a1; --dim: #6b7280;
    --accent: #10b981; --accent-soft: #34d399;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    --sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue",
            "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--fg); font-family: var(--sans);
    font-size: 16px; line-height: 1.6; -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 68rem; margin: 0 auto; padding: 0 1.5rem; }

  nav { display: flex; align-items: center; justify-content: space-between; padding: 1.5rem 0; }
  .brand { display: flex; align-items: center; gap: .6rem; font-weight: 600; }
  .brand svg { display: block; }
  .nav-links { display: flex; align-items: center; gap: .5rem; }
  nav a.ghost {
    display: inline-flex; align-items: center; gap: .4rem;
    color: var(--muted); text-decoration: none; font-size: .875rem; padding: .45rem .85rem;
    border: 1px solid var(--line); border-radius: 8px; transition: border-color .15s, color .15s;
  }
  nav a.ghost.icon { padding: .45rem .6rem; }
  nav a.ghost:hover { color: var(--fg); border-color: var(--line-hi); }

  header.hero {
    position: relative; isolation: isolate; overflow: hidden; min-height: min(33rem, calc(100vh - 9rem));
    margin: 0 calc(50% - 50vw) 4rem; padding: 6rem max(1.5rem, calc((100vw - 68rem) / 2)); display: flex;
    align-items: center; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
  }
  .hero-image { position: absolute; z-index: -2; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center; }
  .hero-shade { position: absolute; z-index: -1; inset: 0; background: rgba(4, 6, 7, .56); }
  .hero-content { max-width: 38rem; }
  .eyebrow {
    font-size: .8125rem; color: var(--accent-soft); margin-bottom: 1.25rem;
  }
  h1 {
    font-size: 4.25rem; line-height: 1.02;
    font-weight: 620; margin: 0 0 1.25rem;
  }
  h1 em { font-style: normal; color: var(--accent-soft); }
  .lede { font-size: 1.125rem; color: #c0c5cc; margin: 0; max-width: 35rem; }

  section.onboarding { padding-bottom: 4.5rem; }
  .section-label { color: var(--accent-soft); font-family: var(--mono); font-size: .75rem; margin: 0 0 .6rem; }
  .section-intro { max-width: 39rem; color: var(--muted); margin: 0 0 2.25rem; }
  .setup-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .setup-step { min-height: 15rem; padding: 1.5rem 1.25rem 1.75rem 0; border-right: 1px solid var(--line); }
  .setup-step + .setup-step { padding-left: 1.25rem; }
  .setup-step:last-child { border-right: 0; }
  .setup-step h3 { margin: 0 0 .5rem; font-size: 1rem; font-weight: 600; }
  .setup-step p { color: var(--muted); font-size: .875rem; margin: .8rem 0 0; }
  .step-number { color: var(--dim); font-family: var(--mono); font-size: .75rem; display: block; margin-bottom: .6rem; }
  .agent-choice { display: block; color: var(--muted); font-size: .8125rem; margin-bottom: .45rem; }
  .agent-choice select {
    width: 100%; min-height: 2.6rem; color: var(--fg); background: var(--panel); border: 1px solid var(--line-hi);
    border-radius: 6px; padding: .45rem .65rem; font: inherit;
  }
  .command-row { display: flex; align-items: center; gap: .5rem; margin-top: .85rem; }
  .cmd {
    display: flex; align-items: center; gap: .5rem; background: var(--panel); border: 1px solid var(--line);
    border-radius: 8px; padding: .75rem .8rem; font-family: var(--mono); font-size: .8125rem;
    min-width: 0; flex: 1; text-align: left;
  }
  .cmd .prompt { color: var(--accent); user-select: none; }
  .cmd code { color: var(--fg); white-space: nowrap; overflow-x: auto; flex: 1; }
  .copy-button {
    flex: none; width: 2.5rem; height: 2.5rem; display: inline-grid; place-items: center; background: var(--panel);
    border: 1px solid var(--line); border-radius: 6px; color: var(--muted); cursor: pointer;
    transition: color .15s, border-color .15s;
  }
  .copy-button:hover { color: var(--fg); border-color: var(--line-hi); }
  .copy-button svg { width: 1rem; height: 1rem; }

  section.gallery { padding-bottom: 6rem; }
  .sec-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 1.5rem; }
  .sec-head h2 { font-size: 1.0625rem; font-weight: 600; margin: 0; }
  .sec-head span { color: var(--dim); font-size: .875rem; }

  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr)); }
  .card {
    display: block; padding: 1.25rem; background: var(--panel); border: 1px solid var(--line);
    border-radius: 8px; color: inherit; text-decoration: none;
    transition: border-color .18s, transform .18s, background .18s;
  }
  .card:hover { border-color: var(--line-hi); background: #12151a; transform: translateY(-2px); }
  .card:hover .go { color: var(--accent-soft); transform: translateX(2px); }
  .card-top { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .card h3 { margin: 0; font-size: 1rem; font-weight: 600; overflow-wrap: anywhere; }
  .card .owner { color: var(--dim); font-weight: 400; }
  .go { color: var(--dim); flex: none; transition: color .18s, transform .18s; }
  .langs { display: flex; flex-wrap: wrap; gap: .5rem; margin: .85rem 0 1rem; }
  .lang { display: inline-flex; align-items: center; gap: .35rem; font-size: .75rem; color: var(--muted); }
  .lang i { width: .5rem; height: .5rem; border-radius: 50%; display: inline-block; }
  .stats { display: flex; flex-wrap: wrap; gap: .9rem; font-size: .8125rem; color: var(--muted); }
  .stats b { color: var(--fg); font-weight: 600; }
  .stats .ok { color: var(--accent-soft); }
  .stats .partial { color: #fbbf24; }
  .rev { margin-top: .8rem; font-family: var(--mono); font-size: .6875rem; color: #4b5563; }

  footer { border-top: 1px solid var(--line); padding: 2rem 0 3.5rem; color: var(--dim); font-size: .875rem; }
  footer a { color: var(--muted); text-decoration: none; }
  footer a:hover { color: var(--fg); }
  @media (max-width: 640px) {
    nav { padding: 1rem 0; }
    nav a.ghost { padding: .4rem .55rem; }
    header.hero { min-height: 29rem; margin-bottom: 3rem; padding-top: 4rem; padding-bottom: 3rem; }
    .hero-image { object-position: 66% center; }
    .hero-shade { background: rgba(4, 6, 7, .66); }
    h1 { font-size: 2.625rem; }
    .lede { font-size: 1rem; }
    .setup-grid { grid-template-columns: 1fr; }
    .setup-step, .setup-step + .setup-step { min-height: 0; padding: 1.4rem 0; border-right: 0; border-bottom: 1px solid var(--line); }
    .setup-step:last-child { border-bottom: 0; }
    .cmd { font-size: .75rem; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <div class="brand">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#10b981"/><rect x="8" y="7" width="16" height="9" rx="2" fill="#041b12" opacity=".75"/><rect x="6" y="21" width="20" height="3.5" rx="1.75" fill="#041b12"/></svg>
      Flatcode
    </div>
    <div class="nav-links">
      <a class="ghost" href="https://spexcode.net/zh/flatcode/">文档</a>
      <a class="ghost icon" href="https://github.com/shuxueshuxue/spexcode" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
      </a>
    </div>
  </nav>
</div>

  <header class="hero">
    <img class="hero-image" src="./flatcode-banner.webp" alt="代码库整理为规格图谱">
    <div class="hero-shade"></div>
    <div class="hero-content">
      <div class="eyebrow">软件二向箔，基于 SpexCode</div>
      <h1>代码库的<em>职责说明</em>。</h1>
      <p class="lede">
        Flatcode 分析一个仓库，为其中的功能和模块生成 .spec 说明。
        它会检查说明的结构和对源码的覆盖情况，未通过检查的结果会标为部分完成。
      </p>
    </div>
  </header>

<div class="wrap">
  <section class="onboarding" aria-labelledby="start-title">
    <p class="section-label">开始转换</p>
    <h2 id="start-title">安装后选择本机 agent</h2>
    <p class="section-intro">只需安装一次。仓库 URL 会被克隆并初始化；本地仓库则直接补全 .spec，已有设置会保留。</p>
    <div class="setup-grid">
      <div class="setup-step">
        <span class="step-number">01</span>
        <h3>安装 SpexCode</h3>
        <div class="cmd"><span class="prompt">$</span><code>npm i -g spexcode</code></div>
        <p>需要 Node 22 或更高版本和 git。</p>
      </div>
      <div class="setup-step">
        <span class="step-number">02</span>
        <h3>选择 agent</h3>
        <label class="agent-choice" for="agent">用于读取源码和生成说明</label>
        <select id="agent" name="agent">
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
          <option value="opencode">OpenCode</option>
          <option value="pi">Pi</option>
        </select>
        <p>也可以在终端直接运行命令后再选择。</p>
      </div>
      <div class="setup-step">
        <span class="step-number">03</span>
        <h3>转换仓库</h3>
        <div class="command-row">
          <div class="cmd"><span class="prompt">$</span><code id="cmd">spex flat new https://github.com/owner/repo --launcher claude</code></div>
          <button type="button" class="copy-button" id="copy" aria-label="复制命令" title="复制命令">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
        <p>URL 的结果放在独立目录；本地仓库只会提交 .spec，不会推送。</p>
      </div>
    </div>
  </section>

  <section class="gallery">
    <div class="sec-head">
      <h2>已生成说明的仓库</h2>
      <span>${entries.length} 个</span>
    </div>
    <div class="grid">
${cards}
    </div>
  </section>

  <footer>
    由 <a href="https://github.com/shuxueshuxue/spexcode" target="_blank" rel="noopener noreferrer">SpexCode</a> 构建。
    <a href="https://spexcode.net/zh/flatcode/">文档</a>。
    本站仅显示已提交的 spec，不显示会话，也不提供写入功能。
  </footer>
</div>
<script>
  var command = document.getElementById('cmd')
  var agent = document.getElementById('agent')
  agent.addEventListener('change', function () {
    command.textContent = 'spex flat new https://github.com/owner/repo --launcher ' + agent.value
  })
  document.getElementById('copy').addEventListener('click', function () {
    var text = command.textContent
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text)
  })
</script>
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
      source: string; revision: string; passed?: boolean
      lang?: string
      gate?: { coverage?: number; governed?: number }
      profile?: { languages?: string[] }
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
      languages: record.profile?.languages ?? [],
      lang: record.lang ?? 'en',
    })
    const release = join(dest, 'public-spec-release.json')
    receipts.push({ slug, release: `${slug}/public-spec-release.json`, sha256: sha256(readFileSync(release)) })
    log(`  ${slug} — ${graph.nodes.length} nodes, ${record.gate?.coverage ?? 0}% of ${record.gate?.governed ?? 0} governed`)
  }
  // @@@ order - a tree written in the reader's own language goes first. The site defaults to Chinese, so a
  // Chinese-prose flat is the one that demonstrates the product to the visitor it is aimed at; an English tree
  // shown first makes the whole page look like a translation of somebody else's thing.
  const rank = (entry: GalleryEntry) => (entry.lang.toLowerCase().startsWith('zh') ? 0 : entry.lang.toLowerCase() === 'en' ? 2 : 1)
  entries.sort((a, b) => rank(a) - rank(b) || a.slug.localeCompare(b.slug))
  receipts.sort((a, b) => a.slug.localeCompare(b.slug))
  copyFileSync(join(PKG, 'src', 'flatcode-banner.webp'), join(target, 'flatcode-banner.webp'))
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
  const known = new Set(['out', 'launcher', 'rounds', 'coverage', 'lang'])
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
      lang: flags.get('lang'),
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
// The gate reading, not the commit hook, is what decides whether this flat converged. The path list is also
// the write boundary for an adopted local repository: Flatcode owns intent, never the source it describes.
async function commit(repo: string, message: string, paths: readonly string[]): Promise<void> {
  await git(['add', '--', ...paths], repo)
  const staged = await git(['diff', '--cached', '--quiet'], repo)
  if (staged.code === 0) return
  const result = await run('git', ['-c', 'user.name=Flatcode', '-c', 'user.email=flatcode@spexcode.invalid', 'commit', '--quiet', '--no-verify', '-m', message], repo)
  if (result.code !== 0) throw new Error(`spex flat: committing "${message}" failed — ${result.stderr.trim()}`)
}

async function assertOnlyFlatChanges(repo: string, before: string, beforeUntracked: ReadonlySet<string>): Promise<void> {
  const readings = await Promise.all([
    gitOrThrow(['diff', '--name-only', `${before}..`], repo, 'checking committed agent changes'),
    gitOrThrow(['diff', '--name-only'], repo, 'checking unstaged agent changes'),
    gitOrThrow(['diff', '--cached', '--name-only'], repo, 'checking staged agent changes'),
    gitOrThrow(['ls-files', '--others', '--exclude-standard'], repo, 'checking untracked agent changes'),
  ])
  const changed = [...new Set(readings.flatMap((reading, index) => reading.split('\n').filter((path) =>
    Boolean(path) && (index !== 3 || !beforeUntracked.has(path)),
  )))]
  const forbidden = changed.filter((path) => path !== '.spec' && !path.startsWith('.spec/'))
  if (forbidden.length) {
    // The repository was clean before the round. Resetting to that exact revision leaves the agent's .spec
    // edits in the working tree, then restoring only baseline non-spec paths erases every source/config edit
    // the agent made, including ones it committed itself. New non-spec paths did not exist at the boundary and
    // are removed by their exact git-reported names. A rejected round therefore cannot leave source changes
    // behind under the misleading name of a documentation run.
    const baseline = new Set((await gitOrThrow(['ls-tree', '-r', '--name-only', before], repo, 'reading the round baseline')).split('\n').filter(Boolean))
    await gitOrThrow(['reset', '--mixed', before], repo, 'discarding the agent commit')
    for (const path of forbidden) {
      if (baseline.has(path)) {
        await gitOrThrow(['checkout', before, '--', path], repo, `restoring ${path}`)
        continue
      }
      const target = resolve(repo, path)
      if (!target.startsWith(`${repo}${sep}`)) throw new Error(`spex flat: invalid agent path ${JSON.stringify(path)}`)
      rmSync(target, { force: true, recursive: true })
    }
    throw new Error(`spex flat: the agent changed files outside .spec (${forbidden.join(', ')}). Flatcode discarded those changes and will not commit them.`)
  }
}
