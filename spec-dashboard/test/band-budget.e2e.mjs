// [[ui-state-model]] BAND-BUDGET GATE: the machine-checkable form of "不要层层叠叠".
//
// The workspace's frontend state is a product of five axes (route kind, left dock, right context, split,
// session surface). For every reachable state the model PREDICTS how many chrome bands the shell may
// stack — B(state) = 1(rail) + dock + 1(tabstrip) + 1(statusbar) + context, bounded 3..5. This probe
// walks a representative traversal of that state space in a real Chromium against the running dashboard,
// COUNTS the bands the DOM actually renders, and fails on any state where measured ≠ predicted.
//
// A band is a non-scrolling chrome container between the window edge and the content. Resize handles are
// not bands; overlays (palette, popup, menu) are z-layers, not bands; the preview slot is a tab property,
// not a band. The classifier below is the operational definition — see `measureBands`.
//
// THE TAB STRIP IS ONE BAND HOWEVER MANY ROWS IT WRAPS TO. Wrapping is the strip's internal layout — the
// working set laid out on more than one line ([[tab-strip]]) — not a second band stacked on the first, and
// a model that counted rows would be counting the reader's open documents as chrome. So every state below
// is entered with a working set DEEP ENOUGH TO WRAP, and the strip's row count is measured and printed
// beside the band count. Measuring the fattest strip rather than an empty one is the stronger gate: an
// empty strip is the one shape in which a stowaway band has nowhere to hide.
//
//   BASE=http://127.0.0.1:5199 node spec-dashboard/test/band-budget.e2e.mjs
//
// Env: BASE (dev server), OUT (artifact dir), SPEXCODE_PLAYWRIGHT_PATH, BAND_SURFACES=all (include the
// session surfaces that need backend state this probe cannot guarantee — diff, resource).
import { pathToFileURL } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5199'
const OUT = process.env.OUT || '/tmp/band-budget'
const ALL_SURFACES = process.env.BAND_SURFACES === 'all'
mkdirSync(OUT, { recursive: true })

// ===================================================================================================
// 1. THE MODEL — the single source. The spec node states it in prose; this is the same function.
// ===================================================================================================

// R — route kind. `graph` is a LEGACY ADDRESS: reachable by typing it, never offered by the rail.
const ROUTES = ['graph', 'evals', 'issues', 'settings', 'empty', 'spec', 'file', 'session']
const DOCKS = ['closed', 'explorer', 'sessions']
const CONTEXTS = ['closed', 'open']
const SPLITS = ['none', 'open']
const SURFACES = ['conversation', 'terminal', 'diff', 'resource']

// THE SIDEBAR IS A PROPERTY OF THE FOCUSED TAB ([[dock-modes]]): a session tab brings the session list, a
// node or governed file brings the explorer, and the singleton boards have no natural sidebar — they render
// none and the main area takes the full width, rather than inheriting whatever the last tab was showing.
// `graph` is still in R: the address is still reachable and still measurable, it is simply no longer a
// rail destination ([[node-graph]]) — a retired entrance does not shrink the state space.
const SIDEBARLESS_ROUTES = new Set(['evals', 'issues', 'settings'])

const dockBand = (state) => (state.D !== 'closed' && !SIDEBARLESS_ROUTES.has(state.R) ? 1 : 0)
const contextBand = (state) => (state.R === 'spec' && state.C === 'open' ? 1 : 0)

// B(state) — the whole budget. Rail, tabstrip and statusbar are unconditional; the dock and the context
// dock are the only two conditional bands. Split adds a COLUMN, never a band. The session surface picks
// what fills the content area, never how much chrome frames it.
const B = (state) => 1 /* rail */ + dockBand(state) + 1 /* tabstrip */ + 1 /* statusbar */ + contextBand(state)

// The constraint set: C is meaningful only on a spec document, U only on a session. Everything else is
// free. Enumerated rather than asserted, so the cardinality is measured with the budget.
function enumerateStates() {
  const out = []
  for (const R of ROUTES) {
    for (const D of DOCKS) {
      for (const C of (R === 'spec' ? CONTEXTS : ['closed'])) {
        for (const S of SPLITS) {
          for (const U of (R === 'session' ? SURFACES : ['conversation'])) out.push({ R, D, C, S, U })
        }
      }
    }
  }
  return out
}

// ===================================================================================================
// 2. THE CLASSIFIER — what counts as a band, measured in the live DOM.
// ===================================================================================================

// Seeded with the shell's known chrome inventory, so a band that is thicker than the geometric threshold
// (a composer, a wrapping picker row) is still caught by name; the geometry rule below then catches
// chrome this list has never heard of.
const KNOWN_BANDS = [
  'side-rail', 'dock', 'dock-head', 'tabstrip', 'statusbar',
  'context-dock', 'ctx-head', 'si-tabbar', 'si-selbar', 'si-toolbar',
  'diff-toolbar', 'm-composer', 'lp-head', 'ds-head',
  // strips this gate named and the shell then retired. They stay listed so a reintroduction is caught by
  // NAME on its first frame, before anyone has to argue about its geometry.
  'dock-modebar', 'dock-session-head', 'dock-session-archive', 'app-main-top', 'ft-head',
  'fileview-head', 'srcview-foot', 'specview-files',
]

// Never a band, whatever its geometry: resize handles (a grab strip, not a row), the overlay z-layers,
// the accessibility-only spans, and third-party canvas internals that are content by construction.
const EXCLUDE_CLASSES = [
  'resize', 'divider', 'splitter', 'handle', 'sr-only', 'tooltip', 'ui-tip', 'palette',
  'search-backdrop', 'search-panel', 'popup', 'modal', 'overlay', 'backdrop', 'toast',
  'menu', 'ov-panel', 'react-flow__', 'notice',
]

const CONTAINER_TAGS = ['div', 'header', 'footer', 'nav', 'aside', 'section', 'main', 'form', 'ul', 'ol']

// Runs in the page. Returns the counted bands, in DOM order, with the geometry that justified each.
function measureBands(cfg) {
  const KNOWN = new Set(cfg.known)
  const CONTAINER = new Set(cfg.containerTags)
  const VW = window.innerWidth
  const VH = window.innerHeight
  const THIN = cfg.thin              // a band is thinner than this on its short axis
  const SPAN = cfg.span              // …covers at least this share of its parent's long axis
  const RUN = cfg.run                // …and is at least this long, so a control cluster is not a column

  const classOf = (el) => (typeof el.className === 'string' ? el.className : '')
  const classes = (el) => classOf(el).split(/\s+/).filter(Boolean)
  const known = (el) => classes(el).some((c) => KNOWN.has(c))
  const excluded = (el) => {
    const c = classOf(el)
    if (cfg.excludeClasses.some((bad) => c.includes(bad))) return true
    // a resize handle is a grab strip between two panes, not a row of chrome — it is never a band, and
    // this is the one exclusion the model calls out by name.
    if (el.getAttribute('role') === 'separator') return true
    if (el.getAttribute('aria-hidden') === 'true') return true
    return false
  }
  const overlayRole = new Set(['dialog', 'alertdialog', 'menu', 'listbox', 'tooltip'])

  const visible = (el, cs) => cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) > 0.01
  const inView = (r) => r.bottom > 1 && r.top < VH - 1 && r.right > 1 && r.left < VW - 1 && r.width >= 2 && r.height >= 2
  // A vertical scrollport is where the CONTENT starts: everything below it scrolls away, so nothing in it
  // is chrome. Membership is DECLARED, not measured — `overflow-y: auto` says "this is the document",
  // whether or not today's content happens to be short enough to fit. Measuring the runtime overflow
  // instead makes the band count depend on how much data loaded, which is how a spec-prose metadata row
  // and a CodeMirror source line got read as chrome. A horizontal-only scroller (the tab strip) is
  // still chrome.
  const scrollsY = (el, cs) => ['auto', 'scroll'].includes(cs.overflowY)
  // A collapsible section is content wearing a header, not a chrome row: the context dock's panels are the
  // dock's payload. Detected structurally, by the disclosure control it owns.
  const disclosureSection = (el) => [...el.children].some((k) => k.hasAttribute('aria-expanded'))

  const out = []

  const scan = (el, depth) => {
    if (depth > 14) return []
    const found = []
    for (const kid of el.children) {
      const cs = getComputedStyle(kid)
      if (!visible(kid, cs)) continue
      if (excluded(kid)) continue
      if (overlayRole.has(kid.getAttribute('role'))) continue

      const r = kid.getBoundingClientRect()
      const pr = el.getBoundingClientRect()
      const grows = parseFloat(cs.flexGrow || '0') > 0
      const floating = cs.position === 'fixed' || cs.position === 'absolute'
      // a full-bleed absolute layer (inset:0) is a layout device, not a floating overlay — descend it.
      const fullBleed = floating && r.width >= pr.width * 0.8 && r.height >= pr.height * 0.8

      if (scrollsY(kid, cs)) continue                       // the content starts here
      if (disclosureSection(kid)) continue                  // a collapsible payload, not a chrome row
      if (floating && !fullBleed) continue                  // a floating z-layer

      // Having a box of one's own and being on screen decides whether an element can BE a band; it does
      // not decide whether its children can. A zero-height positioning wrapper renders nothing itself and
      // holds an absolutely-positioned 817px layer — skipping its subtree is how the conversation
      // composer went uncounted while it sat plainly on screen.
      const onScreen = inView(r)
      // A band RUNS: it spans its region's long axis and stays thin on the short one. The absolute floor
      // on the long axis is what separates a chrome row from a small control cluster inside one — a 33px
      // icon group at the left of a 32px toolbar is "as tall as its parent and under 64px wide", which is
      // the shape of a column band and the shape of a button group alike. Length breaks the tie.
      const row = r.width >= pr.width * SPAN && r.width >= RUN && r.height >= 8 && r.height < THIN
      const column = r.height >= pr.height * SPAN && r.height >= RUN && r.width >= 8 && r.width < THIN
      const shaped = CONTAINER.has(kid.tagName.toLowerCase()) && !grows && !floating && (row || column)
      const isBand = onScreen && (known(kid) || shaped)

      const inner = scan(kid, depth + 1)
      if (isBand && inner.length === 0) {
        // leaf-most chrome. A wrapper whose only job is to hold a band collapses into the band it holds —
        // that is ONE band, which is what the model claims. But two sibling rows in one region (a dock
        // header above an archive strip) are TWO, which is the point.
        found.push({
          cls: classOf(kid) || `<${kid.tagName.toLowerCase()}>`,
          tag: kid.tagName.toLowerCase(),
          w: Math.round(r.width), h: Math.round(r.height),
          x: Math.round(r.x), y: Math.round(r.y),
          why: known(kid) ? 'inventory' : (row ? 'row' : 'column'),
        })
      } else {
        found.push(...inner)
      }
    }
    return found
  }

  out.push(...scan(document.body, 0))
  return out
}

// ===================================================================================================
// 3. THE TRAVERSAL — a representative walk, not 156 raw combinations.
// ===================================================================================================

const { chromium } = await import(pathToFileURL(PW).href)

const fetchJson = async (path) => {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json()
}

const board = await fetchJson('/api/graph')
const specs = board.specs || board.nodes || []
const sessionList = await fetchJson('/api/sessions')

// real addresses, discovered from the running board — never hardcoded ids.
const specNode = specs.find((n) => (n.code || []).some((p) => p.startsWith('spec-dashboard/src/')))
  || specs.find((n) => (n.code || []).length)
if (!specNode) throw new Error('no spec node with a governed file — cannot address #/spec or #/file')
const SPEC_ID = specNode.id
const FILE_PATH = specNode.code[0]
const secondSpec = specs.find((n) => n.id !== SPEC_ID && (n.code || []).length)?.id || SPEC_ID
const session = sessionList.find((s) => !s.archived && s.liveness === 'online') || sessionList.find((s) => !s.archived)
if (!session) throw new Error('no session on the board — cannot address #/sessions/<id>')

// The working set every state is entered with. Twelve real spec documents, named by their own titles, is
// past one row at this viewport with the dock either open or closed — so the strip WRAPS in every measured
// state and the "one band, however many rows" claim is exercised rather than asserted. Real addresses, so
// the labels are the board's own and the widths are the widths a reader would see.
const WRAP_TABS = specs.filter((n) => (n.title || '').length >= 9).slice(0, 12)
  .map((n) => ({ page: 'spec', param: n.id, query: null, pinned: true }))
if (WRAP_TABS.length < 12) throw new Error('need twelve spec nodes to fill the strip past one row')
const SESSION_ID = session.id

const encodeParam = (param) => String(param).split('/').map(encodeURIComponent).join('/')
const hashFor = (R) => ({
  graph: '#/graph',
  evals: '#/evals',
  issues: '#/issues',
  settings: '#/settings',
  empty: '#/empty',
  spec: `#/spec/${encodeParam(SPEC_ID)}`,
  file: `#/file/${encodeParam(FILE_PATH)}`,
  session: `#/sessions/${encodeParam(SESSION_ID)}`,
}[R])

// what proves the routed view actually mounted, so a measurement never samples a Suspense fallback.
const READY = {
  graph: '.viewhost.view-graph', evals: '.viewhost.view-evals', issues: '.viewhost.view-issues',
  settings: '.viewhost.view-settings', empty: '.viewhost.view-empty', spec: '.viewhost.view-spec',
  file: '.viewhost.view-file', session: '.viewhost.view-sessions .si-session-wrap',
}

// The representative traversal. Every route kind × every dock value; the context axis doubled on the one
// route that owns it; both session surfaces this probe can guarantee; one split state on a spec document.
function traversal() {
  const states = []
  for (const R of ROUTES) {
    for (const D of DOCKS) {
      if (R === 'spec') for (const C of CONTEXTS) states.push({ R, D, C, S: 'none', U: 'conversation' })
      else if (R === 'session') {
        // diff and resource need backend state this probe cannot guarantee (a worktree diff, a posted
        // resource); the loop stays written so they are one BAND_SURFACES=all away.
        const surfaces = ALL_SURFACES ? SURFACES : ['terminal', 'conversation']
        for (const U of surfaces) states.push({ R, D, C: 'closed', S: 'none', U })
      } else states.push({ R, D, C: 'closed', S: 'none', U: 'conversation' })
    }
  }
  // split: a second document beside the first. The model says a split adds a column, not a band.
  states.push({ R: 'spec', D: 'explorer', C: 'open', S: 'open', U: 'conversation' })
  states.push({ R: 'graph', D: 'explorer', C: 'closed', S: 'open', U: 'conversation' })
  return states
}

const stateName = (s) => `R=${s.R} D=${s.D}${s.R === 'spec' ? ` C=${s.C}` : ''}${s.S === 'open' ? ' S=open' : ''}${s.R === 'session' ? ` U=${s.U}` : ''}`

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.goto(`${BASE}/#/empty`, { waitUntil: 'domcontentloaded' })

const seed = async (state) => {
  await page.evaluate(({ s, sessionId, wrapTabs, splitParam }) => {
    const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* private mode */ } }
    set('spexcode.lang', 'en')          // aria labels and band classes must not shift with the locale
    set('spexcode.theme', 'minimal')
    set('spexcode.tabs', JSON.stringify(wrapTabs))   // a strip deep enough to WRAP, rewritten per state so nothing carries over
    set('spexcode.dock', s.D === 'closed' ? '0' : '1')
    set('spexcode.dockMode', s.D === 'sessions' ? 'sessions' : 'explorer')
    set('spexcode.ctxOpen', s.C === 'open' ? '1' : '0')
    set('spexcode.split', s.S === 'open' ? JSON.stringify(splitParam) : null)
    set('spexcode.statusHidden', '[]')
    set(`spexcode.session-surface.v1.root`, JSON.stringify({ defaultSurface: s.U, sessions: { [sessionId]: s.U } }))
  }, { s: state, sessionId: SESSION_ID, wrapTabs: WRAP_TABS, splitParam: { page: 'spec', param: secondSpec, query: null } })
}

// How many ROWS the strip wrapped to, read off the tabs' own tops. It rides beside the band count in
// every state's report: the model says a strip on three rows is still one band, and a number nobody
// prints is a claim nobody checks.
const stripRows = () => document.querySelectorAll('.tab').length
  ? new Set([...document.querySelectorAll('.tab')].map((t) => Math.round(t.getBoundingClientRect().top))).size
  : 0

// Boot at #/empty, then navigate. A FIRST load at a bare #/evals or #/issues renders the cold review
// fast-path — a different, dockless shell — so entering those addresses from a booted workspace is the
// only way to measure the real chrome. The same boot-then-navigate also keeps every state's measurement
// on the mounted-document pool's steady state ([[workspace-shell]]): a hidden document is display:none,
// which the classifier skips outright, so a warm pool can never smuggle a band into the count.
const enter = async (state) => {
  await seed(state)
  await page.evaluate(() => { location.hash = '#/empty' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.app-shell .side-rail', { timeout: 45_000 })
  await page.evaluate((h) => { location.hash = h }, hashFor(state.R))
  await page.waitForSelector(READY[state.R], { timeout: 45_000 })
  await page.waitForTimeout(state.R === 'session' ? 2500 : 1200)
}

const CFG = {
  known: KNOWN_BANDS, containerTags: CONTAINER_TAGS, excludeClasses: EXCLUDE_CLASSES,
  thin: 64, span: 0.6, run: 120,
}

const all = enumerateStates()
console.log('=== BAND-BUDGET GATE ===')
console.log(`base            ${BASE}`)
console.log(`spec document   #/spec/${SPEC_ID}`)
console.log(`governed file   #/file/${FILE_PATH}`)
console.log(`session         #/sessions/${SESSION_ID}  (${session.label || session.title || 'unnamed'})`)
console.log(`state space     ${all.length} reachable states over R×D×C×S×U`)
console.log(`budget          min ${Math.min(...all.map(B))}  max ${Math.max(...all.map(B))}  (theorem: 3..5)`)
console.log('')

const results = []
for (const state of traversal()) {
  await enter(state)
  const bands = await page.evaluate(measureBands, CFG)
  const rows = await page.evaluate(stripRows)
  const predicted = B(state)
  const measured = bands.length
  const ok = measured === predicted
  results.push({ state, predicted, measured, bands, rows, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${stateName(state).padEnd(44)} predicted ${predicted}  measured ${measured}  strip rows ${rows}${ok ? '' : `  EXCESS ${measured - predicted}`}`)
  console.log(`      ${bands.map((b) => `${b.cls.split(/\s+/)[0]}(${b.w}x${b.h})`).join('  ')}`)
  if (!ok) {
    const shot = join(OUT, `excess-${measured - predicted}-${stateName(state).replace(/[^a-z0-9]+/gi, '-')}.png`)
    await page.screenshot({ path: shot })
  }
}

const failures = results.filter((r) => !r.ok).sort((a, b) => (b.measured - b.predicted) - (a.measured - a.predicted))
console.log('\n=== BUDGET BREACHES, ranked by excess ===')
if (!failures.length) console.log('none — every visited state stacks exactly the bands the model allows.')
for (const f of failures) {
  console.log(`  +${f.measured - f.predicted}  ${stateName(f.state).padEnd(44)} ${f.predicted} → ${f.measured}`)
  console.log(`        ${f.bands.map((b) => b.cls.split(/\s+/)[0]).join(' | ')}`)
}

// the offender census: which class shows up in breaching states most often. A ranked repair list.
const offenders = new Map()
for (const f of failures) for (const b of f.bands) {
  const key = b.cls.split(/\s+/)[0]
  offenders.set(key, (offenders.get(key) || 0) + 1)
}
console.log('\n=== bands seen in breaching states ===')
for (const [cls, n] of [...offenders].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${cls}`)

// A WRAPPED STRIP IS STILL ONE BAND. Every state above was entered with a working set past one row; if a
// row ever became a band of its own, the count would have risen with the rows and the states above would
// already be failing. This block is what stops the property from going untested by accident — a strip that
// stopped wrapping would leave the claim unexercised while every state still passed.
const flat = results.filter((r) => r.rows < 2)
console.log('\n=== the tab strip, wrapped ===')
console.log(`rows measured: ${[...new Set(results.map((r) => r.rows))].sort().join(', ')} — one band at every one of them`)
if (flat.length) {
  console.log(`  ${flat.length} state(s) did NOT wrap, so "one band however many rows" went unexercised there:`)
  for (const r of flat) console.log(`    ${stateName(r.state)}`)
}

const theoremHolds = all.every((s) => B(s) >= 3 && B(s) <= 5)
console.log(`\ntheorem 3 ≤ B ≤ 5 over all ${all.length} reachable states: ${theoremHolds ? 'holds' : 'BROKEN'}`)
console.log(`${results.length - failures.length} of ${results.length} visited states hold the budget`)

writeFileSync(join(OUT, 'band-budget.json'), JSON.stringify({ base: BASE, states: results }, null, 2))
await context.close()
await browser.close()
process.exit(failures.length || flat.length || !theoremHolds ? 1 : 0)
