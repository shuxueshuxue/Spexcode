import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(here, name), 'utf8')
const shell = read('ReviewShell.jsx')
const evals = read('EvalsFeed.jsx')
const page = read('EvalsPage.jsx')
const detail = read('EventDetail.jsx')
const issues = read('IssuesPage.jsx')
const issueCard = read('IssueCard.jsx')
const dashboard = read('Dashboard.jsx')
const css = read('styles.css')
const filters = read('reviewFilters.js')
const icons = read('icons.jsx')
const en = read('i18n/en.js')
const zh = read('i18n/zh.js')

test('issues and evals consume one GitHub ListView primitive set', () => {
  for (const source of [evals, issues]) {
    assert.match(source, /<ListPage/)
    assert.match(source, /<FacetMenu/)
    assert.match(source, /<FacetOverflow/)
    assert.match(source, /<ReviewListRow/)
    assert.doesNotMatch(source, /FilterSelect/)
  }
  const issueList = issues.slice(0, issues.indexOf('export function IssueDetailPage'))
  assert.doesNotMatch(issueList, /<select\b/)
  assert.doesNotMatch(evals, /<select\b/)
  assert.match(shell, /className="rl-query rq"/)
  assert.match(shell, /className="rl-sections" role="tablist"/)
  assert.match(shell, /className="rl-facets"/)
  assert.match(shell, /className="rl-row-grid"/)
  assert.match(shell, /!listOwnsKey\(event\.target, event\.key\)/)
  assert.match(evals, /evalFilterModel\(filterItems, tokenFilterState\(text, 'eval'\)/)
  assert.match(issues, /issueFilterModel\(all, tokenFilterState\(text, 'issue'\)/)
  assert.match(filters, /export function filterReviewItems/)
})

test('one visible token query is the whole list state — combobox, overlay, bounded listbox', () => {
  // the native input stays native: combobox semantics, transparent glyphs, aria-hidden highlight UNDER it
  assert.match(shell, /role="combobox" aria-expanded=\{open\} aria-controls=\{listId\} aria-autocomplete="list"/)
  assert.match(shell, /className="rq-hl" aria-hidden="true"/)
  assert.doesNotMatch(shell, /contentEditable=/)
  assert.match(css, /\.rl-query input \{[^}]*color: transparent; caret-color: var\(--ink\);/)
  assert.match(css, /\.rq-hl \{[^}]*pointer-events: none;/)
  // recognized qualifiers color; unknown ones stay plain — the keys list is the judgment
  assert.match(shell, /seg\.ws \|\| seg\.key == null \|\| !keys\.includes\(seg\.key\)/)
  assert.match(shell, /className="rq-tok-key"/)
  // the suggestion listbox: options, roving active descendant, value picks submit immediately
  assert.match(shell, /role="listbox" id=\{listId\}/)
  assert.match(shell, /role="option" aria-selected=\{index === active\}/)
  assert.match(shell, /if \(item\.type === 'value'\) \{ submit\(next\); return \}/)
  // plain Enter submits the typed text; only an ARROWED-TO option intercepts it
  assert.match(shell, /event\.key === 'Enter' && active >= 0/)
})

test('every control is a token BUILDER over the committed text — no private filter state', () => {
  for (const source of [evals, issues]) {
    assert.match(source, /const surgery = \(key, value\) => /)
    assert.match(source, /setToken\(text, key, value\)/)
  }
  // ONE parse → ONE matcher: both pages bridge the token text into the shared engine, whose section
  // counts are computed under the REST of the query (the section never sees its own token)
  assert.match(evals, /tokenFilterState\(text, 'eval'\)/)
  assert.match(issues, /tokenFilterState\(text, 'issue'\)/)
  assert.match(evals, /const currentCount = filters\.sections\.current \|\| 0/)
  assert.match(issues, /const openCount = filters\.sections\.open \|\| 0/)
  assert.match(issues, /surgery\('state', 'open'\)/)
  assert.match(issues, /surgery\('state', 'closed'\)/)
  assert.match(evals, /surgery\('state', 'current'\)/)
  assert.match(evals, /surgery\('state', 'reviewed'\)/)
  // the default view is the BARE address; anything else exactly ?q=<raw text>
  assert.match(issues, /queryParam\(nextText, ISSUE_QUERY_DEFAULT\)/)
  assert.match(page, /queryParam\(text, EVAL_QUERY_DEFAULT\)/)
})

test('high-cardinality dimensions are token-only: no enumerating dropdowns, bounded suggestions', () => {
  // the big-list Author/Filer/Spec-node/session-scope menus are GONE
  for (const source of [evals, issues]) {
    assert.doesNotMatch(source, /facetAuthor|facetNode|facetFiler|facetScope/)
    assert.doesNotMatch(source, /authorOptions|nodeOptions|filerOptions|scopeOptions/)
  }
  // suggestions come only from the data — and scope only from the board's sessions
  assert.match(issues, /suggest: \{\s*author: \[\.\.\.new Set\(all\.map\(\(issue\) => issue\.by\)/)
  assert.match(evals, /scope: sessions\.map\(\(session\) => \(\{ value: session\.id/)
  // the evidence default is a plain enum default, never data-dependent
  assert.doesNotMatch(evals, /hasVideo|hasImage/)
})

test('the source-session facet speaks presence, never liveness', () => {
  // the ONE membership join lives in the engine's presence facet — pages only render its options
  assert.match(filters, /sessionPresent/)
  assert.match(filters, /fixedValues: \['present', 'missing'\]/)
  assert.match(filters, /reviewList\.facetSession/)
  assert.doesNotMatch(filters, /liveSession|facetLive|'live'/)
  for (const source of [evals, issues]) {
    assert.match(source, /sessionFacet/)
    assert.doesNotMatch(source, /liveSession|liveOnly|facetLive/)
  }
  const enBlock = en.slice(en.indexOf('reviewList: {'), en.indexOf('reviewShell: {'))
  const zhBlock = zh.slice(zh.indexOf('reviewList: {'), zh.indexOf('reviewShell: {'))
  for (const block of [enBlock, zhBlock]) {
    assert.match(block, /facetSession:/)
    assert.match(block, /sessionPresent:/)
    assert.match(block, /sessionMissing:/)
    assert.doesNotMatch(block, /live|online|offline/i)
  }
  assert.match(zhBlock, /来源会话/)
  assert.match(zhBlock, /仍在/)
  assert.match(zhBlock, /已不在/)
})

test('shared list key ownership preserves native controls and focused anchors', () => {
  const source = shell.match(/export const listOwnsKey = ([\s\S]*?\n})\n\nconst visibleMenuItems/)?.[1]
  assert.ok(source, 'listOwnsKey stays a directly testable shared predicate')
  const owns = Function(`return (${source})`)()
  const target = (tagName, anchor = false) => ({ tagName, closest: () => (anchor ? {} : null) })

  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(owns(target(tag), 'j'), false)
    assert.equal(owns(target(tag), 'Enter'), false)
  }
  assert.equal(owns(target('BUTTON'), 'Enter'), false)
  assert.equal(owns(target('BUTTON'), ' '), false)
  assert.equal(owns(target('BUTTON'), 'j'), true)
  assert.equal(owns(target('A', true), 'Enter'), false)
  assert.equal(owns(target('SPAN', true), 'Enter'), false)
  assert.equal(owns(target('A', true), 'j'), true)
  assert.equal(owns(target('DIV'), 'Enter'), true)
})

test('facet primitives keep an active missing value clearable', () => {
  const source = shell.match(/export const facetMenuOptions = ([\s\S]*?\n})\n\nexport const rovingIndex/)?.[1]
  assert.ok(source, 'facetMenuOptions stays directly testable')
  const options = Function(`return (${source})`)()
  const all = { value: '', label: 'All' }

  assert.deepEqual(options([], '', 'All'), [])
  assert.deepEqual(options([{ value: 'all', label: 'all' }], 'all', null), [{ value: 'all', label: 'all' }])
  assert.deepEqual(options([], 'dead-session', 'All'), [all])
  assert.deepEqual(options([{ value: 'live', label: 'Live' }], 'gone', 'All'), [all, { value: 'live', label: 'Live' }])
  assert.deepEqual(options([all, { value: 'live', label: 'Live' }], 'gone', 'All'), [all, { value: 'live', label: 'Live' }])
  assert.match(evals, /<FacetOverflow[^>]*clearLabel=\{t\('reviewList\.all'\)\}/)
  assert.match(evals, /label: sessionFacet\.label, value: sessionFacet\.value/)
  assert.match(issues, /<FacetOverflow[^>]*clearLabel=\{t\('reviewList\.all'\)\}/)
})

test('menus and section tabs share one keyboard and Escape contract', () => {
  const source = shell.match(/export const rovingIndex = ([\s\S]*?\n})\n\nexport const listOwnsKey/)?.[1]
  assert.ok(source, 'rovingIndex stays directly testable')
  const move = Function(`return (${source})`)()
  assert.equal(move(0, 3, 'ArrowDown'), 1)
  assert.equal(move(2, 3, 'ArrowDown'), 0)
  assert.equal(move(0, 3, 'ArrowUp'), 2)
  assert.equal(move(1, 3, 'Home'), 0)
  assert.equal(move(1, 3, 'End'), 2)

  const popover = shell.slice(shell.indexOf('function usePopover'), shell.indexOf('export function FacetMenu'))
  assert.match(popover, /useEscLayer\(open, \(\) => close\(true\)\)/)
  assert.doesNotMatch(popover, /addEventListener\('keydown'/)
  assert.match(popover, /requestAnimationFrame[\s\S]*aria-checked[\s\S]*focusMenuItem/)
  assert.match(popover, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]/)
  assert.match(shell, /role="menuitemradio"[\s\S]*tabIndex=\{-1\}/)
  assert.match(shell, /role="tab" aria-selected=\{section\.active\}[\s\S]*tabIndex=\{index === activeSectionIndex \? 0 : -1\}/)
})

test('the tablist always exposes one roving stop and honest tab counts', () => {
  // no active section (a committed text without its section token) still leaves tab 0 focusable,
  // and the one results panel stays labelled by that same fallback tab
  assert.match(shell, /const activeSectionIndex = Math\.max\(0, sections\.findIndex/)
  assert.match(shell, /tabIndex=\{index === activeSectionIndex \? 0 : -1\}/)
  // the pages default their leading section active, so aria-selected agrees with the fallback stop
  assert.match(evals, /active: section !== 'reviewed'/)
  assert.match(issues, /active: section === '' \|\| section === 'open'/)
  // blind rows travel through the SAME engine as reading:false items: the Current COUNT comes out
  // rest-of-query (a blind row keeps counting while Reviewed is displayed) while the RENDERED blind
  // rows still obey the full query, section included
  assert.match(evals, /reading: false, filterKind: 'blind'/)
  assert.match(evals, /filters\.shown\.filter\(\(item\) => item\.filterKind === 'blind'\)/)
  assert.match(evals, /count: currentCount/)
  // a detail's way back to the list is the scoped DEFAULT list, never a scope-only text
  assert.match(page, /const listHref = routeHash\('evals', null, sessionId \? \{ q: scopedEvalQuery\(sessionId\) \} : null\)/)
})

test('overflow radio sets and section tabs expose complete ARIA ownership', () => {
  assert.match(shell, /role="group"[\s\S]*aria-labelledby=\{`\$\{groupId\}-group-\$\{index\}`\}/)
  assert.match(shell, /className="rl-menu-label" id=\{`\$\{groupId\}-group-\$\{index\}`\}/)
  assert.match(shell, /role="tablist" aria-label=\{title\} aria-orientation="horizontal"/)
  assert.match(shell, /role="tab" aria-selected=\{section\.active\} aria-controls=\{panelId\}/)
  assert.match(shell, /role="tabpanel" id=\{panelId\} aria-labelledby=\{tabId\(activeSectionIndex\)\}/)

  const tabHandler = shell.slice(shell.indexOf("if (!['ArrowLeft', 'ArrowRight'"), shell.indexOf('tabs[next]?.click()'))
  assert.match(tabHandler, /'ArrowLeft', 'ArrowRight', 'Home', 'End'/)
  assert.doesNotMatch(tabHandler, /ArrowUp|ArrowDown/)
})

test('one icon-label-tone mapping drives every review state home', () => {
  assert.match(shell, /export const REVIEW_STATE_VISUALS = \{[\s\S]*issue:[\s\S]*eval:/)
  assert.match(shell, /open: \{ icon: 'issue-opened', tone: 'open'/)
  assert.match(shell, /closed: \{ icon: 'issue-closed', tone: 'closed'/)
  assert.match(shell, /pass: \{ icon: 'circle-check', tone: 'pass'/)
  assert.match(shell, /fail: \{ icon: 'circle-x', tone: 'fail'/)

  assert.match(evals, /state=\{<ReviewState kind="eval" state=\{e\.state\}/)
  assert.match(issues, /state=\{<ReviewState kind="issue" state=\{status\}/)
  assert.match(issues, /<ReviewState kind="issue" state=\{status\} showLabel/)
  assert.match(detail, /<ReviewState kind="eval" state=\{readingScore\(viewing\)\} showLabel/)
  assert.match(detail, /<ReviewState kind="eval" state=\{state\} size=\{13\}/)
  assert.match(issueCard, /<ReviewState kind="issue" state=\{status\} showLabel/)
  assert.doesNotMatch(`${evals}\n${detail}`, />\s*[✓✗☑]\s*</)
  assert.doesNotMatch(issueCard, /issue-state|[✓✗○]/)
  assert.doesNotMatch(css, /\.issue-state/)
  assert.match(shell, /className="review-state-icon" style=\{\{ width: size, height: size \}\}/)
  assert.match(css, /\.rl-row-state\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;[^}]*place-items:\s*center;/s)
  for (const name of ['circle-check', 'circle-x', 'circle-minus', 'circle-dashed']) {
    assert.match(icons, new RegExp(`'${name}': \\{ vb: 16, sw: 1\\.5`))
  }
  assert.doesNotMatch(css, /\.review-state\.eval|\.rl-row-state[^}]*\.eval/)
})

test('graph keeps the full canvas and mounts no persistent focus sidebar', () => {
  assert.equal(existsSync(join(here, 'FocusPanel.jsx')), false)
  assert.doesNotMatch(dashboard, /FocusPanel|spex\.fpWidth|--fp-w|FOCUS_X_BIAS/)
  assert.match(dashboard, /nodeOrigin=\{NODE_ORIGIN\}/)
  assert.match(dashboard, /x:\s*el\.clientWidth \/ 2 - node\.x \* z/)
  assert.match(dashboard, /requestAnimationFrame\(\(\) => \{\s*framedRef\.current = true\s*centerOn\(focus, undefined, 0\)/)
  assert.match(dashboard, /const animateView = useCallback/)
  assert.match(css, /\.react-flow__node\s*\{[^}]*transition:\s*opacity/s)
  assert.doesNotMatch(css, /\.react-flow__node\s*\{[^}]*transition:[^}]*transform/s)
  assert.doesNotMatch(css, /\.focus-panel|\.fp-sc-|--fp-w/)
  assert.match(css, /\.page-graph\s*\{[^}]*flex:\s*1;[^}]*position:\s*relative;/s)
  assert.match(css, /\.graph\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s)
})

test('responsive ListView matches the measured 32/48/64 desktop and 390px reflow contract', () => {
  assert.match(css, /\.rl-query\s*\{[^}]*height:\s*32px;/s)
  assert.match(css, /\.lp-head\s*\{[^}]*height:\s*48px;/s)
  assert.match(css, /\.rl-row-grid\s*\{[^}]*min-height:\s*64px;/s)
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.lp-head\s*\{[^}]*height:\s*49px;/s)
  assert.match(css, /\.rl-facet-wrap:not\(\.mobile-stay\)\s*\{\s*display:\s*none;/)
  assert.match(css, /\.rl-row-title\s*\{[^}]*-webkit-line-clamp:\s*3;/s)
})

test('shared list empty state distinguishes a vacant dataset from a filtered zero', () => {
  const source = shell.match(/export const listEmptyText = ([\s\S]*?\n\))\n\nexport const facetMenuOptions/)?.[1]
  assert.ok(source, 'listEmptyText stays a directly testable shared primitive')
  const message = Function(`return (${source})`)()
  assert.equal(message({ hasData: false, dataset: 'none yet', filtered: 'no match' }), 'none yet')
  assert.equal(message({ hasData: true, dataset: 'none yet', filtered: 'no match' }), 'no match')
  assert.equal(message('loading'), 'loading')

  assert.match(issues, /hasData: all\.length > 0,[\s\S]*dataset: t\('session\.issuesEmpty'\),[\s\S]*filtered: t\('session\.issuesNoMatch'\)/)
  assert.match(evals, /hasData: entries\.length > 0 \|\| blind\.length > 0,[\s\S]*dataset: t\('evalsFeed\.datasetEmpty'\),[\s\S]*filtered: t\('evalsFeed\.noMatches'\)/)
  for (const messages of [en, zh]) {
    assert.match(messages, /datasetEmpty:/)
    assert.match(messages, /noMatches:/)
    assert.match(messages, /issuesNoMatch:/)
  }
})

test('the detail shell back affordance is a real derived anchor, never history.back', () => {
  // DetailShell renders backHref as a REAL <a> with the icon-system arrow + forced tooltip/aria pair
  assert.match(shell, /backHref && \(\s*<a className="ds-back" href=\{backHref\} data-tip=\{backLabel\} aria-label=\{backLabel\}>/)
  assert.match(shell, /<Icon name="arrow-left" size=\{16\} \/>/)
  assert.match(icons, /'arrow-left':/)
  // no review surface ever navigates by history.back — the href derives from the canonical address
  for (const src of [shell, page, detail, issues]) assert.doesNotMatch(src, /history\.back\(/)
  // both pages derive the href through the ONE address helper ([[address-routing]])
  assert.match(page, /detailBackHash\('evals', query\.q \|\| ''\)/)
  assert.match(issues, /backHref=\{detailBackHash\('issues'\)\}/)
  // localized labels exist in both dictionaries
  for (const dict of [en, zh]) {
    assert.match(dict, /backToEvals:/)
    assert.match(dict, /backToIssues:/)
    assert.match(dict, /backToSession:/)
  }
})

test('media keeps intrinsic geometry — shrink-only, no flex-stretch, no forced width', () => {
  // the clip + evidence media: intrinsic size capped by the column, never width:100% stretch
  assert.match(css, /\.an-video \{ display: block; inline-size: auto; block-size: auto; max-inline-size: 100%;/)
  assert.match(css, /\.an-image \{ display: block; inline-size: auto; block-size: auto; max-inline-size: 100%;/)
  assert.match(css, /\.eval-video \{ display: block; inline-size: auto; block-size: auto; max-inline-size: 100%;/)
  // media homes may not stretch their children wide (the flex-column default)
  assert.match(css, /\.an-gallery \{ display: flex; flex-direction: column; align-items: flex-start;/)
  assert.match(css, /\.fv-reply-media \{ display: flex; flex-direction: column; align-items: flex-start;/)
  // the player chrome shrink-wraps the clip it plays, with only a bar-usability floor
  assert.match(css, /\.an-player \{ inline-size: fit-content; min-inline-size: min\(360px, 100%\); max-inline-size: 100%; \}/)
  assert.match(css, /\.an-stage \{ position: relative; inline-size: fit-content; max-inline-size: 100%;/)
})
