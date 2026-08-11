import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const specCoreEntry = new URL('../../packages/spec-core/src/index.ts', import.meta.url).href
const tsxImport = import.meta.resolve('tsx')
const probeScript = `
  import { PLUGIN_INSTANCE_ROOT, loadSystemConfig } from ${JSON.stringify(specCoreEntry)}
  const result = { root: PLUGIN_INSTANCE_ROOT, presets: [], error: null }
  try {
    result.presets = loadSystemConfig().map(({ name, dir }) => ({ name, dir }))
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  process.stdout.write(JSON.stringify(result))
`

function probe(project: string): { root: string; presets: { name: string; dir: string }[]; error: string | null } {
  return JSON.parse(execFileSync(process.execPath, [
    '--import', tsxImport,
    '--input-type=module',
    '--eval', probeScript,
  ], { cwd: project, encoding: 'utf8' }))
}

const activeSystemNode = (title: string) => `---\ntitle: ${title}\nstatus: active\nsurface: system\n---\n${title}\n`
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('the public plugin instance root drives discovery and the legacy-tree guard', () => {
  const project = mkdtempSync(join(tmpdir(), 'spex-plugin-root-contract-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: project })
    const root = join(project, '.spec', 'project')
    mkdirSync(join(root, '.config'), { recursive: true })
    writeFileSync(join(root, 'spec.md'), '---\ntitle: project\nstatus: active\n---\nproject\n')

    const beforeInstance = probe(project)
    assert.ok(beforeInstance.error, 'the legacy tree is rejected before an instance root exists')

    const instanceNode = join(root, beforeInstance.root, 'instance-system')
    const systemNode = join(root, 'plugin-system', 'system-spec')
    mkdirSync(instanceNode, { recursive: true })
    mkdirSync(systemNode, { recursive: true })
    writeFileSync(join(instanceNode, 'spec.md'), activeSystemNode('instance-system'))
    writeFileSync(join(systemNode, 'spec.md'), activeSystemNode('system-spec'))

    const loaded = probe(project)
    assert.equal(loaded.error, null)
    assert.deepEqual(loaded.presets, [
      { name: 'instance-system', dir: join('.spec', 'project', loaded.root, 'instance-system') },
      { name: 'system-spec', dir: join('.spec', 'project', 'plugin-system', 'system-spec') },
    ])

    rmSync(join(root, loaded.root), { recursive: true, force: true })
    assert.ok(!existsSync(join(root, loaded.root)))
    const legacy = probe(project)
    assert.match(legacy.error ?? '', new RegExp(`\\.spec/project/\\.config exists but \\.spec/project/${escapeRegex(legacy.root)} does not`))
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})
