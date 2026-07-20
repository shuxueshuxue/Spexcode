import { closeSync, lstatSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { git } from './git.js'

export type SourcePolicy = {
  sourceExtensions: string[] | null
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

const NON_SOURCE_DIRS = new Set([
  'node_modules', 'vendor', 'vendors', 'third_party', 'third-party', 'external',
  'dist', 'build', 'out', 'target', 'coverage',
  'generated', 'gen',
  'docs', 'doc', 'documentation',
  '__pycache__', '.cache', '.next', '.nuxt', '.svelte-kit', '.venv', 'venv', 'site-packages',
])

const NON_SOURCE_EXTENSIONS = new Set([
  'md', 'mdx', 'rst', 'adoc', 'txt', 'pdf',
  'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv', 'ini', 'cfg', 'conf', 'properties', 'lock',
  'svg', 'map',
])

const NON_SOURCE_NAMES = new Set([
  'readme', 'license', 'copying', 'notice', 'changelog', 'contributing', 'authors',
])

const GENERATED_NAME = /(?:^|[._-])(?:generated|autogen|min)(?:[._-]|$)/i

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

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1) : ''
}

function defaultPathCandidate(path: string): boolean {
  const segments = path.split('/')
  const dirs = segments.slice(0, -1)
  if (dirs.some((part) => part.startsWith('.') || NON_SOURCE_DIRS.has(part.toLowerCase()))) return false

  const base = segments.at(-1) ?? ''
  if (!base || base.startsWith('.') || GENERATED_NAME.test(base)) return false
  const firstWord = base.split('.')[0].toLowerCase()
  if (NON_SOURCE_NAMES.has(firstWord)) return false
  return !NON_SOURCE_EXTENSIONS.has(extensionOf(path).toLowerCase())
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
  if (policy.testGlobs.some((glob) => globToRe(glob).test(path))) return false
  if (policy.sourceExtensions !== null) {
    if (!policy.sourceExtensions.includes(extensionOf(path))) return false
  } else if (!defaultPathCandidate(path)) return false
  return isTextWorktreeFile(root, path)
}

export function trackedSourceFiles(root: string, roots: string[], policy: SourcePolicy): string[] {
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
  return policy.sourceExtensions === null
    ? 'default tracked-text policy (tests, docs/metadata/assets, vendored/generated/build output, and binary files excluded)'
    : `explicit lint.sourceExtensions [${policy.sourceExtensions.join(', ')}]`
}
