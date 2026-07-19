import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The Information Board eval NAVIGATION contract ([[eval-score-badge]] / [[address-routing]]): every
// concrete eval affordance is a REAL anchor onto the canonical `#/evals/<node>/<scenario>` detail; every
// aggregate score/count is a REAL anchor onto the node-filtered Evals list, minted ONLY by the
// scenario-less evalAddress form; no interactive link nests inside another control; browser history
// (never an in-page fake Back) is the return path.

const here = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(here, name), 'utf8')
const nodeView = read('NodeView.jsx')
const score = read('score.jsx')
const address = read('address.js')
const css = read('styles.css')

test('aggregate counts are anchors minted by the scenario-less evalAddress form only', () => {
  // Information Board stat bar
  assert.match(nodeView, /<ScenarioCount scenarios=\{node\.scenarios\} evals=\{node\.evals\} href=\{addressHash\(evalAddress\(node\.id\)\)\} \/>/)
  // ScenarioCount renders a REAL anchor when given the href, a passive span otherwise (the graph tile)
  assert.match(score, /if \(!href\) return <span className={`scenario-count/)
  assert.match(score, /return <a className={`scenario-count \$\{state\}`} href=\{href\}/)
  // the list-filter grammar lives in the address/query layer alone — the aggregate href is the
  // canonical token text (default view + node qualifier), never hand-rolled in a component
  assert.match(address, /routeHash\('evals', null, \{ q: nodeEvalQuery\(address\.nodeId\) \}\)/)
  const reviewQuery = read('reviewQuery.js')
  assert.match(reviewQuery, /export const nodeEvalQuery = \(nodeId\) => setToken\(EVAL_QUERY_DEFAULT, 'node', nodeId\)/)
  for (const source of [nodeView, score]) {
    assert.doesNotMatch(source, /#\/evals\?/, 'no hand-rolled evals-list hash outside address.js')
  }
})

test('eval-tab reading rows carry a sibling detail anchor, never nested in the expand toggle', () => {
  // ChronoPane renders the action AFTER the toggle button closes — a sibling, not a child
  assert.match(nodeView, /<\/button>\s*\{\/\*[\s\S]*?\*\/\}\s*\{renderAction\?\.\(it, i\)\}/)
  // the eval pane's action is the canonical routed detail address
  assert.match(nodeView, /renderAction=\{\(r\) => \(\s*<a className="eval-open" href=\{addressHash\(evalAddress\(node\.id, r\.scenario\)\)\}/)
  // and the anchor is tooltip'd + accessible
  assert.match(nodeView, /className="eval-open"[\s\S]{0,200}aria-label=\{t\('nodeView\.eval\.openDetail'\)\}/)
})

test('the anchors keep row/pill chrome (no default link styling bleeding through)', () => {
  assert.match(css, /a\.scenario-count \{ text-decoration: none/)
  assert.match(css, /\.eval-row \{ position: relative/)
  assert.match(css, /\.eval-open \{ position: absolute/)
})

test('popup tab captions: no visible key digits; state counts speak the shared ReviewState primitive', () => {
  // the kbd digit markers are gone from the captions — digit-key pane switching stays (Dashboard.jsx)
  assert.doesNotMatch(nodeView, /<kbd>\{i \+ 1\}<\/kbd>/)
  assert.match(nodeView, /\{t\(PANE_LABEL\[p\.key\]\)\}/)
  // one TabCount chip = ReviewState icon + tally; issues AND eval captions consume it
  assert.match(nodeView, /function TabCount\(\{ kind, state, cls, n, label \}\)[\s\S]{0,300}<ReviewState kind=\{kind\} state=\{state\}/)
  assert.match(nodeView, /<TabCount kind="issue" state="open"/)
  assert.match(nodeView, /<TabCount kind="issue" state="closed"/)
  assert.match(nodeView, /<TabCount kind="eval" state="pass"/)
  assert.match(nodeView, /<TabCount kind="eval" state="fail"/)
  // the tally comes from the ONE scenarioStates join — no second statistics path
  assert.match(nodeView, /const evalStates = scenarioStates\(node\.scenarios, node\.evals\)/)
})

test('the compact filter row leads with the one showing-X-of-Y summary from the filter model', () => {
  const shell = read('ReviewShell.jsx')
  // the primitive renders full words + a phone-width X/Y condensation, words kept in the aria-label
  assert.match(shell, /className="rf-summary" aria-label=\{label\}/)
  assert.match(shell, /rf-summary-full/)
  assert.match(shell, /rf-summary-compact/)
  // both popup panes feed it model.shown/total — the SAME filtered result the rows render
  assert.match(nodeView, /summary=\{\{ shown: model\.shown\.length, total: filterItems\.length \}\}/)
  assert.match(nodeView, /summary=\{\{ shown: model\.shown\.length, total: issues\.length \}\}/)
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.rf-summary-full \{ display: none; \}/)
})
