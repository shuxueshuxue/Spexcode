// THE LEFT FINDING BAND IS ONE REGION, so it has one width.
//
// It was two: the shell dock persisted `spex.ftWidth` and the Sessions document's forest persisted
// `spex.siListWidth`, because the two routes draw the band from different components. That is a layout
// fact, not a product one — a reader who widens "the sidebar" means the sidebar, not "the sidebar while
// reading specs". Two keys for one region is the same defect shape as a mirrored selection or a second
// fold index: whichever copy the reader touched last silently disagrees with the other.
//
// It also made the handover visible. With different widths, switching routes moved the whole document
// column sideways at the swap frame; with one, the band is the same width before and after and nothing
// moves but its contents.
export const DOCK_BAND = { key: 'spex.dockWidth', initial: 204, min: 180, max: 460 }

// One-time migration, not a read fallback: the first load adopts whichever width the reader had actually
// arranged and the legacy keys go away. A permanent fallback would keep three sources of truth alive
// forever and let a stale one win after a storage clear.
const LEGACY = ['spex.ftWidth', 'spex.siListWidth']
try {
  if (localStorage.getItem(DOCK_BAND.key) == null) {
    for (const key of LEGACY) {
      const saved = parseInt(localStorage.getItem(key), 10)
      if (Number.isFinite(saved)) { localStorage.setItem(DOCK_BAND.key, String(saved)); break }
    }
  }
  LEGACY.forEach((key) => localStorage.removeItem(key))
} catch { /* private mode: the band just starts at its default */ }
