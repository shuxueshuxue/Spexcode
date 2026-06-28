// @@@ spex self - the SELF-DIAGNOSIS surface (spec-cli/self). When a user launches their OWN claude/codex
// with no SpexCode process in the launch, the workflow reaches that agent only through the files
// materialize() renders (the manifest in the global store; the in-tree contract blocks + hook shims + codex
// trust). `self` answers "is this agent actually governed, or silently running free?" — diagnosing that
// materialized contract per LAYER, looping the same HARNESSES adapter materialize renders through (so claude
// AND codex are covered with no hardcoded paths). It catches the SILENT failure: a shim whose handler is
// missing, a PATH that can't resolve `spex`, a contract that never landed. Read-only today: `doctor`,
// `contract` (print the surface:system text any agent reads), `env`. install/uninstall are STAGED (noteStaged).
import { existsSync, readFileSync, accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { loadSystemConfig } from './specs.js'
import { runtimeRoot } from './layout.js'

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

// ping the backend (apiBase) with a short timeout so doctor never hangs on a dead/wrong SPEXCODE_API_URL.
async function backendReachable(): Promise<{ base: string; up: boolean }> {
  let base = 'http://127.0.0.1:8787'
  try { base = (await import('./sessions.js')).apiBase() } catch { /* keep default */ }
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
  const base = root ?? cwd   // .claude/.codex/CLAUDE.md/.session live at the worktree ROOT — anchor every probe here
  const adopted = existsSync(join(base, '.spec')) && existsSync(join(base, 'spexcode.json'))
  const managed = existsSync(join(base, '.session'))
  const hooksDir = commonHooksDir(cwd)
  const { names, body } = contractText()

  const { HARNESSES } = await import('./harness.js')
  type H = typeof HARNESSES[number]
  // which harness is the RUNNING agent? the one whose session env var is set in this process.
  const runningHarness: H | undefined = HARNESSES.find((h) => process.env[h.sessionEnvVar])

  const L: string[] = []
  const line = (k: string, v: string) => L.push(`  ${k.padEnd(16)}: ${v}`)
  L.push('spex self doctor — how the SpexCode workflow reaches this agent\n')

  L.push('Agent')
  line('detected', runningHarness ? `${runningHarness.id}  (${runningHarness.sessionEnvVar}=${process.env[runningHarness.sessionEnvVar]})` : 'none detected (no harness session env var set)')
  L.push('\nRepo')
  line('spex-adopted', adopted ? 'yes (.spec/ + spexcode.json)' : root ? 'no — run `spex init`' : 'not a git repo')
  line('root', base)
  line('mode', managed ? 'managed worktree (backend-launched session)' : 'standalone repo (bring-your-own-agent)')

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
    line(`in ${h.id}`, present ? `block present (${h.contractFiles(base).map((f) => f.replace(base + '/', '')).join(', ')})` : 'NOT landed — run `spex self contract` / materialize')
  }
  line('view', 'spex self contract')

  // --- hooks: the shim → dispatch, the manifest, and EVERY handler readable in the worktree ---
  L.push('\nLayer 3 — hooks (shim → dispatch · manifest · handler-existence)')
  for (const h of HARNESSES) {
    const shim = read(h.shimFile(base))
    line(`${h.id} shim`, /dispatch\.sh/.test(shim) ? `wired (${h.shimFile(base).replace(base + '/', '')})` : 'NOT wired (no dispatch shim)')
  }
  let manifestText = ''
  try { manifestText = read(join(runtimeRoot(base), 'hooks-manifest')) } catch { /* non-git / no store */ }
  if (!manifestText) {
    line('manifest', 'MISSING from the global store — materialize never ran (hooks fire but find no manifest)')
  } else {
    const scripts = manifestScripts(manifestText)
    const missing = scripts.filter((s) => !existsSync(join(base, s)))
    line('manifest', `${scripts.length} handler(s) in the global store`)
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

  // --- verdict ---
  L.push('\nCoverage verdict')
  line('preconditions', resolveOnPath('spex') ? 'spex resolves' : 'BLOCKED — spex not on PATH (fix first)')
  line('layer 1', preCommit === 'spexcode' ? 'ENFORCED' : preCommit === 'stale' ? 'ENFORCED (older — update with `spex init`)' : preCommit === 'foreign' ? 'CONFLICT (a non-SpexCode hook holds the slot)' : 'ABSENT')
  line('layer 2', body.length === 0 ? 'ABSENT (no contract)' : 'see per-harness above')
  line('layer 3', manifestText ? 'see handler-existence above' : 'ABSENT (no manifest — agent ungoverned)')
  line('layer 4', up ? 'present' : managed ? 'EXPECTED but backend down' : 'absent (normal for bring-your-own-agent)')

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
  if (!body) { console.error('spex self: no surface:system nodes in this .spec tree — the contract is empty.'); return 0 }
  console.log(body)
  return 0
}

// raw environment facts doctor reasons over — for debugging the diagnosis itself.
function env(): number {
  const cwd = process.cwd()
  const facts: Record<string, string> = {
    cwd,
    repoRoot: repoRoot(cwd) ?? '(not a git repo)',
    branch: git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? '—',
    node: process.version,
    CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID ?? '',
    CODEX_THREAD_ID: process.env.CODEX_THREAD_ID ?? '',
    SPEXCODE_API_URL: process.env.SPEXCODE_API_URL ?? '(default :8787)',
    'PATH spex': resolveOnPath('spex') ?? '(not on PATH)',
    tmux: process.env.TMUX ? 'inside tmux' : 'no',
  }
  for (const [k, v] of Object.entries(facts)) console.log(`${k.padEnd(24)}: ${v}`)
  return 0
}

// install/uninstall are STAGED: wiring layer-3 hooks into a standalone repo is only SAFE once the hooks
// detect a missing managed session and degrade. So the diagnosis ships first; the installer lands behind it.
function noteStaged(verb: string): number {
  console.error(`spex self ${verb} is not available yet — it is staged behind the hook-degradation prerequisite
(the live hooks must detect a missing managed session and degrade before they can be safely wired into your
own agent's config). Meanwhile: \`spex self doctor\` reports your coverage, and \`spex self contract\` prints
the workflow text you can hand any agent.`)
  return 2
}

function usage(): number {
  console.error(`spex self — diagnose how the SpexCode workflow reaches your agent
  doctor       per-layer report: preconditions · git-hook floor · contract · hooks(+handlers) · backend · footprint  (default)
  contract     print the surface:system contract text (hand it to any agent)
  env          raw environment facts the diagnosis reads
  install      [staged] wire the materialized contract + hooks into your agent  (--agent claude, --minimal)
  uninstall    [staged] reverse exactly what install wrote`)
  return 0
}

export async function runSelf(args: string[]): Promise<number> {
  switch (args[0] ?? 'doctor') {
    case 'doctor': return await doctor()
    case 'contract': return contract()
    case 'env': return env()
    case 'install': return noteStaged('install')
    case 'uninstall': return noteStaged('uninstall')
    case 'help': case '--help': case '-h': return usage()
    default: console.error(`spex self: unknown subcommand "${args[0]}"`); usage(); return 2
  }
}
