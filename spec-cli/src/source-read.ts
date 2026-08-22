import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { isSourceFile, type SourcePolicy } from './source-files.js'

// A source read is a WINDOW over a file, never the whole file. The viewer asks for a byte range and gets
// back that slice plus the file's total size, so the first paint of a 40 MB file costs the same as a 4 KB
// one and the client decides how much more to pull. Whole-file delivery is not an option that exists here:
// it is the shape that has to be walked back once a repository contains one generated bundle.
export const SOURCE_SLICE_MAX_BYTES = 256 * 1024

export class SourceReadError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'SourceReadError'
    this.status = status
  }
}

export type SourceSlice = {
  path: string      // the repo-relative path, as resolved
  size: number      // the file's TOTAL byte length — the client's scroll extent
  offset: number    // where this slice starts, in bytes
  bytes: number     // how many bytes this slice consumed; the next offset is offset + bytes
  text: string      // the decoded slice
  eof: boolean      // offset + bytes reached the end of the file
}

// @@@ one gate, not a second definition - a file is readable here exactly when the lint/coverage walk
// would call it a source file. Sharing `isSourceFile` means "what the product will show you" and "what the
// product will govern" can never drift apart into two answers.
function resolveGoverned(root: string, path: string, policy: SourcePolicy): string {
  if (!path) throw new SourceReadError('path is required', 400)
  const rel = normalize(path).replace(/\\/g, '/').replace(/^\.\//, '')
  if (rel.startsWith('/') || rel === '..' || rel.startsWith('../'))
    throw new SourceReadError(`path must be repo-relative and inside the worktree: ${path}`, 400)
  if (!isSourceFile(root, rel, policy))
    throw new SourceReadError(`not a readable source file under this project's source policy: ${rel}`, 404)
  return join(root, rel)
}

// Snap the slice to the last newline it contains. A byte window cut mid-line would also cut mid-codepoint,
// so the viewer would render a replacement char and a half row that the next slice repeats. Reporting the
// SNAPPED length as `bytes` keeps the client's cursor arithmetic honest: it always resumes on a line start.
// The final slice of a file is returned whole — there is no following slice to hand the remainder to.
function snapToLine(buf: Buffer, atEof: boolean): Buffer {
  if (atEof) return buf
  const cut = buf.lastIndexOf(0x0a)
  if (cut < 0) return buf     // a single line longer than the window: hand it over and let the client ask again
  return buf.subarray(0, cut + 1)
}

export function readSourceSlice(
  root: string,
  path: string,
  policy: SourcePolicy,
  offset = 0,
  limit = SOURCE_SLICE_MAX_BYTES,
): SourceSlice {
  const rel = normalize(path).replace(/\\/g, '/').replace(/^\.\//, '')
  const full = resolveGoverned(root, path, policy)
  const start = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0
  const want = Math.min(Math.max(Math.floor(Number.isFinite(limit) ? limit : 0), 1), SOURCE_SLICE_MAX_BYTES)

  let fd: number | null = null
  try {
    fd = openSync(full, 'r')
    const size = fstatSync(fd).size
    if (start >= size) return { path: rel, size, offset: start, bytes: 0, text: '', eof: true }
    const raw = Buffer.allocUnsafe(Math.min(want, size - start))
    const read = readSync(fd, raw, 0, raw.length, start)
    const slice = snapToLine(raw.subarray(0, read), start + read >= size)
    return {
      path: rel,
      size,
      offset: start,
      bytes: slice.length,
      text: slice.toString('utf8'),
      eof: start + slice.length >= size,
    }
  } catch (e: any) {
    if (e instanceof SourceReadError) throw e
    throw new SourceReadError(`cannot read ${rel}: ${e?.message ?? e}`, 404)
  } finally {
    if (fd !== null) closeSync(fd)
  }
}
