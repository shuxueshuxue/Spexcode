// new-issue-page.e2e.mjs — the [[issues-view]] compose-page batch driver, run against a live backend
// through the real dashboard (BASE env; API for seeding/read-back):
//   1. new-issue-page                — routed compose page, shared DetailShell + composer, Write/Preview
//   2. new-form-node-links           — two text surfaces, store labels, rail node derivation, Create → detail
//   3. composer-mention-autocomplete — reply + compose-page menus are ONE shared module
//   4. composer-trigger-buttons      — the `@`/`[[` doors type the trigger at the caret
//   5. list-page-skeleton            — list chrome, New as a real anchor, keys typed into an input
//   6. composer-trigger-buttons / composer-shared-shape on the EVAL detail ([[event-detail]]'s home)
// Prints a PASS/FAIL transcript; saves per-scenario screenshots and journey videos under OUT.
// Run against a DISPOSABLE local store (SPEXCODE_ISSUES_DIR) — scenario 2 creates a real issue.
import { pathToFileURL } from 'node:url'
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://localhost:5183'
const API = process.env.API || BASE
const OUT = process.env.OUT || '/tmp/new-issue-page-e2e'
mkdirSync(OUT, { recursive: true })
const { chromium } = await import(pathToFileURL(PW).href)

let pass = 0, fail = 0
const lines = []
const check = (name, ok, detail = '') => {
  lines.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  console.log(lines.at(-1))
  ok ? pass++ : fail++
}
const settle = (p, ms = 500) => p.waitForTimeout(ms)
const rect = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
}, sel)
const overflow = (p) => p.evaluate(() => ({
  doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, vw: window.innerWidth,
}))
const errs = (p) => { const bag = []; p.on('pageerror', (e) => bag.push(String(e))); return bag }

// the local issue the composer scenarios write on
const listing = await (await fetch(`${API}/api/issues?q=is:issue%20state:open&page=1`)).json()
const LOCAL = listing.items.find((i) => i.store === 'local')?.id
if (!LOCAL) throw new Error('seed a local issue first (POST /api/issues against a disposable store)')

const browser = await chromium.launch()

// ---------- 1 + 2 + 5: static faces (screenshots) ----------
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
const pageErrors = errs(p)

// — 5. the LIST page: chrome, the New door, keys inside an input —
await p.goto(`${BASE}/#/issues`)
await p.waitForSelector('.lp-row')
await settle(p)
const listShape = await p.evaluate(() => {
  const nw = document.querySelector('.rl-new')
  const rows = [...document.querySelectorAll('.lp-row')]
  return {
    newTag: nw?.tagName, newHref: nw?.getAttribute('href'), newHasOnclick: !!nw?.onclick,
    rowsAreAnchors: rows.length > 0 && rows.every((r) => r.tagName === 'A' && /^#\/issues\//.test(r.getAttribute('href'))),
    query: document.querySelector('.rl-query input')?.value,
    tabs: [...document.querySelectorAll('.rl-section')].map((b) => b.textContent),
    queryH: Math.round(document.querySelector('.rl-query').getBoundingClientRect().height),
    headH: Math.round(document.querySelector('.lp-head').getBoundingClientRect().height),
  }
})
check('list New is a REAL anchor to the compose address', listShape.newTag === 'A' && listShape.newHref === '#/issues/new', `${listShape.newTag} href=${listShape.newHref}`)
check('list rows stay real anchors to their detail address', listShape.rowsAreAnchors)
check('list chrome: 32px query with the default token text, 48px section header', listShape.queryH === 32 && listShape.headH === 48 && listShape.query.trim() === 'is:issue state:open', `query ${listShape.queryH}px "${listShape.query}" head ${listShape.headH}px`)
check('Open/Closed sections carry counts', listShape.tabs.length === 2 && /open/i.test(listShape.tabs[0]), listShape.tabs.join(' | '))

// j/k move a visible cursor; Enter opens the cursor row
await p.click('.lp-head')
await p.keyboard.press('j')
await settle(p, 200)
const cur1 = await p.evaluate(() => document.querySelector('.lp-row.cur')?.getAttribute('href'))
await p.keyboard.press('j')
await settle(p, 200)
const cur2 = await p.evaluate(() => document.querySelector('.lp-row.cur')?.getAttribute('href'))
check('j moves a visible row cursor', !!cur1 && !!cur2 && cur1 !== cur2, `${cur1} → ${cur2}`)
// a key typed INSIDE the query input reaches the input and moves no cursor
await p.click('.rl-query input')
await p.keyboard.type('j')
await settle(p, 200)
const typed = await p.evaluate(() => ({
  value: document.querySelector('.rl-query input').value,
  cur: document.querySelector('.lp-row.cur')?.getAttribute('href'),
}))
check("'j' typed in the query input lands in the input and moves no cursor", typed.value.endsWith('j') && typed.cur === cur2, `value="${typed.value}"`)
await p.keyboard.press('Backspace')
// the Closed section pushes the canonical query address; reload replays it
const before = await p.evaluate(() => history.length)
await p.click('.rl-section:nth-child(2)')
// the address carries the token text percent-encoded (GitHub's measured bytes) — match either spelling
await p.waitForFunction(() => /state(:|%3A)closed/.test(location.hash))
const closedHash = await p.evaluate(() => location.hash)
await p.reload()
await p.waitForSelector('.rl-query input')
const replayed = await p.evaluate(() => ({ hash: location.hash, text: document.querySelector('.rl-query input').value.trim() }))
check('Closed pushes ?q=is:issue state:closed and a reload replays the text', /q=is%3Aissue%20state%3Aclosed/.test(closedHash) && replayed.hash === closedHash && replayed.text === 'is:issue state:closed', `${closedHash} → "${replayed.text}"`)
await p.goBack()
await p.waitForFunction(() => location.hash === '#/issues')
check('browser Back restores the default list address', (await p.evaluate(() => location.hash)) === '#/issues', `history ${before} → ${await p.evaluate(() => history.length)}`)
// a row click PUSHES and Back returns — measured on a FRESH page so history has no forward entries a
// push would replace instead of append (a Back-then-push keeps the same length by definition).
const fresh = await ctx.newPage()
await fresh.goto(`${BASE}/#/issues`)
await fresh.waitForSelector('.lp-row')
const histBefore = await fresh.evaluate(() => history.length)
await fresh.click('.lp-row')
await fresh.waitForSelector('.ds-page')
const detailClasses = await fresh.evaluate(() => ({
  hash: location.hash, hist: history.length,
  shell: ['.ds-head', '.ds-back', '.ds-cols', '.ds-main', '.ds-side'].filter((s) => document.querySelector(s)),
}))
await fresh.goBack()
await fresh.waitForSelector('.lp-row')
const backHash = await fresh.evaluate(() => location.hash)
check('a row click PUSHES onto the standalone detail page and Back restores the list', detailClasses.hist === histBefore + 1 && /^#\/issues\/.+/.test(detailClasses.hash) && backHash === '#/issues', `${detailClasses.hash} history ${histBefore}→${detailClasses.hist}, back ${backHash}`)
check('the detail page is the shared DetailShell', detailClasses.shell.length === 5, detailClasses.shell.join(' '))
await fresh.close()
await p.screenshot({ path: join(OUT, 'list-page-skeleton.png'), fullPage: false })

// — 1. the COMPOSE page, opened COLD by address —
const cold = await ctx.newPage()
const coldErrors = errs(cold)
await cold.goto(`${BASE}/#/issues/new`)
await cold.waitForSelector('.fv-new-page')
await settle(cold, 600)
const shape = await cold.evaluate(() => {
  const q = (s) => document.querySelector(s)
  const cs = (s, prop) => { const el = q(s); return el ? getComputedStyle(el)[prop] : null }
  return {
    dialogs: document.querySelectorAll('[role="dialog"], [aria-modal]').length,
    shell: ['.ds-page', '.ds-head', '.ds-back', '.ds-cols', '.ds-main', '.ds-side'].filter((s) => q(s)),
    back: q('.ds-back')?.getAttribute('href'),
    title: q('.ds-title')?.textContent,
    labels: [...document.querySelectorAll('.fv-field-label')].map((el) => el.textContent),
    textSurfaces: document.querySelectorAll('.fv-new-page input[type=text], .fv-new-page input:not([type]), .fv-new-page textarea').length,
    surfaceBorder: cs('.fv-new-compose', 'borderStyle'),
    surfaceBorderW: cs('.fv-new-compose', 'borderTopWidth'),
    textareaBorder: cs('.fv-new-compose .fv-textarea', 'borderStyle'),
    idleH: Math.round(q('.fv-new-compose .fv-textarea').getBoundingClientRect().height),
    doors: [...document.querySelectorAll('.fv-new-compose .fv-trigger-btn')].map((b) => ({ text: b.textContent, label: b.getAttribute('aria-label') })),
    tabs: [...document.querySelectorAll('.fv-tab')].map((b) => ({ text: b.textContent, selected: b.getAttribute('aria-selected') })),
    storeOptions: [...document.querySelectorAll('.fv-store-pick option')].map((o) => o.textContent),
    railLabels: [...document.querySelectorAll('.ds-side-sec .ds-side-label')].map((el) => el.textContent),
    cancel: { tag: q('.fv-cancel')?.tagName, href: q('.fv-cancel')?.getAttribute('href') },
    post: { text: q('.fv-post')?.textContent, disabled: q('.fv-post')?.disabled },
    focused: document.activeElement?.className,
  }
})
check('the compose address opens COLD as a real page (no list visit)', shape.shell.length === 6, shape.shell.join(' '))
check('NOTHING on the page is a dialog — the pop-out is gone, not restyled', shape.dialogs === 0)
check('it wears the SAME DetailShell as the detail page, back anchor to the list', shape.back === '#/issues' && shape.shell.includes('.ds-back'), `back=${shape.back}`)
check('the header names the act', /new issue/i.test(shape.title || ''), shape.title)
check('exactly TWO labeled text surfaces (title + description)', shape.textSurfaces === 2 && shape.labels.length === 2, `${shape.textSurfaces} surfaces, labels: ${shape.labels.join(' / ')}`)
check('the description is the shared composer surface: bordered box, BORDERLESS textarea', shape.surfaceBorder === 'solid' && shape.surfaceBorderW === '1px' && shape.textareaBorder === 'none', `box ${shape.surfaceBorderW} ${shape.surfaceBorder} / textarea ${shape.textareaBorder}`)
check('the writing surface is already page-sized at idle, before any focus', shape.idleH >= 120, `${shape.idleH}px`)
check("the action row carries the localized `@`/`[[` doors", shape.doors.length === 2 && shape.doors.every((d) => d.label) && shape.doors[0].text === '@' && shape.doors[1].text === '[[', JSON.stringify(shape.doors))
check('a Write/Preview switch exists with Write selected', shape.tabs.length === 2 && shape.tabs[0].selected === 'true', JSON.stringify(shape.tabs))
check('the rail carries the store control over the spec-node section', shape.railLabels.length === 2 && shape.storeOptions.length >= 1, `${shape.railLabels.join(' / ')} | options ${shape.storeOptions.join(',')}`)
check('Cancel is a REAL list anchor, never history.back', shape.cancel.tag === 'A' && shape.cancel.href === '#/issues', JSON.stringify(shape.cancel))
check('Create is disabled until the issue has a title', shape.post.disabled === true, shape.post.text)
check('the title field takes focus on arrival', /fv-new-title/.test(shape.focused || ''), shape.focused)

// Write → Preview → Write over a markdown draft
await cold.fill('.fv-new-title', 'compose page proof — routed, not a pop-out')
await cold.click('.fv-new-compose .fv-textarea')
await cold.keyboard.type('## a heading\n- one\n- two\n\nlinking [[issues-view]] from the prose\n')
await settle(cold, 400)
const railWithNode = await cold.evaluate(() => [...document.querySelectorAll('.ds-side .ds-val-text')].map((el) => el.textContent))
check('the rail SHOWS the node the prose links, derived live from the draft', railWithNode.includes('issues-view'), railWithNode.join(' | '))
const draft = await cold.inputValue('.fv-new-compose .fv-textarea')
await cold.click('.fv-tab:nth-child(2)')
await cold.waitForSelector('.fv-new-preview')
const preview = await cold.evaluate(() => {
  const box = document.querySelector('.fv-new-preview')
  return {
    // SpecBody renders every heading level as its one .doc-h element — the same markup the detail body gets
    heading: box.querySelector('.doc-h')?.textContent,
    tags: [...box.querySelectorAll('.doc-h, ul, li, a')].map((el) => el.tagName),
    raw: /##|\[\[/.test(box.textContent),
  }
})
check('Preview renders the draft through the real markdown renderer, no raw syntax', !!preview.heading && preview.tags.includes('LI') && !preview.raw, `${preview.tags.join(',')} heading="${preview.heading}"`)
await cold.click('.fv-tab:nth-child(1)')
await settle(cold, 200)
check('Write restores the exact draft', (await cold.inputValue('.fv-new-compose .fv-textarea')) === draft)
await cold.screenshot({ path: join(OUT, 'new-issue-page.png') })

// the page survives a reload (it is an address, not a layer)
await cold.reload()
await cold.waitForSelector('.fv-new-page')
check('a reload lands on the same compose page', (await cold.evaluate(() => location.hash)) === '#/issues/new')

// phone width: rail above the form, no horizontal overflow
await cold.setViewportSize({ width: 390, height: 844 })
await settle(cold, 500)
const phone = { side: await rect(cold, '.ds-side'), main: await rect(cold, '.ds-main'), ...(await overflow(cold)) }
check('at 390px the rail reflows ABOVE the form with no horizontal overflow', phone.side.top < phone.main.top && phone.doc <= 390 && phone.body <= 390, `side ${Math.round(phone.side.top)} < main ${Math.round(phone.main.top)}, doc ${phone.doc}px`)
await cold.screenshot({ path: join(OUT, 'new-issue-page-390.png') })
await cold.setViewportSize({ width: 1440, height: 900 })

// — 2. new-form-node-links: Create lands on the created issue —
await cold.goto(`${BASE}/#/issues`)
await cold.waitForSelector('.rl-new')
await cold.click('.rl-new')
await cold.waitForSelector('.fv-new-page')
check('the New door navigates to the compose page', (await cold.evaluate(() => location.hash)) === '#/issues/new')
const storeText = await cold.evaluate(() => [...document.querySelectorAll('.fv-store-pick option')].map((o) => o.textContent))
check('each store option names its canonical label exactly once (no L · / GH · prefix)', storeText.every((s) => /^[a-z0-9-]+$/.test(s)), storeText.join(','))
check('NO node-ids field exists', (await cold.evaluate(() => [...document.querySelectorAll('.fv-new-page input')].map((i) => i.placeholder || '').join('|'))).toLowerCase().includes('node id') === false)
const concern = `compose-page e2e proof ${Date.now()}`
await cold.fill('.fv-new-title', concern)
await cold.click('.fv-new-compose .fv-textarea')
await cold.keyboard.type('created from the routed compose page, linking [[issues-view]]')
const histAtCompose = await cold.evaluate(() => history.length)
await cold.click('.fv-post')
await cold.waitForFunction(() => /^#\/issues\/.+/.test(location.hash) && location.hash !== '#/issues/new', null, { timeout: 20000 })
await cold.waitForSelector('.ds-side')
await settle(cold, 600)
const landed = await cold.evaluate(() => ({
  hash: location.hash, hist: history.length, title: document.querySelector('.ds-title')?.textContent,
  railNodes: [...document.querySelectorAll('.ds-side .ds-val')].map((el) => ({ tag: el.tagName, text: el.textContent })),
}))
check('Create lands on the created issue\'s OWN detail address, as a REPLACE', landed.hash.startsWith('#/issues/') && landed.hist === histAtCompose, `${landed.hash} history ${histAtCompose}→${landed.hist}`)
check('the detail shows the concern as its title', landed.title === concern, landed.title)
check('the linked node arrives as a clickable rail chip — inferred from the prose', landed.railNodes.some((v) => v.text === 'issues-view' && v.tag === 'BUTTON'), JSON.stringify(landed.railNodes))
await cold.screenshot({ path: join(OUT, 'new-form-node-links.png') })
await cold.goBack()
await cold.waitForSelector('.lp-row')
check('Back from the created issue returns to the LIST, not to an emptied form', (await cold.evaluate(() => location.hash)) === '#/issues')
const created = await (await fetch(`${API}/api/issues?q=is:issue%20state:open&page=1`)).json()
check('the issue really exists in the store, with its node link', created.items.some((i) => i.concern === concern && (i.nodes || []).includes('issues-view')))
check('no page errors on the static faces', pageErrors.length === 0 && coldErrors.length === 0, [...pageErrors, ...coldErrors].join(' | '))
await ctx.close()

// ---------- 3 + 4: interaction journeys (video) ----------
const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } })
const v = await vctx.newPage()
const vErrors = errs(v)

// — 4. composer-trigger-buttons: the doors type at the caret —
await v.goto(`${BASE}/#/issues/${encodeURIComponent(LOCAL)}`)
await v.waitForSelector('.fv-compose .fv-textarea')
await settle(v, 700)
const doorLabels = await v.evaluate(() => [...document.querySelectorAll('.fv-compose .fv-trigger-btn')].map((b) => ({ text: b.textContent, label: b.getAttribute('aria-label'), tip: b.getAttribute('data-tip') })))
check('the reply composer keeps its localized `@`/`[[` doors', doorLabels.length >= 2 && doorLabels.every((d) => d.label && d.tip), JSON.stringify(doorLabels))
const replyCountBefore = await v.evaluate(() => document.querySelectorAll('.fv-reply').length)
await v.fill('.fv-compose .fv-textarea', 'alpha beta')
await v.evaluate(() => { const el = document.querySelector('.fv-compose .fv-textarea'); el.focus(); el.setSelectionRange(6, 6) })
await v.click('.fv-compose .fv-trigger-btn')
await settle(v, 400)
const inserted = await v.evaluate(() => {
  const el = document.querySelector('.fv-compose .fv-textarea')
  return { value: el.value, caret: el.selectionStart, focused: document.activeElement === el, menu: !!document.querySelector('.fv-compose .mention-menu') }
})
check('`@` types the trigger AT the caret, keeps the draft, refocuses, opens the shared menu', inserted.value === 'alpha @beta' && inserted.caret === 7 && inserted.focused && inserted.menu, JSON.stringify(inserted))
await v.keyboard.press('Escape')
await v.evaluate(() => { const el = document.querySelector('.fv-compose .fv-textarea'); el.focus(); el.setSelectionRange(7, 11) })
await v.click('.fv-compose .fv-trigger-btn:nth-child(2)')
await settle(v, 400)
const replaced = await v.evaluate(() => {
  const el = document.querySelector('.fv-compose .fv-textarea')
  return { value: el.value, caret: el.selectionStart, menu: !!document.querySelector('.fv-compose .mention-menu') }
})
// the draft now reads 'alpha @beta' (the `@` insertion above stays); selecting 7..11 selects 'beta'
check('`[[` replaces the SELECTED span, preserving the rest, and opens the node menu', replaced.value === 'alpha @[[' && replaced.caret === 9 && replaced.menu, JSON.stringify(replaced))
await v.keyboard.press('Escape')
const rowGeom = await v.evaluate(() => {
  const row = document.querySelector('.fv-compose .fv-actions')
  const kids = [...row.children].map((el) => el.getBoundingClientRect())
  const r = row.getBoundingClientRect()
  const overlap = kids.some((a, i) => kids.slice(i + 1).some((b) => a.right > b.left + 0.5 && b.right > a.left + 0.5 && a.bottom > b.top + 0.5 && b.bottom > a.top + 0.5))
  return { overlap, spill: kids.some((k) => k.left < r.left - 0.5 || k.right > r.right + 0.5) }
})
check('the action row lays out without overlap or spill at desktop', !rowGeom.overlap && !rowGeom.spill, JSON.stringify(rowGeom))
await v.setViewportSize({ width: 780, height: 900 })
await settle(v, 400)
const rowGeom780 = await v.evaluate(() => {
  const row = document.querySelector('.fv-compose .fv-actions')
  const kids = [...row.children].map((el) => el.getBoundingClientRect())
  const r = row.getBoundingClientRect()
  return { overlap: kids.some((a, i) => kids.slice(i + 1).some((b) => a.right > b.left + 0.5 && b.right > a.left + 0.5 && a.bottom > b.top + 0.5 && b.bottom > a.top + 0.5)), spill: kids.some((k) => k.right > r.right + 0.5) }
})
check('the same row survives ~780px without overlap or spill', !rowGeom780.overlap && !rowGeom780.spill, JSON.stringify(rowGeom780))
await v.setViewportSize({ width: 1440, height: 900 })
check('the doors posted nothing — they only type', (await v.evaluate(() => document.querySelectorAll('.fv-reply').length)) === replyCountBefore)

// the SAME reply composer in its OTHER home ([[event-detail]]): the refactored doors and the shared shape
// must be identical on the eval detail, or "one composer, every home" is a claim without a reading.
await v.goto(`${BASE}/#/evals`)
await v.waitForSelector('.lp-row')
await v.click('.lp-row')
await v.waitForSelector('.ds-page')
await settle(v, 900)
const evalComposer = await v.evaluate(() => {
  const box = document.querySelector('.ds-compose .fv-compose')
  const ta = document.querySelector('.ds-compose .fv-textarea')
  if (!box || !ta) return null
  return {
    boxBorder: getComputedStyle(box).borderStyle, taBorder: getComputedStyle(ta).borderStyle,
    idleH: Math.round(ta.getBoundingClientRect().height),
    doors: [...document.querySelectorAll('.ds-compose .fv-trigger-btn')].map((b) => ({ text: b.textContent, label: b.getAttribute('aria-label') })),
    send: !!document.querySelector('.ds-compose .fv-send'),
    sendDisabled: document.querySelector('.ds-compose .fv-send')?.disabled,
  }
})
check('the eval detail docks the SAME composer shape (bordered box, borderless idle floor, live action row)', evalComposer && evalComposer.boxBorder === 'solid' && evalComposer.taBorder === 'none' && evalComposer.idleH >= 40 && evalComposer.send && evalComposer.sendDisabled === true, JSON.stringify(evalComposer))
check('its `@`/`[[` doors are the same localized pair', evalComposer.doors.length >= 2 && evalComposer.doors[0].text === '@' && evalComposer.doors[1].text === '[[' && evalComposer.doors.every((d) => d.label), JSON.stringify(evalComposer.doors))
await v.fill('.ds-compose .fv-textarea', 'gamma delta')
await v.evaluate(() => { const el = document.querySelector('.ds-compose .fv-textarea'); el.focus(); el.setSelectionRange(6, 6) })
await v.click('.ds-compose .fv-trigger-btn')
await settle(v, 400)
const evalInsert = await v.evaluate(() => {
  const el = document.querySelector('.ds-compose .fv-textarea')
  return { value: el.value, caret: el.selectionStart, focused: document.activeElement === el, menu: !!document.querySelector('.ds-compose .mention-menu') }
})
check('the door types at the caret here too, through the one shared mechanism', evalInsert.value === 'gamma @delta' && evalInsert.caret === 7 && evalInsert.focused && evalInsert.menu, JSON.stringify(evalInsert))
await v.keyboard.press('Escape')
await v.screenshot({ path: join(OUT, 'eval-detail-composer.png') })
await v.fill('.ds-compose .fv-textarea', '')

// — 3. composer-mention-autocomplete: one shared module, three homes —
await v.goto(`${BASE}/#/issues/${encodeURIComponent(LOCAL)}`)
await v.waitForSelector('.fv-compose .fv-textarea')
await settle(v, 600)
await v.fill('.fv-compose .fv-textarea', '')
await v.click('.fv-compose .fv-textarea')
await v.keyboard.type('@')
await v.waitForSelector('.fv-compose .mention-menu')
const upward = await v.evaluate(() => {
  const menu = document.querySelector('.fv-compose .mention-menu').getBoundingClientRect()
  const ta = document.querySelector('.fv-compose .fv-textarea').getBoundingClientRect()
  const rows = [...document.querySelectorAll('.fv-compose .mention-item')].map((el) => el.textContent)
  return { above: menu.bottom <= ta.top + 2, rows }
})
check('the DOCKED reply composer opens its menu UPWARD', upward.above, upward.rows.slice(0, 3).join(' | '))
check('the actor menu offers @new beside any live session', upward.rows.some((r) => /new/.test(r)))
// walk the roving cursor onto the SYNTHETIC @new row (live sessions share the list, so its index is data)
const newRowIndex = await v.evaluate(() => [...document.querySelectorAll('.fv-compose .mention-item')].findIndex((el) => el.classList.contains('new')))
const cursorIndex = await v.evaluate(() => [...document.querySelectorAll('.fv-compose .mention-item')].findIndex((el) => el.classList.contains('on')))
for (let step = 0; step < (newRowIndex - cursorIndex + 100) % 100; step++) await v.keyboard.press('ArrowDown')
const onNew = await v.evaluate(() => document.querySelector('.fv-compose .mention-item.on')?.classList.contains('new'))
check('↓ roves onto the @new row', onNew === true, `cursor ${cursorIndex} → new row ${newRowIndex}`)
await v.keyboard.press('Enter')
await settle(v, 500)
const launchers = await v.evaluate(() => ({
  value: document.querySelector('.fv-compose .fv-textarea').value,
  rows: [...document.querySelectorAll('.fv-compose .mention-item')].map((el) => el.textContent),
}))
check('accepting @new opens one row per configured launcher', launchers.value.includes('@new:') && launchers.rows.length >= 2, `"${launchers.value}" ${launchers.rows.length} rows`)
await v.keyboard.press('ArrowDown')
await v.keyboard.press('Enter')
await settle(v, 400)
const picked = await v.inputValue('.fv-compose .fv-textarea')
check('picking a launcher writes @new:<launcher> into the prose', /@new:[a-z0-9-]+ $/.test(picked), `"${picked}"`)
await v.fill('.fv-compose .fv-textarea', '')
await v.click('.fv-compose .fv-textarea')
await v.keyboard.type('[[issues-vi')
await v.waitForSelector('.fv-compose .mention-menu')
await v.keyboard.press('Enter')
await settle(v, 400)
const nodePick = await v.inputValue('.fv-compose .fv-textarea')
check('`[[` filters the spec nodes and a pick inserts [[<id>]]', /\[\[[a-z0-9-]+\]\] $/.test(nodePick), `"${nodePick}"`)
await v.keyboard.type('@')
await v.waitForSelector('.fv-compose .mention-menu')
const hashBefore = await v.evaluate(() => location.hash)
await v.keyboard.press('Escape')
await settle(v, 300)
const afterEsc = await v.evaluate(() => ({ menu: !!document.querySelector('.mention-menu'), hash: location.hash, value: document.querySelector('.fv-compose .fv-textarea').value }))
check('Esc closes the menu only — draft and page stay', !afterEsc.menu && afterEsc.hash === hashBefore && afterEsc.value.length > 0, JSON.stringify(afterEsc))
await v.fill('.fv-compose .fv-textarea', 'plain prose opens nothing at all')
await settle(v, 300)
check('plain prose opens no menu', !(await v.evaluate(() => !!document.querySelector('.mention-menu'))))

// the compose PAGE's menu: downward under the caret line, clipped by nothing
await v.goto(`${BASE}/#/issues/new`)
await v.waitForSelector('.fv-new-compose .fv-textarea')
await v.click('.fv-new-compose .fv-textarea')
await v.keyboard.type('summoning @')
await v.waitForSelector('.fv-new-compose .mention-menu')
const down = await v.evaluate(() => {
  const menu = document.querySelector('.fv-new-compose .mention-menu').getBoundingClientRect()
  const ta = document.querySelector('.fv-new-compose .fv-textarea').getBoundingClientRect()
  return { below: menu.top >= ta.top, onScreen: menu.top >= 0 && menu.bottom <= window.innerHeight + 1, rows: document.querySelectorAll('.fv-new-compose .mention-item').length }
})
check('the compose PAGE opens its menu DOWNWARD, fully on screen', down.below && down.onScreen && down.rows > 0, JSON.stringify(down))
await v.keyboard.press('Escape')
await v.fill('.fv-new-compose .fv-textarea', '')
await v.click('.fv-new-compose .fv-textarea')
await v.keyboard.type('[[issues-vi')
await v.waitForSelector('.fv-new-compose .mention-menu')
await v.keyboard.press('Enter')
await settle(v, 400)
const pageNodePick = await v.inputValue('.fv-new-compose .fv-textarea')
check('the compose page runs the SAME node completion', /\[\[[a-z0-9-]+\]\] $/.test(pageNodePick), `"${pageNodePick}"`)

// the console's authored composer still opens its own menus (the shared-module regression)
await v.goto(`${BASE}/#/sessions`)
await v.waitForSelector('.si-input')
await v.click('.si-input')
await v.keyboard.type('[[issues-vi')
await settle(v, 600)
const console_ = await v.evaluate(() => ({ menu: !!document.querySelector('.mention-menu'), items: document.querySelectorAll('.mention-item').length }))
check("the console's authored composer keeps its own `[[` menu", console_.menu && console_.items > 0, JSON.stringify(console_))
await v.keyboard.press('Escape')
await v.fill('.si-input', '')
check('no page errors on the interaction journeys', vErrors.length === 0, vErrors.join(' | '))

const videoPath = await v.video()?.path()
await vctx.close()
if (videoPath) {
  const named = join(OUT, 'composer-journey.webm')
  renameSync(videoPath, named)
  console.log(`video → ${named}`)
}
await browser.close()

const transcript = `${lines.join('\n')}\n\n${pass} pass / ${fail} fail\n`
writeFileSync(join(OUT, 'transcript.txt'), transcript)
console.log(`\n${pass} pass / ${fail} fail`)
console.log(`artifacts: ${readdirSync(OUT).join(', ')}`)
process.exit(fail ? 1 : 0)
