import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPublicGraphArtifact, PUBLIC_GRAPH_PAYLOAD_NAME, PUBLIC_GRAPH_SCHEMA, PUBLIC_PAYLOAD_ELEMENT_ID, publicGraphHtml, publicGraphJson, type PublicGraphArtifact } from './public-graph.js'

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

test('a single-file page carries its whole payload inside itself, and no spec text can close the element early', () => {
  const artifact = {
    graph: { schema: PUBLIC_GRAPH_SCHEMA, payloadName: PUBLIC_GRAPH_PAYLOAD_NAME, revision: 'a'.repeat(40), sourceRoot: '.', identity: { title: 'demo', icon: 'x' }, nodes: [] },
    documents: [{ schema: 'spexcode.public-spec-document/v1', revision: 'a'.repeat(40), id: 'root', body: 'a body that says </script><script>alert(1)</script>', parts: [], diagram: null }],
  } as unknown as PublicGraphArtifact
  const shell = '<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>'
  const page = publicGraphHtml(shell, artifact)
  const match = page.match(new RegExp(`<script type="application/json" id="${PUBLIC_PAYLOAD_ELEMENT_ID}">([^<]*)</script>\\n</head>`))
  assert.ok(match, 'the payload element sits in the head, and its text holds no raw <')
  const payload = JSON.parse(match[1])
  assert.equal(payload.documents.root.body, artifact.documents[0].body)
  assert.equal(payload.graph.revision, artifact.graph.revision)
  assert.equal(payload.metadata.schema, 'spexcode.public-spec-site/v1')
  assert.equal(payload.metadata.release.archive, undefined, 'one file has no archive beside it')
  assert.equal(page.replace(match[0], '</head>'), shell, 'the shell is otherwise untouched')
  assert.throws(() => publicGraphHtml('<html></html>', artifact), /no <\/head>/)
})

test('the payload lands in the real head, not in a bundle string that happens to spell one', () => {
  const artifact = {
    graph: { schema: PUBLIC_GRAPH_SCHEMA, payloadName: PUBLIC_GRAPH_PAYLOAD_NAME, revision: 'b'.repeat(40), sourceRoot: '.', identity: { title: 'demo', icon: 'x' }, nodes: [] },
    documents: [],
  } as unknown as PublicGraphArtifact
  // the single-file shell inlines the bundle, and the bundle writes HTML as data — this is the widget
  // runtime's iframe template, shortened: a `</head><body>` living inside a JavaScript string literal.
  const shell = [
    '<!doctype html><html><head><title>t</title>',
    '<script type="module">const frame=(b)=>`<html><head><\\/script></head><body>${b}</body></html>`;window.frame=frame</script>',
    '</head><body><div id="root"></div></body></html>',
  ].join('')
  const page = publicGraphHtml(shell, artifact)
  const at = page.indexOf(`<script type="application/json" id="${PUBLIC_PAYLOAD_ELEMENT_ID}">`)
  assert.ok(at > page.indexOf('window.frame=frame'), 'the payload goes after the inlined bundle, never inside it')
  const real = shell.lastIndexOf('</head>')
  assert.equal(page, `${shell.slice(0, real)}${page.slice(at, page.indexOf('</head>', at))}${shell.slice(real)}`, 'the bundle keeps both of its halves; only the real head grew')
  assert.throws(() => publicGraphHtml('<html><script>"</head>"</script>', artifact), /no <\/head>/)
})
