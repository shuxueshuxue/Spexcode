import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'styles.css'), 'utf8')
const terminal = readFileSync(join(here, 'SessionTerm.jsx'), 'utf8')
const terminalFont = readFileSync(join(here, 'terminalFont.js'), 'utf8')
const sessionInterface = readFileSync(join(here, 'SessionInterface.jsx'), 'utf8')
const xtermRuntime = readFileSync(join(here, '../node_modules/@xterm/xterm/lib/xterm.mjs'), 'utf8')

test('dashboard typography declarations use the shared scale', () => {
  const contracts = {
    'font-size': /^var\(--type-/,
    'font-weight': /^var\(--weight-/,
    'line-height': /^var\(--(?:leading|line)-/,
    'letter-spacing': /^var\(--tracking-/,
  }

  for (const [property, token] of Object.entries(contracts)) {
    const values = [...css.matchAll(new RegExp(`${property}\\s*:\\s*([^;}]+)`, 'g'))]
      .map((match) => match[1].trim())
    assert.ok(values.length > 0, `${property} declarations should exist`)
    assert.deepEqual(
      values.filter((value) => !token.test(value)),
      [],
      `${property} must use its shared typography token`,
    )
  }

  assert.match(terminalFont, /getPropertyValue\('--type-terminal'\)/)
  assert.doesNotMatch(terminal, /fontSize:\s*\d/)
})

test('wheel deltas accumulate proportionally — no min-1-tick amplification', () => {
  // a trackpad momentum gesture emits dozens of micro-deltas; forcing ≥1 tick per event multiplies
  // travel and makes the return leg asymmetric. Deltas accumulate to whole ticks with carry.
  assert.match(terminal, /wheelAcc \+= ev\.deltaY/)
  assert.match(terminal, /Math\.floor\(Math\.abs\(wheelAcc\) \/ 40\)/)
  assert.doesNotMatch(terminal, /Math\.max\(1, Math\.round\(Math\.abs\(ev\.deltaY\)/)
})

test('a returning scroll gesture finishes with a bottoming burst', () => {
  // content growth during an excursion leaves a symmetric return short of the live bottom: the TUI's
  // scrolled view impersonates the live tail and the watched seconds freeze. The net-tick ledger
  // detects the return-to-zero and restores the natural human overshoot.
  assert.match(terminal, /wheelNet \+= up \? ticks : -ticks/)
  assert.match(terminal, /wasAbove && wheelNet <= 0/)
  assert.match(terminal, /up: false, col, row, ticks: 5/)
})

test('read-only terminal keeps selection off application mouse reporting', () => {
  assert.match(terminal, /MOUSE_REPORT_MODES\s*=\s*new Set\(\[9, 1000, 1002, 1003, 1005, 1006, 1015, 1016\]\)/)
  assert.match(terminal, /term\.parser\.registerCsiHandler\([\s\S]*onlyMouseReportModes/)
  assert.match(terminal, /term\.attachCustomWheelEventHandler/)
  assert.doesNotMatch(terminal, /shouldForceSelection/)
})

test('pinned xterm defers renderer resize inside synchronized output', () => {
  assert.match(xtermRuntime, /_isPaused\|\|this\._coreService\.decPrivateModes\.synchronizedOutput/)
  assert.match(xtermRuntime, /synchronizedOutput\)\{this\._syncOutputHandler\.bufferRows\([^)]+\);return\}this\._pausedResizeTask\.flush\(\)/)
  assert.doesNotMatch(terminal, /st-frame-latch|holdRenderedFrame|_renderService/)
  assert.match(terminal, /frameOwnsSync\s*&&\s*onlySynchronizedOutput/)
  assert.match(terminal, /term\.write\(SYNC_BEGIN[\s\S]*term\.write\(frame[\s\S]*term\.write\(SYNC_END/)
  assert.match(terminal, /frameQueue[\s\S]*drainFrames/)
})

test('pinned xterm boxes DOM glyph runs by their terminal cells', () => {
  assert.match(xtermRuntime, /parseFloat\([^)]*style\.width\)/)
  assert.match(xtermRuntime, /style\.display="inline-block"/)
  assert.match(xtermRuntime, /style\.overflow="hidden"/)
})

test('terminal font preference reuses the ordinary fit and geometry request', () => {
  assert.match(terminalFont, /localStorage\.getItem/)
  assert.match(terminalFont, /localStorage\.setItem/)
  assert.match(terminalFont, /subscribeTerminalFontSize/)
  assert.match(terminal, /subscribeTerminalFontSize/)
  assert.match(terminal, /term\.options\.fontSize\s*=\s*fontSize/)
  assert.match(terminal, /lastSizeRef\.current\s*=\s*\{ cols: 0, rows: 0 \}[\s\S]*measureRef\.current\?\.\(\)/)
})

test('browser page visibility reuses the terminal viewer lifecycle', () => {
  assert.match(terminal, /viewerIsVisible\s*=\s*\(\)\s*=>\s*activeRef\.current\s*&&\s*document\.visibilityState\s*!==\s*'hidden'/)
  assert.match(terminal, /document\.addEventListener\('visibilitychange', onDocumentVisibility\)/)
  assert.match(terminal, /if \(!viewerIsVisible\(\)\)\s*\{\s*hideRef\.current\?\.\(\)/)
  assert.match(terminal, /lastSizeRef\.current\s*=\s*\{ cols: 0, rows: 0 \}\s*measureAndRequest\(\)/)
  assert.match(sessionInterface, /<SessionTerm sessionId=\{id\} active=\{open && id === active\}/)
})

test('document pages share one inset page-scroll geometry', () => {
  assert.match(css, /\.page-pane\s*\{[^}]*overflow:\s*hidden;/s)
  assert.match(css, /\.page-scroll\s*\{[^}]*margin:\s*10px 14px 10px 0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s)
  assert.match(css, /\.page-scroll\s*\{[^}]*scrollbar-gutter:\s*stable;/s)
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.page-scroll\s*\{[^}]*margin:\s*10px 0;[^}]*scrollbar-gutter:\s*auto;/s)
})

test('scoped Evals gates are an opaque sticky strip inside that scroll owner', () => {
  assert.match(css, /\.se-gates\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*4;[^}]*flex:\s*0 0 40px;[^}]*height:\s*40px;/s)
  assert.match(css, /\.se-gates\s*\{[^}]*border-bottom:\s*1px solid var\(--line\);[^}]*background:\s*var\(--panel2\);/s)
  assert.match(css, /\.lp-head\s*\{[^}]*z-index:\s*5;/s)
  assert.match(css, /\.rl-menu\s*\{[^}]*z-index:\s*20;/s)
  assert.match(css, /\.ui-tip\s*\{[^}]*z-index:\s*100;/s)
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.se-gates\s*\{[^}]*flex-basis:\s*80px;[^}]*height:\s*80px;/s)
})

test('terminal composer docks flush at the bottom and keeps ❯ on the active line', () => {
  assert.match(
    css,
    /\.si-content\s*\{[^}]*--si-dock-h:\s*44px;/s,
  )
  // flush-bottom footer: only a top border (no float/inset/radius/side borders), controls anchored to the
  // bottom (active) line via flex-end, so a grown multi-line box keeps ❯ tracking the caret, not mid-box.
  assert.match(
    css,
    /\.si-bottom\s*\{[^}]*left:\s*0;[^}]*right:\s*0;[^}]*bottom:\s*0;[^}]*align-items:\s*flex-end;[^}]*min-height:\s*44px;[^}]*box-sizing:\s*border-box;[^}]*border-top:\s*1px solid var\(--line\);[^}]*background-clip:\s*padding-box;/s,
  )
  assert.match(
    css,
    /\.si-bottom\s+\.si-input\s*\{[^}]*min-height:\s*20px;[^}]*line-height:\s*var\(--line-input\);/s,
  )
  // the paperclip carries NO align-self override, so it inherits the base .si-attach flex-end and tracks
  // the same bottom line as ❯ (the align-items:center override that stranded it mid-box is gone).
  assert.doesNotMatch(
    css,
    /\.si-bottom\s+\.si-attach\s*\{[^}]*align-self:/s,
  )
})

test('terminal viewport clips — tmux owns all scrolling', () => {
  // scrollback:0 means the pane viewport can never hold real history; an `auto` overflow lets a fractional
  // DPR/geometry overshoot render a phantom themed browser scrollbar over the terminal's right edge.
  assert.match(css, /\.st-host \.xterm-viewport\s*\{[^}]*overflow:\s*hidden !important;/s)
  assert.doesNotMatch(css, /\.st-host \.xterm-viewport\s*\{[^}]*overflow-y:\s*auto/s)
})

test('a shared terminal grid aligns to the input instead of leaving a bottom void', () => {
  assert.match(css, /\.st-host\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*flex-end;/s)
  assert.match(css, /\.st-host\s+\.xterm\s*\{[^}]*width:\s*auto\s*!important;[^}]*height:\s*auto\s*!important;[^}]*flex:\s*none;/s)
})

test('selected nested session keeps its lead separated from the revealed headline', () => {
  assert.match(
    css,
    /\.si-item\.on\s+\.sess-lead\s*\{[^}]*margin-right:\s*7px;/s,
  )
})

test('projects hub + credential surfaces read the shared palette, never a one-off color', () => {
  // the whole appended [[projects-hub]] block themes itself through the var set — a raw hex literal
  // there would be a palette the eight theme presets cannot re-skin.
  const start = css.indexOf('projects hub ([[projects-hub]])')
  assert.ok(start > 0, 'projects-hub style block present')
  const block = css.slice(start)
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/)
  // the health dot maps the probed health onto semantic accents
  assert.match(block, /\.proj-health\.h-running\s*\{\s*background:\s*var\(--green\);/)
  assert.match(block, /\.proj-health\.h-unreachable\s*\{\s*background:\s*var\(--red\);/)
  // the credential card is panel-on-paper like every other card in the app
  assert.match(block, /\.cred-card\s*\{[^}]*background:\s*var\(--panel\);[^}]*border:\s*1px solid var\(--line\);/s)
})
