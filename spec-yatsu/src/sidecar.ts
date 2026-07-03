import { readFileSync, appendFileSync, existsSync } from 'node:fs'

// the verdict is pass | fail; `note` is an OPTIONAL one-line annotation on either (why it failed, how far
// a pass is from ideal) — not a third status. (Legacy readings filed when `note` was its own status survive
// on disk with status:'note'; render stays tolerant of them, the CLI no longer mints them.)
export type Verdict = { status: 'pass' | 'fail'; note?: string }

export type EvidenceKind = 'image' | 'transcript' | 'video'
// one piece of a reading's evidence: a content-addressed blob (`hash`) tagged by `kind`. `video` is a
// screenshot with a time axis — the same content-addressed blob, distinguished only by this tag.
export type Evidence = { hash: string; kind: EvidenceKind }

// A reading's evidence is a LIST of typed entries — N images and/or a video (with its step-timeline) and/or
// a transcript, in filing order. New filings write `evidence`; the legacy scalar shape (`blob` + `blobKind`,
// absent kind → image) is still READ and normalized to a one-entry list by `evidenceOf`, so old readings
// still render. A video reading may carry `timelineBlob`: the content hash of its step-timeline sidecar
// (timeline.ts) mapping clip moments to named steps — it anchors the reading's VIDEO evidence entry.
// `by` is the SESSION that filed this reading (the filer, from envSessionId) — the ORIGINATOR an eval-comment
// thread loops in on a reply ([[mentions]] implicit loop-in). Pure additive: a legacy reading without it simply
// has no originator → silent. `evaluator` is WHO/WHAT measured (a tag like `manual@1`); `by` is the reachable
// session behind the filing — two different axes.
export type Reading = {
  scenario: string
  codeSha: string
  evidence?: Evidence[]
  // legacy scalar evidence — read for old readings, never written by new filings.
  blob?: string | null
  blobKind?: EvidenceKind
  timelineBlob?: string
  evaluator: string
  by?: string
  verdict?: Verdict
  ts: string
}

// the one scalar→list bridge every evidence consumer passes through: the `evidence` list when present, else
// the legacy scalar (blob + blobKind, absent kind → image) as a one-entry list, else empty.
export function evidenceOf(r: { evidence?: Evidence[]; blob?: string | null; blobKind?: EvidenceKind }): Evidence[] {
  if (r.evidence?.length) return r.evidence
  if (r.blob) return [{ hash: r.blob, kind: r.blobKind ?? 'image' }]
  return []
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
