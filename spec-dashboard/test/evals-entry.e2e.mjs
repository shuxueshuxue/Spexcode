// evals-entry.e2e.mjs — the [[session-eval]]/[[evals-view]] session→Evals entry-chain batch driver,
// run against a live backend through the real dashboard (BASE env, default the worktree vite):
//   1. eval-door-one-chrome    — the console Eval door is a REAL anchor to the canonical scoped list
//   2. scoped-terminal-door    — the ONE icon-only terminal door on scoped LIST (se-gates action) and
//                                DETAIL (header action slot); no banner, no visible copy, 32px target
//   3. three commands apart    — terminal door vs ds-back (#/evals) vs browser Back (history)
// Prints a transcript of every check; saves screenshots and whole-journey videos under OUT.
import { pathToFileURL } from 'node:url'
import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://localhost:5183'
const SESSION = process.env.SESSION || '5ce40dbf-0c90-4ff9-86f6-a6fa462ee6b7'
const OUT = process.env.OUT || '/tmp/evals-entry-e2e'
mkdirSync(OUT, { recursive: true })
const { chromium } = await import(pathToFileURL(PW).href)

const SHORT = SESSION.slice(0, 8)
const SCOPED_Q = `is:eval state:current scope:${SESSION}`

let pass = 0, fail = 0
const results = []
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  console.log(results.at(-1))
  ok ? pass++ : fail++
}
const qOf = (hash) => {
  const i = hash.indexOf('?')
  return i < 0 ? null : new URLSearchParams(hash.slice(i + 1)).get('q')
}
const pathOf = (hash) => hash.split('?')[0]
const settle = (p, ms = 800) => p.waitForTimeout(ms)

// the ONE door probe: the icon-only terminal anchor in either home (the list's se-gates action
// cluster, the detail's ds-head action slot) + a whole-page sweep for any leftover banner markup.
const doorProbe = (p) => p.evaluate(() => {
  const d = document.querySelector('.se-gates .se-acts .se-door, .ds-head .ds-head-action .se-door')
  const r = d?.getBoundingClientRect()
  return {
    door: d ? {
      tag: d.tagName,
      href: d.getAttribute('href'),
      text: d.textContent.trim(),
      aria: d.getAttribute('aria-label'),
      tip: d.getAttribute('data-tip'),
      w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top),
      inGates: !!d.closest('.se-gates'), inHead: !!d.closest('.ds-head'),
    } : null,
    banner: !!document.querySelector('.ds-banner, .se-banner-slot'),
  }
})
const doorOk = (d) => !!d && d.tag === 'A' && d.href === `#/sessions/${SESSION}` && d.text === '' && d.w >= 32 && d.h >= 32
const sameDoor = (a, b) => !!a && !!b && a.href === b.href && a.aria === b.aria && a.text === b.text

const browser = await chromium.launch()

// ---------- journey 1: desktop 1440 en — door → scoped list → detail → the three commands ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } })
  const p = await ctx.newPage()

  // — the console door: WAIT for the console to actually render its tab bar (a cold vite/board load
  // takes over a second; a fixed settle races it), then probe the REAL element. If the door never
  // appears, or is not the canonical real anchor, the run ABORTS here with a non-zero exit — the entry
  // is the very thing under test, and continuing (playwright's auto-waiting click would still land)
  // would turn the remaining checks into evidence for a page the user could not have reached this way.
  await p.goto(`${BASE}/#/sessions/${SESSION}`)
  const t0 = Date.now()
  const doorEl = await p.waitForSelector('.si-tab-door', { timeout: 20000 }).catch(() => null)
  const door = doorEl ? await doorEl.evaluate((d) => ({ tag: d.tagName, href: d.getAttribute('href'), text: d.textContent.trim() })) : null
  check('door exists in console tab bar', !!door, `${JSON.stringify(door)} after ${Date.now() - t0}ms`)
  check('door is a REAL anchor', door?.tag === 'A', `tag=${door?.tag}`)
  const doorQ = door?.href ? qOf(door.href) : null
  check('door href is the canonical scoped list (q token, not legacy ?session)', pathOf(door?.href || '') === '#/evals' && doorQ === SCOPED_Q, `href=${door?.href} q=${doorQ}`)
  await p.screenshot({ path: join(OUT, '01-console-door.png') })
  if (!door || door.tag !== 'A' || pathOf(door.href || '') !== '#/evals' || doorQ !== SCOPED_Q) {
    console.log('ABORT — the desktop console door is missing or not the canonical anchor; refusing to fake the entry with a scripted navigation.')
    await browser.close()
    console.log(`\n${pass} pass, ${fail} fail (aborted at the console door)`)
    process.exit(1)
  }
  await settle(p, 400)

  // — click: one PUSH straight to the final address —
  const lenBefore = await p.evaluate(() => history.length)
  await p.click('.si-tab-door')
  await settle(p)
  const hashAfter = await p.evaluate(() => location.hash)
  const lenAfter = await p.evaluate(() => history.length)
  const listHash = hashAfter
  check('click lands on the canonical scoped list', pathOf(hashAfter) === '#/evals' && qOf(hashAfter) === SCOPED_Q, `hash=${hashAfter}`)
  check('click is ONE history push', lenAfter === lenBefore + 1, `history ${lenBefore}→${lenAfter}`)
  const gates = await p.waitForSelector('.se-gates', { timeout: 8000 }).then(() => true).catch(() => false)
  check('scoped list shows the gates strip', gates)

  // — the scoped LIST carries the icon-only terminal door as an se-gates action; NO banner —
  const listDoor = await doorProbe(p)
  check('scoped LIST se-gates carries the terminal door', !!listDoor.door && listDoor.door.inGates, JSON.stringify(listDoor.door))
  check('list door is an icon-only REAL 32px anchor to the terminal', doorOk(listDoor.door), JSON.stringify(listDoor.door))
  check('list door aria-label + tooltip carry the full semantics (session id)', !!listDoor.door && !!listDoor.door.aria && listDoor.door.aria.includes(SHORT) && listDoor.door.tip === listDoor.door.aria, `aria=${listDoor.door?.aria}`)
  check('scoped LIST renders NO banner markup', !listDoor.banner)
  check('list door sits in the first screen', !!listDoor.door && listDoor.door.top >= 0 && listDoor.door.top < 300, `top=${listDoor.door?.top}`)
  await p.screenshot({ path: join(OUT, '02-scoped-list.png') })

  // — reload: identical door (derived only from the address) —
  await p.reload()
  await settle(p, 1200)
  const reloadDoor = await doorProbe(p)
  check('reload wears the identical door', sameDoor(listDoor.door, reloadDoor.door), JSON.stringify(reloadDoor.door))

  // — keyboard: focus the door and press Enter — a real anchor follows —
  await p.focus('.se-door')
  await p.keyboard.press('Enter')
  await settle(p)
  const kbHash = await p.evaluate(() => location.hash)
  check('focus+Enter on the door lands on the session terminal', kbHash === `#/sessions/${SESSION}`, kbHash)
  await p.goBack()
  await settle(p)
  check('Back from the keyboard-opened terminal restores the scoped list', await p.evaluate(() => location.hash) === listHash)

  // — new-tab semantics: Ctrl+click opens the terminal in a NEW page, the list stays put —
  const [popup] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null),
    p.click('.se-door', { modifiers: ['ControlOrMeta'] }),
  ])
  await popup?.waitForLoadState().catch(() => null)
  await settle(p, 400)
  check('Ctrl+click opens the terminal in a new tab (real anchor semantics)', !!popup && (await popup.evaluate(() => location.hash).catch(() => null)) === `#/sessions/${SESSION}`)
  check('the originating list did not navigate', await p.evaluate(() => location.hash) === listHash)
  await popup?.close().catch(() => null)

  // — list → detail: push; detail seats the SAME door in the header action slot + uniform ds-back —
  await p.waitForSelector('a.lp-row', { timeout: 8000 }).catch(() => null)
  const rowHref = await p.evaluate(() => document.querySelector('a.lp-row')?.getAttribute('href'))
  check('scoped row href carries the scope token alone', !!rowHref && qOf(rowHref) === `scope:${SESSION}`, `row=${rowHref}`)
  await p.click('a.lp-row')
  await settle(p)
  const detailHash = await p.evaluate(() => location.hash)
  check('row click lands on the scoped detail', detailHash.startsWith('#/evals/') && qOf(detailHash) === `scope:${SESSION}`, detailHash)
  const detailDoor = await doorProbe(p)
  check('scoped DETAIL header action slot carries the terminal door', !!detailDoor.door && detailDoor.door.inHead, JSON.stringify(detailDoor.door))
  check('detail door is the icon-only REAL 32px anchor', doorOk(detailDoor.door))
  check('list and detail doors are the ONE door (same href, same semantics)', sameDoor(listDoor.door, detailDoor.door))
  check('scoped DETAIL renders NO banner markup', !detailDoor.banner)
  const dsBack = await p.evaluate(() => document.querySelector('.ds-back')?.getAttribute('href'))
  check('detail ds-back is unconditionally #/evals', dsBack === '#/evals', `ds-back=${dsBack}`)
  const queueScoped = await p.evaluate(() => {
    const qs = [...document.querySelectorAll('a.ds-queue-row')].map((a) => a.getAttribute('href')).filter(Boolean)
    return { n: qs.length, allScoped: qs.length > 0 && qs.every((h) => decodeURIComponent(h).includes('scope:')) }
  })
  check('queue anchors exist and keep the scope token', queueScoped.allScoped, `n=${queueScoped.n}`)
  await p.screenshot({ path: join(OUT, '03-scoped-detail.png') })

  // — command 1: browser Back → EXACTLY the scoped list —
  await p.goBack()
  await settle(p)
  const backHash = await p.evaluate(() => location.hash)
  check('browser Back restores the exact scoped list URL', backHash === listHash, `back=${backHash}`)

  // — command 2: ds-back → the BARE #/evals home (never the terminal); trunk faces carry no door —
  await p.click('a.lp-row')
  await settle(p)
  await p.click('.ds-back')
  await settle(p)
  const bareHash = await p.evaluate(() => location.hash)
  const bareProbe = await doorProbe(p)
  check('ds-back lands on the bare #/evals', bareHash === '#/evals', `hash=${bareHash}`)
  check('trunk list carries NO door and NO banner', !bareProbe.door && !bareProbe.banner, JSON.stringify(bareProbe))
  await p.screenshot({ path: join(OUT, '04-bare-list-after-dsback.png') })

  // — command 3: the terminal door → #/sessions/<id> —
  await p.goto(`${BASE}/${listHash}`)
  await settle(p, 1200)
  const hasDoor = await p.evaluate(() => !!document.querySelector('.se-door'))
  if (hasDoor) {
    await p.click('.se-door')
    await settle(p)
    const termHash = await p.evaluate(() => location.hash)
    check('terminal door lands on the session terminal', termHash === `#/sessions/${SESSION}`, termHash)
  } else check('terminal door lands on the session terminal', false, 'no door to click')
  await p.screenshot({ path: join(OUT, '05-terminal-via-door.png') })

  await p.close(); await ctx.close()
  const v = readdirSync(OUT).find((f) => f.endsWith('.webm') && !f.startsWith('journey'))
  if (v) renameSync(join(OUT, v), join(OUT, 'journey-desktop-en.webm'))
}

// ---------- journey 2: direct open + zh — the door derives only from the address ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  await p.addInitScript(() => localStorage.setItem('spexcode.lang', 'zh'))
  await p.goto(`${BASE}/#/evals?q=${encodeURIComponent(SCOPED_Q)}`)
  await settle(p, 1500)
  const zhList = await doorProbe(p)
  check('zh direct-open scoped list carries the door, no banner', !!zhList.door && zhList.door.inGates && !zhList.banner, JSON.stringify(zhList.door))
  check('zh door aria is localized + names the session, still icon-only', doorOk(zhList.door) && /[一-鿿]/.test(zhList.door?.aria || '') && (zhList.door?.aria || '').includes(SHORT), `aria=${zhList.door?.aria}`)
  await p.screenshot({ path: join(OUT, '06-zh-scoped-list.png') })
  // the session model loads asynchronously — wait for the REAL rows (the fixed settle races a slow
  // /api/sessions/:id/evals), then open the first one
  await p.waitForSelector('a.lp-row', { timeout: 15000 }).catch(() => null)
  const row = await p.evaluate(() => document.querySelector('a.lp-row')?.getAttribute('href'))
  if (row) {
    await p.goto(`${BASE}/${row}`)
    await settle(p, 1200)
    const zhDetail = await doorProbe(p)
    check('zh scoped detail carries the SAME door in its header', !!zhDetail.door && zhDetail.door.inHead && sameDoor(zhList.door, zhDetail.door) && !zhDetail.banner, JSON.stringify(zhDetail.door))
  } else check('zh scoped detail carries the SAME door in its header', false, 'no row to open')
  // a TRUNK detail (same address, scope stripped) carries no door at all
  if (row) {
    await p.goto(`${BASE}/${pathOf(row)}`)
    await settle(p, 1000)
    const trunk = await doorProbe(p)
    check('trunk detail carries NO door and NO banner', !trunk.door && !trunk.banner, JSON.stringify(trunk))
  }
  await p.close(); await ctx.close()
}

// ---------- journey 3: 390px phone — same door, no overflow; cold-open reaches the session detail ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: OUT, size: { width: 390, height: 844 } }, isMobile: true, hasTouch: true })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/#/evals?q=${encodeURIComponent(SCOPED_Q)}`)
  await settle(p, 1500)
  const mProbe = await doorProbe(p)
  check('390px scoped list carries the door, no banner', !!mProbe.door && mProbe.door.inGates && !mProbe.banner, JSON.stringify(mProbe.door))
  check('390px door keeps the 32px target in the first screen', doorOk(mProbe.door) && mProbe.door.top < 300, `top=${mProbe.door?.top} ${mProbe.door?.w}×${mProbe.door?.h}`)
  const widths = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
  check('390px no horizontal overflow', widths.doc <= 390 && widths.body <= 390, JSON.stringify(widths))
  await p.screenshot({ path: join(OUT, '07-390-scoped-list.png') })
  // the door must be a REAL door on the phone too: tap it and require the session conversation to
  // render (the deep-linked #/sessions/<id> plane), not just a hash change
  await p.click('.se-door')
  await settle(p, 1000)
  const mTerm = await p.evaluate(() => ({
    hash: location.hash,
    detail: !!document.querySelector('.m-sessdetail'),
    id8: document.querySelector('.m-sess-id8')?.textContent || null,
  }))
  check('390px door opens the session conversation', mTerm.hash === `#/sessions/${SESSION}` && mTerm.detail && mTerm.id8 === SHORT, JSON.stringify(mTerm))
  await p.screenshot({ path: join(OUT, '09-390-terminal-via-door.png') })
  // the phone session surface's eval door: reach a session's detail (already open from the door leg,
  // else tab-bar sessions → tap a row) and read the header's eval entry
  await p.goto(`${BASE}/#/sessions`)
  await settle(p, 1200)
  const doorThere = await p.evaluate(() => !!document.querySelector('.m-sess-evalbtn'))
  if (!doorThere) {
    await p.evaluate(() => document.querySelectorAll('.m-tabbar-btn')[1]?.click())
    await settle(p, 600)
    await p.waitForSelector('.m-sess-row', { timeout: 8000 }).then((el) => el.click()).catch(() => null)
    await settle(p, 800)
  }
  const mDoor = await p.evaluate(() => {
    const d = document.querySelector('.m-sess-evalbtn')
    return d ? { tag: d.tagName, href: d.getAttribute('href') } : null
  })
  check('phone eval door is a REAL anchor to a scoped list', !!mDoor && mDoor.tag === 'A' && !!mDoor.href && pathOf(mDoor.href) === '#/evals' && (qOf(mDoor.href) || '').startsWith('is:eval state:current scope:'), JSON.stringify(mDoor))
  await p.screenshot({ path: join(OUT, '08-390-sessions-door.png') })
  await p.close(); await ctx.close()
  const v = readdirSync(OUT).find((f) => f.endsWith('.webm') && !f.startsWith('journey'))
  if (v) renameSync(join(OUT, v), join(OUT, 'journey-390.webm'))
}

await browser.close()
console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
