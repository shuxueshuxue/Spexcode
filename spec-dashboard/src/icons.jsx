// The dashboard's ONE icon vocabulary ([[icon-system]]) — every inline glyph lives here, in the
// Obsidian/Notion linear style the side rail set: a single stroke-SVG contract (fill=none,
// stroke=currentColor, round caps/joins, ~1.4–2 stroke, aria-hidden), Lucide-derived paths inlined so
// there is zero runtime dependency. Components never hand-write an <svg> — they render <Icon name/>
// (or <IconButton/> for an icon-only button, which FORCES title+aria-label so no icon button ships
// without a tooltip/accessible name). The two vendor marks (Anthropic/OpenAI) are fill-based brand
// glyphs, deliberately outside the stroke contract but kept here so this file stays the single source.

// each def: node (the shapes), vb (viewBox, default 24), sw (per-icon strokeWidth, default 1.8)
const ICONS = {
  // ——— Lucide-derived 24×24 ———
  plus: { node: <><path d="M5 12h14" /><path d="M12 5v14" /></> },
  x: { node: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></> },
  'chevron-left': { node: <path d="m15 18-6-6 6-6" />, sw: 2 },
  'chevron-right': { node: <path d="m9 18 6-6-6-6" />, sw: 2 },
  download: { node: <><path d="M12 15V3" /><path d="m7 10 5 5 5-5" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /></> },
  clock: { node: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></> },
  search: { node: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></> },
  play: { node: <path d="M6 3.5 19.5 12 6 20.5Z" /> },
  pause: { node: <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></> },
  // the fold/unfold glyph ([[fold-toggle]]) — an outlined panel with a filled inner bar marking the
  // list column; ONE glyph for both states, the button title carries the direction.
  'panel-left': {
    sw: 2,
    node: <><rect x="1" y="2" width="22" height="20" rx="4" /><rect x="4" y="5" width="2" height="14" rx="2" fill="currentColor" stroke="none" /></>,
  },
  settings: {
    node: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  },

  // ——— the side rail's page glyphs ([[side-nav]]), hand-drawn on an 18-grid ———
  graph: {
    vb: 18, sw: 1.4,
    node: <><rect x="1.5" y="6.5" width="5" height="4.4" rx="1" /><rect x="11.5" y="1.8" width="5" height="4.4" rx="1" /><rect x="11.5" y="11.8" width="5" height="4.4" rx="1" /><path d="M6.5 8.7 h2.2 M11.5 4 h-1.3 q-1.5 0-1.5 1.5 v7 q0 1.5 1.5 1.5 h1.3" /></>,
  },
  sessions: {
    vb: 18, sw: 1.4,
    node: <><rect x="1.5" y="2.5" width="15" height="13" rx="1.6" /><path d="M4.6 6.5 l2.6 2.3 -2.6 2.3 M9 12.4 h4" /></>,
  },
  evals: {
    vb: 18, sw: 1.4,
    node: <><path d="M2.5 15.5 v-11" /><path d="M2.5 15.5 h13" /><rect x="4.6" y="10" width="2.6" height="3.5" rx="0.5" /><rect x="8.7" y="7" width="2.6" height="6.5" rx="0.5" /><path d="M13 6 l1.4 1.4 L16.5 3.6" /></>,
  },
  issues: {
    vb: 18, sw: 1.4,
    node: <><path d="M2.5 3.5 h13 v8.4 h-7 l-3.6 3 v-3 h-2.4 z" /><path d="M5.4 6.7 h7.2 M5.4 9.2 h4.8" /></>,
  },

  // ——— 16-grid utility glyphs kept at their drawn size ———
  lock: {
    vb: 16, sw: 1.3,
    node: <><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7 V5 a2.5 2.5 0 0 1 5 0 V7" /></>,
  },
  paperclip: {
    vb: 16, sw: 1.3,
    node: <path d="M12.5 7.2 L7 12.6 a2.6 2.6 0 0 1-3.7-3.7 L9 3.2 a1.7 1.7 0 0 1 2.4 2.4 L5.8 11.2 a0.8 0.8 0 0 1-1.2-1.2 L9.7 5" />,
  },
  loader: {
    vb: 16, sw: 1.5,
    node: <><circle cx="8" cy="8" r="5.5" opacity="0.3" /><path d="M8 2.5 a5.5 5.5 0 0 1 5.5 5.5" /></>,
  },
  maximize: {
    vb: 16, sw: 1.4,
    node: <><path d="M2 6V2h4" /><path d="M14 6V2h-4" /><path d="M2 10v4h4" /><path d="M14 10v4h-4" /></>,
  },
  minimize: {
    vb: 16, sw: 1.4,
    node: <><path d="M6 2v4H2" /><path d="M10 2v4h4" /><path d="M6 14v-4H2" /><path d="M10 14v-4h4" /></>,
  },
}

export function Icon({ name, size = 16, strokeWidth, className, style }) {
  const def = ICONS[name]
  if (!def) throw new Error(`unknown icon: ${name}`)
  const vb = def.vb || 24
  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${vb} ${vb}`}
      fill="none" stroke="currentColor" strokeWidth={strokeWidth ?? def.sw ?? 1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className={className} style={style}
    >
      {def.node}
    </svg>
  )
}

// The icon-only button: label is REQUIRED and becomes both the tooltip (`data-tip`, the app's
// singleton tooltip layer — [[tooltip]]) and the accessible name (`aria-label`), so no icon button
// can ship without either.
export function IconButton({ icon, label, onClick, className, size, iconClassName, ...rest }) {
  return (
    <button type="button" className={className} data-tip={label} aria-label={label} onClick={onClick} {...rest}>
      <Icon name={icon} size={size} className={iconClassName} />
    </button>
  )
}

// ——— fill-based vendor marks (brand glyphs, not stroke icons) ———
export const AnthropicGlyph = () => (
  <svg className="si-agent-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
  </svg>
)
export const OpenAIGlyph = () => (
  <svg className="si-agent-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22.282 9.821a6 6 0 0 0-.516-4.91a6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9a6.05 6.05 0 0 0 .743 7.097a5.98 5.98 0 0 0 .51 4.911a6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206a6 6 0 0 0 3.997-2.9a6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081l4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085l4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354l-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023l-.141-.085l-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365l2.602-1.5l2.607 1.5v2.999l-2.597 1.5l-2.607-1.5Z" />
  </svg>
)
