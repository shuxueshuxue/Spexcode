import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = dirname(fileURLToPath(import.meta.url))
const iconSource = readFileSync(join(srcDir, 'icons.jsx'), 'utf8')
const iconRegistry = iconSource.match(/const ICONS = \{([\s\S]*?)\n\}\n\nexport function Icon/)
assert.ok(iconRegistry, 'icons.jsx must keep one explicit ICONS registry')

const registryNames = new Set(
  [...iconRegistry[1].matchAll(/^\s*(?:'([^']+)'|([A-Za-z0-9_-]+)):\s*\{/gm)]
    .map((match) => match[1] || match[2]),
)

const componentSources = readdirSync(srcDir)
  .filter((name) => name.endsWith('.jsx') && name !== 'icons.jsx' && name !== 'IdentityIcon.jsx')
  .map((name) => [name, readFileSync(join(srcDir, name), 'utf8')])

test('chrome glyphs use the one registry and no component-local SVG', () => {
  for (const [name, source] of componentSources) {
    assert.doesNotMatch(source, /<svg\b/, `${name} hand-writes an SVG outside icons.jsx`)
  }

  const literalNames = componentSources.flatMap(([, source]) => [
    ...source.matchAll(/<Icon\s+name="([^"]+)"/g),
    ...source.matchAll(/<IconButton\s+icon="([^"]+)"/g),
  ]).map((match) => match[1])
  assert.ok(literalNames.length > 0, 'the guard must inspect at least one literal icon use')
  for (const name of literalNames) {
    assert.equal(registryNames.has(name), true, `literal icon ${name} is missing from icons.jsx`)
  }

  // IdentityIcon is the sole intentional exception: named identity presets must serialize to favicons,
  // so that adapter owns its data-driven SVG rather than borrowing a chrome glyph.
  assert.match(readFileSync(join(srcDir, 'IdentityIcon.jsx'), 'utf8'), /identityPreset\(icon\)/)
})

test('the shared Icon and IconButton contracts stay mechanically enforced', () => {
  assert.match(iconSource, /fill=\{def\.fill \?\? 'none'\}/)
  assert.match(iconSource, /stroke=\{def\.stroke \?\? 'currentColor'\}/)
  assert.match(iconSource, /strokeLinecap="round" strokeLinejoin="round"/)
  assert.match(iconSource, /aria-hidden="true"/)
  assert.match(iconSource, /data-tip=\{label\} aria-label=\{label\}/)
  assert.match(iconSource, /console\.error\(`unknown icon: \$\{name\}`\)/)
})
