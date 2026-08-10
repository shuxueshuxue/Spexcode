import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildGuidanceCatalog, GUIDANCE_CATALOG_SCHEMA, GUIDANCE_PAYLOAD_NAME, GUIDANCE_SCHEMA_VERSION } from './guidance-catalog.js'
import { repoRoot } from '@spexcode/spec-core'
import { guideCatalogEntries } from './guide.js'
import { helpCatalogEntries } from './help.js'
import { loadAgentConfig, loadConfig, loadHookConfig, loadReviewConfig, loadSkillConfig, loadSystemConfig } from '@spexcode/spec-core'

const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

test('guidance catalog is deterministic, immutable, and content-bearing', () => {
  const first = buildGuidanceCatalog()
  const second = buildGuidanceCatalog()
  const a = first.toJSON()
  const b = second.toJSON()
  assert.deepEqual(a, b)
  assert.equal(a.schemaVersion, GUIDANCE_SCHEMA_VERSION)
  assert.equal(a.catalogSchema, GUIDANCE_CATALOG_SCHEMA)
  assert.equal(a.payloadName, GUIDANCE_PAYLOAD_NAME)
  assert.ok(Object.isFrozen(a))
  assert.ok(Object.isFrozen(a.entries))
  assert.ok(Object.isFrozen(a.effectiveSystemContract))
  assert.ok(a.entries.length > 0)
  assert.equal(a.entries.map((entry) => `${entry.kind}\0${entry.id}\0${entry.surface ?? ''}\0${entry.source.path}`).join('\n'),
    [...a.entries].map((entry) => `${entry.kind}\0${entry.id}\0${entry.surface ?? ''}\0${entry.source.path}`).sort().join('\n'))
  for (const entry of a.entries) {
    assert.ok(Object.isFrozen(entry))
    assert.ok(Object.isFrozen(entry.source))
    assert.match(entry.source.contentHash, /^[0-9a-f]{64}$/)
    assert.ok(entry.source.path.length > 0)
    assert.ok(entry.source.revision.length > 0)
    assert.ok(entry.content.length > 0)
    assert.equal(entry.source.contentHash, digest(entry.content))
  }
  const { bundleHash, ...payload } = a
  assert.equal(bundleHash, digest(JSON.stringify(payload)))
  assert.equal(first.exportJson(), second.exportJson())
  assert.equal(existsSync(join(repoRoot(), GUIDANCE_PAYLOAD_NAME)), false)

  const expectedSystemContent = loadSystemConfig().map((preset) => preset.body.trim()).filter(Boolean).join('\n\n')
  assert.equal(a.effectiveSystemContract.content, expectedSystemContent)
  assert.equal(a.effectiveSystemContract.contentHash, digest(expectedSystemContent))
  assert.deepEqual(a.effectiveSystemContract.sourceEntryIds,
    loadSystemConfig().map((preset) => `plugin:system:${preset.name}`))
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
      const row = pluginRows.find((entry) => entry.id === `plugin:${surface}:${preset.name}`)
      assert.ok(row)
      assert.equal(row.source.path, `${preset.dir}/spec.md`)
      assert.equal(row.content, preset.body)
      assert.equal(row.source.contentHash, digest(preset.body))
    }
  }
  for (const entry of helpCatalogEntries()) {
    const row = bundle.entries.find((candidate) => candidate.id === `help:${entry.id}`)
    assert.ok(row)
    assert.equal(row.content, entry.text)
    assert.equal(row.source.contentHash, digest(entry.text))
  }
  for (const entry of guideCatalogEntries()) {
    const row = bundle.entries.find((candidate) => candidate.id === `guide:${entry.id}`)
    assert.ok(row)
    assert.equal(row.content, entry.text)
    assert.equal(row.source.contentHash, digest(entry.text))
  }
})
