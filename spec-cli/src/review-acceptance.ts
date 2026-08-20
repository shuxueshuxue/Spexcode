import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync, closeSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { git, mainBranch, mainRoot, readJsonConfig, runtimeRoot, type ReviewAcceptanceConfig, type ReviewFlakyConfig, type ReviewFlakyObservationConfig, type ReviewSuiteConfig } from '@spexcode/spec-core'

export type ReviewRun = {
  startedAt: string
  durationMs: number
  failures: string[]
  outcomes: Record<string, 'pass' | 'fail'>
  logPath: string
  logSha256: string
}

type RuntimeFingerprint = { platform: string; arch: string; node: string }
type BaselineCache = {
  schema: 1
  sha: string
  collectedAt: string
  configHash: string
  runtime: RuntimeFingerprint
  runs: ReviewRun[]
}

type FlakyDecision = {
  test: string
  active: boolean
  reason: string
}

type BaselineCollection = { sha: string; collectedAt: string; runs: number; flips: string[] }

export type ReviewAcceptanceResult = {
  ok: boolean
  configured: boolean
  report: string
  candidateSha?: string
  baseSha?: string
  candidateRuns?: number
  baseRuns?: number
  baselineCached?: boolean
  candidateOnly?: string[]
  exempted?: string[]
}

type AcceptanceOptions = {
  candidate?: string
  base?: string
  now?: Date
  onProgress?: (line: string) => void
}

const SHA = /^[0-9a-f]{40}$/
const DEFAULT_TIMEOUT_MS = 30 * 60_000
const LOCK_STALE_MS = 60 * 60_000

const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  }
  return value
}
const stable = (value: unknown): string => JSON.stringify(canonical(value))

function configError(message: string): never {
  const error = new Error(`review acceptance config: ${message}`)
  error.name = 'ConfigError'
  throw error
}

export function reviewAcceptanceConfig(root = process.cwd()): ReviewAcceptanceConfig | null {
  const raw: unknown = readJsonConfig(join(root, 'spexcode.json')).review
  if (raw == null) return null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) configError('review must be an object')
  const cfg = raw as Record<string, unknown>
  const runs = cfg.runs
  if (!Number.isSafeInteger(runs) || Number(runs) < 2) configError('review.runs must be an integer >= 2')
  const timeoutMs = cfg.timeoutMs == null ? undefined : Number(cfg.timeoutMs)
  if (timeoutMs != null && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)) configError('review.timeoutMs must be a positive integer')
  if (cfg.setup != null && (typeof cfg.setup !== 'string' || !cfg.setup.trim())) configError('review.setup must be a non-empty command')
  if (!Array.isArray(cfg.suites) || cfg.suites.length === 0) configError('review.suites must contain at least one command')
  const ids = new Set<string>()
  const suites = cfg.suites.map((row, index): ReviewSuiteConfig => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) configError(`review.suites[${index}] must be an object`)
    const suite = row as Record<string, unknown>
    if (typeof suite.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(suite.id)) configError(`review.suites[${index}].id must be a lowercase id`)
    if (ids.has(suite.id)) configError(`duplicate review suite id: ${suite.id}`)
    ids.add(suite.id)
    if (typeof suite.command !== 'string' || !suite.command.trim()) configError(`review suite ${suite.id} needs a command`)
    if (suite.format !== 'tap' && suite.format !== 'exit') configError(`review suite ${suite.id} format must be "tap" or "exit"`)
    const suiteTimeout = suite.timeoutMs == null ? undefined : Number(suite.timeoutMs)
    if (suiteTimeout != null && (!Number.isSafeInteger(suiteTimeout) || suiteTimeout < 1)) configError(`review suite ${suite.id} timeoutMs must be a positive integer`)
    return { id: suite.id, command: suite.command, format: suite.format, timeoutMs: suiteTimeout }
  })
  const flaky = cfg.flaky == null ? [] : cfg.flaky
  if (!Array.isArray(flaky)) configError('review.flaky must be an array')
  const flakyTests = new Set<string>()
  const parsedFlaky = flaky.map((row, index): ReviewFlakyConfig => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) configError(`review.flaky[${index}] must be an object`)
    const entry = row as Record<string, unknown>
    if (typeof entry.test !== 'string' || !entry.test.includes('::')) configError(`review.flaky[${index}].test must be suite::test`)
    if (flakyTests.has(entry.test)) configError(`duplicate flaky test: ${entry.test}`)
    flakyTests.add(entry.test)
    if (!Array.isArray(entry.observations) || entry.observations.length < 2) configError(`flaky ${entry.test} needs pass/fail observations`)
    const observations = entry.observations.map((item, observationIndex): ReviewFlakyObservationConfig => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) configError(`flaky ${entry.test} observation ${observationIndex} must be an object`)
      const observation = item as Record<string, unknown>
      if (typeof observation.sha !== 'string' || !SHA.test(observation.sha)) configError(`flaky ${entry.test} observation ${observationIndex} needs a full commit SHA`)
      if (typeof observation.observedAt !== 'string' || !Number.isFinite(Date.parse(observation.observedAt))) configError(`flaky ${entry.test} observation ${observationIndex} needs an ISO timestamp`)
      if (observation.outcome !== 'pass' && observation.outcome !== 'fail') configError(`flaky ${entry.test} observation ${observationIndex} outcome must be pass or fail`)
      if (typeof observation.source !== 'string' || !observation.source.trim()) configError(`flaky ${entry.test} observation ${observationIndex} needs a durable source reference`)
      return observation as ReviewFlakyObservationConfig
    })
    const sharedSha = observations[0].sha
    if (observations.some((item) => item.sha !== sharedSha) || !observations.some((item) => item.outcome === 'pass') || !observations.some((item) => item.outcome === 'fail')) {
      configError(`flaky ${entry.test} evidence must show pass and fail on the same SHA`)
    }
    try { git(['-C', root, 'cat-file', '-e', `${sharedSha}^{commit}`]) }
    catch { configError(`flaky ${entry.test} evidence SHA does not exist in this repository: ${sharedSha}`) }
    const days = Number(entry.expiresAfterDays)
    const collections = Number(entry.expiresAfterBaselineCollections)
    if (!Number.isSafeInteger(days) || days < 1) configError(`flaky ${entry.test} expiresAfterDays must be a positive integer`)
    if (!Number.isSafeInteger(collections) || collections < 1) configError(`flaky ${entry.test} expiresAfterBaselineCollections must be a positive integer`)
    return { test: entry.test, observations, expiresAfterDays: days, expiresAfterBaselineCollections: collections }
  })
  return { runs: Number(runs), setup: cfg.setup as string | undefined, timeoutMs, suites, flaky: parsedFlaky }
}

function runtimeFingerprint(): RuntimeFingerprint {
  return { platform: process.platform, arch: process.arch, node: process.version }
}

function configHash(cfg: ReviewAcceptanceConfig): string {
  return hash(stable({ runs: cfg.runs, setup: cfg.setup ?? null, timeoutMs: cfg.timeoutMs ?? null, suites: cfg.suites }))
}

function acceptanceRoot(root: string): string {
  return join(runtimeRoot(root), 'review-acceptance')
}

function resolveCommit(root: string, ref: string): string {
  const sha = git(['-C', root, 'rev-parse', '--verify', `${ref}^{commit}`]).trim()
  if (!SHA.test(sha)) throw new Error(`review acceptance could not resolve commit ${ref}`)
  return sha
}

function parseTap(suite: string, output: string): Record<string, 'pass' | 'fail'> {
  const outcomes: Record<string, 'pass' | 'fail'> = {}
  const line = /^\s*(not ok|ok)\s+\d+\s+-\s+(.+?)(?:\s+#\s+(?:SKIP|TODO).*)?$/
  for (const raw of output.split(/\r?\n/)) {
    const match = raw.match(line)
    if (!match || /\s+#\s+(?:SKIP|TODO)/.test(raw)) continue
    outcomes[`${suite}::${match[2]}`] = match[1] === 'ok' ? 'pass' : 'fail'
  }
  return outcomes
}

async function shell(command: string, cwd: string, timeoutMs: number, extraEnv: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string; timedOut: boolean }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
    child.once('error', reject)
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, output, timedOut })
    })
  })
}

function writeAtomic(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, value)
    renameSync(tmp, path)
  } finally { rmSync(tmp, { force: true }) }
}

async function collectRun(root: string, sha: string, cfg: ReviewAcceptanceConfig, run: number, role: 'candidate' | 'main', onProgress: (line: string) => void): Promise<ReviewRun> {
  const store = acceptanceRoot(root)
  const checkout = join(store, 'checkouts', `${role}-${sha.slice(0, 12)}-${process.pid}-${randomUUID()}`)
  const startedAt = new Date().toISOString()
  const started = Date.now()
  const chunks: string[] = [`review acceptance ${role} ${sha} run ${run}/${cfg.runs}\n`]
  const outcomes: Record<string, 'pass' | 'fail'> = {}
  const timeout = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS
  mkdirSync(dirname(checkout), { recursive: true })
  onProgress(`${role} ${sha.slice(0, 12)} run ${run}/${cfg.runs}: preparing exact checkout`)
  try {
    const added = await shell(`git worktree add --detach --force ${JSON.stringify(checkout)} ${sha}`, root, timeout, { SPEXCODE_DEFER_FOOTPRINT_REFRESH: 'session-create' })
    chunks.push(`\n$ git worktree add --detach ${checkout} ${sha}\n${added.output}`)
    if (added.code !== 0) outcomes['checkout::git worktree add'] = 'fail'
    if (added.code === 0 && cfg.setup) {
      const prepared = await shell(cfg.setup, checkout, timeout)
      chunks.push(`\n$ ${cfg.setup}\n${prepared.output}`)
      if (prepared.code !== 0) outcomes['setup::preparation command'] = 'fail'
    }
    if (!Object.values(outcomes).includes('fail')) {
      for (const suite of cfg.suites) {
        onProgress(`${role} ${sha.slice(0, 12)} run ${run}/${cfg.runs}: ${suite.id}`)
        const result = await shell(suite.command, checkout, suite.timeoutMs ?? timeout)
        chunks.push(`\n$ ${suite.command}\n${result.output}`)
        const suiteOutcomes = suite.format === 'tap' ? parseTap(suite.id, result.output) : {}
        Object.assign(outcomes, suiteOutcomes)
        if (result.code !== 0 && !Object.values(suiteOutcomes).includes('fail')) outcomes[`${suite.id}::command exited ${result.code ?? result.signal ?? 'unknown'}`] = 'fail'
        if (result.timedOut) outcomes[`${suite.id}::command timed out`] = 'fail'
      }
    }
  } finally {
    const removed = await shell(`git worktree remove --force ${JSON.stringify(checkout)}`, root, 60_000).catch((error) => ({ code: 1, signal: null, output: String(error), timedOut: false }))
    if (removed.code !== 0 && existsSync(checkout)) chunks.push(`\ncleanup warning: exact checkout remains at ${checkout}\n${removed.output}`)
  }
  const output = chunks.join('')
  const logPath = join(store, 'logs', sha, `${startedAt.replace(/[:.]/g, '-')}-${role}-${run}.log`)
  writeAtomic(logPath, output)
  const failures = Object.entries(outcomes).filter(([, outcome]) => outcome === 'fail').map(([name]) => name).sort()
  return { startedAt, durationMs: Date.now() - started, failures, outcomes, logPath, logSha256: hash(output) }
}

function cachePath(root: string, sha: string, cfgHash: string, runtime: RuntimeFingerprint): string {
  return join(acceptanceRoot(root), 'baselines', `${sha}-${cfgHash.slice(0, 16)}-${hash(stable(runtime)).slice(0, 12)}.json`)
}

function validRun(run: unknown): run is ReviewRun {
  if (!run || typeof run !== 'object') return false
  const value = run as ReviewRun
  if (!Array.isArray(value.failures) || typeof value.logPath !== 'string' || !existsSync(value.logPath) || typeof value.logSha256 !== 'string') return false
  try { return hash(readFileSync(value.logPath)) === value.logSha256 } catch { return false }
}

function readBaseline(path: string, sha: string, cfgHash: string, runtime: RuntimeFingerprint): BaselineCache | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as BaselineCache
    if (value.schema !== 1 || value.sha !== sha || value.configHash !== cfgHash || stable(value.runtime) !== stable(runtime) || !Array.isArray(value.runs) || !value.runs.length || !value.runs.every(validRun)) return null
    return value
  } catch { return null }
}

async function withBaselineLock<T>(root: string, body: () => Promise<T>): Promise<T> {
  const lock = join(acceptanceRoot(root), 'baseline.lock')
  mkdirSync(dirname(lock), { recursive: true })
  while (true) {
    let fd: number | null = null
    try {
      fd = openSync(lock, 'wx', 0o600)
      writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`)
      closeSync(fd); fd = null
      try { return await body() } finally { rmSync(lock, { force: true }) }
    } catch (error) {
      if (fd != null) closeSync(fd)
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { rmSync(lock, { force: true }); continue } } catch { continue }
      await delay(1000)
    }
  }
}

function recordCollection(root: string, baseline: BaselineCache): void {
  const path = join(acceptanceRoot(root), 'baseline-collections.ndjson')
  mkdirSync(dirname(path), { recursive: true })
  const names = new Set(baseline.runs.flatMap((run) => Object.keys(run.outcomes)))
  const flips = [...names].filter((name) => {
    const observed = new Set(baseline.runs.map((run) => run.outcomes[name]).filter(Boolean))
    return observed.has('pass') && observed.has('fail')
  }).sort()
  appendFileSync(path, `${JSON.stringify({ sha: baseline.sha, collectedAt: baseline.collectedAt, runs: baseline.runs.length, flips })}\n`)
}

function collectionHistory(root: string): BaselineCollection[] {
  try {
    return readFileSync(join(acceptanceRoot(root), 'baseline-collections.ndjson'), 'utf8')
      .split('\n').filter(Boolean).map((line) => JSON.parse(line) as BaselineCollection)
      .filter((entry) => typeof entry.collectedAt === 'string' && Array.isArray(entry.flips))
  } catch { return [] }
}

function flakyDecisions(root: string, entries: ReviewFlakyConfig[], now: Date): FlakyDecision[] {
  const collections = collectionHistory(root)
  return entries.map((entry) => {
    const configuredEvidence = entry.observations.reduce((latest, item) => Math.max(latest, Date.parse(item.observedAt)), 0)
    const laterFlips = collections.filter((collection) => Date.parse(collection.collectedAt) > configuredEvidence && collection.flips.includes(entry.test))
    const latestFlip = laterFlips.at(-1)
    const latestEvidence = latestFlip ? Date.parse(latestFlip.collectedAt) : configuredEvidence
    const ageDays = (now.getTime() - latestEvidence) / 86_400_000
    const collectionsSinceFlip = collections.filter((collection) => Date.parse(collection.collectedAt) > latestEvidence).length
    const configured = entry.observations.map((item) => `${item.outcome}@${item.sha.slice(0, 12)} ${item.observedAt} (${item.source})`).join('; ')
    const evidence = latestFlip ? `${configured}; renewed by baseline flip@${latestFlip.sha.slice(0, 12)} ${latestFlip.collectedAt} (${latestFlip.runs} hashed run logs)` : configured
    if (ageDays >= entry.expiresAfterDays) return { test: entry.test, active: false, reason: `expired by age (${Math.floor(ageDays)}d >= ${entry.expiresAfterDays}d); evidence: ${evidence}` }
    if (collectionsSinceFlip >= entry.expiresAfterBaselineCollections) return { test: entry.test, active: false, reason: `expired after ${collectionsSinceFlip} later baseline collection(s) without another flip >= ${entry.expiresAfterBaselineCollections}; evidence: ${evidence}` }
    return { test: entry.test, active: true, reason: `evidence: ${evidence}; expires in ${entry.expiresAfterDays - Math.floor(ageDays)}d or ${entry.expiresAfterBaselineCollections - collectionsSinceFlip} baseline collection(s) without another flip` }
  })
}

const unionFailures = (runs: ReviewRun[]): string[] => [...new Set(runs.flatMap((run) => run.failures))].sort()

function renderReport(input: {
  candidateSha: string
  candidate: ReviewRun[]
  baseSha: string
  baseline: BaselineCache
  cached: boolean
  candidateOnly: string[]
  remaining: string[]
  decisions: FlakyDecision[]
}): string {
  const low = input.baseline.runs.length === 1 ? ' LOW CONFIDENCE: one run only' : ''
  const lines = [
    'Review acceptance:',
    `candidate ${input.candidateSha} — ${input.candidate.length} run(s), freshly collected`,
    `main ${input.baseSha} — ${input.baseline.runs.length} run(s), ${input.cached ? 'CACHED' : 'freshly collected'} at ${input.baseline.collectedAt}${low}`,
    `candidate-only failures (${input.candidateOnly.length}): ${input.candidateOnly.length ? input.candidateOnly.join(' | ') : 'none'}`,
  ]
  lines.push(`flaky registry (${input.decisions.length}): ${input.decisions.length ? '' : 'none'}`)
  for (const decision of input.decisions) {
    const status = !decision.active ? 'NOT APPLIED' : input.candidateOnly.includes(decision.test) ? 'APPLIED' : 'NOT NEEDED'
    lines.push(`  ${status} ${decision.test} — ${decision.reason}`)
  }
  lines.push(`attributable failures after exemptions (${input.remaining.length}): ${input.remaining.length ? input.remaining.join(' | ') : 'none'}`)
  return lines.join('\n')
}

export async function runReviewAcceptance(options: AcceptanceOptions = {}): Promise<ReviewAcceptanceResult> {
  const root = mainRoot()
  const cfg = reviewAcceptanceConfig(process.cwd())
  if (!cfg) return { ok: true, configured: false, report: 'Review acceptance: not configured for this project.' }
  const onProgress = options.onProgress ?? (() => {})
  const candidateSha = resolveCommit(process.cwd(), options.candidate ?? 'HEAD')
  const baseSha = resolveCommit(root, options.base ?? mainBranch())
  const candidate: ReviewRun[] = []
  for (let run = 1; run <= cfg.runs; run++) candidate.push(await collectRun(root, candidateSha, cfg, run, 'candidate', onProgress))
  const cfgHash = configHash(cfg)
  const runtime = runtimeFingerprint()
  const path = cachePath(root, baseSha, cfgHash, runtime)
  const settled = await withBaselineLock(root, async (): Promise<{ baseline: BaselineCache; cached: boolean }> => {
    const hit = readBaseline(path, baseSha, cfgHash, runtime)
    if (hit) return { baseline: hit, cached: true }
    const runs: ReviewRun[] = []
    for (let run = 1; run <= cfg.runs; run++) runs.push(await collectRun(root, baseSha, cfg, run, 'main', onProgress))
    const baseline: BaselineCache = { schema: 1, sha: baseSha, collectedAt: new Date().toISOString(), configHash: cfgHash, runtime, runs }
    writeAtomic(path, `${JSON.stringify(baseline, null, 2)}\n`)
    recordCollection(root, baseline)
    return { baseline, cached: false }
  })
  const { baseline, cached } = settled
  const candidateFailures = unionFailures(candidate)
  const baseFailures = new Set(unionFailures(baseline.runs))
  const candidateOnly = candidateFailures.filter((name) => !baseFailures.has(name))
  const decisions = flakyDecisions(root, cfg.flaky ?? [], options.now ?? new Date())
  const active = new Set(decisions.filter((decision) => decision.active).map((decision) => decision.test))
  const exempted = candidateOnly.filter((name) => active.has(name))
  const remaining = candidateOnly.filter((name) => !active.has(name))
  const moved: string[] = []
  if (options.candidate == null && resolveCommit(process.cwd(), 'HEAD') !== candidateSha) moved.push(`candidate HEAD moved after collection (was ${candidateSha})`)
  if (options.base == null && resolveCommit(root, mainBranch()) !== baseSha) moved.push(`main moved after collection (was ${baseSha})`)
  const attributable = [...remaining, ...moved]
  const report = renderReport({ candidateSha, candidate, baseSha, baseline, cached, candidateOnly, remaining: attributable, decisions })
  return {
    ok: attributable.length === 0,
    configured: true,
    report,
    candidateSha,
    baseSha,
    candidateRuns: candidate.length,
    baseRuns: baseline.runs.length,
    baselineCached: cached,
    candidateOnly,
    exempted,
  }
}
