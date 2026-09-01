import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const css = readFileSync(join(here, 'styles.css'), 'utf8')
const shell = readFileSync(join(here, 'Shell.jsx'), 'utf8')
const terminal = readFileSync(join(here, 'terminal/SessionTerminal.tsx'), 'utf8')
const terminalFont = readFileSync(join(here, 'terminalFont.js'), 'utf8')
const sessionInterface = readFileSync(join(here, 'SessionInterface.jsx'), 'utf8')
const sessionsView = readFileSync(join(here, 'SessionsView.jsx'), 'utf8')
const composer = readFileSync(join(here, 'Composer.jsx'), 'utf8')
const timelineChat = readFileSync(join(here, 'TimelineChat.jsx'), 'utf8')
const attachQueue = readFileSync(join(here, 'useAttachQueue.jsx'), 'utf8')
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

test('three weights, two radius rungs, one elevation — the geometry is spendable, not hand-written', () => {
  // Every extra weight is another way to say "important" competing with the ones that already work; every
  // hand-written radius is a number nobody can re-tune. The sheet declares the ladder and then uses it.
  const weights = new Set(declarations('font-weight'))
  assert.deepEqual([...weights].sort(), ['var(--weight-medium)', 'var(--weight-regular)', 'var(--weight-semibold)'])
  assert.doesNotMatch(css, /--weight-(?:bold|black)/)

  // TWO rungs, because a corner is proportional to its box: the control rung, and one for a surface that
  // owns a whole region (a 6px corner on a 980px dialog is a corner nobody sees). Both are tokens, so a
  // preset retunes the product's geometry in one row — Notion's tighter row sets both.
  assert.match(css, /--radius:\s*6px;/)
  assert.match(css, /--radius-lg:\s*14px;/)
  assert.match(css, /--radius-full:\s*999px;/)
  const notionGeometry = css.match(/:root\[data-theme=notion\]\s*\{([\s\S]*?)\n\}/)[1]
  for (const rung of ['--radius', '--radius-lg']) {
    assert.match(notionGeometry, new RegExp(`${rung}:\\s*\\d+px;`), `a preset that retunes geometry resolves ${rung} too`)
  }
  // a circle is a shape, not a step on a radius scale; everything else spends the token.
  const radii = declarations('border-radius')
    .filter((v) => !v.includes('var(--radius') && v !== '0' && !v.includes('50%'))
  assert.deepEqual([...new Set(radii)].sort(), ['1px', '2px'], 'only the sub-pixel marks may set a raw radius')

  assert.match(css, /--shadow:\s*0 4px 16px/)
  const drops = [...css.matchAll(/box-shadow:\s*([^;}]+)/g)].map((m) => m[1].trim())
    .filter((v) => !v.startsWith('inset') && !v.startsWith('var(--shadow)') && !v.startsWith('none'))
    .filter((v) => !/^0 0 0 /.test(v) && v !== 'var(--focus-ring)')    // rings (focus, avatar liveness) are borders drawn as shadows
  assert.deepEqual(drops.filter((v) => !/^0 1px 4px/.test(v)), [], 'one elevation token owns every real drop shadow')
})

test('the ground ladder is four tones deep and every theme carries all four', () => {
  // chrome recedes (--ground: rail, dock, status bar, context dock), toolbars sit between (--panel),
  // the ONE content plane is next (--paper), and --raised is the only rung ABOVE it: what a menu, a
  // pop-over, or a floating composer is painted. The whole point is that a reader can see where the
  // document is without a border telling them; two tones five values apart could not do that.
  const themes = [...css.matchAll(/:root(?:\[data-theme=\w+\])?\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1])
  assert.equal(themes.length, 9, 'the default plus eight presets')
  for (const block of themes) {
    for (const token of ['--paper', '--panel', '--ground', '--raised']) {
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
  // rung is what makes the document read as raised, and it is why no panel here needs a drop shadow. Across
  // the top the hairline is the BAND's — an inset at its bottom edge that the active tab's paper covers, so
  // the tab joins its document — and the content host owns no top rule of its own.
  assert.match(css, /\.tabstrip\s*\{\s*box-shadow:\s*inset 0 -1px 0 var\(--edge\);\s*\}/)
  assert.match(css, /\.tab:not\(\.on\)\s*\{[^}]*background:\s*var\(--panel\);[^}]*box-shadow:\s*inset 0 -1px 0 var\(--edge\);/s)
  assert.doesNotMatch(css, /\.viewhost\s*\{[^}]*border-top:/s)
  assert.match(css, /\.viewhost\s*\{[^}]*box-shadow:\s*inset 1px 0 0 var\(--panel\);/s)
  // the dark terminal is a WELL in the plane: a --paper gutter runs down its leading edge
  assert.match(css, /\.si-content\s*\{[^}]*padding-left:\s*var\(--space-\d\);[^}]*background:\s*var\(--paper\);/s)
})

// CIE L* — perceptual lightness, 0 (black) to 100 (white). It is the metric the ladder is stated in,
// because a WCAG contrast RATIO compresses to nothing at the dark end (two surfaces a plainly visible
// step apart both sit at ~1.1:1) and would call a broken ramp and a good one the same number.
const lstar = (hex) => {
  const channel = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255))
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (y * 24389) / 27
}
const palettes = () => Object.fromEntries([...css.matchAll(/:root(?:\[data-theme=(\w+)\])?\s*\{([\s\S]*?)\n\}/g)]
  .map(([, name, block]) => [name || 'minimal', Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]),
  )]))

test('the ladder only ever runs one way, and a surface that floats is the top of it', () => {
  // DEPTH HAS A DIRECTION, and it is the physical one: light falls from above, so a surface that is
  // higher catches more of it. Every reference system states the same rule — Material 3's dark surface
  // containers climb T4→T22 with elevation, IBM Carbon's dark layers "become one step lighter with each
  // added layer", and both fall back to the SHADOW in light themes, where the plane is already white and
  // there is no headroom left to climb. So: the ladder never inverts, and --raised is never below the
  // plane it floats over. Before this gate the menus were painted --panel — a rung BELOW --paper — which
  // read as a hole punched in the window rather than a card lifted off it.
  for (const [name, p] of Object.entries(palettes())) {
    assert.ok(lstar(p['--ground']) < lstar(p['--panel']), `${name}: chrome floor sits under the panel tone`)
    assert.ok(lstar(p['--panel']) < lstar(p['--paper']), `${name}: the panel tone sits under the content plane`)
    assert.ok(lstar(p['--raised']) >= lstar(p['--paper']), `${name}: a floating surface is never darker than the plane`)
  }
})

test('every depth step is big enough to see, and the terminal owns a tone nothing else uses', () => {
  // HOW BIG A STEP HAS TO BE is a number, not a matter of taste, and it is TWO numbers because the
  // sheet makes two different claims with a tone. A flat-field lightness JND is about 1 L*, and the
  // systems that get this right spend far more than that:
  //   * a REGION step (this surface is a different part of the window) runs 3.5-4 L* in practice —
  //     VS Code Dark Modern's sidebar-to-editor is 3.5, Material 3's surface-to-surfaceContainerLow 4.
  //   * an ELEVATION step (this surface has left the plane) runs 6-11 — Carbon's dark layers step
  //     8-11, Material 3's dark surface containers 5-6, VS Code's editor-to-dropdown 8.6.
  // A menu is making the second claim, so it pays the second price. A LIGHT preset is exempt from the
  // lift by construction: its plane is already at the top of the range, which is exactly why its
  // --shadow is the strong one and the dark presets' is nearly inert.
  const REGION = 4
  const ELEVATION = 6
  for (const [name, p] of Object.entries(palettes())) {
    const light = new RegExp(`:root\\[data-theme=${name}\\]\\s*\\{[^}]*color-scheme:\\s*light`, 's').test(css)
    const term = p['--term-bg'] ?? p['--ground']   // a dark preset inherits :root's --term-bg: var(--ground)
    // THE TERMINAL IS A MEDIUM, NOT A RUNG. It is the darkest thing in the window in every preset, and
    // no rung the chrome is painted with may land on it — a menu the exact value of the pane underneath
    // it is a menu with no boundary at all, which is what five of these presets shipped.
    assert.ok(lstar(term) <= lstar(p['--ground']) , `${name}: the terminal is the floor of the window`)
    assert.ok(lstar(p['--paper']) - lstar(term) >= REGION, `${name}: the plane reads as a step above the terminal`)
    assert.ok(lstar(p['--raised']) - lstar(term) >= ELEVATION, `${name}: a menu over the terminal has a ground of its own`)
    if (light) continue
    assert.ok(lstar(p['--raised']) - lstar(p['--paper']) >= ELEVATION, `${name}: a dark preset lifts its floating surfaces`)
  }
})

test('what floats spends the drop AND the raised rung — one token pair, no third answer', () => {
  // --shadow is the sheet's own definition of "this thing has left the plane" ([[typography]]: one
  // elevation, spent only by things that genuinely float). So the set of rules that spend it is exactly
  // the set that must be painted --raised, and the gate can just check the two agree. Before this, the
  // 26 floating surfaces drew from THREE different rungs depending on which file they were written in:
  // --panel for most menus, --paper for the popovers, --panel2 for the tooltip.
  const floating = [...css.matchAll(/([^{}/]*?)\{([^{}]*)\}/g)]
    .filter(([, , body]) => body.includes('var(--shadow)'))
    .map(([, selector, body]) => [selector.trim().split('\n').pop().trim(), body])
  assert.ok(floating.length > 20, 'the sheet still has a floating-surface population to check')
  for (const [selector, body] of floating) {
    const background = /(?<![\w-])background(?:-color)?:\s*([^;}]+)/.exec(body)?.[1]?.trim()
    if (!background || background === 'transparent') continue   // the drag ghost and the lightbox carry no plate
    assert.match(background, /var\(--raised\)/, `${selector} floats, so it is painted the raised rung`)
  }
})

test('how the board responds is spent through interaction tokens a preset can retune', () => {
  // hover, press, and selection washes, one focus ring, and the field bed are declared on :root and derived
  // from the palette, so every preset responds coherently without declaring them — and a preset that wants
  // its own answer (Notion's flat washes and inset ring) sets the token, never a component rule.
  const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)[1]
  for (const token of ['--wash-hover', '--wash-active', '--wash-selected', '--focus-ring', '--field-bg']) {
    assert.match(root, new RegExp(`${token}:\\s*[^;]+;`), `${token} is declared on :root`)
  }
  assert.match(root, /color-scheme:\s*dark;/)
  const notion = css.match(/:root\[data-theme=notion\]\s*\{([\s\S]*?)\n\}/)[1]
  assert.match(notion, /color-scheme:\s*light;/)
  assert.match(notion, /--ui-font:\s*var\(--ui-font-sans\);/, 'the Notion preset speaks the sans voice')
  // the ring is ONE rule: no control hand-writes its own focus outline any more
  assert.equal(css.match(/outline:\s*[12]px solid var\(--blue\)/g)?.length ?? 0, 0)
  assert.match(css, /:focus-visible\s*\{[^}]*box-shadow:\s*var\(--focus-ring\);/s)
})

test('the theme picker paints each preset with the palette the sheet actually resolves', async () => {
  // Settings shows a swatch per preset from theme.js; a swatch that drifted from its :root row would show a
  // palette nobody gets. Ground, paper, ink, and accent are read straight from each theme block.
  const { THEMES } = await import('./theme.js')
  const rows = Object.fromEntries([...css.matchAll(/:root(?:\[data-theme=(\w+)\])?\s*\{([\s\S]*?)\n\}/g)].map((m) => [m[1] || 'minimal', m[2]]))
  const value = (block, token) => block.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`))?.[1]
  for (const theme of THEMES) {
    const block = rows[theme.code]
    assert.ok(block, `${theme.code} has a theme row in the sheet`)
    assert.deepEqual(theme.swatch, { ground: value(block, '--ground'), paper: value(block, '--paper'), ink: value(block, '--ink'), accent: value(block, '--blue') }, `${theme.code} swatch`)
  }
})

// A block comment that forgets its `*/` swallows every rule up to the next comment and the browser says
// nothing — the work-fold row once rendered as a bare grey <button> that way. Comments must close before
// the next one opens.
test('every block comment closes before the next opens', () => {
  let depth = 0
  for (const match of css.matchAll(/\/\*|\*\//g)) {
    const line = css.slice(0, match.index).split('\n').length
    if (match[0] === '/*') { assert.equal(depth, 0, `unterminated comment before line ${line}`); depth = 1 }
    else { assert.equal(depth, 1, `stray */ at line ${line}`); depth = 0 }
  }
  assert.equal(depth, 0, 'the sheet ends inside a comment')
})

test('seams and group heads use one divider rule', () => {
  assert.match(css, /--divider-rule:\s*1px solid var\(--edge\);/)
  // the tab band carries that rule as an inset in the same --edge (a shorthand cannot ride a box-shadow),
  // and the content host under it owns no second line
  assert.match(css, /\.tabstrip\s*\{\s*box-shadow:\s*inset 0 -1px 0 var\(--edge\);/)
  assert.doesNotMatch(css, /\.viewhost\s*\{[^}]*border-top:/s)
  assert.match(css, /\.ft-section \+ \.ft-section\s*\{[^}]*margin-top:\s*var\(--space-2\);/s)
  assert.doesNotMatch(css, /\.ft-section \+ \.ft-section\s*\{[^}]*border-top:/s)
  // the three zone heads (dock, console, phone) trail ONE rule — one declaration, not three copies of it
  assert.match(css, /\.dock-session-zone::after, \.si-zone::after, \.m-zone::after\s*\{[^}]*border-top:\s*var\(--divider-rule\);/s)
  assert.equal(css.match(/zone::after\s*\{/g)?.length ?? 0, 1)
  assert.match(css, /\.si-zone\s*\{[^}]*padding:\s*calc\(var\(--space-4\) \+ var\(--space-1\)\) var\(--space-5\) var\(--space-2\);[^}]*font-weight:\s*var\(--weight-semibold\);/s)
  assert.match(css, /\.si-zone-count\s*\{[^}]*border:\s*1px solid currentColor;[^}]*background:\s*transparent;[^}]*opacity:\s*\.8;/s)
  assert.match(css, /\.m-tabbar\s*\{[^}]*border-top:\s*var\(--divider-rule\);/s)
  assert.doesNotMatch(css, /\.tabstrip\s*\{[^}]*border-bottom:/s)
})

test('every token the sheet consumes is declared somewhere the browser can resolve it', () => {
  // an undeclared var() is not a fallback, it is a silently invalid declaration (the eval data frame once
  // wore a purple nobody chose through `--acc`, and a transition named a `--dur-fast` that never existed).
  // A token may be declared in the sheet or set from a component's inline style.
  const inline = readdirSync(here).filter((name) => /\.(jsx|js)$/.test(name))
    .map((name) => readFileSync(join(here, name), 'utf8')).join('\n')
  const declared = new Set([...css.matchAll(/(--[a-z][\w-]*)\s*:/g)].map((m) => m[1]))
  for (const [, name] of inline.matchAll(/['"`](--[a-z][\w-]*)['"`]/g)) declared.add(name)
  for (const [, name] of inline.matchAll(/\[(--[a-z][\w-]*)\]/g)) declared.add(name)
  const consumed = new Set([...css.matchAll(/var\((--[a-z][\w-]*)/g)].map((m) => m[1]))
  const undeclared = [...consumed].filter((name) => !declared.has(name))
  assert.deepEqual(undeclared, [])
})

test('the status bar owns a flex row and cannot cover the content viewport', () => {
  assert.match(css, /\.backend-frame\s*\{[^}]*height:\s*100vh;[^}]*min-height:\s*0;/s)
  assert.match(css, /\.app-shell\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s)
  assert.match(css, /\.app\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*display:\s*flex;/s)
  assert.match(css, /\.app-content-column\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*flex-direction:\s*column;/s)
  assert.match(css, /\.app-content-row\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*display:\s*flex;/s)
  const statusRule = css.match(/\.statusbar\s*\{([^}]*)\}/)?.[1] || ''
  assert.match(statusRule, /width:\s*100%/)
  assert.match(statusRule, /flex:\s*0 0 var\(--line-status\)/)
  // The 1px top seam leaves a fractional content height; bottom-aligning the fixed-height groups keeps
  // an upward popup visible without exposing a half-pixel below the viewport when the bar is un-clipped.
  assert.match(statusRule, /align-items:\s*flex-end/)
  assert.match(statusRule, /border-top:\s*1px solid var\(--line\)/)
  assert.doesNotMatch(statusRule, /position:\s*(?:absolute|fixed)/)
  assert.match(css, /\.side-rail\s*\{[^}]*border-right:\s*1px solid var\(--line\)/s)
  assert.match(css, /\.dock\s*\{[^}]*border-right:\s*1px solid var\(--line\)/s)
})

test('launcher session tallies keep the status line geometry and semantic slash grammar', () => {
  assert.match(shell, /useLaunchers\(\)/)
  assert.match(shell, /session\.launcher === launcher\.name/)
  assert.match(shell, /launcherSessionGroups/)
  assert.match(shell, /name: 'other'/)
  assert.match(shell, /if \(!sessions\.length\) return null/)
  assert.match(shell, /data-launcher=\{launcher\.name\}/)
  assert.match(shell, /sb-launcher-running.*counts\.running/s)
  assert.match(shell, /sb-launcher-needs.*counts\.needsYou/s)
  assert.match(shell, /sb-launcher-other.*counts\.other/s)
  assert.match(shell, /sb-launcher-summary/)
  assert.doesNotMatch(shell, /sb-launcher-badge/)
  assert.match(shell, /kind: needsYou > 0 \? 'warning'/)
  const rightRule = css.match(/\.sb-right\s*\{([^}]*)\}/)?.[1] || ''
  assert.doesNotMatch(rightRule, /max-width|overflow:\s*hidden/)
  assert.match(css, /\.sb-launcher-group\s*\{[^}]*flex:\s*0\s*0\s*auto;[^}]*min-width:\s*max-content;/s)
  // the group keeps its own inset, but the SEAM beside it is the line's one shared short rule, not a
  // full-height border this group owns ([[status-bar]])
  assert.match(css, /\.sb-item:has\(\.sb-launcher-groups\)\s*\{[^}]*padding-inline:\s*0;[^}]*padding-left:\s*var\(--space-3\)/)
  assert.match(css, /\.sb-launcher-glyph\s*\{[^}]*width:\s*12px;[^}]*height:\s*12px;/s)
  assert.match(css, /\.sb-launcher-glyph \.si-agent-glyph\s*\{[^}]*width:\s*12px;[^}]*height:\s*12px;/s)
  assert.match(css, /\.sb-launcher-running\s*\{\s*color:\s*var\(--green\)/)
  assert.match(css, /\.sb-launcher-needs\s*\{\s*color:\s*var\(--yellow\)/)
  assert.match(css, /\.sb-launcher-other\s*\{\s*color:\s*var\(--muted\)/)
  assert.match(css, /\.sb-launcher-list\s*\{[^}]*display:\s*none;/)
  assert.match(css, /\.sb-launcher-summary\s*\{[^}]*display:\s*inline-flex;/)
  assert.match(css, /@media \(hover:\s*hover\) and \(pointer:\s*fine\)[\s\S]*?\.statusbar:has\(\.sb-launcher-groups:hover\) \.sb-right > \.sb-item:not\(:has\(\.sb-launcher-groups\)\)\s*\{\s*display:\s*none;/)
  assert.match(css, /\.sb-launcher-groups:hover \.sb-launcher-list\s*\{\s*display:\s*inline-flex;/)
  assert.match(css, /\.sb-launcher-groups:hover \.sb-launcher-summary\s*\{\s*display:\s*none;/)
  assert.doesNotMatch(css, /\.sb-launcher-groups:hover \.sb-launcher-list\s*\{[^}]*position:\s*absolute;/s)
  assert.doesNotMatch(css, /@media \(max-width:\s*900px\)[\s\S]*?\.sb-launcher-(?:list|summary)/)
})

test('the dock toggle reads as frame chrome, not a sixth route tab', () => {
  assert.match(css, /\.rail-panel-toggle\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;[^}]*color:\s*var\(--muted\);/s)
  assert.match(css, /\.rail-panel-toggle\s*\{[^}]*padding:\s*0;/s)
  assert.match(css, /\.rail-panel-toggle\s+svg\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;/s)
  assert.match(css, /\.rail-panel-toggle::after\s*\{[^}]*border-bottom:\s*1px solid var\(--edge\);/s)
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

test('conversation day separators center their date on one continuous rule', () => {
  assert.match(timelineChat, /className="m-day"[\s\S]*className="m-day-rule"[\s\S]*className="m-day-label"/)
  assert.doesNotMatch(timelineChat, /<div className="m-day"[^>]*><div className="m-gut"/)
  assert.match(css, /\.m-day\s*\{[^}]*position:\s*relative;[^}]*display:\s*flex;[^}]*justify-content:\s*center;/s)
  assert.match(css, /\.m-day-rule\s*\{[^}]*position:\s*absolute;[^}]*inset-inline:\s*0;[^}]*top:\s*50%;/s)
  assert.match(css, /\.m-day-label\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;[^}]*background:\s*var\(--paper\);/s)
})

test('tab widths follow content before wrapping and keep the active close affordance', () => {
  assert.match(css, /\.tabstrip-tabs\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*container-type:\s*inline-size;/s)
  assert.match(css, /\.tabstrip-tabs\.wrapped\s*\{[^}]*flex-wrap:\s*wrap;/s)
  assert.match(css, /\.tabstrip-tabs\.wrapped \.tab\s*\{[^}]*flex:\s*0 1 auto;/s)
  assert.match(css, /\.tab\s*\{[^}]*flex:\s*0 1 auto;[^}]*width:\s*auto;[^}]*min-width:\s*120px;[^}]*max-width:\s*240px;/s)
  assert.match(css, /\.tab\s*\{[^}]*container-type:\s*inline-size;/s)
  assert.match(css, /\.tabstrip-tabs:not\(\.wrapped\) \.tab\s*\{[^}]*container-type:\s*normal;/s)
  assert.match(css, /\.tab\.on\s*\{[^}]*min-width:\s*132px;[^}]*background:\s*var\(--paper\);[^}]*border-right-color:\s*transparent;[^}]*border-radius:\s*var\(--radius\)/s)
  assert.match(css, /\.tab\s*\{[^}]*border-radius:\s*var\(--radius\) var\(--radius\) 0 0;/s)
  assert.match(css, /\.tab:not\(\.on\):hover\s*\{[^}]*background:\s*var\(--panel2\);[^}]*border-radius:\s*var\(--radius\) var\(--radius\) 0 0;/s)
  assert.match(css, /\.tab:not\(\.on\):focus-within\s*\{[^}]*background:\s*var\(--panel2\);[^}]*border-radius:\s*var\(--radius\) var\(--radius\) 0 0;/s)
  assert.match(css, /\.tab-face\s*\{[^}]*border-radius:\s*var\(--radius\) 0 0 0;/s)
  assert.match(css, /\.tab-x\s*\{[^}]*border-radius:\s*0 var\(--radius\) 0 0;/s)
  assert.match(css, /\.tab-x\s*\{[^}]*flex:\s*0 0 24px;[^}]*width:\s*24px;[^}]*opacity:\s*0;/s)
  assert.match(css, /\.tab\.on \.tab-x, \.tab:hover \.tab-x\s*\{[^}]*opacity:\s*1;/s)
  assert.match(css, /\.tab-x:hover\s*\{[^}]*background:\s*var\(--panel2\);[^}]*border-radius:\s*0 var\(--radius\) 0 0;/s)
  assert.match(css, /\.tab\s*\{[^}]*animation:\s*tab-in var\(--dur-tab\) ease backwards;/s)
  assert.match(css, /\.tab\.tab-closing\s*\{[^}]*animation:\s*tab-out var\(--dur-tab\) ease backwards;/s)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.tab, \.tab\.tab-closing, \.tab-x\s*\{[^}]*transition:\s*none;/s)
  assert.doesNotMatch(css, /\.tabstrip-tabs:has\(\.tab:nth-child\(8\)\)/)
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
  assert.match(terminal, /subscribeFontSize/)
  assert.match(terminal, /term\.options\.fontSize\s*=\s*fontSize/)
  assert.match(terminal, /lastSizeRef\.current\s*=\s*\{ cols: 0, rows: 0 \}[\s\S]*measureRef\.current\?\.\(\)/)
})

test('browser page visibility reuses the terminal viewer lifecycle', () => {
  assert.match(terminal, /const term = new Terminal\([\s\S]*?\n  \}, \[sessionId\]\)/)
  assert.match(terminal, /term\.options\.disableStdin\s*=\s*!writable/)
  assert.match(terminal, /viewerIsVisible\s*=\s*\(\)\s*=>\s*activeRef\.current\s*&&\s*document\.visibilityState\s*!==\s*'hidden'/)
  assert.match(terminal, /document\.addEventListener\('visibilitychange', onDocumentVisibility\)/)
  assert.match(terminal, /if \(!viewerIsVisible\(\)\)\s*\{\s*hideRef\.current\?\.\(\)/)
  assert.match(terminal, /lastSizeRef\.current\s*=\s*\{ cols: 0, rows: 0 \}\s*measureAndRequest\(\)/)
  // the pane's `active` follows whether its layer is actually shown. Cold sessions resolve their base to the
  // shared Conversation surface, while a resource overlay still makes every base layer stand down.
  assert.match(sessionInterface, /const baseShown = id === active && !activeResource/)
  assert.match(sessionInterface, /const terminalShown = baseShown && activeBaseSurface === 'terminal'/)
  assert.match(sessionInterface, /<SessionTerm sessionId=\{id\} active=\{open && terminalShown\}/)
  assert.match(sessionsView, /open=\{showing\}/)
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

// [[tooltip]]: the bubble grows OUT OF its anchor. The origin must follow the flip, or a bottom-placed tip
// would expand away from the control it describes. Reduced motion keeps the fade and drops the growth.
test('the tooltip pops from the arrow side and honours reduced motion', () => {
  // the START STATE must be on the BASE rule: the bubble mounts a frame before the placement pass stamps
  // `data-place`, so a start state that only existed under that attribute was never painted and the pop
  // silently degraded to a fade. Measured in Chromium before this line existed.
  assert.match(css, /\.ui-tip\s*\{[^}]*transform-origin:\s*bottom center;\s*transform:\s*translateY\(3px\) scale\(\.94\);/s)
  assert.match(css, /\.ui-tip\s*\{[^}]*transition:\s*opacity [^;]+, transform [^;]*cubic-bezier/s)
  assert.match(css, /\.ui-tip\[data-place='bottom'\]\s*\{[^}]*transform-origin:\s*top center;[^}]*scale\(\.94\)/s)
  assert.match(css, /\.ui-tip\.show\s*\{[^}]*transform:\s*translateY\(0\) scale\(1\);/s)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ui-tip[^}]*transform:\s*none;/s)
})

// A scaled bubble reports a scaled getBoundingClientRect, so placement must read the layout box instead —
// otherwise the tip lands off its anchor and slides into place as it grows.
test('tooltip placement measures the layout box, never the painted rect', () => {
  const tip = readFileSync(new URL('./Tooltip.jsx', import.meta.url), 'utf8')
  assert.match(tip, /const width = el\.offsetWidth/)
  assert.match(tip, /const height = el\.offsetHeight/)
  assert.doesNotMatch(tip, /const b = el\.getBoundingClientRect\(\)/)
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
  // the rows live in the ONE attachment hook every authored composer renders ([[file-attach]])
  assert.match(attachQueue, /onAnimationEnd=\{\(event\) => \{[\s\S]*event\.animationName === 'si-attach-complete-out'[\s\S]*dismiss\(item\.id\)/)
  assert.match(attachQueue, /item\.phase === 'failed' && <IconButton[\s\S]*attachRetry/)
  assert.match(attachQueue, /item\.phase === 'complete' \|\| item\.phase === 'cancelled'/)
  for (const host of [sessionInterface, timelineChat]) assert.match(host, /useAttachQueue\(\{ inputRef/)
  assert.doesNotMatch(sessionInterface, /si-attach-row/)
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

test('session forest uses a continuous colour thread and a dedicated fold column', () => {
  const item = css.match(/\.si-item\s*\{([^}]*)\}/s)?.[1] || ''
  assert.doesNotMatch(item, /box-shadow:\s*inset\s*2px\s+0/)
  // the thread hangs on the ROW, at its left edge, so no fold depth can step it right and consecutive rows
  // meet with no gap; nothing may re-anchor it to the indented button again.
  assert.match(css, /\.si-tree-row::before\s*\{[^}]*left:\s*0;[^}]*top:\s*0;[^}]*bottom:\s*0;[^}]*width:\s*2px;/s)
  assert.doesNotMatch(css, /\.si-item::after\s*\{/s)
  assert.doesNotMatch(css, /data-session-depth[^{]*\.si-item::after/s)
  assert.match(css, /\.si-tree-row\s*\{[^}]*--sess-fold-pad-x:\s*18px;/s)
  assert.match(css, /\.si-tree-row\s*>\s*\.sess-fold-control\s*\{[^}]*left:\s*var\(--sess-fold-pad-x\);/s)
})

test('sessions document mounts its complete forest sidebar and scrollport', () => {
  assert.match(css, /\.si-page\s*\{[^}]*min-height:\s*0;/s)
  assert.match(css, /\.si-list\s*\{|\.si-session-scroll\s*\{/)
  assert.match(css, /\.dock-session-list\s*\{[^}]*overflow:\s*auto;/s)
  // the archive door moved into the dock's ONE header row rather than keeping a strip under the list
  assert.match(css, /\.dock-head-acts\s*\{[^}]*margin-left:\s*auto;/s)
})

test('sessions dock keeps the tree list geometry', () => {
  assert.match(css, /\.si-list\s*\{|\.si-session-scroll\s*\{/)
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
