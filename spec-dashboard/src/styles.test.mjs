import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const css = readFileSync(join(here, 'styles.css'), 'utf8')
const terminal = readFileSync(join(here, 'SessionTerm.jsx'), 'utf8')
const terminalFont = readFileSync(join(here, 'terminalFont.js'), 'utf8')
const sessionInterface = readFileSync(join(here, 'SessionInterface.jsx'), 'utf8')
const composer = readFileSync(join(here, 'Composer.jsx'), 'utf8')
const timelineChat = readFileSync(join(here, 'TimelineChat.jsx'), 'utf8')
const mobileApp = readFileSync(join(here, 'MobileApp.jsx'), 'utf8')
const thread = readFileSync(join(here, 'Thread.jsx'), 'utf8')
const issues = readFileSync(join(here, 'IssuesPage.jsx'), 'utf8')
const resizable = readFileSync(join(here, 'useResizable.js'), 'utf8')
const xtermRuntime = readFileSync(join(dirname(require.resolve('@xterm/xterm/package.json')), 'lib/xterm.mjs'), 'utf8')

// A declaration and its value, for every rule in the sheet — the shared reader every gate below counts on.
const declarations = (property) => [...css.matchAll(new RegExp(`(?<![\\w-])${property}\\s*:\\s*([^;}]+)`, 'g'))]
  .map((match) => match[1].trim())

test('dashboard typography declarations use the shared scale', () => {
  const contracts = {
    'font-size': /^var\(--type-/,
    'font-weight': /^var\(--weight-/,
    'line-height': /^var\(--(?:leading|line)-/,
    'letter-spacing': /^var\(--tracking-/,
  }

  for (const [property, token] of Object.entries(contracts)) {
    const values = declarations(property)
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

test('the UI font is one swappable token, and it defaults to the terminal mono voice', () => {
  // Two roles: --mono is fixed (code, terminal output, ids, paths, columns), --ui-font is every word a
  // person parses as language. What makes the vocabulary retunable is that language sites spend the
  // TOKEN and never a family — so one line changes the product's voice. That line resolves to mono
  // today: the owner judged the sans board uglier and ruled the terminal look the default. The sans
  // stack stays declared as --ui-font-sans, the value the future per-user Settings toggle will offer.
  assert.match(css, /--mono:\s*'JetBrains Mono'/)
  assert.match(css, /--ui-font:\s*var\(--mono\);/, 'the UI font defaults to the mono stack')
  assert.match(css, /--ui-font-sans:\s*ui-sans-serif/, 'the optional sans stack stays available to Settings')
  assert.match(css, /body\s*\{[^}]*font-family:\s*var\(--ui-font\);/s)

  const families = [...css.matchAll(/font-family:\s*([^;}]+)|font:\s*[^;}]*?(var\(--(?:ui-font|mono)\))/g)]
    .map((m) => (m[1] || m[2]).trim())
  const raw = families.filter((v) => !/^var\(--(?:ui-font|mono)\)$/.test(v) && !/^inherit$/.test(v))
  assert.deepEqual(raw, [], 'every font-family must name one of the two role tokens')
  // both roles stay in use: collapsing language onto --mono directly would weld the board to one family
  // again and leave the toggle nothing to flip.
  assert.ok(families.filter((v) => v.includes('--mono')).length > 0, 'code and terminal surfaces still need mono')
  assert.ok(families.filter((v) => v.includes('--ui-font')).length > 0, 'language surfaces must spend the UI font token')
})

test('chrome labels are sentence case — no all-caps, no tracked-out shouting', () => {
  // calm-ui: an all-caps tracked label is decoration wearing the costume of hierarchy. Hierarchy here is
  // spent on space, then colour, then weight, then size — never on shape.
  assert.doesNotMatch(css, /text-transform:\s*uppercase/)
  assert.equal(declarations('letter-spacing').filter((v) => v !== 'var(--tracking-normal)').length, 0)
})

test('three weights, one radius token, one elevation — the geometry is spendable, not hand-written', () => {
  // Every extra weight is another way to say "important" competing with the ones that already work; every
  // hand-written radius is a number nobody can re-tune. The sheet declares the ladder and then uses it.
  const weights = new Set(declarations('font-weight'))
  assert.deepEqual([...weights].sort(), ['var(--weight-medium)', 'var(--weight-regular)', 'var(--weight-semibold)'])
  assert.doesNotMatch(css, /--weight-(?:bold|black)/)

  assert.match(css, /--radius:\s*6px;/)
  assert.match(css, /--radius-full:\s*999px;/)
  // a circle is a shape, not a step on a radius scale; everything else spends the token.
  const radii = declarations('border-radius')
    .filter((v) => !v.includes('var(--radius') && v !== '0' && !v.includes('50%'))
  assert.deepEqual([...new Set(radii)].sort(), ['1px', '2px'], 'only the sub-pixel marks may set a raw radius')

  assert.match(css, /--shadow:\s*0 4px 16px/)
  const drops = [...css.matchAll(/box-shadow:\s*([^;}]+)/g)].map((m) => m[1].trim())
    .filter((v) => !v.startsWith('inset') && !v.startsWith('var(--shadow)') && !v.startsWith('none'))
    .filter((v) => !/^0 0 0 /.test(v))    // rings (focus, avatar liveness) are borders drawn as shadows
  assert.deepEqual(drops.filter((v) => !/^0 1px 4px/.test(v)), [], 'one elevation token owns every real drop shadow')
})

test('the ground ladder is three tones deep and every theme carries all three', () => {
  // chrome recedes (--ground: rail, dock, status bar, context dock), toolbars sit between (--panel), and
  // the ONE content plane is the brightest (--paper). The whole point is that a reader can see where the
  // document is without a border telling them; two tones five values apart could not do that.
  const themes = [...css.matchAll(/:root(?:\[data-theme=\w+\])?\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1])
  assert.equal(themes.length, 8, 'the default plus seven presets')
  for (const block of themes) {
    for (const token of ['--paper', '--panel', '--ground']) {
      assert.match(block, new RegExp(`${token}:\\s*#[0-9a-f]{6};`), `${token} must be a resolved value in every theme`)
    }
  }
  assert.match(css, /\.side-rail\s*\{[^}]*background:\s*var\(--ground\);/s)
  assert.match(css, /\.dock\s*\{[^}]*background:\s*var\(--ground\);/s)
  assert.match(css, /\.statusbar\s*\{[^}]*background:\s*var\(--ground\);/s)
  assert.match(css, /\.tabstrip\s*\{[^}]*background:\s*var\(--panel\);/s)
  assert.match(css, /\.viewhost\s*\{[^}]*background:\s*var\(--paper\);/s)
  // the active tab is painted the CONTENT tone so the tab and its document read as one plane
  assert.match(css, /\.tab\.on\s*\{[^}]*background:\s*var\(--paper\);/s)
  // A SEAM IS A STEP, NOT A LINE: ground · the --edge hairline · one pixel of --panel · paper. The middle
  // rung is what makes the document read as raised, and it is why no panel here needs a drop shadow.
  assert.match(css, /\.viewhost\s*\{[^}]*box-shadow:\s*inset 1px 0 0 var\(--panel\);/s)
  // the dark terminal is a card ON the plane: a --paper gutter runs down its leading edge
  assert.match(css, /\.si-content\s*\{[^}]*padding-left:\s*var\(--space-\d\);[^}]*background:\s*var\(--paper\);/s)
})

test('the chrome bands the budget does not allow are gone from the sheet', () => {
  // [[ui-state-model]]'s band budget is the structural gate; these are the strips it named. Each one is
  // removed at the source — merged into the band that already existed, folded into scrolling content, or
  // deleted — so no rule here can quietly bring one back.
  for (const retired of [
    'app-main-top', 'ft-head', 'dock-session-head', 'dock-session-archive',
    'specview-files', 'fileview-head', 'srcview-foot', 'sesswin',
  ]) assert.doesNotMatch(css, new RegExp(`\\.${retired}\\b`), `${retired} is a retired band`)
  // the dock is ONE band, and the source viewer's progress floats instead of banding
  assert.match(css, /\.dock-head\s*\{[^}]*border-bottom:\s*1px solid var\(--edge\);/s)
  assert.match(css, /\.srcview-progress\s*\{[^}]*position:\s*absolute;/s)
  // the conversation composer floats over its reading column, exactly like the terminal's command box
  assert.match(css, /\.m-composer\s*\{[^}]*position:\s*absolute;/s)
})

test('tab widths shrink elastically before wrapping and keep the active close affordance', () => {
  assert.match(css, /\.tabstrip-tabs\s*\{[^}]*flex-wrap:\s*wrap;/s)
  assert.match(css, /\.tab\s*\{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*80px;[^}]*max-width:\s*240px;[^}]*container-type:\s*inline-size;/s)
  assert.match(css, /\.tab\.on\s*\{[^}]*min-width:\s*112px;/s)
  assert.match(css, /\.tab\.on \.tab-x, \.tab:hover \.tab-x\s*\{[^}]*opacity:\s*1;/s)
  assert.match(css, /\.tabstrip-tabs:has\(\.tab:nth-child\(8\)\) \.tab\s*\{[^}]*max-width:\s*none;/s)
  assert.match(css, /@container \(max-width:\s*140px\)\s*\{[^}]*\.tab-face/s)
  assert.match(css, /@container \(max-width:\s*100px\)\s*\{[^}]*\.tab-dot, \.tab-spinner\s*\{[^}]*display:\s*none;/s)
})

test('wheel is xterm-native — no browser quantizer, ledger, or synthetic bottoming', () => {
  // the browser reimplementing wheel→SGR conversion was a bug factory (X10 corruption, min-tick
  // amplification, growth race, flip loss, top clamp). xterm's own mouse-report mode conversion —
  // the same path iTerm and VS Code ship — owns the wheel; the browser holds no wheel state at all.
  assert.doesNotMatch(terminal, /attachCustomWheelEventHandler/)
  assert.doesNotMatch(terminal, /wheelAcc|wheelNet/)
  assert.doesNotMatch(terminal, /t: 'wheel'/)
})

test('pointer is the browser\'s; motion never reports; wheel-only reporting reaches tmux', () => {
  // three cuts keep mouse events away from the agent TUI: motion-tracking DECSETs are consumed
  // (hover emits nothing), the patched selection predicate makes plain drag a local selection
  // (button events never become reports), and button mode 1000 + SGR 1006 pass through so xterm
  // still emits the wheel reports tmux's copy-mode rebinds consume.
  assert.match(terminal, /MOTION_TRACKING_MODES\s*=\s*new Set\(\[9, 1002, 1003, 1005, 1015\]\)/)
  assert.match(terminal, /onlyMotionTrackingModes/)
  assert.match(xtermRuntime, /shouldForceSelection\(e\)\{return!0\}/)
  assert.match(terminal, /disableStdin:\s*!writable/)
  assert.match(terminal, /term\.options\.disableStdin = !writable/)
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
  // the pane's `active` follows whether its layer is actually shown. Cold sessions resolve their base to the
  // shared Conversation surface, while a resource overlay still makes every base layer stand down.
  assert.match(sessionInterface, /const baseShown = id === active && !activeResource/)
  assert.match(sessionInterface, /const terminalShown = baseShown && activeBaseSurface === 'terminal'/)
  assert.match(sessionInterface, /<SessionTerm sessionId=\{id\} active=\{open && terminalShown\}/)
  // and it must be hidden AND pointer-inert while Conversation or a resource owns the surface.
  assert.match(sessionInterface, /visibility: terminalShown \? 'visible' : 'hidden',\s*\n\s*pointerEvents: terminalShown \? 'auto' : 'none',/)
})

test('document pages share one inset page-scroll geometry', () => {
  assert.match(css, /\.page-pane\s*\{[^}]*overflow:\s*hidden;/s)
  assert.match(css, /\.page-scroll\s*\{[^}]*margin:\s*10px 14px 10px 0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s)
  assert.match(css, /\.page-scroll\s*\{[^}]*scrollbar-gutter:\s*stable;/s)
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.page-scroll\s*\{[^}]*margin:\s*10px 0;[^}]*scrollbar-gutter:\s*auto;/s)
})

test('desktop navigation rail stays compact without changing its icon grammar', () => {
  assert.match(css, /\.side-rail\s*\{[^}]*flex:\s*0 0 40px;[^}]*align-items:\s*center;/s)
  assert.match(css, /\.rail-btn\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*justify-content:\s*center;/s)
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
  assert.match(css, /\.si-command-box\s*\{[^}]*left:\s*50%;[^}]*bottom:\s*22%;[^}]*transform:\s*translateX\(-50%\);[^}]*width:\s*min\(680px, calc\(100% - 32px\)\);/s)
  assert.match(css, /\.si-command-input\s*\{[^}]*max-height:\s*min\(28cqh, 240px\);[^}]*resize:\s*none;/s)
  assert.match(css, /\.si-command-tools\s*\{[^}]*display:\s*flex;[^}]*border-top:/s)
  assert.doesNotMatch(css, /\.si-bottom|--si-dock-h/)
  assert.match(sessionInterface, /<ComposerSurface[\s\S]*className=\{`si-command-box/)
  assert.match(composer, /fitTextarea\(textarea, parseFloat\(styles\.maxHeight\)/)
  assert.match(thread, /<ComposerSurface className="fv-compose"/)
  assert.match(thread, /<ComposerTextarea ref=\{taRef\}/)
  assert.match(issues, /<ComposerTextarea ref=\{taRef\}/)
  assert.match(sessionInterface, /<ComposerTextarea ref=\{msgRef\} className="si-command-input"/)
  assert.match(timelineChat, /<ComposerTextarea[\s\S]*className="m-input"/)
  assert.match(mobileApp, /<ComposerTextarea[\s\S]*className="m-input m-new-input"/)
  assert.match(composer, /export function composingKey/)
})

test('completed attachment rows fade and remove themselves while failures stay actionable', () => {
  assert.match(css, /\.si-attach-row\.complete\s*\{[^}]*animation:\s*si-attach-complete-out\s+1\.4s\s+ease\s+forwards;/)
  assert.match(css, /@keyframes\s+si-attach-complete-out\s*\{[\s\S]*opacity:\s*0;[\s\S]*pointer-events:\s*none;/)
  assert.match(sessionInterface, /onAnimationEnd=\{\(event\) => \{[\s\S]*event\.animationName === 'si-attach-complete-out'[\s\S]*dismissAttachment\(item\.id\)/)
  assert.match(sessionInterface, /item\.phase === 'failed' && <IconButton[\s\S]*attachRetry/)
  assert.match(sessionInterface, /item\.phase === 'complete' \|\| item\.phase === 'cancelled'/)
})

test('terminal viewport clips — tmux owns all scrolling', () => {
  // scrollback:0 means the pane viewport can never hold real history; an `auto` overflow lets a fractional
  // DPR/geometry overshoot render a phantom themed browser scrollbar over the terminal's right edge.
  assert.match(css, /\.st-host \.xterm-viewport\s*\{[^}]*overflow:\s*hidden !important;/s)
  assert.doesNotMatch(css, /\.st-host \.xterm-viewport\s*\{[^}]*overflow-y:\s*auto/s)
})

test('terminal chrome is overflow:clip — never a caret-reveal scroll container', () => {
  // overflow:hidden is still programmatically scrollable, and Chromium's caret-reveal drags it sideways
  // to chase xterm's composition textarea when an IME opens at the rightmost columns — the whole pane
  // lurched left by the composition's width. clip removes the scroller on every chrome box around xterm.
  assert.match(css, /\.st-host\s*\{[^}]*overflow:\s*clip;/s)
  assert.match(css, /\.si-term-body\s*\{[^}]*overflow:\s*clip;/s)
  assert.match(css, /\.si-panel\s*\{[^}]*overflow:\s*clip;/s)
})

test('the fit remainder rests naturally below the last row — no alignment artifice', () => {
  // a plain terminal top-aligns content and lets the fractional leftover sit at the BOTTOM. The old
  // flex-end pinned the grid to the bottom edge and moved that natural gap to the top, which read as
  // a cramped bottom. Normal flow, no flex, no reserved padding.
  assert.doesNotMatch(css, /\.st-host\s*\{[^}]*flex-end/s)
  assert.doesNotMatch(css, /\.st-host\s+\.xterm\s*\{[^}]*padding-bottom/s)
  assert.match(css, /\.st-host\s*\{[^}]*overflow:\s*clip;\s*\}/s)
  assert.match(css, /\.st-host\s+\.xterm\s*\{[^}]*width:\s*auto\s*!important;[^}]*height:\s*auto\s*!important;/s)
})

test('selected nested session keeps its lead separated from the revealed headline', () => {
  // the lead must FLOAT: an inline-level lead before the block headline would claim a line of its
  // own, stranding the fold pod alone on line 1 with the headline starting on line 2.
  assert.match(
    css,
    /\.si-item\.on\s+\.sess-lead\s*\{[^}]*float:\s*left;[^}]*margin-right:\s*7px;/s,
  )
})

test('sessions document has no duplicate sidebar or scrollport', () => {
  assert.match(css, /\.si-page\s*\{[^}]*min-height:\s*0;/s)
  assert.doesNotMatch(css, /\.si-list\s*\{|\.si-board-scroll\s*\{|\.si-resizer\s*\{/)
  assert.match(css, /\.dock-session-list\s*\{[^}]*overflow:\s*auto;/s)
  // the archive door moved into the dock's ONE header row rather than keeping a strip under the list
  assert.match(css, /\.dock-head-acts\s*\{[^}]*margin-left:\s*auto;/s)
})

test('sessions dock keeps the tree list geometry', () => {
  assert.doesNotMatch(css, /\.si-list\s*\{|\.si-board-scroll\s*\{|\.si-resizer\s*\{/)
  assert.match(css, /\.dock-session-list\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/s)
  assert.match(sessionInterface, /archiveRequested = false/)
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
