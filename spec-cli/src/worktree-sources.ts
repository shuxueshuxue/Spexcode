import { existsSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

// @@@ worktree-sources ([[private-overlay]]) - a fresh session worktree checks out only TRACKED content, and
// private mode keeps `.spec` + `spexcode.json` untracked (spexcode.local.json is untracked in BOTH modes) —
// so git alone hands a dispatched agent a worktree with NO spec tree: every hook handler script is absent
// (the dispatcher silently runs nothing), spex sees zero nodes, and the gate re-renders per event over empty
// config roots. Link those sources from the main checkout instead. On a default-mode repo the checkout
// already carries them, so each link guard no-ops — one mechanism, never a mode branch. A failure degrades
// that worker (no hooks, no specs), so it is reported, not swallowed.
export function linkUntrackedSpecSources(main: string, wt: string): void {
  for (const f of ['.spec', 'spexcode.json', 'spexcode.local.json']) {
    try {
      if (existsSync(join(main, f)) && !existsSync(join(wt, f))) symlinkSync(join(main, f), join(wt, f))
    } catch (e) {
      console.error(`spexcode: could not link ${f} from ${main} into worktree ${wt} — that worker runs without it (${e})`)
    }
  }
}
