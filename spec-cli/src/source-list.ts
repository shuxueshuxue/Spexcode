import { readdirSync, statSync } from 'node:fs'
import { join, normalize, relative, sep } from 'node:path'
import { isSourceFile, type SourcePolicy } from './source-files.js'
import { SourceReadError } from './source-read.js'

// The LISTING half of the governed-source surface. `source-read` opens one file; this names what is there
// to open, one directory at a time, so a reader can browse the project the way any editor lets them browse
// it instead of having to already know a path.
//
// @@@ one gate, not a second definition - a FILE appears here exactly when `isSourceFile` would let
// `/api/source` open it. That is the whole reason this shares the predicate rather than growing a listing
// policy of its own: a row the reader clicks and gets a 404 from is worse than a row that was never drawn,
// and two predicates that agree today are two predicates free to disagree tomorrow.

// Bounded like [[node-attachments]]'s walk, and for the same reason: a directory that has accumulated ten
// thousand generated files should degrade into a long list rather than a wedged read. Unlike that walk this
// one is ONE level deep — the client expands a level at a time — so a depth cap would be a cap on a
// recursion that does not exist here; the bound that matters is the entry count.
export const SOURCE_LIST_MAX_ENTRIES = 500

// Directories that are never the project's own code and would drown the listing they appear in. This is a
// listing-hygiene rule and it is deliberately NAMED rather than derived: `isSourceFile` has no opinion about
// a directory, and with no include globs configured it would happily admit a dependency's shipped `.js`.
// Keeping the list short and explicit is the honest form — a file inside one of these is still readable by
// direct address if the policy admits it; it simply is not offered as something to browse.
const SKIP_DIRS = new Set(['.git', 'node_modules'])
const skipDir = (name: string) => SKIP_DIRS.has(name) || name.startsWith('.')

export type SourceDirEntry = {
  name: string                 // the entry's own name, for the row
  path: string                 // repo-relative, for `#/file/<path>` or the next listing
  kind: 'dir' | 'file'
}

export type SourceListing = {
  dir: string                  // the repo-relative directory listed; '' is the governed-roots level
  entries: SourceDirEntry[]
  truncated: boolean           // the cap clipped this listing — said out loud, never silently
}

// Repo-relative, worktree-contained, or a loud 400. Containment is checked by RESOLVING and comparing, not
// by pattern-matching the string: a `..` that normalises back inside is legitimate, one that escapes is not,
// and an absolute path is refused outright because `join` would silently reinterpret it as relative and hand
// the caller a confusing answer about a path they did not mean.
function resolveDir(root: string, dir: string): { rel: string; full: string } {
  const raw = String(dir || '')
  if (!raw || raw === '.') return { rel: '', full: root }
  if (raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw))
    throw new SourceReadError(`dir must be repo-relative and inside the worktree: ${dir}`, 400)
  const rel = normalize(raw).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  const full = normalize(join(root, rel))
  const back = relative(root, full)
  if (rel === '..' || rel.startsWith('../') || back.startsWith('..') || back.split(sep).some((s) => s === '..'))
    throw new SourceReadError(`dir must be repo-relative and inside the worktree: ${dir}`, 400)
  return { rel, full }
}

// A directory is browsable when it lies inside a governed root, or CONTAINS one — the second case is what
// makes `governedRoots: ['spec-cli/src']` reachable at all, since every ancestor on the way down to it is
// outside every root while still being the only path there. `.` as a root means the whole project, which
// makes every directory inside.
const withinGovernedRoots = (rel: string, roots: string[]) => roots.some((raw) => {
  const root = String(raw || '').replace(/\/+$/, '').replace(/^\.\//, '')
  if (!root || root === '.') return true
  if (!rel) return true
  return rel === root || rel.startsWith(`${root}/`) || root.startsWith(`${rel}/`)
})

// One level of a governed directory. The roots themselves are the listing at `dir: ''`, so the tree has a
// top without the client having to know the config — it asks for the same thing at every level.
export function listSourceDir(root: string, dir: string, policy: SourcePolicy, governedRoots: string[]): SourceListing {
  const { rel, full } = resolveDir(root, dir)
  if (!withinGovernedRoots(rel, governedRoots))
    throw new SourceReadError(`not inside this project's governed roots: ${rel}`, 404)

  let names: string[]
  try {
    names = readdirSync(full)
  } catch (e: any) {
    // the CODE, never the message — Node puts the absolute host path into the exception text and these
    // strings are API responses ([[source-read]]).
    throw new SourceReadError(`cannot list ${rel || '.'}: ${e?.code ?? 'read failed'}`, 404)
  }

  const dirs: SourceDirEntry[] = []
  const files: SourceDirEntry[] = []
  let truncated = false
  for (const name of names.sort()) {
    if (dirs.length + files.length >= SOURCE_LIST_MAX_ENTRIES) { truncated = true; break }
    const path = rel ? `${rel}/${name}` : name
    let st
    // a vanishing entry mid-listing is skipped, never thrown out of the endpoint.
    try { st = statSync(join(full, name)) } catch { continue }
    if (st.isDirectory()) {
      if (skipDir(name) || !withinGovernedRoots(path, governedRoots)) continue
      dirs.push({ name, path, kind: 'dir' })
      continue
    }
    if (!isSourceFile(root, path, policy)) continue
    files.push({ name, path, kind: 'file' })
  }
  // directories first, then files, each already alphabetical — the order every file browser uses, decided
  // here rather than in the client so two clients cannot sort one listing two ways.
  return { dir: rel, entries: [...dirs, ...files], truncated }
}
