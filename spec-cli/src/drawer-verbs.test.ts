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
