import test from 'node:test'
import assert from 'node:assert/strict'
import en from './en.js'
import zh from './zh.js'
import { shortcutHint, withShortcut } from '../bindings.js'

test('eval detail copy names filed measurements as results in both locales', () => {
  assert.equal(en.detail.sideReading, 'result')
  assert.equal(en.annotator.abMore({ n: 3 }), 'older results (3)')
  assert.match(en.annotator.cmd.okDesc, /^sign off this result .* latest result only/)
  assert.equal(zh.detail.sideReading, '结果')
  assert.equal(zh.annotator.abMore({ n: 3 }), '更早的结果（3）')
  assert.match(zh.annotator.cmd.okDesc, /^签核这条结果 .*当前最新结果/)
})

test('the authored control surface is consistently named Command Box in Chinese', () => {
  assert.equal(zh.session.commandBtn, 'Command Box')
  assert.equal(zh.session.commandBox, 'Command Box')
  assert.match(zh.session.commandTitle, /完整指令/)
  assert.match(zh.session.commandPlaceholder, /完整指令/)
  assert.match(zh.session.commandSend, /Command Box/)
})

// A key hint belongs to the KEYMAP, never to translated prose: a hint typed into a label is a copy no
// rebind can reach, and both dictionaries had drifted into three different glyph dialects (⌥1 / ⌥+N /
// Alt+I) for the same modifier. The labels now carry names only; `withShortcut` appends the live binding.
test('no dictionary hardcodes a keyboard shortcut into a label', () => {
  // The ⌥/⌘/⌃ family is what a registry CHORD is made of, so a dictionary printing one is quoting a
  // binding. ⇧ is deliberately not here: Shift is transparent to the structural tree walk and the hint
  // lines that mention it are describing that grammar, not naming a rebindable action's key.
  const hardcoded = /[⌥⌘⌃]|\bAlt\+|\bCtrl\+|\bMeta\+/
  for (const [lang, dict] of [['en', en], ['zh', zh]]) {
    const walk = (node, path) => {
      if (typeof node === 'string') {
        assert.doesNotMatch(node, hardcoded, `${lang}.${path} prints a shortcut that no rebind can reach`)
        return
      }
      if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`)
    }
    // `legend.*` DESCRIBES the keyboard, so a modifier glyph there is the subject, not a stale copy.
    for (const [k, v] of Object.entries(dict)) if (k !== 'legend') walk(v, k)
  }
})

test('shortcut hints resolve from the registry, modifiers included', () => {
  assert.equal(shortcutHint('shell.pageGraph'), '⌥1')
  assert.equal(shortcutHint('shell.pageEvals', 'shell.evals'), '⌥3 · ⌥F')
  assert.equal(shortcutHint('graph.search', 'shell.search'), '/ · ⌥/')
  assert.equal(shortcutHint('shell.commandBox'), '⌥I')
  assert.equal(shortcutHint('shell.contextToggle'), '⌥⇧C')
  assert.equal(shortcutHint('shell.tabNext'), '⌥⇧→')
  assert.equal(shortcutHint('no.such.action'), '')
  assert.equal(withShortcut('Search', 'graph.search'), 'Search (/)')
  assert.equal(withShortcut('Explorer'), 'Explorer')          // no binding, no hint
})

test('locked session hint describes changed-node browsing without extra modifier labels in Chinese', () => {
  assert.equal(zh.lockHint.singleChanged, '此会话更改了 1 个节点')
  assert.equal(zh.lockHint.cycleNext, ' 下一个')
  assert.equal(zh.lockHint.cyclePrev, ' 上一个')
  assert.equal(zh.lockHint.cycleAfter({ n: 2 }), '，浏览此会话更改的 2 个节点')
})
