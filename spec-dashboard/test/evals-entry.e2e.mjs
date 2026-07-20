// evals-entry.e2e.mjs — the [[session-eval]]/[[evals-view]] session→Evals entry-chain batch driver,
// run against a live backend through the real dashboard (BASE env, default the worktree vite):
//   1. eval-door-one-chrome   — the console Eval door is a REAL anchor to the canonical scoped list
//   2. scoped-source-banner   — the ONE shared scope banner on scoped LIST and DETAIL, its homes
//   3. three commands apart   — banner terminal door vs ds-back (#/evals) vs browser Back (history)
// Prints a transcript of every check; saves screenshots and whole-journey videos under OUT.
import { pathToFileURL } from 'node:url'
import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://localhost:5183'
const SESSION = process.env.SESSION || 'c52f280f-3bb0-48a1-aa46-b13284c04ed8'
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

const bannerProbe = (p) => p.evaluate(() => {
  const b = document.querySelector('.ds-banner')
  if (!b) return null
  const a = b.querySelector('a')
  return {
    text: b.textContent.trim(),
    top: Math.round(b.getBoundingClientRect().top),
    role: b.getAttribute('role'),
    linkHref: a ? a.getAttribute('href') : null,
    linkTag: a ? a.tagName : null,
  }
})

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

  // — the scoped LIST wears the shared scope banner, top of the first screen —
  let listBanner = await bannerProbe(p)
  check('scoped LIST wears the scope banner', !!listBanner, JSON.stringify(listBanner))
  check('list banner names the session', !!listBanner && listBanner.text.includes(SHORT), listBanner?.text)
  check('list banner carries a REAL terminal anchor', listBanner?.linkTag === 'A' && listBanner?.linkHref === `#/sessions/${SESSION}`, `link=${listBanner?.linkHref}`)
  check('list banner sits in the first screen', !!listBanner && listBanner.top >= 0 && listBanner.top < 300, `top=${listBanner?.top}`)
  await p.screenshot({ path: join(OUT, '02-scoped-list.png') })

  // — reload: identical banner (derived only from the address) —
  await p.reload()
  await settle(p, 1200)
  const reloadBanner = await bannerProbe(p)
  check('reload wears the identical banner', !!listBanner && !!reloadBanner && reloadBanner.text === listBanner.text && reloadBanner.linkHref === listBanner.linkHref, JSON.stringify(reloadBanner))

  // — list → detail: push; detail wears the SAME banner + uniform ds-back —
  await p.waitForSelector('a.lp-row', { timeout: 8000 }).catch(() => null)
  const rowHref = await p.evaluate(() => document.querySelector('a.lp-row')?.getAttribute('href'))
  check('scoped row href carries the scope token alone', !!rowHref && qOf(rowHref) === `scope:${SESSION}`, `row=${rowHref}`)
  await p.click('a.lp-row')
  await settle(p)
  const detailHash = await p.evaluate(() => location.hash)
  check('row click lands on the scoped detail', detailHash.startsWith('#/evals/') && qOf(detailHash) === `scope:${SESSION}`, detailHash)
  const detailBanner = await bannerProbe(p)
  check('scoped DETAIL wears the scope banner', !!detailBanner, JSON.stringify(detailBanner))
  check('list and detail banners are the ONE banner (same copy, same door)', !!listBanner && !!detailBanner && detailBanner.text === listBanner.text && detailBanner.linkHref === listBanner.linkHref)
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

  // — command 2: ds-back → the BARE #/evals home (never the terminal) —
  await p.click('a.lp-row')
  await settle(p)
  await p.click('.ds-back')
  await settle(p)
  const bareHash = await p.evaluate(() => location.hash)
  const bareBanner = await bannerProbe(p)
  check('ds-back lands on the bare #/evals', bareHash === '#/evals', `hash=${bareHash}`)
  check('trunk list wears NO banner', !bareBanner, JSON.stringify(bareBanner))
  await p.screenshot({ path: join(OUT, '04-bare-list-after-dsback.png') })

  // — command 3: the banner terminal door → #/sessions/<id> —
  await p.goto(`${BASE}/${listHash}`)
  await settle(p, 1200)
  const hasDoor = await p.evaluate(() => !!document.querySelector('.ds-banner a'))
  if (hasDoor) {
    await p.click('.ds-banner a')
    await settle(p)
    const termHash = await p.evaluate(() => location.hash)
    check('banner door lands on the session terminal', termHash === `#/sessions/${SESSION}`, termHash)
  } else check('banner door lands on the session terminal', false, 'no banner anchor to click')
  await p.screenshot({ path: join(OUT, '05-terminal-via-banner.png') })

  await p.close(); await ctx.close()
  const v = readdirSync(OUT).find((f) => f.endsWith('.webm') && !f.startsWith('journey'))
  if (v) renameSync(join(OUT, v), join(OUT, 'journey-desktop-en.webm'))
}

// ---------- journey 2: direct open + zh — the banner derives only from the address ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  await p.addInitScript(() => localStorage.setItem('spexcode.lang', 'zh'))
  await p.goto(`${BASE}/#/evals?q=${encodeURIComponent(SCOPED_Q)}`)
  await settle(p, 1500)
  const zhList = await bannerProbe(p)
  check('zh direct-open scoped list wears the banner', !!zhList, JSON.stringify(zhList))
  check('zh banner is localized + names the session', !!zhList && /[一-鿿]/.test(zhList.text) && zhList.text.includes(SHORT), zhList?.text)
  await p.screenshot({ path: join(OUT, '06-zh-scoped-list.png') })
  const row = await p.evaluate(() => document.querySelector('a.lp-row')?.getAttribute('href'))
  if (row) {
    await p.goto(`${BASE}/${row}`)
    await settle(p, 1200)
    const zhDetail = await bannerProbe(p)
    check('zh scoped detail wears the SAME banner', !!zhList && !!zhDetail && zhDetail.text === zhList.text && zhDetail.linkHref === zhList.linkHref, JSON.stringify(zhDetail))
  } else check('zh scoped detail wears the SAME banner', false, 'no row to open')
  await p.close(); await ctx.close()
}

// ---------- journey 3: 390px phone — same banner, no overflow; the phone door is an anchor too ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: OUT, size: { width: 390, height: 844 } }, isMobile: true, hasTouch: true })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/#/evals?q=${encodeURIComponent(SCOPED_Q)}`)
  await settle(p, 1500)
  const mBanner = await bannerProbe(p)
  check('390px scoped list wears the banner', !!mBanner, JSON.stringify(mBanner))
  check('390px banner in first screen, terminal anchor intact', !!mBanner && mBanner.top < 300 && mBanner.linkHref === `#/sessions/${SESSION}`, `top=${mBanner?.top} link=${mBanner?.linkHref}`)
  const widths = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
  check('390px no horizontal overflow', widths.doc <= 390 && widths.body <= 390, JSON.stringify(widths))
  await p.screenshot({ path: join(OUT, '07-390-scoped-list.png') })
  // the banner's terminal door must be a REAL door on the phone too: tap it and require the session
  // conversation to render (the deep-linked #/sessions/<id> plane), not just a hash change
  await p.click('.ds-banner a')
  await settle(p, 1000)
  const mTerm = await p.evaluate((sid) => ({
    hash: location.hash,
    detail: !!document.querySelector('.m-sessdetail'),
    id8: document.querySelector('.m-sess-id8')?.textContent || null,
  }), SESSION)
  check('390px banner door opens the session conversation', mTerm.hash === `#/sessions/${SESSION}` && mTerm.detail && mTerm.id8 === SHORT, JSON.stringify(mTerm))
  await p.screenshot({ path: join(OUT, '09-390-terminal-via-banner.png') })
  // the phone session surface's eval door: reach a session's detail (already open from the banner-door
  // leg, else tab-bar sessions → tap a row) and read the header's eval entry
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
