import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, 'EvalsPage.jsx'), 'utf8')
const detail = readFileSync(join(here, 'EventDetail.jsx'), 'utf8')
const shell = readFileSync(join(here, 'ReviewShell.jsx'), 'utf8')

test('session detail history stays stable across board-only repaints', () => {
  assert.match(page, /const history = useMemo\([\s\S]*?\[sessionId, model, node, scenario\],[\s\S]*?\)/)

  // EventDetail's source-change effect clears all three pieces of in-progress review state. Keeping the
  // provided history identity stable is therefore the regression boundary for A/B, timeline, and draft.
  const reset = detail.match(/useEffect\(\(\) => \{[\s\S]*?setHistIdx\(0\); setHistory\(null\)[\s\S]*?providedHistory\]\)/)?.[0] || ''
  assert.match(reset, /setEvents\(\[\]\)/)
  assert.match(reset, /setDraft\(null\)/)
  assert.match(reset, /setHistIdx\(0\)/)
})

test('session model failures are distinct from genuine not-found states', () => {
  assert.match(page, /r\.status === 404 \? false : Promise\.reject\(new Error\(`HTTP \$\{r\.status\}`\)\)/)
  assert.match(page, /<EvalsGroup[\s\S]*error=\{error \? t\('sessionEval\.loadFailed'/)
  assert.match(page, /<DetailShell failure=\{t\('sessionEval\.loadFailed'/)
  assert.match(shell, /className="ds-page ds-missing ds-failed" role="alert"/)
})
