import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// A REJECTION'S ALTERNATIVES LIST IS A PROMISE ABOUT THE VOCABULARY, and [[cli-surface]]'s dead-end rule is only
// kept when that promise is true: naming the layer to return to is not the whole duty when the message also names
// the alternatives, because a list can be complete, loud, and wrong at once. Both lists had drifted behind the
// sibling `if` branches they sit beside — `spex spec` never learned `report`, `spex session` never learned
// `resources` or `quarantine` — so the one reader who mistyped exactly those verbs was told they do not exist.
//
// The spec prescribes the LITERAL shape here (the list belongs beside the branches, where whoever adds one sees
// it), so this reads both out of the source rather than replacing the literal with a derivation. Adding a verb
// without naming it now fails here instead of shipping a wrong list.

const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const source = readFileSync(cli, 'utf8')
const lines = source.split('\n')

// Each drawer is one top-level `} else if (cmd === '<noun>') {` block, so its region is that line to the next one.
const region = (noun: string): string => {
  const starts = lines.map((line, i) => ({ line, i })).filter(({ line }) => /^(?:\} else )?if \(cmd === /.test(line))
  const at = starts.findIndex(({ line }) => line.includes(`cmd === '${noun}'`))
  assert.ok(at >= 0, `top-level drawer block for '${noun}'`)
  const end = starts[at + 1]?.i ?? lines.length
  return lines.slice(starts[at].i, end).join('\n')
}

const branchVerbs = (body: string): string[] =>
  [...new Set([...body.matchAll(/\bsub === '([a-z-]+)'/g)].map((m) => m[1]))].sort()

const advertisedVerbs = (body: string, noun: string): string[] => {
  const pattern = new RegExp(`spex ${noun}: unknown verb '\\$\\{sub\\}' — ([^\`]*?)\\s+\\(spex help ${noun}\\)`)
  const found = body.match(pattern)
  assert.ok(found, `'${noun}' drawer rejects an unknown verb by naming its alternatives`)
  return [...new Set(found[1].split('|').map((v) => v.trim()).filter(Boolean))].sort()
}

for (const noun of ['spec', 'session']) {
  test(`the ${noun} drawer's unknown-verb rejection names every verb the drawer actually has`, () => {
    const body = region(noun)
    const branches = branchVerbs(body)
    const advertised = advertisedVerbs(body, noun)
    assert.ok(branches.length > 3, `${noun} has verb branches to check`)
    assert.deepEqual(
      branches.filter((verb) => !advertised.includes(verb)), [],
      `every 'sub === <verb>' branch in the ${noun} drawer must appear in its unknown-verb rejection`,
    )
    assert.deepEqual(
      advertised.filter((verb) => !branches.includes(verb) && !verb.includes(' ') && !verb.includes('/')), [],
      `the ${noun} rejection must not name a verb the drawer does not handle`,
    )
  })
}

// And the promise holds through the REAL CLI, not only in the source: every advertised verb answers its own help
// page instead of the rejection that claimed it exists.
test('every verb a drawer rejection advertises answers a real help page', () => {
  for (const noun of ['spec', 'session']) {
    for (const verb of advertisedVerbs(region(noun), noun)) {
      const out = execFileSync(process.execPath, [fileURLToPath(new URL('../bin/spex.mjs', import.meta.url)), noun, verb, '--help'], { encoding: 'utf8' })
      assert.ok(!out.includes('unknown verb'), `spex ${noun} ${verb} --help is a real page`)
      assert.match(out, /Usage: spex /, `spex ${noun} ${verb} --help states a usage`)
    }
  }
})

// A VERB PAGE IS A PROJECTION OF ITS DRAWER, so the page can never claim something the drawer does not say and
// can never go missing for a verb the drawer advertises in its own usage block. Per-verb help used to exist on
// `session` alone; the reader who typed `spex eval add --help` got the whole 53-line measurement drawer back.
// This reads the real CLI: for every verb named in a noun's usage block, the page must be about that verb,
// strictly narrower than the drawer, and made only of lines the drawer itself already prints.
const drawerVerbs = (drawer: string, noun: string): string[] => {
  const block = drawer.split(/\n\s*\n/).find((part) => part.startsWith('Usage:')) ?? ''
  const heads = [...block.matchAll(new RegExp(`spex ${noun} ([a-z-]+)(?: ([a-z-]+))?`, 'g'))]
  return [...new Set(heads.map((m) => (m[2] && !m[2].startsWith('-') ? `${m[1]} ${m[2]}` : m[1])))]
}

test('every noun drawer projects a per-verb page, narrower than the drawer and made of the drawer’s own lines', () => {
  const bin = fileURLToPath(new URL('../bin/spex.mjs', import.meta.url))
  const help = (...args: string[]): string => execFileSync(process.execPath, [bin, ...args, '--help'], { encoding: 'utf8' })
  for (const noun of ['eval', 'spec', 'issue', 'evidence']) {
    const drawer = help(noun)
    const verbs = drawerVerbs(drawer, noun)
    assert.ok(verbs.length > 1, `${noun} advertises verbs in its usage block`)
    const drawerLines = new Set(drawer.split('\n').map((line) => line.trim()))
    for (const verb of verbs) {
      const page = help(noun, ...verb.split(' '))
      assert.match(page, new RegExp(`^Usage: spex ${noun} ${verb}\\b`), `spex ${noun} ${verb} --help opens on its own usage`)
      assert.ok(page.split('\n').length < drawer.split('\n').length, `spex ${noun} ${verb} --help is narrower than the drawer`)
      const invented = page.split('\n').map((line) => line.trim())
        .filter((line) => line && !drawerLines.has(line) && !line.startsWith('see also:') && !line.startsWith('map:') && !line.startsWith('Usage: '))
      assert.deepEqual(invented, [], `spex ${noun} ${verb} --help prints only lines the ${noun} drawer prints`)
    }
  }
})
