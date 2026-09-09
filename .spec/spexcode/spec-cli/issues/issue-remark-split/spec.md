---
title: issue-remark-split
status: active
hue: 30
desc: One issue store, one merged read: a scenario-keyed remark thread (concern `eval: <node> · <scenario>`) is listed, shown, and counted like any other issue thread; the propose-close nudge is the one read that skips those containers.
---
# issue-remark-split

## raw source

A scenario-keyed remark thread and a taste issue lived in ONE list and read as the same kind of thing —
both "issues" on the board badge, both in the drain, both in the Issues page's list — while the word
"forum" still named the local store everywhere in the code. The store had to be named as what it is: the
local store of [[issues]], not a second concept. And a scenario-keyed thread had to be tellable apart by
its concern, so that any read which needs to treat it differently can, without a second store.

## expanded spec

- **"forum" is gone from the substrate.** The local issue store's code speaks the issues model: its
  data-level identifiers are `postLocalIssue` / `replyLocalIssue` (the programmatic write entrypoints),
  `localStoreDir` / `LOCAL_STORE_REL` (the venue), `withStoreLock` / `commitStore` / `writeStoreFile` (the
  write mechanism). The dashboard route is `#/issues`, the side-nav entry reads **Issues**, and the
  user-facing prose says "issues page". The on-disk directory followed in [[issues-store-rename]]
  (`.spec/.issues`, with a one-shot self-migration). [[local-issues]] still OWNS the local store's whole
  mechanism.

- **One concern key tells a scenario thread apart.** A scenario-keyed thread's tell is its concern,
  `eval: <node> · <scenario>`, composed and parsed by one pair (`evalConcernKey` / `parseEvalConcern` in
  `localIssues.ts`). The thread is created lazily by the first `spex remark add <node> --scenario <name>`,
  bound to that node, and holds its remarks as replies ([[remark-substrate]] R4).

- **One merged read carries both.** `mergedIssues` (`issues.ts`) interleaves every local thread with the
  forge slice, scenario-keyed threads included: the Issues page, the board badge, `spex issue ls` and
  `spex issue show` all see them as issue threads, and `GET /api/issues/:id` finds one by id like any
  other. The propose-close nudge (`closeoutNudge`) is the one read that uses the key, skipping those
  containers because they outlive every session by design. There is no second read that keeps the two
  apart, and no surface other than the Issues pages renders a scenario thread ([[remark-teeth]]).
