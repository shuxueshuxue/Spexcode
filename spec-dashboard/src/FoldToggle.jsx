import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'

// The ONE sidebar-toggle glyph ([[fold-toggle]]): the shared `panel-left` icon ([[icon-system]]) — an
// outlined panel with a filled inner bar marking the list column — replacing the old ‹/› text arrows.
// One glyph for BOTH states (Obsidian keeps the same icon for a sidebar open or collapsed; the button's
// title carries the direction), so fold and unfold read as one affordance, not two glyphs to learn.
export function FoldToggleIcon() {
  return <Icon name="panel-left" className="fold-toggle-icon" />
}

// The shared fold/unfold BUTTON over that glyph — every fold site (the eval/issues master-detail
// shells' fv-fold/fv-unfold, the session console's si-list-unfold strip, the eval detail's remark-rail
// fold) renders THIS, never its own copy of the SVG. The className carries the site's geometry (square
// badge vs full-height strip); `folded` picks the title/aria direction; `label` overrides the default
// "the list" wording where it doesn't name what folds; `children` ride as a site badge (the rail's
// remark count on its folded strip).
export default function FoldToggle({ className, folded, onToggle, label = null, children = null }) {
  const t = useT()
  const l = label ?? t(folded ? 'masterList.unfold' : 'masterList.fold')
  return (
    <button type="button" className={className} data-tip={l} aria-label={l} onClick={onToggle}>
      <FoldToggleIcon />
      {children}
    </button>
  )
}
