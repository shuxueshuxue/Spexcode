import { readFileSync, appendFileSync, existsSync } from 'node:fs'

// @@@ readings sidecar - the SECOND git-as-database axis. A node's evaluations are recorded apart from
// its spec.md, in a flat git-tracked `yatsu.evals.ndjson` (one JSON object per line). As a spec.md commit
// is a SPEC version, a sidecar commit is an EVALUATION event — so the whole engine (history, attribution,
// drift) applies unchanged and spec versions are never inflated by readings. The eval timeline IS this
// file's git history; the file itself is append-mostly (newest line last).

// @@@ Reading - one observation of one scenario.
//   scenario  - the scenario name it read (its key within the node's yatsu.md).
//   codeSha   - HEAD when the reading was taken: the FRESHNESS ANCHOR. A reading is stale once a governed
//               code file or the scenario (yatsu.md) moved past this sha — derived live from git, never stored.
//   blob      - content hash of the captured pixels in the shared cache, or null (a pixel-less observation,
//               e.g. a human eyeballed it without an image). The bytes live outside git (see [[cache]]).
//   evaluator - the producer tag `<driver>@<version>`: the EVALUATOR freshness axis (bump the driver → stale).
//   ts        - ISO timestamp the reading was taken.
export type Reading = {
  scenario: string
  codeSha: string
  blob: string | null
  evaluator: string
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

// the latest reading per scenario (the file is chronological, so the LAST line for a name wins). eval uses
// it to decide "is there already a fresh reading?", clean's --keep-latest to decide which blob to keep.
export function latestPerScenario(readings: Reading[]): Map<string, Reading> {
  const m = new Map<string, Reading>()
  for (const r of readings) m.set(r.scenario, r)   // later lines overwrite earlier → last wins
  return m
}
