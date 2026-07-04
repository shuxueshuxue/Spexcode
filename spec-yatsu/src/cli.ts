import { readFileSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { repoRoot, headSha, driftIndex, historyIndex, stagedFiles, git } from '../../spec-cli/src/git.js'
import { loadSpecs } from '../../spec-cli/src/specs.js'
import { loadConfig } from '../../spec-cli/src/lint.js'
import { mainBranch, envSessionId, readRawRecord } from '../../spec-cli/src/layout.js'
import { yatsuNodes, validateScenarios, YATSU_FILE, type YatsuNode } from './yatsu.js'
import { readReadings, appendReading, latestPerScenario, evidenceOf, type Reading, type Verdict, type Evidence } from './sidecar.js'
import { staleAxes } from './freshness.js'
import { loadEvalRemarkTracks, trackKey } from '../../spec-cli/src/issues.js'
import { evaluatorTag } from './evaluator.js'
import { putBlob, listBlobs, gc, isStrayBlob } from './cache.js'
import { validateTimeline } from './timeline.js'
import { evalTimeline, type EvalTimeline } from './evaltab.js'

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
type EvalNode = YatsuNode & { codeFiles: string[] }

async function gatherNodes(root: string): Promise<EvalNode[]> {
  const specs = await loadSpecs()
  const codeByDir = new Map<string, string[]>()
  for (const s of specs) codeByDir.set(dirname(s.path), s.code)   // s.path = repo-relative spec.md path
  return yatsuNodes(root).map((n) => ({ ...n, codeFiles: codeByDir.get(relative(root, n.dir)) ?? [] }))
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

// a node is "changed" if the branch touched its node dir (spec.md / yatsu.md / sidecar all live there) or
// any governed code path — matched as an exact file, a directory prefix, or a `*` glob.
export function nodeChanged(dirRel: string, codeFiles: string[], changed: Set<string>): boolean {
  for (const c of changed) if (c === dirRel || c.startsWith(dirRel + '/')) return true
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
  const changedOnly = has(args, 'changed')
  const changed = changedOnly ? changedSinceBase(root) : null
  const idx = await driftIndex(root)
  const hidx = await historyIndex(root)
  const specs = await loadSpecs()
  // the non-git REMARK freshness axis ([[remark-teeth]]): the trunk remark track, read ONCE — the CLI is the
  // whole model, so `spex yatsu scan` shows a remark-stale scenario with no server running.
  const remarkTracks = loadEvalRemarkTracks()
  // a file may be governed by several nodes — ordinary composition, not a hub to skip (see governed-related).
  // A change to a shared governed file legitimately triggers EVERY governing node's yatsu, mirroring how
  // lint's drift now fans to every owner; nobody's loss signal is suppressed. An over-owned file is lint's
  // `owners` concern (split it), not a reason to go silent here.
  const yByDir = new Map(yatsuNodes(root).map((n) => [relative(root, n.dir), n]))
  let flaggedNodes = 0, malformed = 0, staleScores = 0, missingScores = 0, uncovered = 0, danglingTracks = 0
  for (const s of specs) {
    const dirRel = dirname(s.path)
    if (changed && !nodeChanged(dirRel, s.code, changed)) continue
    const y = yByDir.get(dirRel)
    const findings: string[] = []
    if (y) {
      // schema first: a malformed yatsu.md is the loudest gap — report each violation, then still scan its
      // (leniently-parsed) scenarios for stale/missing so a typo doesn't mask a real freshness gap.
      for (const e of validateScenarios(readFileSync(join(y.dir, YATSU_FILE), 'utf8'), cfg.scenarioTags)) {
        malformed++
        findings.push(`  • yatsu-schema: '${s.id}' ${e} — fix ${y.yatsuPath}`)
      }
      const latest = latestPerScenario(readReadings(y.sidecarPath))
      for (const sc of y.scenarios) {
        // a scenario's own `code` narrows its freshness CODE axis to a subset; a path that does not exist
        // would make that axis silently immortal (changedSince finds no commits for it), so flag it LOUD as a
        // malformed declaration — the same loud-fail spirit as a bad node `code:`.
        for (const [field, paths] of [['code', sc.code], ['related', sc.related]] as const) {
          const ghosts = (paths ?? []).filter((p) => !existsSync(join(root, p)))
          if (ghosts.length) {
            malformed++
            findings.push(`  • yatsu-schema: '${s.id}' scenario '${sc.name}' \`${field}\` path(s) not found: ${ghosts.join(', ')} — fix ${y.yatsuPath}`)
          }
        }
        const codeFiles = sc.code?.length ? sc.code : s.code   // scenario's own subset, else the node's list
        // carry the scenario's tags on the finding line — its SURFACE (e.g. frontend-e2e = browser-measured)
        // is what routes a drift/missing gap to the right measuring hand, so the proactive nudge and a human
        // reading `spex yatsu scan` both see whether this stale score needs a real e2e/browser pass to refresh.
        const tagStr = sc.tags?.length ? ` [${sc.tags.join(',')}]` : ''
        const r = latest.get(sc.name)
        if (!r) {
          missingScores++
          findings.push(`  • yatsu-missing: '${s.id}' scenario '${sc.name}'${tagStr} has no reading yet — measure with \`spex yatsu eval ${s.id}\``)
          continue
        }
        const remSignals = (remarkTracks.get(trackKey(s.id, sc.name))?.remarks ?? []).map((rm) => ({ resolved: !!rm.resolved, resolvedAt: rm.resolvedAt }))
        const axes = staleAxes(r, codeFiles, y.yatsuPath, idx, hidx, remSignals)
        if (axes.length) {
          staleScores++
          // a remark-stale scenario is unlocked by a second-party resolve, then a fresh reading; the git axes
          // by a re-measure. Both read the same word: "re-measure with spex yatsu eval".
          findings.push(`  • yatsu-drift: '${s.id}' scenario '${sc.name}'${tagStr} is stale (${axes.join(', ')} changed since ${r.codeSha.slice(0, 7)}) — re-measure with \`spex yatsu eval ${s.id}\``)
        }
      }
      // DANGLING remark tracks (directive 5): a (node, scenario) remark track whose scenario is gone from
      // yatsu.md AND has no reading (renamed/deleted) — its remarks would surface nowhere on the loss signal.
      // One note per node so the orphan is visible; the remarks stay resolvable/retractable via their refs
      // (`spex resolve`/`spex retract`), and they age nothing (there is no reading to stale).
      const declared = new Set(y.scenarios.map((sc) => sc.name))
      const orphans = [...remarkTracks.values()].filter((tr) => tr.node === s.id && tr.remarks.length && !declared.has(tr.scenario) && !latest.has(tr.scenario))
      if (orphans.length) {
        danglingTracks += orphans.length
        const names = orphans.map((o) => `'${o.scenario}' (${o.threadId}, ${o.remarks.length} remark${o.remarks.length > 1 ? 's' : ''})`).join(', ')
        findings.push(`  • yatsu-dangling: '${s.id}' has ${orphans.length} orphaned remark track(s) — scenario ${names} renamed/deleted; resolve/retract via \`spex resolve <ref>\` / \`spex retract <ref>\` or restore the scenario name`)
      }
    } else if (s.code.some(isUiPath)) {
      uncovered++
      findings.push(`  • yatsu-uncovered: '${s.id}' governs frontend code but has no yatsu.md — give it a scenario (description + expected) so its loss can be measured`)
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
      console.error(`  • yatsu-owners: ${over.length} file(s) are governed by > ${maxOwners} scenarios — each carries more separately-measured behaviour than one file should. Worst: ${top}. SPLIT the file so each scenario measures its own surface.`)
    }
  }
  const scope = changedOnly ? ' --changed' : ''
  const ownersNote = overOwned ? `, ${overOwned} over-owned` : ''
  const danglingNote = danglingTracks ? `, ${danglingTracks} dangling` : ''
  console.error(`spex yatsu scan${scope}: ${flaggedNodes} node(s) flagged (${malformed} malformed, ${staleScores} stale, ${missingScores} missing, ${uncovered} uncovered${danglingNote}${ownersNote})`)
  return 0
}

async function evalCmd(args: string[]): Promise<number> {
  const root = repoRoot()
  const sel = positional(args)
  const id = !sel || sel === '.' ? currentNodeId(root) : sel
  if (!id) { console.error('spex yatsu eval .: no current node (no .session/node-branch here) — name a node'); return 2 }
  const node = (await gatherNodes(root)).find((n) => n.id === id)
  if (!node) { console.error(`spex yatsu eval: no yatsu node '${id}' (a node needs a yatsu.md)`); return 1 }
  if (!node.scenarios.length) { console.error(`spex yatsu eval: '${id}' declares no scenarios in its yatsu.md`); return 1 }

  // which scenario this measurement is OF: --scenario, or the sole scenario when there is exactly one.
  const names = node.scenarios.map((s) => s.name)
  const scName = flag(args, 'scenario')
  let scenario = scName ? node.scenarios.find((s) => s.name === scName) : node.scenarios.length === 1 ? node.scenarios[0] : undefined
  if (!scenario) {
    const why = scName ? `has no scenario '${scName}'` : `declares ${node.scenarios.length} scenarios — name one with --scenario <name>`
    console.error(`spex yatsu eval: '${id}' ${why} — declared: ${names.join(', ')}`)
    return 1
  }

  // the verdict the agent reached (required — a measurement without one is the legacy shape, not a filing).
  const verdict = parseVerdict(args)
  if (!verdict) { console.error('spex yatsu eval: a verdict is required — --pass or --fail (either may add --note <text>)'); return 2 }

  // the evidence the agent captured (optional; a LIST now — REPEATABLE --image plus an optional --result
  // and/or --video, in any combination). The bytes go to the content-addressed cache exactly the same
  // whichever kind; each becomes one typed entry on the reading's `evidence` list. A --video clip is the
  // truest evidence for a UI-surface scenario — a recording of the loop — and N stills can ride beside it.
  const images = flags(args, 'image')
  const result = flag(args, 'result')
  const video = flag(args, 'video')
  const evidence: Evidence[] = []
  for (const p of images) evidence.push({ hash: putBlob(readFileSync(p)), kind: 'image' })
  if (result !== undefined) evidence.push({ hash: putBlob(readFileSync(result === '-' ? 0 : result)), kind: 'transcript' })
  if (video !== undefined) evidence.push({ hash: putBlob(readFileSync(video)), kind: 'video' })

  // --timeline: the clip's step map (timeline.ts) — only meaningful beside a --video entry. Validated LOUD at
  // filing (a malformed map is rejected, never silently reshaped); stored canonicalized so identical
  // timelines share one blob. It anchors the reading's video evidence entry.
  const timeline = flag(args, 'timeline')
  let timelineBlob: string | undefined
  if (timeline !== undefined) {
    if (!evidence.some((e) => e.kind === 'video')) { console.error('spex yatsu eval: --timeline accompanies --video (it maps moments in the clip to steps)'); return 2 }
    let parsed: unknown
    try { parsed = JSON.parse(readFileSync(timeline, 'utf8')) } catch { console.error(`spex yatsu eval: --timeline ${timeline} is not readable JSON`); return 2 }
    const terrs = validateTimeline(parsed)
    if (terrs.length) {
      console.error('spex yatsu eval: invalid step-timeline:')
      for (const e of terrs) console.error(`    ${e}`)
      return 2
    }
    timelineBlob = putBlob(Buffer.from(JSON.stringify(parsed)))
  }

  const reading: Reading = {
    scenario: scenario.name,
    codeSha: headSha(root),
    ...(evidence.length ? { evidence } : {}),
    ...(timelineBlob ? { timelineBlob } : {}),
    evaluator: evaluatorTag(),
    // the filing session — the originator an eval-comment thread loops in ([[mentions]]); absent if unknown
    ...((envSessionId() ?? undefined) ? { by: envSessionId()! } : {}),
    verdict,
    ts: new Date().toISOString(),
  }
  appendReading(node.sidecarPath, reading)
  const ev = evidence.length
    ? evidence.map((e) => `${e.kind} ${e.hash.slice(0, 12)}…`).join(', ') + (timelineBlob ? ' +timeline' : '')
    : 'no evidence'
  console.log(`  ✓ '${id}' scenario '${scenario.name}' → ${verdictText(verdict)} @ ${reading.codeSha.slice(0, 7)} [${reading.evaluator}] (${ev})`)
  console.log(`spex yatsu eval: 1 measurement filed`)
  return 0
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
  console.log(`spex yatsu clean: removed ${removed.length} blob(s), kept ${before - removed.length} (${mode})`)
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
    console.error('✗ SpexCode yatsu: stray evidence blob(s) staged — blobs live in the shared git common dir, never in the tree:')
    for (const o of blobs) console.error(`    ${o}`)
    console.error('  Unstage them (git rm --cached <path>); a reading references its blob by hash, it never commits the bytes.')
  }

  for (const rel of staged.filter((p) => p === YATSU_FILE || p.endsWith('/' + YATSU_FILE))) {
    const abs = join(root, rel)
    if (!existsSync(abs)) continue   // staged deletion — nothing to validate
    const errs = validateScenarios(readFileSync(abs, 'utf8'), tagLibrary)
    if (!errs.length) continue
    bad = true
    console.error(`✗ SpexCode yatsu: ${rel} — invalid scenario schema:`)
    for (const e of errs) console.error(`    ${e}`)
  }

  return bad ? 1 : 0
}

async function show(args: string[]): Promise<number> {
  const root = repoRoot()
  const sel = positional(args)
  const id = !sel || sel === '.' ? currentNodeId(root) : sel
  if (!id) { console.error('spex yatsu show .: no current node (no .session/node-branch here) — name a node'); return 2 }
  const tl = await evalTimeline(id)   // no ctx → evalTimeline derives specs + driftIndex itself for this one id
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
  if (!tl.hasYatsu) return `spex yatsu show: '${tl.node}' declares no scenarios (no yatsu.md)`
  if (!tl.readings.length) return `spex yatsu show: '${tl.node}' has scenarios but no reading yet — run \`spex yatsu eval ${tl.node}\``
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
    const head = `  ${r.scenario.padEnd(w)}  ${verdictText(r.verdict)}  ${badge}  ${r.evaluator}  ${r.codeSha.slice(0, 7)}  ${ev}  ${r.ts}`
    return r.expected ? [head, `  ${' '.repeat(w)}  expected: ${r.expected}`] : [head]
  })
  return [`spex yatsu show: '${tl.node}' — ${tl.readings.length} reading(s), newest first`, '', ...lines].join('\n')
}

export async function runYatsu(args: string[]): Promise<number> {
  const sub = args[0]
  if (sub === 'scan') return scan(args.slice(1))
  if (sub === 'eval') return evalCmd(args.slice(1))
  if (sub === 'clean') return clean(args.slice(1))
  if (sub === 'show') return show(args.slice(1))
  if (sub === 'check-staged') return checkStaged()
  console.error('spex yatsu: scan [--changed] | eval [.|<node>] [--scenario <name>] (--pass|--fail) [--note <text>] [--image <path> …repeatable] [--result <path|->] [--video <path> [--timeline <json>]] | show [.|<node>] [--json] | clean [--keep-latest|--all]')
  return 2
}

// `spex blob put <file|->` ([[blob-put]]) — the bare transport half of evidence: stash bytes in the shared
// content-addressed cache and print the hash, WITHOUT filing a reading (`yatsu eval --video` couples the
// two). putBlob is idempotent by content, so the same command re-seeds a checkout whose cache lacks a blob
// some thread already references by hash (the clone-evidence-404 repair).
export function runBlob(args: string[]): number {
  const file = args[1]
  if (args[0] !== 'put' || file === undefined) {
    console.error('spex blob: put <file|-> — stash bytes in the shared evidence cache, print the content hash')
    return 2
  }
  let bytes: Buffer
  try { bytes = readFileSync(file === '-' ? 0 : file) } catch (e) {
    console.error(`spex blob put: cannot read ${file}: ${(e as Error).message}`)
    return 2
  }
  if (bytes.length === 0) { console.error('spex blob put: refusing an empty blob'); return 2 }
  console.log(putBlob(bytes))
  return 0
}
