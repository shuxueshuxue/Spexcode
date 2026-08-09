import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { buildGuidanceCatalog, GUIDANCE_SCHEMA_VERSION } from './guidance-catalog.js'
import { guideCatalogEntries } from './guide.js'
import { helpCatalogEntries } from './help.js'
import { loadAgentConfig, loadConfig, loadHookConfig, loadReviewConfig, loadSkillConfig, loadSystemConfig } from './specs.js'

const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

test('guidance catalog is deterministic, immutable, and index-only', () => {
  const a = buildGuidanceCatalog().toJSON()
  const b = buildGuidanceCatalog().toJSON()
  assert.deepEqual(a, b)
  assert.equal(a.schemaVersion, GUIDANCE_SCHEMA_VERSION)
  assert.ok(Object.isFrozen(a))
  assert.ok(Object.isFrozen(a.entries))
  assert.ok(a.entries.length > 0)
  assert.equal(a.entries.map((entry) => `${entry.kind}\0${entry.id}\0${entry.surface ?? ''}\0${entry.source.path}`).join('\n'),
    [...a.entries].map((entry) => `${entry.kind}\0${entry.id}\0${entry.surface ?? ''}\0${entry.source.path}`).sort().join('\n'))
  for (const entry of a.entries) {
    assert.ok(Object.isFrozen(entry))
    assert.ok(Object.isFrozen(entry.source))
    assert.match(entry.source.contentHash, /^[0-9a-f]{64}$/)
    assert.ok(entry.source.path.length > 0)
    assert.ok(entry.source.revision.length > 0)
    assert.equal('body' in entry, false)
    assert.equal('prompt' in entry, false)
  }
  const { bundleHash, ...payload } = a
  assert.equal(bundleHash, digest(JSON.stringify(payload)))
})

test('catalog covers each active plugin surface and registered help/guide page', () => {
  const bundle = buildGuidanceCatalog().toJSON()
  const pluginRows = bundle.entries.filter((entry) => entry.kind === 'plugin')
  const loaders = [
    ['agent', loadAgentConfig], ['command', loadConfig], ['hook', loadHookConfig],
    ['review', loadReviewConfig], ['skill', loadSkillConfig], ['system', loadSystemConfig],
  ] as const
  for (const [surface, load] of loaders) {
    const presets = load()
    assert.equal(pluginRows.filter((entry) => entry.surface === surface).length, presets.length)
    for (const preset of presets) {
      assert.ok(pluginRows.some((entry) => entry.id === `plugin:${surface}:${preset.name}` && entry.source.path === `${preset.dir}/spec.md`))
    }
  }
  for (const entry of helpCatalogEntries()) assert.ok(bundle.entries.some((row) => row.id === `help:${entry.id}`))
  for (const entry of guideCatalogEntries()) assert.ok(bundle.entries.some((row) => row.id === `guide:${entry.id}`))
})
