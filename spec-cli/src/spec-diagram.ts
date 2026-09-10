import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot, specDir } from '@spexcode/spec-core'
import { DIAGRAM_TYPES, DiagramError, renderDiagram } from '@spexcode/archify'

// [[diagram]]'s reader: a node's `diagram.<type>.json`, rendered in-process by [[archify]] into the SVG the
// dashboard shows inline above the body. The node's content carries the result, so the live board and the
// published graph read one field the same way — a picture, or the reason there is none.
export type SpecDiagram =
  | { file: string; type: string; svg: string; note: string | null }
  | { file: string; type: string; error: string; diagnostics: { code: string | null; message: string }[] }

const FILE = /^diagram\.([^.]+)\.json$/

// The reader draws the picture only: source evidence is not verified on read (that needs the repository's origin,
// the pinned commit and every cited file — an authoring check), and the SVG does not depend on it. So rendering is
// a pure function of the IR text, and one entry per file content is the whole cache: an edited IR is a new key,
// an unchanged one renders once per process.
const rendered = new Map<string, SpecDiagram>()

async function render(file: string, type: string, text: string): Promise<SpecDiagram> {
  const fail = (error: string, diagnostics: { code: string | null; message: string }[] = []): SpecDiagram =>
    ({ file, type, error, diagnostics })
  if (!(DIAGRAM_TYPES as readonly string[]).includes(type)) return fail(`unknown diagram type "${type}" — one of ${DIAGRAM_TYPES.join(', ')}`)
  let ir: unknown
  try { ir = JSON.parse(text) } catch (e) { return fail(`not JSON: ${(e as Error).message}`) }
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

// null when the node has no diagram (or is not a node). A folder holding more than one diagram file is an
// error the reader shows, not a choice it makes.
export async function specDiagram(id: string, root: string = repoRoot()): Promise<SpecDiagram | null> {
  const dir = specDir(id)
  if (!dir) return null
  const names = readdirSync(join(root, dir)).filter((name) => FILE.test(name)).sort()
  if (!names.length) return null
  const file = `${dir}/${names[0]}`
  const type = names[0].match(FILE)![1]
  if (names.length > 1) return { file, type, error: `a node carries one diagram; this folder has ${names.join(', ')}`, diagnostics: [] }
  const text = readFileSync(join(root, file), 'utf8')
  const key = `${file}\0${createHash('sha256').update(text).digest('hex')}`
  const hit = rendered.get(key)
  if (hit) return hit
  const result = await render(file, type, text)
  rendered.set(key, result)
  return result
}
