import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REFERENCE_SNAPSHOT_SCHEMA = 'spexcode.reference-snapshot/v1'
export const REFERENCE_SNAPSHOT_PAYLOAD_NAME = 'reference-snapshot.json'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function fail(message) {
  throw new Error(`reference-snapshot: ${message}`)
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) fail(`${name} must be a non-empty string`)
  return value
}

function walk(directory) {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'))
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    const metadata = lstatSync(path)
    if (metadata.isSymbolicLink()) fail(`refusing symbolic link ${path}`)
    if (metadata.isDirectory()) files.push(...walk(path))
    else if (metadata.isFile() && entry.name === 'spec.md') files.push(path)
  }
  return files
}

function frontmatter(source, sourcePath) {
  if (!source.startsWith('---\n')) fail(`${sourcePath} must start with frontmatter`)
  const end = source.indexOf('\n---\n', 4)
  if (end === -1) fail(`${sourcePath} has unterminated frontmatter`)
  const fields = source.slice(4, end).split('\n')
  const titleLine = fields.find((line) => line.startsWith('title:'))
  const title = titleLine?.slice('title:'.length).trim()
  return { title: required(title, `${sourcePath} frontmatter title`), body: source.slice(end + 5) }
}

function pagePath(sourceRoot, sourcePath) {
  const local = relative(sourceRoot, dirname(sourcePath)).replaceAll('\\', '/')
  if (!local || local === '.') return 'index.md'
  const path = `${local.split('/').map((part) => part.startsWith('.') ? `dot-${part.slice(1)}` : part).join('/')}/index.md`
  if (path.split('/').some((part) => !part || part === '.' || part === '..')) fail(`unsafe page path for ${sourcePath}`)
  return path
}

function pageContent({ title, body, sourcePath, sourceHash }) {
  const withoutHeading = body.replace(/^# .+\n+/, '')
  return [
    `# ${title}`,
    '',
    '<!-- Generated from the sealed SpexCode Reference snapshot. Do not edit this derived page. -->',
    '',
    '## Provenance',
    '',
    `- Source: \`${sourcePath}\``,
    `- Source SHA-256: \`${sourceHash}\``,
    '',
    withoutHeading.trimEnd(),
    '',
  ].join('\n')
}

function navTree(pages) {
  const byDirectory = new Map(pages.map((page) => [page.path.slice(0, -'/index.md'.length), page]))
  const rootPage = byDirectory.get('')
  if (!rootPage) fail('Reference tree must contain a root spec.md')
  const children = new Map()
  for (const directory of byDirectory.keys()) {
    if (!directory) continue
    const parent = directory.includes('/') ? directory.slice(0, directory.lastIndexOf('/')) : ''
    if (!byDirectory.has(parent)) fail(`Reference page ${directory}/index.md has no parent page`)
    const entries = children.get(parent) ?? []
    entries.push(directory)
    children.set(parent, entries)
  }
  const node = (directory) => {
    const page = byDirectory.get(directory)
    const childDirectories = (children.get(directory) ?? []).sort((left, right) => left.localeCompare(right, 'en'))
    return { title: page.title, path: page.path, children: childDirectories.map(node) }
  }
  return node('')
}

export function createReferenceSnapshot({ root: projectRoot = root, revision }) {
  const sourceRevision = required(revision, 'revision')
  const sourceRoot = join(resolve(projectRoot), '.spec', 'spexcode')
  const pages = walk(sourceRoot).map((absolutePath) => {
    const sourceBytes = readFileSync(absolutePath)
    const source = sourceBytes.toString('utf8')
    const sourcePath = relative(projectRoot, absolutePath).replaceAll('\\', '/')
    const sourceHash = sha256(sourceBytes)
    const parsed = frontmatter(source, sourcePath)
    const content = pageContent({ title: parsed.title, body: parsed.body, sourcePath, sourceHash })
    return {
      title: parsed.title,
      path: pagePath(sourceRoot, absolutePath),
      bytes: Buffer.byteLength(content, 'utf8'),
      sha256: sha256(Buffer.from(content, 'utf8')),
      content,
      source: { path: sourcePath, sha256: sourceHash, revision: sourceRevision },
    }
  })
  pages.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const seen = new Set()
  for (const page of pages) {
    if (seen.has(page.path)) fail(`duplicate Reference page path ${page.path}`)
    seen.add(page.path)
  }
  const payload = {
    schema: REFERENCE_SNAPSHOT_SCHEMA,
    payloadName: REFERENCE_SNAPSHOT_PAYLOAD_NAME,
    revision: sourceRevision,
    sourceRevision,
    provenance: { sourceRoot: '.spec/spexcode', pageCount: pages.length },
    pages,
    nav: navTree(pages),
  }
  return { ...payload, bundleHash: sha256(Buffer.from(JSON.stringify(payload), 'utf8')) }
}

export function serializeReferenceSnapshot(snapshot) {
  return Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
}

function parseArgs(argv) {
  if (argv.length !== 4 || argv[0] !== '--out' || argv[2] !== '--revision') fail('usage: --out <file> --revision <revision>')
  return { out: required(argv[1], '--out'), revision: required(argv[3], '--revision') }
}

function main() {
  const { out, revision } = parseArgs(process.argv.slice(2))
  const snapshot = createReferenceSnapshot({ revision })
  const bytes = serializeReferenceSnapshot(snapshot)
  writeFileSync(out, bytes, { flag: 'wx' })
  process.stdout.write(`${out}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
