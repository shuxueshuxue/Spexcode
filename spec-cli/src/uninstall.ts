import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { basename, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { HARNESSES, type HarnessArtifacts } from './harness.js'
import { runtimeRoot, readConfig, mainCheckout } from './layout.js'
import { resolveHarnessTargets } from './harness-select.js'
import { loadSkillConfig, loadAgentConfig } from './specs.js'
import { dematerialize } from './materialize.js'

// @@@ spex-uninstall - materialize(∅) plus the store: the in-tree/global-config backout IS dematerialize (the
// same identity-stamped erase phase every materialize runs first — the forgetting law's empty policy), and this
// command adds only what a materialize never owns per-run: the global per-project store, the plugin-bundle sweep,
// and the optional git hooks. EVERY removal is gated on a SpexCode IDENTITY STAMP (the managed-block
// sentinels, the shim's own dispatch.sh command line, the trust sentinels, the generated mark / name-scoped
// on-demand paths, the plugin name stamp), so it can only ever delete what SpexCode itself generated. The one
// inviolable rule: the user's tracked intent ASSET (.spec/.plugins + spexcode.json) is NEVER touched — uninstall
// removes only generated WIRING and local runtime state, not the spec graph and adoption config they served.

// the standard plugin-host folders a host agent scans (in addition to any named in spexcode.json's `harnesses`).
const DEFAULT_PLUGIN_HOSTS = ['.claude', '.codex', '.zcode'] as const

// Init and uninstall share one ownership source for generated git hooks: the shipped canonical templates.
// Exact bytes prove the destination is still our derivative; any user edit withdraws that ownership.
const HOOK_TEMPLATES = fileURLToPath(new URL('../templates/hooks', import.meta.url))

// is this dir a SpexCode plugin bundle? Either its folder name is the identity stamp, or its
// `.claude-plugin/plugin.json` declares `name: spexcode`. Read-gated so a user's other plugin is never touched.
function isSpexcodeBundle(dir: string): boolean {
  if (basename(dir) === 'spexcode') return true
  const manifest = join(dir, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifest)) return false
  try {
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name === 'spexcode'
  } catch {
    return false
  }
}

// sweep any spexcode-stamped plugin bundle (`<host>/plugins/spexcode`, or a `.claude-plugin/plugin.json` named
// spexcode) under the project's plugin-host folders. The bundle EMITTER is a later node, so a native-only install
// has nothing here today; the sweep keeps uninstall a true inverse once it lands (and cleans a hand-dropped one).
function sweepPluginBundles(proj: string, hosts: readonly string[]): string[] {
  const removed: string[] = []
  for (const host of new Set(hosts)) {
    const pluginsDir = join(proj, host, 'plugins')
    if (!existsSync(pluginsDir)) continue
    for (const e of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const dir = join(pluginsDir, e.name)
      if (isSpexcodeBundle(dir)) {
        rmSync(dir, { recursive: true, force: true })
        removed.push(relative(proj, dir))
      }
    }
  }
  return removed
}

// Arbitrary plugin landing folders are the one materialized path set that cannot be reconstructed from stamps
// alone, so materialize records them as data. Read every current per-tree ledger plus the legacy project-global
// ledger before uninstall removes the store; a stale bundle remains removable even after current config stopped
// naming its former host folder.
function pluginLedgerHosts(store: string): string[] {
  const ledgers = [join(store, 'plugin-folders')]
  const trees = join(store, 'trees')
  if (existsSync(trees)) {
    for (const e of readdirSync(trees, { withFileTypes: true })) {
      if (e.isDirectory()) ledgers.push(join(trees, e.name, 'plugin-folders'))
    }
  }
  const hosts: string[] = []
  for (const ledger of ledgers) {
    if (!existsSync(ledger)) continue
    hosts.push(...readFileSync(ledger, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean))
  }
  return hosts
}

// resolve the repo's shared git hooks dir (the common dir's hooks/), or null when <dir> isn't a git repo.
function hooksDir(proj: string): string | null {
  try {
    const common = execFileSync('git', ['-C', proj, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return join(common, 'hooks')
  } catch {
    return null
  }
}

// Remove only byte-identical products of the canonical hook templates. Enumerating the same template directory
// init copies keeps every generated hook covered without a second name list; modified and unrelated hooks survive.
function removeHooks(proj: string): string[] {
  const dir = hooksDir(proj)
  if (!dir) return []
  const removed: string[] = []
  for (const e of readdirSync(HOOK_TEMPLATES, { withFileTypes: true })) {
    if (!e.isFile()) continue
    const hook = join(dir, e.name)
    if (!existsSync(hook) || !readFileSync(hook).equals(readFileSync(join(HOOK_TEMPLATES, e.name)))) continue
    rmSync(hook, { force: true })
    removed.push(e.name)
  }
  return removed
}

export function uninstall(targetArg: string | undefined, opts: { hooks?: boolean } = {}): void {
  const proj = resolve(targetArg ?? process.cwd())
  console.log(`spex uninstall → ${proj}`)

  // cwd = the project so the .plugins loaders read THIS tree's surface nodes (the live skill/agent names tell
  // each adapter's clean() exactly which name-scoped on-demand files were its to remove).
  const prevCwd = process.cwd()
  let arts: HarnessArtifacts = { skills: [], agents: [] }
  try {
    process.chdir(proj)
    arts = { skills: loadSkillConfig().map((s) => s.name), agents: loadAgentConfig().map((a) => a.name) }
  } catch {
    // no readable .plugins (already partly torn down, or never adopted) — clean still strips the harness wiring.
  } finally {
    process.chdir(prevCwd)
  }

  // 1+2. materialize(∅): every harness's artifacts (contract block, shim, trust, skills/agents), the managed
  //    .gitignore + info/exclude blocks, any legacy skip-worktree bit, and the content filter — the SAME
  //    erase phase every materialize runs, asserted against the empty policy. One inverse, never a parallel one.
  dematerialize(proj, arts)

  // 3. Locate the global per-project store and recover every current/legacy plugin landing folder from its
  //    ledgers BEFORE deleting it. The store is the runtime tier, not the user's tracked intent asset.
  let store: string | null = null
  let ledgerHosts: string[] = []
  try {
    store = runtimeRoot(proj)
  } catch {
    store = null
  }
  if (store) ledgerHosts = pluginLedgerHosts(store)

  // 4. Any spexcode-stamped plugin bundle under configured, standard, or ledger-recovered hosts. The ledger
  //    input is what closes plugin-folder A -> native/folder B even when the previous materialize never finished.
  let pluginHosts: string[] = [...DEFAULT_PLUGIN_HOSTS, ...ledgerHosts]
  try {
    const targets = resolveHarnessTargets(readConfig(mainCheckout(proj)).harnesses)
    pluginHosts = [...pluginHosts, ...targets.filter((t) => t.kind === 'plugin').map((t) => (t as { folder: string }).folder)]
  } catch {
    // an illegal harnesses set doesn't block backout — fall through to the standard hosts.
  }
  const bundles = sweepPluginBundles(proj, pluginHosts)

  // 5. The whole store: per-tree manifests/hashes/ledgers, legacy project-global products, and sessions.
  let removedStore: string | null = null
  if (store && existsSync(store)) {
    rmSync(store, { recursive: true, force: true })
    removedStore = store
  }

  console.log(`✓ dematerialized (contract blocks, shims, Codex trust, skills, sub-agents, ignore blocks, content filter) for ${HARNESSES.map((h) => h.id).join(', ')}`)
  if (removedStore) console.log(`✓ removed the global per-project store (${removedStore})`)
  if (bundles.length) console.log(`✓ removed plugin bundle(s): ${bundles.join(', ')}`)

  // Git hooks are per-clone and may carry user logic → preserved unless --hooks (and even then only while
  // byte-identical to a canonical generated template; a user edit withdraws our ownership).
  if (opts.hooks) {
    const removed = removeHooks(proj)
    if (removed.length) console.log(`✓ removed git hooks (${removed.join(', ')})`)
    else console.log('• no spexcode git hooks to remove')
  } else {
    console.log('• left git hooks in place (per-clone; pass --hooks to remove the spexcode ones)')
  }

  console.log(`
SpexCode wiring removed. Your spec data is untouched:
  • .spec/ (including .plugins/) and spexcode.json remain — your tracked intent is never deleted by uninstall.
  • To re-adopt later: \`spex init\` regenerates the shims, contract, trust, and global store.`)
}
