import { readFileSync, appendFileSync, existsSync } from 'node:fs'

// the verdict is pass | fail; `note` is an OPTIONAL one-line annotation on either (why it failed, how far
// a pass is from ideal) — not a third status. (Legacy readings filed when `note` was its own status survive
// on disk with status:'note'; render stays tolerant of them, the CLI no longer mints them.)
export type Verdict = { status: 'pass' | 'fail'; note?: string }

// The evidence-kind taxonomy ([[evidence-kind-taxonomy]]) is a MEDIA/RENDER type — how a blob's bytes are
// shown — kept ORTHOGONAL to the step-map AXIS (which is derived from the kind, not welded to it): `image`
// (a still), `transcript` (free-form text), `video` (a screenshot with a time axis), `data` (a structured
// machine export — a JSON/metrics dump — rendered as a validatable data block, not flattened into scrolling
// transcript text). A `data` reading is honest about being structured: it can be parsed and checked, and it
// is derived from CONTENT (isJsonBlob), never from which filing flag was used.
export type EvidenceKind = 'image' | 'transcript' | 'video' | 'data'
// one piece of a reading's evidence: a content-addressed blob (`hash`) tagged by `kind`.
export type Evidence = { hash: string; kind: EvidenceKind }

// A reading's evidence is a LIST of typed entries — N images and/or a video (with its step-timeline) and/or
// a transcript, in filing order. New filings write `evidence`; the legacy scalar shape (`blob` + `blobKind`,
// absent kind → image) is still READ and normalized to a one-entry list by `evidenceOf`, so old readings
// still render. A video reading may carry `timelineBlob`: the content hash of its step-timeline sidecar
// (timeline.ts) mapping clip moments to named steps — it anchors the reading's VIDEO evidence entry.
// `by` is the SESSION that filed this reading (the filer, from envSessionId) — the ORIGINATOR an eval-comment
// thread loops in on a reply ([[mentions]] implicit loop-in). Pure additive: a legacy reading without it simply
// has no originator → silent. WHO measured is deliberately NOT a schema axis — the agent is the measuring
// hand; the retired `evaluator` tag survives on old lines only, read-tolerated like the scalar blob.
export type Reading = {
  scenario: string
  codeSha: string
  evidence?: Evidence[]
  // legacy scalar evidence — read for old readings, never written by new filings.
  blob?: string | null
  blobKind?: EvidenceKind
  timelineBlob?: string
  // legacy instrument tag (always 'manual@1') — read for old readings, never written by new filings.
  evaluator?: string
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

// Is this blob STRUCTURED DATA (a machine export — a JSON object/array) rather than free-form transcript
// text? The `data` evidence kind ([[evidence-kind-taxonomy]]) is derived from CONTENT, never from which
// filing flag was used: a hyperfine `--export-json`, an API payload, a metrics dump is data, and flattening
// it into a scrolling transcript loses that it can be structurally validated and rendered as a data block.
// Sniffed cheaply and self-contained (no deps): a text blob (no NUL) whose trimmed body brackets as an
// object/array AND parses to one; anything else (plain logs, terminal text) is not data. This is the ONE
// predicate both the blob MIME sniff (application/json) and the CLI `--result` kind derive from, so the
// stored kind and the served Content-Type always agree.
export function isJsonBlob(b: Buffer): boolean {
  if (!b.length || b.includes(0)) return false           // empty or binary → not JSON text
  if (b.length > 4_000_000) return false                 // don't parse an unbounded blob just to sniff a type
  const s = b.toString('utf8').trim()
  const open = s[0], close = s[s.length - 1]
  if (!((open === '{' && close === '}') || (open === '[' && close === ']'))) return false
  try { const v = JSON.parse(s); return v !== null && typeof v === 'object' } catch { return false }
}

// a RETRACTION is the sanctioned inverse of a filing — itself an appended event, never a deleted line
// (the sidecar stays append-only; git shows who retracted what, when). `retracts` is the target reading's
// `ts` within `scenario` (its natural key). The two event kinds are told apart POSITIVELY — a retraction
// carries `retracts`, a reading carries `codeSha`; neither is recognized by another field's absence. `by`
// is the retracting session; `note` says why (a botched e2e filing, a wrong verdict).
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
      else if (typeof r.codeSha === 'string') readings.push(r as Reading)
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
