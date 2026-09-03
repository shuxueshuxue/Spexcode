---
concern: spex issue open silently absorbs an unknown flag's value into the concern and drops the body
by: 8bb006f2-ff07-46c9-a216-83c6e32f7777
status: open
nodes: issues-cli
created: 2026-09-03T15:08:29.013Z
---

Spec: issues-cli

`spex issue open` silently swallows an unknown flag AND folds its value into the concern, while
discarding the body the caller meant to pass. Sibling verbs reject unknown flags loudly; this one
does not. Reproduced on a disposable store:

    SPEXCODE_ISSUES_DIR=/tmp/probe spex issue open "probe concern" --nonsense-flag xyz
    → exit 0
    → opened 'probe-concern-xyz'
    → concern: probe concern xyz
    → body:    (no detail given — probe concern xyz)

Compare the sibling:

    spex eval add typography --scenario x --bogus-flag y
    → spex eval add: unknown flag '--bogus-flag' — accepts --scenario --pass --fail --note …

**Mechanism**, `spec-cli/src/issues-cli.ts:156`:

    function bare(args: string[]): string[] {
      const out: string[] = []
      for (let i = 0; i < args.length; i++) {
        const t = args[i]
        if (t.startsWith('--')) { if (VALUE_FLAGS.has(t)) i++; continue }
        out.push(t)
      }
      return out
    }

An unrecognized `--flag` is `continue`d without complaint, and because it is not in `VALUE_FLAGS`
its value is never skipped — so the value falls through to `out.push(t)` and lands in the concern.
The intended `--body` never arrives, so `createIssue` substitutes its
`(no detail given — <concern>)` placeholder. Three losses from one typo, none of them announced:
wrong title, no body, exit 0.

**It has already corrupted the real store, twice, both mine.** I passed a `--body-file` that does
not exist (the flag is `--body -|<text>`):

- `product-output-is-half-chinese-on-an-english-mac` — landed with the whole report gone; the
  concern line still ends in `/tmp/lang-issue.md`. I have appended the lost body as a reply.
- `the-adopter-plugin-seed-is-nine-differences-behi` — caught immediately, refiled as `…-behi-2`,
  the malformed one replied-to and closed.

**Scope note on the wider store**: 55 of 229 local issues carry the generated placeholder, from 27
distinct sessions. Do not read that as 55 instances of this bug — `--body` is genuinely optional and
`open` is documented to welcome a bare one-line smell, so most of those are legitimate. Only 3
concern lines show the swallowed-path shape. The defect is the silent acceptance, not the placeholder.

**Fix shape**: `bare()` should reject a token starting with `--` that is neither a known value flag
nor a known boolean flag, the way `eval add` already does — one error line naming the accepted set.
Reporting rather than fixing: this is `issues-cli`, not the machine-routing lane this branch owns,
and the change wants its own commit and its own reading.
