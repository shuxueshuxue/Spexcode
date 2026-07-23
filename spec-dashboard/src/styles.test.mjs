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
const composer = readFileSync(join(here, 'Composer.jsx'), 'utf8')
const thread = readFileSync(join(here, 'Thread.jsx'), 'utf8')
const issues = readFileSync(join(here, 'IssuesPage.jsx'), 'utf8')
const resizable = readFileSync(join(here, 'useResizable.js'), 'utf8')
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

test('wheel is xterm-native — no browser quantizer, ledger, or synthetic bottoming', () => {
  // the browser reimplementing wheel→SGR conversion was a bug factory (X10 corruption, min-tick
  // amplification, growth race, flip loss, top clamp). xterm's own mouse-report mode conversion —
  // the same path iTerm and VS Code ship — owns the wheel; the browser holds no wheel state at all.
  assert.doesNotMatch(terminal, /attachCustomWheelEventHandler/)
  assert.doesNotMatch(terminal, /wheelAcc|wheelNet/)
  assert.doesNotMatch(terminal, /t: 'wheel'/)
})

test('mouse-report DECSETs reach xterm; selection uses the modifier convention', () => {
  // tmux (mouse on) and the pane TUI enable mouse-report mode on this client and xterm honors it
  // natively — no parser handler eats the mode list. Local selection follows every real terminal:
  // Shift-drag (Option-drag on macOS via macOptionClickForcesSelection) forces browser selection.
  assert.doesNotMatch(terminal, /MOUSE_REPORT_MODES|onlyMouseReportModes/)
  assert.match(terminal, /macOptionClickForcesSelection:\s*true/)
  assert.match(terminal, /disableStdin:\s*false/)
  assert.match(terminal, /term\.onData\(\(data\)/)
  assert.match(terminal, /sock\.send\(JSON\.stringify\(\{ t: 'input', data \}\)\)/)
  assert.match(terminal, /const initialFocusFrame = requestAnimationFrame\([\s\S]*term\.focus\(\)/)
  assert.doesNotMatch(terminal, /_core\.focus/)
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

test('Command Box floats lower-middle and grows above a fixed footer', () => {
  assert.match(css, /\.si-term-body\s*\{[^}]*container-type:\s*size;[^}]*background:\s*var\(--term-bg\);/s)
  assert.doesNotMatch(css, /\.si-term-body\s*\{[^}]*margin-bottom:/s)
  assert.match(css, /\.si-command-box\s*\{[^}]*left:\s*50%;[^}]*bottom:\s*32%;[^}]*transform:\s*translateX\(-50%\);[^}]*width:\s*min\(680px, calc\(100% - 32px\)\);/s)
  assert.match(css, /\.si-command-input\s*\{[^}]*max-height:\s*min\(28cqh, 240px\);[^}]*resize:\s*none;/s)
  assert.match(css, /\.si-command-tools\s*\{[^}]*display:\s*flex;[^}]*border-top:/s)
  assert.doesNotMatch(css, /\.si-bottom|--si-dock-h/)
  assert.match(sessionInterface, /<ComposerSurface[\s\S]*className=\{`si-command-box/)
  assert.match(composer, /fitTextarea\(textarea, parseFloat\(styles\.maxHeight\)/)
  assert.match(thread, /<ComposerSurface className="fv-compose"/)
  assert.match(thread, /<ComposerTextarea ref=\{taRef\}/)
  assert.match(issues, /<ComposerTextarea ref=\{taRef\}/)
  assert.match(sessionInterface, /<ComposerTextarea ref=\{msgRef\} className="si-command-input"/)
  assert.match(composer, /export function composingKey/)
})

test('terminal viewport clips — tmux owns all scrolling', () => {
  // scrollback:0 means the pane viewport can never hold real history; an `auto` overflow lets a fractional
  // DPR/geometry overshoot render a phantom themed browser scrollbar over the terminal's right edge.
  assert.match(css, /\.st-host \.xterm-viewport\s*\{[^}]*overflow:\s*hidden !important;/s)
  assert.doesNotMatch(css, /\.st-host \.xterm-viewport\s*\{[^}]*overflow-y:\s*auto/s)
})

test('a native client grid stays bottom-aligned through fractional fit remainder', () => {
  assert.match(css, /\.st-host\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*flex-end;/s)
  assert.match(css, /\.st-host\s+\.xterm\s*\{[^}]*width:\s*auto\s*!important;[^}]*height:\s*auto\s*!important;[^}]*flex:\s*none;/s)
})

test('selected nested session keeps its lead separated from the revealed headline', () => {
  // the lead must FLOAT: an inline-level lead before the block headline would claim a line of its
  // own, stranding the fold pod alone on line 1 with the headline starting on line 2.
  assert.match(
    css,
    /\.si-item\.on\s+\.sess-lead\s*\{[^}]*float:\s*left;[^}]*margin-right:\s*7px;/s,
  )
})

test('session sidebar defaults denser and caps selected headlines at three lines', () => {
  assert.match(css, /\.si-list\s*\{[^}]*flex:\s*0 0 204px;/s)
  assert.match(css, /\.si-item\s*\{[^}]*font-size:\s*var\(--type-caption\);[^}]*line-height:\s*var\(--line-session-row\);/s)
  // the 3lh cap clips with overflow:CLIP, never hidden — hidden makes the headline a BFC that may not
  // overlap the floated status marker, narrowing the WHOLE block into a column beside it.
  assert.match(css, /\.si-item\.on \.sess-id\s*\{[^}]*max-height:\s*3lh;[^}]*overflow:\s*clip;/s)
  assert.match(sessionInterface, /useResizable\('spex\.siListWidth', 204, \{ min: 180, max: 480 \}\)/)
  assert.match(sessionInterface, /scrollIntoView\(\{ block: 'nearest' \}\)/)
  assert.match(sessionInterface, /onDoubleClick=\{resetListW\}/)
  assert.match(resizable, /localStorage\.removeItem\(key\)/)
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
