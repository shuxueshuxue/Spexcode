import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

test('the workspace frame is the only desktop host and receives the route from its owner', () => {
  const surface = read('WorkspaceSurface.jsx')
  const shell = read('Shell.jsx')
  const tabStrip = read('TabStrip.jsx')

  assert.match(surface, /import Shell from ['"]\.\/Shell\.jsx['"]/)
  assert.match(surface, /<Shell routeOverride=\{route\} inactive=\{inactive\} \/>/)
  assert.match(shell, /function ViewScopeHost\(/)
  assert.match(shell, /contract: viewRouteContract/)
  assert.match(shell, /<ViewScopeProvider scope=\{holder\.scope\}>/)
  assert.doesNotMatch(tabStrip, /\buseRoute\s*\(|\bnavigate\s*\(/)
})

test('the mobile view consumes the host route instead of opening a second global route reader', () => {
  const mobile = read('MobileApp.jsx')
  const app = read('App.jsx')
  const review = read('ReviewSurface.jsx')

  assert.doesNotMatch(mobile, /\buseRoute\s*\(/)
  assert.match(mobile, /route = \{\}/)
  assert.match(mobile, /const \{ page = 'graph', param = null \} = route/)
  assert.match(app, /<MobileApp[\s\S]*route=\{route\}/)
  assert.match(review, /<MobileApp[\s\S]*route=\{\{ page, param, query \}\}/)
})

test('hosted review views route only through their ViewScope', () => {
  const evals = read('EvalsPage.jsx')
  const issues = read('IssuesPage.jsx')
  const views = read('views.jsx')

  for (const source of [evals, issues, views]) {
    assert.doesNotMatch(source, /import\s+\{[^}]*\bnavigate\b[^}]*\}\s+from\s+['"]\.\/route\.js['"]|\bnavigate\s*\(/)
  }
  assert.match(evals, /useViewScope\(\)/)
  assert.match(evals, /scope\.ownQuery\(/)
  assert.match(issues, /useViewScope\(\)/)
  assert.match(issues, /scope\.open\([^\n]+\{ replace: true \}\)/)
  assert.match(views, /useViewScope\(\)/)
})
