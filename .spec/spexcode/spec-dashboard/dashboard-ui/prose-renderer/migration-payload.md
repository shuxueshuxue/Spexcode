# TimelineChat selection/copy migration payload

`spec-dashboard/test/timeline-chat-interaction.e2e.mjs` is the reusable browser gate for moving TimelineChat
onto the unified prose renderer. It protects selection, copy semantics, and the continuous composer focus sink;
it does not freeze renderer DOM shape or authorize product changes in `TimelineChat.jsx`.

## Oracle boundary

DOM may answer only identity and geometry: which stable row the coordinates hit, whether the same `Element`
survives before and after the gesture or timeline poll, and whether a LINE range intersects the row's nested
inline code, link, and math nodes. WORD/NORMAL/LINE range text may be compared with ranges derived from that same
row because those checks ask whether the selection state machine covered the intended geometry.

Clipboard semantics have a separate oracle. The expected copy is an author-written fixture literal in the test,
never `element.textContent`, `innerText`, or `Range.toString()`. The copied formula must occur exactly once. This
separation is required because KaTeX's accessible and visual branches make the raw LINE Range contain the same
formula three times (`E=mc2E = mc^2E=mc2`), while the user-facing clipboard result is the single authored source
`E = mc^2`.

## Assumptions retired

1. **DOM shape:** rich prose puts text below paragraphs and inline elements, so `firstChild` is not a Text node.
   The coordinate fixture reuses the first-non-empty descendant Text walk introduced in `2df6933a`; `0873244e`
   is that lane's browser reading. The commits are references only; their evidence is not duplicated here.
2. **Hydration timing:** every DOM count and target baseline is taken only after the real session timeline GET
   succeeds and at least one rendered event exists. Loading-frame zero is never treated as timeline state.
3. **Coordinate stability:** the target is the exact rich fixture row selected by semantic content. Every
   coordinate gesture proves the hit belongs to that retained `Element` before and after the action, including
   across the real poll refresh. Expectations no longer follow whichever row happens to occupy an old point.

## Acceptance matrix

- NORMAL single-press drag returns the exact character span.
- WORD stationary double-click returns exactly one word.
- WORD double-click with the second press held and dragged expands continuously across at least four words; a
  late `dblclick` must not collapse it to the landing word.
- LINE triple-click returns the complete row and intersects its inline code, link, and math descendants.
- A plain click creates no custom highlight; Escape and a composer press clear one without moving focus.
- Ctrl/Cmd+C equals the hardcoded user-facing fixture literal and contains `E = mc^2` exactly once.
- During every gesture and a real timeline poll, `getSelection().toString()` stays empty, the same composer stays
  focused, its draft survives, and immediate printable/editing keys land through the native textarea path.
- The originating-prompt summary remains clickable, and two warm desktop conversations expose exactly one sink.

The fixture session is headless, parked before measurement, and receives no input during the gate. Its exact note
contains inline code, a link, and inline math. The gate runs the same matrix at 1280x800 and 390x844. Closure
requires three consecutive green executions; the latest content-addressed video, timeline, and result are filed
on this node's eval scenario rather than copied into this document.
