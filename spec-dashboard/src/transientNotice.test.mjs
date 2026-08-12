import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
const notice = read('./TransientNotice.jsx')
const root = read('./Root.jsx')
const evals = read('./EvalsPage.jsx')
const issues = read('./IssuesPage.jsx')
const sessions = read('./SessionInterface.jsx')
const css = read('./styles.css')

test('transient notices expire by default, can be paused, and remain dismissible', () => {
  assert.match(notice, /const DEFAULT_DURATION = 5000/)
  assert.match(notice, /options\.duration === undefined \? DEFAULT_DURATION : options\.duration/)
  assert.match(notice, /window\.setTimeout\(\(\) => dismiss\(id\), remaining\)/)
  assert.match(notice, /onPointerEnter=\{\(\) => pause\(notice\.id\)\}/)
  assert.match(notice, /onFocus=\{\(\) => pause\(notice\.id\)\}/)
  assert.match(notice, /<IconButton icon="x"[^>]*onClick=\{\(\) => dismiss\(notice\.id\)\}/)
  assert.match(notice, /notice\.duration > 0 && <span className="tn-progress" aria-hidden="true" \/>/)
  assert.match(notice, /style=\{\{ '--tn-duration': `\$\{notice\.duration\}ms` \}\}/)
  assert.match(notice, /data-paused=\{notice\.paused \? 'true' : undefined\}/)
})

test('one root provider serves full and lightweight dashboard routes', () => {
  assert.match(root, /<TransientNoticeProvider>[\s\S]*\{lightweight \? <ReviewEntry page=\{page\} \/> : <App \/>\}[\s\S]*<\/TransientNoticeProvider>/)
})

test('review surfaces and the session console publish through the shared mechanism', () => {
  for (const source of [evals, issues]) {
    assert.match(source, /const \{ notify \} = useTransientNotice\(\)/)
    assert.match(source, /const flash = \(outcomes\) => \{ if \(outcomes\) notify\(outcomes\) \}/)
    assert.doesNotMatch(source, /setTimeout\(\(\) => setNotice/)
    assert.doesNotMatch(source, /\bfv-notice\b/)
  }
  assert.match(sessions, /notify\(actionOutcome\.message, \{ kind: actionOutcome\.phase === 'delivered' \? 'success' : 'error' \}\)/)
})

test('notice chrome stays palette-native and below interactive overlays', () => {
  assert.match(css, /\.tn-viewport\s*\{[^}]*z-index:\s*50;/s)
  assert.match(css, /\.tn-notice\s*\{[^}]*color:\s*var\(--ink2\);[^}]*background:\s*color-mix\(in srgb, var\(--panel\) 96%, transparent\);/s)
  assert.match(css, /\.tn-notice\.success\s*\{\s*--tn-tone:\s*var\(--green\);\s*\}/)
  assert.match(css, /\.tn-notice\.error\s*\{\s*--tn-tone:\s*var\(--red\);\s*\}/)
  assert.match(css, /@media \(max-width: 640px\)\s*\{\s*\.tn-viewport\s*\{[^}]*bottom:\s*calc\(68px \+ env\(safe-area-inset-bottom\)\);/s)
  assert.match(css, /\.tn-progress\s*\{[^}]*animation:\s*tn-progress var\(--tn-duration\) linear forwards;/s)
  assert.match(css, /\.tn-notice\[data-paused='true'\] \.tn-progress\s*\{\s*animation-play-state:\s*paused;/s)
})
