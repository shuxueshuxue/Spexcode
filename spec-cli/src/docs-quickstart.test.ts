import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NATIVE_HARNESS_IDS } from './harness-select.js'
import { guideText } from './guide.js'

// [[guide]] — the adoption story must represent EVERY built-in harness, never privilege one as an
// implied default. The primary copy-paste `spex init --harness` example lists the FULL registry (the
// prose tells adopters to drop what they don't use), so the surfaces that teach adoption — both
// READMEs' Quick start and `spex guide`'s setup page — are checked against the live registry
// (NATIVE_HARNESS_IDS): a harness added to or removed from harness.ts fails here until the docs follow.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function quickStart(path: string, heading: RegExp): string {
  const text = readFileSync(join(ROOT, path), 'utf8')
  const lines = text.split('\n')
  const start = lines.findIndex((l) => heading.test(l))
  assert.ok(start >= 0, `${path}: no Quick start heading`)
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l))
  return lines.slice(start, end < 0 ? lines.length : end).join('\n')
}

// the one copy-paste `spex init` line: shell-valid (no <angle-bracket> pseudo-args) and its --harness
// value is EXACTLY the registry, in registry order — the neutral full-set example, grammar shown not narrated.
function assertInitCommand(section: string, where: string) {
  const m = section.match(/spex init --harness (\S+)/)
  assert.ok(m, `${where}: no \`spex init --harness <ids>\` example`)
  assert.ok(!/[<>]/.test(m![1]), `${where}: init example must be shell-valid, no angle brackets: ${m![0]}`)
  assert.deepEqual(m![1].split(','), NATIVE_HARNESS_IDS,
    `${where}: init example must list the full built-in registry (${NATIVE_HARNESS_IDS.join(',')}), got ${m![1]}`)
}

for (const [path, heading] of [
  ['README.md', /^## Quick start/],
  ['docs/README.zh-CN.md', /^## 快速开始/],
] as const) {
  test(`${path} Quick start represents every built-in harness`, () => {
    const section = quickStart(path, heading)
    assertInitCommand(section, path)
    assert.ok(!/--harness claude\s*(#|$)/m.test(section), `${path}: single-harness claude example regressed`)
  })
}

test('spex guide setup page lists the full built-in registry in its adopt step', () => {
  const setup = guideText()!
  const adopt = setup.split(/^\d+\. /m).find((s) => s.startsWith('Adopt a repo'))
  assert.ok(adopt, 'guide setup page lost its "Adopt a repo" step')
  assertInitCommand(adopt!, 'spex guide (setup)')
})
