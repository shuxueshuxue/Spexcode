// The launch harnesses' vendor marks ([[harness-adapter]] / [[launcher-select]]) — the glyphs themselves
// live in the shared icon vocabulary ([[icon-system]], icons.jsx); this module binds them to the harness
// registry the launcher picker and any session launcher display read, so which harness/launcher a
// session runs under reads as the SAME mark everywhere. `claude` is the default harness.
import { AnthropicGlyph, OpenAIGlyph } from './icons.jsx'
export { AnthropicGlyph, OpenAIGlyph }

// the harnesses the backend can launch (spec-cli/src/harness.ts HARNESSES). `claude` is the default.
export const HARNESSES = [
  { id: 'claude', label: 'Claude Code', Glyph: AnthropicGlyph },
  { id: 'codex', label: 'Codex', Glyph: OpenAIGlyph },
]
// harness id → its vendor mark. Unknown/absent harness falls back to claude, the default.
export const HARNESS_BY_ID = Object.fromEntries(HARNESSES.map((h) => [h.id, h]))
