import { execFileSync } from 'node:child_process'
import { basename, dirname } from 'node:path'

export interface ChangeReportOptions {
  repoRoot: string
  rev?: string
  range?: string
  note?: string
  maxHunkLines?: number
  parentSessionId?: string
}

const run = (root: string, args: string[]): string => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
// a blob is absent on one side of an add or a delete; that node still owes the reader a section.
const show = (root: string, rev: string, path: string): string => {
  try { return run(root, ['show', `${rev}:${path}`]) } catch { return '' }
}
const nodeId = (path: string): string => basename(dirname(path))
const parseFm = (source: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  const match = source.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return out
  let key = ''
  for (const line of match[1].split('\n')) {
    const item = line.match(/^\s*-\s+(.*)$/)
    if (item && key) (out[key] ??= []).push(item[1].trim())
    else {
      const at = line.indexOf(':')
      if (at > 0) { key = line.slice(0, at).trim(); out[key] = line.slice(at + 1).trim() ? [line.slice(at + 1).trim()] : [] }
    }
  }
  return out
}

// 1-based line of the frontmatter's closing `---`, or 0 when the file opens with none. The body split
// needs this on BOTH sides: a `-` line is addressed in the base file, a `+` line in the tip file.
const frontmatterEnd = (source: string): number => {
  const lines = source.split('\n')
  if (lines[0] !== '---') return 0
  for (let index = 1; index < lines.length; index++) if (lines[index] === '---') return index + 1
  return 0
}

// @@@ governance edges are set differences, not diff-line text - a `code:`/`related:` row is a PATH, and a
// path carries no reliable marker saying which key it sits under. Reading the two blobs and differencing the
// parsed lists names every moved claim; matching the raw diff line can only ever match the path's spelling.
const frontmatterDelta = (before: Record<string, string[]>, after: Record<string, string[]>): string[] => {
  const parts: string[] = []
  for (const key of ['code', 'related']) {
    const had = new Set(before[key] ?? []), has = new Set(after[key] ?? [])
    for (const value of after[key] ?? []) if (!had.has(value)) parts.push(`+${key}: ${value}`)
    for (const value of before[key] ?? []) if (!has.has(value)) parts.push(`-${key}: ${value}`)
  }
  const was = before.status?.[0], now = after.status?.[0]
  if (was !== now) parts.push(`status: ${was ?? 'none'} → ${now ?? 'none'}`)
  return parts
}

// one pass over the tip tree, reused for every changed file: resolving owners per file re-read every spec
// node once per file, which is the product of the two things a large repo grows.
const ownerIndex = (root: string, tip: string): Map<string, string> => {
  const index = new Map<string, string>()
  const specPaths = run(root, ['ls-tree', '-r', '--name-only', tip, '--', '.spec']).split('\n').filter(path => path.endsWith('/spec.md'))
  for (const specPath of specPaths) {
    for (const claim of parseFm(show(root, tip, specPath)).code ?? []) {
      const path = claim.split('#')[0].trim()
      if (path && !index.has(path)) index.set(path, nodeId(specPath))
    }
  }
  return index
}

export function buildChangeReport(options: ChangeReportOptions): string {
  const root = options.repoRoot
  const tip = options.rev ?? (options.range ? options.range.split('..').at(-1) : 'HEAD') ?? 'HEAD'
  const base = options.range ? options.range.split('..')[0] : `${tip}^`
  const sha = run(root, ['rev-parse', tip]).trim()
  const names = run(root, ['diff', '--name-status', '-M', `${base}..${tip}`]).trim().split('\n').filter(Boolean)
  const changed = names.map(line => {
    const parts = line.split('\t'); return { status: parts[0], path: parts.at(-1)! }
  })
  const specFiles = changed.filter(file => file.path.endsWith('/spec.md'))
  // @@@ an ack stamp is an EMPTY commit - `spex spec ack` commits `--allow-empty --only` with a Spec-OK
  // trailer, so it changes no file at all. Asking which files it touched is the wrong question; its whole
  // signature is that the diff is empty. An eval reading only appends to an evals.ndjson.
  const onlyAck = changed.length === 0 || changed.every(file => basename(file.path) === 'evals.ndjson')
  const lines: string[] = []
  lines.push(`spec change report ${sha}`)
  if (onlyAck) {
    lines.push('ack/eval only, no body change (empty=true)')
  } else {
    const limit = Math.max(0, options.maxHunkLines ?? 40)
    for (const file of specFiles.sort((a, b) => a.path.localeCompare(b.path))) {
      const tipSource = show(root, tip, file.path), baseSource = show(root, base, file.path)
      const tipFm = parseFm(tipSource), baseFm = parseFm(baseSource)
      lines.push(`\n${nodeId(file.path)} — ${tipFm.desc?.[0] ?? baseFm.desc?.[0] ?? ''}`)
      const fmChanges = frontmatterDelta(baseFm, tipFm)
      lines.push(`status: ${file.status}${fmChanges.length ? `; frontmatter: ${fmChanges.join(' | ')}` : ''}`)
      const baseEnd = frontmatterEnd(baseSource), tipEnd = frontmatterEnd(tipSource)
      const diff = run(root, ['diff', '--unified=0', `${base}..${tip}`, '--', file.path])
      const body: string[] = []
      let oldLine = 0, newLine = 0
      for (const line of diff.split('\n')) {
        const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
        if (header) { oldLine = Number(header[1]); newLine = Number(header[2]); continue }
        if (/^(---|\+\+\+) /.test(line)) continue
        if (line.startsWith('-')) { if (oldLine++ > baseEnd) body.push(line) }
        else if (line.startsWith('+')) { if (newLine++ > tipEnd) body.push(line) }
      }
      if (body.length) {
        lines.push('body:')
        lines.push(...body.slice(0, limit))
        if (body.length > limit) lines.push(`... (more in git show ${sha}:${file.path})`)
      }
    }
  }
  const numstat = run(root, ['diff', '--numstat', '-M', `${base}..${tip}`]).trim().split('\n').filter(Boolean)
  const owners = numstat.length ? ownerIndex(root, tip) : new Map<string, string>()
  for (const row of numstat) {
    const [add, del, path] = row.split('\t')
    if (!path || path.endsWith('/spec.md')) continue
    const a = add === '-' ? 0 : Number(add), d = del === '-' ? 0 : Number(del)
    lines.push(`file ${path} (+${a} −${d}), governed by node ${owners.get(path) || 'unclaimed'}`)
  }
  lines.push(`\n${options.note ?? 'the sender gave no reason'}`)
  lines.push(`parent session ${options.parentSessionId ?? 'not given'} changed the nodes above at ${sha}; a contract you depend on may have moved. Finish the step in your hands, then reread them and rework if you must. Disagree by replying with spex session send ${options.parentSessionId ?? '<parent>'}. This is a request, not an order.`)
  return lines.join('\n')
}
