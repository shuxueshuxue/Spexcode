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

// a RETRACTION is the sanctioned inverse of a filing — itself an appended event, never a deleted line
// (the sidecar stays append-only; git shows who retracted what, when). `retracts` is the target reading's
// `ts` within `scenario` (its natural key). Deliberately NO `evaluator` field: an old reader's line filter
// (which requires an evaluator string) skips a retraction entirely, so version skew degrades to "the
// retraction isn't applied yet", never to a mis-rendered reading. `by` is the retracting session; `note`
// says why (a botched e2e filing, a wrong verdict).
export type Retraction = { retracts: string; scenario: string; note?: string; by?: string; ts: string }

// parse the sidecar RAW: one event per non-blank line — a Reading, or a Retraction (a line carrying a
// string `retracts`). A malformed line is skipped (the file is append-only and git-tracked, so a partial
// write or a hand-edit shouldn't sink the whole read) — fail soft per line.
export function readSidecar(sidecarPath: string): { readings: Reading[]; retractions: Retraction[] } {
  const readings: Reading[] = []
  const retractions: Retraction[] = []
  if (!existsSync(sidecarPath)) return { readings, retractions }
  for (const line of readFileSync(sidecarPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const r = JSON.parse(t)
      if (!r || typeof r.scenario !== 'string') continue
      if (typeof r.retracts === 'string') retractions.push(r as Retraction)
      else if (typeof r.evaluator === 'string') readings.push(r as Reading)
    } catch { /* skip a malformed line */ }
  }
  return { readings, retractions }
}

// the retraction join, shared by every effective-view reader: drop each reading a retraction targets by
// (scenario, ts) — NUL-joined, since a scenario name may contain spaces. A retraction matching nothing is
// inert: it excludes no reading and harms no read.
export function applyRetractions(readings: Reading[], retractions: Retraction[]): Reading[] {
  if (!retractions.length) return readings
  const gone = new Set(retractions.map((x) => `${x.scenario}\0${x.retracts}`))
  return readings.filter((r) => !gone.has(`${r.scenario}\0${r.ts}`))
}

// the EFFECTIVE readings — what the scoreboard sees: every reading minus the retracted. Every score
// consumer (freshness, scan, clean's referenced set, the eval tab, the proof) reads through here, so a
// retract undoes a botched filing on ALL of them at once — the previous reading becomes the latest again,
// or the scenario honestly returns to yatsu-missing.
export function readReadings(sidecarPath: string): Reading[] {
  const { readings, retractions } = readSidecar(sidecarPath)
  return applyRetractions(readings, retractions)
}

// append ONE reading as a JSON line — the only mutation eval performs (a reading is an event, never an
// overwrite; superseding readings are newer lines, freshness picks the latest per scenario).
export function appendReading(sidecarPath: string, r: Reading): void {
  appendFileSync(sidecarPath, JSON.stringify(r) + '\n')
}

// append ONE retraction as a JSON line — the sanctioned undo writes through the same append-only surface
// that filed the reading; the target line stays in place as history.
export function appendRetraction(sidecarPath: string, r: Retraction): void {
  appendFileSync(sidecarPath, JSON.stringify(r) + '\n')
}

// the latest reading per scenario (the file is chronological, so the LAST line for a name wins). clean's
// --keep-latest uses it to decide which blob to keep.
export function latestPerScenario(readings: Reading[]): Map<string, Reading> {
  const m = new Map<string, Reading>()
  for (const r of readings) m.set(r.scenario, r)   // later lines overwrite earlier → last wins
  return m
}
