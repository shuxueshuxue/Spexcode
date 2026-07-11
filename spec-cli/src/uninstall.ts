import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
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
// inviolable rule: the user's spec ASSET (.spec/.config) is NEVER touched — uninstall removes only generated
// WIRING, not the spec graph that wiring served.

// the standard plugin-host folders a host agent scans (in addition to any named in spexcode.json's `harnesses`).
const DEFAULT_PLUGIN_HOSTS = ['.claude', '.codex'] as const

// is this dir a SpexCode plugin bundle? Either its folder name is the identity stamp, or its
// `.claude-plugin/plugin.json` declares `name: spexcode`. Read-gated so a user's other plugin is never touched.
function isSpexcodeBundle(dir: string): boolean {
  if (dir.split('/').pop() === 'spexcode') return true
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

// remove the SpexCode git hooks — but ONLY a hook whose content carries a SpexCode identity marker, so a user's
// own pre-commit is never deleted. Per-clone hooks are preserved by default; this runs only under `--hooks`.
function removeHooks(proj: string): string[] {
  const dir = hooksDir(proj)
  if (!dir) return []
  const removed: string[] = []
  for (const name of ['pre-commit', 'prepare-commit-msg']) {
    const f = join(dir, name)
    if (existsSync(f) && /spexcode/i.test(readFileSync(f, 'utf8'))) {
      rmSync(f, { force: true })
      removed.push(name)
    }
  }
  return removed
}

export function uninstall(targetArg: string | undefined, opts: { hooks?: boolean } = {}): void {
  const proj = resolve(targetArg ?? process.cwd())
  console.log(`spex uninstall → ${proj}`)

  // cwd = the project so the .config loaders read THIS tree's surface nodes (the live skill/agent names tell
  // each adapter's clean() exactly which name-scoped on-demand files were its to remove).
  const prevCwd = process.cwd()
  let arts: HarnessArtifacts = { skills: [], agents: [] }
  try {
    process.chdir(proj)
    arts = { skills: loadSkillConfig().map((s) => s.name), agents: loadAgentConfig().map((a) => a.name) }
  } catch {
    // no readable .config (already partly torn down, or never adopted) — clean still strips the harness wiring.
  } finally {
    process.chdir(prevCwd)
  }

  // 1+2. materialize(∅): every harness's artifacts (contract block, shim, trust, skills/agents), the managed
  //    .gitignore + info/exclude blocks, any legacy skip-worktree bit, and the content filter — the SAME
  //    erase phase every materialize runs, asserted against the empty policy. One inverse, never a parallel one.
  dematerialize(proj, arts)

  // 3. the global per-project store — the per-tree materialize slots (trees/<enc>: manifest + content-hash +
  //    plugin ledger), any legacy pre-slot manifest, and the session records. This is the runtime tier,
  //    not the user's spec asset, so the whole dir is ours.
  let store: string | null = null
  try {
    store = runtimeRoot(proj)
    rmSync(store, { recursive: true, force: true })
  } catch {
    store = null
  }

  // 4. any spexcode-stamped plugin bundle, under the configured + standard plugin-host folders.
  let pluginHosts: string[] = [...DEFAULT_PLUGIN_HOSTS]
  try {
    const targets = resolveHarnessTargets(readConfig(mainCheckout(proj)).harnesses)
    pluginHosts = [...pluginHosts, ...targets.filter((t) => t.kind === 'plugin').map((t) => (t as { folder: string }).folder)]
  } catch {
    // an illegal harnesses set doesn't block backout — fall through to the standard hosts.
  }
  const bundles = sweepPluginBundles(proj, pluginHosts)

  console.log(`✓ dematerialized (contract blocks, shims, Codex trust, skills, sub-agents, ignore blocks, content filter) for ${HARNESSES.map((h) => h.id).join(', ')}`)
  if (store) console.log(`✓ removed the global per-project store (${store})`)
  if (bundles.length) console.log(`✓ removed plugin bundle(s): ${bundles.join(', ')}`)

  // git hooks are per-clone and may carry user logic → preserved unless --hooks (and even then only a hook that
  // carries a SpexCode identity marker).
  if (opts.hooks) {
    const removed = removeHooks(proj)
    if (removed.length) console.log(`✓ removed git hooks (${removed.join(', ')})`)
    else console.log('• no spexcode git hooks to remove')
  } else {
    console.log('• left git hooks in place (per-clone; pass --hooks to remove the spexcode ones)')
  }

  console.log(`
SpexCode wiring removed. Your spec data is untouched:
  • .spec/ and .config/ remain — your spec graph is YOURS, never deleted by uninstall.
  • To re-adopt later: \`spex init\` regenerates the shims, contract, trust, and global store.`)
}
