// @@@ spex doctor - the opt-in, read-only project DIAGNOSIS surface ([[doctor]]). Bare doctor composes
// spec-health findings with the delivery audit: when a user launches their OWN agent with no SpexCode
// process in the launch, the workflow reaches it only through the files materialize() writes. The audit
// loops the same HARNESSES adapter materialize uses and catches missing delivery or duplicate discovery.
// `--contract` and `--conflicts` remain focused representations of that same diagnosis.
import { existsSync, readFileSync, readdirSync, accessSync, constants } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { loadSystemConfig, loadSkillConfig, loadSpecs } from './specs.js'
import { runtimeRoot, treeSlotDir, envSessionId, readAliasedRawRecord, mainCheckout, readJsonConfig } from './layout.js'
import { loadConfig } from './lint.js'
import { trackedSourceFiles } from './source-files.js'

// this file lives at <pkgRoot>/src/self.ts, so `..` is the package root — the same derivation init.ts/
// materialize.ts use (never a hardcoded repo path), so the git-hook template lookup survives a relocated install.
const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))

// run a git query in `dir`, swallowing git's own stderr — a non-repo returns null (the absence IS the signal).
function git(dir: string, args: string[]): string | null {
  try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return null }
}
function repoRoot(dir: string): string | null { return git(dir, ['rev-parse', '--show-toplevel']) }
function commonHooksDir(dir: string): string | null {
  const common = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  return common ? join(common, 'hooks') : null
}
const read = (f: string): string => { try { return readFileSync(f, 'utf8') } catch { return '' } }

type AltitudeConfig = {
  lineBudget: number
  charBudget: number
  sizeable: number
  dense: number
  steps: number
  identifierExtensions: string[]
}

type BreadthConfig = {
  maxChildren: number
}

export type HealthFinding = {
  check: string
  spec: string
  summary: string
  evidence: string[]
  repair: string
}

const DEFAULT_ALTITUDE: AltitudeConfig = {
  lineBudget: 50,
  charBudget: 4200,
  sizeable: 35,
  dense: 1.3,
  steps: 3,
  identifierExtensions: [],
}

const DEFAULT_BREADTH: BreadthConfig = {
  maxChildren: 8,
}

function loadAltitudeConfig(root: string): AltitudeConfig {
  const configured = readJsonConfig(join(root, 'spexcode.json'))?.doctor?.altitude ?? {}
  const merged = { ...DEFAULT_ALTITUDE, ...configured }
  return {
    ...merged,
    identifierExtensions: (merged.identifierExtensions ?? []).map((ext: string) => ext.replace(/^\.+/, '')),
  }
}

function loadBreadthConfig(root: string): BreadthConfig {
  const configured = readJsonConfig(join(root, 'spexcode.json'))?.doctor?.breadth ?? {}
  return { ...DEFAULT_BREADTH, ...configured }
}

// Filename rows are lint coverage's exact tracked candidates. Compatibility extensions lower to wildcard
// rows before the one identifier matcher is compiled.
function identifierFilenameCandidates(sourceFiles: string[], compatibilityExtensions: string[]): string[] {
  return [...new Set([
    ...sourceFiles.map((path) => basename(path)),
    ...compatibilityExtensions.map((ext) => `*.${ext}`),
  ])]
}

function identRe(filenameCandidates: string[]): RegExp {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const filenames = filenameCandidates
    .map((candidate) => candidate.startsWith('*.')
      ? `[\\w-]+\\.${escape(candidate.slice(2))}`
      : escape(candidate))
    .sort((a, b) => b.length - a.length)
  const signals = [
    '[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*',
    '\\b[a-z]+_[a-z0-9_]+\\b',
    '\\b\\w+\\(',
    '`[^`]+`',
    '\\/[\\w./-]+\\.\\w+',
  ]
  if (filenames.length) signals.push(`(?<![\\w./-])(?:${filenames.join('|')})(?![\\w.-])`)
  return new RegExp(signals.join('|'), 'g')
}

const STEP_LINE = /^\s*(\d+[.)]\s|[-*]\s*(first|then|next|finally)\b)|(^|[,;]\s*)(first|then|next|finally),/i

function altitudeEvidence(body: string, cfg: AltitudeConfig, ident: RegExp): string[] {
  const lines = body.split('\n')
  const nonBlank = lines.filter((line) => line.trim()).length
  let inFence = false
  let signals = 0
  let steps = 0
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue }
    if (inFence || !line.trim()) continue
    signals += line.match(ident)?.length ?? 0
    if (STEP_LINE.test(line)) steps++
  }
  const density = signals / Math.max(1, nonBlank)
  const evidence: string[] = []
  if (nonBlank > cfg.lineBudget || body.length > cfg.charBudget)
    evidence.push(`${nonBlank} non-blank lines / ${body.length} chars over budget (${cfg.lineBudget}/${cfg.charBudget})`)
  if (nonBlank > cfg.sizeable && density > cfg.dense)
    evidence.push(`code-identifier density ${density.toFixed(2)}/line over ${cfg.dense}`)
  if (nonBlank > cfg.sizeable && steps >= cfg.steps)
    evidence.push(`${steps} step-by-step how-to lines`)
  return evidence
}

export async function specHealthDiagnosis(root: string): Promise<HealthFinding[]> {
  const lint = loadConfig(root)
  const altitude = loadAltitudeConfig(root)
  const breadth = loadBreadthConfig(root)
  const governed = trackedSourceFiles(root, lint.governedRoots, lint)
  const ident = identRe(identifierFilenameCandidates(governed, altitude.identifierExtensions))
  const specs = await loadSpecs(root)
  const childCount = new Map<string, number>()
  for (const spec of specs) if (spec.parent) childCount.set(spec.parent, (childCount.get(spec.parent) ?? 0) + 1)
  const findings: HealthFinding[] = []
  for (const spec of specs) {
    const evidence = altitudeEvidence(spec.body, altitude, ident)
    if (evidence.length) findings.push({
      check: 'altitude',
      spec: spec.id,
      summary: 'body reads like mechanics rather than a contract',
      evidence,
      repair: `rewrite '${spec.id}' around observable intent and invariants; the tidy workflow can perform the semantic review`,
    })
    const children = childCount.get(spec.id) ?? 0
    if (children >= breadth.maxChildren) findings.push({
      check: 'breadth',
      spec: spec.id,
      summary: 'tree fan-out may be missing a natural grouping layer',
      evidence: [`${children} direct child nodes (>= ${breadth.maxChildren})`],
      repair: `review '${spec.id}' with the regroup workflow; group only along a real seam and leave genuine peers flat`,
    })
  }
  return findings
}

function healthReport(findings: HealthFinding[], adopted: boolean): string[] {
  const lines = ['Spec health diagnosis (opt-in advisory; never part of spex spec lint)']
  if (!adopted) {
    lines.push('  status          : unavailable — adopt the repository with `spex init`')
    return lines
  }
  const checks = ['altitude', 'breadth', ...new Set(findings.map((finding) => finding.check).filter((check) => check !== 'altitude' && check !== 'breadth'))]
  for (const check of checks) {
    const rows = findings.filter((finding) => finding.check === check)
    lines.push(`  ${check.padEnd(16)}: ${rows.length ? `${rows.length} finding(s)` : 'healthy'}`)
    for (const finding of rows) {
      lines.push(`    ${finding.spec.padEnd(16)}: ${finding.summary}`)
      for (const evidence of finding.evidence) lines.push(`      evidence      : ${evidence}`)
      lines.push(`      repair        : ${finding.repair}`)
    }
  }
  return lines
}

// @@@ contractText - the layer-2 payload: the composed `surface:system` bodies, the SAME join materialize()
// folds into each harness's contract file — so a BYOA agent reads byte-identical guidance.
function contractText(): { names: string[]; body: string } {
  let cfgs: { name: string; body: string }[] = []
  try { cfgs = loadSystemConfig().map((c) => ({ name: c.name, body: c.body })) } catch { /* tree-less cwd → empty */ }
  return { names: cfgs.map((c) => c.name), body: cfgs.map((c) => c.body.trim()).filter(Boolean).join('\n\n') }
}

// compare an installed git hook to the shipped template: spexcode (current) | stale (older SpexCode, re-run
// `spex init`) | foreign (a real conflict) | missing. The stale/foreign split keeps a slightly-behind repo
// from reading as a CONFLICT.
type HookState = 'spexcode' | 'stale' | 'foreign' | 'missing'
function hookState(hooksDir: string | null, name: string): HookState {
  if (!hooksDir) return 'missing'
  const installed = join(hooksDir, name)
  if (!existsSync(installed)) return 'missing'
  const body = read(installed)
  try { if (body === readFileSync(join(PKG_ROOT, 'templates', 'hooks', name), 'utf8')) return 'spexcode' } catch { /* fall through */ }
  return /SpexCode/.test(body) ? 'stale' : 'foreign'
}

// does `bin` resolve to an executable on the inherited PATH? Returns the resolving path, or null. This is the
// precondition behind a dozen confusing symptoms — a session shell whose PATH misses the global bin dir gets
// `command not found` for spex/codex/claude (npm's global prefix landing off-PATH).
function resolveOnPath(bin: string): string | null {
  for (const d of (process.env.PATH || '').split(':')) {
    if (!d) continue
    const p = join(d, bin)
    try { accessSync(p, constants.X_OK); return p } catch { /* not here */ }
  }
  return null
}

// parse the materialized manifest (TAB lines: event<TAB>order<TAB>block<TAB>script) → the unique handler
// scripts, repo-relative. The dispatcher runs each as bash "<proj>/<script>".
function manifestScripts(text: string): string[] {
  const out = new Set<string>()
  for (const line of text.split('\n')) {
    const f = line.split('\t')
    if (f.length >= 4 && f[3]) out.add(f[3])
  }
  return [...out]
}

// @@@ double-delivery - the SILENT conflict on the OTHER axis from under-delivery: not "did the contract
// land?" but "did it land TWICE?". A self-launched agent can be reached by BOTH the loose native delivery
// materialize() writes into the worktree AND a `spexcode` plugin bundle the user installed independently
// (Claude marketplace) or a stale leftover — doubling every hook (dispatch.sh fires per copy), shadowing
// skills, confusing the `/` menu. We never sniff payload: every count is by IDENTITY STAMP — a shim's
// `dispatch.sh` command line (the hook-routing stamp, the same one cleanHarness keys on), a plugin.json
// `name:"spexcode"` (the bundle stamp), and our own materialized skill NAMES. Per harness we count, on three
// channels, how many spexcode-stamped copies reach the agent; any channel >1 is a double-delivery conflict.

// a plugin bundle dir found under a harness's plugins root, carrying a spexcode stamp.
type Bundle = { dir: string; name: string; scope: string; hooksToDispatch: boolean; skillsDir: string }

// the bundle's declared name, from plugin.json (root or the .claude-plugin/ convention), or null when none.
function pluginName(dir: string): string | null {
  for (const p of [join(dir, 'plugin.json'), join(dir, '.claude-plugin', 'plugin.json')]) {
    if (!existsSync(p)) continue
    try { const n = (JSON.parse(readFileSync(p, 'utf8')) as { name?: unknown }).name; if (typeof n === 'string') return n } catch { /* malformed → treat as nameless */ }
  }
  return null
}
// does this bundle wire a hooks shim that routes to OUR dispatch.sh? (hooks/hooks.json or a root hooks.json)
function bundleHooksToDispatch(dir: string): boolean {
  return [join(dir, 'hooks', 'hooks.json'), join(dir, 'hooks.json')].some((p) => /dispatch\.sh/.test(read(p)))
}
// scan one plugins root's immediate children for SpexCode-stamped bundles (name=="spexcode", a dispatch.sh
// shim, or one of our own skill names) — three stamps, any one suffices. A non-dir / missing root → [].
function scanBundles(root: string, scope: string, ourSkills: string[]): Bundle[] {
  let names: string[] = []
  try { names = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) } catch { return [] }
  const out: Bundle[] = []
  for (const n of names) {
    const dir = join(root, n)
    const skillsDir = join(dir, 'skills')
    const pname = pluginName(dir)
    const hooksToDispatch = bundleHooksToDispatch(dir)
    const hasOurSkill = ourSkills.some((s) => existsSync(join(skillsDir, s, 'SKILL.md')) || existsSync(join(skillsDir, s)))
    if (pname === 'spexcode' || hooksToDispatch || hasOurSkill) out.push({ dir, name: pname ?? n, scope, hooksToDispatch, skillsDir })
  }
  return out
}

// per-harness double-delivery report. For each harness it derives the plugins roots FROM THE ADAPTER's own
// shim path (`<cfgdir>/plugins` in-tree + `~/<cfgdir>/plugins` global — no hardcoded `.claude`, so a new
// harness scans for free), finds the spexcode bundles, then counts three channels against the loose native
// delivery. Returns the printable lines + whether ANY channel >1 (a live double-delivery).
async function doubleDeliveryReport(base: string): Promise<{ lines: string[]; conflict: boolean }> {
  const { HARNESSES } = await import('./harness.js')
  const ourSkills = (() => { try { return loadSkillConfig().map((c) => c.name) } catch { return [] as string[] } })()
  const L: string[] = []
  const line = (k: string, v: string) => L.push(`  ${k.padEnd(16)}: ${v}`)
  let conflict = false
  const rel = (f: string) => f.startsWith(base + '/') ? f.slice(base.length + 1) : f

  for (const h of HARNESSES) {
    const shimFile = h.shimFile(base)
    const looseDispatch = /dispatch\.sh/.test(read(shimFile))
    const looseSkillDir = h.skillDir(base)
    const looseContract = h.contractFiles(base).some((f) => /<!--\s*spexcode:start\s*-->/.test(read(f)))
    const looseSkill = (s: string) => !!looseSkillDir && existsSync(join(looseSkillDir, s, 'SKILL.md'))
    const looseDelivery = looseDispatch || looseContract || ourSkills.some(looseSkill)

    const cfgDir = dirname(shimFile)   // <proj>/.claude (codex: <main>/.codex)
    const roots: [string, string][] = [[join(cfgDir, 'plugins'), 'workspace'], [join(homedir(), basename(cfgDir), 'plugins'), 'global']]
    const bundles = roots.flatMap(([r, scope]) => scanBundles(r, scope, ourSkills))

    // channel 1 — hooks → dispatch.sh (loose shim + any bundle hooks shim)
    const hookSrc = [
      ...(looseDispatch ? [`loose ${rel(shimFile)}`] : []),
      ...bundles.filter((b) => b.hooksToDispatch).map((b) => `plugin "${b.name}" (${b.scope})`),
    ]
    // channel 2 — same-named skill in loose skillDir AND a bundle's skills dir
    const skillHits: string[] = []
    for (const s of ourSkills) {
      let c = looseSkill(s) ? 1 : 0
      c += bundles.filter((b) => existsSync(join(b.skillsDir, s, 'SKILL.md')) || existsSync(join(b.skillsDir, s))).length
      if (c > 1) skillHits.push(`${s} ×${c}`)
    }
    // channel 3 — total delivery sources reaching this harness (loose + each spexcode bundle)
    const sources = (looseDelivery ? 1 : 0) + bundles.length

    const hConflict = hookSrc.length > 1 || skillHits.length > 0 || sources > 1
    if (hConflict) conflict = true

    L.push(`${h.id}${hConflict ? '  — DOUBLE-DELIVERY CONFLICT' : ''}`)
    line('delivery srcs', `${sources}${sources > 1 ? '  (>1 → CONFLICT)' : sources === 1 ? '  (single — ok)' : '  (none)'}`)
    line('  loose', looseDelivery ? `present (${[looseDispatch && 'shim→dispatch', looseContract && 'contract', ourSkills.some(looseSkill) && 'skills'].filter(Boolean).join('+')})` : 'absent')
    for (const b of bundles) line('  plugin', `"${b.name}" (${b.scope}) — ${b.dir}`)
    line('hooks→dispatch', `${hookSrc.length}${hookSrc.length > 1 ? '  (>1 → CONFLICT): ' + hookSrc.join(', ') : hookSrc.length === 1 ? '  (single — ok)' : '  (none wired)'}`)
    line('skill shadowing', skillHits.length ? `CONFLICT: ${skillHits.join(', ')}` : 'none')
    L.push('')
  }

  if (conflict) {
    L.push('Repair — SpexCode is reaching this agent through MORE THAN ONE discovery channel. Keep exactly one:')
    L.push('  • remove the independently-installed plugin bundle (delete its dir, or `claude plugin uninstall spexcode`); or')
    L.push('  • if you WANT the plugin, stop the native delivery: set spexcode.json to')
    L.push('    `"harnesses": [{"plugin":".claude"}]`, then run `spex materialize` to prune the loose shim/contract/skills; or')
    L.push('  • remove SpexCode\'s generated delivery with `spex uninstall`.')
  } else {
    L.push('No double-delivery: each harness is reached by at most one spexcode-stamped channel.')
  }
  return { lines: L, conflict }
}

// ping the backend (the resolved apiBase) with a short timeout so doctor never hangs on a dead/wrong backend.
async function backendReachable(): Promise<{ base: string; up: boolean }> {
  let base = 'http://127.0.0.1:8787'
  try { base = await (await import('./sessions.js')).apiBase() } catch { /* keep default */ }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 800)
  try { return { base, up: (await fetch(`${base}/api/sessions`, { signal: ctrl.signal })).ok } }
  catch { return { base, up: false } }
  finally { clearTimeout(t) }
}

// the headline: a per-layer report of whether the SpexCode workflow truly reaches THIS agent.
async function doctor(): Promise<number> {
  const cwd = process.cwd()
  const root = repoRoot(cwd)
  const base = root ?? cwd   // the contract files (CLAUDE.md/AGENTS.md) + hook shims live at the worktree ROOT — anchor every probe here
  const adopted = existsSync(join(base, '.spec')) && existsSync(join(base, 'spexcode.json'))
  // managed = THIS agent's own session is a GOVERNED record in the global store (the dashboard launcher set
  // governed:true). That governed flag is the source of truth the old worktree `.session` presence only implied
  // (see [[state]]); resolve the agent's id from its env and read the record — a self-launched BYOA agent has none.
  const ownId = envSessionId()
  const managed = !!(ownId && readAliasedRawRecord(ownId)?.governed)
  const hooksDir = commonHooksDir(cwd)
  const { names, body } = contractText()

  const { HARNESSES } = await import('./harness.js')
  type H = typeof HARNESSES[number]
  // which harness is the RUNNING agent? the one whose session env var is set in this process.
  const runningHarness: H | undefined = HARNESSES.find((h) => process.env[h.sessionEnvVar])

  const L: string[] = []
  const line = (k: string, v: string) => L.push(`  ${k.padEnd(16)}: ${v}`)
  L.push('spex doctor — how the SpexCode workflow reaches this agent\n')

  L.push('Agent')
  line('detected', runningHarness ? `${runningHarness.id}  (${runningHarness.sessionEnvVar}=${process.env[runningHarness.sessionEnvVar]})` : 'none detected (no harness session env var set)')
  L.push('\nRepo')
  line('spex-adopted', adopted ? 'yes (.spec/ + spexcode.json)' : root ? 'no — run `spex init`' : 'not a git repo')
  line('root', base)
  line('mode', managed ? 'managed worktree (backend-launched session)' : 'standalone repo (bring-your-own-agent)')
  // the issues-workflow switch ([[local-issues]]): its only home is the `issues.enabled` settings key
  // (v0.3.0 — the on|off|status CLI verbs are gone), so doctor is where its state is READ. A legacy
  // pre-rename `proposals.enabled` key is no longer consulted at runtime (no fallback) — flag it here so
  // an old settings file gets repaired instead of silently drifting from what its author believes.
  if (adopted) {
    const { issuesEnabled } = await import('./localIssues.js')
    // probe the SAME files the switch actually reads — the trunk checkout's settings pair, not this
    // worktree's (readConfig resolves to mainCheckout, so a legacy key only matters there).
    const cfgHome = (() => { try { return mainCheckout() } catch { return base } })()
    const legacy = ['spexcode.json', 'spexcode.local.json'].filter((f) => {
      try { return 'proposals' in JSON.parse(readFileSync(join(cfgHome, f), 'utf8')) } catch { return false }
    })
    line('issues workflow', `${issuesEnabled() ? 'ON' : 'OFF'} (spexcode.json issues.enabled)`)
    if (legacy.length) line('  LEGACY key', `\`proposals\` found in ${legacy.map((f) => join(cfgHome, f)).join(', ')} — no longer read; rename it to "issues": { "enabled": … }`)
    const projectConfig = readJsonConfig(join(base, 'spexcode.json'))
    if (Object.prototype.hasOwnProperty.call(projectConfig.lint ?? {}, 'maxChildren'))
      line('RETIRED key', '`lint.maxChildren` is no longer read — move the value to `doctor.breadth.maxChildren`')
  }

  const health = adopted ? await specHealthDiagnosis(base) : []
  L.push('\n' + healthReport(health, adopted).join('\n'))

  // --- preconditions: nothing downstream fires without these ---
  L.push('\nPreconditions (without these nothing downstream fires)')
  for (const bin of ['spex', 'claude', 'codex']) {
    const at = resolveOnPath(bin)
    line(`PATH ${bin}`, at ? `resolves (${at})` : 'NOT on PATH — a session shell will hit `command not found`')
  }
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
  const codexCfg = read(join(codexHome, 'config.toml'))
  const codexAuth = existsSync(join(codexHome, 'auth.json'))
  line('codex auth', (/base_url|model_provider/.test(codexCfg) && codexAuth) ? `present (${codexHome})` : `incomplete (${codexHome}: config provider/base_url ${/base_url|model_provider/.test(codexCfg) ? 'ok' : 'MISSING'}, auth.json ${codexAuth ? 'ok' : 'MISSING'})`)

  // --- git-hook floor: enforces for ANY agent/harness ---
  const preCommit = hookState(hooksDir, 'pre-commit')
  const prepare = hookState(hooksDir, 'prepare-commit-msg')
  const hb = (s: HookState) => s === 'spexcode' ? 'installed (SpexCode)' : s === 'stale' ? 'OUTDATED (older SpexCode — re-run `spex init`)' : s === 'foreign' ? 'PRESENT but not SpexCode\'s (a foreign hook holds the slot)' : 'MISSING'
  L.push('\nLayer 1 — git-hook floor (enforces for ANY agent)')
  line('pre-commit', hb(preCommit))
  line('prepare-cmsg', hb(prepare))
  line('hooks dir', hooksDir ?? '—')

  // --- contract: the surface:system block landed in each harness's contract file ---
  L.push('\nLayer 2 — contract (surface:system text)')
  line('nodes', names.length ? names.join(', ') : 'none — contract is empty')
  for (const h of HARNESSES) {
    const present = h.contractFiles(base).every((f) => /<!--\s*spexcode:start\s*-->/.test(read(f)))
    line(`in ${h.id}`, present ? `block present (${h.contractFiles(base).map((f) => f.replace(base + '/', '')).join(', ')})` : 'NOT landed — run `spex doctor contract` / materialize')
  }
  line('view', 'spex doctor --contract')

  // --- hooks: the shim → dispatch, the manifest, and EVERY handler readable in the worktree ---
  L.push('\nLayer 3 — hooks (shim → dispatch · manifest · handler-existence)')
  for (const h of HARNESSES) {
    const shim = read(h.shimFile(base))
    line(`${h.id} shim`, /dispatch\.sh/.test(shim) ? `wired (${h.shimFile(base).replace(base + '/', '')})` : 'NOT wired (no dispatch shim)')
  }
  // manifest resolution mirrors dispatch.sh: this tree's materialize slot first, then the legacy global file
  // (a pre-slot tree's migration-window fallback) — so the doctor reads exactly what a dispatch would.
  let manifestText = ''
  let manifestHome = 'tree slot'
  try { manifestText = read(join(treeSlotDir(base), 'hooks-manifest')) } catch { /* non-git / no store */ }
  if (!manifestText) {
    try { manifestText = read(join(runtimeRoot(base), 'hooks-manifest')); manifestHome = 'legacy global file (pre-slot materialize — re-run `spex materialize`)' } catch { /* neither */ }
  }
  if (!manifestText) {
    line('manifest', 'MISSING from the global store — materialize never ran (hooks fire but find no manifest)')
  } else {
    const scripts = manifestScripts(manifestText)
    const missing = scripts.filter((s) => !existsSync(join(base, s)))
    line('manifest', `${scripts.length} handler(s) in the ${manifestHome}`)
    line('handlers', missing.length === 0 ? 'all readable in the worktree' : `${missing.length} MISSING in the worktree → those hooks SILENTLY NO-OP:`)
    for (const m of missing) L.push(`      ✗ ${m}`)
  }
  // codex trust
  const trustPresent = codexCfg.includes(`# spexcode:trust:${base}`)
  line('codex trust', trustPresent ? 'trusted_hash block present in ~/.codex/config.toml' : 'absent (codex self-launch would prompt for trust)')

  // --- backend: orchestration; absent is normal for BYOA ---
  const { base: backendBase, up } = await backendReachable()
  L.push('\nLayer 4 — session orchestration (backend-only: dispatch · queue · comms)')
  line('backend', up ? `reachable at ${backendBase}` : `not reachable at ${backendBase}`)

  // --- double-delivery: the same agent reached through two discovery channels (loose + a plugin bundle) ---
  const dd = await doubleDeliveryReport(base)
  L.push('\nLayer 5 — double-delivery (one harness, two discovery channels)')
  L.push(...dd.lines)

  // --- verdict ---
  L.push('\nCoverage verdict')
  line('preconditions', resolveOnPath('spex') ? 'spex resolves' : 'BLOCKED — spex not on PATH (fix first)')
  line('layer 1', preCommit === 'spexcode' ? 'ENFORCED' : preCommit === 'stale' ? 'ENFORCED (older — update with `spex init`)' : preCommit === 'foreign' ? 'CONFLICT (a non-SpexCode hook holds the slot)' : 'ABSENT')
  line('layer 2', body.length === 0 ? 'ABSENT (no contract)' : 'see per-harness above')
  line('layer 3', manifestText ? 'see handler-existence above' : 'ABSENT (no manifest — agent ungoverned)')
  line('layer 4', up ? 'present' : managed ? 'EXPECTED but backend down' : 'absent (normal for bring-your-own-agent)')
  line('layer 5', dd.conflict ? 'CONFLICT (double-delivery — see Layer 5; `spex doctor --conflicts`)' : 'clean (single channel)')

  // --- footprint: every artifact Spex wrote here, + any slot held by something not ours ---
  L.push('\nFootprint (what Spex wrote into this environment)')
  const foot: string[] = []
  const ours = (s: HookState) => s === 'spexcode' || s === 'stale'
  if (ours(preCommit)) foot.push(`${join(hooksDir!, 'pre-commit')}  (SpexCode${preCommit === 'stale' ? ', outdated' : ''})`)
  if (ours(prepare)) foot.push(`${join(hooksDir!, 'prepare-commit-msg')}  (SpexCode${prepare === 'stale' ? ', outdated' : ''})`)
  for (const h of HARNESSES) {
    if (/dispatch\.sh/.test(read(h.shimFile(base)))) foot.push(`${h.shimFile(base)}  (${h.id} hook shim)`)
    for (const f of h.contractFiles(base)) if (/<!--\s*spexcode:start\s*-->/.test(read(f))) foot.push(`${f}  (${h.id} contract block)`)
  }
  if (trustPresent) foot.push(`${join(codexHome, 'config.toml')}  (codex trust block)`)
  L.push(foot.length ? foot.map((f) => `  ${f}`).join('\n') : '  (nothing — Spex has written no files into this environment)')
  const collisions = [preCommit, prepare].filter((s) => s === 'foreign').length
  line('\ncollisions', collisions ? `${collisions} hook slot(s) held by a non-SpexCode hook` : 'none')

  console.log(L.join('\n'))
  return 0
}

// print the layer-2 contract so any agent/harness can be handed exactly what materialize folds in.
function contract(): number {
  const { body } = contractText()
  if (!body) { console.error('spex doctor: no surface:system nodes in this .spec tree — the contract is empty.'); return 0 }
  console.log(body)
  return 0
}

// the focused double-delivery check: JUST Layer 5, exit non-zero when a conflict is live so it gates a script
// / eval. Anchors at the repo root like doctor (the shims + contract + skills live there).
async function conflicts(): Promise<number> {
  const cwd = process.cwd()
  const base = repoRoot(cwd) ?? cwd
  const { lines, conflict } = await doubleDeliveryReport(base)
  console.log(['spex doctor --conflicts — does SpexCode reach this agent through more than one discovery channel?\n', ...lines].join('\n'))
  return conflict ? 1 : 0
}

function migrationRemoved(): number {
  console.error('spex: `spex doctor --migrate` was removed in v0.4.0 — migrate this tree with a 0.3.x SpexCode release, then reinstall the current release. Nothing was changed.')
  return 2
}

function usage(): number {
  console.error(`spex doctor — diagnose spec health and how the SpexCode workflow reaches your agent
  (bare)         spec-health findings + delivery report: preconditions · git-hook floor · contract · hooks(+handlers) · backend · footprint
  --contract     print the surface:system contract text (hand it to any agent)
  --conflicts    detect double-delivery — the same agent reached via loose native delivery AND a plugin bundle (exits non-zero on conflict)`)
  return 0
}

export async function runDoctor(args: string[]): Promise<number> {
  // contract/conflicts are FLAGS, not subcommands ([[cli-surface]] §4: another representation of the same
  // diagnosis read, not a distinct action). The old positional spellings signpost — report, never run.
  if (args.includes('--migrate')) return migrationRemoved()
  if (args.includes('--contract')) return contract()
  if (args.includes('--conflicts')) return await conflicts()
  switch (args[0]) {
    case undefined: return await doctor()
    case 'contract': case 'conflicts':
      console.error(`spex: \`spex doctor ${args[0]}\` was removed in v0.3.0 — use: spex doctor --${args[0]}`)
      return 2
    case 'help': case '--help': case '-h': return usage()
    default: console.error(`spex doctor: unknown subcommand "${args[0]}"`); usage(); return 2
  }
}
