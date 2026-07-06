// reuse color.js's hash so the glyph/shape slices below come from the same bits as the face colour.
import { hash, avatarColors } from './color.js'

// the generated-avatar vocabulary: a curated neutral-glyph set + shape set. Three independent hash
// slices pick hue, glyph and shape, so two seeds collide only if ALL THREE match (≈ glyphs×shapes×360).
const GLYPHS = ['◆', '▲', '●', '■', '★', '✦', '⬟', '⬢', '❖', '◈', '✸', '⟡', '✚', '❂', '◐', '◑', '⬣', '▰', '✶', '⬤', '✹', '◇', '⊛', '✺']
const SHAPES = ['circle', 'rounded', 'square', 'hex']

// deterministic descriptor for a seed: never returns null, so every consumer always gets a face.
export function avatarFor(seed) {
  const h = hash(seed)
  return {
    seed,
    glyph: GLYPHS[(h >>> 9) % GLYPHS.length],
    shape: SHAPES[(h >>> 17) % SHAPES.length],
    ...avatarColors(seed),   // bg/fg from the shared colour system — same hue as labelColor(seed)
  }
}

// `status` rings the face by liveness.
export function Avatar({ seed, status, title, size = 16 }) {
  const a = avatarFor(seed)
  const box = { width: size, height: size }
  return (
    <span className={`avatar av-st-${status || 'none'}`} data-tip={title} aria-label={title} style={box}>
      <span className={`av-face av-gen av-${a.shape}`} style={{ ...box, background: a.bg, color: a.fg, fontSize: size * 0.62 }}>
        {a.glyph}
      </span>
    </span>
  )
}
