import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, renameSync, rmSync, rmdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { loadSystemConfig, loadSkillConfig, loadAgentConfig, loadConfig } from '@spexcode/spec-core'
import { compileManifest } from './hooks.js'
import { writeManagedBlock, removeManagedBlock, HARNESSES, type HarnessArtifacts } from './harness.js'
import { git, gitBinary } from '@spexcode/spec-core'
import { runtimeRoot, treeSlotDir, mainCheckout, readConfig } from '@spexcode/spec-core'
import { resolveHarnessTargets, partitionHarnesses } from './harness-select.js'
import { emitPlugin, cleanPlugin, pluginBundleDir, pluginVersion } from './plugin-harness.js'
import { clearContractFilterPayload, contractFilterPlanted, plantContractFilter, removeContractFilter, settleIndexStat, type ContractFilterBinding, type ContractFilterPayload } from './contract-filter.js'
import { writeFileIfChanged } from './file-write.js'

export type MaterializedArtifact = {
  kind: 'hook manifest' | 'contract' | 'shim' | 'skill' | 'agent' | 'plugin bundle' | 'trust'
  path: string
}
export type MaterializeResult = { contentHash: string; planted: MaterializedArtifact[] }

const PKG = fileURLToPath(new URL('..', import.meta.url))                 // installed spec-cli root
const DISPATCH = join(PKG, 'hooks', 'dispatch.sh')
// the ONE spex entry: the launcher (bin/spex.mjs), never a raw source entry - the launcher runs compiled
// CLI code and keeps the source-workspace mid-merge guard (one line + exit 75), so every hook callback
// inherits both.
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
    const gitDir = dirname(gitBinary(process.env))
    const env = { ...process.env, PATH: `${gitDir}:${process.env.PATH || ''}` }
    return execFileSync('bash', ['-c', `cd "${proj}" && . "${harnessSh}" && hp_config_hash`], { env }).toString().trim()
  } catch { return '' }
}

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
function clearSkipWorktree(proj: string, file: string): void {
  if (!isTracked(proj, file)) return
  try { git(['-C', proj, 'update-index', '--no-skip-worktree', file]) } catch {}
}

function registeredTrees(proj: string): string[] {
  const rows = git(['-C', mainCheckout(proj), 'worktree', 'list', '--porcelain', '-z']).split('\0')
  return rows.filter((row) => row.startsWith('worktree ')).map((row) => row.slice('worktree '.length))
}

function selectionBody(selected: typeof HARNESSES, plugin = false): string {
  return [...new Set([...selected.map((h) => h.dispatchId), ...(plugin ? ['plugin'] : [])])].sort().join('\n') + '\n'
}

function publishSelection(path: string, body: string): void {
  try { if (readFileSync(path, 'utf8') === body) return } catch (error: any) { if (error?.code !== 'ENOENT') throw error }
  const prepared = `${path}.${process.pid}.tmp`
  writeFileSync(prepared, body)
  renameSync(prepared, path)
}

function managedBlockPattern(comment: readonly [string, string]): RegExp {
  const [open, close] = comment
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\n*${escape(`${open}spexcode:start${close}`)}[\\s\\S]*?${escape(`${open}spexcode:end${close}`)}\\n*`)
}
export function stripSpexcodeBlock(text: string, comment: readonly [string, string] = ['<!-- ', ' -->']): string {
  const sentinel = managedBlockPattern(comment)
  const m = sentinel.exec(text)
  if (!m) return text
  // mirror removeManagedBlock exactly: our block + its surrounding blanks collapse to one '\n', and only a
  // block sitting at the TOP of the file drops the leading newline (a host file beginning with its own
  // blank lines keeps them — clean(smudge(x)) == x).
  const replaced = text.replace(sentinel, '\n')
  return m.index === 0 ? replaced.replace(/^\n+/, '') : replaced
}
function hostContentOf(file: string): string {
  if (!existsSync(file)) return ''
  return stripSpexcodeBlock(readFileSync(file, 'utf8'))
}
// the identity stamp on every generated skill/agent file — what lets the erase phase forget a product whose
// NODE was renamed or deleted (the name-scoped sweep can only reconstruct paths the LIVE config still names).
export const GENERATED_MARK = '<!-- spexcode:generated -->'
function pruneGeneratedSkills(dir: string | null, keep: ReadonlySet<string>): boolean {
  if (!dir || !existsSync(dir)) return false
  let changed = false
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const f = join(dir, e.name, 'SKILL.md')
    try {
      if (!keep.has(e.name) && existsSync(f) && readFileSync(f, 'utf8').includes(GENERATED_MARK)) {
        rmSync(join(dir, e.name), { recursive: true, force: true })
        changed = true
      }
    } catch { /* unreadable → not provably ours */ }
  }
  return changed
}
function pruneGeneratedAgents(dir: string | null, keep: ReadonlySet<string>): boolean {
  if (!dir || !existsSync(dir)) return false
  let changed = false
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue
    const f = join(dir, e.name)
    try {
      if (!keep.has(e.name.slice(0, -3)) && readFileSync(f, 'utf8').includes(GENERATED_MARK)) {
        rmSync(f, { force: true })
        changed = true
      }
    } catch { /* unreadable → not provably ours */ }
  }
  return changed
}

type TreeTargets = {
  contracts: ReadonlySet<string>
  treeShims: ReadonlySet<string>
  anchors: ReadonlySet<string>
  skills: ReadonlyMap<string, ReadonlySet<string>>
  agents: ReadonlyMap<string, ReadonlySet<string>>
}

function cleanupHarnessDirs(proj: string): void {
  const roots = new Set([proj, mainCheckout(proj)])
  const dirs = HARNESSES.flatMap((h) => {
    const anchor = h.worktreeHookAnchor(proj)
    return [h.skillDir(proj), h.agentDir(proj), dirname(h.shimFile(proj)), anchor ? dirname(anchor) : null]
  }).filter((d): d is string => !!d)
  for (const d of [...new Set([...dirs, ...dirs.map((dir) => dirname(dir))])]
    .filter((dir) => !roots.has(dir)).sort((a, b) => b.length - a.length)) {
    try { rmdirSync(d) } catch {}
  }
}

function reconcileTree(proj: string, targets: TreeTargets, tracked: (file: string) => boolean): void {
  let removed = false
  const contractFiles = new Set(HARNESSES.flatMap((h) => h.contractFiles(proj)))
  for (const file of contractFiles) {
    if (targets.contracts.has(file) || !existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    if (!text.includes('<!-- spexcode:start -->')) continue
    removeManagedBlock(file, ['<!-- ', ' -->'], !tracked(file))
    removed = true
  }
  const treeShims = new Set(HARNESSES.filter((h) => h.shimScope === 'tree').map((h) => h.shimFile(proj)))
  const anchors = new Set(HARNESSES.map((h) => h.worktreeHookAnchor(proj)).filter((path): path is string => !!path))
  for (const file of [...treeShims, ...anchors]) {
    if (targets.treeShims.has(file) || targets.anchors.has(file) || !existsSync(file)) continue
    if (readFileSync(file, 'utf8').includes('dispatch.sh')) { rmSync(file, { force: true }); removed = true }
  }
  for (const dir of new Set(HARNESSES.map((h) => h.skillDir(proj)).filter((path): path is string => !!path)))
    removed = pruneGeneratedSkills(dir, targets.skills.get(dir) ?? new Set()) || removed
  for (const dir of new Set(HARNESSES.map((h) => h.agentDir(proj)).filter((path): path is string => !!path)))
    removed = pruneGeneratedAgents(dir, targets.agents.get(dir) ?? new Set()) || removed
  if (removed) cleanupHarnessDirs(proj)
}

function eraseTree(proj: string, arts: HarnessArtifacts, preserveProject: boolean): void {
  for (const h of HARNESSES) {
    // h.clean = the adapter's surgical inverse: contract block (sentinels, deleteIfEmpty), the dispatch.sh-
    // stamped shim + worktree anchor, the trust block, and the arts-named skill/agent files.
    h.clean(proj, arts, preserveProject)
    for (const f of h.contractFiles(proj)) clearSkipWorktree(proj, f)
    pruneGeneratedSkills(h.skillDir(proj), new Set())
    pruneGeneratedAgents(h.agentDir(proj), new Set())
  }
  // same authorship rule as the contract files: deleteIfEmpty only when .gitignore is UNTRACKED (wholly-ours
  // generated file); a HOST-TRACKED .gitignore that carried nothing but our block is stripped, never deleted.
  removeManagedBlock(join(proj, '.gitignore'), ['# ', ''], !isTracked(proj, '.gitignore'))
  clearContractFilterPayload(proj, [...HARNESSES.flatMap((h) => h.contractFiles(proj)), join(proj, '.gitignore')])
  // the block-strip left tracked contract files stat-dirty (under a filter git NEVER content-verifies them,
  // and even unfiltered the phantom-`M` lingers) — settle the index stat, content-guarded so a user's real
  // unstaged edit is never staged ([[content-filter]] edge 2).
  try { settleIndexStat(proj, HARNESSES.flatMap((h) => h.contractFiles(proj))) } catch { /* not a git repo */ }
  // leaving nothing behind: drop the now-EMPTY dirs the assert phase mkdir'ed (.claude/.codex/.opencode/.pi
  // and their skills/agents/plugins/extensions subdirs). Each dir AND its parent are swept deepest-first,
  // because a harness may nest its shim a level below its home (opencode's .opencode/plugins/, pi's
  // .pi/extensions/) — but never the checkout roots themselves. rmdirSync is NON-recursive, so a dir holding
  // any user file survives untouched; `.git/spexcode/` is deliberately NOT swept (shared per-clone home).
  cleanupHarnessDirs(proj)
}

export function dematerialize(proj = process.cwd(), arts: HarnessArtifacts = { skills: [], agents: [] }): void {
  const trees = registeredTrees(proj)
  const current = git(['-C', proj, 'rev-parse', '--show-toplevel']).trim()
  for (const tree of trees) {
    if (!existsSync(tree)) throw new Error(`cannot dematerialize project while registered worktree ${tree} is inaccessible — repair or remove/prune it first`)
    git(['-C', tree, 'rev-parse', '--show-toplevel'])
  }
  for (const tree of trees) {
    // Only the caller's live spec may widen the name sweep. Siblings are identity-stamp-only: the
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
  writeFileIfChanged(manifest, compileManifest())
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
  const contractTargets = new Map<string, string>()
  const treeShimTargets = new Map<string, string>()
  const anchorTargets = new Map<string, string>()
  const skillTargets = new Map<string, string>()
  const agentTargets = new Map<string, string>()
  const skillsByDir = new Map<string, Set<string>>()
  const agentsByDir = new Map<string, Set<string>>()
  const addTarget = (targets: Map<string, string>, path: string, content: string) => {
    const prior = targets.get(path)
    if (prior !== undefined && prior !== content) throw new Error(`conflicting materialize targets for ${path}`)
    targets.set(path, content)
  }
  for (const h of selected) {
    if (contract) for (const f of h.contractFiles(proj)) addTarget(contractTargets, f, contract)
    const shim = h.shim(DISPATCH, SPEX)
    if (h.shimScope === 'tree') {
      addTarget(treeShimTargets, h.shimFile(proj), shim.content)
    }
    // a linked-worktree ANCHOR copy of the shim, when the harness needs one (codex: the shim lives at the main
    // checkout, so the worktree gets no `.codex/` unless we place one). One adapter line; null otherwise.
    const anchor = h.worktreeHookAnchor(proj)
    if (anchor) addTarget(anchorTargets, anchor, shim.content)
  }
  for (const sk of skillNodes) for (const h of selected) {
    const dir = h.skillDir(proj); if (!dir) continue
    addTarget(skillTargets, join(dir, sk.name, 'SKILL.md'), skillArtifact(sk))
    const names = skillsByDir.get(dir) ?? new Set<string>(); names.add(sk.name); skillsByDir.set(dir, names)
  }
  for (const ag of agentNodes) for (const h of selected) {
    const dir = h.agentDir(proj); if (!dir) continue
    addTarget(agentTargets, join(dir, `${ag.name}.md`), agentArtifact(ag))
    const names = agentsByDir.get(dir) ?? new Set<string>(); names.add(ag.name); agentsByDir.set(dir, names)
  }
  const tracked = new Map<string, boolean>()
  const isTrackedHere = (file: string) => {
    const known = tracked.get(file)
    if (known !== undefined) return known
    const value = isTracked(proj, file); tracked.set(file, value); return value
  }
  reconcileTree(proj, {
    contracts: new Set(contractTargets.keys()), treeShims: new Set(treeShimTargets.keys()), anchors: new Set(anchorTargets.keys()),
    skills: skillsByDir, agents: agentsByDir,
  }, isTrackedHere)
  const changedMaterialized = new Set<string>()
  for (const [file, content] of contractTargets) {
    if (writeManagedBlock(file, content)) changedMaterialized.add(file)
    record('contract', file)
  }
  const contractPaths = [...contractTargets.keys()]
  for (const [file, content] of treeShimTargets) {
    mkdirSync(dirname(file), { recursive: true }); writeFileIfChanged(file, content)
    record('shim', file); machinePaths.push(file)
  }
  for (const [file, content] of anchorTargets) {
    mkdirSync(dirname(file), { recursive: true }); writeFileIfChanged(file, content)
    record('shim', file); machinePaths.push(file)
  }
  const selectedByDispatch = new Map(selected.map((h) => [h.dispatchId, h]))
  for (const h of selectedByDispatch.values()) {
    const shim = h.shim(DISPATCH, SPEX)
    if (h.shimScope === 'project') {
      const file = h.shimFile(proj)
      mkdirSync(dirname(file), { recursive: true }); writeFileIfChanged(file, shim.content)
      record('shim', file)
    }
    for (const file of h.writeTrust(proj, shim.cmd)) record('trust', file)
  }
  for (const [file, content] of skillTargets) {
    mkdirSync(dirname(file), { recursive: true }); writeFileIfChanged(file, content)
    artifactPaths.push(file); record('skill', file)
  }
  for (const [file, content] of agentTargets) {
    mkdirSync(dirname(file), { recursive: true }); writeFileIfChanged(file, content)
    artifactPaths.push(file); record('agent', file)
  }
  // (8) the PLUGIN target ([[plugin-harness]]): materialize the whole system into one self-contained Claude-plugin
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
  writeFileIfChanged(ledger, curFolders.join('\n'))
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
  // Contract residence stays a live fact. Selection-dependent untracked products are ignored by this tree's
  // working .gitignore, whose own managed block is filtered when the host tracks/owns that file.
  const filterContracts: string[] = []
  const oursContracts: string[] = []
  for (const f of contractPaths) {
    if (isTrackedHere(f) || hostContentOf(f).trim()) filterContracts.push(f)
    else oursContracts.push(f)
  }
  const localEntries = [...machinePaths, ...bundlePaths, ...artifactPaths, ...oursContracts]
    .map((p) => relative(proj, p)).filter((p) => !p.startsWith('..'))
  const ignoreFile = join(proj, '.gitignore')
  const ignoreTracked = isTrackedHere(ignoreFile)
  const ignoreHost = existsSync(ignoreFile) ? stripSpexcodeBlock(readFileSync(ignoreFile, 'utf8'), ['# ', '']) : ''
  if (!ignoreTracked && !ignoreHost.trim()) localEntries.push('.gitignore')
  const ignoreBody = entries(localEntries)
  if (writeManagedBlock(ignoreFile, ignoreBody, ['# ', ''])) changedMaterialized.add(ignoreFile)

  const payloads: ContractFilterPayload[] = filterContracts.map((file) => ({ file: relative(proj, file), content: contract }))
  if (ignoreTracked || ignoreHost.trim()) payloads.push({ file: '.gitignore', content: ignoreBody })
  const bindings: ContractFilterBinding[] = [
    ...[...new Set(HARNESSES.flatMap((h) => h.contractFiles(proj).map((file) => relative(proj, file))))]
      .map((file) => ({ file, start: '<!-- spexcode:start -->', end: '<!-- spexcode:end -->' })),
    { file: '.gitignore', start: '# spexcode:start', end: '# spexcode:end' },
  ]
  if (payloads.length) plantContractFilter(proj, payloads, bindings, [...changedMaterialized])
  else if (contractFilterPlanted(proj)) removeContractFilter(proj, [...HARNESSES.flatMap((h) => h.contractFiles(proj)), join(proj, '.gitignore')])
  // (5) finish diagnostics, then atomically publish the allowlist LAST. Dispatch consumes only that
  // final receipt; a killed writer leaves the preceding successful selection intact.
  const h = contentHash(proj)
  writeFileIfChanged(join(rt, 'content-hash'), h)
  writeFileIfChanged(join(runtimeRoot(proj), 'harness-selection-v1'), '')
  writeManagedBlock(infoExcludePath(proj), entries(commonEntries), ['# ', ''])
  publishSelection(join(rt, 'harnesses'), selectionBody(selected, plugins.length > 0))
  return { contentHash: h, planted }
}
