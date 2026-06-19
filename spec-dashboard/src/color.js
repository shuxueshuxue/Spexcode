// @@@ color - the SINGLE source of colour from a seed. One hash → one hue → both an avatar face AND its
// labelling colour (node ring, ⏎ link, reparent edge, session-row stripe), so a session's face and every
// mark that names it always agree. Seed the same string everywhere (the session id) and they can't drift.
// Previously these were two systems: a round-robin PALETTE keyed by worktree path for the labels, and a
// separate hash of the session id for the face — so they MISALIGNED. Now there is only this.

// FNV-1a-ish 32-bit string hash. Deterministic, fast, well-spread — enough to slice into independent
// picks (hue / glyph / shape) at the call site. `Math.imul` keeps it a real 32-bit multiply.
export function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < (str || '').length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// the seed's hue (0–359); every colour below is this hue at a fixed lightness/saturation, so the avatar
// face and the label read as the SAME colour family.
export function hueFor(seed) { return hash(seed) % 360 }

// the avatar face palette: a dark fill + a light glyph, both at the seed's hue.
export function avatarColors(seed) {
  const hue = hueFor(seed)
  return { bg: `hsl(${hue} 55% 42%)`, fg: `hsl(${hue} 70% 92%)` }
}

// the labelling colour: a vivid mid-tone of the seed's hue, used for the node ring, the ⏎ link badge,
// the reparent edge, and the session-row stripe — anything that NAMES the session the avatar represents.
export function labelColor(seed) { return `hsl(${hueFor(seed)} 65% 50%)` }
