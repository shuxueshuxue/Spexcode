import { useT } from './i18n/index.jsx'

// The ONE sidebar-toggle glyph ([[fold-toggle]]): an Obsidian-style icon — an outlined panel with a
// filled inner bar marking the list column — replacing the old ‹/› text arrows. One glyph for BOTH
// states (Obsidian keeps the same icon for a sidebar open or collapsed; the button's title carries the
// direction), so fold and unfold read as one affordance, not two glyphs to learn.
export function FoldToggleIcon() {
  return (
    <svg className="fold-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="2" width="22" height="20" rx="4" />
      <rect className="sidebar-toggle-icon-inner" x="4" y="5" width="2" height="14" rx="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

// The shared fold/unfold BUTTON over that glyph — every master-list fold site (the eval/issues
// master-detail shells' fv-fold/fv-unfold, the session console's si-list-unfold strip) renders THIS,
// never its own copy of the SVG. The className carries the site's geometry (square badge vs full-height
// strip); `folded` picks the title/aria direction.
export default function FoldToggle({ className, folded, onToggle }) {
  const t = useT()
  const label = t(folded ? 'masterList.unfold' : 'masterList.fold')
  return (
    <button type="button" className={className} data-tip={label} aria-label={label} onClick={onToggle}>
      <FoldToggleIcon />
    </button>
  )
}
