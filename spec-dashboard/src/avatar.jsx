// reuse color.js's hash so the glyph/shape slices below come from the same bits as the face colour.
import { hash, avatarColors } from './color.js'

// the generated-avatar vocabulary: a curated neutral-glyph set + shape set. Three independent hash
// slices pick hue, glyph and shape, so two seeds collide only if ALL THREE match (≈ glyphs×shapes×360).
const GLYPHS = ['◆', '▲', '●', '■', '★', '✦', '⬟', '⬢', '❖', '◈', '✸', '⟡', '✚', '❂', '◐', '◑', '⬣', '▰', '✶', '⬤', '✹', '◇', '⊛', '✺']
const SHAPES = ['circle', 'rounded', 'square', 'hex']

// the default provider and registry backstop: never returns null, so avatarFor always resolves to something.
function generatedAvatar(seed) {
  const h = hash(seed)
  return {
    kind: 'generated',
    seed,
    glyph: GLYPHS[(h >>> 9) % GLYPHS.length],
    shape: SHAPES[(h >>> 17) % SHAPES.length],
    ...avatarColors(seed),   // bg/fg from the shared colour system — same hue as labelColor(seed)
  }
}

// registry: providers are tried newest-first; the first non-null descriptor wins. generatedAvatar is
// seeded last-resort so the array is never empty.
const providers = [generatedAvatar]
export function registerAvatarProvider(fn) { providers.unshift(fn) }
export function avatarFor(seed) {
  for (const p of providers) {
    const a = p(seed)
    if (a) return a
  }
  return generatedAvatar(seed)
}

// `kind` switches the renderer (a kind:'image' descriptor renders an <img>); `status` rings the face by liveness.
export function Avatar({ seed, status, title, size = 16 }) {
  const a = avatarFor(seed)
  const box = { width: size, height: size }
  const face = a.kind === 'image'
    ? <img className="av-face av-img" src={a.src} alt="" style={box} />
    : (
      <span className={`av-face av-gen av-${a.shape}`} style={{ ...box, background: a.bg, color: a.fg, fontSize: size * 0.62 }}>
        {a.glyph}
      </span>
    )
  return <span className={`avatar av-st-${status || 'none'}`} title={title} style={box}>{face}</span>
}
