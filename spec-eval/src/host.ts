import type { RemarkTrack } from './remarks.js'
import type { ReviewDiffFile } from '@spexcode/spec-core'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type EvalHost = {
  loadConfig?: (root: string) => any
  trackedSourceFiles?: (root: string, roots: string[], policy: any) => string[]
  stripRefSigil?: (value: string) => string
  commitTrunkData?: (path: string, message: string) => 'committed' | 'no-op' | 'not-primary'
  apiBase?: () => Promise<string>
}

export type ReviewIdentity = { id: string; branch: string | null; label: string }
export type ReviewPayload = {
  id: string
  branch: string | null
  label: string
  ahead: number
  dirtyNonRuntime: number
  diff: ReviewDiffFile[]
  gates: { conflictsWithMain: boolean; lint: { errorCount: number; warningCount: number } }
  proposal: { kind: string | null; note: string | null }
}
export type EvalHostPort = EvalHost & {
  reviewIdentity: (id: string) => ReviewIdentity | null
  reviewPayload: (id: string) => Promise<ReviewPayload | null>
  loadEvalRemarkTracks?: () => Map<string, RemarkTrack>
}
let services: EvalHost = {}

let remarks: () => Map<string, RemarkTrack> = () => new Map()

export function setEvalRemarkTracks(loader: () => Map<string, RemarkTrack>): void {
  remarks = loader
}

export function setEvalHost(next: EvalHost): void { services = { ...services, ...next } }
export function evalHost(): EvalHost { return services }

// CLI-backed commands must fail at the capability boundary, rather than letting an absent
// service turn into an unrelated TypeError or an empty result. Remark reads are the one
// deliberate standalone downgrade and stay on evalRemarkTracks() below.
export function requireEvalHost<K extends keyof EvalHost>(field: K): NonNullable<EvalHost[K]> {
  const value = services[field]
  if (value == null) throw new Error(`spec-eval host is not configured: ${String(field)}`)
  return value as NonNullable<EvalHost[K]>
}

export function evalRemarkTracks(): Map<string, RemarkTrack> {
  return remarks()
}

// The eval engine fingerprints the remark input even when no CLI host is installed. It deliberately hashes
// bytes, not issue semantics; the CLI host remains the sole owner of parsing and joining remark tracks.
export function evalRemarkSourceFingerprint(): string {
  const root = process.env.SPEXCODE_ISSUES_DIR
  if (!root) return ''
  const files: string[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries.sort()) {
      const path = join(dir, name)
      try {
        if (statSync(path).isDirectory()) walk(path)
        else files.push(`${path}\0${readFileSync(path).toString('base64')}`)
      } catch { files.push(`${path}\0<unreadable>`) }
    }
  }
  walk(root)
  return files.join('\0')
}

export const trackKey = (node: string, scenario: string): string => `${node} · ${scenario}`
