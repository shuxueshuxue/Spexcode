import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import en from './i18n/en.js'
import zh from './i18n/zh.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../..')
const canonicalPath = join(repo, 'spec-cli/src/sessions.ts')
const canonical = readFileSync(canonicalPath, 'utf8')
const displayStatus = [...(canonical.match(/export type DisplayStatus\s*=\s*([^\n]+)/)?.[1] || '').matchAll(/'([^']+)'/g)]
  .map((match) => match[1])
const vocabulary = new Set(displayStatus)

const sourceExtensions = new Set(['.js', '.jsx', '.mjs'])
const walk = (root) => {
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else if (sourceExtensions.has(path.slice(path.lastIndexOf('.')))) files.push(path)
  }
  return files
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length
const quotedVocabulary = new RegExp(`['"](?:${displayStatus.map((word) => word.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')).join('|')})['"]`, 'g')

// A small balanced-literal reader is enough for this guard: it sees arrays/objects/Set arguments while
// ignoring function blocks, then reports the opening line so a new hand-written vocabulary is actionable.
function literals(source) {
  const out = []
  const openings = /(?:new\s+Set(?:<[^>]+>)?\s*\(|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*|return\s+)([\[{])/g
  for (const match of source.matchAll(openings)) {
    const opener = match.index + match[0].length - 1
    const close = source[opener] === '[' ? ']' : '}'
    let depth = 0
    let quote = null
    let escaped = false
    let end = -1
    for (let i = opener; i < source.length; i++) {
      const char = source[i]
      if (quote) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === quote) quote = null
        continue
      }
      if (char === '"' || char === "'" || char === '`') { quote = char; continue }
      if (char === source[opener]) depth++
      else if (char === close && --depth === 0) { end = i; break }
    }
    if (end < 0) continue
    const body = source.slice(opener, end + 1)
    const words = new Set([...body.matchAll(quotedVocabulary)].map((item) => item[0].slice(1, -1)))
    const name = source.slice(0, opener).match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+Set(?:<[^>]+>)?\s*\()?\s*$/)?.[1]
    if (words.size >= 2) out.push({ line: lineOf(source, opener), words, name })
  }
  return out
}

test('DisplayStatus is the only lifecycle vocabulary and both dictionaries cover it', () => {
  assert.equal(displayStatus.length, 14, 'canonical DisplayStatus declaration should remain closed and readable')
  for (const word of vocabulary) {
    assert.ok(typeof en.status[word] === 'string' && en.status[word], `English status.${word} is missing`)
    assert.ok(typeof zh.status[word] === 'string' && zh.status[word], `Chinese status.${word} is missing`)
  }
})

test('dashboard source does not mint a second multi-status literal', () => {
  const self = join(here, 'statusVocabulary.test.mjs')
  const allowed = new Map([
    // Existing consumers are whitelisted one expression at a time: session.js owns the colour/glyph maps and
    // needs-you set; EvalsPage's `keys` is an eval-summary schema; sessionCommands' UI_COMMANDS is the command
    // capability registry; the two test fixture arrays exercise those consumers. None is a second vocabulary.
    ['session.js', new Set(['STATUS_COLOR', 'STATUS_GLYPH', 'NEED_STATUS'])],
    ['EvalsPage.jsx', new Set(['keys'])],
    ['sessionCommands.js', new Set(['UI_COMMANDS'])],
    ['reviewFilters.test.mjs', new Set(['sessions'])],
    ['session.test.mjs', new Set(['cases', 'sessions'])],
  ])
  const violations = []
  for (const path of walk(here)) {
    if (path === self || path.endsWith('/i18n/en.js') || path.endsWith('/i18n/zh.js')) continue
    const source = readFileSync(path, 'utf8')
    for (const literal of literals(source)) {
      const file = relative(repo, path)
      if (allowed.get(relative(here, path))?.has(literal.name)) continue
      violations.push(`${file}:${literal.line} (${[...literal.words].join(', ')})`)
    }
  }
  assert.deepEqual(violations, [], `multi-status literals must use DisplayStatus-derived projections: ${violations.join('; ')}`)
})
