import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { gitA, loadSpecs, repoRoot, specDir } from '@spexcode/spec-core'
import { DIAGRAM_TYPES, checkDiagram, diagramHtml, renderDiagram } from '@spexcode/archify'
import { diagramTreeFindings, type Finding } from './lint.js'

// [[diagram-cli]]: the author's side of [[diagram]]. `scaffold` writes a node's diagram.json to start from, and
// `check` judges it the way everything downstream will — archify draws it and runs its final-artifact check, and
// the two tree rules the commit gate enforces run on the same node — printing every problem with the fix archify
// suggests. Together with `spex guide diagram` they are the whole loop an agent with no other context needs.

const USAGE = `usage: spex diagram scaffold <node> [--type ${DIAGRAM_TYPES.join('|')}] [--force]
       spex diagram check <node> [--html <file>] [--json]`

// An author's mistake (unknown node, missing file, bad flag) is a message and exit 2; anything else is a bug and
// keeps its stack.
class DiagramCliError extends Error {}

type Args = { verb?: string; node?: string; type: string; force: boolean; html: string | null; json: boolean }
function parse(argv: string[]): Args {
  const args: Args = { verb: argv[0], type: 'architecture', force: false, html: null, json: false }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--force') args.force = true
    else if (a === '--json') args.json = true
    else if (a === '--type') args.type = argv[++i] ?? ''
    else if (a === '--html') args.html = argv[++i] ?? ''
    else if (a.startsWith('--')) throw new DiagramCliError(`unknown flag ${a}\n${USAGE}`)
    else if (args.node === undefined) args.node = a
    else throw new DiagramCliError(`unexpected argument ${a}\n${USAGE}`)
  }
  return args
}

function nodeFolder(id: string | undefined): { root: string; dir: string; file: string } {
  if (!id) throw new DiagramCliError(USAGE)
  const dir = specDir(id)
  if (!dir) throw new DiagramCliError(`no spec node '${id}' — find its id with: spex spec search <topic>`)
  return { root: repoRoot(), dir, file: `${dir}/diagram.json` }
}

// Cited sources are verified against a pinned commit of a public repository, and archify knows two hosts. On any
// other origin the scaffold leaves sources out rather than write evidence nothing can verify.
async function publicRepository(root: string): Promise<{ url: string; revision: string } | null> {
  const origin = (await gitA(['-C', root, 'remote', 'get-url', 'origin'])).trim()
  const m = origin.match(/(github\.com|gitee\.com)[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/)
  const revision = (await gitA(['-C', root, 'rev-parse', 'HEAD'])).trim()
  return m && revision ? { url: `https://${m[1]}/${m[2]}/${m[3]}`, revision } : null
}

function example(type: string): Record<string, unknown> {
  const pkg = dirname(createRequire(import.meta.url).resolve('@spexcode/archify/package.json'))
  const name = readdirSync(join(pkg, 'examples')).find((f) => f.endsWith(`.${type}.json`))
  if (!name) throw new DiagramCliError(`archify ships no ${type} example`)
  return JSON.parse(readFileSync(join(pkg, 'examples', name), 'utf8'))
}

async function scaffold(args: Args): Promise<number> {
  const { root, file } = nodeFolder(args.node)
  if (!(DIAGRAM_TYPES as readonly string[]).includes(args.type)) throw new DiagramCliError(`--type must be one of ${DIAGRAM_TYPES.join(', ')}`)
  if (existsSync(join(root, file)) && !args.force) throw new DiagramCliError(`${file} already exists — edit it, or pass --force to start over`)
  const specs = await loadSpecs(root, { history: null, drift: null })
  const node = specs.find((s) => s.id === args.node)!
  let ir: Record<string, unknown>
  let receipt: string
  if (args.type === 'architecture') {
    const children = specs.filter((s) => s.parent === node.id)
    if (!children.length) throw new DiagramCliError(`'${node.id}' has no children — an architecture diagram draws a node's children; choose another --type`)
    const repository = await publicRepository(root)
    // A plain grid every box fits in: the author moves boxes, archify's check says when the layout reads.
    const cols = Math.ceil(Math.sqrt(children.length))
    ir = {
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: node.title, ...(repository ? { repository } : {}) },
      components: children.map((child, i) => ({
        id: child.id,
        type: 'backend',
        label: child.id,
        pos: [40 + (i % cols) * 230, 60 + Math.floor(i / cols) * 120],
        size: [180, 64],
        ...(repository ? { sources: [{ path: child.path, label: 'spec' }, ...(child.code[0] ? [{ path: child.code[0], label: 'code' }] : [])] } : {}),
      })),
      connections: [],
    }
    receipt = `${children.length} boxes, one per child of '${node.id}'` + (repository
      ? `, each citing its spec and governed file; revision pinned to ${repository.revision.slice(0, 9)}`
      : ' — no sources: the origin is not a GitHub or Gitee repository, so they could not be verified')
  } else {
    ir = example(args.type)
    ir.meta = { ...(ir.meta as object), title: node.title }
    receipt = `archify's ${args.type} example with this node's title — replace its content with this node's`
  }
  writeFileSync(join(root, file), `${JSON.stringify(ir, null, 2)}\n`)
  console.log(`wrote ${file} (${args.type}): ${receipt}\nnext: edit it — spex guide diagram has the format — then: spex diagram check ${node.id}`)
  return 0
}

type Diagnostic = { code?: string; message: string; supportedFixes?: unknown }
async function check(args: Args): Promise<number> {
  const { root, file } = nodeFolder(args.node)
  const report = (lines: string[], ok: boolean, json: object) => {
    console.log(args.json ? JSON.stringify({ file, ok, ...json }) : lines.join('\n'))
    return ok ? 0 : 1
  }
  if (!existsSync(join(root, file))) return report([`${file} does not exist — start one with: spex diagram scaffold ${args.node}`], false, { error: 'missing' })
  let ir: { diagram_type?: unknown; components?: unknown }
  try { ir = JSON.parse(readFileSync(join(root, file), 'utf8')) } catch (e) {
    return report([`✗ ${file} is not JSON: ${(e as Error).message}`], false, { error: `not JSON: ${(e as Error).message}` })
  }
  const type = typeof ir?.diagram_type === 'string' ? ir.diagram_type : null
  if (!type || !(DIAGRAM_TYPES as readonly string[]).includes(type))
    return report([`✗ ${file}: diagram_type must be one of ${DIAGRAM_TYPES.join(', ')}`], false, { error: 'diagram_type' })
  const drawn = await checkDiagram(type, ir, { repoRoot: root })
  const specs = await loadSpecs(root, { history: null, drift: null })
  const specPaths = new Set(specs.map((s) => s.path))
  const governed = new Set(specs.flatMap((s) => s.code))
  const children = specs.filter((s) => s.parent === args.node).map((s) => s.id)
  const tree: Finding[] = diagramTreeFindings(args.node!, file, ir, children, (path) => specPaths.has(path) || governed.has(path))
  const lines = [`spex diagram check ${args.node} — ${file} (${type})`]
  if (drawn.ok) lines.push(`  ✓ archify draws it and its final-artifact check passes (${drawn.checks.length} checks)`)
  else {
    lines.push(`  ✗ archify (${drawn.stage}): ${drawn.error}`)
    for (const d of drawn.diagnostics as Diagnostic[]) {
      lines.push(`      ${d.code ?? 'diagnostic'}  ${d.message}`)
      for (const fix of Array.isArray(d.supportedFixes) ? d.supportedFixes : []) lines.push(`        fix: ${typeof fix === 'string' ? fix : JSON.stringify(fix)}`)
    }
  }
  if (type === 'architecture' && !tree.length) lines.push(`  ✓ every box is a child of '${args.node}' (or others), and every cited source is a spec or a governed file`)
  for (const f of tree) lines.push(`  ✗ ${f.rule}: ${f.msg}`)
  if (args.html) {
    const out = resolve(args.html)
    if (drawn.ok || drawn.stage === 'check') {
      writeFileSync(out, diagramHtml(await renderDiagram(type, ir, { repoRoot: root })))
      lines.push(`  wrote the viewer page: ${out}`)
    } else lines.push('  no viewer page: the diagram does not draw yet')
  }
  return report(lines, drawn.ok && !tree.length, { type, archify: drawn, tree })
}

export async function runDiagram(argv: string[]): Promise<number> {
  try {
    const args = parse(argv)
    if (args.verb === 'scaffold') return await scaffold(args)
    if (args.verb === 'check') return await check(args)
    throw new DiagramCliError(`unknown verb '${args.verb}'\n${USAGE}`)
  } catch (e) {
    if (!(e instanceof DiagramCliError)) throw e
    console.error(`spex diagram: ${e.message}`)
    return 2
  }
}
