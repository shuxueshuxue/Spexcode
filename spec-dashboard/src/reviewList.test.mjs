import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import enMessages from './i18n/en.js'
import zhMessages from './i18n/zh.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(here, name), 'utf8')
const shell = read('ReviewShell.jsx')
const issues = read('IssuesPage.jsx')
const issueCard = read('IssueCard.jsx')
const dashboard = read('Shell.jsx') + read('GraphView.jsx') + read('views.jsx')
const css = read('styles.css')
const filters = readFileSync(join(here, '../../packages/spec-core/src/review/reviewFilters.js'), 'utf8')
const nodeView = read('NodeView.jsx')
const palette = read('SpecSearch.jsx')
const data = read('data.js')
const serverReviews = read('../../spec-cli/src/reviews.ts')
const serverIndex = read('../../spec-cli/src/index.ts')
const icons = read('icons.jsx')
const en = read('i18n/en.js')
const zh = read('i18n/zh.js')

test('Issues consumes the shared GitHub ListView primitive set', () => {
  assert.match(issues, /<ListPage/)
  assert.match(issues, /<FacetMenu/)
  assert.match(issues, /<SecondaryFilters/)
  assert.match(issues, /<ReviewListRow/)
  assert.doesNotMatch(issues, /FilterSelect/)
  const issueList = issues.slice(0, issues.indexOf('export function IssueDetailPage'))
  assert.doesNotMatch(issueList, /<select\b/)
  assert.match(shell, /className="rl-query rq"/)
  assert.match(shell, /className="rl-sections" role=\{sectionsAreTabs \? 'tablist' : 'group'\}/)
  assert.match(shell, /className="rl-facets"/)
  assert.match(shell, /className="rl-row-grid"/)
  assert.match(shell, /!listOwnsKey\(event\.target, event\.key\)/)
  assert.doesNotMatch(issues, /issueFilterModel\(/)
  assert.match(serverReviews, /issueFilterModel\(issues, tokenFilterState\(text, 'issue'\)/)
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
  assert.match(issues, /const surgery = \(key, value\) => /)
  assert.match(issues, /setToken\(text, key, value\)/)
  // ONE parse → ONE matcher runs server-side before slicing; pages consume full-set counts from the
  // response and never rematch the current 25 rows.
  assert.match(serverReviews, /tokenFilterState\(text, 'issue'\)/)
  assert.match(serverReviews, /paginateReview\(issues, model\.shown/)
  assert.match(issues, /const openCount = data\?\.counts\?\.open \|\| 0/)
  assert.match(issues, /surgery\('state', 'open'\)/)
  assert.match(issues, /surgery\('state', 'closed'\)/)
  // the default view is the BARE address; anything else exactly ?q=<raw text>
  assert.match(issues, /queryParam\(nextText, ISSUE_QUERY_DEFAULT\)/)
})

test('bounded secondary consumers expose one real-entity page and direct full-list commands', () => {
  assert.match(nodeView, /useReviewPage\('issues', query, 1/)
  assert.match(nodeView, /summary=\{\{ shown: issues\.length, total: page\.data\.total \}\}/)
  assert.match(nodeView, /reviewListAddress\('issues', query\)/)
  assert.doesNotMatch(nodeView, /\bnode\.(?:issues|openIssues)\b/)

  // The palette is NOT one of those consumers any more. It carries two planes — nodes and sessions, the
  // things a tab can hold — issues go to their own list page, which is what that page is
  // for. So it makes no review request at all: no page hook, no "all results" doors, no server-matched
  // plane to preserve an order for. Both planes now come out of the board the shell already handed it.
  assert.match(palette, /const BASE_PLANES = \['spec', 'session'\]/)
  assert.doesNotMatch(palette, /useReviewPage/)
  assert.doesNotMatch(palette, /reviewListAddress/)
  assert.doesNotMatch(palette, /search-review-link/)
  assert.doesNotMatch(palette, /SERVER_MATCHED_PLANES/)
  assert.doesNotMatch(palette, /\bissueQuery\b/)
  assert.doesNotMatch(palette, /reviewList\.showing/)
  assert.doesNotMatch(palette, /\bs\.(?:issues|openIssues)\b/)
  // and the dictionaries lose the rows with it — a key nothing renders is a promise nothing keeps.
  for (const dict of [en, zh]) {
    assert.doesNotMatch(dict, /allIssues:/)
  }
})

test('the committed text replays as a continuable edit — one trailing space, parked caret, display-only', () => {
  // the display normalizer: trimmed tokens + exactly ONE trailing ASCII space; empty stays empty
  assert.match(shell, /export const continuableText = /)
  assert.match(shell, /return t \? `\$\{t\} ` : ''/)
  // every committed replay re-seeds the continuable form; only a CHANGED committed value takes focus
  // (the value compare keeps a cold load — and StrictMode's replayed mount — from stealing page focus)
  assert.match(shell, /setDraft\(continuableText\(value\)\); setCaret\(-1\); setActive\(-1\)/)
  assert.match(shell, /parkCaret\(seen\.current !== null && seen\.current !== value\)/)
  // the parked caret sits at the very end, after the trailing space
  assert.match(shell, /input\.setSelectionRange\(input\.value\.length, input\.value\.length\)/)
  // submit stays the normalizing edge: outer whitespace trimmed BEFORE the engine compares/pushes,
  // and the visible value re-seeds its continuable form even when the URL is unchanged — an emptied
  // submit refills from the COMMITTED text (the bare address never re-fires the [value] replay)
  assert.match(shell, /const trimmed = text\.trim\(\)/)
  assert.match(shell, /setDraft\(continuableText\(trimmed\) \|\| continuableText\(value\)\)/)
  assert.match(shell, /onSubmit\(trimmed\)/)
})

test('high-cardinality dimensions are token-only: no enumerating dropdowns, bounded suggestions', () => {
  // the big-list Author/Filer/Spec-node/session-scope menus are GONE
  assert.doesNotMatch(issues, /facetAuthor|facetNode|facetFiler|facetScope/)
  assert.doesNotMatch(issues, /authorOptions|nodeOptions|filerOptions|scopeOptions/)
  // suggestions come only from the issue data
  assert.match(issues, /author: facetOptions\(data, 'author'/)
})

test('the source-session facet speaks presence, never liveness', () => {
  // the ONE membership join lives in the engine's presence facet — pages only render its options
  assert.match(filters, /sessionPresent/)
  assert.match(filters, /fixedValues: \['present', 'missing'\]/)
  assert.match(filters, /reviewList\.facetSession/)
  assert.doesNotMatch(filters, /liveSession|facetLive|'live'/)
  assert.match(issues, /sessionFacet/)
  assert.doesNotMatch(issues, /liveSession|liveOnly|facetLive/)
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
  // The production predicate delegates typing ownership to KeyboardService. Supply that shared contract
  // explicitly when evaluating the extracted function; leaving it as an implicit global made this source
  // fixture fail even though the browser module had the dependency.
  const isTypingTarget = (target) => Boolean(target && (
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      || target.isContentEditable
      || target.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
  ))
  const owns = Function('isTypingTarget', `return (${source})`)(isTypingTarget)
  const target = (tagName, anchor = false) => ({
    tagName,
    closest: (selector) => (anchor && selector === 'a[href]' ? {} : null),
  })

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
  const source = shell.match(/export const facetMenuOptions = ([\s\S]*?\n})\n\nexport const secondaryFilterCounts/)?.[1]
  assert.ok(source, 'facetMenuOptions stays directly testable')
  const options = Function(`return (${source})`)()
  const all = { value: '', label: 'All' }

  assert.deepEqual(options([], '', 'All'), [])
  assert.deepEqual(options([{ value: 'all', label: 'all' }], 'all', null), [{ value: 'all', label: 'all' }])
  assert.deepEqual(options([], 'dead-session', 'All'), [all])
  assert.deepEqual(options([{ value: 'live', label: 'Live' }], 'gone', 'All'), [all, { value: 'live', label: 'Live' }])
  assert.deepEqual(options([all, { value: 'live', label: 'Live' }], 'gone', 'All'), [all, { value: 'live', label: 'Live' }])
  assert.match(issues, /<SecondaryFilters[^>]*clearLabel=\{t\('reviewList\.all'\)\}/)
})

test('one semantic secondary Filters trigger owns responsive active-group state', () => {
  const source = shell.match(/export const secondaryFilterCounts = ([\s\S]*?\n\}, \{ desktop: 0, mobile: 0 \}\))\n\nexport const rovingIndex/)?.[1]
  assert.ok(source, 'secondaryFilterCounts stays a directly testable shared primitive')
  const counts = Function(`return (${source})`)()

  assert.deepEqual(counts([]), { desktop: 0, mobile: 0 })
  assert.deepEqual(counts([
    { value: 'reviewed' },
    { value: 'stale', mobileOnly: true },
    { value: 'image', active: false, mobileOnly: true },
  ]), { desktop: 1, mobile: 2 })

  const secondary = shell.slice(shell.indexOf('export function SecondaryFilters'), shell.indexOf('export function ReviewListRow'))
  assert.match(secondary, /<Icon name="filter" size=\{14\} \/>/)
  assert.match(secondary, /<span>\{label\}<\/span>/)
  assert.match(secondary, /reviewList\.activeFilters/)
  assert.match(secondary, /<Icon name="chevron-down" size=\{12\} \/>/)
  assert.doesNotMatch(secondary, /ellipsis|kebab|More actions|moreFilters/)
  assert.match(issues, /secondaryFilters=\{<SecondaryFilters label=\{t\('reviewList\.filters'\)\}/)
  assert.equal(enMessages.reviewList.filters, 'Filters')
  assert.equal(enMessages.reviewList.activeFilters({ n: 1 }), '1 active filter')
  assert.equal(enMessages.reviewList.activeFilters({ n: 2 }), '2 active filters')
  assert.equal(zhMessages.reviewList.filters, '筛选')
  assert.equal(zhMessages.reviewList.activeFilters({ n: 2 }), '2 个已启用筛选')
  // a control's label is language, so it sets in the UI font like every other control ([[typography]])
  assert.match(css, /\.rl-secondary-filters-trigger \{[^}]*height: 32px;[^}]*font-family: var\(--ui-font\);/s)
  assert.match(css, /\.rl-secondary-filter-count\.for-mobile \{ display: none; \}/)
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.rl-secondary-filter-count\.for-desktop \{ display: none; \}[\s\S]*\.rl-secondary-filter-count\.for-mobile \{ display: inline-flex; \}/s)
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
  assert.match(shell, /role=\{sectionsAreTabs \? 'tab' : undefined\}[\s\S]*aria-selected=\{sectionsAreTabs \? section\.active : undefined\}/)
  assert.match(shell, /tabIndex=\{sectionsAreTabs \? \(index === activeSectionIndex \? 0 : -1\) : undefined\}/)
})

test('secondary-filter radios and Issues tabs expose honest ARIA ownership', () => {
  assert.match(shell, /role="group"[\s\S]*aria-labelledby=\{`\$\{groupId\}-group-\$\{index\}`\}/)
  assert.match(shell, /className="rl-menu-label" id=\{`\$\{groupId\}-group-\$\{index\}`\}/)
  assert.match(shell, /role=\{sectionsAreTabs \? 'tablist' : 'group'\} aria-label=\{title\}/)
  assert.match(shell, /aria-controls=\{sectionsAreTabs \? panelId : undefined\}/)
  assert.match(shell, /role=\{sectionsAreTabs \? 'tabpanel' : 'region'\}/)
  assert.match(shell, /aria-label=\{sectionsAreTabs \? undefined : title\}/)

  const tabHandler = shell.slice(shell.indexOf("if (!['ArrowLeft', 'ArrowRight'"), shell.indexOf('tabs[next]?.click()'))
  assert.match(tabHandler, /'ArrowLeft', 'ArrowRight', 'Home', 'End'/)
  assert.doesNotMatch(tabHandler, /ArrowUp|ArrowDown/)
})

test('one icon-label-tone mapping drives every review state home', () => {
  assert.match(shell, /export const REVIEW_STATE_VISUALS = \{[\s\S]*issue:/)
  assert.match(shell, /open: \{ icon: 'issue-opened', tone: 'open'/)
  assert.match(shell, /closed: \{ icon: 'issue-closed', tone: 'closed'/)
  assert.match(issues, /state=\{<ReviewState kind="issue" state=\{status\}/)
  assert.match(issues, /<ReviewState kind="issue" state=\{status\} showLabel/)
  assert.match(issueCard, /<ReviewState kind="issue" state=\{status\} showLabel/)
  assert.doesNotMatch(issueCard, /issue-state|[✓✗○]/)
  assert.doesNotMatch(css, /\.issue-state/)
  assert.match(shell, /className="review-state-icon" style=\{\{ width: size, height: size \}\}/)
  assert.match(css, /\.rl-row-state\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;[^}]*place-items:\s*center;/s)
  for (const name of ['circle-minus', 'circle-dashed']) {
    assert.match(icons, new RegExp(`'${name}': \\{ vb: 16, sw: 1\\.5`))
  }
})

test('graph keeps the full canvas and mounts no persistent focus sidebar', () => {
  assert.equal(existsSync(join(here, 'FocusPanel.jsx')), false)
  assert.doesNotMatch(dashboard, /FocusPanel|spex\.fpWidth|--fp-w|FOCUS_X_BIAS/)
  assert.match(dashboard, /nodeOrigin=\{NODE_ORIGIN\}/)
  assert.match(dashboard, /viewportForFocus\(\{[\s\S]*visible:\s*specs2/s)
  assert.match(dashboard, /framedRef\.current = true[\s\S]*centerOn\(focus, undefined, 0\)/)
  assert.match(dashboard, /const animateView = useCallback/)
  assert.match(css, /\.react-flow__node\s*\{[^}]*transition:\s*opacity/s)
  assert.doesNotMatch(css, /\.react-flow__node\s*\{[^}]*transition:[^}]*transform/s)
  assert.doesNotMatch(css, /\.focus-panel|\.fp-sc-|--fp-w/)
  assert.match(css, /\.page-pane\.page-graph\s*\{[^}]*display:\s*block;[^}]*position:\s*relative;/s)
  assert.match(css, /\.graph\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s)
})

test('responsive ListView matches the measured 32/48/64 desktop and 390px reflow contract', () => {
  assert.match(css, /\.rl-query\s*\{[^}]*height:\s*32px;/s)
  assert.match(css, /\.rl-query\s*\{[^}]*background:\s*var\(--paper\);/s)
  assert.match(css, /\.lp-head\s*\{[^}]*height:\s*48px;/s)
  assert.match(css, /\.rl-row-grid\s*\{[^}]*min-height:\s*64px;/s)
  // 49px is now the phone header's FLOOR, not its cap: it grows downward only when its own content needs a
  // second line (a split count does; Issues does not), and a control is never clipped or dropped for width.
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.lp-head\s*\{[^}]*min-height:\s*49px;[^}]*flex-wrap:\s*wrap;/s)
  assert.doesNotMatch(css, /@media \(max-width: 760px\)[\s\S]*\.lp-head\s*\{[^}]*[^-]height:\s*49px;/s)
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.rl-section\s*\{\s*gap:\s*2px;\s*padding:\s*0;[^}]*min-height:\s*44px;\s*\}[\s\S]*\.rl-section \.review-state-label\s*\{\s*font-size:\s*var\(--type-meta\);\s*\}/s)
  // the phone facets stay their natural width (the live declaration; a shadowed `flex: 1 1 auto` copy once
  // sat earlier in the same block and the gate pinned the dead one)
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.rl-facets\s*\{\s*flex:\s*none;\s*\}/s)
  assert.doesNotMatch(css, /@media \(max-width: 760px\)[\s\S]*\.rl-facets\s*\{\s*flex:\s*1 1 auto;/s)
  assert.match(css, /\.rl-facet-wrap:not\(\.mobile-stay\)\s*\{\s*display:\s*none;/)
  assert.match(shell, /const buttonLabel = selectedLabel \? `\$\{label\}: \$\{selectedLabel\}` : label/)
  assert.match(shell, /className="rl-facet-label-mobile" aria-hidden="true">\{selectedLabel \|\| label\}/)
  assert.match(css, /\.rl-facet-wrap\.mobile-stay \.rl-facet \{ max-width: 64px; gap: 3px; padding: 0 3px;/)
  assert.match(css, /\.rl-secondary-filters-trigger:not\(\.compact\) \{ gap: 3px; padding: 0 4px; \}/)
  assert.match(css, /\.rl-row-title-text\s*\{[^}]*-webkit-line-clamp:\s*3;/s)
})

test('shared list empty state distinguishes a vacant dataset from a filtered zero', () => {
  const source = shell.match(/export const listEmptyText = ([\s\S]*?\n\))\n\nexport const facetMenuOptions/)?.[1]
  assert.ok(source, 'listEmptyText stays a directly testable shared primitive')
  const message = Function(`return (${source})`)()
  assert.equal(message({ hasData: false, dataset: 'none yet', filtered: 'no match' }), 'none yet')
  assert.equal(message({ hasData: true, dataset: 'none yet', filtered: 'no match' }), 'no match')
  assert.equal(message('loading'), 'loading')

  assert.match(issues, /hasData: \(data\?\.sourceTotal \?\? 0\) > 0,[\s\S]*dataset: t\('session\.issuesEmpty'\),[\s\S]*filtered: t\('session\.issuesNoMatch'\)/)
  for (const messages of [en, zh]) {
    assert.match(messages, /issuesNoMatch:/)
  }
})

test('the detail shell back affordance is a real derived anchor, never history.back', () => {
  // DetailShell renders backHref as a REAL <a> with the icon-system arrow + forced tooltip/aria pair
  assert.match(shell, /backHref && \(\s*<a className="ds-back" href=\{backHref\} data-tip=\{backLabel\} aria-label=\{backLabel\}>/)
  assert.match(shell, /<Icon name="arrow-left" size=\{16\} \/>/)
  assert.match(icons, /'arrow-left':/)
  // no review surface ever navigates by history.back — the href derives from the canonical address
  for (const src of [shell, issues]) assert.doesNotMatch(src, /history\.back\(/)
  assert.match(issues, /backHref=\{detailBackHash\('issues'\)\}/)
  // localized labels exist in both dictionaries; the retired console-back label is gone
  for (const dict of [en, zh]) {
    assert.match(dict, /backToIssues:/)
    assert.doesNotMatch(dict, /backToSession:/)
  }
})

test('Issue detail is one addressed object and never reconstructs from graph or a list page', () => {
  // the one non-issue word in the family is the compose address: `#/issues/new` is a PAGE, so the detail
  // loader is never asked for an issue called 'new' ([[issues-view]]).
  assert.match(issues, /const detail = useIssueDetail\(composing \? null : param, issuesStamp\)/)
  assert.match(issues, /export const NEW_PARAM = 'new'/)
  assert.match(issues, /const value = await loadIssue\(id\)/)
  assert.match(data, /apiFetch\(`\/api\/issues\/\$\{encodeURIComponent\(id\)\}`\)/)
  assert.match(serverIndex, /app\.get\('\/api\/issues\/:id'/)
  assert.doesNotMatch(issues, /specs\.(?:issues|openIssues)|sessions\.(?:issues|openIssues)|\.find\([^\n]*issue\.id/)
})

test('an open review surface follows the board issue-freshness stamp, never board-frame churn', () => {
  // [[remark-substrate]] write-visibility, the CLIENT leg. The server moves ONE board stamp on every thread
  // write; a surface that watches something else is only accidentally fresh. Measured regression: the issue
  // DETAIL watched nothing at all and an externally-written remark never appeared (>30s, twice the cold
  // lane), while the list survived on the sessions ARRAY's per-frame identity — a key that reads as
  // freshness while being blind to the data, and that a memoized board reconstruction would silence.
  const app = read('App.jsx')
  // the board's own field reaches both shells — the stamp is the signal, not a derived proxy
  assert.match(app, /<MobileApp[^\n]*issuesStamp=\{board\.issuesStamp\}/)
  assert.match(app, /issuesStamp: board\.issuesStamp/)
  assert.match(dashboard, /<IssuesPage[^\n]*issuesStamp=\{issuesStamp\}/)
  // the list keys on what its ANSWER depends on: the issue population + the presence join, nothing else
  assert.match(issues, /refreshKey: `\$\{issuesStamp \?\? ''\}\|\$\{presenceKey\}`/)
  assert.doesNotMatch(issues, /refreshKey: sessions\b/)
  // the open thread re-reads on a stamp tick, and only a NEW ADDRESS may wipe it to the loading face
  assert.match(issues, /useIssueDetail\(id, freshness\)/)
  assert.match(issues, /\}, \[id, freshness, reload\]\)/)
  assert.match(issues, /if \(id !== shownId\.current\) \{ shownId\.current = id; setIssue\(null\); setError\(null\) \}/)
})

test('New is a routed compose PAGE reusing the shared shells, never a pop-out over the list', () => {
  // the door is a real anchor into the family's third address — no click handler re-implements routing
  assert.match(issues, /className="rl-new" href=\{routeHash\('issues', NEW_PARAM\)\}/)
  // the page wears the SAME DetailShell (back anchor + main + rail) and the SAME composer surface every
  // other writing box uses ([[review-chrome]] / [[composer]]) — no page-local layout or textarea dialect
  assert.match(issues, /function NewIssuePage\([\s\S]*<DetailShell[\s\S]*backHref=\{detailBackHash\('issues'\)\}/)
  assert.match(issues, /function NewIssuePage\([\s\S]*<ComposerSurface[\s\S]*className="fv-new-compose"/)
  assert.match(issues, /function NewIssuePage\([\s\S]*<TriggerButton[\s\S]*typeTrigger\(taRef\.current, '@'/)
  // Cancel returns by the SAME derived list address the back anchor uses, never history.back
  assert.match(issues, /<a className="fv-cancel" href=\{detailBackHash\('issues'\)\}>/)
  assert.doesNotMatch(issues, /Modal|fv-new-modal|useEscLayer/)
  // one insertion mechanism for the grammar's doors — Thread's composer types through the same helper
  assert.match(read('Thread.jsx'), /typeTrigger\(taRef\.current, trigger, setBody/)
  assert.match(read('mentions.jsx'), /export function typeTrigger\(/)
  for (const dict of [en, zh]) {
    for (const key of ['issuesNewTitle:', 'issuesTitleLabel:', 'issuesBodyLabel:', 'issuesWrite:', 'issuesPreview:', 'issuesNodesHint:']) {
      assert.match(dict, new RegExp(key))
    }
  }
})

test('the detail side rail is sticky on desktop, plain flow at phone width', () => {
  // desktop: sticky inside the grid column (never fixed) — pins to the scrollport top; only a rail
  // taller than the viewport scrolls internally (bounded max-height + auto overflow)
  assert.match(css, /\.ds-side \{ position: sticky; top: 0; min-width: 0; max-height: calc\(100dvh - 24px\); overflow-y: auto;/)
  assert.doesNotMatch(css, /\.ds-side[^}]*position: fixed/)
  // the phone reflow cancels it: static, unbounded, metadata-before-content order kept
  const phone = css.slice(css.indexOf('@media (max-width: 760px)'))
  assert.match(phone, /\.ds-side \{ position: static; align-self: stretch; width: 100%; max-height: none; overflow-y: visible; order: -1;/)
})

test('pagination stays in the list page scroll flow below the list, outside the sticky stack', () => {
  assert.match(shell, /export function Pagination\(/)
  assert.match(shell, /<PageScroll className="lp-page">[\s\S]*<section className="rl-list">[\s\S]*<\/section>\s*\{pagination && <Pagination \{\.\.\.pagination\} \/>\}[\s\S]*<\/PageScroll>/)
  assert.match(css, /\.rl-pagination \{ max-width: 100%; display: flex; flex-wrap: wrap;/)
  assert.doesNotMatch(css, /\.rl-pagination\s*\{[^}]*position:\s*sticky/)
  assert.match(css, /\.lp-head \{ position: sticky; top: 0;/)
})

test('one side-rail value primitive renders every detail metadata row on both pages', () => {
  // the ONE SideValue primitive: shrinkable min-width:0 text with ellipsis, full text on the tooltip
  assert.match(shell, /export function SideValue\(/)
  assert.match(css, /\.ds-val \{ display: flex; align-items: center; gap: 5px; max-width: 100%; min-width: 0;/)
  assert.match(css, /\.ds-val-text \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/)
  // the link's keyboard focus is the one shared ring; the rule keeps only the radius the ring follows
  assert.match(css, /\.ds-val\.link:focus-visible \{ border-radius: var\(--radius\); \}/)
  // the originator liveness chip is an identity SKIN over SideValue, not a parallel span/button pair
  const thread = read('Thread.jsx')
  assert.match(thread, /<SideValue text=\{originator\} tip=\{title\} label=\{title\} lead=\{dot\}/)
  assert.doesNotMatch(thread, /fv-originator-who/)
  // the issue detail names its own id under a localized Issue label; nodes/store/permalink/forge-by all
  // ride SideValue — the page keeps no parallel inline variant (fv-by / fv-chip / fv-link are gone)
  assert.match(issues, /<SideSection label=\{t\('detail\.sideIssue'\)\}>\s*<SideValue text=\{th\.id\} mono \/>/)
  assert.match(issues, /<SideValue key=\{id\} text=\{id\} mono tip=\{t\('session\.issuesFocusNode'\)\} href=\{addressHash\(graphNodeAddress\(id\)\)\} \/>/)
  assert.doesNotMatch(issues, /fv-by|fv-chip|fv-link|ds-side-line/)
  assert.doesNotMatch(css, /\.fv-by|\.fv-chip|\.fv-link \{|\.ds-side-line|\.fv-originator-who/)
  // localized type labels exist in both dictionaries
  for (const dict of [en, zh]) {
    assert.match(dict, /sideIssue:/)
    assert.match(dict, /sideNode:/)
  }
})

test('list metadata keeps native controls beside the real detail anchor', () => {
  assert.match(shell, /<a className="lp-row-link" href=\{row\.href\}/)
  // it stays a REAL anchor — plain click, middle-click, shift and a copied address are all still the
  // browser's — and gains only the two gestures the workspace itself owns ([[tab-strip]]): ctrl/⌘ opens
  // the address in a new tab, right-click offers the same action plus copy.
  assert.match(shell, /onClick=\{\(event\) => newTabAnchor\(event, row\.href\)\}/)
  assert.match(shell, /setRowMenu\(\{ x: event\.clientX, y: event\.clientY, href: row\.href \}\)/)
  assert.match(css, /\.lp-row-link \{ position: absolute; inset: 0; z-index: 0;/)
  assert.match(css, /\.rl-row-grid \{ position: relative; z-index: 1;[\s\S]*pointer-events: none;/)
  assert.match(css, /\.rl-row-grid a, \.rl-row-grid button \{ pointer-events: auto; \}/)
  assert.match(issues, /IssueLabels labels=\{th\.labels\} onSelect=\{\(name\) => surgery\('label', name\)\}/)
  assert.match(issues, /<a className="rl-tag node" href=\{addressHash\(graphNodeAddress\(th\.nodes\[0\]\)\)\}>/)
  assert.match(issues, /ISSUE_QUERY_KEYS = \['is', 'state', 'store', 'author', 'node', 'label', 'session'\]/)
})

test('issue evidence media keeps intrinsic geometry — shrink-only, no flex-stretch', () => {
  assert.match(css, /\.fv-reply-media \{ display: flex; flex-direction: column; align-items: flex-start;/)
  assert.match(css, /\.fv-reply-media \{ display: flex; flex-direction: column; align-items: flex-start;/)
  // the player chrome shrink-wraps the clip it plays, with only a bar-usability floor
})
