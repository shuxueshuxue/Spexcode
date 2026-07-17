import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, rmSync, rmdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { loadSystemConfig, loadSkillConfig, loadAgentConfig, loadConfig } from './specs.js'
import { compileManifest } from './hooks.js'
import { writeManagedBlock, removeManagedBlock, HARNESSES, type HarnessArtifacts } from './harness.js'
import { git } from './git.js'
import { runtimeRoot, treeSlotDir, mainCheckout, readConfig } from './layout.js'
import { resolveHarnessTargets, partitionHarnesses } from './harness-select.js'
import { emitPlugin, cleanPlugin, pluginBundleDir, pluginVersion } from './plugin-harness.js'
import { plantContractFilter, removeContractFilter, settleIndexStat } from './contract-filter.js'

// @@@ materialize - the materialize step (≈0.85s), anchored on GIT-NATIVE events only ([[commit-surgery]]):
// spex verbs (init/materialize), session-worktree creation, and the planted git hooks (pre-commit,
// post-checkout, post-merge) — never a harness event; the harness is a READER of the materialized files, not
// a trigger. It turns the spec tree's surface nodes into the flat artifacts each consumer reads
// cheaply, so a USER-self-launched claude/codex (no SpexCode process in the launch) gets the whole system via
// harness-auto-discovered files: (1) the hook MANIFEST (our dispatcher reads it), (2) the CONTRACT — the
// tracked docs guide (docs/AGENT_GUIDE.md) FOLLOWED BY the surface:system bodies — written WHOLE into each
// harness's contract file(s), (3) the thin SHIMS (every event → dispatch.sh), (4) the per-harness TRUST
// (Codex's deterministic trusted_hash; Claude none). EVERY harness-specific fact is owned by the
// [[harness-adapter]] (harness.ts) — this file just loops over HARNESSES.
//
// THE FORGETTING LAW ([[harness-delivery]]): materialize(P₂) ∘ materialize(P₁) = materialize(P₂) — one pass
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
// the manifest + content-hash marker + plugin-folder ledger land in the materialized TREE's own slot of the
// GLOBAL per-project store (layout.treeSlotDir — trees/<enc-worktree>), NOT the worktree and NOT one shared
// per-project file: each is a pure function of ONE tree's .plugins, and the old single slot let the last-
// materialized tree's hook set reach every other tree's dispatch ([[hook-dispatch]]). The worktree keeps
// zero SpexCode-materialized runtime; only the harness-discovered contract files + shims (which the harness
// must find in-tree) are written under proj below.

// the deterministic content fingerprint of the config roots + THE TOOLCHAIN ITSELF (`hp_config_hash` in the
// shell mirror, harness.sh). Stamped as a freshness record after every materialize; it folds in
// hp_toolchain_version (the toolchain-side content hash), so a stale stamp is diagnosable after a toolchain
// update ([[harness-delivery]]).
export function contentHash(proj: string): string {
  try {
    const harnessSh = join(PKG, 'hooks', 'harness.sh')
    return execFileSync('bash', ['-c', `cd "${proj}" && . "${harnessSh}" && hp_config_hash`]).toString().trim()
  } catch { return '' }
}

// @@@ footprint kinds ([[residence]]) - the vote axis is RETIRED: materialized artifacts carry no facts, so
// they are NEVER tracked — there is exactly ONE residence behavior, not three. `.spec` + `spexcode.json` are ALWAYS
// tracked (git is the database — no knob can untrack them); machine facts (shims, spexcode.local.json),
// run residue (.worktrees/), and wholly-ours artifacts are hidden by the per-clone .git/info/exclude (the
// host's tracked .gitignore is never touched); a contract file the host TRACKS — or one the user has begun
// writing THEIR OWN prose into — is covered by the clean/smudge content filter ([[content-filter]]). An
// environment without the generator (a teammate's clone, CI, a cloud agent) runs `spex materialize` in its
// setup step — there is no committed-artifact delivery mode.
export function retiredAxisNotice(cfg: { render?: string; private?: boolean }): void {
  if (!cfg.render?.trim() && !cfg.private) return
  const field = cfg.render?.trim() ? `"render": "${cfg.render.trim()}"` : '"private": true'
  console.error(
    `spexcode: the render vote is retired — ${field} is ignored. Materialized artifacts are never tracked:\n` +
    `  ignore rules live in the per-clone .git/info/exclude, a host-tracked contract file is covered by the\n` +
    `  clean/smudge filter, and a clone without spex runs \`spex materialize\` in its setup step. Remove the\n` +
    `  field from spexcode.json / spexcode.local.json to retire this notice (see \`spex guide footprint\`).`,
  )
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

// @@@ contract kind detection ([[residence]]) - a contract file's residence is a LIVE CONTENT FACT, not
// an install-time choice, re-judged on every materialize: TRACKED → filter domain; untracked + wholly ours
// (nothing left after stripping our sentinel block) → exclude domain; untracked + HOST CONTENT present (the
// user began writing their own prose into it) → neither hidden nor tracked-for-them: the exclude entry is
// withheld (hiding user content would make their prose invisible to git — data-loss shaped) and the clean
// filter is pre-armed so their eventual, entirely-their-own `git add` strips our block automatically.
const SENTINEL_RE = /\n*<!-- spexcode:start -->[\s\S]*?<!-- spexcode:end -->\n*/
export function stripSpexcodeBlock(text: string): string {
  const m = SENTINEL_RE.exec(text)
  if (!m) return text
  // mirror removeManagedBlock exactly: our block + its surrounding blanks collapse to one '\n', and only a
  // block sitting at the TOP of the file drops the leading newline (a host file beginning with its own
  // blank lines keeps them — clean(smudge(x)) == x).
  const replaced = text.replace(SENTINEL_RE, '\n')
  return m.index === 0 ? replaced.replace(/^\n+/, '') : replaced
}
function hostContentOf(file: string): string {
  if (!existsSync(file)) return ''
  return stripSpexcodeBlock(readFileSync(file, 'utf8'))
}
// clear a legacy skip-worktree bit (the retired private-overlay mechanism; erase-only now — nothing asserts
// it). Best-effort: an index race or a non-repo must not fail the materialize.
function clearSkipWorktree(proj: string, file: string): void {
  if (!isTracked(proj, file)) return
  try { git(['-C', proj, 'update-index', '--no-skip-worktree', file]) } catch { /* best-effort */ }
}

// the identity stamp on every generated skill/agent file — what lets the erase phase forget a product whose
// NODE was renamed or deleted (the name-scoped sweep can only reconstruct paths the LIVE config still names).
export const GENERATED_MARK = '<!-- spexcode:generated -->'
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
// stamp, so it deletes ONLY what a materialize wrote — never the user's prose, settings, or any .spec data. Order
// matters once: the managed blocks leave the WORKING contract files before the content filter's config goes
// (edge ③ in [[content-filter]] — a block outliving its clean filter surfaces as an uncommitted change).
// `arts` (live skill/agent node names) widens the sweep to pre-stamp legacy files; the GENERATED_MARK sweep
// covers everything materialized since, including products of renamed/deleted nodes.
export function dematerialize(proj = process.cwd(), arts: HarnessArtifacts = { skills: [], agents: [] }): void {
  for (const h of HARNESSES) {
    // h.clean = the adapter's surgical inverse: contract block (sentinels, deleteIfEmpty), the dispatch.sh-
    // stamped shim + worktree anchor, the trust block, and the arts-named skill/agent files.
    h.clean(proj, arts)
    for (const f of h.contractFiles(proj)) clearSkipWorktree(proj, f)   // legacy private-overlay bit — erase-only
    sweepGeneratedSkills(h.skillDir(proj))
    sweepGeneratedAgents(h.agentDir(proj))
  }
  // same authorship rule as the contract files: deleteIfEmpty only when .gitignore is UNTRACKED (wholly-ours
  // generated file); a HOST-TRACKED .gitignore that carried nothing but our block is stripped, never deleted.
  removeManagedBlock(join(proj, '.gitignore'), ['# ', ''], !isTracked(proj, '.gitignore'))
  try { removeManagedBlock(infoExcludePath(proj), ['# ', ''], false) } catch { /* not a git repo */ }
  removeContractFilter(proj)                                            // AFTER the blocks left the working files
  // the block-strip left tracked contract files stat-dirty (under a filter git NEVER content-verifies them,
  // and even unfiltered the phantom-`M` lingers) — settle the index stat, content-guarded so a user's real
  // unstaged edit is never staged ([[content-filter]] edge 2).
  try { settleIndexStat(proj, HARNESSES.flatMap((h) => h.contractFiles(proj))) } catch { /* not a git repo */ }
  // leaving nothing behind: drop the now-EMPTY dirs the assert phase mkdir'ed (.claude/.codex/.opencode/.pi
  // and their skills/agents/plugins/extensions subdirs). Each dir AND its parent are swept deepest-first,
  // because a harness may nest its shim a level below its home (opencode's .opencode/plugins/, pi's
  // .pi/extensions/) — but never the checkout roots themselves. rmdirSync is NON-recursive, so a dir holding
  // any user file survives untouched; `.git/spexcode/` is deliberately NOT swept (shared per-clone home).
  for (const h of HARNESSES) {
    const anchor = h.worktreeHookAnchor(proj)
    const dirs = [h.skillDir(proj), h.agentDir(proj), dirname(h.shimFile(proj)), anchor ? dirname(anchor) : null]
      .filter((d): d is string => !!d)
    const roots = new Set([proj, mainCheckout(proj)])
    const sweep = [...new Set([...dirs, ...dirs.map((d) => dirname(d))])]
      .filter((d) => !roots.has(d))
      .sort((a, b) => b.length - a.length)
    for (const d of sweep) { try { rmdirSync(d) } catch { /* non-empty or absent — keep */ } }
  }
}

// the whole pay-per-change materialize. proj defaults to cwd. Returns the new content-hash it stamped.
export function materialize(proj = process.cwd()): string {
  const rt = treeSlotDir(proj)                                            // this tree's slot in the global store, not the worktree
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
  retiredAxisNotice(cfg)                                                  // [[residence]] — the vote axis is retired
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
  // One pure artifact builder shared by every harness — divergence is only its skillDir.
  const skillArtifact = (sk: { name: string; desc: string; body: string }) =>
    `---\nname: ${sk.name}\ndescription: ${JSON.stringify(sk.desc)}\n---\n\n${sk.body}\n\n${GENERATED_MARK}\n`
  // an agent node → a coding-agent sub-agent definition (the same primitive .claude/agents/*.md ships): the
  // node's `desc` is the on-demand load-trigger, its `tools` the harness tool allowlist, its body the agent's
  // system prompt. Same stamp, same reason.
  const agentArtifact = (ag: { name: string; desc: string; tools: string[]; body: string }) =>
    `---\nname: ${ag.name}\ndescription: ${ag.desc}\ntools: ${ag.tools.join(', ')}\n---\n\n${ag.body}\n\n${GENERATED_MARK}\n`
  // a command node → a host `/`-menu command file: plugin-only (the native path serves command presets via
  // the dashboard /api/slash-commands instead).
  const commandArtifact = (cm: { desc: string; body: string }) =>
    (cm.desc ? `---\ndescription: ${JSON.stringify(cm.desc)}\n---\n\n` : '') + `${cm.body}\n`
  // materialized artifacts and machine facts both land in the same per-clone exclude; contract files are kept separate
  // because their residence is the live three-state kind detection below, not a static entry.
  const artifactPaths: string[] = []
  const machinePaths: string[] = []
  const contractPaths: string[] = []
  for (const h of selected) {
    if (contract) for (const f of h.contractFiles(proj)) { writeManagedBlock(f, contract); contractPaths.push(f) }
    const shimFile = h.shimFile(proj)
    mkdirSync(dirname(shimFile), { recursive: true })
    const shim = h.shim(DISPATCH, SPEX)
    writeFileSync(shimFile, shim.content)
    h.writeTrust(proj, shim.cmd)
    machinePaths.push(shimFile)
    // a linked-worktree ANCHOR copy of the shim, when the harness needs one (codex: the shim lives at the main
    // checkout, so the worktree gets no `.codex/` unless we place one). One adapter line; null otherwise.
    const anchor = h.worktreeHookAnchor(proj)
    if (anchor) { mkdirSync(dirname(anchor), { recursive: true }); writeFileSync(anchor, shim.content); machinePaths.push(anchor) }
  }
  // (6) skills + (7) sub-agents — each surface node → the file the harness auto-discovers, one per selected
  //     harness that has the primitive (skillDir/agentDir null skips — the divergence is the adapter's line).
  for (const sk of skillNodes) {
    for (const h of selected) {
      const dir = h.skillDir(proj); if (!dir) continue
      const f = join(dir, sk.name, 'SKILL.md')
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, skillArtifact(sk))
      artifactPaths.push(f)
    }
  }
  for (const ag of agentNodes) {
    for (const h of selected) {
      const dir = h.agentDir(proj); if (!dir) continue
      const f = join(dir, `${ag.name}.md`)
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, agentArtifact(ag))
      artifactPaths.push(f)
    }
  }
  // (8) the PLUGIN target ([[plugin-harness]]): materialize the whole system into one self-contained Claude-plugin
  //     bundle per selected folder. A plugin is EXCLUSIVE (`selected` is empty then). Pruning a DESELECTED
  //     folder needs the PREVIOUS folder set, which the live config no longer names — the one landing point
  //     the identity-stamped erase cannot enumerate (a folder is an arbitrary path) — so a tiny ledger in the
  //     global store records the folders emitted last run; any prev folder absent from the current set is
  //     clean()ed, then the current folders are emitted and the ledger rewritten.
  const ledger = join(rt, 'plugin-folders')
  // migration: a tree last materialized pre-slot left its ledger as the project-global file — read it once as
  // the prev set so a deselected folder is still pruned; every write lands in the slot from here on.
  const legacyLedger = join(runtimeRoot(proj), 'plugin-folders')
  const ledgerSrc = existsSync(ledger) ? ledger : legacyLedger
  const prevFolders = existsSync(ledgerSrc) ? readFileSync(ledgerSrc, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : []
  const curFolders = plugins.map((p) => p.folder)
  for (const f of prevFolders) if (!curFolders.includes(f)) cleanPlugin(proj, f)
  if (plugins.length) {
    const bundle = {
      contract,
      skills: skillNodes.map((s) => ({ name: s.name, content: skillArtifact(s) })),
      agents: agentNodes.map((a) => ({ name: a.name, content: agentArtifact(a) })),
      commands: commandNodes.map((c) => ({ name: c.name, content: commandArtifact(c) })),
      spex: SPEX,
      version: pluginVersion(),
    }
    for (const p of plugins) emitPlugin(proj, p.folder, bundle)
  }
  writeFileSync(ledger, curFolders.join('\n'))
  // (9) the ignore rules — ALWAYS the per-clone .git/info/exclude ([[residence]]): the exclude is not a
  //     history guard (the pre-commit surgery owns history — [[commit-surgery]]) but the ignored-bit
  //     DECLARATION every other git door consults (checkout may overwrite, clean -fd spares, status/add -A/
  //     stash stay silent). The host's tracked .gitignore is never touched.
  // Entries must be CHECKOUT-INVARIANT: the exclude lives in the COMMON git dir shared by the main checkout
  // and every worktree, so each entry is anchored to the checkout it LIVES under — proj-relative when inside
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
  // the contract three-state ([[residence]]): tracked → filter; untracked+wholly-ours → exclude;
  // untracked+host-content → NO exclude (never hide user prose) + the clean filter pre-armed, so the user's
  // own eventual `git add` strips our block — tracking stays entirely their act.
  const filterContracts: string[] = []
  const oursContracts: string[] = []
  for (const f of contractPaths) {
    if (isTracked(proj, f) || hostContentOf(f).trim()) filterContracts.push(f)
    else oursContracts.push(f)
  }
  if (contract && filterContracts.length) plantContractFilter(proj, filterContracts, contract)
  const artifactEntries = [...artifactPaths, ...oursContracts].map(anchor).filter((p): p is string => p !== null)
  const entries = (list: string[]) => [...new Set(list)].sort().join('\n')
  writeManagedBlock(infoExcludePath(proj), entries([...machineEntries, ...artifactEntries]), ['# ', ''])
  // (5) stamp the content-hash marker LAST (a diagnostic freshness record; a crash mid-materialize leaves it stale).
  const h = contentHash(proj)
  writeFileSync(join(rt, 'content-hash'), h)
  return h
}
