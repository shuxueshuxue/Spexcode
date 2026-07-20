import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot, git, driftIndex, historyIndex, rowsFor } from './git.js'
import { loadSpecs } from './specs.js'
import { readJsonConfig } from './layout.js'
import { extractors, extractorFor, extOf, resolveAnchor, windowCommits, anchorHitCommits } from './anchors.js'
import { DEFAULT_TEST_GLOBS, sourcePolicyDescription, trackedSourceFiles } from './source-files.js'

export type Finding = { level: 'error' | 'warn'; rule: string; spec?: string; file?: string; msg: string }

export type LintConfig = {
  governedRoots: string[]       // dirs whose tracked source files must each be governed by a spec. '.' = whole project.
  sourceExtensions: string[] | null // explicit extension override; null uses tracked-text source discovery
  testGlobs: string[]           // globs EXCLUDED from coverage; set [] to govern tests too
  identifierExtensions: string[]// extensions the altitude bare-filename signal recognises (see IDENT below)
  altitude: { lineBudget: number; charBudget: number; sizeable: number; dense: number; steps: number }
  maxChildren: number        // breadth budget: warn at >= this many direct children
  maxOwners: number          // warn when a file is governed (code:) by > this many nodes
  scenarioTags: string[]     // the closed vocabulary an eval scenario's `tags:` must draw from; extend it to mint a new tag
  scopedCodeMiss: 'warn' | 'ignore' // the file-level drift ADVISORY on a selector-scoped code: file whose window has no
                             // selector hit ([[code-anchor]]). 'warn' (default) keeps today's drift warning; 'ignore'
                             // silences ONLY that advisory — hit blocks, bare code drift, integrity, acks, related
                             // semantics, and eval freshness are all untouched by this knob.
}
const DEFAULT_CONFIG: LintConfig = {
  governedRoots: ['spec-dashboard/src', 'spec-cli/src'],
  sourceExtensions: null,
  testGlobs: DEFAULT_TEST_GLOBS,
  identifierExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'md'],
  altitude: { lineBudget: 50, charBudget: 4200, sizeable: 35, dense: 1.3, steps: 3 },
  maxChildren: 8,
  maxOwners: 3,
  scenarioTags: ['frontend-e2e', 'backend-api', 'cli', 'desktop', 'mobile'],
  scopedCodeMiss: 'warn',
}
export function loadConfig(root: string): LintConfig {
  // Absent spexcode.json → tuned defaults; a MALFORMED one throws LOUD (readJsonConfig) rather than
  // silently reverting the author's budgets to defaults and green-washing the very warnings they tuned.
  const c = readJsonConfig(join(root, 'spexcode.json'))?.lint ?? {}
  const merged = { ...DEFAULT_CONFIG, ...c, altitude: { ...DEFAULT_CONFIG.altitude, ...(c.altitude ?? {}) } }
  return normalizeConfig(merged)
}

// canonicalize two adopter-input footguns that would otherwise SILENTLY match ZERO files (the same failure
// class as an unset governedRoots — a green board that governs nothing). Both are natural mistakes a non-web
// adopter makes reading the prose, so we accept-what-they-meant rather than reject:
//  - a LEADING DOT on an extension: the matcher is `\.(ext)$`, so a literal ".ts" becomes `\..ts$` and never
//    matches. Strip leading dots → ["ts"] and [".ts"] both work (prose historically showed ".ts").
//  - a testGlob with NO "/": globs anchor to the full repo-relative path, so a bare "*.test.ts" matches only
//    ROOT-level files and leaks every nested test into coverage. A slash-less glob is a basename intent →
//    prepend "**/" so it matches that basename at any depth (the default "**/*.test.*" already does).
export function normalizeConfig(cfg: LintConfig): LintConfig {
  // a mistyped enum silently reverting to the default would green-wash (or over-warn) exactly the
  // advisory the author meant to tune — same fail-loud rule as a malformed spexcode.json.
  if (cfg.scopedCodeMiss !== 'warn' && cfg.scopedCodeMiss !== 'ignore')
    throw new Error(`spexcode.json lint.scopedCodeMiss must be "warn" or "ignore", got ${JSON.stringify(cfg.scopedCodeMiss)}`)
  const dedot = (xs: string[]) => xs.map((x) => x.replace(/^\.+/, ''))
  return {
    ...cfg,
    sourceExtensions: cfg.sourceExtensions === null ? null : dedot(cfg.sourceExtensions),
    identifierExtensions: dedot(cfg.identifierExtensions),
    testGlobs: cfg.testGlobs.map((g) => (g.includes('/') ? g : `**/${g}`)),
  }
}

// code-identifier signals: camelCase | snake_case | foo( | `backticked` | /a/path.ext | bare file.ext. Only
// the bare-filename branch needs the extension allowlist (config, so a non-TS project recognises its own
// sources) — without it a bare `word.word` would match ordinary prose like "e.g".
function identRe(extensions: string[]): RegExp {
  const ext = extensions.join('|')
  return new RegExp(`[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*|\\b[a-z]+_[a-z0-9_]+\\b|\\b\\w+\\(|\`[^\`]+\`|\\/[\\w./-]+\\.\\w+|\\b[\\w-]+\\.(${ext})\\b`, 'g')
}
// step-by-step how-to phrasing: numbered steps, or sequencing connectives that walk through mechanics.
const STEP_LINE = /^\s*(\d+[.)]\s|[-*]\s*(first|then|next|finally)\b)|(^|[,;]\s*)(first|then|next|finally),/i
// returns a one-line reason naming whichever low-altitude proxy(ies) tripped (length / identifier density /
// step-by-step), or null when the body is at altitude.
function altitude(body: string, cfg: LintConfig, ident: RegExp): string | null {
  const a = cfg.altitude
  const lines = body.split('\n')
  const nb = lines.filter((l) => l.trim()).length
  const chars = body.length
  // identifiers and step phrasing are read from PROSE only — a fenced code sample is acknowledged code,
  // not low-altitude narration, so it inflates length but not density.
  let inFence = false, signals = 0, steps = 0
  for (const l of lines) {
    if (/^\s*```/.test(l)) { inFence = !inFence; continue }
    if (inFence || !l.trim()) continue
    signals += l.match(ident)?.length ?? 0
    if (STEP_LINE.test(l)) steps++
  }
  const density = signals / Math.max(1, nb)
  const why: string[] = []
  if (nb > a.lineBudget || chars > a.charBudget) why.push(`${nb} non-blank lines / ${chars} chars over budget (${a.lineBudget}/${a.charBudget})`)
  if (nb > a.sizeable && density > a.dense) why.push(`code-identifier density ${density.toFixed(2)}/line over ${a.dense}`)
  if (nb > a.sizeable && steps >= a.steps) why.push(`${steps} step-by-step how-to lines`)
  return why.length ? why.join('; ') : null
}

export async function specLint(): Promise<Finding[]> {
  const root = repoRoot()
  const cfg = loadConfig(root)
  const ident = identRe(cfg.identifierExtensions)
  const specs = await loadSpecs()
  const out: Finding[] = []

  // integrity + build the file -> owners map. A relation's STRUCTURAL problems (a duplicate entry,
  // bare/scoped mixing on one base path, a selector on a glob — all from parseRelation,
  // [[code-anchor]]) are integrity errors: malformed edges block like broken ones.
  const owners = new Map<string, string[]>()
  const claimed = new Set<string>()
  for (const s of specs) {
    for (const p of s.relationProblems)
      out.push({ level: 'error', rule: 'integrity', spec: s.id, msg: `'${s.id}' ${p}` })
    const scopedPaths = new Set(s.codeScoped.map((e) => e.path))
    for (const f of s.code) {
      if (!existsSync(join(root, f)))
        out.push({ level: 'error', rule: 'integrity', spec: s.id, file: f, msg: `spec '${s.id}' lists a missing file: ${f}` })
      claimed.add(f)
      // a selector-SCOPED entry claims named units, not the whole file, so it stays out of the owners
      // bound below ([[code-anchor]]) — `spex spec owner` still displays it as a (scoped) governor.
      if (!scopedPaths.has(f)) owners.set(f, [...(owners.get(f) ?? []), s.id])
    }
    // one-govern: a node is source of truth for at most ONE file — DISTINCT base paths; several
    // `path#symbol` selectors on the same file are one subject — so drift/eval/ack have a single
    // unambiguous subject (see [[governed-related]]). >1 is a defect — pick the true subject, demote the
    // rest to related. ERROR (the node-side twin of too-many-owners' file-side bound). 0 is fine.
    if (s.code.length > 1)
      out.push({ level: 'error', rule: 'one-govern', spec: s.id, msg: `'${s.id}' governs ${s.code.length} files [${s.code.join(', ')}] — a node is source of truth for at most ONE. Keep the true subject in code:, move the rest to related:` })
  }
  // a file is COVERED if any node GOVERNS (code:) or merely REFERENCES (related:) it; integrity covers both.
  // `related:` is the coverage net: govern is a sharp ideally-one-file pointer, so most files are reached by
  // related, not govern (see [[governed-related]]). It carries coverage but never drift, never eval freshness.
  for (const s of specs) for (const f of s.related) {
    if (!existsSync(join(root, f)))
      out.push({ level: 'error', rule: 'integrity', spec: s.id, file: f, msg: `spec '${s.id}' lists a missing related file: ${f}` })
    claimed.add(f)
  }

  // id-format: a node id (its leaf dir basename) passes an EXACT per-character whitelist — an ascii char
  // must be [a-z0-9-]; a non-ascii char must be a unicode letter/number (judged on NFC, the mint's
  // canonical form) — and is UNIQUE tree-wide (ERROR). This is THE id vocabulary, defined once (the
  // spec-lint node's rule table) and referenced by [[mentions]] / [[id-url-safe]]: CJK and every other
  // letter script is first-class, exactly what the script-agnostic resolve machinery already accepts.
  // Everything else is forbidden by construction, no heuristics — space, '/', uppercase Latin (lowercase
  // is the Latin norm), control chars, and '_' (reserved as the mint's parent-qualification join; a '_'
  // inside a basename would make that join ambiguous). One optional leading dot is allowed — the
  // reflexive plugin root `.plugins` is dot-prefixed by design. Uniqueness is what keeps the leaf THE id:
  // on a collision the mint must parent-qualify with `_`, so every surface suddenly speaks a longer id
  // than the dir name — legal to the machinery, illegible to people.
  const ID_RE = /^\.?(?:[a-z0-9-]|(?![\x00-\x7F])[\p{L}\p{N}])+$/u
  const leafOf = (p: string) => { const segs = p.split('/'); return segs[segs.length - 2] }
  const byLeaf = new Map<string, string[]>()
  for (const s of specs) {
    const leaf = leafOf(s.path)
    byLeaf.set(leaf, [...(byLeaf.get(leaf) ?? []), s.path])
    if (!ID_RE.test(leaf.normalize('NFC')))
      out.push({ level: 'error', rule: 'id-format', spec: s.id, msg: `node dir '${leaf}' is not a valid id — each char is ascii [a-z0-9-] or a non-ascii unicode letter/number (one optional leading dot); space, '/', '_', uppercase Latin and control chars are forbidden; rename the directory` })
  }
  for (const [leaf, paths] of byLeaf) {
    if (paths.length > 1)
      out.push({ level: 'error', rule: 'id-format', msg: `leaf id '${leaf}' names ${paths.length} nodes [${paths.map((p) => p.replace(/\/spec\.md$/, '')).join(', ')}] — a leaf id is unique tree-wide; rename all but one` })
  }

  // confusable-id: two leaf ids one edit apart read as the same word (WARN — a typo in either reaches a
  // real, wrong node). Deliberately conservative: distance exactly 1, so hierarchy naming like
  // graph/graph-delivery (a whole suffix apart) and verb pairs like evidence-put/evidence-get (distance 2)
  // never warn — better to miss a borderline pair than to nag legitimate siblings. Distance is measured
  // in CODE POINTS, script-agnostic: a CJK pair one character apart (节点/结点 — a classic homophone
  // IME slip) warns like an ascii pair, an astral char counts as one edit (not two surrogate units), and
  // a pure-CJK id can never sit one edit from a pure-ascii one.
  const lev1 = (a: string, b: string): boolean => {
    const A = [...a], B = [...b]
    if (Math.abs(A.length - B.length) > 1 || a === b) return false
    let i = 0
    while (i < A.length && i < B.length && A[i] === B[i]) i++
    const rest = (x: string[], k: number) => x.slice(k).join('')
    return rest(A, i + 1) === rest(B, i + 1) || rest(A, i + 1) === rest(B, i) || rest(A, i) === rest(B, i + 1)
  }
  const leaves = [...byLeaf.keys()]
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    if (lev1(leaves[i], leaves[j]))
      out.push({ level: 'warn', rule: 'confusable-id', msg: `leaf ids '${leaves[i]}' and '${leaves[j]}' are one edit apart — easily confused; if they are distinct concepts, rename one to read apart` })
  }

  // mention: a `[[id]]` in a body must name a real node (ERROR — a dangling mention is a broken edge in
  // the very graph the tree exists to keep honest). Checked against the SAME minted ids every other
  // surface resolves ([[id-url-safe]]). Prose only: a fenced block or inline `code span` is sample text
  // (`[[node]]`, `[[<id>]]` placeholders live there), not a reference.
  const idSet = new Set(specs.map((s) => s.id))
  const MENTION_RE = /\[\[(\.?[\p{L}\p{N}_-]+)\]\]/gu
  for (const s of specs) {
    let inFence = false
    for (const rawLine of s.body.split('\n')) {
      if (/^\s*```/.test(rawLine)) { inFence = !inFence; continue }
      if (inFence) continue
      const line = rawLine.replace(/`[^`]*`/g, '')
      for (const m of line.matchAll(MENTION_RE)) {
        if (!idSet.has(m[1]))
          out.push({ level: 'error', rule: 'mention', spec: s.id, msg: `'${s.id}' mentions [[${m[1]}]] — no such node; retarget or drop it (backtick it if it is sample text)` })
      }
    }
  }

  // living: a spec body describes the node's CURRENT intent — it is not a changelog. Version history
  // (every content commit, its reason/session/line-diff) is read from git and shown in the dashboard's
  // recent/history tabs, so a `## vN`-style heading in the body is duplicated, drift-prone state.
  // Reject it. Fence-aware — a `## v2` inside a ``` block is sample text, not a heading.
  const VER_HEADING = /^#{1,6}\s+v\d+\b/
  for (const s of specs) {
    let inFence = false
    for (const line of s.body.split('\n')) {
      if (/^\s*```/.test(line)) { inFence = !inFence; continue }
      if (!inFence && VER_HEADING.test(line))
        out.push({ level: 'error', rule: 'living', spec: s.id, msg: `'${s.id}' has a changelog heading "${line.trim()}" — keep the body current-state; version history lives in git (recent/history tabs)` })
    }
  }

  // altitude: a body that re-narrates mechanics instead of stating contract/intent (WARN — soft budget).
  for (const s of specs) {
    const why = altitude(s.body, cfg, ident)
    if (why) out.push({ level: 'warn', rule: 'altitude', spec: s.id, msg: `'${s.id}' body reads low-altitude (mechanics, not contract): ${why}` })
  }

  // breadth: a node with too many DIRECT children is altitude's structural twin — splitting a node to pass
  // altitude shouldn't just relocate the sprawl into a wide flat fan-out (WARN — soft, advisory). Children
  // are derived from the parent links loadSpecs already computes; no explicit child array to keep in sync.
  const childCount = new Map<string, number>()
  for (const s of specs) if (s.parent) childCount.set(s.parent, (childCount.get(s.parent) ?? 0) + 1)
  for (const s of specs) {
    const n = childCount.get(s.id) ?? 0
    if (n >= cfg.maxChildren)
      out.push({ level: 'warn', rule: 'breadth', spec: s.id, msg: `'${s.id}' has ${n} direct child nodes (>= ${cfg.maxChildren}) — is an intermediate grouping layer missing? (a flat list of genuine peers is sometimes right — ignore if so)` })
  }

  // coverage: every governed source file must be claimed by at least one spec.
  const governed = trackedSourceFiles(root, cfg.governedRoots, cfg)
  if (governed.length === 0)
    out.push({ level: 'warn', rule: 'coverage', msg: `governing NOTHING — 0 source candidates under governedRoots [${cfg.governedRoots.join(', ')}] using the ${sourcePolicyDescription(cfg)}. Repair under the "lint" key in spexcode.json (top-level keys are ignored): set governedRoots to the tracked source roots, or set sourceExtensions (e.g. ["py"] / ["rs"] / ["go"]) to replace the default file-type policy.` })
  for (const f of governed)
    if (!claimed.has(f)) out.push({ level: 'warn', rule: 'coverage', file: f, msg: `no spec governs: ${f}` })

  // too-many-owners: many nodes governing one file is ordinary composition (drift fans to each — correct,
  // every owner has a stake), so this is NOT flagged. Only an OVER-owned file is a smell — governed by more
  // than maxOwners nodes, it has accreted more independently-specified functionality than one file should
  // hold (see [[governed-related]]). ONE summary line (not one per file — its own wall of noise): the count,
  // the worst offenders, and the remedy, which blames the FILE not the ownership — SPLIT it so each governor
  // reclaims its own module; or merge the nodes if they're one concern; or give it a single foundation owner.
  const over = [...owners].filter(([, ids]) => ids.length > cfg.maxOwners).sort((a, b) => b[1].length - a[1].length)
  if (over.length) {
    const top = over.slice(0, 5).map(([f, ids]) => `${f.split('/').pop()}(${ids.length})`).join(', ')
    out.push({ level: 'warn', rule: 'owners', msg: `${over.length} file(s) are governed by > ${cfg.maxOwners} nodes — each holds more separately-specified functionality than one file should. Worst: ${top}. SPLIT the file so each governor owns its own module (or merge the nodes, or give it a single foundation owner + related:).` })
  }

  // code anchors ([[code-anchor]]): a code:/related: entry may pin named units (`path#symbol` — any
  // number per base file, OR'd). On code:, the anchor is the BLOCKING tier of drift: a window
  // commit (spec's last version..HEAD, non-merge, touching the governed file) whose --unified=0 hunks
  // intersect any pinned unit's line range — extracted from the file AS OF that commit, by the
  // extension's ONE designated extractor — is ONE anchor-drift ERROR naming the hit selectors, unless a
  // Spec-OK ack covers it. On related:, the SAME engine yields only a soft warn on a hit — a scoped
  // related miss is silent (never blocks, no ack, no eval freshness). Resolution failures are never
  // silent for either relation: a dead or ambiguous selector, a selector on a directory, an unparseable
  // working-tree file, an extension with no designated extractor, and a designated extractor that can't
  // run here (no host typescript) all ERROR with the repair spelled out.
  const regs = extractors(root)
  const [didx, hidx] = await Promise.all([driftIndex(root), historyIndex(root)])
  const readyWarned = new Set<string>()
  for (const s of specs) {
    for (const { relation, entries } of [{ relation: 'code' as const, entries: s.codeScoped }, { relation: 'related' as const, entries: s.relatedScoped }]) {
      for (const { path, selectors } of entries) {
        const x = extractorFor(regs, extOf(path))
        if (!x) {
          out.push({ level: 'error', rule: 'integrity', spec: s.id, file: path, msg: `'${s.id}' anchors ${path}#${selectors.join(', #')} (${relation}:), but no extractor is designated for '.${extOf(path)}' files — this language has no anchor support yet: add a LangSpec row (anchors.ts) or drop the selector(s)` })
          continue
        }
        const ready = x.ready()
        if (ready !== true) {
          // once per (extractor, reason), even across several anchored nodes — one repair, one message.
          if (!readyWarned.has(x.id + ready)) { readyWarned.add(x.id + ready); out.push({ level: 'error', rule: 'integrity', msg: `anchor extractor '${x.id}' cannot run: ${ready}` }) }
          continue
        }
        if (!existsSync(join(root, path))) continue // the missing FILE already errored above
        if (statSync(join(root, path)).isDirectory()) {
          out.push({ level: 'error', rule: 'integrity', spec: s.id, file: path, msg: `'${s.id}' puts a selector on a directory (${relation}: ${path}#${selectors[0]}) — a selector scopes ONE real file` })
          continue
        }
        let units
        try { units = x.extract(readFileSync(join(root, path), 'utf8'), path) } catch (e: any) {
          out.push({ level: 'error', rule: 'integrity', spec: s.id, file: path, msg: `anchor ${path}#${selectors.join(', #')} ('${s.id}') is unverifiable — the current file does not parse: ${e?.message ?? e}` })
          continue
        }
        // each selector resolves (or errors) on its own; only the live ones feed the window engine.
        const live: string[] = []
        for (const sym of selectors) {
          const res = resolveAnchor(units, sym)
          if ('dead' in res) {
            out.push({ level: 'error', rule: 'integrity', spec: s.id, file: path, msg: `dead anchor: ${path}#${sym} ('${s.id}') names no unit on the current tree — the unit was deleted or renamed; update the spec's ${relation}: entry to follow it` })
            continue
          }
          if ('ambiguous' in res) {
            out.push({ level: 'error', rule: 'integrity', spec: s.id, file: path, msg: `ambiguous anchor: ${path}#${sym} ('${s.id}') names ${res.ambiguous} same-named units in one file — an anchor must be unique; rename one unit` })
            continue
          }
          if (res.ok.typeOnly)
            out.push({ level: 'warn', rule: 'anchor', spec: s.id, file: path, msg: `${path}#${sym} anchors a ${res.ok.kind} — anchoring a type is usually wrong (types reshape with every refactor); anchor the behaviour-bearing unit instead` })
          live.push(sym)
        }
        if (!live.length) continue
        const since = rowsFor(hidx, s.path)[0]?.hash || ''
        const win = windowCommits(didx, since, path)
        if (!win.length) continue
        const hits = await anchorHitCommits(root, win, path, live, x)
        if (!hits.length) continue
        const hitSyms = [...new Set(hits.flatMap((h) => h.selectors))]
        const shas = hits.map((h) => h.commit.slice(0, 8)).join(', ')
        const unparseable = hits.filter((h) => h.unparseable)
        const parseNote = unparseable.length ? ` (${unparseable.length} of these could not be parsed at that commit — counted as hits conservatively)` : ''
        if (relation === 'code')
          out.push({ level: 'error', rule: 'anchor-drift', spec: s.id, file: path, msg: `${path}#${hitSyms.join(', #')} was changed by ${hits.length} commit(s) since spec '${s.id}' v${s.version} [${shas}]${parseNote} — the anchored contract's code moved: update the spec, or 'spex spec ack ${s.id} --reason "…"' if the contract still holds` })
        else
          out.push({ level: 'warn', rule: 'related-drift', spec: s.id, file: path, msg: `related ${path}#${hitSyms.join(', #')} ('${s.id}') was changed by ${hits.length} commit(s) since v${s.version} [${shas}]${parseNote} — a scoped dependency shifted, worth a glance (SOFT: never blocks, no ack, no eval staleness)` })
      }
    }
  }

  // drift: a governed file has commits NOT yet reflected in its spec. Judged by true git ancestry —
  // loadSpecs computes `driftFiles` via driftFor() over the one cached driftIndex walk (git.ts): a
  // commit to the file counts iff it is NOT reachable from the spec's latest version (in-memory
  // parent-edge reachability, the equivalent of `rev-list <version>..HEAD -- <file>`), never a
  // log-position or timestamp guess.
  // A selector-SCOPED code file keeps this file-level advisory by default (a miss still nudges); the
  // committed `lint.scopedCodeMiss: "ignore"` silences ONLY this advisory for scoped entries — the
  // anchor engine's verdicts above (hit = block, resolution failures = integrity) are untouched.
  for (const s of specs) {
    const scopedPaths = new Set(s.codeScoped.map((e) => e.path))
    for (const d of s.driftFiles) {
      if (cfg.scopedCodeMiss === 'ignore' && scopedPaths.has(d.file)) continue
      out.push({ level: 'warn', rule: 'drift', spec: s.id, file: d.file, msg: `${d.file} is ${d.behind} commit(s) ahead of spec '${s.id}' (v${s.version}) — may be stale` })
    }
  }

  // related drift: the SOFT tier ([[governed-related]]). A referenced file moved ahead of the node's
  // version — a nudge that a dependency shifted. Same ancestry basis as govern drift, but WARN-only,
  // never reaching the commit gate (driftGate reads govern) or eval freshness. It is COMMON (shared substrate and
  // faces change often without re-versioning every referrer), so per-file it is a wall; like
  // too-many-owners it collapses to ONE summary line, with the per-file detail riding the board
  // (relatedDriftFiles). It stays a soft edge, never a per-file interruption.
  const rd = specs.flatMap((s) => s.relatedDriftFiles.map((d) => ({ id: s.id, behind: d.behind })))
  if (rd.length) {
    const byNode = new Map<string, number>()
    for (const d of rd) byNode.set(d.id, (byNode.get(d.id) ?? 0) + 1)
    const worst = [...byNode].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => `${id}(${n})`).join(', ')
    out.push({ level: 'warn', rule: 'related-drift', msg: `${rd.length} related file(s) across ${byNode.size} node(s) drifted ahead of their spec (SOFT — a dependency shifted, worth a glance; never blocks, no ack, no eval staleness). Most: ${worst}` })
  }

  return out
}

export const DRIFT_GUIDANCE = `DRIFT — a governed file has moved ahead of its spec. A CHECKPOINT, not a chore: find WHERE the truth
broke along  raw intent → expanded spec → code: link → code structure → implementation, fix THAT layer.

  Inspect:  spex spec lint                                                       which files, against which spec
            the node's spec.md                                             its raw source + expanded spec
            git diff $(git log -1 --format=%H -- <spec.md>)..HEAD -- <file>   the code delta since the spec

Diagnose, then apply the one honest remedy:
  • contract changed        → rewrite the spec body to the new intent, commit it (re-versions the node)
  • only mechanics changed  → spex spec ack <node>   "checked — spec still valid"   (give a real reason)
  • implementation is WRONG → the spec is right; fix the CODE back toward it, then ack
  • wrong code: link        → the node shouldn't own this file (or owns it too broadly); fix frontmatter
  • expanded spec ≠ raw     → the spec drifted from human intent; fix the expanded spec to serve the raw
  • structural mismatch     → one file owned by many specs / a feature with no home: refactor so a file
                              maps to a node, or file an issue and link it (defer honestly)

Never patch. A reasoned ack or a real fix are recorded and re-judged at review; a blind ack is a lie.`
