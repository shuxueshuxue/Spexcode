import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// THE GUIDE'S EXAMPLES ARE THE TEMPLATES, SO THEY ARE CHECKED LIKE CODE. [[widgets]] refuses a template
// library on the grounds that it would be a second surface to keep in step with the theme tokens and the
// bridge — which is exactly the cost this file removes. An example is only worth copying if it still
// compiles against the real host, and prose rots silently: the guide said the bridge had "three members"
// for as long as it had five, and nothing was red. Everything the guide teaches an author to write is
// therefore read back out of it here and checked against what the host actually injects.

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')

const guideSource = read('../../spec-cli/src/guide.ts')
const widgetRefs = read('./widgetRefs.js')
const sessionWidget = read('./SessionWidget.jsx')

// the WIDGET page only, so a token named on the diagram or files page never satisfies a widget example
const guide = guideSource.slice(
  guideSource.indexOf('const WIDGET = `'),
  guideSource.indexOf('const TOPICS'),
)
assert.ok(guide.length > 1000, 'found the widget guide page')

// what widgetThemeStyle writes into every widget document, plus the three aliases it defines there
const injected = new Set([
  ...[...widgetRefs.matchAll(/'(--[a-z0-9-]+)'/g)].map((m) => m[1]),
  ...[...widgetRefs.matchAll(/--(?:bg|fg|accent):/g)].map((m) => m[0].slice(0, -1)),
])
assert.ok(injected.has('--line') && injected.has('--accent'), 'read the injected token list')

// every key of the object the host installs as window.spex
const bridgeLiteral = sessionWidget.slice(
  sessionWidget.indexOf('bridges.set(instance, {'),
  sessionWidget.indexOf('return () => { bridges.delete(instance) }'),
)
const bridgeKeys = new Set([...bridgeLiteral.matchAll(/^ {6}([a-z]+)[(:]/gm)].map((m) => m[1]))
assert.ok(bridgeKeys.has('draft') && bridgeKeys.has('state'), 'read the bridge members')

test('every token the widget guide teaches is one the host actually injects', () => {
  const used = [...guide.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])
  assert.ok(used.length >= 6, 'the guide demonstrates the palette')
  for (const token of new Set(used)) {
    assert.ok(injected.has(token), `${token} is named in the guide but never written into a widget document`)
  }
})

test('every bridge member the widget guide teaches exists on the bridge', () => {
  const used = [...guide.matchAll(/\b(?:spex|ui)\.([a-z]+)/g)].map((m) => m[1])
  assert.ok(used.length >= 6, 'the guide demonstrates the bridge')
  for (const member of new Set(used)) {
    assert.ok(bridgeKeys.has(member), `the guide teaches spex.${member}, which the host does not install`)
  }
})

test('the guide names every bridge member an author may call', () => {
  // resize is the frame's own callback — the document the host writes calls it, and an author never does,
  // so it is deliberately absent from the guide. Everything else is the author's to use and must be listed.
  const authorFacing = [...bridgeKeys].filter((key) => key !== 'resize')
  for (const member of authorFacing) {
    assert.match(guide, new RegExp(`spex\\.${member}\\b`), `the bridge has ${member} and the guide never mentions it`)
  }
})

test('the guide states the frame height cap, in the number the host enforces', () => {
  const cap = sessionWidget.match(/MAX_FRAME_HEIGHT = (\d+)/)
  assert.ok(cap, 'the host caps the frame height')
  assert.match(guide, new RegExp(`${cap[1]}px`),
    'a widget author who is not told where the frame stops growing draws a list that is silently clipped')
})
