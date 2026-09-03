---
concern: The adopter plugin seed is nine differences behind the live tree, so root npm run lint is red on main
by: 8bb006f2-ff07-46c9-a216-83c6e32f7777
status: open
nodes: init-preset
created: 2026-09-03T15:04:32.171Z
---

Spec: init-preset

`npm run test:init-plugins` fails, and with it the root `npm run lint`, on `main` itself — not on
any lane. Nine differences between the live authoring tree and the checked-in adopter seed:

    node scripts/sync-init-plugins.mjs --check   →  exit 1
    init plugin parity failed (9 difference(s)):
      - content: core/comment-altitude/spec.md
      - content: core/idle/spec.md
      - content: core/mark-active/spec.md
      - content: core/session-fail/spec.md
      - mode:    core/session-listen/session-listen.sh
      - content: core/session-listen/spec.md
      - content: core/spec-first/spec.md
      - content: core/spec-of-file/spec.md
      - content: core/stop-gate/spec.md

Proved shared, not local: the same nine, byte-identical, on `/home/jeffry/spexcode` main
(`diff` of the two reports → identical). Zero commits have touched `.spec/spexcode/.plugins`
since the seed's last sync, so this is not "the live tree moved ahead" — the seed was written by
an older projection and never regenerated.

**The eight content differences are one missing sentence each.** The projection copies each live
hook body verbatim; the live bodies gained a line that the seed lacks:

    > The startup `SPEX_PROFILE` hook list may disable this lifecycle hook with a clean no-op;
    > `full` and profiles that include `stop-gate` retain it.

Added by `2be7f72c9 feat(spec-cli): add harness-selected CLI profiles`
(Session: 15f4d33c-f9e2-444a-ad4c-794ea9fd90db), which is on main. That commit taught the eight
live plugin bodies about `SPEX_PROFILE` and did not regenerate the seed. So **every `spex init`
adopter is seeded hook specs that are one contract behind the toolchain they run** — the profile
clause is true of their installation and absent from the spec that governs it.

**The mode difference fails the gate but breaks nothing at runtime**, and is worth saying plainly
rather than escalating. git records the live handler `100755` and the seeded copy `100644`:

    100755 da64f5e7c…  .spec/spexcode/.plugins/core/session-listen/session-listen.sh
    100644 da64f5e7c…  spec-cli/templates/spec/project/.plugins/core/session-listen/session-listen.sh

An adopter's copy is therefore non-executable — but `dispatch.sh` runs handlers as
`bash "$handler"`, never by direct exec, and `materialize.ts`'s refresh loop `chmodSync(temp, 0o755)`
on any content-driven refresh. Same blob, inert consequence. It is a committed exec-bit divergence,
not a broken hook.

**Not fixed here.** `npm run sync:init-plugins` is a one-command fix, but it rewrites nine core
plugin spec files in a machine-routing lane, and those same plugin shells are being edited in other
lanes right now — regenerating them from this branch would collide. The fix wants its own commit on
a lane that owns the plugin tree.

**Worth closing beyond the regeneration**: the projection is derived, and the gate that guards it
runs only under `npm run lint`, which is *already* red on main — so a red gate here is invisible
against the existing red. A gate whose failure is indistinguishable from the standing failure is
not protecting anything.
