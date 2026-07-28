import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, renameSync, rmSync, rmdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { loadSystemConfig, loadSkillConfig, loadAgentConfig, loadConfig } from './specs.js'
import { compileManifest } from './hooks.js'
import { writeManagedBlock, removeManagedBlock, HARNESSES, type HarnessArtifacts } from './harness.js'
import { git } from './git.js'
import { runtimeRoot, treeSlotDir, mainCheckout, readConfig, encodeProject } from './layout.js'
import { resolveHarnessTargets, partitionHarnesses } from './harness-select.js'
import { emitPlugin, cleanPlugin, pluginBundleDir, pluginVersion } from './plugin-harness.js'
import { plantContractFilter, removeContractFilter, retireLegacyContractBlock, settleIndexStat, type ContractFilterBinding, type ContractFilterPayload } from './contract-filter.js'

export type MaterializedArtifact = {
  kind: 'hook manifest' | 'contract' | 'shim' | 'skill' | 'agent' | 'plugin bundle' | 'trust'
  path: string
}
export type MaterializeResult = { contentHash: string; planted: MaterializedArtifact[] }

// @@@ materialize - the materialize step (≈0.85s), anchored on GIT-NATIVE events only ([[commit-surgery]]):
// spex verbs (init/materialize), session-worktree creation, and the planted git hooks (pre-commit,
// post-checkout, post-merge) — never a harness event; the harness is a READER of the materialized files, not
// a trigger. It turns the spec tree's surface nodes into the flat artifacts each consumer reads
// cheaply, so a USER-self-launched claude/codex (no SpexCode process in the launch) gets the whole system via
// harness-auto-discovered files: (1) the hook MANIFEST (our dispatcher reads it), (2) the CONTRACT — the
// surface:system plugin bodies (in name order) — written WHOLE into each
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
// policy (possibly to nothing). There are no policy-pair branches. The one cross-tree migration receipt below
// preserves old common ignore entries until every registered tree owns its local projection; it never reads or
// reconstructs a sibling policy.

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
// run residue (.worktrees/) stays in the common exclude; tree-selected artifacts are hidden by a managed
// working .gitignore block whose tracked bytes stay pristine through the content filter. A contract file the host TRACKS — or one the user has begun
// writing THEIR OWN prose into — is covered by the clean/smudge content filter ([[content-filter]]). An
// environment without the generator (a teammate's clone, CI, a cloud agent) runs `spex materialize` in its
// setup step — there is no committed-artifact delivery mode.
export function retiredAxisNotice(cfg: { render?: string; private?: boolean }): void {
  if (!cfg.render?.trim() && !cfg.private) return
  const field = cfg.render?.trim() ? `"render": "${cfg.render.trim()}"` : '"private": true'
  console.error(
    `spexcode: the render vote is retired — ${field} is ignored. Materialized artifacts are never tracked:\n` +
    `  tree-local ignore rules live in a filtered working .gitignore, and a host-tracked contract is covered by the\n` +
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

function registeredTrees(proj: string): string[] {
  const rows = git(['-C', mainCheckout(proj), 'worktree', 'list', '--porcelain', '-z']).split('\0')
  return rows.filter((row) => row.startsWith('worktree ')).map((row) => row.slice('worktree '.length))
}

const TREE_IGNORE_RECEIPT = 'tree-ignore-v1'

function hasLegacyTreeIgnore(proj: string): boolean {
  return registeredTrees(proj).some((tree) => {
    const slot = join(runtimeRoot(proj), 'trees', encodeProject(tree))
    return existsSync(join(slot, 'content-hash')) && !existsSync(join(slot, TREE_IGNORE_RECEIPT))
  })
}

function managedExcludeEntries(file: string): string[] {
  if (!existsSync(file)) return []
  const lines = readFileSync(file, 'utf8').split('\n')
  const start = lines.indexOf('# spexcode:start')
  const end = lines.indexOf('# spexcode:end', start + 1)
  return start >= 0 && end > start ? lines.slice(start + 1, end).filter(Boolean) : []
}

function selectionBody(selected: typeof HARNESSES, plugin = false): string {
  return [...new Set([...selected.map((h) => h.dispatchId), ...(plugin ? ['plugin'] : [])])].sort().join('\n') + '\n'
}

function publishSelection(path: string, body: string): void {
  const prepared = `${path}.${process.pid}.tmp`
  writeFileSync(prepared, body)
  renameSync(prepared, path)
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
function eraseTree(proj: string, arts: HarnessArtifacts, preserveProject: boolean): void {
  for (const h of HARNESSES) {
    // h.clean = the adapter's surgical inverse: contract block (sentinels, deleteIfEmpty), the dispatch.sh-
    // stamped shim + worktree anchor, the trust block, and the arts-named skill/agent files.
    h.clean(proj, arts, preserveProject)
    for (const f of h.contractFiles(proj)) clearSkipWorktree(proj, f)   // legacy private-overlay bit — erase-only
    sweepGeneratedSkills(h.skillDir(proj))
    sweepGeneratedAgents(h.agentDir(proj))
  }
  // same authorship rule as the contract files: deleteIfEmpty only when .gitignore is UNTRACKED (wholly-ours
  // generated file); a HOST-TRACKED .gitignore that carried nothing but our block is stripped, never deleted.
  removeManagedBlock(join(proj, '.gitignore'), ['# ', ''], !isTracked(proj, '.gitignore'))
  removeContractFilter(proj, [...HARNESSES.flatMap((h) => h.contractFiles(proj)), join(proj, '.gitignore')])
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

export function dematerialize(proj = process.cwd(), arts: HarnessArtifacts = { skills: [], agents: [] }): void {
  const trees = registeredTrees(proj)
  const current = git(['-C', proj, 'rev-parse', '--show-toplevel']).trim()
  for (const tree of trees) {
    if (!existsSync(tree)) throw new Error(`cannot dematerialize project while registered worktree ${tree} is inaccessible — repair or remove/prune it first`)
    git(['-C', tree, 'rev-parse', '--show-toplevel'])
  }
  for (const tree of trees) {
    // Only the caller's live spec may widen the legacy name sweep. Siblings are identity-stamp-only: the
    // same name there may be user-owned or may not exist in this tree's divergent spec at all.
    eraseTree(tree, tree === current ? arts : { skills: [], agents: [] }, false)
  }
  try { removeManagedBlock(infoExcludePath(proj), ['# ', ''], false) } catch { /* not a git repo */ }
  removeContractFilter(proj, [...HARNESSES.flatMap((h) => h.contractFiles(proj)), join(proj, '.gitignore')], true)
}

// the whole pay-per-change materialize. proj defaults to cwd. Its receipt is populated at each successful
// write so callers report the actual selected footprint instead of maintaining a second artifact inventory.
export function materialize(proj = process.cwd()): MaterializeResult {
  const rt = treeSlotDir(proj)                                            // this tree's slot in the global store, not the worktree
  mkdirSync(rt, { recursive: true })
  const planted: MaterializedArtifact[] = []
  const record = (kind: MaterializedArtifact['kind'], path: string) => {
    if (!planted.some((a) => a.kind === kind && a.path === path)) planted.push({ kind, path })
  }
  // (1) hook manifest (persistent — the dispatcher reads it; regenerated only here, on change).
  const manifest = join(rt, 'hooks-manifest')
  writeFileSync(manifest, compileManifest())
  record('hook manifest', manifest)
  // (2) the contract = the surface:system plugin bodies (in name order), written WHOLE into EACH harness's
  //     contract file(s) + (3) each harness's thin shim → dispatch.sh + (4) its trust. All owned by the adapter.
  // ONE source, no per-project escape hatch: the contract IS the surface:system plugin bodies. A project's
  // own hand-written prose is not folded in — repo-local notes belong in the harness file's own
  // block-outside region (untracked, per-clone), and anything that must reach EVERY agent is a plugin node.
  const contract = loadSystemConfig().map((c) => c.body.trim()).filter(Boolean).join('\n\n')
  // WHICH harnesses to deliver into ([[harness-select]]): this tree's explicit spexcode.json `harnesses` set.
  // resolveHarnessTargets FAILS LOUD on an illegal set (plugin+native, plugin w/o folder).
  const cfg = readConfig(proj)
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
  eraseTree(proj, arts, true)

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
    if (contract) for (const f of h.contractFiles(proj)) { writeManagedBlock(f, contract); contractPaths.push(f); record('contract', f) }
    const shim = h.shim(DISPATCH, SPEX)
    if (h.shimScope === 'tree') {
      const shimFile = h.shimFile(proj)
      mkdirSync(dirname(shimFile), { recursive: true })
      writeFileSync(shimFile, shim.content)
      record('shim', shimFile)
      machinePaths.push(shimFile)
    }
    // a linked-worktree ANCHOR copy of the shim, when the harness needs one (codex: the shim lives at the main
    // checkout, so the worktree gets no `.codex/` unless we place one). One adapter line; null otherwise.
    const anchor = h.worktreeHookAnchor(proj)
    if (anchor) { mkdirSync(dirname(anchor), { recursive: true }); writeFileSync(anchor, shim.content); machinePaths.push(anchor); record('shim', anchor) }
  }
  const selectedByDispatch = new Map(selected.map((h) => [h.dispatchId, h]))
  for (const h of selectedByDispatch.values()) {
    const shim = h.shim(DISPATCH, SPEX)
    if (h.shimScope === 'project') {
      const file = h.shimFile(proj)
      mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, shim.content)
      record('shim', file)
    }
    for (const file of h.writeTrust(proj, shim.cmd)) record('trust', file)
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
      record('skill', f)
    }
  }
  for (const ag of agentNodes) {
    for (const h of selected) {
      const dir = h.agentDir(proj); if (!dir) continue
      const f = join(dir, `${ag.name}.md`)
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, agentArtifact(ag))
      artifactPaths.push(f)
      record('agent', f)
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
    for (const p of plugins) {
      emitPlugin(proj, p.folder, bundle)
      record('plugin bundle', pluginBundleDir(proj, p.folder))
    }
  }
  writeFileSync(ledger, curFolders.join('\n'))
  // (9) ignore + mixed text. Only checkout-invariant residue and project-shared shims belong in the COMMON
  // info/exclude; selection-dependent paths live in this tree's filtered working .gitignore.
  const mc = mainCheckout(proj)
  const bundlePaths = curFolders.map((f) => pluginBundleDir(proj, f))
  const commonEntries = [
    ...[...new Set(HARNESSES.filter((h) => h.shimScope === 'project' && existsSync(h.shimFile(proj)) &&
      readFileSync(h.shimFile(proj), 'utf8').includes('dispatch.sh')).map((h) => relative(mc, h.shimFile(proj))))]
      .filter((p) => !p.startsWith('..')),
    'spexcode.local.json', '.worktrees/', '.session',
  ]
  const entries = (list: string[]) => [...new Set(list)].sort().join('\n')
  const priorCommonEntries = managedExcludeEntries(infoExcludePath(proj))

  // Contract residence stays a live fact. Selection-dependent untracked products are ignored by this tree's
  // working .gitignore, whose own managed block is filtered when the host tracks/owns that file.
  const filterContracts: string[] = []
  const oursContracts: string[] = []
  for (const f of contractPaths) {
    if (isTracked(proj, f) || hostContentOf(f).trim()) filterContracts.push(f)
    else oursContracts.push(f)
  }
  const localEntries = [...machinePaths, ...bundlePaths, ...artifactPaths, ...oursContracts]
    .map((p) => relative(proj, p)).filter((p) => !p.startsWith('..'))
  const ignoreFile = join(proj, '.gitignore')
  const ignoreTracked = isTracked(proj, ignoreFile)
  const ignoreHost = existsSync(ignoreFile) ? readFileSync(ignoreFile, 'utf8') : ''
  if (!ignoreTracked && !ignoreHost.trim()) localEntries.push('.gitignore')
  const ignoreBody = entries(localEntries)
  writeManagedBlock(ignoreFile, ignoreBody, ['# ', ''])

  const payloads: ContractFilterPayload[] = filterContracts.map((file) => ({ file: relative(proj, file), content: contract }))
  if (ignoreTracked || ignoreHost.trim()) payloads.push({ file: '.gitignore', content: ignoreBody })
  const bindings: ContractFilterBinding[] = [
    ...[...new Set(HARNESSES.flatMap((h) => h.contractFiles(proj).map((file) => relative(proj, file))))]
      .map((file) => ({ file, start: '<!-- spexcode:start -->', end: '<!-- spexcode:end -->', legacy: true })),
    { file: '.gitignore', start: '# spexcode:start', end: '# spexcode:end' },
  ]
  if (payloads.length) plantContractFilter(proj, payloads, bindings)
  // (5) finish diagnostics/migration, then atomically publish the allowlist LAST. Dispatch consumes only that
  // final receipt; a killed writer leaves the preceding successful selection intact.
  const h = contentHash(proj)
  writeFileSync(join(rt, 'content-hash'), h)
  writeFileSync(join(rt, 'contract-filter-v2'), '')
  writeFileSync(join(rt, TREE_IGNORE_RECEIPT), '')
  writeFileSync(join(runtimeRoot(proj), 'harness-selection-v1'), '')
  retireLegacyContractBlock(proj)
  const legacyEntries = hasLegacyTreeIgnore(proj) ? priorCommonEntries : []
  writeManagedBlock(infoExcludePath(proj), entries([...commonEntries, ...legacyEntries]), ['# ', ''])
  publishSelection(join(rt, 'harnesses'), selectionBody(selected, plugins.length > 0))
  return { contentHash: h, planted }
}
