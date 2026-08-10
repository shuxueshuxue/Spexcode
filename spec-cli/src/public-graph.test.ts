import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPublicGraphArtifact, PUBLIC_GRAPH_PAYLOAD_NAME, PUBLIC_GRAPH_SCHEMA, publicGraphJson } from './public-graph.js'

test('public graph is deterministic, relocatable, and has no live control-plane projection', async () => {
  const first = await buildPublicGraphArtifact()
  const second = await buildPublicGraphArtifact()
  const graph = first.graph

  assert.equal(graph.schema, PUBLIC_GRAPH_SCHEMA)
  assert.equal(graph.payloadName, PUBLIC_GRAPH_PAYLOAD_NAME)
  assert.match(graph.revision, /^[0-9a-f]{40}$/)
  assert.equal(graph.sourceRoot, '.')
  assert.ok(graph.nodes.length > 0)
  assert.deepEqual(graph.nodes.map((node) => node.path), [...graph.nodes.map((node) => node.path)].sort())
  assert.equal(publicGraphJson(graph), publicGraphJson(second.graph))
  assert.equal(first.documents.length, graph.nodes.length)
  assert.deepEqual(first.documents.map((document) => document.id), [...first.documents.map((document) => document.id)].sort())

  for (const node of graph.nodes) {
    for (const forbidden of ['sessions', 'issues', 'evals', 'overlays', 'terminal', 'worktree']) {
      assert.equal(Object.hasOwn(node, forbidden), false, `${node.id} leaked ${forbidden}`)
    }
  }
  assert.ok(first.documents.every((document) => typeof document.body === 'string' && Object.hasOwn(document, 'parts')))
  assert.equal(JSON.stringify(graph).includes(process.cwd()), false)
})
