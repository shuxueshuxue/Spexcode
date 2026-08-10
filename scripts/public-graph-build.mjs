#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dashboard = join(root, 'spec-dashboard')
const output = join(dashboard, 'dist-public')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

mkdirSync(output, { recursive: true })
run('npm', ['run', 'build', '--', '--outDir', 'dist-public'], {
  cwd: dashboard,
  env: {
    ...process.env,
    VITE_PUBLIC_GRAPH_ONLY: '1',
    VITE_PUBLIC_GRAPH_SOURCE: '/public-graph.json',
    VITE_PUBLIC_GRAPH_DOCUMENT_SOURCE: '/specs',
  },
})
run(process.execPath, ['spec-cli/bin/spex.mjs', 'graph', '--public', '--out', join(output, 'public-graph.json'), '--content-dir', join(output, 'specs')])
const payload = JSON.parse(readFileSync(join(output, 'public-graph.json'), 'utf8'))
if (payload.schema !== 'spexcode.public-spec-graph/v1' || !payload.revision || !Array.isArray(payload.nodes)) {
  throw new Error('public graph build emitted an invalid snapshot')
}
const documents = readdirSync(join(output, 'specs')).filter((name) => name.endsWith('.json')).sort()
if (documents.length !== payload.nodes.length) {
  throw new Error(`public graph build emitted ${documents.length} documents for ${payload.nodes.length} nodes`)
}
const graphBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`)
writeFileSync(join(output, 'public-graph.json'), graphBytes)
const manifest = {
  schema: 'spexcode.public-spec-release/v1',
  revision: payload.revision,
  graph: { path: 'public-graph.json', bytes: graphBytes.byteLength, sha256: sha256(graphBytes) },
  documents: documents.map((name) => {
    const bytes = readFileSync(join(output, 'specs', name))
    return { path: `specs/${name}`, bytes: bytes.byteLength, sha256: sha256(bytes) }
  }),
}
writeFileSync(join(output, 'public-spec-release.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`public graph: ${payload.nodes.length} nodes at ${payload.revision}`)
