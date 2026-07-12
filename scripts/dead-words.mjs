#!/usr/bin/env node
// dead-words gate — CI backstop for the v0.3.0 vocabulary cut.
//
// The renamed concepts' OLD names (yatsu, reading, board, proof, blob, scan, reopen, rawkey,
// loss-signal) are DEAD on every product-facing surface: command names, route/protocol strings,
// UI/agent-facing labels, file names, node dir names. They may still appear in PROSE (spec bodies,
// docs, code comments, archived sidecars) — historical narration is legal, teaching surfaces are not.
//
// So the scan is surface-scoped, not a blanket grep:
//   1. STRING LITERALS in source under spec-cli/src, spec-eval/src, spec-forge/src,
//      spec-dashboard/src, spec-cli/templates (a command/route/label lives in a string; a comment is
//      prose and exempt). *.test.* and __fixtures__ are exempt: test data mirrors archived/external
//      shapes. *.md is exempt: spec/doc bodies are prose.
//   2. Whole non-comment text of *.sh under those roots (hook scripts speak to agents at runtime).
//   3. FILE and DIR basenames under those roots, and NODE DIR basenames under .spec — split on
//      camelCase + separators so `BoardStats.jsx` hits but `Dashboard.jsx` doesn't.
//
// Exemption: a line carrying `dead-words-ok: <reason>` is skipped — the reason is REQUIRED and lives
// at the occurrence, so every exemption is self-justifying. Keep them rare; the legitimate ones are
// archive readers (immutable history keeps its archived names) and one-version signposts.
//
// Exit 0 = clean, 1 = findings, 2 = the scanner failed its own self-check.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['spec-cli/src', 'spec-eval/src', 'spec-forge/src', 'spec-dashboard/src', 'spec-cli/templates']
const SPEC_ROOT = '.spec'
const DEAD = /\b(yatsu|readings?|boards?|proofs?|blobs?|scan(?:s|ned|ning)?|reopen(?:s|ed|ing)?|rawkeys?|loss-signals?)\b/i
const OK = /dead-words-ok:\s*\S/

const findings = []
const flag = (where, what) => findings.push(`${where}: ${what}`)

// ── name scan: split a basename into words (camelCase + -_. separators), match each ────────────────
function nameHit(base) {
  const words = base.split(/[-_.\s]+/).flatMap((w) => w.split(/(?=[A-Z])/))
  return words.find((w) => DEAD.test(w))
}

// ── string-literal extraction: a small state machine over js/ts source ──────────────────────────────
// Tracks line/block comments, ' " ` strings (with escapes, and ${…} interpolation nesting inside
// templates), and regex literals via the standard prev-token heuristic — a regex body ( /['"`]/ )
// must not open a phantom string. Returns [{line, text}] for every literal.
export function stringLiterals(src) {
  const out = []
  let i = 0, line = 1, prev = ''
  const n = src.length
  const isRegexPos = () => /[(,=:\[!&|?{;+\n]/.test(prev) || prev === ''
  while (i < n) {
    const c = src[i]
    if (c === '\n') { line++; prev = '\n'; i++; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++ }
      i += 2; continue
    }
    if (c === '/' && isRegexPos()) {                       // regex literal: skip to unescaped /, [] aware
      i++
      let inClass = false
      while (i < n && (inClass || src[i] !== '/')) {
        if (src[i] === '\\') i++
        else if (src[i] === '[') inClass = true
        else if (src[i] === ']') inClass = false
        else if (src[i] === '\n') break                    // not a regex after all (division); bail
        i++
      }
      i++; prev = 'x'; continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c, startLine = line
      let text = ''
      i++
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { text += src[i] + (src[i + 1] ?? ''); if (src[i + 1] === '\n') line++; i += 2; continue }
        if (src[i] === '\n') { if (q !== '`') break; line++ }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {   // interpolation: recurse-skip balanced braces
          let depth = 1; i += 2; text += ' '
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++
            else if (src[i] === '}') depth--
            else if (src[i] === '\n') line++
            i++
          }
          continue
        }
        text += src[i]; i++
      }
      i++
      out.push({ line: startLine, text })
      prev = 'x'; continue
    }
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out
}

function walk(dir, onFile, onDir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { onDir?.(p, e.name); walk(p, onFile, onDir) }
    else onFile?.(p, e.name)
  }
}

function scanCodeFile(path) {
  const src = readFileSync(path, 'utf8')
  const rawLines = src.split('\n')
  for (const { line, text } of stringLiterals(src)) {
    const m = text.match(DEAD)
    if (m && !OK.test(rawLines[line - 1] ?? '')) flag(`${path}:${line}`, `dead word '${m[1]}' in string: ${JSON.stringify(text.slice(0, 90))}`)
  }
}

function scanShellFile(path) {
  let src = readFileSync(path, 'utf8')
  if (/\.css$/.test(path)) src = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))   // CSS comments are prose
  src.split('\n').forEach((l, idx) => {
    if (/^\s*#/.test(l) || OK.test(l)) return
    const m = l.match(DEAD)
    if (m) flag(`${path}:${idx + 1}`, `dead word '${m[1]}': ${l.trim().slice(0, 90)}`)
  })
}

function main() {
  for (const root of ROOTS) {
    let st = null
    try { st = statSync(root) } catch { continue }
    if (!st.isDirectory()) continue
    walk(root, (p, name) => {
      if (/\.test\.|__fixtures__/.test(p)) return
      const hit = nameHit(name)
      if (hit) flag(p, `dead word '${hit}' in file name`)
      if (/\.md$/.test(name)) return
      if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) scanCodeFile(p)
      else if (/\.(sh|bash)$/.test(name) || /^[^.]+$/.test(name)) scanShellFile(p)   // hooks have no extension
      else if (/\.(json|html|css)$/.test(name)) scanShellFile(p)                     // no comment syntax worth parsing
    }, (p, name) => {
      const hit = nameHit(name)
      if (hit && !/__fixtures__/.test(p)) flag(p, `dead word '${hit}' in dir name`)
    })
  }
  // node dir names: the id surface. Bodies/sidecars under .spec are prose/archive — names only.
  try {
    walk(SPEC_ROOT, null, (p, name) => {
      const hit = nameHit(name)
      if (hit) flag(p, `dead word '${hit}' in node dir name`)
    })
  } catch { /* no .spec — adopter repos run the gate too */ }
}

// self-check: the scanner must still SEE a planted dead word (in a string, a comment-shadowed one must
// NOT hit) — a silently broken tokenizer would green-wash the whole gate.
function selfCheck() {
  const sample = `const a = 'the yatsu verb'  // yatsu in a comment is prose\nconst b = /proof/  // regex literal, not a string\nconst c = \`a \${x} board-full\`\n`
  const hits = stringLiterals(sample).filter(({ text }) => DEAD.test(text))
  if (hits.length !== 2 || hits[0].line !== 1 || hits[1].line !== 3) {
    console.error('dead-words: scanner self-check FAILED — tokenizer is broken, refusing to report a clean tree')
    process.exit(2)
  }
}

selfCheck()
main()
if (findings.length) {
  console.error(`dead-words: ${findings.length} hit(s) on product surfaces (strings / file names / node names):`)
  for (const f of findings) console.error('  ✗ ' + f)
  console.error(`\nThe old vocabulary is dead on command/route/label/file/node surfaces (prose is exempt).`)
  console.error(`Rename or reword; a genuinely legitimate occurrence (archive reader, one-version signpost)`)
  console.error(`carries an inline \`dead-words-ok: <reason>\` on its line.`)
  process.exit(1)
}
console.log('dead-words: clean')

// .spec filenames sweep — a renamed concept must not survive as a FILE NAME under .spec
// (caught in the field: needs-eval/yatsu.md orphan hid a scenario+reading from the loader).
import { execSync } from 'node:child_process'
const specFiles = execSync("git ls-files '.spec'", { encoding: 'utf8' }).split('\n').filter(Boolean)
for (const f of specFiles) {
  const base = f.split('/').pop()
  if (/yatsu/i.test(base)) { console.error(`dead-words: .spec filenames: ${f} — rename to the eval vocabulary`); process.exitCode = 1 }
}
