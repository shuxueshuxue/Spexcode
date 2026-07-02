// FeedSection — the shared section furniture of the issues panel ([[issues-view]]). ONE component whose
// DENSITY is a container prop, three levels: `bar` (a pinned one-line summary — title + counts — the
// section folded to its minimum, never gone), `region` (an internally-scrolling pane sharing the panel),
// `page` (the region given the whole panel). The SAME mounted instance spans all three — scroll, focus
// and filter state live inside it, so a density change never resets them; only the body's visibility and
// flex share change. The outer panel never scrolls; each section's body scrolls internally. The panel
// (the container) owns which section holds which density and the cross-section keys (Tab/j/k/Enter) —
// this component owns one section's frame. Section CONTENT is the child's contract (the threads list
// here; [[evals-feed]] when it lands), never this frame's.
export default function FeedSection({ title, summary, density = 'region', focused = false, onBarOpen, children }) {
  const bar = density === 'bar'
  return (
    <section className={`fs-section fs-${density}${focused ? ' fs-focused' : ''}`}>
      <div
        className="fs-head"
        role={bar ? 'button' : undefined}
        tabIndex={bar ? 0 : undefined}
        onClick={bar ? onBarOpen : undefined}
        onKeyDown={bar ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onBarOpen?.() } } : undefined}
      >
        <span className="fs-title">{title}</span>
        {summary && <span className="fs-summary">{summary}</span>}
      </div>
      {/* the body stays MOUNTED at bar density (hidden, not unmounted) — that is what preserves
          scroll/focus/filter across bar ⇄ region ⇄ page. */}
      <div className="fs-body" style={bar ? { display: 'none' } : undefined}>
        {children}
      </div>
    </section>
  )
}
