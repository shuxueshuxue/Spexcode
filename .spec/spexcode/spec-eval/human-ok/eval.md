---
scenarios:
  - name: feed-hide-reappear
    tags: [frontend-e2e]
    code: [spec-dashboard/src/EvalsFeed.jsx]
    description: >-
      Through the real product — a running backend and a real browser on the Evals page: pick a
      scenario whose latest reading is FRESH and un-ok'd. Confirm its feed row offers no ok action and
      the detail header carries no ok write button, then sign the reading off through the detail
      composer's typed /ok (the one dashboard door) and watch the feed. Then open the show-all chip.
      Then file a NEWER reading for the same scenario through `spex eval add` and reload.
    expected: >-
      The feed row is status-only before sign-off, and the detail header carries NO ok button — the
      composer's typed /ok is the one dashboard write door. Accepting /ok makes the ok'd row leave the
      default feed (it is fresh AND human-ok'd — reviewed loss), and the head grows
      a "N ok'd" chip whose toggle reveals the hidden row wearing its settled green certification ring:
      a real shared stroke SVG check, never a Unicode checkbox. The reveal chip uses that same SVG. The
      detail header shows the settled "human-ok" mark with the signer. The moment a newer reading
      lands, the scenario reappears in the default feed unblessed — the ok stayed bound to the older
      reading and transferred to nothing.
  - name: ok-durable-and-monotonic
    tags: [cli]
    code: [spec-eval/src/humanok.ts]
    description: >-
      Through the real `spex` CLI on a trunk checkout (a throwaway clone is ideal): run
      `spex eval ok <node> --scenario <s>` on a measured scenario, read the sidecar and `git log -1`;
      run the identical command again; run it against an unmeasured scenario; and run it once under a
      governed session identity (SPEXCODE_SESSION set).
    expected: >-
      The first ok appends one 'human-ok' line anchored to the latest eval's ts+codeSha and lands as
      a trunk commit touching only that sidecar (no pre-commit gate run); the repeat is idempotent
      success ("already human-ok'd", nothing appended); the unmeasured scenario is refused loud
      ("nothing to ok"); the governed session is refused with the remark repair — an agent never
      self-blesses. `spex eval ls` shows the ☑ human-ok tag on the blessed eval only.
---

Measured YATU: the browser loop drives the deployed dashboard surface a human reviewer actually uses
(feed row → detail header → show-all chip), never a component harness; the CLI loop drives the real
`spex eval ok` verb against a real git checkout so the trunk-commit landing is observed in git itself.
