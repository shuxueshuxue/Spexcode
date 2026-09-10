import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot, specDir } from '@spexcode/spec-core'
import { DIAGRAM_TYPES, DiagramError, renderDiagram } from '@spexcode/archify'

// [[diagram]]'s reader: a node's `diagram.json`, rendered in-process by [[archify]] into the SVG the dashboard
// shows inline above the body. The node's content carries the result, so the live board and the published graph
// read one field the same way — a picture, or the reason there is none.
export type SpecDiagram =
  | { file: string; type: string; svg: string; note: string | null }
  | { file: string; type: string | null; error: string; diagnostics: { code: string | null; message: string }[] }

// One fixed name, so a node has at most one diagram. The type is not in the name: every archify IR states its
// own `diagram_type`, and a second copy of that fact could only disagree with the first.
const DIAGRAM_FILE = 'diagram.json'

// The reader draws the picture only: source evidence is not verified on read (that needs the repository's origin,
// the pinned commit and every cited file — an authoring check), and the SVG does not depend on it. So rendering is
// a pure function of the IR text, and one entry per file content is the whole cache: an edited IR is a new key,
// an unchanged one renders once per process.
const rendered = new Map<string, SpecDiagram>()

async function render(file: string, text: string): Promise<SpecDiagram> {
  let ir: unknown
  try { ir = JSON.parse(text) } catch (e) { return { file, type: null, error: `not JSON: ${(e as Error).message}`, diagnostics: [] } }
  const declared = (ir as { diagram_type?: unknown } | null)?.diagram_type
  const type = typeof declared === 'string' ? declared : null
  const fail = (error: string, diagnostics: { code: string | null; message: string }[] = []): SpecDiagram =>
    ({ file, type, error, diagnostics })
  if (type === null || !(DIAGRAM_TYPES as readonly string[]).includes(type))
    return fail(`diagram_type must be one of ${DIAGRAM_TYPES.join(', ')}${type === null ? '' : ` — this file says "${type}"`}`)
  try {
    const parts = await renderDiagram(type, ir, { evidence: false })
    return { file, type, svg: parts.svg, note: typeof parts.meta?.note === 'string' ? parts.meta.note : null }
  } catch (e) {
    if (e instanceof DiagramError) return fail(e.message, e.diagnostics.map((d) => ({ code: d.code ?? null, message: d.message })))
    // A renderer crash is archify's bug, not the author's — but it must not take the node's document down
    // with it, so it is reported in the diagram's own slot (and logged with its stack).
    console.error(`[diagram] ${file}:`, e)
    return fail(`archify crashed while drawing this diagram: ${(e as Error).message}`)
  }
}

// null when the node has no diagram (or is not a node).
export async function specDiagram(id: string, root: string = repoRoot()): Promise<SpecDiagram | null> {
  const dir = specDir(id)
  if (!dir) return null
  const file = `${dir}/${DIAGRAM_FILE}`
  if (!existsSync(join(root, file))) return null
  const text = readFileSync(join(root, file), 'utf8')
  const key = `${file}\0${createHash('sha256').update(text).digest('hex')}`
  const hit = rendered.get(key)
  if (hit) return hit
  const result = await render(file, text)
  rendered.set(key, result)
  return result
}
