import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Background, MarkerType, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import SpecNode from './SpecNode.jsx'
import NodeView, { panesFor } from './NodeView.jsx'
import SessionWindow from './SessionWindow.jsx'
import SessionInterface from './SessionInterface.jsx'
import Legend from './Legend.jsx'
import Settings from './Settings.jsx'
import SpecSearch from './SpecSearch.jsx'
import BoardStats from './BoardStats.jsx'
import MobileApp from './MobileApp.jsx'
import { useIsMobile } from './useIsMobile.js'
import { loadBoard, layout, X_GAP, Y_GAP, projectTitle } from './data.js'
import { createMomentumScroll } from './scroll.js'
import { cycleNext } from './cycle.js'
import { labelColor } from './color.js'
import { sessionName } from './session.js'
import { useT } from './i18n/index.jsx'

const nodeTypes = { spec: SpecNode }
// node box (used only to centre the camera on a node). NW/NH must track the .spec-node size in
// styles.css: it's now two rows (title line + editor/last-edited line) and a bit wider for longer titles.
const NW = 220, NH = 46
const clamp = (z) => Math.max(0.4, Math.min(1.6, z))

// @@@ board chords - vim-style multi-key sequences typed on the board (a small key buffer; see onKey).
// A chord does NOT act directly: it opens the session board with a special @-directive PRE-SEEDED into
// the New Session input, which the backend performs in a fresh worktree on submit. Each maps the focused
// node id → the directive text. `nn` = new child under focus · `dd` = delete focus. Both their leader
// letters (n/d) are otherwise unbound on the board, so single-key nav (hjkl/i/…) is never shadowed.
const CHORDS = { nn: (id) => `@new under @${id}: `, dd: (id) => `@delete @${id}: ` }
const CHORD_KEYS = Object.keys(CHORDS)
const CHORD_LEADERS = new Set(CHORD_KEYS.map((c) => c[0]))

function Dashboard({ specs, sessions, project, reload }) {
  const [focusId, setFocusId] = useState(() => specs.find((s) => !s.parent)?.id)
  const [overlay, setOverlay] = useState(false)   // node-info popup (opened by `i`)
  const [pane, setPane] = useState('spec')
  const [sessionUI, setSessionUI] = useState(false) // session interface (opened by Enter)
  const [legend, setLegend] = useState(false)     // centered help modal: keymap + visual vocabulary (`?`)
  const [settings, setSettings] = useState(false) // centered settings modal: language picker etc. (`,`)
  const [search, setSearch] = useState(false)     // jump-to-node search palette (Alt+F)
  const [sessionSel, setSessionSel] = useState('new') // persisted across open/close: last tab/session
  const [highlightId, setHighlightId] = useState(null) // session whose overlays are emphasised
  const [seed, setSeed] = useState(null)          // one-shot text a board chord pre-fills the New Session input with
  const { getViewport, setViewport } = useReactFlow()
  const t = useT()
  const graphRef = useRef(null)
  const animRef = useRef(0)
  const chordRef = useRef({ buf: '', timer: 0 })  // pending board-chord buffer (see onKey)
  // @@@ kbdMode - the pointer-side mirror of "the camera follows the keyboard, not the mouse": while the
  // KEYBOARD is driving the board, the mouse gets out of the way. Nav keys engage it (see onKey); the CSS
  // (.kbd-mode) then hides the cursor and lifts the board's pointer events, so a stationary cursor can't
  // trigger a hover reaction (the issue popover etc.). A genuine mouse MOVE clears it (see below).
  const [kbdMode, setKbdMode] = useState(false)
  const kbdRef = useRef(false); kbdRef.current = kbdMode
  const lastMouseRef = useRef({ x: -1, y: -1 })
  // @@@ momentum scrollers - j/k glide for the two scrollable modals, one instance each so their
  // accumulating targets stay independent. The popup pane and the help body share ONE implementation
  // (createMomentumScroll); see scroll.js for the easing/target mechanics.
  const popupScroll = useMemo(() => createMomentumScroll(), [])
  const legendScroll = useMemo(() => createMomentumScroll(), [])

  // resolve focus on the RAW tree first (resilient to a polled-away merged/closed node), then expand.
  const rawById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s])), [specs])
  const focusRaw = rawById[focusId] || specs.find((s) => !s.parent) || specs[0]
  // @@@ expand-on-focus - the tree is a DRILL-DOWN, not a fixed full-forest map: only the focused node's
  // ancestor SPINE is expanded; every other subtree collapses to a single tile. So the root layer is
  // always a short, readable column and the whole tree re-plots as focus moves (see layout() in data.js
  // + the follow camera below). This deliberately replaces the older "fixed positions, never re-plots".
  const expanded = useMemo(() => {
    const set = new Set()
    for (let cur = focusRaw; cur; cur = cur.parent ? rawById[cur.parent] : null) set.add(cur.id)
    return set
  }, [focusRaw, rawById])
  // VISIBLE nodes are exactly those the layout placed (root, or a child of an expanded node); they carry
  // the x/y all geometry/render below works on. Hidden subtrees simply aren't in `specs2`.
  const placed = useMemo(() => layout(specs, expanded), [specs, expanded])
  const specs2 = useMemo(() => specs.filter((s) => placed[s.id]).map((s) => ({ ...s, ...placed[s.id] })), [specs, placed])
  const byId = useMemo(() => Object.fromEntries(specs2.map((s) => [s.id, s])), [specs2])
  const focus = byId[focusRaw.id]
  // direct-child count per node — drives the "expandable" hint: a VISIBLE node that has children but is
  // collapsed (not on the expanded spine) shows a ▸N affordance, since its subtree is hidden to the right.
  const childCount = useMemo(() => {
    const m = {}
    specs.forEach((s) => { if (s.parent) m[s.parent] = (m[s.parent] || 0) + 1 })
    return m
  }, [specs])
  // @@@ overlay nodes - every node a worktree is currently changing (its `overlays` carry the pending
  // add/edit/delete/move ops, each tagged with the author worktree's source). Drawn from the RAW tree so
  // the cycle (the `o` key) can jump to a changed node even while it sits in a collapsed subtree. Kept in
  // backend order so the cycle is stable across the 4s poll.
  const overlayNodes = useMemo(() => specs.filter((s) => s.overlays?.length), [specs])

  // @@@ locked session - clicking a session row locks the graph onto it (highlightId = its worktree
  // source). `lockedSession` is that row's object (for the banner's name/colour); `lockedNodes` are the
  // nodes IT is currently changing — drawn from the RAW tree (like overlayNodes) so the cycle can jump
  // into a collapsed subtree. When a session is locked the `o` cycle scopes to JUST its nodes
  // (`cycleNodes`); with nothing locked it falls back to every changed node on the board.
  const lockedSession = useMemo(
    () => (highlightId ? sessions.find((s) => s.source === highlightId) : null),
    [sessions, highlightId],
  )
  const lockedNodes = useMemo(
    () => (highlightId ? specs.filter((s) => (s.overlays || []).some((o) => o.source === highlightId)) : []),
    [specs, highlightId],
  )
  const cycleNodes = useMemo(() => (highlightId ? lockedNodes : overlayNodes), [highlightId, lockedNodes, overlayNodes])

  // @@@ node<->session link - a node does NOT belong to a session. `node.session` is only the LAST
  // editor (the git Session: trailer — usually a closed session), kept purely as attribution. The LIVE
  // link is the overlay: the board sessions CURRENTLY editing this node = those whose pending ops touch
  // it. That set (not node.session) is what we light up and jump into; a node can have 0, 1, or many.
  const liveEditorsOf = useCallback(
    (node) => (node ? sessions.filter((s) => s.ops?.some((op) => op.nodeId === node.id)) : []),
    [sessions],
  )

  // @@@ open the board - the session interface is a PERSISTENT place you switch to, not a per-open modal:
  // it stays mounted (hidden) so its selected tab AND each tab's typed-but-unsent input survive a
  // close/reopen. Enter (board or node-info popup) always reopens it at the remembered tab (`sessionSel`),
  // a "boarding switch" — never a context jump based on the focused node.
  const openBoard = useCallback(() => setSessionUI(true), [])
  // @@@ open a session's console - jump straight to a given session: select its tab + show the interface.
  // Used by the top-right SessionWindow and the `/` search when the picked entry is a session. No new
  // mechanism — SessionInterface already keys its console off `sessionSel`. (The relationship graph's own
  // node-click reuses the same tab-select, but it does so INSIDE the console via setSel — see SessionGraph.)
  const openSession = useCallback((id) => { setSessionSel(id); setSessionUI(true) }, [])
  // @@@ startNew - a board chord opens the session board on its New Session tab with `text` pre-seeded
  // (the @-directive). One-shot: SessionInterface applies it then clears `seed`, so a later reopen keeps
  // the user's own draft instead of re-seeding.
  const startNew = useCallback((text) => { setSessionSel('new'); setSeed(text); setSessionUI(true) }, [])
  // @@@ search routing - the `/` palette searches all three planes and hands back the picked entry; we
  // dispatch by its kind. A spec or issue FOCUSES its node (issues land on the node they're bound to) — the
  // expand-on-focus follow effect then drills its spine open + pans the camera. A session JUMPS to its tab
  // on the session board (openSession). One switch, no per-type logic leaking into the palette.
  const onSearchPick = useCallback((e) => {
    if (e.kind === 'session') openSession(e.target)
    else setFocusId(e.target)
  }, [openSession])

  const children = useMemo(() => specs2.filter((s) => s.parent === focus.id), [specs2, focus])
  const parent = focus.parent ? byId[focus.parent] : null

  // child is to the RIGHT; pick the one nearest in y.
  const childTarget = useMemo(() => {
    if (!children.length) return null
    return children.reduce((best, c) => (Math.abs(c.y - focus.y) < Math.abs(best.y - focus.y) ? c : best))
  }, [children, focus])

  // @@@ leaf right-step - a leaf has no child to dive into, so → falls back to the nearest node in
  // the columns to the RIGHT (dx>0) instead of dead-ending. Distance is weighted into grid cells
  // (dx/X_GAP, dy/Y_GAP) so the wide 280px column gap and the narrow 54px row gap compete fairly —
  // raw pixels would snap every press to the next column regardless of how far up/down a candidate
  // sits. Strictly rightward, so it never doubles as ↑/↓ and ← still steps back the way you came.
  const rightTarget = useMemo(() => {
    if (childTarget) return childTarget
    let best = null, bestD = Infinity
    for (const s of specs2) {
      const dx = s.x - focus.x
      if (dx <= 0) continue
      const dy = s.y - focus.y
      const d = (dx / X_GAP) ** 2 + (dy / Y_GAP) ** 2
      if (d < bestD) { bestD = d; best = s }
    }
    return best
  }, [childTarget, specs2, focus])

  // @@@ vertical nav - columns are aligned by depth (x = depth * X_GAP), so ↑/↓ move strictly
  // within the focused node's column to the nearest node in that y-direction. They never change
  // column or dive into a child (that's what ←/→ are for): on a border node, up jumps to the
  // cousin above in the SAME column, not to a nearer node one column over. Trivially reversible.
  const nearestY = useCallback((dir) => {
    let best = null
    for (const s of specs2) {
      if (s.id === focus.id || s.x !== focus.x) continue
      const dy = s.y - focus.y
      if (dir === 'down' ? dy <= 0 : dy >= 0) continue
      if (!best || Math.abs(dy) < Math.abs(best.y - focus.y)) best = s
    }
    return best
  }, [specs2, focus])
  const downTarget = useMemo(() => nearestY('down'), [nearestY])
  const upTarget    = useMemo(() => nearestY('up'), [nearestY])

  // @@@ nodes - positions from data; selection + (a) focus-kin dimming, or (b) when a session is
  // highlighted, the overlay-dim: nodes touched by that session glow, the rest fade. Recomputes on
  // poll (specs identity changes) so a freshly-added ghost shows up without a manual refresh.
  const nodes = useMemo(() => {
    return specs2.map((s) => {
    const kin = s.id === focusId || s.id === focus.parent || s.parent === focusId || s.parent === focus.parent
    let className
    // a session with pending node changes dims the board to spotlight them; a session with NONE
    // locks without greying everything (there's nothing to spotlight — the top banner says so), so
    // the board keeps its normal focus-kin dimming.
    if (highlightId && lockedNodes.length) {
      className = (s.overlays || []).some((o) => o.source === highlightId) ? 'ov-hot' : 'ov-dim'
    } else {
      className = kin ? undefined : 'is-far'
    }
    // a node with live editor(s) carries an `editors` list (SpecNode's second row draws their avatars),
    // driven by the live overlay (pending ops), NOT node.session. `editors` is the minimal slice each
    // avatar needs: id (the avatar seed + tooltip), status (liveness ring), node (tooltip label).
    const editors = liveEditorsOf(s)
    const editorData = editors.map((e) => ({ id: e.id, status: e.status, node: e.node }))
    // collapsed = has children but its subtree is hidden (not on the expanded spine) -> show the ▸N hint.
    const kids = childCount[s.id] || 0
    const extra = { editors: editorData, collapsed: kids > 0 && !expanded.has(s.id), childCount: kids }
    return {
      id: s.id, type: 'spec', position: { x: s.x, y: s.y },
      data: { ...s, ...extra },
      draggable: false, selected: s.id === focusId, className,
    }
    })
  }, [focusId, focus.parent, highlightId, lockedNodes, specs2, liveEditorsOf, childCount, expanded])

  const edges = useMemo(() => {
    const tree = specs2.filter((s) => s.parent).map((s) => {
      const hot = s.id === focusId || s.parent === focusId
      return {
        id: `${s.parent}-${s.id}`, source: s.parent, target: s.id, type: 'smoothstep',
        style: { stroke: hot ? '#268bd2' : '#ded7bf', strokeWidth: hot ? 2 : 1 }, zIndex: hot ? 1 : 0,
      }
    })
    // @@@ reparent preview - a node with a `moved` overlay carrying `toParent` (its proposed new parent)
    // gets a faint dashed arrow node→toParent in the author session's colour, so a human SEES the
    // reparent before it merges. Subtle (low opacity, animated dashes) and never touches a tree edge.
    const moves = []
    for (const s of specs2) {
      const mv = (s.overlays || []).find((o) => o.op === 'moved' && o.toParent && byId[o.toParent])
      if (!mv) continue
      const stroke = labelColor(mv.seed)
      moves.push({
        id: `move-${s.id}-${mv.toParent}`, source: s.id, target: mv.toParent, type: 'smoothstep',
        animated: true, zIndex: 2, className: 'move-edge',
        style: { stroke, strokeWidth: 1.5, strokeDasharray: '4 4', opacity: 0.6 },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
      })
    }
    return [...tree, ...moves]
  }, [focusId, specs2, byId])

  // camera — tree is fixed; viewpoint flat-pans to centre the focused node.
  const animateView = useCallback((target, dur) => {
    const start = getViewport()
    const t0 = performance.now()
    cancelAnimationFrame(animRef.current)
    const step = (now) => {
      const p = dur ? Math.min(1, (now - t0) / dur) : 1
      const e = 1 - Math.pow(1 - p, 3)
      setViewport({
        x: start.x + (target.x - start.x) * e,
        y: start.y + (target.y - start.y) * e,
        zoom: start.zoom + (target.zoom - start.zoom) * e,
      })
      if (p < 1) animRef.current = requestAnimationFrame(step)
    }
    animRef.current = requestAnimationFrame(step)
  }, [getViewport, setViewport])

  // @@@ centerOn - recentre on a node. When `zoom` is omitted (the arrow-nav path) the CURRENT zoom is
  // reused, so switching nodes is a pure flat-pan — never a zoom-to-fit. An earlier Van Wijk zoom arc
  // zoomed out then back in to frame each node and made switching "jump too high"; holding zoom constant
  // kills the jump. Explicit zoom is passed only by +/-/0.
  const centerOn = useCallback((node, zoom, dur = 300) => {
    const el = graphRef.current
    if (!el) return
    const z = zoom ?? getViewport().zoom
    animateView({ x: el.clientWidth / 2 - (node.x + NW / 2) * z, y: el.clientHeight / 2 - (node.y + NH / 2) * z, zoom: z }, dur)
  }, [animateView, getViewport])

  // @@@ initial framing - center the root once after first paint. Thereafter the camera FOLLOWS focus
  // (see the follow effect below): because the tree re-plots on every focus change, the camera must move
  // even on a mouse click, else the clicked node would teleport out from under the cursor.
  const framedRef = useRef(false)
  useEffect(() => {
    if (framedRef.current) return
    framedRef.current = true
    const id = requestAnimationFrame(() => centerOn(focus, undefined, 0))
    return () => cancelAnimationFrame(id)
  }, [centerOn, focus])

  // @@@ follow focus - the tree RE-PLOTS on every focus change (expand-on-focus), so the focused node
  // moves; the camera pans to keep it centred while its neighbourhood expands/collapses around it. Both
  // keyboard nav and clicks land here. Fires on focusId ALONE — not on the 4s poll (focus is a fresh
  // object each poll) — reading the latest focus/centerOn through refs. Skips the very first paint, which
  // the initial-framing effect owns.
  const focusRef = useRef(focus); focusRef.current = focus
  const centerRef = useRef(centerOn); centerRef.current = centerOn
  const followedRef = useRef(false)
  useEffect(() => {
    if (!followedRef.current) { followedRef.current = true; return }
    centerRef.current(focusRef.current)
  }, [focusId])

  // @@@ keys - capture phase so we win over react-flow. Graph mode: ←↑↓→ walk the tree, +/-/0 zoom,
  // `i` opens the node-info popup, Enter opens the session interface. A modal (popup or session UI)
  // OWNS the keys while open — arrows no longer leak through to move the board behind it (the old
  // blind-navigation bug); the session interface handles its own list nav / input.
  useEffect(() => {
    // the focused node's actual tabs (edit-first when it has a pending change), so Tab/number-key pane nav
    // matches what NodeView renders for THIS node — never cycling to an edit tab that isn't there.
    const paneKeys = panesFor(focus).map((p) => p.key)
    const cyclePane = (dir) => setPane((p) => { const i = paneKeys.indexOf(p); return paneKeys[((i < 0 ? 0 : i) + dir + paneKeys.length) % paneKeys.length] })
    // nav just moves focus; the follow-focus effect recenters once the tree has re-plotted around the new
    // focus (passing the stale pre-re-plot node straight to centerOn would aim at its OLD coordinates).
    const go = (t, e) => { if (t) { e.preventDefault(); e.stopPropagation(); setKbdMode(true); setFocusId(t.id) } }
    // @@@ bumpScroll - glide the open popup pane by `delta` via the shared momentum scroller. Only one
    // pane is mounted at a time, so the first matching `.ov-body` descendant is the scroller; when panes
    // switch the element changes and the scroller drops its stale target (see scroll.js).
    const bumpScroll = (delta) => popupScroll(
      document.querySelector('.ov-body .pane-doc, .ov-body .pane-hist, .ov-body .pane-issues, .ov-body .pane-eval, .ov-body .pane-edit'), delta)
    const onKey = (e) => {
      // @@@ relationship key - `t` opens the session console on its "View Session Relationship" tab — the
      // live monitor graph now LIVES in the console (see SessionInterface), not as a fullscreen overlay. It is
      // suppressed while a modal/console already captures keys (there a `t` is just a keystroke, e.g. typed
      // into an input). The console's own list nav then carries you off the tab; this key only opens onto it.
      if (!sessionUI && !overlay && !legend && !settings && !search && (e.key === 't' || e.key === 'T')) {
        e.preventDefault(); e.stopPropagation(); setSessionSel('graph'); setSessionUI(true); return
      }
      if (sessionUI) return // the session interface owns ALL its keys (arrows / Enter / typing / Esc / the graph)
      // search palette — same modal contract as the help/settings: while open its input OWNS every key
      // (typing the query, ↑/↓/Enter to pick, Esc to close — all in SpecSearch), so we return before any
      // board handler fires. App still catches Esc here too, so it closes even if the input lost focus.
      if (search) {
        if (e.key === 'Escape') { e.preventDefault(); setSearch(false) }
        return
      }
      if (overlay) {
        if (e.key === 'Escape') { e.preventDefault(); setOverlay(false); return }
        if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); cyclePane(e.shiftKey ? -1 : 1); return }
        // ←/→ and h/l cycle the panes (alongside Tab and 1/2) — vim's horizontal hand flips tabs,
        // never moves the board behind. (j/k and ↑/↓ below are the vertical hand: they scroll the open pane.)
        if (e.key === 'ArrowLeft'  || e.key === 'h') { e.preventDefault(); e.stopPropagation(); cyclePane(-1); return }
        if (e.key === 'ArrowRight' || e.key === 'l') { e.preventDefault(); e.stopPropagation(); cyclePane(1); return }
        if (/^[1-9]$/.test(e.key) && +e.key <= paneKeys.length) { e.preventDefault(); e.stopPropagation(); setPane(paneKeys[+e.key - 1]); return }
        // Inside the popup, j/k AND ↑/↓ scroll the open pane's content (vim's and the arrow hand both go
        // vertical here) rather than moving the board — only one pane is mounted at a time, so the first
        // overflow:auto descendant of .ov-body is the scroller. In the history pane this scroll also drives
        // the progressive reveal: reaching the end of the open version expands the next (see HistoryPane).
        if (e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation()
          bumpScroll(e.key === 'j' || e.key === 'ArrowDown' ? 120 : -120)
          return
        }
        // Enter crosses from reading the node to the session board (at the remembered tab). Popup closes behind.
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setOverlay(false); openBoard(); return }
        return // anything else does NOT move the board behind the popup
      }
      // graph mode (no modal open). The help modal (keymap + legend) is itself a modal: while open it
      // OWNS the keys — only `?`/Esc close it, nav never leaks to the board behind. Placed AFTER the
      // sessionUI/overlay guards so those modals are never disturbed; `?` opens it from the board.
      if (legend) {
        if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); setLegend(false); return }
        // j/k and ↑/↓ scroll the (often taller-than-viewport) help body — same momentum glide as the
        // popup pane, via the legend's own scroller instance. The `.legend` panel is the overflow box.
        if (e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation()
          legendScroll(document.querySelector('.legend'), e.key === 'j' || e.key === 'ArrowDown' ? 120 : -120)
          return
        }
        return
      }
      if (e.key === '?') { e.preventDefault(); setLegend(true); return }
      // settings modal — same modal contract as the help: while open it OWNS the keys (only `,`/Esc
      // close it), nav never leaks to the board behind. `,` opens it from the board (chosen because it
      // collides with no existing binding — t/?/nav keys/chords are all unaffected).
      if (settings) {
        if (e.key === 'Escape' || e.key === ',') { e.preventDefault(); setSettings(false); return }
        return
      }
      // @@@ Esc releases the session lock - the lone board-level Esc. Every modal above consumed its own
      // Esc and returned, so reaching here means the bare board owns the key: when a session is locked, Esc
      // un-greys the board and drops the lock banner (the keyboard mirror of clicking the banner's release).
      // With nothing locked it falls through to the board's other keys, so a bare-board Esc is a no-op.
      if (e.key === 'Escape' && highlightId) { e.preventDefault(); e.stopPropagation(); setHighlightId(null); return }
      if (e.key === ',') { e.preventDefault(); setSettings(true); return }
      // @@@ search key - `/` opens the jump-to-node search palette (the classic "slash to search"). It's
      // unbound elsewhere on the board and is the unshifted key (Shift+/ is `?`, the help modal — handled
      // above), so the two never collide. preventDefault stops the browser's own find-as-you-type / quick-find.
      if (e.key === '/') { e.preventDefault(); e.stopPropagation(); setSearch(true); return }
      // @@@ chord buffer - a small vim-style key buffer for multi-key board commands. A leader letter
      // (n/d) opens a pending buffer; the matching next letter fires the chord (open the session board
      // with its @-directive pre-seeded — see CHORDS/startNew). A non-matching key (or a 700ms lull)
      // clears the buffer and falls through, so the key still acts on its own. Plain letters only:
      // modified keystrokes (⌘/^/⌥) never enter the buffer. Sits ABOVE single-key nav so n/d buffer
      // first, but since neither leader is a nav key, hjkl/i/etc. are never shadowed.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && /^[a-zA-Z]$/.test(e.key)) {
        const cur = chordRef.current
        if (cur.buf || CHORD_LEADERS.has(e.key)) {
          clearTimeout(cur.timer)
          const buf = cur.buf + e.key
          if (CHORDS[buf]) { e.preventDefault(); e.stopPropagation(); chordRef.current = { buf: '', timer: 0 }; startNew(CHORDS[buf](focus.id)); return }
          if (CHORD_KEYS.some((c) => c.startsWith(buf))) {
            e.preventDefault(); e.stopPropagation()
            chordRef.current = { buf, timer: setTimeout(() => { chordRef.current = { buf: '', timer: 0 } }, 700) }
            return
          }
          chordRef.current = { buf: '', timer: 0 }   // dead end → reset, fall through to single-key handling
        }
      }
      // hjkl mirror the arrows for graph nav (vim): k/j up/down the column, h/l to parent/child.
      if (e.key === 'ArrowUp'    || e.key === 'k') return go(upTarget, e)
      if (e.key === 'ArrowDown'  || e.key === 'j') return go(downTarget, e)
      if (e.key === 'ArrowLeft'  || e.key === 'h') return go(parent, e)
      if (e.key === 'ArrowRight' || e.key === 'l') return go(rightTarget, e)
      // zoom & cycle are keyboard board ops too — they engage kbdMode so the mouse steps aside the same way.
      if (e.key === '=' || e.key === '+') { e.preventDefault(); setKbdMode(true); centerOn(focus, clamp(getViewport().zoom * 1.2), 160) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); setKbdMode(true); centerOn(focus, clamp(getViewport().zoom / 1.2), 160) }
      else if (e.key === '0') { e.preventDefault(); setKbdMode(true); centerOn(focus, 0.85, 200) }
      else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); setOverlay(true) }
      // @@@ overlay cycle - `o` walks focus through the changed nodes (`O` = ⇧, reverse), wrapping at the
      // ends. SCOPE follows the lock: with a session locked it walks just THAT session's changed nodes
      // (the top banner names the count); with nothing locked it walks every changed node on the board.
      // It's a jump like `/` search: focus lands on the node and the expand-on-focus follow effect drills
      // its spine open + pans the camera, so a change buried in a collapsed subtree is one keystroke away.
      // When focus isn't on a marked node, it enters the ring at the first (or last, reversed) one.
      else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault()
        if (!cycleNodes.length) return
        setKbdMode(true)
        const next = cycleNext(cycleNodes, focus.id, e.key === 'O' ? -1 : 1, (n) => n.id)
        if (next) setFocusId(next.id)
      }
      // (`t` toggles the session graph — handled at the top of onKey so it works from either graph.)
      // Enter opens the session board at the remembered tab (boarding switch — see openBoard).
      else if (e.key === 'Enter') { e.preventDefault(); openBoard() }
      // @@@ @-key - the spec-oriented launch shortcut: jump straight to a FRESH New Session targeting the
      // focused node. It always lands on the New tab (never the remembered tab) with `@<focus> ` pre-seeded,
      // so starting a node-scoped session is one keystroke. Unlike Enter (which boards at the remembered tab
      // and resolves live editors), `@` is UNCONDITIONAL — it never jumps into an existing session. Reuses
      // startNew (the chord seed path); the seeded `@<id> ` reads as an accepted @-mention, caret after it.
      else if (e.key === '@') { e.preventDefault(); startNew(`@${focus.id} `) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [overlay, sessionUI, legend, settings, search, highlightId, focus, cycleNodes, upTarget, downTarget, rightTarget, parent, centerOn, getViewport, openBoard, startNew, popupScroll, legendScroll])

  // @@@ a REAL mouse move wakes the mouse - the only exit from kbdMode. The guard is the whole trick: every
  // arrow press PANS the camera under a stationary cursor, and a content shift can emit a synthetic mousemove
  // whose clientX/clientY are UNCHANGED — treating that as "the user moved the mouse" would snap the cursor
  // back the instant you navigate, defeating the feature. So we wake only when the pointer's viewport
  // coordinates actually differ from the last seen ones. One always-on listener (stable via kbdRef) both
  // tracks the position and performs the exit; it no-ops while kbdMode is already off.
  useEffect(() => {
    const onMove = (e) => {
      const p = lastMouseRef.current
      const moved = e.clientX !== p.x || e.clientY !== p.y
      p.x = e.clientX; p.y = e.clientY
      if (moved && kbdRef.current) setKbdMode(false)
    }
    window.addEventListener('mousemove', onMove, true)
    return () => window.removeEventListener('mousemove', onMove, true)
  }, [])

  // clicking a node focuses it; the follow-focus effect then re-plots the tree around it and pans the
  // camera to keep it in place (a click drills the same way the arrows do). It does NOT open a session —
  // Enter is the deliberate cross into one.
  const onNodeClick = useCallback((_e, n) => setFocusId(n.id), [])

  // double-click is the mouse parallel to the `i` key: focus the node AND open its info popup.
  // (single click still only focuses without panning; the camera follows the keyboard alone.)
  const onNodeDoubleClick = useCallback((_e, n) => { setFocusId(n.id); setOverlay(true) }, [])

  // clicking a session in the top-right window toggles the lock on its worktree's overlays (matched by
  // source = worktree path). Locking ON jumps to the first node it's changing, in TREE order so the
  // camera lands where the `o` cycle enters; focusing a collapsed id is fine (expand-on-focus drills its
  // spine open). A session with no pending ops still locks — the top banner explains the empty grip;
  // releasing (clicking again) leaves focus where it is.
  // toggle=true (the graph's session rows): a click on the locked session releases it. toggle=false (the
  // session-board tab's DOUBLE click): always GRIP — switch back to the graph already locked + focused,
  // never accidentally release. Either way, locking auto-focuses the session's first changed node.
  const onPickSession = useCallback((s, toggle = true) => {
    const releasing = toggle && highlightId === s.source
    setHighlightId(releasing ? null : s.source)
    if (releasing) return
    const ids = new Set((s.ops || []).map((op) => op.nodeId))
    const first = specs.find((n) => ids.has(n.id))
    if (first) setFocusId(first.id)
  }, [highlightId, specs])

  return (
    <div className={kbdMode ? 'app kbd-mode' : 'app'}>
      <div className="graph" ref={graphRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          nodesFocusable={false}
          disableKeyboardA11y
          defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
          minZoom={0.4}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant="dots" color="#cdc6ad" gap={20} size={1} />
        </ReactFlow>
        {/* HUD is deliberately minimal: brand + a discreet `?` that opens the full keymap/legend modal.
            The wall of inline hints used to live here; it now lives inside that modal (see Legend.jsx). */}
        <div className="hud">
          <span className="brand">$ spec-dashboard</span>
          {/* a discreet floating affordance for the relationship view — opens the session console on its
              "View Session Relationship" tab (same as the `t` key). The button makes the hotkey discoverable. */}
          <button className="hud-graph" onClick={() => { setSessionSel('graph'); setSessionUI(true) }} title={t('hud.graphTitle')}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="3.5" cy="4" r="1.8" /><circle cx="12.5" cy="4" r="1.8" /><circle cx="8" cy="12.5" r="1.8" />
              <path d="M4.9 5.1 L7 11 M11.1 5.1 L9 11 M5 4 H11" />
            </svg>
          </button>
          <button className="hud-help" onClick={() => setLegend((v) => !v)} title={t('hud.helpTitle')}>?</button>
        </div>

        <SessionWindow sessions={sessions} activeId={highlightId} onPick={onPickSession} onOpen={openBoard} onOpenSession={openSession} />

        {/* @@@ board stats - the per-node badges, totalled (bottom-left, always on). It reads the SAME
            `specs` the graph plots, so it stays in lock-step with the tiles; clicking a stat WALKS focus
            through the nodes it counts (cycleNext from the current focus — the same ring primitive the o/O
            overlay cycle uses), so a repeated click steps to the next one, drilling + panning to each. */}
        <BoardStats specs={specs} focusId={focusId} onJump={setFocusId} />

        {/* @@@ lock banner - a top-center hint while a session owns the graph. It names the grip (in the
            session's colour) and tells the user the key to walk its changed nodes — or, when it has none,
            that there's nothing to show (so the un-greyed board doesn't read as a broken lock). */}
        {lockedSession && (
          <div className="lock-hint" style={{ '--ov': labelColor(lockedSession.id) }}>
            <span className="lock-hint-lead">🔒 {sessionName(lockedSession)}</span>
            {lockedNodes.length ? (
              <span className="lock-hint-body">
                {t('lockHint.cycleBefore')}<kbd>o</kbd><kbd>O</kbd>{t('lockHint.cycleAfter', { n: lockedNodes.length })}
              </span>
            ) : (
              <span className="lock-hint-body">{t('lockHint.empty')}</span>
            )}
            <button className="lock-hint-release" onClick={() => setHighlightId(null)} title={t('lockHint.releaseTitle')}>
              {t('lockHint.release')}
            </button>
          </div>
        )}

        {legend && <Legend onClose={() => setLegend(false)} />}
        {settings && <Settings onClose={() => setSettings(false)} />}
        {/* search the THREE planes at once — spec nodes (whole raw tree, not just visible), live sessions,
            and node-bound issues. onSearchPick routes the picked entry: spec/issue focus their node (the
            follow effect drills the spine open + pans), a session jumps to its tab on the session board. */}
        {search && <SpecSearch specs={specs} sessions={sessions} onPick={onSearchPick} onClose={() => setSearch(false)} />}
      </div>

      {overlay && <NodeView node={focus} pane={pane} setPane={setPane} onClose={() => setOverlay(false)} />}
      {/* stays MOUNTED across open/close (hidden via `open`) so the selected tab + per-tab drafts persist. */}
      <SessionInterface
        sessions={sessions}
        specs={specs}
        project={project}
        focusNode={focus}
        open={sessionUI}
        sel={sessionSel}
        setSel={setSessionSel}
        seed={seed}
        onSeedConsumed={() => setSeed(null)}
        onClose={() => setSessionUI(false)}
        onCreated={async (id) => { await reload(); if (id) setSessionSel(id) }}
        onPickSession={onPickSession}
        reload={reload}
      />
    </div>
  )
}

// @@@ App - loads the board (merged spec tree + live worktree overlay) and polls it so pending
// changes from other worktrees appear without a refresh. Keeps the last good board across reloads.
export default function App() {
  const t = useT()
  const isMobile = useIsMobile()
  const [board, setBoard] = useState(null)
  const reload = useCallback(() => loadBoard().then(setBoard).catch(() => {}), [])
  useEffect(() => {
    reload()
    const id = setInterval(reload, 4000)
    return () => clearInterval(id)
  }, [reload])
  // @@@ self-identifying tab - name the browser tab after the project (projectTitle: the configured
  // dashboard.title, else the backend's launch folder), so when several projects each run their own backend,
  // every tab says which one this viewer is pointed at. The same name labels the session-board list header.
  useEffect(() => {
    const name = projectTitle(board)
    if (name) document.title = `${name} · SpexCode`
  }, [board?.project])
  if (!board) return <div className="loading">{t('hud.loading')}</div>
  // @@@ one board, two faces - same polled data, but a phone gets the touch-first drill-down (MobileApp);
  // a wider viewport keeps the desktop graph board. The switch is viewport width alone (see useIsMobile).
  if (isMobile) return <MobileApp specs={board.nodes} sessions={board.sessions} project={projectTitle(board)} />
  return <Dashboard specs={board.nodes} sessions={board.sessions} project={projectTitle(board)} reload={reload} />
}
