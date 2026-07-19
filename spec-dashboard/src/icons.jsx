// The dashboard's ONE icon vocabulary ([[icon-system]]) — every inline glyph lives here, in the
// Obsidian/Notion linear style the side rail set: stroke-SVG by default (fill=none,
// stroke=currentColor, round caps/joins, ~1.4–2 stroke, aria-hidden), with official filled geometry
// declared on the icon's data row when fidelity requires it. Components never hand-write an <svg> — they render <Icon name/>
// (or <IconButton/> for an icon-only button, which FORCES title+aria-label so no icon button ships
// without a tooltip/accessible name). The harness product marks (Claude Code / Codex / opencode / pi)
// are fill-based brand glyphs, deliberately outside the stroke contract but kept here so this file
// stays the single source; they inherit currentColor via .si-agent-glyph so both themes read them.

// each def: node (the shapes), vb (viewBox, default 24), sw (per-icon strokeWidth, default 1.8),
// and optional fill/stroke overrides (defaults: none/currentColor).
const ICONS = {
  // ——— Lucide-derived 24×24 ———
  plus: { node: <><path d="M5 12h14" /><path d="M12 5v14" /></> },
  x: { node: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></> },
  'chevron-left': { node: <path d="m15 18-6-6 6-6" />, sw: 2 },
  'chevron-right': { node: <path d="m9 18 6-6-6-6" />, sw: 2 },
  'chevron-down': { node: <path d="m6 9 6 6 6-6" />, sw: 2 },
  check: { node: <path d="M20 6 9 17l-5-5" />, sw: 2 },
  blank: { node: null },
  'circle-check': { node: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.6 2.6L16.5 9" /></> },
  'circle-x': { node: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6" /><path d="m15 9-6 6" /></> },
  'circle-minus': { node: <><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></> },
  'circle-dashed': { node: <circle cx="12" cy="12" r="9" strokeDasharray="3 3" /> },
  ellipsis: { node: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></> },
  'message-square': { node: <><path d="M21 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z" /></> },
  // the composer's Send — a plain up arrow (Lucide arrow-up), the icon-only send affordance.
  send: { node: <><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>, sw: 2 },
  download: { node: <><path d="M12 15V3" /><path d="m7 10 5 5 5-5" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /></> },
  clock: { node: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></> },
  search: { node: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></> },
  info: { node: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>, sw: 2 },
  pencil: { node: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></> },
  terminal: { node: <><path d="m4 17 6-6-6-6" /><path d="M12 19h8" /></>, sw: 2 },
  'list-checks': { node: <><path d="m3 7 2 2 4-4" /><path d="m3 17 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" /></> },
  trash: { node: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5" /><path d="M14 11v5" /></> },
  play: { node: <path d="M6 3.5 19.5 12 6 20.5Z" /> },
  pause: { node: <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></> },
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
  // the projects catalog ([[projects-hub]]) — a layers stack: many projects, one gateway.
  projects: {
    vb: 18, sw: 1.4,
    node: <><path d="M9 2.2 16 5.8 9 9.4 2 5.8Z" /><path d="M2 9.4 9 13 16 9.4" /><path d="M2 12.8 9 16.4 16 12.8" /></>,
  },

  // GitHub Primer Octicons `issue-opened-16` (MIT) — preserve the official filled ring + centre.
  'issue-opened': {
    vb: 16, fill: 'currentColor', stroke: 'none',
    node: <><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" /><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" /></>,
  },
  // GitHub Primer Octicons `issue-closed-16` (MIT) — the concluded lifecycle's matching ring + check.
  'issue-closed': {
    vb: 16, fill: 'currentColor', stroke: 'none',
    node: <><path d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z" /><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z" /></>,
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
      fill={def.fill ?? 'none'} stroke={def.stroke ?? 'currentColor'} strokeWidth={strokeWidth ?? def.sw ?? 1.8}
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

// ——— fill-based harness product marks (brand glyphs, not stroke icons) ———
// Each is the harness's OWN official product mark (not its company's logo), sourced from AionUi's
// multi-CLI icon set (github.com/iOfficeAI — AionCore crates/aionui-assets/assets/logos/), with the
// hardcoded brand fills stripped so the mark inherits currentColor from .si-agent-glyph and stays
// readable in both themes. Where the original was two-tone, the secondary tone becomes an opacity step.

// Claude Code — the Claude spark/starburst (source: ai-major/claude.svg, fill #D97757 dropped).
export const ClaudeCodeGlyph = () => (
  <svg className="si-agent-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
  </svg>
)
// Codex CLI — the split ring + prompt mark (source: tools/coding/codex.svg; the white backing disc
// dropped, black fills stripped).
export const CodexGlyph = () => (
  <svg className="si-agent-glyph" viewBox="0 0 160 160" aria-hidden="true">
    <path d="M135 80C135 49.6243 110.376 25 80 25C49.6243 25 25 49.6243 25 80C25 110.376 49.6243 135 80 135V149C41.8924 149 11 118.108 11 80C11 41.8924 41.8924 11 80 11C118.108 11 149 41.8924 149 80C149 118.108 118.108 149 80 149V135C110.376 135 135 110.376 135 80Z" />
    <path d="M50.9235 54.3903C54.0216 52.577 58.0026 53.6185 59.8161 56.7165L70.9294 75.7009C72.6642 78.6649 72.6642 82.3345 70.9294 85.2985L59.8161 104.283C58.0026 107.381 54.0216 108.422 50.9235 106.609C47.8255 104.796 46.784 100.815 48.5973 97.7165L58.6745 80.4997L48.5973 63.2829C46.784 60.1848 47.8255 56.2038 50.9235 54.3903Z" />
    <path d="M112 89.5C115.59 89.5 118.5 92.4101 118.5 96C118.5 99.5899 115.59 102.5 112 102.5H85C81.4101 102.5 78.5 99.5899 78.5 96C78.5 92.4101 81.4101 89.5 85 89.5H112Z" />
  </svg>
)
// opencode — the nested-square terminal mark (source: tools/coding/opencode.svg; the two-tone
// #211E1E/#CFCECD pair becomes currentColor + an opacity step so one glyph serves both themes).
export const OpencodeGlyph = () => (
  <svg className="si-agent-glyph" viewBox="0 0 240 300" aria-hidden="true">
    <path d="M180 240H60V120H180V240Z" opacity="0.35" />
    <path fillRule="evenodd" clipRule="evenodd" d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" />
  </svg>
)
// pi — the official Pi "P + i dot" mark (source: tools/pi.svg, itself from pi.dev/logo-auto.svg,
// MIT, Earendil Inc.; already currentColor).
export const PiGlyph = () => (
  <svg className="si-agent-glyph" viewBox="0 0 45 45" aria-hidden="true">
    <path fillRule="evenodd" d="M9.3 9.3h19.8v13.2h-6.6v6.6H15.9v6.6H9.3Zm6.6 6.6v6.6h6.6v-6.6Z" />
    <path d="M29.1 22.5h6.6v13.2h-6.6Z" />
  </svg>
)
