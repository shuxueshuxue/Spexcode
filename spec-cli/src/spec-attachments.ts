import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, normalize, relative, sep } from 'node:path'
import { specDir } from '@spexcode/spec-core'
import { readSlice, SourceReadError, SOURCE_SLICE_MAX_BYTES, type SourceSlice } from './source-read.js'

// [[node-attachments]]: a spec node's folder is the unit, and until now the board could see exactly one
// file in it. Everything else a node carries — its eval contract, an evidence directory, a raw capture, a
// working note written beside the spec that cites it — existed on disk and nowhere in the product.
//
// This is deliberately NOT the governed-source surface. `/api/source` answers to the coverage policy, and
// that policy excludes `.spec/**` on purpose: the spec tree is the product's own data, not code it governs.
// Loosening that predicate to reach these files would have broken the one invariant that keeps "what the
// product shows" and "what the product governs" the same set. So the gate is different and the window read
// is shared — which is the right way round.

// Bounded so a node that accumulates an evidence dump degrades into a long list rather than a wedged read.
const MAX_ENTRIES = 500
const MAX_DEPTH = 4

// The two files with their own surfaces: the body IS the node's document, and readings ARE the eval
// timeline. Listing them here would offer a second, worse way to read what the board already renders well.
const OWN_SURFACE = new Set(['spec.md', 'evals.ndjson'])

export type NodeAttachment = { name: string; size: number }

function nodeRoot(root: string, id: string): string {
  const dir = specDir(id)
  if (!dir) throw new SourceReadError(`no such spec node: ${id}`, 404)
  return join(root, dir)
}

// Every read is confined to the node's own folder by RESOLVING and then checking containment, never by
// pattern-matching the input: a `..` that normalises back inside is fine, and one that escapes is caught
// wherever it came from.
function resolveInside(base: string, name: string): string {
  if (!name) throw new SourceReadError('name is required', 400)
  // An absolute name would be silently reinterpreted as relative by `join`. Containment would still hold,
  // but the caller would get a confusing 404 about a path it did not mean; refusing it says what happened.
  if (name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(name))
    throw new SourceReadError(`attachment name must be relative to the node's folder: ${name}`, 400)
  const full = normalize(join(base, name))
  const rel = relative(base, full)
  if (!rel || rel.startsWith('..') || rel.split(sep).some((s) => s === '..'))
    throw new SourceReadError(`attachment must stay inside the node's own folder: ${name}`, 400)
  if (OWN_SURFACE.has(rel.split(sep)[rel.split(sep).length - 1]) && !rel.includes(sep))
    throw new SourceReadError(`${rel} has its own surface in the dashboard, not an attachment`, 400)
  return full
}

export function listNodeAttachments(root: string, id: string): NodeAttachment[] {
  const base = nodeRoot(root, id)
  const out: NodeAttachment[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || out.length >= MAX_ENTRIES) return
    let entries: string[] = []
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries.sort()) {
      if (out.length >= MAX_ENTRIES) return
      const full = join(dir, entry)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) {
        // A node's folder ends where a CHILD node's folder begins. A directory holding a spec.md is another
        // node, and everything under it belongs to that node — listing it here would let a parent claim its
        // children's evidence and make the same file appear under several nodes.
        if (existsSync(join(full, 'spec.md'))) continue
        walk(full, depth + 1)
        continue
      }
      if (OWN_SURFACE.has(entry)) continue
      out.push({ name: relative(base, full).split(sep).join('/'), size: st.size })
    }
  }
  walk(base, 0)
  return out
}

export function readNodeAttachment(
  root: string,
  id: string,
  name: string,
  offset = 0,
  limit = SOURCE_SLICE_MAX_BYTES,
): SourceSlice {
  const base = nodeRoot(root, id)
  const full = resolveInside(base, name)
  return readSlice(full, name, offset, limit)
}
