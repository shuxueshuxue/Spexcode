import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { loadSystemConfig, loadSkillConfig, loadAgentConfig, loadConfig } from './specs.js'
import { compileManifest } from './hooks.js'
import { writeManagedBlock, removeManagedBlock, type HarnessArtifacts } from './harness.js'
import { git } from './git.js'
import { runtimeRoot, mainCheckout, readConfig } from './layout.js'
import { resolveHarnessTargets, partitionHarnesses } from './harness-select.js'
import { emitPlugin, cleanPlugin, pluginBundleDir, pluginVersion } from './plugin-harness.js'
import { tsxBin } from './tsx-bin.js'

// @@@ materialize - the "pay-per-change" node step (≈0.85s) the cheap shell gate invokes ONLY when the
// .config content-hash moved. It renders the spec tree's surface nodes into the flat artifacts each
// consumer reads cheaply, so a USER-self-launched claude/codex (no SpexCode process in the launch) gets the
// whole system via harness-auto-discovered files: (1) the hook MANIFEST (our dispatcher reads it),
// (2) the CONTRACT — the tracked docs guide (docs/AGENT_GUIDE.md) FOLLOWED BY the surface:system bodies —
// written WHOLE into each harness's contract file(s), which are GENERATED, gitignored artifacts (like the
// shims + skills): regenerated per clone/launch, never committed, so a self-launched agent still discovers
// guide + contract while the repo tracks only the guide source, (3) the thin SHIMS (every event → dispatch.sh),
// (4) the per-harness TRUST (Codex's deterministic trusted_hash; Claude none) so the self-launch is zero-prompt.
// EVERY harness-specific fact is owned by the [[harness-adapter]] (harness.ts) — this file just loops over
// HARNESSES, so adding a harness adds an adapter, not a branch here. All writes are idempotent + scoped. The
// content-hash marker is stamped last.

const PKG = fileURLToPath(new URL('..', import.meta.url))                 // installed spec-cli root
const DISPATCH = join(PKG, 'hooks', 'dispatch.sh')
const SPEX = `${tsxBin(PKG)} ${join(PKG, 'src', 'cli.ts')}`
// the manifest + content-hash marker render into the GLOBAL per-project store (layout.runtimeRoot), NOT the
// worktree — the worktree keeps zero SpexCode-rendered runtime; only the harness-discovered contract files +
// shims (which the harness must find in-tree) are written under proj below.

// the deterministic content fingerprint of the config roots. ONE definition — `hp_config_hash` in the shell
// mirror (harness.sh) — which the dispatch.sh gate ALSO calls, so the gate and this renderer can never disagree
// on "changed" (they used to inline the identical find-pipeline in two places, each commenting the other "MUST match").
export function contentHash(proj: string): string {
  try {
    const harnessSh = join(PKG, 'hooks', 'harness.sh')
    return execFileSync('bash', ['-c', `cd "${proj}" && . "${harnessSh}" && hp_config_hash`]).toString().trim()
  } catch { return '' }
}

// @@@ private overlay ([[private-overlay]]) - the DEFAULT render commits .spec + spexcode.json and ignores its
// generated wiring through a managed block in the TRACKED <repo>/.gitignore; that only truly hides a file that
// is wholly ours, so on a host that ALREADY tracks CLAUDE.md/AGENTS.md/.gitignore the folded-in block still
// lands in a tracked file and leaks. Private mode (spexcode.local.json `private:true`) closes that: it moves the
// ignore block to the per-clone `.git/info/exclude` (never committed), widens it to hide .spec + spexcode.json
// too, and `skip-worktree`s any TRACKED contract file so the block sits in the working copy (the harness still
// discovers it) yet never stages. Every step has an inverse the DEFAULT mode re-asserts, so the toggle is
// reversible and idempotent. It hides UNTRACKED paths; a pre-existing tracked .spec must be `git rm --cached`d
// once (the render can't untrack for you — reported, not silently ignored).
function gitCommonDirOf(proj: string): string {
  return git(['-C', proj, 'rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
}
function infoExcludePath(proj: string): string {
  return join(gitCommonDirOf(proj), 'info', 'exclude')
}
function isTracked(proj: string, file: string): boolean {
  try { git(['-C', proj, 'ls-files', '--error-unmatch', file]); return true } catch { return false }
}
// mark/unmark a TRACKED file skip-worktree (a no-op on an untracked path — info/exclude hides those instead).
// Best-effort: an index race or a non-repo must not fail the render.
function setSkipWorktree(proj: string, file: string, on: boolean): void {
  if (!isTracked(proj, file)) return
  try { git(['-C', proj, 'update-index', on ? '--skip-worktree' : '--no-skip-worktree', file]) } catch { /* best-effort */ }
}

// the whole pay-per-change render. proj defaults to cwd. Returns the new content-hash it stamped.
export function materialize(proj = process.cwd()): string {
  const rt = runtimeRoot(proj)                                            // global per-project store, not the worktree
  mkdirSync(rt, { recursive: true })
  // (1) hook manifest (persistent — the dispatcher reads it; regenerated only here, on change).
  writeFileSync(join(rt, 'hooks-manifest'), compileManifest())
  // (2) the contract = the tracked docs guide (the hand-written agent/contributor notes — the ONE piece of
  //     in-tree prose) FOLLOWED BY the surface:system bodies (in name order), written WHOLE into EACH harness's
  //     contract file(s) + (3) each harness's thin shim → dispatch.sh + (4) its trust. All owned by the adapter.
  //     The contract files are generated artifacts (gitignored below), so the guide is the single source a
  //     self-launched agent reads from — assembling it in keeps guide + contract reaching the agent together.
  const guidePath = join(proj, 'docs', 'AGENT_GUIDE.md')
  const guide = existsSync(guidePath) ? readFileSync(guidePath, 'utf8').trim() : ''
  const systemBodies = loadSystemConfig().map((c) => c.body.trim()).filter(Boolean)
  const contract = [guide, ...systemBodies].filter(Boolean).join('\n\n')
  // WHICH harnesses to deliver into ([[harness-select]]): the spexcode.json `harnesses` set (default = every
  // native harness). resolveHarnessTargets FAILS LOUD on an illegal set (plugin+native, plugin w/o folder).
  // selected harnesses are write()n below; unselected ones are clean()ed (pruned) after — so dropping a harness
  // from the config removes its products on the next re-materialize. The plugin EMITTER is a later node.
  const cfg = readConfig(mainCheckout(proj))
  const targets = resolveHarnessTargets(cfg.harnesses)
  const priv = !!cfg.private                                              // [[private-overlay]] — hide in .git/info/exclude + skip-worktree, not the tracked .gitignore
  const { selected, unselected, plugins } = partitionHarnesses(targets)
  const skillNodes = loadSkillConfig()
  const agentNodes = loadAgentConfig()
  const commandNodes = loadConfig()
  // a skill node → the agentskills.io SKILL.md primitive: `name`+`description` frontmatter (the load-trigger)
  // over the body instructions. One pure render shared by every harness — divergence is only its skillDir.
  const renderSkill = (sk: { name: string; desc: string; body: string }) =>
    `---\nname: ${sk.name}\ndescription: ${JSON.stringify(sk.desc)}\n---\n\n${sk.body}\n`
  // an agent node → a coding-agent sub-agent definition (the same primitive .claude/agents/*.md ships): the
  // node's `desc` is the on-demand load-trigger, its `tools` the harness tool allowlist, its body the agent's
  // system prompt. One pure render shared by every harness — divergence is only its agentDir.
  const renderAgent = (ag: { name: string; desc: string; tools: string[]; body: string }) =>
    `---\nname: ${ag.name}\ndescription: ${ag.desc}\ntools: ${ag.tools.join(', ')}\n---\n\n${ag.body}\n`
  // a command node → a host `/`-menu command file: the node's `desc` as the dropdown description over its body
  // (the preset prompt). Only the PLUGIN bundle ships these as files; the native path serves command presets via
  // the dashboard /api/slash-commands instead, so this render is plugin-only.
  const renderCommand = (cm: { desc: string; body: string }) =>
    (cm.desc ? `---\ndescription: ${JSON.stringify(cm.desc)}\n---\n\n` : '') + `${cm.body}\n`
  // shim ABSOLUTE paths; relativized into the managed .gitignore block below (checkout-invariant — see there).
  const shimPaths: string[] = []
  for (const h of selected) {
    if (contract) for (const f of h.contractFiles(proj)) { writeManagedBlock(f, contract); shimPaths.push(f); setSkipWorktree(proj, f, priv) }
    const shimFile = h.shimFile(proj)
    mkdirSync(dirname(shimFile), { recursive: true })
    const shim = h.shim(DISPATCH, SPEX)
    writeFileSync(shimFile, shim.json)
    h.writeTrust(proj, shim.cmd)
    shimPaths.push(shimFile)
  }
  // (6) skills - each `surface: skill` node → a SKILL.md the harness auto-discovers, written into every
  //     harness's own skillDir (Claude .claude/skills, Codex .codex/skills). Generated wiring, so the paths
  //     join the same managed .gitignore block below. A harness with no skill primitive (skillDir null) is skipped.
  for (const sk of skillNodes) {
    for (const h of selected) {
      const dir = h.skillDir(proj); if (!dir) continue
      const f = join(dir, sk.name, 'SKILL.md')
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, renderSkill(sk))
      shimPaths.push(f)   // reuse the same managed .gitignore block (absolute; relativized below)
    }
  }
  // (7) sub-agents - each `surface: agent` node → a <name>.md the harness auto-discovers, written into every
  //     harness's own agentDir (Claude .claude/agents). The SAME pattern as skills: generated wiring, so the
  //     paths join the same managed .gitignore block below. A harness with no agent primitive (agentDir null,
  //     e.g. Codex) is skipped — no `if (codex)`, the divergence is the adapter's agentDir line.
  for (const ag of agentNodes) {
    for (const h of selected) {
      const dir = h.agentDir(proj); if (!dir) continue
      const f = join(dir, `${ag.name}.md`)
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, renderAgent(ag))
      shimPaths.push(f)   // reuse the same managed .gitignore block (absolute; relativized below)
    }
  }
  // (8) PRUNE every UNSELECTED harness — clean() is the surgical inverse of the write above, removing ONLY this
  //     harness's own managed block + generated shim + trust + named skill/agent files. So narrowing the
  //     spexcode.json `harnesses` set (or switching to a plugin, which excludes all natives) removes the
  //     dropped harness's products here, the user's own prose/data untouched. The names tell clean exactly
  //     which on-demand artifacts were its to remove ([[harness-select]] / [[harness-adapter]]).
  const arts: HarnessArtifacts = { skills: skillNodes.map((s) => s.name), agents: agentNodes.map((a) => a.name) }
  for (const h of unselected) h.clean(proj, arts)
  // (8b) the PLUGIN target ([[plugin-harness]]): render the whole system into one self-contained Claude-plugin
  //      bundle per selected folder. A plugin is EXCLUSIVE (so `selected` is already empty — every native was
  //      pruned above). Pruning a DESELECTED plugin folder (plugin→native, or folder A→B) needs the PREVIOUS
  //      folder set, which the live config no longer names — so a tiny ledger in the global store records the
  //      folders emitted last run; any prev folder absent from the current set is clean()ed (the bundle's
  //      inverse), then the current folders are emitted and the ledger rewritten. Bounded + surgical: cleanPlugin
  //      is identity-gated on the bundle's own plugin.json.
  const ledger = join(rt, 'plugin-folders')
  const prevFolders = existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : []
  const curFolders = plugins.map((p) => p.folder)
  for (const f of prevFolders) if (!curFolders.includes(f)) cleanPlugin(proj, f)
  if (plugins.length) {
    const render = {
      contract,
      skills: skillNodes.map((s) => ({ name: s.name, content: renderSkill(s) })),
      agents: agentNodes.map((a) => ({ name: a.name, content: renderAgent(a) })),
      commands: commandNodes.map((c) => ({ name: c.name, content: renderCommand(c) })),
      spex: SPEX,
      version: pluginVersion(),
    }
    for (const p of plugins) emitPlugin(proj, p.folder, render)
  }
  writeFileSync(ledger, curFolders.join('\n'))
  // (4b) every artifact this render writes IN-TREE is generated wiring, so gitignore it — regenerated per
  // clone/launch by this same gate, never committed. That now includes the CONTRACT files (CLAUDE.md/AGENTS.md):
  // their whole content is the generated guide+system block, so they are artifacts exactly like the shims +
  // skills + sub-agents — the only tracked prose is the guide SOURCE (docs/AGENT_GUIDE.md), which this render
  // reads. Derived from the adapters' own contractFiles()/shimFile()/skillDir/agentDir, not hardcoded; written
  // as a managed `#` block so the user's own .gitignore is preserved.
  // The managed block must be CHECKOUT-INVARIANT: `.gitignore` is ONE tracked, committed file shared by the
  // main checkout and every worktree, so if the block differed by where materialize ran, whichever flavor got
  // committed would leave the OTHER checkout dirtying it on every render. The only artifact that varies is the
  // codex hooks shim, which materializes at the MAIN checkout (a linked worktree's codex reads the root's
  // hooks — see harness.ts): from main it is `.codex/hooks.json` (inside proj), from a worktree it is `../…`
  // (escapes proj). So an ignore entry is anchored to the checkout it LIVES under — proj-relative when inside
  // proj, else MAIN-checkout-relative — which resolves the codex shim to `.codex/hooks.json` from any checkout
  // (a pattern naming a main-only path is a harmless no-op in a worktree). Every checkout now emits the same
  // set → the committed `.gitignore` is stable, never re-dirtied. A path under neither root is not ignorable
  // here (dropped).
  const mc = mainCheckout(proj)
  const anchor = (abs: string): string | null => {
    const p = relative(proj, abs); if (!p.startsWith('..')) return p
    const m = relative(mc, abs); if (!m.startsWith('..')) return m
    return null
  }
  // spexcode.local.json — the machine-local config overlay (host-specific values, e.g. an absolute worker
  // launcher path; see portable-layout) — joins the SAME block on the same rationale: machine-specific, must
  // never be committed. Without it an adopter who follows our own guidance to put a host path there would
  // `git add -A` and leak it — the exact thing the overlay exists to prevent.
  // each emitted plugin bundle is a generated, machine-local artifact too (its hooks.json bakes THIS install's
  // SPEX path), so its dir joins the same managed block — regenerated per clone/launch, never committed.
  const bundlePaths = curFolders.map((f) => pluginBundleDir(proj, f))
  const ignorable = [...[...shimPaths, ...bundlePaths].map(anchor).filter((p): p is string => p !== null), 'spexcode.local.json']
  const gitignore = join(proj, '.gitignore')
  if (priv) {
    // PRIVATE ([[private-overlay]]): hide EVERYTHING — including the .spec tree + spexcode.json the DEFAULT
    // mode commits ("git is the database") — in the per-clone `.git/info/exclude` (never committed, never
    // shared), and strip any managed block a prior DEFAULT render left in the tracked .gitignore so switching
    // INTO private mode leaves the host's shared history clean.
    const entries = [...new Set([...ignorable, '.spec/', 'spexcode.json'])].sort().join('\n')
    writeManagedBlock(infoExcludePath(proj), entries, ['# ', ''])
    removeManagedBlock(gitignore, ['# ', ''], true)
    // the ONE manual step private mode can't do for you: .git/info/exclude hides UNTRACKED paths only, so a
    // .spec/spexcode.json ALREADY committed (a repo that adopted DEFAULT mode first) stays visible until
    // un-tracked. Surface it loudly rather than leaving a silent leak — the agent doing setup acts on this.
    const stillTracked = ['.spec', 'spexcode.json'].filter((p) => isTracked(proj, p))
    if (stillTracked.length) console.error(
      `spexcode private: ${stillTracked.join(' + ')} still git-tracked — private mode hides UNTRACKED paths only.\n` +
      `  → run once:  git rm -r --cached ${stillTracked.join(' ')}   (keeps the files on disk, stops tracking them; then commit on your branch)`,
    )
  } else {
    // DEFAULT: the checkout-invariant managed block in the TRACKED .gitignore (rationale above); strip any
    // private exclude block so switching OUT of private mode is equally clean.
    if (ignorable.length) writeManagedBlock(gitignore, [...new Set(ignorable)].sort().join('\n'), ['# ', ''])
    removeManagedBlock(infoExcludePath(proj), ['# ', ''], false)
  }
  // (5) stamp the content-hash marker LAST (so a crash mid-render leaves it stale → re-renders next gate).
  const h = contentHash(proj)
  writeFileSync(join(rt, 'content-hash'), h)
  return h
}
