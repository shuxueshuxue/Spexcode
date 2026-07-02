import { loadHookConfig } from './specs.js'

// @@@ hook manifest - the harness-agnostic hook system has THREE parts: (1) the discovered handlers —
// `surface: hook` nodes under .config/core/* (spec-governed content, each shipping one co-located .sh);
// (2) this COMPILER, which flattens them into a flat per-session manifest; (3) a pure-shell dispatcher
// (spec-cli/hooks/dispatch.sh) the committed .claude/.codex shim binds to every harness event. The compiler
// is the ONLY step that parses spec frontmatter, so it runs ONCE at SessionStart and the hot-path dispatcher
// (PreToolUse fires on every tool) just greps a flat file — never walks the spec tree.
//
// Manifest line = `event<TAB>order<TAB>block<TAB>script` (script = repo-relative path to the node's .sh),
// sorted by event, then order, then script — the DETERMINISTIC run order the native multi-hook model (which
// runs matching hooks in parallel on BOTH Claude Code and Codex) cannot guarantee. One node binds many
// events (mark-active → UserPromptSubmit+PreToolUse) → one manifest line per (node × event).
export function compileManifest(cfgs = loadHookConfig()): string {
  const lines: string[] = []
  for (const h of cfgs) {
    const script = h.files.find((f) => f.endsWith('.sh'))
    if (!script) throw new Error(`surface:hook node '${h.name}' ships no .sh script (one co-located .sh required)`)
    for (const ev of h.events) lines.push(`${ev}\t${h.order}\t${h.block}\t${script}`)
  }
  lines.sort((a, b) => {
    const A = a.split('\t'), B = b.split('\t')
    return A[0].localeCompare(B[0]) || Number(A[1]) - Number(B[1]) || (a < b ? -1 : a > b ? 1 : 0)
  })
  return lines.length ? lines.join('\n') + '\n' : ''
}

