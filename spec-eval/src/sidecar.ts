import { readFileSync, appendFileSync, existsSync } from 'node:fs'

export type Verdict = { status: 'pass' | 'fail'; note?: string }

export type EvidenceKind = 'image' | 'transcript' | 'video' | 'data'
export type Evidence = { hash: string; kind: EvidenceKind }

export type Reading = {
  scenario: string
  codeSha: string
  scenarioHash?: string
  evidence?: Evidence[]
  blob?: string | null
  blobKind?: EvidenceKind
  timelineBlob?: string
  evaluator?: string
  by?: string
  verdict?: Verdict
  ts: string
}

export function evidenceOf(r: { evidence?: Evidence[]; blob?: string | null; blobKind?: EvidenceKind }): Evidence[] {
  if (r.evidence?.length) return r.evidence
  if (r.blob) return [{ hash: r.blob, kind: r.blobKind ?? 'image' }]
  return []
}

export function isJsonBlob(b: Buffer): boolean {
  if (!b.length || b.includes(0)) return false           // empty or binary → not JSON text
  if (b.length > 4_000_000) return false                 // don't parse an unbounded blob just to sniff a type
  const s = b.toString('utf8').trim()
  const open = s[0], close = s[s.length - 1]
  if (!((open === '{' && close === '}') || (open === '[' && close === ']'))) return false
  try { const v = JSON.parse(s); return v !== null && typeof v === 'object' } catch { return false }
}

export type Retraction = { retracts: string; scenario: string; note?: string; by?: string; ts: string }

export type HumanOk = { kind: 'human-ok'; scenario: string; okTs: string; okSha: string; by: string; ts: string }

export function readSidecar(sidecarPath: string): { readings: Reading[]; retractions: Retraction[]; oks: HumanOk[] } {
  const readings: Reading[] = []
  const retractions: Retraction[] = []
  const oks: HumanOk[] = []
  if (!existsSync(sidecarPath)) return { readings, retractions, oks }
  for (const line of readFileSync(sidecarPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const r = JSON.parse(t)
      if (!r || typeof r.scenario !== 'string') continue
      if (typeof r.retracts === 'string') retractions.push(r as Retraction)
      else if (r.kind === 'human-ok' && typeof r.okTs === 'string') oks.push(r as HumanOk)
      else if (typeof r.codeSha === 'string') readings.push(r as Reading)
    } catch { /* Keep earlier events readable after an incomplete append. */ }
  }
  return { readings, retractions, oks }
}

export function applyRetractions(readings: Reading[], retractions: Retraction[]): Reading[] {
  if (!retractions.length) return readings
  const gone = new Set(retractions.map((x) => `${x.scenario}\0${x.retracts}`))
  return readings.filter((r) => !gone.has(`${r.scenario}\0${r.ts}`))
}

export function readReadings(sidecarPath: string): Reading[] {
  const { readings, retractions } = readSidecar(sidecarPath)
  return applyRetractions(readings, retractions)
}

export function appendReading(sidecarPath: string, r: Reading): void {
  appendFileSync(sidecarPath, JSON.stringify(r) + '\n')
}

export function appendRetraction(sidecarPath: string, r: Retraction): void {
  appendFileSync(sidecarPath, JSON.stringify(r) + '\n')
}

export function appendHumanOk(sidecarPath: string, r: HumanOk): void {
  appendFileSync(sidecarPath, JSON.stringify(r) + '\n')
}

export function humanOkFor(oks: HumanOk[], scenario: string, readingTs: string): HumanOk | null {
  let hit: HumanOk | null = null
  for (const o of oks) if (o.scenario === scenario && o.okTs === readingTs) hit = o
  return hit
}

export function latestPerScenario(readings: Reading[]): Map<string, Reading> {
  const m = new Map<string, Reading>()
  for (const r of readings) m.set(r.scenario, r)   // later lines overwrite earlier → last wins
  return m
}
