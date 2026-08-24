import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(here, name), 'utf8')

test('review routes use the resident workspace shell instead of a second chrome tree', () => {
  const app = read('App.jsx')
  const root = read('Root.jsx')
  const shell = read('Shell.jsx')
  const views = read('views.jsx')

  assert.doesNotMatch(app, /surface === 'review'/, 'App must not bypass Shell for review routes')
  assert.doesNotMatch(root, /coldReviewRoute|<ReviewSurface/, 'Root must not cold-boot a standalone review shell')
  assert.match(shell, /<TabStrip[\s\S]*route=\{\{ page, param, query \}\}/)
  assert.match(views, /evals:\s+\{[\s\S]*surface: 'workspace'[\s\S]*document: true[\s\S]*resident: true/)
  assert.match(views, /issues:\s+\{[\s\S]*surface: 'workspace'[\s\S]*document: true[\s\S]*resident: true/)
  assert.match(views, /spec:\s+\{[^\n]*surface: 'workspace'[^\n]*document:[^\n]*resident: true/)
})
