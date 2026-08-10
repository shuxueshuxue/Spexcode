import { loadSpecs, repoRoot, resolveProjectIdentity, gitA } from '@spexcode/spec-core'

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
  const documents = Object.freeze(nodes
    .map((node) => Object.freeze({
      schema: 'spexcode.public-spec-document/v1' as const,
      revision,
      id: node.id,
      body: node.body,
      parts: node.parts,
    }))
    .sort((a, b) => a.id.localeCompare(b.id)))
  return Object.freeze({ graph, documents })
}

export async function buildPublicGraph(): Promise<PublicGraph> {
  return (await buildPublicGraphArtifact()).graph
}

export function publicGraphJson(graph: PublicGraph): string {
  return `${JSON.stringify(graph, null, 2)}\n`
}
