import { repoRoot, rangeDiff, stagedFiles } from './git.js'
import { loadSpecs } from './specs.js'
import { loadConfig } from './lint.js'

// @@@ drift - drift is not a chore, it's a CHECKPOINT that forces a diagnosis. A governed file moving
// ahead of its spec can mean a defect ANYWHERE along the chain of truth:
//   raw intent → expanded spec → code: link → code structure → implementation
// The honest response is to find WHICH link broke and fix THAT — never to patch the symptom (a blind
// `Spec-OK` / a cosmetic spec tweak) just to silence the gate. `spex drift --explain` shows the three
// textual layers side by side so the break is visible; this guidance names each case and its remedy.
export const DRIFT_GUIDANCE = `
DRIFT — a governed file has moved ahead of its spec. This is a CHECKPOINT, not a chore: find WHERE the
truth broke along  raw intent → expanded spec → code: link → code structure → implementation, then fix
THAT layer. Never patch the symptom just to silence the gate.

  Inspect:  spex drift <node> --explain    (raw source ∥ expanded spec ∥ the code diff since the spec)

Diagnose which case it is, then apply that remedy:
  • contract changed       → rewrite the spec body to the new intent and commit it (re-versions the node)
  • only mechanics changed → spex ack <node>    "checked — spec still valid"  (give a real reason)
  • implementation is WRONG → the spec is right; fix the CODE back toward it, then ack
  • wrong code: link        → the node shouldn't own this file (or owns it too broadly); fix frontmatter
  • expanded spec ≠ raw     → the spec drifted from human intent; fix the expanded spec to serve the raw
  • structural mismatch     → one file owned by many specs, or a feature with no home of its own: refactor
                              so a file maps to a node — or file an issue and link it (defer honestly)

Principle — never patch. A reasoned ack or a real fix are both recorded and re-judged at review; a blind
ack is a lie on the record. Pick the remedy the diagnosis demands, not the cheapest way past the gate.`

// owner map: code file -> the node ids that claim it in `code:`. Used both to show a drifting file's
// fan-out (high fan-out is itself the "structural mismatch" smell) and to scope the commit-local gate.
type Spec = Awaited<ReturnType<typeof loadSpecs>>[number]
function ownersOf(specs: Spec[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const s of specs) for (const f of s.code) m.set(f, [...(m.get(f) ?? []), s.id])
  return m
}

const trunc = (patch: string, max = 200): string => {
  const lines = patch.split('\n')
  return lines.length <= max ? patch : lines.slice(0, max).join('\n') + `\n… (+${lines.length - max} more diff lines — see \`git diff\`)`
}

// @@@ explainDrift - the human/agent diagnosis surface. `spex drift` lists every drifting node; `spex
// drift <node>` narrows to one; `--explain` adds the three layers (raw source, expanded spec, and the
// code diff since the spec's last version) so the reader can SEE which link of the chain broke. Returns
// an exit code (0 — it's a report, never a gate).
export async function explainDrift(nodeId: string | undefined, opts: { explain: boolean }): Promise<number> {
  const root = repoRoot()
  const specs = await loadSpecs()
  const owners = ownersOf(specs)
  const cfg = loadConfig(root)
  let drifting = specs.filter((s) => s.drift > 0)
  if (nodeId) {
    drifting = drifting.filter((s) => s.id === nodeId)
    if (!drifting.length) {
      const exists = specs.some((s) => s.id === nodeId)
      console.error(exists ? `'${nodeId}' has no drift — its spec still matches its code.` : `no such node '${nodeId}'`)
      return exists ? 0 : 2
    }
  }
  if (!drifting.length) { console.log('no drift — every spec matches its code.'); return 0 }

  for (const s of drifting.sort((a, b) => b.drift - a.drift)) {
    const heavy = s.drift >= cfg.driftErrorThreshold
    console.log(`\n${s.id}  —  drift ${s.drift}${heavy ? ` (≥ ${cfg.driftErrorThreshold}: blocks a commit touching its files)` : ''}`)
    for (const d of s.driftFiles) {
      const others = (owners.get(d.file) ?? []).filter((o) => o !== s.id)
      const fan = others.length ? `   [also governed by: ${others.join(', ')}]` : ''
      console.log(`  • ${d.file} — ${d.behind} commit(s) ahead${fan}`)
    }
    if (!opts.explain) continue
    if (s.parts) {
      console.log(`\n  ── raw source (human intent) ──`)
      console.log(indent(s.parts.rawSource || '(empty)'))
      console.log(`\n  ── expanded spec (agent) ──`)
      console.log(indent(s.parts.expandedSpec || '(empty)'))
    } else {
      console.log(`\n  ── spec body (legacy — not split into raw/expanded) ──`)
      console.log(indent(s.body))
    }
    for (const d of s.driftFiles) {
      console.log(`\n  ── code diff: ${d.file} since spec v${s.version} (${s.versionHash.slice(0, 9) || '—'}) ──`)
      const patch = await rangeDiff(root, s.versionHash, d.file)
      console.log(indent(trunc(patch.trim()) || '(no textual diff)'))
    }
  }
  console.error(`\n${DRIFT_GUIDANCE}`)
  return 0
}
const indent = (s: string): string => s.split('\n').map((l) => '    ' + l).join('\n')

// @@@ driftGate - the COMMIT-LOCAL hard gate, run only via `spex lint --gate` from the pre-commit hook.
// Plain `spex lint` keeps drift advisory (CI's ci-gate contract). The gate blocks ONLY when this commit's
// own staged files belong to a node that's already >= driftErrorThreshold behind — "reconcile this node
// before you pile more change onto its files" — so the existing backlog never paralyses unrelated commits.
// Sub-threshold drift on touched nodes is printed as a nudge (with the guidance) but does not block.
// Returns true to BLOCK the commit. Prints the guidance whenever a touched node is drifting at all.
export async function driftGate(): Promise<boolean> {
  const root = repoRoot()
  const cfg = loadConfig(root)
  const staged = stagedFiles(root)
  if (!staged.length) return false
  const specs = await loadSpecs()
  const owners = ownersOf(specs)
  const byId = new Map(specs.map((s) => [s.id, s]))

  // nodes touched by this commit (own a staged file) that are drifting, with the heaviest first.
  const touched = new Set<string>()
  for (const f of staged) for (const o of owners.get(f) ?? []) touched.add(o)
  const drifting = [...touched].map((id) => byId.get(id)!).filter((s) => s && s.drift > 0).sort((a, b) => b.drift - a.drift)
  if (!drifting.length) return false

  const blockers = drifting.filter((s) => s.drift >= cfg.driftErrorThreshold)
  for (const s of drifting) {
    const mark = s.drift >= cfg.driftErrorThreshold ? '✗' : '•'
    console.error(`  ${mark} drift-gate: '${s.id}' is ${s.drift} commit(s) behind${s.drift >= cfg.driftErrorThreshold ? ' — BLOCKS this commit' : ' (advisory)'}`)
  }
  console.error(`\n${DRIFT_GUIDANCE}`)
  if (blockers.length) {
    console.error(`\n✗ SpexCode: drift gate — ${blockers.map((s) => s.id).join(', ')} ${blockers.length === 1 ? 'is' : 'are'} ≥ ${cfg.driftErrorThreshold} commit(s) behind. Reconcile (see above) or bypass with SPEXCODE_SKIP_LINT=1.`)
    return true
  }
  return false
}
