import { loadSpecs, repoRoot, resolveProjectIdentity, gitA } from '@spexcode/spec-core'
import { specDiagram, type SpecDiagram } from './spec-diagram.js'

export const PUBLIC_GRAPH_SCHEMA = 'spexcode.public-spec-graph/v1' as const
export const PUBLIC_GRAPH_PAYLOAD_NAME = 'public-graph.json' as const

export type PublicGraphNode = Readonly<{
  id: string
  parent: string | null
  path: string
  title: string
  status: string
  fmStatus: string | null
  hue: number
  desc: string
  code: readonly string[]
  related: readonly string[]
  version: number
  lastEdited: string | null
  drift: number
  driftFiles: readonly { file: string; behind: number }[]
}>

export type PublicGraph = Readonly<{
  schema: typeof PUBLIC_GRAPH_SCHEMA
  payloadName: typeof PUBLIC_GRAPH_PAYLOAD_NAME
  revision: string
  sourceRoot: string
  identity: Readonly<{ title: string; icon: string }>
  nodes: readonly PublicGraphNode[]
}>

export type PublicGraphDocument = Readonly<{
  schema: 'spexcode.public-spec-document/v1'
  revision: string
  id: string
  body: string
  parts: unknown
  diagram: SpecDiagram | null
}>

export type PublicGraphArtifact = Readonly<{
  graph: PublicGraph
  documents: readonly PublicGraphDocument[]
}>

function stableNode(node: Awaited<ReturnType<typeof loadSpecs>>[number]): PublicGraphNode {
  return {
    id: node.id,
    parent: node.parent,
    path: node.path,
    title: node.title,
    status: node.status,
    fmStatus: node.fmStatus,
    hue: node.hue,
    desc: node.desc,
    code: [...node.code],
    related: [...node.related],
    version: node.version,
    lastEdited: node.lastEdited,
    drift: node.drift,
    driftFiles: node.driftFiles.map((entry) => ({ file: entry.file, behind: entry.behind })),
  }
}

export async function buildPublicGraphArtifact(): Promise<PublicGraphArtifact> {
  const root = repoRoot()
  const [nodes, revision] = await Promise.all([
    loadSpecs(root),
    gitA(['-C', root, 'rev-parse', 'HEAD']).then((value) => value.trim()),
  ])
  if (!revision) throw new Error('public graph cannot be published without a Git revision')
  const identity = resolveProjectIdentity(root, root)
  const graph = Object.freeze({
    schema: PUBLIC_GRAPH_SCHEMA,
    payloadName: PUBLIC_GRAPH_PAYLOAD_NAME,
    revision,
    // A public artifact must be relocatable and must not disclose its producer's checkout layout.
    sourceRoot: '.',
    identity: Object.freeze({ title: identity.title, icon: identity.icon }),
    nodes: Object.freeze(nodes.map(stableNode).sort((a, b) => a.path.localeCompare(b.path))),
  })
  // The static document carries the same rendered diagram the live content endpoint serves ([[diagram]]), so a
  // published tree shows the picture with no backend and no renderer in the browser.
  const documents = Object.freeze((await Promise.all(nodes.map(async (node) => Object.freeze({
    schema: 'spexcode.public-spec-document/v1' as const,
    revision,
    id: node.id,
    body: node.body,
    parts: node.parts,
    diagram: await specDiagram(node.id, root),
  }))))
    .sort((a, b) => a.id.localeCompare(b.id)))
  return Object.freeze({ graph, documents })
}

export async function buildPublicGraph(): Promise<PublicGraph> {
  return (await buildPublicGraphArtifact()).graph
}

export function publicGraphJson(graph: PublicGraph): string {
  return `${JSON.stringify(graph, null, 2)}\n`
}

export const PUBLIC_PAYLOAD_ELEMENT_ID = 'spexcode-public-payload' as const

// One self-contained page: the public shell built as a single file, with the index, every node document and
// the About panel's record written into it. A browser opening a file from disk refuses to fetch the file beside
// it, so a page that has to survive being handed around as one file — a workflow artifact, an attachment —
// carries its payload instead of pointing at it ([[public-spec-graph]]).
export function publicGraphHtml(shell: string, artifact: PublicGraphArtifact): string {
  const { graph, documents } = artifact
  const payload = {
    graph,
    documents: Object.fromEntries(documents.map((document) => [document.id, document])),
    metadata: {
      schema: 'spexcode.public-spec-site/v1',
      publication: { id: graph.identity.title },
      about: {
        title: 'About this page',
        summary: 'A static, read-only view of this repository\'s specification graph, written into one file by `spex graph --public --html`. It carries committed spec intent and relationships only; sessions, issues, evaluations, settings, and write routes are absent.',
        facts: [{ label: 'Project', value: graph.identity.title }],
      },
      release: { revision: graph.revision },
    },
  }
  // `<` never appears raw inside the element, so no string in any spec body can close it early.
  const element = `<script type="application/json" id="${PUBLIC_PAYLOAD_ELEMENT_ID}">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>`
  const close = headClose(shell)
  if (close < 0) throw new Error('public graph page: the single-file shell has no </head>')
  return `${shell.slice(0, close)}${element}\n${shell.slice(close)}`
}

// Where the shell's head really closes. The single-file build inlines the whole dashboard bundle, so most
// HTML landmarks in that file are a program's DATA rather than its markup — the widget runtime builds an
// iframe document out of a template literal that spells `</head><body>`, a megabyte before the page's own
// head ends. Splicing at the first textual match lands inside that string and tears the inlined <script>
// in half: the browser ends the bundle at the injected element's `</script>`, spills the rest of the
// program into the page as visible text, and nothing runs. So read the file the way a browser does — a
// script element runs to its first `</script`, and only a landmark outside every such span is markup.
function headClose(shell: string): number {
  for (let at = 0; ; ) {
    const head = shell.indexOf('</head>', at)
    const open = shell.indexOf('<script', at)
    if (head >= 0 && (open < 0 || head < open)) return head
    if (open < 0) return -1
    const end = shell.indexOf('</script', open)
    if (end < 0) return -1
    at = end + '</script'.length
  }
}
