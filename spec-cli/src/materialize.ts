import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, rmSync, rmdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { loadSystemConfig, loadSkillConfig, loadAgentConfig, loadConfig } from './specs.js'
import { compileManifest } from './hooks.js'
import { writeManagedBlock, removeManagedBlock, HARNESSES, type HarnessArtifacts } from './harness.js'
import { git } from './git.js'
import { runtimeRoot, mainCheckout, readConfig } from './layout.js'
import { resolveHarnessTargets, partitionHarnesses } from './harness-select.js'
import { emitPlugin, cleanPlugin, pluginBundleDir, pluginVersion } from './plugin-harness.js'
import { plantContractFilter, removeContractFilter, settleIndexStat } from './contract-filter.js'

// @@@ materialize - the "pay-per-change" node step (≈0.85s) the cheap shell gate invokes ONLY when the
// content-hash moved. It renders the spec tree's surface nodes into the flat artifacts each consumer reads
// cheaply, so a USER-self-launched claude/codex (no SpexCode process in the launch) gets the whole system via
// harness-auto-discovered files: (1) the hook MANIFEST (our dispatcher reads it), (2) the CONTRACT — the
// tracked docs guide (docs/AGENT_GUIDE.md) FOLLOWED BY the surface:system bodies — written WHOLE into each
// harness's contract file(s), (3) the thin SHIMS (every event → dispatch.sh), (4) the per-harness TRUST
// (Codex's deterministic trusted_hash; Claude none). EVERY harness-specific fact is owned by the
// [[harness-adapter]] (harness.ts) — this file just loops over HARNESSES.
//
// THE FORGETTING LAW ([[harness-delivery]]): materialize(P₂) ∘ materialize(P₁) = materialize(P₂) — a render
// under the current policy fully forgets every prior policy's artifacts; idempotence is the special case
// P₂ = P₁, and dematerialize (= materialize(∅), what `spex uninstall` builds on) is the empty policy. The
// implementation is ERASE-THEN-ASSERT over a CLOSED set of landing points: each is first erased
// unconditionally by its IDENTITY STAMP (sentinel blocks, the shim's dispatch.sh command line, the generated
// mark on skills/agents, the filter config namespace, the skip-worktree bit), then rewritten per the current
// policy (possibly to nothing). No ledger of past states, no pairwise migration branches — the erase IS the
// migration, whatever the previous state was.

const PKG = fileURLToPath(new URL('..', import.meta.url))                 // installed spec-cli root
const DISPATCH = join(PKG, 'hooks', 'dispatch.sh')
// the ONE spex entry: the launcher (bin/spex.mjs), never a raw `tsx cli.ts` pair — the launcher owns tsx
// resolution AND the mid-merge guard (a conflicted source tree degrades to one line + exit 75, not an
// esbuild stacktrace), so every hook-baked callback inherits both.
const SPEX = join(PKG, 'bin', 'spex.mjs')
// the manifest + content-hash marker render into the GLOBAL per-project store (layout.runtimeRoot), NOT the
// worktree — the worktree keeps zero SpexCode-rendered runtime; only the harness-discovered contract files +
// shims (which the harness must find in-tree) are written under proj below.

// the deterministic content fingerprint of the config roots + THE RENDERER ITSELF. ONE definition —
// `hp_config_hash` in the shell mirror (harness.sh) — which the dispatch.sh gate ALSO calls, so the gate and
// this renderer can never disagree on "changed". It folds in hp_renderer_version (the toolchain-side content
// hash), so a TOOLCHAIN update moves the key and the next gate self-heals the rendered artifacts — closing
// the "toolchain updated but nothing re-materialized" hole ([[harness-delivery]]).
export function contentHash(proj: string): string {
  try {
    const harnessSh = join(PKG, 'hooks', 'harness.sh')
    return execFileSync('bash', ['-c', `cd "${proj}" && . "${harnessSh}" && hp_config_hash`]).toString().trim()
  } catch { return '' }
}

// @@@ render policy ([[render-policy]]) - ONE share axis, voted only for the machine-independent RENDERS.
// `.spec` + `spexcode.json` are ALWAYS tracked (git is the database — no knob can untrack them); machine
// facts (shims, spexcode.local.json) are ALWAYS ignored; run residue (.worktrees/) is always ignored. The
// vote decides where the renders (contract blocks, skills, agents) sit — and, recursively, where their
// ignore rules live: `committed` drops the render entries from the ignore block (the renders are ordinary
// committed files), `ignored` (default) keeps the block in the TRACKED .gitignore, `hidden` moves the whole
// block to the per-clone .git/info/exclude and covers a HOST-TRACKED contract file with the clean/smudge
// content filter ([[content-filter]]) instead of the retired skip-worktree bit.
export type RenderPolicy = 'committed' | 'ignored' | 'hidden'
export function resolveRenderPolicy(cfg: { render?: string; private?: boolean }, proj?: string): RenderPolicy {
  const r = cfg.render?.trim()
  if (r) {
    if (r !== 'committed' && r !== 'ignored' && r !== 'hidden') {
      const err = new Error(`invalid render policy '${r}' — the render axis has three words: committed | ignored | hidden (see \`spex guide footprint\`)`)
      err.name = 'ConfigError'
      throw err
    }
    return r
  }
  if (cfg.private) {
    // LEGACY private:true — the retired untrack-private mode. Its render half maps to 'hidden'; its
    // data-untrack half is GONE (the spec sources are always tracked now). Loud, non-fatal: the deployment
    // keeps working while the notice names the two migration moves.
    let untracked: string[] = []
    if (proj) untracked = ['.spec', 'spexcode.json'].filter((p) => existsSync(join(proj, p)) && !isTracked(proj, p))
    console.error(
      `spexcode: \`private: true\` is retired — reading it as \`"render": "hidden"\`.\n` +
      `  → migrate spexcode.local.json: replace "private": true with "render": "hidden".` +
      (untracked.length
        ? `\n  → your spec sources are still untracked (${untracked.join(' + ')}); the untrack-private mode is gone, so track them once:\n` +
          `      git add ${untracked.join(' ')}   (then commit on your branch)\n` +
          `    WARNING: tracking is not retroactive secrecy — history already pushed elsewhere cannot be recalled.`
        : ''),
    )
    return 'hidden'
  }
  return 'ignored'
}

function gitCommonDirOf(proj: string): string {
  return git(['-C', proj, 'rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
}
function infoExcludePath(proj: string): string {
  return join(gitCommonDirOf(proj), 'info', 'exclude')
}
function isTracked(proj: string, file: string): boolean {
  try { git(['-C', proj, 'ls-files', '--error-unmatch', file]); return true } catch { return false }
}
// clear a legacy skip-worktree bit (the retired private-overlay mechanism; erase-only now — nothing asserts
// it). Best-effort: an index race or a non-repo must not fail the render.
function clearSkipWorktree(proj: string, file: string): void {
  if (!isTracked(proj, file)) return
  try { git(['-C', proj, 'update-index', '--no-skip-worktree', file]) } catch { /* best-effort */ }
}

// the identity stamp on every generated skill/agent file — what lets the erase phase forget a product whose
// NODE was renamed or deleted (the name-scoped sweep can only reconstruct paths the LIVE config still names).
const GENERATED_MARK = '<!-- spexcode:generated -->'
function sweepGeneratedSkills(dir: string | null): void {
  if (!dir || !existsSync(dir)) return
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const f = join(dir, e.name, 'SKILL.md')
    try { if (existsSync(f) && readFileSync(f, 'utf8').includes(GENERATED_MARK)) rmSync(join(dir, e.name), { recursive: true, force: true }) } catch { /* unreadable → not provably ours */ }
  }
}
function sweepGeneratedAgents(dir: string | null): void {
  if (!dir || !existsSync(dir)) return
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue
    const f = join(dir, e.name)
    try { if (readFileSync(f, 'utf8').includes(GENERATED_MARK)) rmSync(f, { force: true }) } catch { /* unreadable → not provably ours */ }
  }
}

// @@@ dematerialize - materialize(∅): the ERASE phase, also the whole of a backout ([[spex-uninstall]] adds
// only the global store + plugin sweep + optional git hooks on top). Every removal is gated on an identity
// stamp, so it deletes ONLY what a render wrote — never the user's prose, settings, or any .spec data. Order
// matters once: the managed blocks leave the WORKING contract files before the content filter's config goes
// (edge ③ in [[content-filter]] — a block outliving its clean filter surfaces as an uncommitted change).
// `arts` (live skill/agent node names) widens the sweep to pre-stamp legacy files; the GENERATED_MARK sweep
// covers everything rendered since, including products of renamed/deleted nodes.
export function dematerialize(proj = process.cwd(), arts: HarnessArtifacts = { skills: [], agents: [] }): void {
  for (const h of HARNESSES) {
    // h.clean = the adapter's surgical inverse: contract block (sentinels, deleteIfEmpty), the dispatch.sh-
    // stamped shim + worktree anchor, the trust block, and the arts-named skill/agent files.
    h.clean(proj, arts)
    for (const f of h.contractFiles(proj)) clearSkipWorktree(proj, f)   // legacy private-overlay bit — erase-only
    sweepGeneratedSkills(h.skillDir(proj))
    sweepGeneratedAgents(h.agentDir(proj))
  }
  removeManagedBlock(join(proj, '.gitignore'), ['# ', ''], true)
  try { removeManagedBlock(infoExcludePath(proj), ['# ', ''], false) } catch { /* not a git repo */ }
  removeContractFilter(proj)                                            // AFTER the blocks left the working files
  // the block-strip left tracked contract files stat-dirty (under a filter git NEVER content-verifies them,
  // and even unfiltered the phantom-`M` lingers) — settle the index stat, content-guarded so a user's real
  // unstaged edit is never staged ([[content-filter]] edge 2).
  try { settleIndexStat(proj, HARNESSES.flatMap((h) => h.contractFiles(proj))) } catch { /* not a git repo */ }
  // leaving nothing behind: drop the now-EMPTY dirs the assert phase mkdir'ed (.claude/.codex and their
  // skills/agents subdirs — children listed before parents). rmdirSync is NON-recursive, so a dir holding
  // any user file survives untouched; `.git/spexcode/` is deliberately NOT swept (shared per-clone home).
  for (const h of HARNESSES) {
    const anchor = h.worktreeHookAnchor(proj)
    for (const d of [h.skillDir(proj), h.agentDir(proj), dirname(h.shimFile(proj)), anchor ? dirname(anchor) : null])
      if (d) { try { rmdirSync(d) } catch { /* non-empty or absent — keep */ } }
  }
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
  const guidePath = join(proj, 'docs', 'AGENT_GUIDE.md')
  const guide = existsSync(guidePath) ? readFileSync(guidePath, 'utf8').trim() : ''
  const systemBodies = loadSystemConfig().map((c) => c.body.trim()).filter(Boolean)
  const contract = [guide, ...systemBodies].filter(Boolean).join('\n\n')
  // WHICH harnesses to deliver into ([[harness-select]]): the spexcode.json `harnesses` set (default = every
  // native harness). resolveHarnessTargets FAILS LOUD on an illegal set (plugin+native, plugin w/o folder).
  const cfg = readConfig(mainCheckout(proj))
  const targets = resolveHarnessTargets(cfg.harnesses)
  const policy = resolveRenderPolicy(cfg, proj)                           // [[render-policy]] — committed | ignored | hidden
  const { selected, plugins } = partitionHarnesses(targets)
  const skillNodes = loadSkillConfig()
  const agentNodes = loadAgentConfig()
  const commandNodes = loadConfig()
  const arts: HarnessArtifacts = { skills: skillNodes.map((s) => s.name), agents: agentNodes.map((a) => a.name) }

  // ---- ERASE (the forgetting law): every landing point cleared by identity stamp, whatever policy — or
  // legacy mode — wrote it last. Unselected harnesses need no separate prune branch: the erase already
  // forgot them, and only the selected ones are asserted below.
  dematerialize(proj, arts)

  // ---- ASSERT: rewrite each landing point per the CURRENT policy.
  // a skill node → the agentskills.io SKILL.md primitive: `name`+`description` frontmatter (the load-trigger)
  // over the body instructions, closed by the GENERATED_MARK identity stamp (what the erase phase keys on).
  // One pure render shared by every harness — divergence is only its skillDir.
  const renderSkill = (sk: { name: string; desc: string; body: string }) =>
    `---\nname: ${sk.name}\ndescription: ${JSON.stringify(sk.desc)}\n---\n\n${sk.body}\n\n${GENERATED_MARK}\n`
  // an agent node → a coding-agent sub-agent definition (the same primitive .claude/agents/*.md ships): the
  // node's `desc` is the on-demand load-trigger, its `tools` the harness tool allowlist, its body the agent's
  // system prompt. Same stamp, same reason.
  const renderAgent = (ag: { name: string; desc: string; tools: string[]; body: string }) =>
    `---\nname: ${ag.name}\ndescription: ${ag.desc}\ntools: ${ag.tools.join(', ')}\n---\n\n${ag.body}\n\n${GENERATED_MARK}\n`
  // a command node → a host `/`-menu command file: plugin-only (the native path serves command presets via
  // the dashboard /api/slash-commands instead).
  const renderCommand = (cm: { desc: string; body: string }) =>
    (cm.desc ? `---\ndescription: ${JSON.stringify(cm.desc)}\n---\n\n` : '') + `${cm.body}\n`
  // two ignore classes, split because only `committed` treats them differently: RENDERS are machine-
  // independent products the team may choose to commit; MACHINE paths (shims bake this install's abs path,
  // bundles too) are never committable under any policy.
  const renderPaths: string[] = []
  const machinePaths: string[] = []
  for (const h of selected) {
    if (contract) for (const f of h.contractFiles(proj)) { writeManagedBlock(f, contract); renderPaths.push(f) }
    const shimFile = h.shimFile(proj)
    mkdirSync(dirname(shimFile), { recursive: true })
    const shim = h.shim(DISPATCH, SPEX)
    writeFileSync(shimFile, shim.json)
    h.writeTrust(proj, shim.cmd)
    machinePaths.push(shimFile)
    // a linked-worktree ANCHOR copy of the shim, when the harness needs one (codex: the shim lives at the main
    // checkout, so the worktree gets no `.codex/` unless we place one). One adapter line; null otherwise.
    const anchor = h.worktreeHookAnchor(proj)
    if (anchor) { mkdirSync(dirname(anchor), { recursive: true }); writeFileSync(anchor, shim.json); machinePaths.push(anchor) }
  }
  // (6) skills + (7) sub-agents — each surface node → the file the harness auto-discovers, one per selected
  //     harness that has the primitive (skillDir/agentDir null skips — the divergence is the adapter's line).
  for (const sk of skillNodes) {
    for (const h of selected) {
      const dir = h.skillDir(proj); if (!dir) continue
      const f = join(dir, sk.name, 'SKILL.md')
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, renderSkill(sk))
      renderPaths.push(f)
    }
  }
  for (const ag of agentNodes) {
    for (const h of selected) {
      const dir = h.agentDir(proj); if (!dir) continue
      const f = join(dir, `${ag.name}.md`)
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, renderAgent(ag))
      renderPaths.push(f)
    }
  }
  // (8) the PLUGIN target ([[plugin-harness]]): render the whole system into one self-contained Claude-plugin
  //     bundle per selected folder. A plugin is EXCLUSIVE (`selected` is empty then). Pruning a DESELECTED
  //     folder needs the PREVIOUS folder set, which the live config no longer names — the one landing point
  //     the identity-stamped erase cannot enumerate (a folder is an arbitrary path) — so a tiny ledger in the
  //     global store records the folders emitted last run; any prev folder absent from the current set is
  //     clean()ed, then the current folders are emitted and the ledger rewritten.
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
  // (9) the ignore rules — themselves an artifact whose HOME the same axis decides ([[render-policy]]):
  //     committed/ignored → a managed `#` block in the TRACKED .gitignore (the team sees the rule);
  //     hidden → the identical block in the per-clone .git/info/exclude (zero repo footprint).
  // Entries must be CHECKOUT-INVARIANT: `.gitignore` is ONE tracked file shared by the main checkout and
  // every worktree, so each entry is anchored to the checkout it LIVES under — proj-relative when inside
  // proj, else MAIN-checkout-relative (the codex shim resolves to `.codex/hooks.json` from any checkout; a
  // pattern naming a main-only path is a harmless no-op in a worktree). A path under neither root is dropped.
  const mc = mainCheckout(proj)
  const anchor = (abs: string): string | null => {
    const p = relative(proj, abs); if (!p.startsWith('..')) return p
    const m = relative(mc, abs); if (!m.startsWith('..')) return m
    return null
  }
  // machine facts + run residue, ignored under EVERY policy: the shims/anchors/bundles (bake this install's
  // abs path), spexcode.local.json (the host overlay — a `git add -A` must never leak it), and the session
  // residue (`.worktrees/` where launches plant worktrees; `.session` is the legacy per-worktree state file
  // an old backend wrote). Static strings stay checkout-invariant.
  const bundlePaths = curFolders.map((f) => pluginBundleDir(proj, f))
  const machineEntries = [
    ...[...machinePaths, ...bundlePaths].map(anchor).filter((p): p is string => p !== null),
    'spexcode.local.json', '.worktrees/', '.session',
  ]
  const renderEntries = renderPaths.map(anchor).filter((p): p is string => p !== null)
  const entries = (list: string[]) => [...new Set(list)].sort().join('\n')
  if (policy === 'hidden') {
    writeManagedBlock(infoExcludePath(proj), entries([...machineEntries, ...renderEntries]), ['# ', ''])
    // a HOST-TRACKED contract file cannot be ignored — cover it with the clean/smudge content filter
    // ([[content-filter]]) so the block lives in the working tree while the index keeps the pristine prose.
    // Untracked contract files are wholly ours: generate + exclude suffices, no filter (weakest tool).
    const trackedContracts = selected
      .flatMap((h) => h.contractFiles(proj))
      .filter((f) => contract && isTracked(proj, f))
    if (trackedContracts.length) plantContractFilter(proj, trackedContracts, contract)
  } else {
    // committed: the renders become ordinary committed files — ONLY their entries leave the block.
    const list = policy === 'committed' ? machineEntries : [...machineEntries, ...renderEntries]
    if (list.length) writeManagedBlock(join(proj, '.gitignore'), entries(list), ['# ', ''])
  }
  // (5) stamp the content-hash marker LAST (so a crash mid-render leaves it stale → re-renders next gate).
  const h = contentHash(proj)
  writeFileSync(join(rt, 'content-hash'), h)
  return h
}
