import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { repoRoot, headSha, driftIndex, stagedFiles, git } from '../../spec-cli/src/git.js'
import { loadSpecs } from '../../spec-cli/src/specs.js'
import { loadConfig } from '../../spec-cli/src/lint.js'
import { trackedSourceFiles } from '../../spec-cli/src/source-files.js'
import { mainBranch, envSessionId, readRawRecord } from '../../spec-cli/src/layout.js'
import { evalNodes, validateScenarios, resolveEvalNode, scenarioHash, EVAL_FILE, type EvalNode, type ScenarioTestReference } from './scenarios.js'
import { readReadings, readSidecar, appendReading, appendRetraction, latestPerScenario, evidenceOf, isJsonBlob, type Reading, type Verdict, type Evidence, type EvidenceKind, type Retraction } from './sidecar.js'
import { staleAxes, contentProbeFor } from './freshness.js'
import { scenarioIndex } from './scenariofresh.js'
import { loadEvalRemarkTracks, trackKey } from '../../spec-cli/src/issues.js'
import { stripRefSigil } from '../../spec-cli/src/mentions.js'
import { putBlob, blobPath, listBlobs, gc, isStrayBlob } from './cache.js'
import { validateTimeline, normalizeTimeline } from './timeline.js'
import { evalTimeline, readBlobByHash, type EvalTimeline } from './evaltab.js'

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
// every value of a REPEATABLE flag (e.g. `--image a --image b`), in argv order; a trailing `--image` with no
// value (or another flag as its value) is dropped so a typo can't swallow the next flag.
function flags(args: string[], name: string): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) if (args[i] === `--${name}`) { const v = args[i + 1]; if (v !== undefined && !v.startsWith('--')) out.push(v) }
  return out
}
const has = (args: string[], name: string) => args.includes(`--${name}`)
const positional = (args: string[]) => args.find((a) => !a.startsWith('--'))

// join by node directory (not id) so a reparent/rename is seen the way lint sees it
type ScoredNode = EvalNode & { codeFiles: string[] }

async function gatherNodes(root: string): Promise<ScoredNode[]> {
  const specs = await loadSpecs()
  const codeByDir = new Map<string, string[]>()
  for (const s of specs) codeByDir.set(dirname(s.path), s.code)   // s.path = repo-relative spec.md path
  return evalNodes(root).map((n) => ({ ...n, codeFiles: codeByDir.get(relative(root, n.dir)) ?? [] }))
}

// resolve `.` → the node this worktree works on: the session record's `node` (the authoritative ref a
// dashboard session was bound to — NOT derivable from the branch, whose slug carries a `-<id4>` suffix),
// else the `node/<id>` branch. The record now lives in the GLOBAL store keyed by the harness session id
// ([[state]]), so we read it via the env session id; a self-launched agent with no record falls back to the branch.
function currentNodeId(root: string): string | null {
  const id = envSessionId()
  if (id) { const rec = readRawRecord(id); if (rec?.node) return rec.node }
  try {
    const branch = git(['-C', root, 'symbolic-ref', '--short', 'HEAD']).trim()
    if (branch.startsWith('node/')) return branch.slice('node/'.length)
  } catch { /* detached / no branch */ }
  return null
}

// isUiPath answers a FRONTEND-specific question — "does this node need a real BROWSER reading?" — and is
// consumed by the session-eval's `uncoveredFrontend` blindspot, NOT by eval lint's coverage check. Scan uses
// the shared tracked-source classifier instead, so a non-web project's sources are held to the loss discipline
// too; this stays web-shaped on purpose.
const UI_FILE = /\.(jsx|tsx|vue|svelte|css)$/
export const isUiPath = (p: string) => UI_FILE.test(p) || p.includes('spec-dashboard/')

// merge-base anchored so the main branch advancing isn't counted as this branch's change; a git error yields ∅ (--changed scan stays silent)
function changedSinceBase(root: string): Set<string> {
  const out = new Set<string>()
  const add = (s: string) => { for (const l of s.split('\n')) { const t = l.trim(); if (t) out.add(t) } }
  try {
    const base = git(['-C', root, 'merge-base', mainBranch(), 'HEAD']).trim()
    if (base) add(git(['-C', root, '-c', 'core.quotePath=false', 'diff', '--name-only', base]))
    add(git(['-C', root, '-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard']))
  } catch { /* no base → empty set */ }
  return out
}

// A node owns the files under its spec dir except those under a descendant node. Its other selection axis
// is the supplied code list — node code for per-node findings, effective scenario code for drift.
export function nodeChanged(dirRel: string, codeFiles: readonly string[], changed: Set<string>, nodeDirs: Iterable<string> = []): boolean {
  const descendants = [...nodeDirs].filter((d) => d !== dirRel && d.startsWith(dirRel + '/'))
  for (const c of changed) {
    const inNodeDir = c === dirRel || c.startsWith(dirRel + '/')
    const inDescendant = descendants.some((d) => c === d || c.startsWith(d + '/'))
    if (inNodeDir && !inDescendant) return true
  }
  return codeFiles.some((cf) => {
    if (changed.has(cf)) return true
    const dir = cf.replace(/\/+$/, '') + '/'
    const re = cf.includes('*') ? new RegExp('^' + cf.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$') : null
    for (const c of changed) { if (c.startsWith(dir)) return true; if (re && re.test(c)) return true }
    return false
  })
}

async function scan(args: string[] = []): Promise<number> {
  const root = repoRoot()
  const cfg = loadConfig(root)
  // eval-coverage fires on ANY governed source file per the same classifier as spec coverage, not just
  // frontend — so backend/CLI/non-web source is held to the loss discipline too, not exempted.
  const sourceFiles = new Set(trackedSourceFiles(root, cfg.governedRoots, cfg))
  const changedOnly = has(args, 'changed')
  const changed = changedOnly ? changedSinceBase(root) : null
  const idx = await driftIndex(root)
  // the off-history content fallback ([[eval-core]]): a rebased/folded-away anchor with byte-identical
  // governed content reads fresh instead of false-positive stale. Lazy — in-history readings never probe.
  const probe = contentProbeFor(root)
  const scidx = await scenarioIndex(root, evalNodes(root).map((n) => n.evalPath))
  const specs = await loadSpecs()
  // the non-git REMARK freshness axis ([[remark-teeth]]): the trunk remark track, read ONCE — the CLI is the
  // whole model, so `spex eval lint` shows a remark-stale scenario with no server running.
  const remarkTracks = loadEvalRemarkTracks()
  // a file may be governed by several nodes — ordinary composition, not a hub to skip (see governed-related).
  // A change to a shared governed file legitimately triggers EVERY governing node's eval signal, mirroring how
  // lint's drift now fans to every owner; nobody's loss signal is suppressed. An over-owned file is lint's
  // `owners` concern (split it), not a reason to go silent here.
  const yByDir = new Map(evalNodes(root).map((n) => [relative(root, n.dir), n]))
  const nodeDirs = specs.map((s) => dirname(s.path))
  let flaggedNodes = 0, malformed = 0, staleScores = 0, missingScores = 0, uncovered = 0, danglingTracks = 0
  for (const s of specs) {
    const dirRel = dirname(s.path)
    const nodeSelected = !changed || nodeChanged(dirRel, s.code, changed, nodeDirs)
    const y = yByDir.get(dirRel)
    const findings: string[] = []
    if (y) {
      // schema first: a malformed eval.md is the loudest gap — report each violation, then still scan its
      // (leniently-parsed) scenarios for stale/missing so a typo doesn't mask a real freshness gap.
      if (nodeSelected) {
        for (const e of validateScenarios(readFileSync(join(y.dir, EVAL_FILE), 'utf8'), cfg.scenarioTags, root)) {
          malformed++
          findings.push(`  • eval-schema: '${s.id}' ${e} — fix ${y.evalPath}`)
        }
      }
      const latest = latestPerScenario(readReadings(y.sidecarPath))
      for (const sc of y.scenarios) {
        // a scenario's own `code` narrows its freshness CODE axis to a subset; a path that does not exist
        // would make that axis silently immortal (changedSince finds no commits for it), so flag it LOUD as a
        // malformed declaration — the same loud-fail spirit as a bad node `code:`.
        if (nodeSelected) {
          for (const [field, paths] of [['code', sc.code], ['related', sc.related]] as const) {
            const ghosts = (paths ?? []).filter((p) => !existsSync(join(root, p)))
            if (ghosts.length) {
              malformed++
              findings.push(`  • eval-schema: '${s.id}' scenario '${sc.name}' \`${field}\` path(s) not found: ${ghosts.join(', ')} — fix ${y.evalPath}`)
            }
          }
        }
        const codeFiles = sc.code?.length ? sc.code : s.code   // scenario's own subset, else the node's list
        const driftSelected = !changed || nodeChanged(dirRel, codeFiles, changed, nodeDirs)
        // carry the scenario's tags on the finding line — its SURFACE (e.g. frontend-e2e = browser-measured)
        // is what routes a drift/missing gap to the right measuring hand, so the proactive nudge and a human
        // reading `spex eval lint` both see whether this stale score needs a real e2e/browser pass to refresh.
        const tagStr = sc.tags?.length ? ` [${sc.tags.join(',')}]` : ''
        const r = latest.get(sc.name)
        if (!r) {
          if (nodeSelected) {
            missingScores++
            findings.push(`  • eval-missing: '${s.id}' scenario '${sc.name}'${tagStr} has no eval yet — measure with \`spex eval add ${s.id}\``)
          }
          continue
        }
        if (!driftSelected) continue
        const remSignals = (remarkTracks.get(trackKey(s.id, sc.name))?.remarks ?? []).map((rm) => ({ resolved: !!rm.resolved, resolvedAt: rm.resolvedAt }))
        const axes = staleAxes(r, codeFiles, y.evalPath, idx, scidx, remSignals, probe, sc)
        if (axes.length) {
          staleScores++
          // a remark-stale scenario is unlocked by a second-party resolve, then a fresh reading; the git axes
          // by a re-measure. Both read the same word: "re-measure with spex eval add". The anchor axis is
          // a LOSS, not a change — the reading's commit object no longer exists, so content can't testify.
          const others = axes.filter((a) => a !== 'anchor')
          const why = [
            ...(axes.includes('anchor') ? [`anchor commit ${r.codeSha.slice(0, 7)} is gone — history rewritten and pruned`] : []),
            ...(others.length ? [`${others.join(', ')} changed since ${r.codeSha.slice(0, 7)}`] : []),
          ].join('; ')
          findings.push(`  • eval-drift: '${s.id}' scenario '${sc.name}'${tagStr} is stale (${why}) — re-measure with \`spex eval add ${s.id}\``)
        }
      }
      // DANGLING remark tracks (directive 5): a (node, scenario) remark track whose scenario is gone from
      // eval.md AND has no reading (renamed/deleted) — its remarks would surface nowhere on the loss signal.
      // One note per node so the orphan is visible; the remarks stay resolvable/retractable via their refs
      // (`spex remark resolve`/`spex remark retract`), and they age nothing (there is no reading to stale).
      const declared = new Set(y.scenarios.map((sc) => sc.name))
      const orphans = [...remarkTracks.values()].filter((tr) => tr.node === s.id && tr.remarks.length && !declared.has(tr.scenario) && !latest.has(tr.scenario))
      if (nodeSelected && orphans.length) {
        danglingTracks += orphans.length
        const names = orphans.map((o) => `'${o.scenario}' (${o.threadId}, ${o.remarks.length} remark${o.remarks.length > 1 ? 's' : ''})`).join(', ')
        findings.push(`  • eval-dangling: '${s.id}' has ${orphans.length} orphaned remark track(s) — scenario ${names} renamed/deleted; resolve/retract via \`spex remark resolve <ref>\` / \`spex remark retract <ref>\` or restore the scenario name`)
      }
    } else if (nodeSelected && s.code.some((p) => sourceFiles.has(p))) {
      uncovered++
      findings.push(`  • eval-coverage: '${s.id}' governs source code but has no eval.md — give it a scenario (description + expected) so its loss can be measured`)
    }
    if (!findings.length) continue
    flaggedNodes++
    for (const f of findings) console.error(f)
  }
  // whole-repo only (never --changed): a structural fact, not a per-branch freshness gap. Counts only explicit scenario `code:`.
  let overOwned = 0
  if (!changedOnly) {
    const maxOwners = cfg.maxOwners
    const govCount = new Map<string, number>()
    for (const n of yByDir.values()) for (const sc of n.scenarios) for (const f of sc.code ?? []) govCount.set(f, (govCount.get(f) ?? 0) + 1)
    const over = [...govCount].filter(([, c]) => c > maxOwners).sort((a, b) => b[1] - a[1])
    if (over.length) {
      overOwned = over.length
      const top = over.slice(0, 5).map(([f, c]) => `${f.split('/').pop()}(${c})`).join(', ')
      console.error(`  • eval-owners: ${over.length} file(s) are governed by > ${maxOwners} scenarios — each carries more separately-measured behaviour than one file should. Worst: ${top}. SPLIT the file so each scenario measures its own surface.`)
    }
  }
  const scope = changedOnly ? ' --changed' : ''
  const ownersNote = overOwned ? `, ${overOwned} over-owned` : ''
  const danglingNote = danglingTracks ? `, ${danglingTracks} dangling` : ''
  console.error(`spex eval lint${scope}: ${flaggedNodes} node(s) flagged (${malformed} malformed, ${staleScores} stale, ${missingScores} missing, ${uncovered} coverage gap(s)${danglingNote}${ownersNote})`)
  return 0
}

// eval's flag set is CLOSED — like the scenario schema's closed field set. An unrecognized flag is
// rejected LOUD, never silently ignored: an old CLI that didn't know `--video` once filed the clip as an
// `--image`, and a misfiled reading is worse than none (it reads as proof). Value-flags consume the next
// token, so a path/note that itself starts with `--` is never mistaken for a flag.
const EVAL_VALUE_FLAGS = new Set(['scenario', 'note', 'image', 'result', 'video', 'timeline'])

// which axis each evidence kind carries — a step-map ([[step-timeline]]) anchors to ONE of them, so its
// `axis` must match a present entry's kind. A video is time (ms), a transcript is line-numbered, a still
// SEQUENCE is frame-indexed, and structured `data`'s positions are record ordinals — the `index` axis (a
// bare ordinal). Render kind and step-map axis stay ORTHOGONAL ([[evidence-kind-taxonomy]]): this map is
// the one seam between them, one row per kind.
const AXIS_FOR_KIND: Record<EvidenceKind, string> = { video: 'time', transcript: 'line', image: 'frame', data: 'index' }
const EVAL_BOOL_FLAGS = new Set(['pass', 'fail'])
function rejectUnknownEvalFlag(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith('--')) continue
    const name = a.slice(2)
    if (EVAL_VALUE_FLAGS.has(name)) { i++; continue }   // its value is the next token — skip it
    if (EVAL_BOOL_FLAGS.has(name)) continue
    return a
  }
  return null
}

async function evalCmd(args: string[]): Promise<number> {
  const root = repoRoot()
  const bad = rejectUnknownEvalFlag(args)
  if (bad) {
    console.error(`spex eval add: unknown flag '${bad}' — accepts --scenario --pass --fail --note --image --result --video --timeline`)
    return 2
  }
  const sel = positional(args)
  const ref = !sel || sel === '.' ? currentNodeId(root) : stripRefSigil(sel)   // node args tolerate @/[[ ]] sigils ([[mentions]])
  if (!ref) { console.error('spex eval add .: no current node (no .session/node-branch here) — name a node'); return 2 }
  // resolve LOUD ([[eval-core]]): exact canonical id, else a unique bare leaf; an ambiguous leaf lists its
  // candidate canonical ids instead of filing against an arbitrary node.
  const res = resolveEvalNode(await gatherNodes(root), ref)
  if (!res.ok) { console.error(`spex eval add: ${res.error}`); return 1 }
  const node = res.node
  const id = node.id
  if (!node.scenarios.length) { console.error(`spex eval add: '${id}' declares no scenarios in its eval.md`); return 1 }

  // which scenario this measurement is OF: --scenario, or the sole scenario when there is exactly one.
  const names = node.scenarios.map((s) => s.name)
  const scName = flag(args, 'scenario')
  let scenario = scName ? node.scenarios.find((s) => s.name === scName) : node.scenarios.length === 1 ? node.scenarios[0] : undefined
  if (!scenario) {
    const why = scName ? `has no scenario '${scName}'` : `declares ${node.scenarios.length} scenarios — name one with --scenario <name>`
    console.error(`spex eval add: '${id}' ${why} — declared: ${names.join(', ')}`)
    return 1
  }

  // the verdict the agent reached (required — a measurement without one is the legacy shape, not a filing).
  const verdict = parseVerdict(args)
  if (!verdict) { console.error('spex eval add: a verdict is required — --pass or --fail (either may add --note <text>)'); return 2 }

  // the evidence the agent captured (optional; a LIST now — REPEATABLE --image plus an optional --result
  // and/or --video, in any combination). The bytes go to the content-addressed cache exactly the same
  // whichever kind; each becomes one typed entry on the reading's `evidence` list. A --video clip is the
  // truest evidence for a UI-surface scenario — a recording of the loop — and N stills can ride beside it.
  const images = flags(args, 'image')
  const result = flag(args, 'result')
  const video = flag(args, 'video')
  const evidence: Evidence[] = []
  for (const p of images) evidence.push({ hash: putBlob(readFileSync(p)), kind: 'image' })
  if (result !== undefined) {
    // --result's kind is DERIVED FROM CONTENT ([[evidence-kind-taxonomy]]), not welded to the flag: a
    // structured export (JSON) files as `data` (a validatable data block), free-form output as `transcript`.
    const bytes = readFileSync(result === '-' ? 0 : result)
    evidence.push({ hash: putBlob(bytes), kind: isJsonBlob(bytes) ? 'data' : 'transcript' })
  }
  if (video !== undefined) evidence.push({ hash: putBlob(readFileSync(video)), kind: 'video' })

  // --timeline: the evidence's step map (timeline.ts) — steps anchored to a POSITION on the evidence's OWN
  // axis, no longer video-welded. It accompanies ANY axis-bearing evidence, and its `axis` must MATCH a
  // present entry's kind (a video is time, a transcript is line, a still sequence is frame — AXIS_FOR_KIND):
  // a step-map for an axis nothing here carries is misfiled. Validated LOUD at filing (a malformed map is
  // rejected, never silently reshaped); stored canonicalized so identical timelines share one blob.
  const timeline = flag(args, 'timeline')
  let timelineBlob: string | undefined
  if (timeline !== undefined) {
    if (!evidence.length) { console.error('spex eval add: --timeline needs axis-bearing evidence — attach the --video/--image/--result whose axis its steps anchor to'); return 2 }
    let parsed: unknown
    try { parsed = JSON.parse(readFileSync(timeline, 'utf8')) } catch { console.error(`spex eval add: --timeline ${timeline} is not readable JSON`); return 2 }
    const terrs = validateTimeline(parsed)
    if (terrs.length) {
      console.error('spex eval add: invalid step-timeline:')
      for (const e of terrs) console.error(`    ${e}`)
      return 2
    }
    const { axis } = normalizeTimeline(parsed)
    const present = new Set(evidence.map((e) => AXIS_FOR_KIND[e.kind]))
    if (!present.has(axis)) {
      const have = evidence.map((e) => `${e.kind}→${AXIS_FOR_KIND[e.kind]}`).join(', ')
      console.error(`spex eval add: --timeline axis '${axis}' matches none of this eval's evidence (${have}) — a step-map's axis must be the axis of an attached evidence entry`)
      return 2
    }
    timelineBlob = putBlob(Buffer.from(JSON.stringify(parsed)))
  }

  const reading: Reading = {
    scenario: scenario.name,
    codeSha: headSha(root),
    // the contract this measurement was taken against — decides the scenario freshness axis by pure compare
    scenarioHash: scenarioHash(scenario),
    ...(evidence.length ? { evidence } : {}),
    ...(timelineBlob ? { timelineBlob } : {}),
    // the filing session — the originator an eval-comment thread loops in ([[mentions]]); absent if unknown
    ...((envSessionId() ?? undefined) ? { by: envSessionId()! } : {}),
    verdict,
    ts: new Date().toISOString(),
  }
  appendReading(node.sidecarPath, reading)
  const ev = evidence.length
    ? evidence.map((e) => `${e.kind} ${e.hash.slice(0, 12)}…`).join(', ') + (timelineBlob ? ' +timeline' : '')
    : 'no evidence'
  console.log(`  ✓ '${id}' scenario '${scenario.name}' → ${verdictText(verdict)} @ ${reading.codeSha.slice(0, 7)} (${ev})`)
  console.log(`spex eval add: 1 measurement filed`)

  // @@@mis-anchor guard - a codeSha names a COMMIT, never a working tree: filed over uncommitted governed
  // edits, this reading claims a verdict at HEAD while HEAD lacks the code actually measured — wrong from
  // birth, and the stale flag after the next commit is freshness exposing it, not an engine bug. Warn,
  // never block: the honest flow is measure on the tree until green → commit that tested tree → file.
  const dirty = dirtyGoverned(root, [...(scenario.code?.length ? scenario.code : node.codeFiles), node.evalPath])
  if (dirty.length) {
    console.error(`  ⚠ mis-anchored eval: uncommitted changes in governed ${dirty.join(', ')}`)
    console.error(`    this eval anchors to HEAD ${reading.codeSha.slice(0, 7)}, which does NOT contain those edits — it claims a ${verdict.status} for code that never ran, and the commit that lands them will (correctly) read it stale.`)
    console.error(`    the honest flow: measure on the tree until green → commit that just-tested tree (code+spec) → THEN file the eval against the clean HEAD (retract this one if it recorded the dirty run).`)
  }
  return 0
}

// the governed paths with uncommitted changes (staged, unstaged, or untracked) — the mis-anchor guard's
// probe. Paths are repo-relative pathspecs, so a governed dir prefix or `*` glob scopes the same way
// nodeChanged matches it; a rename line reports its new name.
function dirtyGoverned(root: string, paths: string[]): string[] {
  if (!paths.length) return []
  const out = git(['-C', root, 'status', '--porcelain', '--', ...paths])
  const files = out.split('\n').filter(Boolean).map((l) => {
    const p = l.slice(3)
    const i = p.indexOf(' -> ')
    return i >= 0 ? p.slice(i + 4) : p
  })
  return [...new Set(files)]
}

// the verdict from the flags: --pass or --fail sets the status (pass wins if both given); --note <text> is an
// OPTIONAL annotation attached to either. No status flag → null (a measurement must commit to pass or fail).
function parseVerdict(args: string[]): Verdict | null {
  const note = flag(args, 'note')
  const ann = note !== undefined ? { note } : {}
  if (has(args, 'pass')) return { status: 'pass', ...ann }
  if (has(args, 'fail')) return { status: 'fail', ...ann }
  return null
}

// retract's flag set is closed like eval's — an unknown flag is rejected LOUD, never silently ignored.
const RETRACT_VALUE_FLAGS = new Set(['scenario', 'ts', 'note'])
const RETRACT_BOOL_FLAGS = new Set(['last'])

// `spex eval retract` — the sanctioned inverse of eval: undo a botched filing through the SAME surface
// that wrote it. It appends a RETRACTION event to the sidecar (append-only stays true; the target line
// stays as history; git carries who/when/why) — never a deleted line. The effective scoreboard then drops
// the retracted reading everywhere at once: the previous reading becomes the latest again, or the scenario
// honestly returns to eval-missing. Default target is the scenario's LATEST effective reading (--last is
// that default made explicit — repeated retracts peel junk e2e/smoke filings back one at a time); --ts
// pins an exact reading by its timestamp.
async function retractCmd(args: string[]): Promise<number> {
  const root = repoRoot()
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith('--')) continue
    const name = a.slice(2)
    if (RETRACT_VALUE_FLAGS.has(name)) { i++; continue }
    if (RETRACT_BOOL_FLAGS.has(name)) continue
    console.error(`spex eval retract: unknown flag '${a}' — accepts --scenario --last --ts --note`)
    return 2
  }
  const sel = positional(args)
  const ref = !sel || sel === '.' ? currentNodeId(root) : stripRefSigil(sel)
  if (!ref) { console.error('spex eval retract .: no current node (no .session/node-branch here) — name a node'); return 2 }
  // node resolution mirrors eval's: exact canonical id, else a unique bare leaf, ambiguous fails loud.
  const res = resolveEvalNode(evalNodes(root), ref)
  if (!res.ok) { console.error(`spex eval retract: ${res.error}`); return 1 }
  const node = res.node
  const id = node.id

  // which scenario, resolved exactly as eval resolves it: --scenario, or the sole declared scenario. A
  // reading for a since-deleted scenario is still retractable by naming it — the sidecar knows names the
  // eval.md may have dropped.
  const scName = flag(args, 'scenario')
  const declared = node.scenarios.map((s) => s.name)
  const scenario = scName ?? (declared.length === 1 ? declared[0] : undefined)
  if (!scenario) {
    console.error(`spex eval retract: '${id}' declares ${declared.length} scenarios — name one with --scenario <name> (declared: ${declared.join(', ')})`)
    return 1
  }

  const ts = flag(args, 'ts')
  if (ts !== undefined && has(args, 'last')) { console.error('spex eval retract: --ts and --last conflict — pin one eval or take the latest, not both'); return 2 }
  const effective = readReadings(node.sidecarPath).filter((r) => r.scenario === scenario)
  if (!effective.length) {
    const { readings } = readSidecar(node.sidecarPath)
    const had = readings.some((r) => r.scenario === scenario)
    console.error(`spex eval retract: '${id}' scenario '${scenario}' has no ${had ? 'un-retracted ' : ''}eval${had ? ' left' : ''} — nothing to retract`)
    return 1
  }
  const target = ts !== undefined ? effective.find((r) => r.ts === ts) : effective[effective.length - 1]
  if (!target) {
    console.error(`spex eval retract: '${id}' scenario '${scenario}' has no un-retracted eval @ ${ts} — evals: ${effective.map((r) => r.ts).join(', ')}`)
    return 1
  }

  const note = flag(args, 'note')
  const retraction: Retraction = {
    retracts: target.ts,
    scenario,
    ...(note !== undefined ? { note } : {}),
    ...((envSessionId() ?? undefined) ? { by: envSessionId()! } : {}),
    ts: new Date().toISOString(),
  }
  appendRetraction(node.sidecarPath, retraction)
  const left = readReadings(node.sidecarPath).filter((r) => r.scenario === scenario)
  const now = left.length
    ? `latest is now ${left[left.length - 1].ts} (${verdictText(left[left.length - 1].verdict)})`
    : 'the scenario is unmeasured again (eval-missing)'
  console.log(`  ⟲ '${id}' scenario '${scenario}' eval @ ${target.ts} (${verdictText(target.verdict)}) retracted — ${now}`)
  console.log('spex eval retract: 1 eval retracted (an appended event — commit the sidecar so the retraction is attributed)')
  return 0
}

// `spex eval ok` — the HUMAN sign-off on a scenario's latest reading ([[human-ok]]): appends a monotonic
// human-ok event bound to that one immutable reading (a newer reading or live-computed staleness brings the
// scenario back on its own — no un-ok verb exists). CLI parity with the dashboard's affordance (LAW L);
// identity is the surface's: 'human' here — and a GOVERNED session is REFUSED, because the sign-off is the
// human's own deliberate judgment and an agent blessing its own reading would hide it from exactly the
// review the ok certifies (the no-self-resolve analogue). Flag set closed, like every eval verb.
async function okCmd(args: string[]): Promise<number> {
  const root = repoRoot()
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith('--')) continue
    if (a === '--scenario') { i++; continue }
    console.error(`spex eval ok: unknown flag '${a}' — accepts --scenario`)
    return 2
  }
  if (envSessionId()) {
    console.error('spex eval ok: refusing under a governed session — human-ok is the HUMAN\'s sign-off, never an agent\'s self-blessing. Ask the human to ok it from the dashboard or their own terminal; an agent\'s judgment on an eval is a remark (`spex remark add`).')
    return 1
  }
  const sel = positional(args)
  if (!sel || sel === '.') { console.error('spex eval ok: name a node — usage: spex eval ok <node> --scenario <name>'); return 2 }
  const node = stripRefSigil(sel)
  const scName = flag(args, 'scenario')
  const res = resolveEvalNode(evalNodes(root), node)
  if (!res.ok) { console.error(`spex eval ok: ${res.error}`); return 1 }
  const declared = res.node.scenarios.map((s) => s.name)
  const scenario = scName ?? (declared.length === 1 ? declared[0] : undefined)
  if (!scenario) {
    console.error(`spex eval ok: '${res.node.id}' declares ${declared.length} scenarios — name one with --scenario <name> (declared: ${declared.join(', ')})`)
    return 1
  }
  const { fileHumanOk } = await import('./humanok.js')
  const r = fileHumanOk(res.node.id, scenario, 'human')
  if (!r.ok) { console.error(`spex eval ok: ${r.error}`); return 1 }
  if (r.already) {
    console.log(`spex eval ok: '${res.node.id}' scenario '${scenario}' eval @ ${r.humanOk.okTs} is already human-ok'd (by ${r.humanOk.by}, ${r.humanOk.ts}) — monotonic, nothing appended`)
    return 0
  }
  console.log(`  ☑ '${res.node.id}' scenario '${scenario}' eval @ ${r.humanOk.okTs} (${r.humanOk.okSha.slice(0, 7)}) human-ok'd`)
  console.log(r.landed === 'committed'
    ? 'spex eval ok: 1 sign-off filed (committed straight to the trunk)'
    : 'spex eval ok: 1 sign-off filed (an appended event — commit the sidecar so the sign-off lands)')
  return 0
}

async function clean(args: string[]): Promise<number> {
  const root = repoRoot()
  const all = has(args, 'all')
  const keepLatest = has(args, 'keep-latest')
  const referenced = new Set<string>()
  if (!all) {
    for (const n of await gatherNodes(root)) {
      const readings = readReadings(n.sidecarPath)
      const keep = keepLatest ? [...latestPerScenario(readings).values()] : readings
      for (const r of keep) {
        for (const e of evidenceOf(r)) referenced.add(e.hash)   // every evidence entry (N images + a video…)
        if (r.timelineBlob) referenced.add(r.timelineBlob)       // a video reading's step map lives in the same cache
      }
    }
  }
  const before = listBlobs().length
  const removed = gc(referenced)
  const mode = all ? 'all' : keepLatest ? 'keep-latest' : 'unreferenced'
  console.log(`spex eval clean: removed ${removed.length} evidence file(s), kept ${before - removed.length} (${mode})`)
  return 0
}

function checkStaged(): number {
  const root = repoRoot()
  const tagLibrary = loadConfig(root).scenarioTags
  const staged = stagedFiles(root)
  let bad = false

  const blobs = staged.filter(isStrayBlob)
  if (blobs.length) {
    bad = true
    console.error('✗ SpexCode eval: stray evidence file(s) staged — evidence lives in the shared git common dir, never in the tree:')
    for (const o of blobs) console.error(`    ${o}`)
    console.error('  Unstage them (git rm --cached <path>); an eval references its evidence by hash, it never commits the bytes.')
  }

  for (const rel of staged.filter((p) => p === EVAL_FILE || p.endsWith('/' + EVAL_FILE))) {
    const abs = join(root, rel)
    if (!existsSync(abs)) continue   // staged deletion — nothing to validate
    const errs = validateScenarios(readFileSync(abs, 'utf8'), tagLibrary, root)
    if (!errs.length) continue
    bad = true
    console.error(`✗ SpexCode eval: ${rel} — invalid scenario schema:`)
    for (const e of errs) console.error(`    ${e}`)
  }

  return bad ? 1 : 0
}

async function show(args: string[]): Promise<number> {
  const root = repoRoot()
  const sel = positional(args)
  const ref = !sel || sel === '.' ? currentNodeId(root) : stripRefSigil(sel)
  if (!ref) { console.error('spex eval ls .: no current node (no .session/node-branch here) — name a node'); return 2 }
  // resolve LOUD before the timeline: an ambiguous bare leaf must list its candidate canonical ids, never
  // fall through to a false "declares no scenarios". A ref matching NO measurable node still renders the honest
  // hasEvalFile:false line — a spec node without an eval.md is not an error to look at.
  const res = resolveEvalNode(evalNodes(root), ref)
  if (!res.ok && res.ambiguous) { console.error(`spex eval ls: ${res.error}`); return 1 }
  const tl = await evalTimeline(res.ok ? res.node.id : ref)   // no ctx → evalTimeline derives specs + driftIndex itself for this one id
  if (has(args, 'json')) { console.log(JSON.stringify(tl, null, 2)); return 0 }
  console.log(formatTimeline(tl))
  return 0
}

// the verdict as a short tag for the terminal: ✓ pass / ✗ fail, with ` — <note>` appended when annotated;
// `legacy` for a reading taken before verdicts existed, `≈ <note>` for a legacy note-only reading.
function verdictText(v: Verdict | undefined): string {
  if (!v) return 'legacy'
  if (v.status === 'pass') return v.note ? `✓ pass — ${v.note}` : '✓ pass'
  if (v.status === 'fail') return v.note ? `✗ fail — ${v.note}` : '✗ fail'
  return v.note ? `≈ ${v.note}` : 'legacy'   // legacy note-only reading
}

export function formatTimeline(tl: EvalTimeline): string {
  if (!tl.hasEvalFile) return `spex eval ls: '${tl.node}' declares no scenarios (no eval.md)`
  // the retraction trace, newest first — the undo stays visible through the same surface that shows readings.
  const retractLines = (tl.retractions ?? []).map((x) =>
    `  ⟲ retracted: scenario '${x.scenario}' eval @ ${x.retracts}${x.note ? ` — ${x.note}` : ''}${x.by ? `  by ${x.by}` : ''}  ${x.ts}`)
  if (!tl.readings.length) {
    const head = `spex eval ls: '${tl.node}' has scenarios but no eval yet — run \`spex eval add ${tl.node}\``
    return retractLines.length ? [head, '', ...retractLines].join('\n') : head
  }
  const w = Math.max(...tl.readings.map((r) => r.scenario.length))
  const lines = tl.readings.flatMap((r) => {
    const badge = r.fresh ? '✓ current' : `⚠ stale (${r.staleAxes.join(', ')})`
    // the reading's whole evidence list (N images + a video…), each cell its kind + short hash, or the honest
    // sentinel for a pruned/absent one; falls back to the scalar view for a legacy/test EvalEntry.
    const list = r.evidence?.length ? r.evidence
      : r.blob != null ? [{ hash: r.blob, kind: r.blobKind ?? 'image', state: r.blobState }] : []
    const ev = list.length
      ? list.map((e) => e.state === 'miss' ? 'miss original file' : `${e.kind} ${(e.hash ?? '').slice(0, 12)}…`).join(', ')
      : 'no evidence'
    const okTag = r.humanOk ? `  ☑ human-ok (${r.humanOk.by})` : ''
    const head = `  ${r.scenario.padEnd(w)}  ${verdictText(r.verdict)}  ${badge}${okTag}  ${r.codeSha.slice(0, 7)}  ${ev}  ${r.ts}`
    return r.expected ? [head, `  ${' '.repeat(w)}  expected: ${r.expected}`] : [head]
  })
  return [`spex eval ls: '${tl.node}' — ${tl.readings.length} eval(s), newest first`, '', ...lines, ...retractLines].join('\n')
}

// `spex eval scenario ls [<node>|.] [--unmeasured] [--json]` — the DECLARED half of the scoreboard: list
// scenarios (the measurement contracts) rather than readings. Bare = every measurable node's scenarios
// (the collection view); a <node>/`.` scopes to one node. --unmeasured keeps only scenarios with NO
// effective reading — never measured, or every filing retracted — the blind-spot worklist a measuring
// hand picks from. Flag set closed, like every eval verb.
export type ScenarioListRow = {
  node: string
  scenario: string
  tags?: string[]
  test?: ScenarioTestReference
  measured: boolean
  latest?: { verdict?: Verdict; ts: string }
}

export function scenarioListRows(nodes: EvalNode[], unmeasuredOnly = false): ScenarioListRow[] {
  const rows: ScenarioListRow[] = []
  for (const n of nodes) {
    const latest = latestPerScenario(readReadings(n.sidecarPath))
    for (const sc of n.scenarios) {
      const r = latest.get(sc.name)
      if (unmeasuredOnly && r) continue
      rows.push({
        node: n.id, scenario: sc.name,
        ...(sc.tags?.length ? { tags: sc.tags } : {}),
        ...(sc.test ? { test: sc.test } : {}),
        measured: !!r,
        ...(r ? { latest: { ...(r.verdict ? { verdict: r.verdict } : {}), ts: r.ts } } : {}),
      })
    }
  }
  return rows
}

async function scenarioLs(args: string[]): Promise<number> {
  for (const a of args) {
    if (!a.startsWith('--')) continue
    const name = a.slice(2)
    if (name !== 'unmeasured' && name !== 'json') {
      console.error(`spex eval scenario ls: unknown flag '${a}' — accepts --unmeasured --json`)
      return 2
    }
  }
  const root = repoRoot()
  const sel = positional(args)
  let nodes = evalNodes(root)
  if (sel) {
    const ref = sel === '.' ? currentNodeId(root) : stripRefSigil(sel)
    if (!ref) { console.error('spex eval scenario ls .: no current node (no session/node-branch here) — name a node'); return 2 }
    const res = resolveEvalNode(nodes, ref)
    if (!res.ok) { console.error(`spex eval scenario ls: ${res.error}`); return 1 }
    nodes = [res.node]
  }
  const unmeasuredOnly = has(args, 'unmeasured')
  const rows = scenarioListRows(nodes, unmeasuredOnly)
  if (has(args, 'json')) { console.log(JSON.stringify(rows, null, 2)); return 0 }
  if (!rows.length) {
    console.log(`spex eval scenario ls: ${unmeasuredOnly ? 'no unmeasured scenarios' : 'no scenarios declared'}${sel ? ` on '${nodes[0]?.id ?? sel}'` : ''}`)
    return 0
  }
  const w = Math.max(...rows.map((r) => r.node.length))
  for (const r of rows) {
    const tagStr = r.tags?.length ? ` [${r.tags.join(',')}]` : ''
    const state = r.measured ? `${verdictText(r.latest!.verdict)}  ${r.latest!.ts}` : '∅ unmeasured'
    console.log(`  ${r.node.padEnd(w)}  ${r.scenario}${tagStr}  —  ${state}`)
  }
  const un = rows.filter((r) => !r.measured).length
  console.log(`spex eval scenario ls: ${rows.length} scenario(s)${unmeasuredOnly ? ', all unmeasured' : un ? ` (${un} unmeasured)` : ''}`)
  return 0
}

// the `spex eval` drawer's node-scoped verbs ([[cli-surface]]): add (file a measurement) · ls (a node's
// reading timeline) · scenario ls (the declared contracts, --unmeasured = blind spots) · lint (the
// measurement-layer lint — advisory, always exit 0) · ok (the human sign-off) · retract · clean.
// The session-scoped read (`spex eval ls --session <SEL>`) is intercepted in cli.ts before this runs;
// `check-staged` is hook plumbing, exported separately for `spex internal check-staged`.
export async function runEval(args: string[]): Promise<number> {
  const sub = args[0]
  if (sub === 'lint') return scan(args.slice(1))
  if (sub === 'add') return evalCmd(args.slice(1))
  if (sub === 'ok') return okCmd(args.slice(1))
  if (sub === 'retract') return retractCmd(args.slice(1))
  if (sub === 'clean') return clean(args.slice(1))
  if (sub === 'ls') return show(args.slice(1))
  if (sub === 'matrix') {
    // the live-behavior matrix runner ([[live-matrix]]) — lazily imported so the heavy session machinery
    // never loads for the plain filing/reading verbs.
    const { runMatrix } = await import('./matrix.js')
    return runMatrix(args.slice(1))
  }
  if (sub === 'scenario') {
    if (args[1] === 'ls') return scenarioLs(args.slice(2))
    console.error('spex eval scenario: ls [<node>|.] [--unmeasured] [--json] — list declared scenarios (the measurement contracts)')
    return 2
  }
  console.error('spex eval: add [.|<node>] [--scenario <name>] (--pass|--fail) [--note <text>] [--image <path> …repeatable] [--result <path|->] [--video <path>] [--timeline <json>] | ls [.|<node>] [--json] | ls --session <SEL> [--export] | scenario ls [<node>|.] [--unmeasured] [--json] | matrix <launcher> [--node <id>] [--rows k1,k2] | lint [--changed] | ok <node> [--scenario <name>] | retract [.|<node>] [--scenario <name>] [--last | --ts <iso>] [--note <why>] | clean [--keep-latest|--all]')
  return 2
}

export { checkStaged }

// `spex evidence put <file|->` / `spex evidence get <hash> [-o <file>]` ([[evidence-put]], [[evidence-get]]) — the bare
// evidence-transport pair: put stashes bytes in the shared content-addressed cache and prints the hash,
// WITHOUT filing a reading (`eval add --video` couples the two); get is its symmetric read — hash in,
// bytes out. putBlob is idempotent by content, so re-putting re-seeds a checkout whose cache lacks a blob
// some thread already references by hash (the clone-evidence-404 repair).
export async function runEvidence(args: string[]): Promise<number> {
  if (args[0] === 'put' && args[1] !== undefined) return blobPut(args[1])
  if (args[0] === 'get') return blobGet(args.slice(1))
  console.error('spex evidence: put <file|-> — stash bytes in the shared evidence cache, print the content hash')
  console.error('           get <hash> [-o <file>] — read evidence back: local cache first, backend fallback')
  return 2
}

function blobPut(file: string): number {
  let bytes: Buffer
  try { bytes = readFileSync(file === '-' ? 0 : file) } catch (e) {
    console.error(`spex evidence put: cannot read ${file}: ${(e as Error).message}`)
    return 2
  }
  if (bytes.length === 0) { console.error('spex evidence put: refusing empty evidence'); return 2 }
  console.log(putBlob(bytes))
  return 0
}

// the read half: ① the local content-addressed cache (the evidence usually IS on this disk — no backend
// needed), ② on a local miss the same GET /api/evidence/:hash the dashboard streams from (the blob may
// have been pruned here, or put on another machine sharing the backend), ③ both missed → fail loud naming
// both paths. No third read mechanism — this reuses readBlobByHash and the existing endpoint verbatim.
async function blobGet(args: string[]): Promise<number> {
  const oIdx = args.indexOf('-o')
  const out = oIdx >= 0 ? args[oIdx + 1] : undefined
  if (oIdx >= 0 && (out === undefined || out.startsWith('-'))) { console.error('spex evidence get: -o needs a <file>'); return 2 }
  const hash = args.find((a, i) => (oIdx < 0 || (i !== oIdx && i !== oIdx + 1)) && !a.startsWith('-'))
  if (!hash) { console.error('spex evidence get: usage: spex evidence get <hash> [-o <file>]'); return 2 }
  const local = readBlobByHash(hash)   // validates 64-hex before touching the fs, then reads the shared cache
  if (local.ok) return emitBlob(local.bytes, out)
  if (local.reason === 'invalid') { console.error(`spex evidence get: bad hash '${hash}' — an evidence hash is 64 hex chars`); return 2 }
  const { apiBase } = await import('../../spec-cli/src/sessions.js')
  const url = `${await apiBase()}/api/evidence/${hash}`
  let backendMiss: string
  try {
    const r = await fetch(url)
    if (r.ok) return emitBlob(Buffer.from(await r.arrayBuffer()), out)
    backendMiss = `HTTP ${r.status}`
  } catch (e) {
    backendMiss = `unreachable (${(e as Error).message})`
  }
  console.error(`spex evidence get: ${hash} — not found on either path:`)
  console.error(`  local cache: ${blobPath(hash)} — no such evidence (pruned, or put on another machine)`)
  console.error(`  backend:     ${url} — ${backendMiss}`)
  return 1
}

// default stdout (pipe-friendly; the cli.ts flushExit drains a large piped dump before exit), -o writes a
// file. Raw bytes straight at a human's terminal get a one-line stderr warning, not a block.
function emitBlob(bytes: Buffer, out?: string): number {
  if (out !== undefined) {
    try { writeFileSync(out, bytes) } catch (e) {
      console.error(`spex evidence get: cannot write ${out}: ${(e as Error).message}`)
      return 2
    }
    return 0
  }
  if (process.stdout.isTTY) console.error(`spex evidence get: writing ${bytes.length} raw bytes to a tty — pipe it or use -o <file>`)
  process.stdout.write(bytes)
  return 0
}
