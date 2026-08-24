import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../../.spec/spexcode/spec-dashboard/dashboard-ui/app-frame/dashboard-shell/spec.md', import.meta.url), 'utf8')

test('desktop workspace chunk prefetch runs alongside board readiness without waking mobile/public faces', () => {
  assert.match(app, /if \(PUBLIC_GRAPH_ONLY \|\| isMobile\) return undefined\s+void import\('\.\/WorkspaceSurface\.jsx'\)/)
  assert.match(shell, /workspace face is prefetched in parallel with the first board request/)
})
