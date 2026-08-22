import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter, repoRoot, specDir, gitTry } from '@spexcode/spec-core'

// [[spec-body-edit]]: the one seam through which a human at the board edits a spec BODY and lands it as a
// real commit — the "edit this file on the web" affordance, held to this project's law rather than
// GitHub's.
//
// Four structural guarantees, each enforced by construction rather than by checking a request field:
//
//  1. ONLY A SPEC BODY. The target file is DERIVED from the node id through the spec tree's own reader, so
//     no request can name a path; and only the region between the frontmatter and the end of the file is
//     rewritten, so no request can move a `code:` anchor, a status, or a single byte of source.
//  2. ONLY THE REGION THE READER SAW. The caller sends back the exact lines it rendered. If the file has
//     moved underneath them the write is REFUSED with the current text — never merged, never guessed. Every
//     such precondition is checked while the tree is still untouched, so a refusal costs nothing.
//  3. THE GATES STAY UP. The commit opens exactly ONE door in [[main-guard]] — `SPEXCODE_ALLOW_MAIN`, the
//     named escape hatch — and never `--no-verify`. The neighbouring programmatic writers ([[local-issues]],
//     [[human-ok]]) may skip the hook because their paths are unanchored DATA; a `spec.md` is the contract
//     itself, so it must pass the same spec-lint gate a session's commit passes. A refusal is reported
//     verbatim, with the tree put back the way it was found.
//  4. NOTHING IS STORED. The commit is the whole record: [[source-of-truth]] recomputes the node's version
//     from its count of content commits, so the version bumps and drift re-derives with no extra bookkeeping.

export class SpecBodyEditError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409, readonly code: string, readonly detail?: Record<string, unknown>) {
    super(message)
  }
}

export type SpecBodyEdit = {
  startLine: number
  endLine: number
  original: string
  replacement: string
  reason?: string
}

export type SpecBodyEditResult = {
  ok: true
  changed: boolean
  path: string
  commit: string | null
  startLine: number
  endLine: number
}

// The body a line number addresses is the TRIMMED body — the same text `/api/specs/:id/content` serves and
// the same text the reader's line stamps were computed against. The file's leading and trailing whitespace
// is held aside and put back untouched, so an edit changes the region and nothing else in the file.
function splitFile(source: string) {
  const { body } = parseFrontmatter(source)
  const head = source.slice(0, source.length - body.length)
  const lead = body.length - body.trimStart().length
  const trimmed = body.trim()
  return { prefix: head + body.slice(0, lead), trimmed, suffix: body.slice(lead + trimmed.length) }
}

const isInt = (v: unknown): v is number => Number.isInteger(v)

export function readSpecBodyEdit(raw: unknown): SpecBodyEdit {
  const b = (raw ?? {}) as Record<string, unknown>
  if (!isInt(b.startLine) || !isInt(b.endLine) || (b.startLine as number) < 1 || (b.endLine as number) < (b.startLine as number)) {
    throw new SpecBodyEditError('body needs a 1-based line range { startLine, endLine } with endLine >= startLine', 400, 'bad-range')
  }
  if (typeof b.original !== 'string' || typeof b.replacement !== 'string') {
    throw new SpecBodyEditError('body needs { original, replacement } — the text the reader saw and the text to put in its place', 400, 'bad-text')
  }
  return {
    startLine: b.startLine as number,
    endLine: b.endLine as number,
    original: b.original,
    replacement: b.replacement,
    ...(typeof b.reason === 'string' && b.reason.trim() ? { reason: b.reason.trim() } : {}),
  }
}

export async function editSpecBody(id: string, patch: SpecBodyEdit): Promise<SpecBodyEditResult> {
  const root = repoRoot()
  const dir = specDir(id)
  if (!dir) throw new SpecBodyEditError(`no such spec node: ${id}`, 404, 'no-node')
  // guarantee 1, made structural: the path came from the spec tree, and it must still look like one. A
  // node whose folder resolved outside `.spec/` is a broken tree, not an edit target.
  const relPath = `${dir}/spec.md`
  if (!relPath.startsWith('.spec/') || !relPath.endsWith('/spec.md') || relPath.includes('..')) {
    throw new SpecBodyEditError(`node ${id} does not resolve to a spec body inside .spec/`, 404, 'no-node')
  }
  const file = join(root, relPath)
  if (!existsSync(file)) throw new SpecBodyEditError(`node ${id} has no spec.md on disk`, 404, 'no-node')

  const source = readFileSync(file, 'utf8')
  const { prefix, trimmed, suffix } = splitFile(source)
  const lines = trimmed.split('\n')
  if (patch.endLine > lines.length) {
    throw new SpecBodyEditError(`lines ${patch.startLine}-${patch.endLine} run past the end of the body (${lines.length} lines)`, 409, 'stale-region', { bodyLines: lines.length })
  }
  // guarantee 2. The reader's copy of the region is the precondition; a mismatch is a CONCURRENT MODIFICATION,
  // reported with the text that is actually there so the human can see what moved.
  const current = lines.slice(patch.startLine - 1, patch.endLine).join('\n')
  if (current !== patch.original) {
    throw new SpecBodyEditError(
      `lines ${patch.startLine}-${patch.endLine} of ${relPath} changed since they were read — the edit was not applied`,
      409, 'stale-region', { current },
    )
  }

  const next = prefix + [...lines.slice(0, patch.startLine - 1), ...patch.replacement.split('\n'), ...lines.slice(patch.endLine)].join('\n') + suffix
  if (next === source) return { ok: true, changed: false, path: relPath, commit: null, startLine: patch.startLine, endLine: patch.endLine }

  // Everything above is read-only, and deliberately: the caller gets the diagnosis that is actually about
  // their edit before the tree's state is allowed to have an opinion. Only a real write needs a clean index
  // — a path already carrying a STAGED change belongs to whoever staged it, and committing here would sweep
  // their work into this edit's commit, so it refuses rather than guess whose change it is.
  const staged = await gitTry(['-C', root, 'diff', '--cached', '--name-only', '--', relPath])
  if (staged.ok && staged.stdout.trim()) {
    throw new SpecBodyEditError(`${relPath} already has a staged change — commit or unstage it before editing here`, 409, 'staged-conflict')
  }

  writeFileSync(file, next)
  const restore = () => {
    writeFileSync(file, source)
    return gitTry(['-C', root, 'reset', '--quiet', '--', relPath])
  }

  const message = [
    `spec: ${id} — edited at the board`,
    '',
    `Body lines ${patch.startLine}-${patch.endLine} replaced through the dashboard's spec editor ([[spec-body-edit]]).`,
    ...(patch.reason ? ['', patch.reason] : []),
    '',
    // Server-derived, exactly as [[human-ok]] derives its actor: the identity of a board edit is the person
    // at the board, and no request body gets to claim to be someone else.
    'Session: human',
  ].join('\n')

  const add = await gitTry(['-C', root, 'add', '--', relPath])
  if (!add.ok) {
    await restore()
    throw new SpecBodyEditError(`git could not stage ${relPath}: ${add.stderr.trim() || 'unknown failure'}`, 409, 'git-failed')
  }
  // guarantee 3: the ONE named door. `SPEXCODE_ALLOW_MAIN` waives only the main-authoring guard, so the
  // spec-lint shim and the reference-transaction candidate gate both still judge this commit. On a
  // node branch the flag changes nothing at all — the same call works from either checkout.
  const commit = await gitTry(['-C', root, 'commit', '--quiet', '-m', message, '--', relPath], {
    extraEnv: { SPEXCODE_ALLOW_MAIN: '1' },
  })
  if (!commit.ok) {
    await restore()
    const why = [commit.stderr, commit.stdout].map((s) => s.trim()).filter(Boolean).join('\n') || 'git commit failed with no output'
    throw new SpecBodyEditError(`the commit was refused, so ${relPath} was put back unchanged:\n${why}`, 409, 'commit-refused')
  }
  const head = await gitTry(['-C', root, 'rev-parse', 'HEAD'])
  return {
    ok: true,
    changed: true,
    path: relPath,
    commit: head.ok ? head.stdout.trim() : null,
    startLine: patch.startLine,
    endLine: patch.startLine + patch.replacement.split('\n').length - 1,
  }
}
