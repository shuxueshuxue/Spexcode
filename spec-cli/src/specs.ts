import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { repoRoot, history, type Version } from './git.js'

// @@@ tree from filesystem - the spec tree IS the directory tree under .spec; a node is any
// directory holding a spec.md, its parent is the nearest ancestor that also holds one.
const ROOT = repoRoot()
const SPEC_DIR = join(ROOT, '.spec')

type Raw = { id: string; parent: string | null; relPath: string; fm: Record<string, string>; body: string }

function parseFrontmatter(src: string) {
  const fm: Record<string, string> = {}
  let body = src
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (m) {
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':')
      if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    body = m[2]
  }
  return { fm, body }
}

function walk(dir: string, parent: string | null, acc: Raw[]) {
  let myId = parent
  if (existsSync(join(dir, 'spec.md'))) {
    myId = basename(dir)
    const relPath = relative(ROOT, join(dir, 'spec.md'))
    const { fm, body } = parseFrontmatter(readFileSync(join(dir, 'spec.md'), 'utf8'))
    acc.push({ id: myId, parent, relPath, fm, body })
  }
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(dir, e.name), myId, acc)
  }
}

function raws(): Raw[] {
  const acc: Raw[] = []
  if (existsSync(SPEC_DIR)) walk(SPEC_DIR, null, acc)
  return acc
}

export function loadSpecs() {
  return raws().map((r) => {
    const h = history(ROOT, r.relPath)
    return {
      id: r.id,
      parent: r.parent,
      title: r.fm.title || r.id,
      status: r.fm.status || 'pending',
      session: r.fm.session && r.fm.session !== 'null' ? r.fm.session : null,
      hue: Number(r.fm.hue || 210),
      desc: r.fm.desc || '',
      version: h.length,
      reason: h[0]?.reason || '',
      body: r.body.trim(),
    }
  })
}

export function specHistory(id: string): Version[] {
  const node = raws().find((r) => r.id === id)
  return node ? history(ROOT, node.relPath) : []
}
