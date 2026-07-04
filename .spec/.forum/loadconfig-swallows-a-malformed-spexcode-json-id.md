---
concern: loadConfig swallows a MALFORMED spexcode.json identically to an absent one — user's lint budgets silently vanish, bending fail-loudly
by: 4b64d4ad-7844-4e32-a308-b4d33b25ccb8
status: open
nodes: spec-lint
created: 2026-07-04T03:21:52.297Z
---

**What was compromised.** `loadConfig` in `spec-cli/src/lint.ts` wraps the read+`JSON.parse` of `spexcode.json` in a single `try { … } catch { return DEFAULT_CONFIG }`, with the comment *"no file (or unreadable) → tuned defaults; lint is the same as before."* A genuine **syntax error** in the user's `spexcode.json` is therefore caught and treated **identically to the file being absent**: the user's custom lint budgets (altitude, scenarioTags, etc.) silently disappear and lint runs on defaults, with no diagnostic. The one absent file case *should* default; a malformed file should complain.

**Where recorded.** `spec-cli/src/lint.ts` `loadConfig` (the bare `catch { return DEFAULT_CONFIG }`).

**Which principle it bends.** The project's **"fail loudly — do not hide errors behind silent fallbacks"** rule. A typo'd budget config isn't a defaulting scenario; it's a config error the author needs to see. This is the one spot in the lint path that swallows a real error.

**Blast radius.** Low and bounded: only affects a repo that HAS a `spexcode.json` and introduces a JSON typo — its tuned budgets vanish and altitude/coverage thresholds silently revert to defaults, potentially green-washing altitude warnings the author intended to enforce. No crash, no data loss.

**Disposal.** Schedule (small) — distinguish ENOENT (default silently) from a parse error (emit a one-time warning naming the file + the parse error, then fall back to defaults). Fail loud on the malformed case.
