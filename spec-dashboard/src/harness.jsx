// The launch harnesses' product marks ([[harness-adapter]] / [[launcher-select]]) — the glyphs themselves
// live in the shared icon vocabulary ([[icon-system]], icons.jsx); this module binds them to the harness
// registry the launcher picker and any session launcher display read, so which harness/launcher a
// session runs under reads as the SAME mark everywhere. `claude` is the default harness.
import { ClaudeCodeGlyph, CodexGlyph, OpencodeGlyph, PiGlyph } from './icons.jsx'
export { ClaudeCodeGlyph, CodexGlyph, OpencodeGlyph, PiGlyph }

// the harnesses the backend can launch (spec-cli/src/harness.ts HARNESSES). `claude` is the default.
export const HARNESSES = [
  { id: 'claude', label: 'Claude Code', Glyph: ClaudeCodeGlyph },
  { id: 'codex', label: 'Codex', Glyph: CodexGlyph },
  { id: 'opencode', label: 'opencode', Glyph: OpencodeGlyph },
  { id: 'pi', label: 'pi', Glyph: PiGlyph },
]
// harness id → its product mark. Unknown/absent harness falls back to claude, the default.
export const HARNESS_BY_ID = Object.fromEntries(HARNESSES.map((h) => [h.id, h]))

// session MODE marks — the CLI `session ls` vocabulary, mirrored: ◇ = headless (a terminal-free session
// whose console face is the chat view, [[session-console]]); interactive rows stay unmarked (no noise).
export const MODE_MARK = { headless: '◇' }
