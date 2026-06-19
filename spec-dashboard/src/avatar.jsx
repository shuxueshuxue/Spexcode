// @@@ avatar - deterministic, PLUGGABLE avatars keyed by session id. The dashboard has no real user
// accounts yet, so a face is GENERATED from a hash of the session id: stable per session, needs no
// storage, and never collides for the same id. The provider REGISTRY is the seam — register a
// higher-priority provider later (e.g. one that maps a session id → a real image asset, or pulls a
// gravatar/team-avatar URL) and every avatar on the board swaps with ZERO changes to the callers.
//
//   avatarFor(seed)            -> a descriptor ({ kind, … }); providers are tried newest-first.
//   registerAvatarProvider(fn) -> push a provider; fn(seed) returns a descriptor or null to defer.
//   <Avatar seed status … />   -> renders whatever descriptor avatarFor returns (kind switches the
//                                 renderer, so a future kind:'image' provider drops in here untouched).

// The face colour comes from the SHARED colour system (color.js): avatarColors(seed) yields the same hue
// labelColor(seed) uses, so a session's face and every mark that names it (node ring, ⏎ link, session
// stripe) always agree. The local `hash` is gone; we reuse color.js's so the glyph/shape slices below are
// sliced from the EXACT bits the face colour is derived from.
import { hash, avatarColors } from './color.js'

// the generated-avatar vocabulary: a curated neutral-glyph set + shape set. Three independent hash
// slices pick hue, glyph and shape, so two seeds collide only if ALL THREE match (≈ glyphs×shapes×360).
const GLYPHS = ['◆', '▲', '●', '■', '★', '✦', '⬟', '⬢', '❖', '◈', '✸', '⟡', '✚', '❂', '◐', '◑', '⬣', '▰', '✶', '⬤', '✹', '◇', '⊛', '✺']
const SHAPES = ['circle', 'rounded', 'square', 'hex']

// @@@ generatedAvatar - the DEFAULT provider and the registry's backstop: it never returns null, so
// avatarFor always resolves to something even before any real-asset provider is registered.
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

// @@@ Avatar - render any descriptor avatarFor() returns. `kind` switches the renderer, which is the
// whole point of the seam: a kind:'image' provider's descriptor ({ src }) renders an <img> here and
// SpecNode never changes. `status` rings the face by session liveness (working/idle/offline), reusing
// the same liveness vocabulary the session list uses, so a glance at the avatar reads "is it live".
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
