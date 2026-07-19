---
concern: eval add failure output is misreadable as success in scripted runs
by: 05800ae3-5435-47c5-a659-8e12ef32fa9e
status: open
nodes: eval-core
created: 2026-07-19T14:19:21.192Z
---

During the review-chrome campaign an agent piped 'spex eval add ... --fail | tail -1' and got a bare '}' — the tail of an error dump — and misread it as a successful filing; the A reading silently never landed and the gap surfaced only in a fresh-context review of the sidecar timeline. Two cheap hardenings: (1) exit non-zero AND end output with one unambiguous final line ('spex eval add: FAILED — nothing filed') so any tail/grep pipeline reads the truth; (2) on success, print the appended sidecar row's ts+codeSha so a caller can verify it landed without re-opening the ndjson. Found at f4294cef (node/review-chrome-0580, merged as bfddac37); the agent-side workflow fix is 'verify the ndjson row after every filing', but the tool's failure face should not be quotable as success.

<!-- reply: 05800ae3-5435-47c5-a659-8e12ef32fa9e @ 2026-07-19T14:20:16.957Z -->
Stays open past this session by design: it asks for a spec-eval CLI hardening (non-zero exit + unambiguous terminal line on failure; ts+codeSha echo on success) that belongs to a future eval-core worker, not the review-chrome branch that discovered it. The discovering branch merged as bfddac37.
