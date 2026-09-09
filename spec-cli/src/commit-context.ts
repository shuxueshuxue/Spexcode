import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  git, gitTry, batchBlobTexts, parseFrontmatter, mintIds, parseCodeEntry, relationClaimsPath,
  extractors, extractorFor, extOf, resolveSelectors, type CodeEntry,
} from '@spexcode/spec-core'

const links = (ids: Iterable<string>): string => [...ids].map((id) => `[[${id}]]`).join(', ')
const sorted = (ids: Iterable<string>): string[] => [...new Set(ids)].sort()
const entries = (value: string | string[] | undefined): CodeEntry[] =>
  (Array.isArray(value) ? value : value ? [value] : []).map(parseCodeEntry)

export async function commitContext(messageFile: string): Promise<void> {
  const root = git(['rev-parse', '--show-toplevel']).trim()
  const run = (args: string[]): string => git(['-C', root, ...args])
  if (existsSync(run(['rev-parse', '--git-path', 'MERGE_HEAD']).trim())) return

  // @@@ candidate index - gitTry strips hook discovery env, then explicitly restores this index.
  // Snapshot once; every subsequent content read is immutable and cannot see unstaged worktree edits.
  const candidate = await gitTry(['-C', root, 'write-tree'], {
    indexFile: process.env.GIT_INDEX_FILE ? resolve(process.env.GIT_INDEX_FILE) : undefined,
  })
  if (!candidate.ok) throw new Error(candidate.stderr)
  const tree = candidate.stdout.trim()
  const head = await gitTry(['-C', root, 'rev-parse', '--verify', 'HEAD^{tree}'])
  let base = head.stdout.trim()
  if (!head.ok) {
    const empty = await gitTry(['-C', root, 'hash-object', '-t', 'tree', '--stdin'], { input: '' })
    if (!empty.ok) throw new Error(empty.stderr)
    base = empty.stdout.trim()
  }
  if (tree === base) return
  const diff = run(['diff', '--raw', '-z', '--patch', '--no-renames', '--no-ext-diff', '--no-textconv',
    '--no-color', '--unified=0', base, tree, '--'])
  // The NUL roster carries literal paths (including tabs, quotes and newlines). With renames disabled,
  // its order is the patch order; patch headers never have to be decoded as Git-quoted filenames.
  const boundary = diff.indexOf('\0\0')
  if (boundary < 0) throw new Error('commit-context: missing diff roster')
  const roster = diff.slice(0, boundary).split('\0')
  const patches = diff.slice(boundary + 2).split(/^diff --git /m).slice(1)
  const changed = Array.from({ length: roster.length / 2 }, (_, i) => ({
    path: roster[i * 2 + 1],
    deleted: roster[i * 2].endsWith(' D'),
    ranges: [...(patches[i] ?? '').matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)]
      .map((m): [number, number] => [Number(m[1]), Number(m[1]) + Math.max(Number(m[2] ?? 1), 1) - 1]),
  }))
  const files = run(['ls-tree', '-r', '-z', tree, '--', '.spec']).split('\0').flatMap((row) => {
    const match = row.match(/^\d+ blob ([0-9a-f]+)\t(\.spec\/[\s\S]+\/spec\.md)$/)
    return match ? [{ oid: match[1], path: match[2] }] : []
  })
  if (!files.length) return
  const blobs = await batchBlobTexts(root, files.map((f) => f.oid))
  const ids = mintIds(files.map(({ path }) => path.split('/').slice(1, -1)))
  const specs = files.map(({ path, oid }, i) => {
    const { fm } = parseFrontmatter(blobs.get(oid)!)
    return { id: ids[i], path, code: entries(fm.code), related: entries(fm.related) }
  })
  const versioned = sorted(specs.filter((s) => changed.some((c) => c.path === s.path)).map((s) => s.id))
  const governors = new Set<string>()
  const rows: string[] = []
  const registry = extractors(root)
  for (const file of changed) {
    if (file.path.startsWith('.spec/')) continue
    const claims = specs.map((s) => ({
      id: s.id,
      code: s.code.filter((e) => relationClaimsPath(e.path, file.path)),
      related: s.related.filter((e) => relationClaimsPath(e.path, file.path)),
    })).filter((s) => s.code.length || s.related.length)
    const gov = sorted(claims.filter((s) => s.code.length).map((s) => s.id))
    const context = sorted(claims.filter((s) => s.related.length).map((s) => s.id))
    gov.forEach((id) => governors.add(id))
    const anchored = claims.flatMap((s) => [...s.code, ...s.related]
      .filter((e) => e.anchor).map((e) => ({ id: s.id, selector: e.anchor! })))
    const hits: string[] = []
    let anchorNote = ''
    if (anchored.length && !file.deleted && file.ranges.length) {
      try {
        const extractor = extractorFor(registry, extOf(file.path))
        if (!extractor) throw new Error('no extractor')
        const ready = await extractor.ready()
        if (ready !== true) throw new Error(ready)
        const units = await extractor.extract(run(['show', `${tree}:${file.path}`]), file.path)
        for (const { id, selector } of anchored) {
          const [verdict] = resolveSelectors(units, [selector])
          if ('ok' in verdict && file.ranges.some(([a, b]) => b >= verdict.ok.start && a <= verdict.ok.end)) {
            hits.push(`[[${id}]]#${selector}`)
          }
        }
      } catch (error) {
        anchorNote = `  · anchors unavailable: ${(error as Error).message.replace(/\s+/g, ' ')}`
      }
    }
    rows.push(`  ${file.path}  ${gov.length ? `governed by ${links(gov)}` : claims.length ? '(no governor)' : '(unclaimed — coverage)'}`
      + (hits.length ? `  · touches ${sorted(hits).join(', ')}` : '')
      + (context.length ? `  · context: ${links(context.slice(0, 2))}${context.length > 2 ? ` (+${context.length - 2})` : ''}` : '')
      + anchorNote)
  }
  if (versioned.length) rows.push(`  re-versions ${links(versioned)}`)
  const untouched = sorted(governors).filter((id) => !versioned.includes(id))
  if (untouched.length) rows.push(`  governed code changed, spec untouched: ${links(untouched)} — still true?`)
  const trailer = sorted([...governors, ...versioned])
  const message = readFileSync(messageFile, 'utf8')
  if (trailer.length && !/^Spec:/im.test(message)) {
    if (!message.endsWith('\n')) writeFileSync(messageFile, `${message}\n`)
    run(['interpret-trailers', '--in-place', '--trailer', `Spec: ${trailer.join(', ')}`, resolve(messageFile)])
    rows.push(`  derived trailer → Spec: ${trailer.join(', ')}`)
  }
  if (rows.length) console.error(rows.join('\n'))
}
