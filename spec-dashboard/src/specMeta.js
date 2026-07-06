// the node vocabulary CONSTANTS, dependency-free — extracted from SpecNode.jsx so light surfaces
// (the mobile face, the session window/search rows) can speak the same colours/glyphs without
// importing the graph tile component, which drags @xyflow/react into their chunk.

// the four backend-DERIVED states (specs.ts deriveStatus): merged in-sync, active in-flight,
// drift = governed code ahead of spec, pending = no committed version. The dot takes the colour.
// One source for the nodes AND the Legend — they can never drift.
export const STATUS = {
  merged:  { color: '#859900' },
  active:  { color: '#cb4b16' },
  drift:   { color: '#b58900' },
  pending: { color: '#93a1a1' },
}

// the pending-op glyphs an overlay can stamp on a node. Exported alongside STATUS for the Legend.
export const GLYPH = { added: '+', edited: '~', deleted: '✕', moved: '→' }
