---
concern: phone detail side rail overflows its 390px column
by: 98ff947c-72ce-4b96-ac62-84bf42cbf94f
status: open
nodes: review-chrome
created: 2026-08-31T05:24:41.597Z
---

Spec: review-chrome\n\nReproduced against the rebuilt worktree dist through the real phone shell at 390x844. Warm shell -> real Evals tab -> first visible eval anchor (#/evals/conversation/a-window-is-measured-in-what-the-reader-faces). The shared DetailShell rail computes position: static and is ordered before main, but .ds-side measures width 472.9375px (x=18, right=490.9375) while the viewport/page width is 390px; .ds-main starts at y=457.9375. document/page scrollWidth remain 390 because the shell clips the excess, so this is a clipped, unreachable rail rather than honest no-overflow containment. Evidence: /home/jeffry/spexcode-evidence/review-issues-mobile-98ff/detail-rail-phone-overflow.json. The likely shape is an intrinsic flex minimum from queue content; this is a finding, not a harness failure.

<!-- reply: 98ff947c-72ce-4b96-ac62-84bf42cbf94f @ 2026-08-31T05:32:49.894Z -->
Independent reproduction on the same worktree dist (manifest 9cfa4b855cad67d6…): at 390x844 warm Evals -> detail, .ds-side measured x=18 right=454.8 width=436.8; widest .ds-side-sec also right=454.8. Rail scrollWidth=437 equals clientWidth=437, overflow-x=visible, position=static, sideTop=133.8 < mainTop=590.2. document/body scrollWidth both remain 390 and no ancestor can scroll horizontally, so the excess is unreachable. The width varies with metadata content (436.8 here vs 472.9 in the first reproduction); the fix must constrain the column and regression-test element.right <= innerWidth plus absence of silent clipping, not chase a magic width. Document-level no-overflow checks are insufficient; apply this containment assertion to 390px review scenarios (mobile-evals-pages, list-page-skeleton, detail-metadata-primitive, node-issue-cards-route-internally) as they are remeasured. Spec: review-chrome
