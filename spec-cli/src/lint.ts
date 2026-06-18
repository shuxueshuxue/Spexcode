import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot, history } from './git.js'
import { loadSpecs } from './specs.js'

// @@@ spec-lint - keeps the spec<->code GRAPH honest (the judge keeps the CONTENT honest, elsewhere):
//   integrity (error): every file a spec lists in `code:` actually exists.
//   coverage  (warn) : every governed source file is claimed by >=1 spec — no orphan code.
//   drift     (warn) : a governed file has commits newer than its spec's latest version -> maybe stale.
// No file hashes are stored anywhere: git already is the hash database, so drift is derived live.

export type Finding = { level: 'error' | 'warn'; rule: string; spec?: string; file?: string; msg: string }

// the roots whose source files must each be governed by a spec. Could move to spexcode.json later.
const GOVERNED_ROOTS = ['spec-dashboard/src', 'spec-cli/src']
const SRC = /\.(ts|tsx|js|jsx)$/
const SKIP_DIRS = new Set(['node_modules', 'dist', '.vite'])

function sourceFiles(root: string, rel: string, acc: string[]) {
  const abs = join(root, rel)
  if (!existsSync(abs)) return
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) sourceFiles(root, join(rel, e.name), acc) }
    else if (SRC.test(e.name)) acc.push(join(rel, e.name))
  }
}

const lastChange = (root: string, path: string) => history(root, path)[0]?.date ?? ''

export function specLint(): Finding[] {
  const root = repoRoot()
  const specs = loadSpecs()
  const out: Finding[] = []

  // integrity + build the file -> owners map.
  const owners = new Map<string, string[]>()
  for (const s of specs) {
    for (const f of s.code) {
      if (!existsSync(join(root, f)))
        out.push({ level: 'error', rule: 'integrity', spec: s.id, file: f, msg: `spec '${s.id}' lists a missing file: ${f}` })
      owners.set(f, [...(owners.get(f) ?? []), s.id])
    }
  }

  // coverage: every governed source file must be claimed by at least one spec.
  const governed: string[] = []
  for (const r of GOVERNED_ROOTS) sourceFiles(root, r, governed)
  for (const f of governed)
    if (!owners.has(f)) out.push({ level: 'warn', rule: 'coverage', file: f, msg: `no spec governs: ${f}` })

  // drift: a governed file changed more recently than the spec that governs it.
  for (const s of specs) {
    const specDate = lastChange(root, s.path)
    for (const f of s.code) {
      if (!existsSync(join(root, f))) continue
      const fileDate = lastChange(root, f)
      if (specDate && fileDate && fileDate > specDate)
        out.push({ level: 'warn', rule: 'drift', spec: s.id, file: f, msg: `${f} changed after spec '${s.id}' (v${s.version}) — may be stale` })
    }
  }

  return out
}
