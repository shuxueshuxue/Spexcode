import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
export const LIVE_PLUGINS = join(root, '.spec', 'spexcode', '.plugins')
export const INIT_PLUGINS = join(root, 'spec-cli', 'templates', 'spec', 'project', '.plugins')

function frontmatter(source) {
  return source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1] ?? ''
}

function isHeldBack(specPath) {
  return existsSync(specPath) && /^seed:\s*false\s*$/m.test(frontmatter(readFileSync(specPath, 'utf8')))
}

function allSpecIds(specRoot) {
  const ids = new Set()
  const visit = (dir) => {
    if (existsSync(join(dir, 'spec.md'))) ids.add(basename(dir))
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(dir, entry.name))
    }
  }
  visit(specRoot)
  return ids
}

function projectLinks(source, knownIds, seededIds) {
  let fenced = false
  return source.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      return line
    }
    if (fenced) return line
    return line.split(/(`+[^`]*`+)/g).map((part, index) => {
      if (index % 2) return part
      return part.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (whole, target, label) => {
        const id = target.trim()
        return knownIds.has(id) && !seededIds.has(id) ? (label?.trim() || id) : whole
      })
    }).join('')
  }).join('\n')
}

export function buildProjection({
  sourceDir = LIVE_PLUGINS,
  specRoot = join(root, '.spec'),
  sourceRootName = 'spexcode',
  targetRootName = 'project',
} = {}) {
  const files = new Map()
  const seededIds = new Set()

  const visit = (dir, relDir = '') => {
    const specPath = join(dir, 'spec.md')
    if (isHeldBack(specPath)) return
    if (existsSync(specPath)) seededIds.add(basename(dir))

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const relPath = join(relDir, entry.name)
      if (entry.isDirectory()) {
        visit(path, relPath)
        continue
      }
      // Scenarios and readings measure the dogfood implementation and name commits from its git database;
      // plugin definitions/helpers project, measurement artifacts do not.
      if (entry.name === 'eval.md' || entry.name === 'evals.ndjson') continue
      files.set(relPath, {
        content: readFileSync(path),
        mode: statSync(path).mode & 0o777,
      })
    }
  }
  visit(sourceDir)

  const knownIds = allSpecIds(specRoot)
  const sourcePrefix = `.spec/${sourceRootName}/.plugins`
  const targetPrefix = `.spec/${targetRootName}/.plugins`
  for (const [relPath, file] of files) {
    if (!relPath.endsWith('.md')) continue
    let content = file.content.toString('utf8')
    content = content.replaceAll(sourcePrefix, targetPrefix)
    if (basename(relPath) === 'spec.md') {
      content = content.replace(/^seed:\s*(?:true|false)\s*\n/m, '')
      content = projectLinks(content, knownIds, seededIds)
    }
    file.content = Buffer.from(content)
  }
  return files
}

function targetFiles(targetDir) {
  const files = new Map()
  if (!existsSync(targetDir)) return files
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else files.set(relative(targetDir, path), path)
    }
  }
  visit(targetDir)
  return files
}

export function projectionDiff(projection, targetDir = INIT_PLUGINS) {
  const actual = targetFiles(targetDir)
  const paths = [...new Set([...projection.keys(), ...actual.keys()])].sort()
  const differences = []
  for (const path of paths) {
    const expected = projection.get(path)
    const actualPath = actual.get(path)
    if (!expected) {
      differences.push(`extra: ${path}`)
    } else if (!actualPath) {
      differences.push(`missing: ${path}`)
    } else if (!expected.content.equals(readFileSync(actualPath))) {
      differences.push(`content: ${path}`)
    } else if ((expected.mode & 0o111) !== (statSync(actualPath).mode & 0o111)) {
      differences.push(`mode: ${path}`)
    }
  }
  return differences
}

export function writeProjection(projection, targetDir = INIT_PLUGINS) {
  rmSync(targetDir, { recursive: true, force: true })
  for (const [path, file] of projection) {
    const target = join(targetDir, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.content)
    chmodSync(target, file.mode)
  }
}

function main() {
  const mode = process.argv[2]
  const projection = buildProjection()
  if (mode === '--write') {
    writeProjection(projection)
    console.log(`init plugins: wrote ${projection.size} files from ${relative(root, LIVE_PLUGINS)}`)
    return
  }
  if (mode !== '--check') {
    console.error('usage: node scripts/sync-init-plugins.mjs --check|--write')
    process.exitCode = 2
    return
  }
  const differences = projectionDiff(projection)
  if (differences.length) {
    console.error(`init plugin parity failed (${differences.length} difference(s)):\n${differences.map((d) => `  - ${d}`).join('\n')}\nRun \`npm run sync:init-plugins\` to regenerate the adopter seed.`)
    process.exitCode = 1
    return
  }
  console.log(`init plugin parity: ${projection.size} generated files match`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
