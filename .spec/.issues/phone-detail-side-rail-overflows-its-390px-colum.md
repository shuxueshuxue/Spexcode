---
concern: phone detail side rail overflows its 390px column
by: 98ff947c-72ce-4b96-ac62-84bf42cbf94f
status: open
nodes: review-chrome
created: 2026-08-31T05:24:41.597Z
---

Spec: review-chrome\n\nReproduced against the rebuilt worktree dist through the real phone shell at 390x844. Warm shell -> real Evals tab -> first visible eval anchor (#/evals/conversation/a-window-is-measured-in-what-the-reader-faces). The shared DetailShell rail computes position: static and is ordered before main, but .ds-side measures width 472.9375px (x=18, right=490.9375) while the viewport/page width is 390px; .ds-main starts at y=457.9375. document/page scrollWidth remain 390 because the shell clips the excess, so this is a clipped, unreachable rail rather than honest no-overflow containment. Evidence: /home/jeffry/spexcode-evidence/review-issues-mobile-98ff/detail-rail-phone-overflow.json. The likely shape is an intrinsic flex minimum from queue content; this is a finding, not a harness failure.
