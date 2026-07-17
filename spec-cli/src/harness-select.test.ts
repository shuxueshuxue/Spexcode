import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveHarnessTargets, partitionHarnesses, parseHarnessFlag } from './harness-select.js'

test('a MISSING field fails loud with the stamp repair — there is no default set', () => {
  for (const raw of [undefined, null]) {
    assert.throws(() => resolveHarnessTargets(raw), /no "harnesses" field.*spex init --harness/s)
  }
})

test('parseHarnessFlag translates the CLI spelling to raw field members (validation stays with resolve)', () => {
  assert.deepEqual(parseHarnessFlag('claude'), ['claude'])
  assert.deepEqual(parseHarnessFlag('claude, codex'), ['claude', 'codex'])
  assert.deepEqual(parseHarnessFlag('plugin:.zcode'), [{ plugin: '.zcode' }])
  assert.deepEqual(resolveHarnessTargets(parseHarnessFlag('codex')), [{ kind: 'native', id: 'codex' }])
  assert.throws(() => resolveHarnessTargets(parseHarnessFlag('claude,plugin:.zcode')), /EXCLUSIVE/)
})

test('native ids resolve to native targets; order preserved', () => {
  assert.deepEqual(resolveHarnessTargets(['codex', 'claude']), [
    { kind: 'native', id: 'codex' },
    { kind: 'native', id: 'claude' },
  ])
})

test('a {plugin} object resolves to a plugin target with its folder', () => {
  assert.deepEqual(resolveHarnessTargets([{ plugin: '.zcode' }]), [{ kind: 'plugin', folder: '.zcode' }])
  assert.deepEqual(resolveHarnessTargets([{ plugin: '  .codex  ' }]), [{ kind: 'plugin', folder: '.codex' }])
})

test('plugin EXCLUSIVITY: plugin + any native fails loud', () => {
  assert.throws(() => resolveHarnessTargets(['claude', { plugin: '.zcode' }]), /EXCLUSIVE/)
  assert.throws(() => resolveHarnessTargets([{ plugin: '.zcode' }, 'codex']), /EXCLUSIVE/)
})

test('a plugin needs an explicit folder — bare "plugin" / empty folder fails loud', () => {
  assert.throws(() => resolveHarnessTargets(['plugin']), /explicit landing folder/i)
  assert.throws(() => resolveHarnessTargets([{ plugin: '' }]), /non-empty folder/i)
  assert.throws(() => resolveHarnessTargets([{ plugin: '   ' }]), /non-empty folder/i)
})

test('unknown id and malformed members fail loud', () => {
  assert.throws(() => resolveHarnessTargets(['gemini']), /unknown harness id/i)
  assert.throws(() => resolveHarnessTargets([42]), /each member must be/i)
  assert.throws(() => resolveHarnessTargets('claude'), /must be an ARRAY/i)
  assert.throws(() => resolveHarnessTargets([]), /EMPTY/)
})

test('partitionHarnesses splits live adapters into selected vs unselected', () => {
  const both = partitionHarnesses(resolveHarnessTargets(['claude', 'codex']))
  assert.deepEqual(both.selected.map((h) => h.id).sort(), ['claude', 'codex'])
  assert.equal(both.unselected.length, 0)

  const onlyClaude = partitionHarnesses(resolveHarnessTargets(['claude']))
  assert.deepEqual(onlyClaude.selected.map((h) => h.id), ['claude'])
  assert.deepEqual(onlyClaude.unselected.map((h) => h.id), ['codex'])

  // a plugin set selects NO native harness → every native is unselected (and thus pruned by materialize).
  const plugin = partitionHarnesses(resolveHarnessTargets([{ plugin: '.zcode' }]))
  assert.equal(plugin.selected.length, 0)
  assert.ok(plugin.unselected.length >= 2)
  assert.deepEqual(plugin.plugins, [{ folder: '.zcode' }])
})
