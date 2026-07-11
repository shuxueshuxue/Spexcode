// @@@ spex doctor --migrate - the ONE-SHOT 0.2.x → 0.3.0 migrator for an ADOPTER repo ([[migrate]]).
// Ships with 0.3.0, deleted in 0.4.0 (a released, named, term-limited migrator — not a runtime residue).
// It performs the v0.3.0 vocabulary migration in one run: tree renames (.config → .plugins, config →
// plugin-system, yatsu.md → eval.md, yatsu.evals.ndjson → evals.ndjson), template hook-asset upgrades,
// body vocabulary rewrites (only what is EXECUTED or PARSED — command spellings, lint labels, mentions,
// routes, .spec paths, issue-frontmatter bindings — never conceptual prose), and the legacy settings key.
//
// Iron rules, enforced structurally:
//   • NO GUESSING: a hook asset is replaced only when its git blob sha matches a KNOWN historical stock
//     template version (migrate-table.ts, generated from this repo's own git history). Anything else is
//     flagged for human review and left byte-identical.
//   • FAIL LOUD, NEVER HALF-MIGRATE: every precondition (clean tree, drained sessions, tracked .spec,
//     main checkout, no rename collisions) is checked BEFORE the first write; any failure prints ALL
//     refusals and exits 2 with the tree untouched.
//   • EVERYTHING STAGED, NOTHING COMMITTED: the operator reviews the staged diff + flagged items and
//     commits through the ritual; `git reset --hard` undoes the whole run.
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, renameSync } from 'node:fs'
import { join, relative, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { TEMPLATE_ASSETS, RETIRED_ASSETS, CONFIG_NODE_SHAS } from './migrate-table.js'

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))

// loud git: any failure throws with git's own stderr. GIT_DIR/GIT_INDEX_FILE are stripped (same reason as
// git.ts's git(): an inherited hook env would silently point repo discovery at the wrong place).
function git(cwd: string, args: string[]): string {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_INDEX_FILE; delete env.GIT_WORK_TREE
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 }).trim()
}
function tryGit(cwd: string, args: string[]): string | null {
  try { return git(cwd, args) } catch { return null }
}

function walk(dir: string): string[] {
  let out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out = out.concat(walk(p))
    else if (e.isFile()) out.push(p)
  }
  return out
}

// ---------- the vocabulary tables (§3.1/§3.2 of the v0.3.0 plan — old spelling → its ONE new home) ----------
// Only surfaces that are executed or parsed. Ordered: longer/more-specific rules run before their prefixes.
const COMMAND_REWRITES: [RegExp, string][] = [
  // eval domain (né yatsu)
  [/\bspex yatsu check-staged\b/g, 'spex internal check-staged'],
  [/\bspex yatsu eval\b/g, 'spex eval add'],
  [/\bspex yatsu show\b/g, 'spex eval ls'],
  [/\bspex yatsu scan\b/g, 'spex eval lint'],
  [/\bspex yatsu retract\b/g, 'spex eval retract'],
  [/\bspex yatsu clean\b/g, 'spex eval clean'],
  [/\bspex guide yatsu\b/g, 'spex guide eval'],
  [/\bspex guide config\b/g, 'spex guide settings'],
  [/\bspex blob put\b/g, 'spex evidence put'],
  [/\bspex blob get\b/g, 'spex evidence get'],
  // issue domain (né issues/forge drawers)
  [/\bspex issues nudge\b/g, 'spex internal nudge'],
  [/\bspex issues open\b/g, 'spex issue open'],
  [/\bspex issues reply\b/g, 'spex issue reply'],
  [/\bspex issues close\b/g, 'spex issue close'],
  [/\bspex issues promote\b/g, 'spex issue promote'],
  [/\bspex issues ls\b/g, 'spex issue ls'],
  [/\bspex issues\b(?!\s+(?:on|off|status)\b)/g, 'spex issue ls'],   // bare `spex issues` listed; on|off|status are DELETED → flagged below
  [/\bspex forge links\b/g, 'spex issue links'],
  [/\bspex forge eval-pending\b/g, 'spex issue links --pending'],
  // remark domain (né bare remark/resolve/retract)
  [/\bspex resolve\b/g, 'spex remark resolve'],
  [/\bspex retract\b/g, 'spex remark retract'],
  [/\bspex remark\b(?!\s+(?:add|resolve|retract)\b)/g, 'spex remark add'],
  // session drawer: renamed subs first, then the retired promoted spellings
  [/\bspex session reopen\b/g, 'spex session resume'],
  [/\bspex session exit\b/g, 'spex session stop'],
  [/\bspex session rawkey\b/g, 'spex session send --keys'],
  [/\bspex session capture\b/g, 'spex session show --capture'],
  [/\bspex session prompt\b/g, 'spex session show'],
  [/\bspex session state\b/g, 'spex internal session-state'],
  [/\bspex session fail\b/g, 'spex internal session-fail'],
  [/\bspex session idle\b/g, 'spex internal session-idle'],
  [/\bspex session commit-gate\b/g, 'spex internal commit-gate'],
  [/\bspex reopen\b/g, 'spex session resume'],
  [/\bspex exit\b/g, 'spex session stop'],
  [/\bspex rawkey\b/g, 'spex session send --keys'],
  [/\bspex capture\b/g, 'spex session show --capture'],
  [/\bspex prompt\b/g, 'spex session show'],
  [/\bspex new\b/g, 'spex session new'],
  [/\bspex ls\b/g, 'spex session ls'],
  [/\bspex watch\b/g, 'spex session watch'],
  [/\bspex wait\b/g, 'spex session wait'],
  [/\bspex review\b(?!\s+proof\b)/g, 'spex session review'],          // `spex review proof` is DELETED → flagged below
  [/\bspex merge\b/g, 'spex session merge'],
  [/\bspex done\b/g, 'spex session done'],
  [/\bspex park\b/g, 'spex session park'],
  [/\bspex ask\b/g, 'spex session ask'],
  [/\bspex send\b/g, 'spex session send'],
  [/\bspex close\b/g, 'spex session close'],
  [/\bspex attach\b/g, 'spex session attach'],
  [/\bspex rename\b/g, 'spex session rename'],
  // spec drawer (né promoted verbs)
  [/\bspex search\b/g, 'spex spec search'],
  [/\bspex owner\b/g, 'spex spec owner'],
  [/\bspex lint\b/g, 'spex spec lint'],
  [/\bspex ack\b/g, 'spex spec ack'],
  // project verbs
  [/\bspex board\b/g, 'spex graph --json'],
  [/\bspex tree\b/g, 'spex graph'],
  [/\bspex dashboard\b/g, 'spex serve ui'],
  [/\bspex self\b/g, 'spex doctor'],
  [/\bspex doctor contract\b/g, 'spex doctor --contract'],
  [/\bspex doctor conflicts\b/g, 'spex doctor --conflicts'],
]
const ROUTE_REWRITES: [RegExp, string][] = [
  [/\/api\/board\/stream\b/g, '/api/graph/stream'],
  [/\/api\/board\b/g, '/api/graph'],
  [/\/api\/sessions\/graph\b/g, '/api/sessions/edges'],
  [/\/api\/yatsu\/blob\b/g, '/api/evidence'],
  [/\/yatsu\/eval\b/g, '/evals'],
  [/\/api\/config\b/g, '/api/plugins'],
  [/\/api\/layout\b/g, '/api/settings'],
  [/\/api\/launchers\b/g, '/api/settings'],
]
const LABEL_REWRITES: [RegExp, string][] = [
  [/\byatsu-uncovered:/g, 'eval-coverage:'],
  [/\byatsu-(schema|missing|drift|dangling|owners):/g, 'eval-$1:'],
]
const FILE_REWRITES: [RegExp, string][] = [
  [/\byatsu\.evals\.ndjson\b/g, 'evals.ndjson'],   // also rewrites the `.yatsu.evals.ndjson` suffix form
  [/\byatsu\.md\b/g, 'eval.md'],
]
// dead spellings that survive every rewrite rule (no deterministic new home) → review items, never guessed at.
const MD_FLAG_PATTERNS: [RegExp, string][] = [
  [/\bspex yatsu\b/, 'unmapped `spex yatsu …` spelling'],
  [/\byatsu (scan|eval|show|retract|clean)\b/, 'un-prefixed yatsu verb (script-style invocation)'],
  [/\bspex forge\b/, 'unmapped `spex forge …` spelling (drawer dissolved into `spex issue links`)'],
  [/\bspex issues (on|off|status)\b/, '`spex issues on|off|status` was deleted — the switch is the spexcode.json `issues.enabled` key'],
  [/\bspex review proof\b/, '`spex review proof` was deleted — use `spex eval ls --session <SEL> --export`'],
  [/\bspex eval\b(?!\s+(?:add|ls|scenario|lint|retract|clean)\b|\s+--|\s*[.,;:)`'"]|\s*$)/m, 'old top-level `spex eval <SEL>` session read — now `spex eval ls --session <SEL>`'],
  [/\byatsu-[a-z]+:/, 'unmapped yatsu-* lint label'],
  [/\byatsu\.md\b/, 'a yatsu.md reference survived rewriting'],
]
// executable patterns that make an UNKNOWN (non-template) script a review item — scripts are never rewritten.
const SCRIPT_FLAG_PATTERNS: [RegExp, string][] = [
  [/\byatsu\b/, 'invokes/greps the yatsu vocabulary'],
  [/\bsession (state|fail|idle|commit-gate)\b/, 'calls a hook verb that moved to `spex internal …`'],
  [/\bblob (put|get)\b/, 'calls the blob verbs (now `spex evidence put|get`)'],
  [/\bspex (board|tree|dashboard|search|owner|lint|ack|new|ls|watch|wait|review|merge)\b/, 'calls a retired top-level spelling'],
  [/\/api\/(board|config|layout|launchers|yatsu)\b/, 'hits a renamed API route'],
]

type Flag = { file: string; line: number | null; reason: string }

// ---------- preconditions: check EVERYTHING before the first write ----------
type World = {
  root: string
  specRoots: string[]           // .spec/<root> dirs that are spec roots (have spec.md)
  configRoots: string[]         // spec roots carrying an old-world .config
  yatsuFiles: string[]          // absolute paths of yatsu.md / *yatsu.evals.ndjson under .spec
  configNode: string | null     // .spec/<root>/config dir to rename, iff hash-gated as spexcode's plugin-system spec
  configNodeFlag: Flag | null   // a node named `config` that is NOT stock → flagged, not renamed
}

// inspectAsync (bottom of file) gathers the world and appends every refusal — ALL preconditions are
// evaluated before runMigrate performs its first write.

export async function runMigrate(): Promise<number> {
  const refusals: string[] = []
  let world: World | null = null
  try { world = await inspectAsync(process.cwd(), refusals) } catch (e) { refusals.push((e as Error).message) }
  if (refusals.length || !world) {
    console.error('spex doctor --migrate: REFUSED — nothing was changed. Fix these and re-run:')
    for (const r of refusals) console.error(`  ✗ ${r}`)
    return 2
  }
  const { root } = world
  const rel = (f: string) => relative(root, f)
  const flags: Flag[] = world.configNodeFlag ? [world.configNodeFlag] : []
  const summary: string[] = []
  const renamedNodes: [string, string][] = []   // node-id renames actually performed → drives mention re-pointing

  console.log('spex doctor --migrate — one-shot 0.2.x → 0.3.0 migration (everything staged, nothing committed)\n')

  // ---------- 1. tree renames (git mv — history-preserving) ----------
  for (const dir of world.configRoots) {
    git(root, ['mv', join(dir, '.config'), join(dir, '.plugins')])
    summary.push(`renamed ${rel(dir)}/.config → .plugins (git mv)`)
  }
  renamedNodes.push(['.config', '.plugins'])
  if (world.configNode) {
    git(root, ['mv', world.configNode, join(dirname(world.configNode), 'plugin-system')])
    renamedNodes.push(['config', 'plugin-system'])
    summary.push(`renamed node ${rel(world.configNode)} → plugin-system (git mv; stock plugin-system spec, hash-verified)`)
  }
  // yatsu file renames — re-walk (paths moved under .plugins)
  const yatsuNow = walk(join(root, '.spec')).filter((f) => basename(f) === 'yatsu.md' || basename(f).endsWith('yatsu.evals.ndjson'))
  for (const f of yatsuNow) {
    const target = basename(f) === 'yatsu.md' ? join(dirname(f), 'eval.md') : join(dirname(f), basename(f).replace(/yatsu\.evals\.ndjson$/, 'evals.ndjson'))
    git(root, ['mv', f, target])
  }
  if (yatsuNow.length) summary.push(`renamed ${yatsuNow.length} measurement file(s): yatsu.md → eval.md, *yatsu.evals.ndjson → *evals.ndjson (git mv)`)

  // ---------- 2. template hook-asset upgrade (exact-match replace or flag — NEVER a silent rewrite) ----------
  let replaced = 0, current = 0, retiredStock = 0
  const touched = new Set<string>()   // files replaced (skip vocab) …
  const frozen = new Set<string>()    // … and files flagged (must stay byte-identical)
  for (const dir of world.configRoots) {
    const plugRoot = join(dir, '.plugins')
    for (const f of walk(plugRoot)) {
      const r = relative(plugRoot, f)
      const asset = TEMPLATE_ASSETS.find((a) => a.rel === r)
      if (asset) {
        const newContent = readFileSync(join(PKG_ROOT, asset.template), 'utf8')
        if (readFileSync(f, 'utf8') === newContent) { current++; continue }
        const sha = git(root, ['hash-object', f])
        if (asset.oldShas.includes(sha)) {
          writeFileSync(f, newContent); git(root, ['add', f]); replaced++; touched.add(f)
        } else {
          flags.push({ file: rel(f), line: null, reason: `differs from EVERY known stock template version (hand-customized?) — left untouched; port your customization onto the new template by hand (shipped at ${join('spec-cli', asset.template)})` })
          frozen.add(f)
        }
      } else {
        // not shipped any more: a stock copy of a retired template is reported; an unknown script with
        // executable old vocabulary is flagged. Unknown .md bodies fall through to the vocabulary pass.
        const oldNames = [r, r.replace(/eval\.md$/, 'yatsu.md'), r.replace(/evals\.ndjson$/, 'yatsu.evals.ndjson')]
        const retiredKey = oldNames.find((n) => RETIRED_ASSETS[n])
        if (retiredKey && RETIRED_ASSETS[retiredKey].includes(git(root, ['hash-object', f]))) {
          retiredStock++
          flags.push({ file: rel(f), line: null, reason: `stock copy of a template the current release no longer ships (${retiredKey}) — kept; review whether to keep or delete it` })
          // hash-verified STOCK content: a retired .md still gets the vocabulary pass (we know every byte
          // is ours, so rewriting its executable surfaces is not a guess); a retired SCRIPT has no shipped
          // successor and no rewrite table, so it stays frozen byte-identical.
          if (!f.endsWith('.md')) frozen.add(f)
        } else if (!f.endsWith('.md')) {
          const text = readFileSync(f, 'utf8')
          for (const [re, why] of SCRIPT_FLAG_PATTERNS) {
            const i = text.split('\n').findIndex((l) => re.test(l))
            if (i >= 0) { flags.push({ file: rel(f), line: i + 1, reason: `unknown script ${why} — scripts are never auto-rewritten; update it by hand` }); frozen.add(f); break }
          }
        }
      }
    }
  }
  summary.push(`template assets: ${replaced} upgraded (stock, hash-verified), ${current} already current, ${retiredStock} retired-stock, ${flags.length} flagged for review`)

  // ---------- 3. body vocabulary pass (every .spec .md not replaced/frozen above) ----------
  let rewrote = 0
  const mentionRules: [RegExp, string][] = renamedNodes.map(([o, n]) => [new RegExp(`\\[\\[${o.replace('.', '\\.')}\\]\\]`, 'g'), `[[${n}]]`])
  for (const f of walk(join(root, '.spec'))) {
    if (!f.endsWith('.md') || touched.has(f) || frozen.has(f)) continue
    const before = readFileSync(f, 'utf8')
    let text = before
    for (const [re, to] of [...FILE_REWRITES, ...LABEL_REWRITES, ...COMMAND_REWRITES, ...ROUTE_REWRITES, ...mentionRules]) text = text.replace(re, to)
    // .spec-internal path strings (code: frontmatter, prose paths): /.config/ → /.plugins/ on lines that name .spec
    text = text.split('\n').map((l) => l.includes('.spec/') ? l.replaceAll('/.config/', '/.plugins/') : l).join('\n')
    // issue-thread frontmatter `nodes:` bindings follow the performed node renames
    if (renamedNodes.some(([o]) => o === 'config'))
      text = text.replace(/^(nodes:.*)$/m, (line) => line.replace(/\bconfig\b/g, 'plugin-system'))
    if (text !== before) { writeFileSync(f, text); git(root, ['add', f]); rewrote++ }
    // whatever old vocabulary SURVIVES the rewrite has no deterministic home → review, never guess
    const lines = text.split('\n')
    for (const [re, why] of MD_FLAG_PATTERNS) {
      const i = lines.findIndex((l) => re.test(l))
      if (i >= 0) flags.push({ file: rel(f), line: i + 1, reason: why })
    }
  }
  summary.push(`bodies: ${rewrote} .md file(s) rewritten (command spellings · lint labels · file/route names · [[mention]] re-pointing · .spec paths)`)

  // ---------- 4. legacy settings key: proposals.enabled → issues.enabled ----------
  for (const name of ['spexcode.json', 'spexcode.local.json']) {
    const p = join(root, name)
    if (!existsSync(p)) continue
    let cfg: Record<string, unknown>
    try { cfg = JSON.parse(readFileSync(p, 'utf8')) } catch { flags.push({ file: name, line: null, reason: 'unparseable JSON — legacy `proposals` key (if any) not migrated' }); continue }
    if (!('proposals' in cfg)) continue
    const prop = cfg.proposals as { enabled?: unknown }
    const issues = (cfg.issues ?? {}) as Record<string, unknown>
    if (typeof prop?.enabled === 'boolean' && !('enabled' in issues)) cfg.issues = { ...issues, enabled: prop.enabled }
    delete cfg.proposals
    writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n')
    if (tryGit(root, ['ls-files', '--error-unmatch', name])) git(root, ['add', p])
    summary.push(`${name}: legacy \`proposals\` key rewritten to \`issues.enabled\` (v0.3.0 reads only the new key)`)
  }

  // ---------- 5. per-clone evidence cache: yatsu-blobs → evidence (lossless dir rename) ----------
  const commonDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const oldCache = join(commonDir, 'spexcode', 'yatsu-blobs'), newCache = join(commonDir, 'spexcode', 'evidence')
  if (existsSync(oldCache) && !existsSync(newCache)) { renameSync(oldCache, newCache); summary.push('evidence cache: .git/spexcode/yatsu-blobs → evidence (bytes preserved)') }

  // ---------- 6. post-checks: the new CLI must actually work on the migrated tree ----------
  console.log('— migration applied; running post-checks —\n')
  const post: string[] = []
  try {
    const { specLint } = await import('./lint.js')
    const findings = await specLint()
    const errs = findings.filter((x) => x.level === 'error')
    for (const x of findings) console.error(`  ${x.level === 'error' ? '✗' : '•'} ${x.rule}: ${x.msg}`)
    post.push(`spec lint: ${errs.length} error(s), ${findings.length - errs.length} warning(s)${errs.length ? ' — FIX BEFORE COMMITTING' : ''}`)
  } catch (e) { post.push(`spec lint FAILED to run: ${(e as Error).message}`) }
  try {
    const { runEval } = await import('../../spec-eval/src/cli.js')
    await runEval(['lint'])
    post.push('eval lint: ran (advisory — findings above, if any)')
  } catch (e) { post.push(`eval lint FAILED to run: ${(e as Error).message}`) }
  try {
    const { materialize } = await import('./materialize.js')
    post.push(`materialize: ok (content-hash ${materialize(root)}) — hook manifest + contract now speak .plugins`)
  } catch (e) { post.push(`materialize FAILED: ${(e as Error).message}`) }

  // ---------- summary ----------
  console.log('\n===== migration summary =====')
  for (const s of summary) console.log(`  ✓ ${s}`)
  for (const s of post) console.log(`  · ${s}`)
  if (flags.length) {
    console.log(`\n  NEEDS REVIEW (${flags.length}) — reported, deliberately NOT rewritten:`)
    for (const fl of flags) console.log(`    ! ${fl.file}${fl.line ? `:${fl.line}` : ''} — ${fl.reason}`)
  }
  console.log(`\n  Everything is STAGED, nothing committed. Undo entirely with: git reset --hard
  Next steps:
    1. review the staged diff (git diff --cached) and every NEEDS REVIEW item above
    2. commit through the ritual (on a trunk this is topology surgery: SPEXCODE_ALLOW_MAIN=1 git commit)
    3. npm run hooks — in EVERY clone of this repo (git hooks are per-clone copies)
    4. full backend restart (the supervisor env must be respawned), then rebuild the dashboard dist
    5. if a node was renamed above, retarget OPEN forge issues' \`Spec:\` lines via your forge (closed ones are archive — leave them)`)
  return 0
}

// the precondition gatherer — every check appends a refusal; the caller only proceeds on an empty list.
async function inspectAsync(cwd: string, refusals: string[]): Promise<World | null> {
  const root = tryGit(cwd, ['rev-parse', '--show-toplevel'])
  if (!root) { refusals.push('not inside a git repository.'); return null }
  const gitDir = git(root, ['rev-parse', '--path-format=absolute', '--git-dir'])
  const commonDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (gitDir !== commonDir) refusals.push(`this is a linked worktree (${root}) — run the migration from the main checkout.`)
  const specDir = join(root, '.spec')
  if (!existsSync(specDir)) { refusals.push(`no .spec/ at ${root} — this repo has not adopted SpexCode; nothing to migrate.`); return null }

  const specRoots: string[] = [], configRoots: string[] = [], pluginRoots: string[] = []
  for (const e of readdirSync(specDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === '.issues') continue
    const dir = join(specDir, e.name)
    if (!existsSync(join(dir, 'spec.md'))) continue
    specRoots.push(dir)
    if (existsSync(join(dir, '.config'))) configRoots.push(dir)
    if (existsSync(join(dir, '.plugins'))) pluginRoots.push(dir)
  }
  for (const p of pluginRoots) refusals.push(`${relative(root, p)}/.plugins already exists — this tree is already migrated${configRoots.length ? ' (and a .config root ALSO exists — half-migrated state, resolve by hand)' : ''}.`)

  const yatsuFiles = walk(specDir).filter((f) => basename(f) === 'yatsu.md' || basename(f).endsWith('yatsu.evals.ndjson'))
  if (!configRoots.length && !yatsuFiles.length && !pluginRoots.length)
    refusals.push('nothing to migrate — no .config plugin root and no yatsu.md/yatsu.evals.ndjson files under .spec/ (this tree already speaks 0.3.0, or never had the 0.2.x vocabulary).')

  if (!git(root, ['ls-files', '.spec']).length)
    refusals.push('.spec is not tracked by git (an old `/.spec` exclude line?) — remove the exclude, `git add .spec` and commit it first, then re-run.')

  const dirty = git(root, ['status', '--porcelain']).split('\n').filter((l) => l && !l.startsWith('??'))
  if (dirty.length) refusals.push(`working tree not clean — commit or stash first:\n${dirty.slice(0, 10).map((l) => '      ' + l).join('\n')}${dirty.length > 10 ? `\n      … +${dirty.length - 10} more` : ''}`)

  try {
    const { listSessionIds, readRawRecord } = await import('./layout.js')
    const ids = listSessionIds()
    if (ids.length) {
      const rows = ids.map((id) => { const r = readRawRecord(id); return `      ${id}  (${r?.status ?? 'unreadable'})` })
      refusals.push(`${ids.length} session(s) still exist for this project — drain them first (merge, then \`spex session close <id>\`; a worktree branched pre-migration would conflict):\n${rows.join('\n')}`)
    }
  } catch (e) { refusals.push(`could not enumerate this project's sessions (${(e as Error).message}) — refusing to migrate blind.`) }

  for (const dir of configRoots) if (existsSync(join(dir, '.plugins'))) refusals.push(`${relative(root, dir)}/.plugins already exists beside .config — resolve by hand.`)
  for (const f of yatsuFiles) {
    const target = basename(f) === 'yatsu.md' ? join(dirname(f), 'eval.md') : join(dirname(f), basename(f).replace(/yatsu\.evals\.ndjson$/, 'evals.ndjson'))
    if (existsSync(target)) refusals.push(`rename collision: ${relative(root, target)} already exists beside ${relative(root, f)}.`)
  }

  let configNode: string | null = null, configNodeFlag: Flag | null = null
  for (const dir of specRoots) {
    const cand = join(dir, 'config')
    if (!existsSync(join(cand, 'spec.md'))) continue
    if (existsSync(join(dir, 'plugin-system'))) { refusals.push(`${relative(root, dir)}/plugin-system already exists beside config/ — resolve by hand.`); continue }
    const sha = git(root, ['hash-object', join(cand, 'spec.md')])
    if (CONFIG_NODE_SHAS.includes(sha)) configNode = cand
    else configNodeFlag = { file: relative(root, join(cand, 'spec.md')), line: null, reason: 'a node named `config` exists but its spec.md matches no stock version of spexcode\'s plugin-system spec — left untouched (rename it by hand ONLY if it really is the plugin-system spec)' }
  }

  return { root, specRoots, configRoots, yatsuFiles, configNode, configNodeFlag }
}
