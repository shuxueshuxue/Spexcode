---
scenarios:
  - name: zones-fold-and-the-keyboard-walk-never-steals-a-sink
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SessionForestPanel.jsx]
    description: >
      With sessions in every zone, fold and unfold the offline and archive zones from their headers, deep-link to a
      session inside a folded zone, then press ↑/↓ from inert chrome, from inside xterm, and from a textarea, and
      ⌥+↑/↓ from inside xterm; drag a working row onto the archive heading.
    expected: >
      The whole header is the one disclosure button; needs-you and running never fold; the deep-linked row stays
      revealed; plain arrows walk the list only from inert chrome while ⌥-arrows switch from anywhere and
      textareas keep their native keys; the drop performs the reversible close with no confirm.
  - name: the-archive-index-is-one-card
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SessionInterface.jsx]
    related: [spec-dashboard/src/styles.css]
    description: >
      Open the archive overlay over a real backend's COMPLETE closed index, in dark and light presets, and read
      the running page: sample the rendered pixel of the card body, its header, and a sticky date head; compare
      the backdrop against the scrim every other lifted layer spends and against the same app pixel under the
      previous rendering; read both corner radii and their tokens; count rows drawing a rule and rows whose
      handle repeats their title; hover a row with a real pointer; scroll the list under a date head; filter,
      and walk the rows with the keyboard.
    expected: >
      The card body, its header, and every sticky date head render the SAME pixel — the --raised rung — so
      nothing inside the card sits on a rung below the card. The backdrop is the one scrim the product's other
      lifted layers spend, not a second one mixed from a token whose colour flips with the theme. The card wears
      the large corner rung and its rows the control rung, both resolved from tokens, so a preset that retunes
      geometry moves them together. A row is an inset rounded band: no row draws a rule, and under the pointer it
      takes --wash-hover and lifts its chevron from --muted to --ink2. The date head pins flush to the
      scrollport's top edge while rows scroll under it; the search filters the complete index with no further
      request; the arrow keys walk rows wearing the shared inset focus ring and no outline of their own; and no
      row prints its title twice.
---
# measuring session-forest

The list's contract is what it does with rows, so the measurement drives folds, keys, and the archive drop.

The archive card's contract is a set of SURFACES and a geometry, so its measurement reads the running page
rather than the sheet: a rendered pixel is the only honest answer to "is the header the same surface as the
card", because a header that paints nothing and a header that paints the card's tone are the same thing to a
reader and different things to a stylesheet. The scrim leg is an A/B against the previous rendering's own
screenshot, so the claim is a difference between two real frames and not a colour arithmetic argument.
