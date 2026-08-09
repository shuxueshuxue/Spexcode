import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { git, repoRoot } from './git.js'
import {
  loadAgentConfig,
  loadConfig,
  loadHookConfig,
  loadReviewConfig,
  loadSkillConfig,
  loadSystemConfig,
  type ConfigPreset,
} from './specs.js'
import { helpCatalogEntries } from './help.js'
import { guideCatalogEntries } from './guide.js'

export const GUIDANCE_SCHEMA_VERSION = 1 as const
export type GuidanceKind = 'plugin' | 'help' | 'guide'
export type GuidanceSurface = 'system' | 'command' | 'hook' | 'skill' | 'agent' | 'review'

export type GuidanceSource = Readonly<{
  path: string
  contentHash: string
  revision: string
}>

export type GuidanceEntry = Readonly<{
  id: string
  kind: GuidanceKind
  surface?: GuidanceSurface
  title: string
  description: string
  source: GuidanceSource
}>

export type GuidanceBundle = Readonly<{
  schemaVersion: typeof GUIDANCE_SCHEMA_VERSION
  revision: string
  entries: readonly GuidanceEntry[]
  bundleHash: string
}>

type GitReader = (args: string[]) => string
export type GuidanceCatalogOptions = Readonly<{
  root?: string
  revision?: string
  sourceRevision?: (path: string) => string
  gitReader?: GitReader
}>

const SURFACES: readonly [GuidanceSurface, () => ConfigPreset[]][] = [
  ['agent', loadAgentConfig],
  ['command', loadConfig],
  ['hook', loadHookConfig],
  ['review', loadReviewConfig],
  ['skill', loadSkillConfig],
  ['system', loadSystemConfig],
]

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

function freeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
  return Object.freeze(value)
}

function sourcePathForPreset(preset: ConfigPreset): string {
  return join(preset.dir, 'spec.md').replaceAll('\\', '/')
}

function sortEntries(entries: GuidanceEntry[]): GuidanceEntry[] {
  return entries.sort((a, b) => {
    const left = `${a.kind}\0${a.id}\0${a.surface ?? ''}\0${a.source.path}`
    const right = `${b.kind}\0${b.id}\0${b.surface ?? ''}\0${b.source.path}`
    return left < right ? -1 : left > right ? 1 : 0
  })
}

function sourceRevision(root: string, path: string, readGit: GitReader): string {
  const result = readGit(['-C', root, 'log', '-1', '--format=%H', '--', path]).trim()
  return result || 'working-tree'
}

function currentRevision(root: string, readGit: GitReader): string {
  return readGit(['-C', root, 'rev-parse', 'HEAD']).trim() || 'working-tree'
}

function entrySource(root: string, path: string, text: string, revision: string, readSourceRevision: (path: string) => string): GuidanceSource {
  return { path: relative(root, join(root, path)).replaceAll('\\', '/'), contentHash: sha256(text), revision: readSourceRevision(path) || revision }
}

/**
 * Immutable product-side index over the authoritative plugin/help/guide surfaces.
 * The constructor reads only the existing registries; it never stores their prose in the bundle.
 */
export class GuidanceCatalog {
  readonly bundle: GuidanceBundle

  constructor(options: GuidanceCatalogOptions = {}) {
    const root = options.root ?? repoRoot()
    const readGit = options.gitReader ?? git
    const revision = options.revision ?? currentRevision(root, readGit)
    const readSourceRevision = options.sourceRevision ?? ((path: string) => sourceRevision(root, path, readGit))
    const sourceRevisions = new Map<string, string>()
    const sourceRevisionFor = (path: string): string => {
      const known = sourceRevisions.get(path)
      if (known) return known
      const value = readSourceRevision(path) || revision
      sourceRevisions.set(path, value)
      return value
    }
    const entries: GuidanceEntry[] = []

    for (const [surface, loader] of SURFACES) {
      for (const preset of loader()) {
        const path = sourcePathForPreset(preset)
        entries.push({
          id: `plugin:${surface}:${preset.name}`,
          kind: 'plugin',
          surface,
          title: preset.title,
          description: preset.desc,
          source: entrySource(root, path, preset.body, revision, sourceRevisionFor),
        })
      }
    }
    for (const entry of helpCatalogEntries()) {
      const path = 'spec-cli/src/help.ts'
      entries.push({
        id: `help:${entry.id}`,
        kind: 'help',
        title: entry.title,
        description: 'CLI command usage and safety guidance',
        source: entrySource(root, path, entry.text, revision, sourceRevisionFor),
      })
    }
    for (const entry of guideCatalogEntries()) {
      const path = 'spec-cli/src/guide.ts'
      entries.push({
        id: `guide:${entry.id}`,
        kind: 'guide',
        title: entry.title,
        description: 'CLI workflow and format guidance',
        source: entrySource(root, path, entry.text, revision, sourceRevisionFor),
      })
    }

    const payload = {
      schemaVersion: GUIDANCE_SCHEMA_VERSION,
      revision,
      entries: sortEntries(entries),
    }
    const bundleHash = sha256(JSON.stringify(payload))
    this.bundle = freeze({ ...payload, bundleHash })
  }

  entries(): readonly GuidanceEntry[] {
    return this.bundle.entries
  }

  toJSON(): GuidanceBundle {
    return this.bundle
  }

  exportJson(): string {
    return `${JSON.stringify(this.bundle, null, 2)}\n`
  }

  write(path: string): void {
    writeFileSync(path, this.exportJson(), 'utf8')
  }
}

export function buildGuidanceCatalog(options: GuidanceCatalogOptions = {}): GuidanceCatalog {
  return new GuidanceCatalog(options)
}
