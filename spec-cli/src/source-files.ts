import { closeSync, lstatSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { git } from './git.js'

export type SourcePolicy = {
  sourceIncludeGlobs: string[] | null
  sourceExcludeGlobs: string[]
  testGlobs: string[]
}

export const DEFAULT_TEST_GLOBS = [
  '**/*.test.*',
  '**/*.spec.*',
  '**/test_*.*',
  '**/*_test.*',
  '**/test/**',
  '**/tests/**',
  '**/__tests__/**',
]

function globToRe(glob: string): RegExp {
  const body = glob.split(/(\*\*\/|\*\*|\*|\?)/).map((seg) => {
    if (seg === '**/') return '(?:.*/)?'
    if (seg === '**') return '.*'
    if (seg === '*') return '[^/]*'
    if (seg === '?') return '[^/]'
    return seg.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }).join('')
  return new RegExp(`^${body}$`)
}

function isSpexCodeData(path: string): boolean {
  return path === 'spexcode.json' || path === 'spexcode.local.json'
    || path === '.spec' || path.startsWith('.spec/')
    || path === '.plugins' || path.startsWith('.plugins/')
}

function isTextWorktreeFile(root: string, path: string): boolean {
  const full = join(root, path)
  let fd: number | null = null
  try {
    if (!lstatSync(full).isFile()) return false
    fd = openSync(full, 'r')
    const sample = Buffer.allocUnsafe(8000)
    const bytes = readSync(fd, sample, 0, sample.length, 0)
    return !sample.subarray(0, bytes).includes(0)
  } catch {
    return false
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

// Source discovery classifies tracked paths and bytes only. Language structure belongs to anchors.ts's
// adapter registry; adding a language must never add a branch here.
export function isSourceFile(root: string, path: string, policy: SourcePolicy): boolean {
  if (!isSourcePath(path, policy)) return false
  return isTextWorktreeFile(root, path)
}

function isSourcePath(path: string, policy: SourcePolicy): boolean {
  if (isSpexCodeData(path)) return false
  if (policy.sourceIncludeGlobs !== null && !policy.sourceIncludeGlobs.some((glob) => globToRe(glob).test(path))) return false
  if (policy.sourceExcludeGlobs.some((glob) => globToRe(glob).test(path))) return false
  if (policy.testGlobs.some((glob) => globToRe(glob).test(path))) return false
  return true
}

export function trackedSourceFiles(root: string, roots: string[], policy: SourcePolicy, tip = 'HEAD'): string[] {
  if (tip !== 'HEAD') {
    let listed = '', textOut = ''
    try {
      listed = git(['-C', root, '-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', '-l', tip, '--', ...roots])
      textOut = git(['-C', root, '-c', 'core.quotePath=false', 'grep', '-I', '-l', '-z', '-e', '', tip, '--', ...roots])
    } catch { /* git grep exits 1 when the tree slice has no non-empty text */ }
    const text = new Set(textOut.split('\0').map((entry) => {
      const prefix = `${tip}:`
      return entry.startsWith(prefix) ? entry.slice(prefix.length) : entry
    }).filter(Boolean))
    const out = new Set<string>()
    for (const record of listed.split('\0')) {
      if (!record) continue
      const m = record.match(/^100\d+ blob [0-9a-f]+\s+(\d+)\t([\s\S]+)$/)
      if (!m) continue
      const path = m[2]
      if (isSourcePath(path, policy) && (+m[1] === 0 || text.has(path))) out.add(path)
    }
    return [...out]
  }
  const out = new Set<string>()
  for (const governedRoot of roots) {
    let listed = ''
    try { listed = git(['-C', root, 'ls-files', '-z', '--', governedRoot]) } catch { continue }
    for (const path of listed.split('\0')) {
      if (path && isSourceFile(root, path, policy)) out.add(path)
    }
  }
  return [...out]
}

export function sourcePolicyDescription(policy: SourcePolicy): string {
  const includes = policy.sourceIncludeGlobs === null ? 'ALL tracked regular text' : `[${policy.sourceIncludeGlobs.join(', ')}]`
  return `includes ${includes}; sourceExcludeGlobs [${policy.sourceExcludeGlobs.join(', ')}]; testGlobs [${policy.testGlobs.join(', ')}] (SpexCode-owned data always excluded)`
}
