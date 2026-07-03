---
title: e2e-review
status: active
surface: skill
hue: 285
desc: Use after an e2e run that recorded whole-session video with a timeline sidecar, or when the human asks to review/annotate recordings — "审录屏 / 标注 / annotate / review the e2e videos". Splits the recordings into per-scenario clips, files each as video eval evidence, and points the human at the dashboard annotator.
---

# e2e-review

Turn a whole-session e2e recording into reviewable, per-scenario **video evidence** — filed through
yatsu, reviewed in the dashboard. This skill imports a WORKFLOW (ported from gugu's `.agent/skills/e2e`,
its ancestor); the tooling it once shipped (a standalone HTML annotator, a Range-serving HTTP script, a
frame-PNG saver) is already product — the dashboard annotator, the blob route's Range support, the
issue/evidence seams — so the skill never starts a second UI.

## input contract

A directory of recordings, scanned recursively for pairs: one `.webm` beside one `*.timeline.json`
(Playwright POOL workers each produce such a pair; any emitter that writes the shape qualifies). The
emitter timeline is `{ events: [{ atMs, kind, label }] }`:

- `kind: "narrate"`, label `▶ <scenario> · <title>` — a scenario's start boundary (the next `▶` ends it).
- `kind: "frame"`, label `📷 <step>` — a named step inside the running scenario.

The same scenario appearing in several recordings (retry, another worker) resolves to the newest.

## the loop

1. **Split** — `node .spec/<root>/.config/e2e-review/split-recordings.mjs <recordings-dir> <out-dir>`
   (`--ffmpeg <path>` if ffmpeg isn't on PATH). Each scenario becomes `<scenario>.mp4` (h264 faststart,
   browser-seekable) plus `<scenario>.timeline.json` in SpexCode's step-timeline format (`{v:1, events:
   [{tMs, step}]}`, clip-relative — validated LOUD at filing). No title cards, no burned-in captions:
   the annotator renders scenario context live from the spec tree, so pixels stay evidence.
2. **File** — map each clip to the spec node whose behavior it exercises (`spex search <topic>`; the
   node's `yatsu.md` names its scenarios) and file your verdict WITH the clip:
   `spex yatsu eval <node> --scenario <s> --pass|--fail --video <clip>.mp4 --timeline <clip>.timeline.json`.
3. **Hand to the human** — the dashboard forum (`#/forum`), evals tab, video-first: each clip plays in
   the annotator with its clickable step ruler; the human circles a region to file an issue on the
   responsible node (clip + timeline ride as typed evidence), disputes a verdict with their own manual
   reading, or discusses on the eval's comment thread. Say where to look; do not build or serve
   anything else.

## judgment stays yours

The split is mechanical; the FILING is not. A clip's verdict is your reading of the recording against
the scenario's `expected` — watch before you file, and file `--fail` honestly when the loop broke.
Scenario names come from the `▶` markers, so the emitter's vocabulary should match the governed
node's `yatsu.md`; when they diverge, fix the emitter or the yatsu.md, never hand-rename clips.
