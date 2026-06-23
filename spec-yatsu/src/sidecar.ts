import { readFileSync, appendFileSync, existsSync } from 'node:fs'

// @@@ readings sidecar - the SECOND git-as-database axis. A node's measurements are recorded apart from
// its spec.md, in a flat git-tracked `yatsu.evals.ndjson` (one JSON object per line). As a spec.md commit
// is a SPEC version, a sidecar commit is a MEASUREMENT event — so the whole engine (history, attribution,
// drift) applies unchanged and spec versions are never inflated by readings. The eval timeline IS this
// file's git history; the file itself is append-mostly (newest line last).

// @@@ Verdict - the AGENT's measurement of loss against the scenario's `expected`. `pass` = met expected
// (zero loss), `fail` = did not, `note` = a free-text "how far off" when it is neither a clean pass nor a
// clean fail. A reading taken before verdicts existed carries none (rendered as a LEGACY reading).
export type Verdict = { status: 'pass' | 'fail' | 'note'; note?: string }

// @@@ Reading - one measurement of one scenario the agent FILED (yatsu took it from the agent; it ran
// nothing to produce it).
//   scenario  - the scenario name it measured (its key within the node's yatsu.md).
//   codeSha   - HEAD when the measurement was filed: the FRESHNESS ANCHOR. A reading is stale once a
//               governed code file or the scenario (yatsu.md) moved past this sha — derived live from git.
//   blob      - content hash of the captured EVIDENCE in the shared cache, or null (no evidence — the agent
//               attested without a capture). The bytes live outside git (see [[cache]]).
//   blobKind  - what those bytes are: an `image` (a screenshot) or a `transcript` (text). Absent when there
//               is no blob, or on a legacy reading (treated as an image — every legacy capture was one).
//   evaluator - WHO measured: the tag `<name>@<version>` (e.g. `manual@1`), the EVALUATOR freshness axis.
//   verdict   - the agent's pass/fail/how-far-off call; absent on a legacy reading.
//   ts        - ISO timestamp the measurement was filed.
export type Reading = {
  scenario: string
  codeSha: string
  blob: string | null
  blobKind?: 'image' | 'transcript'
  evaluator: string
  verdict?: Verdict
  ts: string
}

// parse the sidecar: one Reading per non-blank line. A malformed line is skipped (the file is append-only
// and git-tracked, so a partial write or a hand-edit shouldn't sink the whole read) — fail soft per line.
export function readReadings(sidecarPath: string): Reading[] {
  if (!existsSync(sidecarPath)) return []
  const out: Reading[] = []
  for (const line of readFileSync(sidecarPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const r = JSON.parse(t)
      if (r && typeof r.scenario === 'string' && typeof r.evaluator === 'string') out.push(r as Reading)
    } catch { /* skip a malformed line */ }
  }
  return out
}

// append ONE reading as a JSON line — the only mutation eval performs (a reading is an event, never an
// overwrite; superseding readings are newer lines, freshness picks the latest per scenario).
export function appendReading(sidecarPath: string, r: Reading): void {
  appendFileSync(sidecarPath, JSON.stringify(r) + '\n')
}

// the latest reading per scenario (the file is chronological, so the LAST line for a name wins). clean's
// --keep-latest uses it to decide which blob to keep.
export function latestPerScenario(readings: Reading[]): Map<string, Reading> {
  const m = new Map<string, Reading>()
  for (const r of readings) m.set(r.scenario, r)   // later lines overwrite earlier → last wins
  return m
}
