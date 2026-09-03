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
  const nonSpec = changed.filter(file => !file.path.endsWith('/spec.md'))
  const onlyAck = specFiles.length === 0 && nonSpec.length > 0 && nonSpec.every(file => /evals\.ndjson|ack/i.test(file.path))
  const lines: string[] = []
  lines.push(`spec change report ${sha}`)
  if (onlyAck) {
    lines.push('ack/eval only, no body change (empty=true)')
  } else {
    const limit = Math.max(0, options.maxHunkLines ?? 40)
    const specPaths = run(root, ['ls-tree', '-r', '--name-only', tip, '--', '.spec']).split('\n').filter(path => path.endsWith('/spec.md'))
    for (const file of specFiles.sort((a, b) => a.path.localeCompare(b.path))) {
      const source = run(root, ['show', `${tip}:${file.path}`])
      const fm = parseFm(source)
      const desc = fm.desc?.[0] ?? ''
      lines.push(`\n${nodeId(file.path)} — ${desc}`)
      const diff = run(root, ['diff', '--unified=0', `${base}..${tip}`, '--', file.path])
      const fmChanges = diff.split('\n').filter(line => /^[+-](?:code|related|status):|^[+-]\s+-\s+/.test(line) && /code|related|status/.test(line))
      lines.push(`status: ${file.status}${fmChanges.length ? `; frontmatter: ${fmChanges.join(' | ')}` : ''}`)
      const hunks = diff.split('\n').filter(line => /^@@|^[+-](?![+-])/.test(line) && !/^---|^\+\+\+/.test(line))
      const body = hunks.filter(line => !/^@@/.test(line))
      if (body.length) {
        lines.push('body:')
        lines.push(...body.slice(0, limit))
        if (body.length > limit) lines.push(`... (more in git show ${sha}:${file.path})`)
      }
    }
  }
  const numstat = run(root, ['diff', '--numstat', '-M', `${base}..${tip}`]).trim().split('\n').filter(Boolean)
  for (const row of numstat) {
    const [add, del, path] = row.split('\t')
    if (!path || path.endsWith('/spec.md')) continue
    const a = add === '-' ? 0 : Number(add), d = del === '-' ? 0 : Number(del)
    const governing = ownersFor(path, root, tip)
    lines.push(`file ${path} (+${a} −${d}), governed by node ${governing || 'unclaimed'}`)
  }
  lines.push(`\n${options.note ?? 'the sender gave no reason'}`)
  lines.push(`parent session ${options.parentSessionId ?? 'not given'} changed the nodes above at ${sha}; a contract you depend on may have moved. Finish the step in your hands, then reread them and rework if you must. Disagree by replying with spex session send ${options.parentSessionId ?? '<parent>'}. This is a request, not an order.`)
  return lines.join('\n')
}

function ownersFor(path: string, root: string, tip: string): string {
  const specPaths = run(root, ['ls-tree', '-r', '--name-only', tip, '--', '.spec']).split('\n').filter(path => path.endsWith('/spec.md'))
  for (const specPath of specPaths) {
    const fm = parseFm(run(root, ['show', `${tip}:${specPath}`]))
    if ((fm.code ?? []).some(claim => claim.split('#')[0] === path)) return nodeId(specPath)
  }
  return ''
}
